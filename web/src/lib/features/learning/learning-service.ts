import type { FeedbackResult } from '$lib/types/contracts';
import { SKILL_KEYS, type PracticeTask, type ProblemFeatureSignature, type SkillKey } from '$lib/types/curriculum';
import type { Json } from '$lib/types/database';
import type { DraftRecord, LearnerSkillStat, LearningProgress, LocalLearningState, ProblemHistoryRecord, SubmissionRecord } from '$lib/types/learning';
import { emptyLearningState, loadLearningState as loadLocalLearningState, recordProblemIssued as recordLocalProblemIssued, recordSubmission as recordLocalSubmission, saveCurrentStage as saveLocalCurrentStage, saveDraft as saveLocalDraft, saveRequiredConsecutivePasses as saveLocalRequiredPasses } from './local-store';
import { isValidRequiredPasses } from './progression';
import { requireSupabase } from '$lib/services/supabase';
import type { AuthState } from '$lib/features/auth/auth-state';
import { isProblemFeatureSignature, promptHash } from './problem-generator';
import { skillStatKey } from './learning-design';

export type LearningScope = { mode: 'local' } | { mode: 'cloud'; userId: string };
type SubmissionInput = { requestId: string; taskId: string; stageId: number; taskTitle: string; text: string; feedback: FeedbackResult };

export function learningScopeForAuth(state: AuthState): LearningScope | null {
	if (state.status === 'local') return { mode: 'local' };
	if (state.status === 'signed-in' || state.status === 'recovery') return { mode: 'cloud', userId: state.user.id };
	return null;
}

function isString(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0;
}

function parseProblemFeatures(value: unknown): ProblemFeatureSignature {
	if (!isProblemFeatureSignature(value)) throw new Error('保存された問題特徴署名の形式が正しくありません。');
	return value;
}

export function parseFeedback(value: unknown): FeedbackResult {
	if (!value || typeof value !== 'object') throw new Error('保存された添削結果の形式が正しくありません。');
	const feedback = value as Record<string, unknown>;
	if (!isString(feedback.schemaVersion)) throw new Error('添削結果のschemaVersionがありません。');
	if (!['clean', 'minor_issue', 'revision_required'].includes(String(feedback.languageStatus))) throw new Error('添削結果のlanguageStatusが不正です。');
	if (!['pass', 'revise'].includes(String(feedback.decision))) throw new Error('添削結果のdecisionが不正です。');
	if (!Array.isArray(feedback.priorityFeedback) || !feedback.priorityFeedback.every((item) => {
		return Boolean(item && typeof item === 'object' && isString((item as Record<string, unknown>).title) && isString((item as Record<string, unknown>).guidance));
	})) throw new Error('添削結果のpriorityFeedbackが不正です。');
	if (feedback.languageStatus === 'revision_required' && feedback.decision !== 'revise') throw new Error('添削結果の判定が矛盾しています。');
	const skillResults = feedback.skillResults === undefined ? [] : feedback.skillResults;
	if (!Array.isArray(skillResults) || skillResults.length > 8 || !skillResults.every((item) => Boolean(item && typeof item === 'object'
		&& isString((item as Record<string, unknown>).skillKey)
		&& (SKILL_KEYS as readonly string[]).includes(String((item as Record<string, unknown>).skillKey))
		&& ['achieved', 'partial', 'missed'].includes(String((item as Record<string, unknown>).outcome))
		&& [0, 1, 2].includes(Number((item as Record<string, unknown>).severity))
		&& isString((item as Record<string, unknown>).evidence)))) throw new Error('添削結果のskillResultsが不正です。');
	if (new Set((skillResults as Array<Record<string, unknown>>).map((item) => item.skillKey)).size !== skillResults.length) throw new Error('添削結果のskillResultsが重複しています。');
	return { ...(feedback as Omit<FeedbackResult, 'skillResults'>), skillResults: skillResults as FeedbackResult['skillResults'] };
}

export async function loadLearningState(scope: LearningScope): Promise<LocalLearningState> {
	if (scope.mode === 'local') return loadLocalLearningState();
	const client = requireSupabase();
	const [draftResult, submissionResult, feedbackResult, progressResult, historyResult, skillStatsResult, problemBankResult] = await Promise.all([
		client.from('drafts').select('task_key, body, updated_at').eq('learner_id', scope.userId).order('updated_at', { ascending: false }),
		client.from('submissions').select('id, task_key, stage_id, task_title, body, submitted_at').eq('learner_id', scope.userId).order('submitted_at', { ascending: false }),
		client.from('feedback_results').select('submission_id, result').eq('learner_id', scope.userId),
		client.from('learning_progress').select('current_stage_id, highest_unlocked_stage_id, consecutive_passes, required_consecutive_passes, completed_at').eq('learner_id', scope.userId).single(),
		client.from('problem_history').select('task_key, problem_id, stage_id, task_title, prompt, hint, feature_signature, prompt_hash, issued_at, submitted_at').eq('learner_id', scope.userId).order('issued_at', { ascending: false }),
		client.from('learner_skill_stats').select('stage_id, skill_key, attempts, achieved_count, partial_count, missed_count, mastery_score, last_outcome, last_practiced_at').eq('learner_id', scope.userId),
		client.from('problem_bank').select('id, task_key, stage_id, title, prompt, hint, feature_signature').eq('status', 'approved').order('created_at', { ascending: false }).limit(200)
	]);
	if (draftResult.error) throw draftResult.error;
	if (submissionResult.error) throw submissionResult.error;
	if (feedbackResult.error) throw feedbackResult.error;
	if (progressResult.error) throw progressResult.error;
	if (historyResult.error) throw historyResult.error;
	if (skillStatsResult.error) throw skillStatsResult.error;
	if (problemBankResult.error) throw problemBankResult.error;

	const drafts: Record<string, DraftRecord> = {};
	for (const draft of draftResult.data) drafts[draft.task_key] = { taskId: draft.task_key, text: draft.body, updatedAt: draft.updated_at };
	const feedbackBySubmission = new Map(feedbackResult.data.map((item) => [item.submission_id, parseFeedback(item.result)]));
	const submissions = submissionResult.data.flatMap((submission): SubmissionRecord[] => {
		const feedback = feedbackBySubmission.get(submission.id);
		return feedback ? [{ id: submission.id, taskId: submission.task_key, stageId: submission.stage_id, taskTitle: submission.task_title, text: submission.body, submittedAt: submission.submitted_at, feedback }] : [];
	});
	const problemHistory = historyResult.data.map((item): ProblemHistoryRecord => ({
		taskId: item.task_key, problemId: item.problem_id, stageId: item.stage_id, taskTitle: item.task_title, prompt: item.prompt, hint: item.hint,
		features: parseProblemFeatures(item.feature_signature), promptHash: item.prompt_hash || promptHash(item.prompt), issuedAt: item.issued_at, submittedAt: item.submitted_at,
	}));
	const skillStats: Record<string, LearnerSkillStat> = {};
	for (const item of skillStatsResult.data) {
		const stat: LearnerSkillStat = {
			stageId: item.stage_id, skillKey: item.skill_key as SkillKey, attempts: item.attempts,
			achievedCount: item.achieved_count, partialCount: item.partial_count, missedCount: item.missed_count,
			masteryScore: Number(item.mastery_score), lastOutcome: item.last_outcome as LearnerSkillStat['lastOutcome'], lastPracticedAt: item.last_practiced_at,
		};
		skillStats[skillStatKey(stat.stageId, stat.skillKey)] = stat;
	}
	const approvedProblems = problemBankResult.data.map((item): PracticeTask => {
		const features = parseProblemFeatures(item.feature_signature);
		return { id: item.task_key, problemId: item.id, stageId: item.stage_id, topicKey: features.topicKey, title: item.title, prompt: item.prompt, hint: item.hint, features };
	});
	return {
		version: 4,
		approvedProblems,
		drafts,
		submissions,
		problemHistory,
		skillStats,
		progress: {
			currentStageId: progressResult.data.current_stage_id,
			highestUnlockedStageId: progressResult.data.highest_unlocked_stage_id,
			consecutivePasses: progressResult.data.consecutive_passes,
			requiredConsecutivePasses: progressResult.data.required_consecutive_passes,
			courseCompletedAt: progressResult.data.completed_at,
		}
	};
}

export async function issueProblem(scope: LearningScope, task: PracticeTask): Promise<void> {
	if (!task.features) throw new Error('問題の特徴署名がありません。');
	if (scope.mode === 'local') { recordLocalProblemIssued(task); return; }
	const { error } = await requireSupabase().rpc('issue_problem', {
		p_task_key: task.id,
		p_stage_id: task.stageId,
		p_task_title: task.title,
		p_prompt: task.prompt,
		p_hint: task.hint,
		p_feature_signature: task.features as unknown as Json,
		p_prompt_hash: promptHash(task.prompt),
		p_problem_id: task.problemId ?? null,
	});
	if (error) throw error;
}

export async function saveDraft(scope: LearningScope, taskId: string, text: string): Promise<DraftRecord> {
	if (scope.mode === 'local') return saveLocalDraft(taskId, text).drafts[taskId];
	const { data, error } = await requireSupabase()
		.from('drafts')
		.upsert({ learner_id: scope.userId, task_key: taskId, body: text }, { onConflict: 'learner_id,task_key' })
		.select('task_key, body, updated_at')
		.single();
	if (error) throw error;
	return { taskId: data.task_key, text: data.body, updatedAt: data.updated_at };
}

function parseSubmission(value: Json): SubmissionRecord {
	if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('提出結果の形式が正しくありません。');
	const record = value as Record<string, Json | undefined>;
	if (!isString(record.id) || !isString(record.taskKey) || typeof record.stageId !== 'number' || !isString(record.taskTitle) || !isString(record.body) || !isString(record.submittedAt)) {
		throw new Error('提出結果の必須項目がありません。');
	}
	return { id: record.id, taskId: record.taskKey, stageId: record.stageId, taskTitle: record.taskTitle, text: record.body, submittedAt: record.submittedAt, feedback: parseFeedback(record.feedback) };
}

export async function submit(scope: LearningScope, input: SubmissionInput): Promise<SubmissionRecord> {
	if (scope.mode === 'local') return recordLocalSubmission(input);
	const { data, error } = await requireSupabase().rpc('submit_mock', {
		p_request_id: input.requestId,
		p_task_key: input.taskId,
		p_stage_id: input.stageId,
		p_task_title: input.taskTitle,
		p_body: input.text,
		p_feedback: input.feedback as unknown as Json
	});
	if (error) throw error;
	return parseSubmission(data);
}

export async function saveRequiredConsecutivePasses(scope: LearningScope, required: number): Promise<LearningProgress> {
	if (!isValidRequiredPasses(required)) throw new Error('連続合格回数は1〜10回で指定してください。');
	if (scope.mode === 'local') return saveLocalRequiredPasses(required);
	const { data, error } = await requireSupabase()
		.from('learning_progress')
		.update({ required_consecutive_passes: required })
		.eq('learner_id', scope.userId)
		.select('current_stage_id, highest_unlocked_stage_id, consecutive_passes, required_consecutive_passes, completed_at')
		.single();
	if (error) throw error;
	return {
		currentStageId: data.current_stage_id,
		highestUnlockedStageId: data.highest_unlocked_stage_id,
		consecutivePasses: data.consecutive_passes,
		requiredConsecutivePasses: data.required_consecutive_passes,
		courseCompletedAt: data.completed_at,
	};
}

export async function saveCurrentStage(scope: LearningScope, stageId: number): Promise<LearningProgress> {
	if (scope.mode === 'local') return saveLocalCurrentStage(stageId);
	const { data, error } = await requireSupabase().rpc('select_learning_stage', { p_stage_id: stageId });
	if (error) throw error;
	if (!data || Array.isArray(data) || typeof data !== 'object') throw new Error('段階変更結果が不正です。');
	const progress = data as Record<string, Json | undefined>;
	return {
		currentStageId: Number(progress.currentStageId),
		highestUnlockedStageId: Number(progress.highestUnlockedStageId),
		consecutivePasses: Number(progress.consecutivePasses),
		requiredConsecutivePasses: Number(progress.requiredConsecutivePasses),
		courseCompletedAt: typeof progress.courseCompletedAt === 'string' ? progress.courseCompletedAt : null,
	};
}

export function emptyRemoteState(): LocalLearningState {
	return emptyLearningState();
}
