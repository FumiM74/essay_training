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
].map((file) => readFileSync(resolve(process.cwd(), `../supabase/migrations/${file}`), 'utf8')).join('\n');
const rlsTest = readFileSync(resolve(process.cwd(), '../supabase/tests/learner_data_rls.sql'), 'utf8');
const stageSwitchMigration = readFileSync(
	resolve(process.cwd(), '../supabase/migrations/202609060003_allow_stage_switch_with_open_problem.sql'),
	'utf8',
);

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
});
