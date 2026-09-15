import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = [
	'202608210001_initial_schema.sql',
	'20260826140343_security_hardening.sql',
	'202608270001_training_promotion_cycle.sql',
	'202608270002_normalize_course_completion.sql',
	'202608280001_accumulated_promotion_test.sql',
	'202609020001_fourteen_stage_curriculum.sql',
	'202609020002_stage_one_skill_targets.sql',
	'202609020003_expand_skill_allowlist.sql',
	'202609040001_prevent_problem_issue_race.sql',
	'202609050001_validate_issue_and_serialize_submission.sql',
	'202609050002_allow_stage_one_revision.sql',
	'202609060001_claude_feedback_pipeline.sql',
	'202609060002_refresh_open_problem_copy.sql',
	'202609060003_allow_stage_switch_with_open_problem.sql',
	'202609070001_preserve_frontier_progress.sql',
	'202609070002_on_demand_simple_feedback.sql',
	'202609070003_easy_feedback_preference.sql',
	'202609090001_remove_on_demand_simple_feedback.sql',
	'202609090002_feedback_input_budget_and_errors.sql',
	'202609090003_claude_problem_generation.sql',
	'202609100001_topic_preferences_and_expanded_bank.sql',
	'202609110001_qa_test_harness.sql',
	'202609110002_qa_harness_review_fixes.sql',
	'202609110003_generated_problem_quality_lifecycle.sql',
	'202609150001_require_feedback_comments.sql',
].map((file) => readFileSync(resolve(process.cwd(), `../supabase/migrations/${file}`), 'utf8')).join('\n');
const rlsTest = readFileSync(resolve(process.cwd(), '../supabase/tests/learner_data_rls.sql'), 'utf8');
const stageSwitchMigration = readFileSync(
	resolve(process.cwd(), '../supabase/migrations/202609060003_allow_stage_switch_with_open_problem.sql'),
	'utf8',
);
const frontierMigration = readFileSync(
	resolve(process.cwd(), '../supabase/migrations/202609070001_preserve_frontier_progress.sql'),
	'utf8',
);
const simplifiedFeedbackRemoval = readFileSync(
	resolve(process.cwd(), '../supabase/migrations/202609090001_remove_on_demand_simple_feedback.sql'),
	'utf8',
);
const feedbackBudgetMigration = readFileSync(
	resolve(process.cwd(), '../supabase/migrations/202609090002_feedback_input_budget_and_errors.sql'),
	'utf8',
);
const problemGenerationMigration = readFileSync(
	resolve(process.cwd(), '../supabase/migrations/202609090003_claude_problem_generation.sql'),
	'utf8',
);
const topicPreferenceMigration = readFileSync(resolve(process.cwd(), '../supabase/migrations/202609100001_topic_preferences_and_expanded_bank.sql'), 'utf8');
const qaHarnessMigration = readFileSync(resolve(process.cwd(), '../supabase/migrations/202609110001_qa_test_harness.sql'), 'utf8');
const qaHarnessFixMigration = readFileSync(resolve(process.cwd(), '../supabase/migrations/202609110002_qa_harness_review_fixes.sql'), 'utf8');
const generatedProblemQualityMigration = readFileSync(resolve(process.cwd(), '../supabase/migrations/202609110003_generated_problem_quality_lifecycle.sql'), 'utf8');
const feedbackCommentMigration = readFileSync(resolve(process.cwd(), '../supabase/migrations/202609150001_require_feedback_comments.sql'), 'utf8');

describe('Supabase adaptive learning contract', () => {
	it('旧4軸カラムを残さず段階別特徴署名のRPCを定義する', () => {
		expect(migration).not.toContain('feature_vectors');
		expect(migration).toContain('p_feature_signature jsonb');
		expect(migration).toContain('p_prompt_hash text');
		expect(migration).toContain('p_problem_id uuid default null');
		expect(rlsTest).toContain('"version":2');
	});

	it.each(['skill_results', 'learner_skill_stats', 'problem_bank', 'problem_history', 'ai_usage_events', 'ai_budget_policies'])(
		'%sでRLSを有効にする',
		(table) => expect(migration).toContain(`alter table public.${table} enable row level security`),
	);

	it('問題発行の同時実行を一意制約エラーにせず冪等化する', () => {
		const migration = readFileSync(resolve(process.cwd(), '../supabase/migrations/202609040001_prevent_problem_issue_race.sql'), 'utf8');
		expect(migration).toContain("'on conflict do nothing'");
		expect(migration).toContain('Concurrent duplicate or competing requests are idempotent');
	});

	it('提出と同じトランザクションで技能結果と習熟度を更新する', () => {
		expect(migration).toContain('insert into public.skill_results');
		expect(migration).toContain('insert into public.learner_skill_stats');
		expect(migration).toContain('skill result is not a target of the issued problem');
		expect(rlsTest).toContain('Stage-1 revision or idempotent retry was not recorded correctly');
	});

	it('通常訓練と累積合格式の進級テストをDB側で判定する', () => {
		expect(migration).toContain("learning_phase in ('training', 'promotion_test', 'retraining')");
		expect(migration).toContain('v_next_passes := v_before.phase_passes');
		expect(migration).toContain("v_result ->> 'learningPhase' <> 'promotion_test'");
		expect(migration).toContain("learning_phase = 'promotion_test',");
		expect(migration).toContain('alter column required_training_passes set default 10');
		expect(rlsTest).toContain('Failed promotion question did not retain accumulated passes');
		expect(rlsTest).toContain('Failed promotion question did not move to a new problem');
		expect(migration).toContain('Stage-1 sets and promotion-test questions are one-shot');
	});

	it('未提出課題を残したまま到達済み段階を切り替えられる', () => {
		expect(stageSwitchMigration).toContain('create or replace function public.select_learning_stage');
		expect(stageSwitchMigration).not.toContain('finish the current problem before changing stages');
		expect(stageSwitchMigration).toContain('without discarding an open task');
	});

	it('復習で先頭段階の進級状態と解放済み段階を失わない', () => {
		expect(frontierMigration).toContain('frontier_learning_phase');
		expect(frontierMigration).toContain('new.highest_unlocked_stage_id < old.highest_unlocked_stage_id');
		expect(frontierMigration).toContain("if p_stage_id = v_progress.highest_unlocked_stage_id then");
		expect(frontierMigration).toContain('v_before.current_stage_id < v_before.highest_unlocked_stage_id');
	});

	it('問題生成と添削のトークン上限・使用量保存を定義する', () => {
		expect(migration).toContain("('problem_generation', 1800, 700, 3, 5400, 2100)");
		expect(migration).toContain("('feedback', 6000, 1800, 20, 120000, 36000)");
		expect(migration).toContain('cache_creation_input_tokens');
		expect(migration).toContain('cache_read_input_tokens');
		expect(migration).toContain("review_status text not null default 'provisional'");
		expect(migration).toContain('ask the service owner');
		expect(migration).toContain('create table public.ai_request_jobs');
		expect(migration).toContain('grant execute on function public.reserve_ai_feedback');
		expect(migration).toContain('to service_role');
		expect(migration).toContain('revoke execute on function public.submit_mock');
	});

	it('問題生成をサービス権限だけで予約し、検証済み問題の保存と発行を同じ処理で行う', () => {
		expect(problemGenerationMigration).toContain('create or replace function public.reserve_ai_problem_generation');
		expect(problemGenerationMigration).toContain('create or replace function public.finalize_ai_problem_generation');
		expect(problemGenerationMigration).toContain("coalesce(auth.role(), '') <> 'service_role'");
		expect(problemGenerationMigration).toContain("generation_source, provider, model, prompt_version, status");
		expect(problemGenerationMigration).toContain('perform public.issue_problem');
		expect(problemGenerationMigration).toContain("where operation = 'problem_generation'");
		expect(problemGenerationMigration).toContain("review_status = 'provisional'");
		expect(problemGenerationMigration).toContain('max_input_tokens_per_request = 12000');
		expect(problemGenerationMigration).toContain('max_output_tokens_per_request = 7000');
		expect(problemGenerationMigration).toContain('to service_role');
		expect(problemGenerationMigration).toContain('from public, anon, authenticated');
	});

	it('追加生成のやさしい説明を廃止し、設定による通常添削だけを残す', () => {
		expect(simplifiedFeedbackRemoval).toContain('drop table if exists public.feedback_simplifications');
		expect(simplifiedFeedbackRemoval).toContain('drop function if exists public.reserve_ai_feedback_simplification');
		expect(simplifiedFeedbackRemoval).toContain("delete from public.ai_budget_policies where operation = 'feedback_simplification'");
		expect(simplifiedFeedbackRemoval).toContain('Historical AI request and usage audit rows are intentionally retained');
	});

	it('複数問題の完全な入力見積りを使い、やさしい解説に別回数を割り当てない', () => {
		expect(feedbackBudgetMigration).toContain('p_estimated_input_tokens integer default null');
		expect(feedbackBudgetMigration).toContain('v_estimated_input := coalesce');
		expect(feedbackBudgetMigration).toContain('max_input_tokens_per_request = 8000');
		expect(feedbackBudgetMigration).toContain('daily_input_tokens_per_learner = 160000');
		expect(feedbackBudgetMigration).toContain('Easy feedback is part of the normal feedback call');
		expect(feedbackBudgetMigration).not.toContain("values ('feedback_simplification'");
	});

	it('毎回の解説難易度を本人だけが保存し、添削関数だけが読み取れるようにする', () => {
		expect(migration).toContain('easy_feedback_enabled boolean not null default false');
		expect(migration).toContain('grant update (easy_feedback_enabled) on table public.learning_progress to authenticated');
		expect(migration).toContain('create or replace function public.get_ai_feedback_preference');
		expect(migration).toContain('revoke execute on function public.get_ai_feedback_preference(uuid) from public, anon, authenticated');
		expect(migration).toContain('grant execute on function public.get_ai_feedback_preference(uuid) to service_role');
	});

	it('論点設定はランダムを初期値にし、自由設定を3件・各20文字までDBでも制限する', () => {
		expect(topicPreferenceMigration).toContain("topic_selection_mode text not null default 'random'");
		expect(topicPreferenceMigration).toContain('cardinality(p_topics) <= 3');
		expect(topicPreferenceMigration).toContain('char_length(topic) not between 1 and 20');
		expect(topicPreferenceMigration).toContain('grant update (topic_selection_mode, custom_topics)');
	});

	it('QA固定問題消費テストはサービス権限・専用問題ステータスに隔離する', () => {
		expect(qaHarnessMigration).toContain('create table public.qa_test_learners');
		expect(qaHarnessMigration).toContain("'qa'");
		expect(qaHarnessMigration).toContain("coalesce(auth.role(), '') <> 'service_role'");
		expect(qaHarnessMigration).toContain('seed_qa_fixed_exhaustion');
		expect(qaHarnessMigration).toContain('reset_qa_test_learner');
		expect(qaHarnessMigration).toContain("v_status = 'qa'");
		expect(qaHarnessMigration).toContain("'-t' || substring(replace(p_learner_id::text");
		expect(qaHarnessMigration).toContain('from public, anon, authenticated');
		expect(qaHarnessFixMigration.indexOf('delete from public.problem_history')).toBeLessThan(qaHarnessFixMigration.indexOf('delete from public.problem_bank'));
		expect(qaHarnessFixMigration).toContain('delete from public.learning_progress');
		expect(qaHarnessFixMigration).toContain("'-q' || v_qa_key");
		expect(qaHarnessFixMigration).toContain("'qa:' || v_qa_key");
	});

	it('生成問題を独立審査後の個別試用にし、5回目の要修正で共有対象外にする', () => {
		expect(generatedProblemQualityMigration).toContain("'trial'");
		expect(generatedProblemQualityMigration).toContain('create table public.problem_quality_reviews');
		expect(generatedProblemQualityMigration).toContain('create table public.problem_trials');
		expect(generatedProblemQualityMigration).toContain("operation in ('problem_generation', 'problem_generation_repair', 'problem_quality_review'");
		expect(generatedProblemQualityMigration).toContain("p_quality_reviews -> -1 -> 'review' ->> 'verdict' <> 'approve'");
		expect(generatedProblemQualityMigration).toContain('revision_count = revision_count + 1');
		expect(generatedProblemQualityMigration).toContain('v_trial.revision_count >= v_trial.max_revision_count');
		expect(generatedProblemQualityMigration).toContain("disqualification_reason = 'five_revision_results'");
		expect(generatedProblemQualityMigration).toContain("update public.problem_bank set status = 'rejected'");
		expect(generatedProblemQualityMigration).toContain("update public.problem_bank set status = 'approved'");
		expect(generatedProblemQualityMigration).toContain("p_feature_signature ? 'customTopic'");
		expect(generatedProblemQualityMigration).toContain("status = 'private_verified'");
		expect(generatedProblemQualityMigration).toContain('revoke all on table public.problem_trials');
	});

	it('解説がない提出結果をDB保存前に拒否する', () => {
		expect(feedbackCommentMigration).toContain('rename to submit_mock_before_feedback_comment_guard');
		expect(feedbackCommentMigration).toContain("jsonb_array_length(p_feedback -> 'priorityFeedback') not between 1 and 5");
		expect(feedbackCommentMigration).toContain('feedback must contain between 1 and 5 comments');
		expect(feedbackCommentMigration).toContain('from public, anon, authenticated');
	});
});
