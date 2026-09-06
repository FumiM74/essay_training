import type { FeedbackResult } from '$lib/types/contracts';
import { SKILL_KEYS, type PracticeTask, type ProblemFeatureSignature, type SkillKey } from '$lib/types/curriculum';
import type { Json } from '$lib/types/database';
import type { DraftRecord, LearnerSkillStat, LearningProgress, LocalLearningState, ProblemHistoryRecord, SubmissionRecord } from '$lib/types/learning';
import { emptyLearningState, loadLearningState as loadLocalLearningState, recordProblemIssued as recordLocalProblemIssued, recordSubmission as recordLocalSubmission, saveCurrentStage as saveLocalCurrentStage, saveDraft as saveLocalDraft, saveProgressionSettings as saveLocalProgressionSettings } from './local-store';
import { isLearningPhase, isValidRequiredPasses } from './progression';
import { requireSupabase } from '$lib/services/supabase';
import type { AuthState } from '$lib/features/auth/auth-state';
import { isProblemFeatureSignature, practiceTaskPromptHash, promptHash } from './problem-generator';
import { skillStatKey } from './learning-design';

export type LearningScope = { mode: 'local' } | { mode: 'cloud'; userId: string };
type SubmissionInput = { requestId: string; task: PracticeTask; text: string; feedback: FeedbackResult; basicAnswers?: Record<string, string> };

export type LearningLoadSection = 'drafts' | 'submissions' | 'feedback' | 'progress' | 'problem_history' | 'skill_stats' | 'problem_bank';

export class LearningStateLoadError extends Error {
	constructor(public readonly section: LearningLoadSection, public readonly code?: string) {
		super(`Failed to load ${section}`);
		this.name = 'LearningStateLoadError';
	}
}

export class ProblemIssueError extends Error {
	constructor(public readonly code?: string) {
		super('Failed to issue problem');
		this.name = 'ProblemIssueError';
	}
}

export function problemIssueError(error: unknown): ProblemIssueError {
	const code = databaseErrorCode(error);
	return new ProblemIssueError(code);
}

export function databaseErrorCode(error: unknown): string | undefined {
	if (!error || typeof error !== 'object' || !('code' in error) || typeof error.code !== 'string') return undefined;
	return /^[A-Z0-9_]{1,24}$/i.test(error.code) ? error.code : undefined;
}

export function submissionErrorMessage(error: unknown): string {
	const code = databaseErrorCode(error);
	if (code === 'feedback_budget_exceeded') return '本日のAI添削上限に達しました。提出内容は保存されていません。時間をおいて、もう一度お試しください。';
	if (code === 'feedback_in_progress') return '同じ解答の添削を処理中です。少し待ってから、もう一度お試しください。';
	if (code === 'provider_timeout' || code === 'provider_network_error' || code?.startsWith('provider_http_')) return 'Claudeの添削を受け取れませんでした。提出内容は保存されていません。解答を確認して、もう一度お試しください。';
	return `提出を保存できませんでした${code ? `（エラーコード: ${code}）` : ''}。接続を確認して、もう一度お試しください。`;
}

export function shouldReuseSubmissionRequest(error: unknown): boolean {
	const code = databaseErrorCode(error);
	return !code || code === 'feedback_function_error' || code === 'feedback_in_progress';
}

export function learningLoadErrorMessage(error: unknown): string {
	if (error instanceof ProblemIssueError) {
		const code = error.code ? `（エラーコード: ${error.code}）` : '';
		return `現在の問題を開始できませんでした${code}。もう一度読み込んでください。`;
	}
	if (!(error instanceof LearningStateLoadError)) return '学習データを読み込めませんでした。通信状態を確認して、もう一度お試しください。';
	const labels: Record<LearningLoadSection, string> = {
		drafts: '下書き', submissions: '提出履歴', feedback: '添削結果', progress: '学習進捗',
		problem_history: '問題履歴', skill_stats: '学習状況', problem_bank: '問題データ',
	};
	const code = error.code ? `（エラーコード: ${error.code}）` : '';
	return `${labels[error.section]}を読み込めませんでした${code}。もう一度読み込んでください。`;
}

function requireQueryData<T>(section: LearningLoadSection, result: { data: T | null; error: { code?: string } | null }): T {
	if (result.error || result.data === null) throw new LearningStateLoadError(section, result.error?.code);
	return result.data;
}

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
	if (feedback.basicQuestionResults !== undefined && (!Array.isArray(feedback.basicQuestionResults)
		|| feedback.basicQuestionResults.length === 0 || feedback.basicQuestionResults.length > 5
		|| !feedback.basicQuestionResults.every((item) => Boolean(item && typeof item === 'object'
			&& isString((item as Record<string, unknown>).questionId)
			&& isString((item as Record<string, unknown>).instruction)
			&& isString((item as Record<string, unknown>).prompt)
			&& typeof (item as Record<string, unknown>).answer === 'string'
			&& typeof (item as Record<string, unknown>).correct === 'boolean'
			&& isString((item as Record<string, unknown>).answerLabel)
			&& isString((item as Record<string, unknown>).explanation))))) {
		throw new Error('添削結果のbasicQuestionResultsが不正です。');
	}
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
		client.from('submissions').select('id, task_key, stage_id, task_title, body, learning_phase, submitted_at').eq('learner_id', scope.userId).order('submitted_at', { ascending: false }),
		client.from('feedback_results').select('submission_id, result').eq('learner_id', scope.userId),
		client.from('learning_progress').select('current_stage_id, highest_unlocked_stage_id, learning_phase, phase_passes, phase_attempts, required_training_passes, promotion_test_question_count, required_retraining_passes, completed_at').eq('learner_id', scope.userId).single(),
		client.from('problem_history').select('task_key, problem_id, stage_id, task_title, prompt, hint, feature_signature, prompt_hash, learning_phase, issued_at, submitted_at').eq('learner_id', scope.userId).order('issued_at', { ascending: false }),
		client.from('learner_skill_stats').select('stage_id, skill_key, attempts, achieved_count, partial_count, missed_count, mastery_score, last_outcome, last_practiced_at').eq('learner_id', scope.userId),
		client.from('problem_bank').select('id, task_key, stage_id, title, prompt, hint, feature_signature').eq('status', 'approved').order('created_at', { ascending: false }).limit(200)
	]);
	const draftRows = requireQueryData('drafts', draftResult);
	const submissionRows = requireQueryData('submissions', submissionResult);
	const feedbackRows = requireQueryData('feedback', feedbackResult);
	const progressRow = requireQueryData('progress', progressResult);
	const historyRows = requireQueryData('problem_history', historyResult);
	const skillStatRows = requireQueryData('skill_stats', skillStatsResult);
	const problemBankRows = requireQueryData('problem_bank', problemBankResult);

	const drafts: Record<string, DraftRecord> = {};
	for (const draft of draftRows) drafts[draft.task_key] = { taskId: draft.task_key, text: draft.body, updatedAt: draft.updated_at };
	const feedbackBySubmission = new Map(feedbackRows.map((item) => [item.submission_id, parseFeedback(item.result)]));
	const submissions = submissionRows.flatMap((submission): SubmissionRecord[] => {
		const feedback = feedbackBySubmission.get(submission.id);
		return feedback ? [{ id: submission.id, taskId: submission.task_key, stageId: submission.stage_id, taskTitle: submission.task_title, text: submission.body, submittedAt: submission.submitted_at, feedback, phase: isLearningPhase(submission.learning_phase) ? submission.learning_phase : 'training' }] : [];
	});
	const problemHistory = historyRows.map((item): ProblemHistoryRecord => ({
		taskId: item.task_key, problemId: item.problem_id, stageId: item.stage_id, taskTitle: item.task_title, prompt: item.prompt, hint: item.hint,
		features: parseProblemFeatures(item.feature_signature), promptHash: item.prompt_hash || promptHash(item.prompt), issuedAt: item.issued_at, submittedAt: item.submitted_at,
		phase: isLearningPhase(item.learning_phase) ? item.learning_phase : 'training',
	}));
	const skillStats: Record<string, LearnerSkillStat> = {};
	for (const item of skillStatRows) {
		const stat: LearnerSkillStat = {
			stageId: item.stage_id, skillKey: item.skill_key as SkillKey, attempts: item.attempts,
			achievedCount: item.achieved_count, partialCount: item.partial_count, missedCount: item.missed_count,
			masteryScore: Number(item.mastery_score), lastOutcome: item.last_outcome as LearnerSkillStat['lastOutcome'], lastPracticedAt: item.last_practiced_at,
		};
		skillStats[skillStatKey(stat.stageId, stat.skillKey)] = stat;
	}
	const approvedProblems = problemBankRows.map((item): PracticeTask => {
		const features = parseProblemFeatures(item.feature_signature);
		return { id: item.task_key, problemId: item.id, stageId: item.stage_id, topicKey: features.topicKey, title: item.title, prompt: item.prompt, hint: item.hint, features };
	});
	return {
		version: 5,
		approvedProblems,
		drafts,
		submissions,
		problemHistory,
		skillStats,
		progress: {
			currentStageId: progressRow.current_stage_id,
			highestUnlockedStageId: progressRow.highest_unlocked_stage_id,
			phase: isLearningPhase(progressRow.learning_phase) ? progressRow.learning_phase : 'training',
			phasePasses: progressRow.phase_passes,
			phaseAttempts: progressRow.phase_attempts,
			requiredTrainingPasses: progressRow.required_training_passes,
			promotionTestQuestionCount: progressRow.promotion_test_question_count,
			requiredRetrainingPasses: progressRow.required_retraining_passes,
			courseCompletedAt: progressRow.completed_at,
		}
	};
}

const problemIssueRequests = new Map<string, Promise<void>>();

export async function issueProblem(scope: LearningScope, task: PracticeTask): Promise<void> {
	if (!task.features) throw new Error('問題の特徴署名がありません。');
	const requestKey = scope.mode === 'cloud' ? `${scope.userId}:${task.stageId}` : `local:${task.stageId}`;
	const existing = problemIssueRequests.get(requestKey);
	if (existing) return existing;
	const request = (async () => {
		if (scope.mode === 'local') { recordLocalProblemIssued(task); return; }
		const { error } = await requireSupabase().rpc('issue_problem', {
			p_task_key: task.id,
			p_stage_id: task.stageId,
			p_task_title: task.title,
			p_prompt: task.prompt,
			p_hint: task.hint,
			p_feature_signature: task.features as unknown as Json,
			p_prompt_hash: practiceTaskPromptHash(task),
			p_problem_id: task.problemId ?? null,
		});
		if (error) throw error;
	})().finally(() => {
		if (problemIssueRequests.get(requestKey) === request) problemIssueRequests.delete(requestKey);
	});
	problemIssueRequests.set(requestKey, request);
	return request;
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
	return { id: record.id, taskId: record.taskKey, stageId: record.stageId, taskTitle: record.taskTitle, text: record.body, submittedAt: record.submittedAt, feedback: parseFeedback(record.feedback), phase: isLearningPhase(record.learningPhase) ? record.learningPhase : 'training' };
}

export async function submit(scope: LearningScope, input: SubmissionInput): Promise<SubmissionRecord> {
	if (scope.mode === 'local') return recordLocalSubmission({
		requestId: input.requestId, taskId: input.task.id, stageId: input.task.stageId,
		taskTitle: input.task.title, text: input.text, feedback: input.feedback,
	});
	const basicQuestions = input.task.questionSet?.map((question) => ({
		id: question.id,
		category: question.category,
		instruction: question.instruction,
		prompt: question.prompt,
		choices: question.choices,
		answer: input.basicAnswers?.[question.id] ?? '',
	}));
	const { data, error } = await requireSupabase().functions.invoke('feedback', {
		body: {
			requestId: input.requestId,
			taskId: input.task.id,
			stageId: input.task.stageId,
			answer: input.text,
			...(basicQuestions ? { basicQuestions } : {}),
		},
	});
	if (error) {
		let code = 'feedback_function_error';
		const context = (error as { context?: { json?: () => Promise<unknown> } }).context;
		if (context?.json) {
			const body = await context.json().catch(() => null) as { error?: unknown } | null;
			if (typeof body?.error === 'string') code = body.error;
		}
		const failure = new Error(code) as Error & { code: string };
		failure.code = code;
		throw failure;
	}
	if (!data || typeof data !== 'object' || !('submission' in data)) throw new Error('Claude添削結果の応答形式が正しくありません。');
	return parseSubmission((data as { submission: Json }).submission);
}

export async function saveProgressionSettings(scope: LearningScope, settings: Pick<LearningProgress, 'requiredTrainingPasses' | 'promotionTestQuestionCount' | 'requiredRetrainingPasses'>): Promise<LearningProgress> {
	if (!Object.values(settings).every(isValidRequiredPasses)) throw new Error('各回数は1〜10回で指定してください。');
	if (scope.mode === 'local') return saveLocalProgressionSettings(settings);
	const { data, error } = await requireSupabase()
		.from('learning_progress')
		.update({ required_training_passes: settings.requiredTrainingPasses, promotion_test_question_count: settings.promotionTestQuestionCount, required_retraining_passes: settings.requiredRetrainingPasses })
		.eq('learner_id', scope.userId)
		.select('current_stage_id, highest_unlocked_stage_id, learning_phase, phase_passes, phase_attempts, required_training_passes, promotion_test_question_count, required_retraining_passes, completed_at')
		.single();
	if (error) throw error;
	return {
		currentStageId: data.current_stage_id,
		highestUnlockedStageId: data.highest_unlocked_stage_id,
		phase: isLearningPhase(data.learning_phase) ? data.learning_phase : 'training',
		phasePasses: data.phase_passes,
		phaseAttempts: data.phase_attempts,
		requiredTrainingPasses: data.required_training_passes,
		promotionTestQuestionCount: data.promotion_test_question_count,
		requiredRetrainingPasses: data.required_retraining_passes,
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
		phase: isLearningPhase(progress.phase) ? progress.phase : 'training',
		phasePasses: Number(progress.phasePasses),
		phaseAttempts: Number(progress.phaseAttempts),
		requiredTrainingPasses: Number(progress.requiredTrainingPasses),
		promotionTestQuestionCount: Number(progress.promotionTestQuestionCount),
		requiredRetrainingPasses: Number(progress.requiredRetrainingPasses),
		courseCompletedAt: typeof progress.courseCompletedAt === 'string' ? progress.courseCompletedAt : null,
	};
}

export function emptyRemoteState(): LocalLearningState {
	return emptyLearningState();
}
