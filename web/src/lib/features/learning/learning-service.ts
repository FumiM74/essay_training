import type { FeedbackResult } from '$lib/types/contracts';
import { SKILL_KEYS, type PracticeTask, type ProblemFeatureSignature, type SkillKey } from '$lib/types/curriculum';
import type { Database, Json } from '$lib/types/database';
import type { DraftRecord, LearnerSkillStat, LearningProgress, LocalLearningState, ProblemHistoryRecord, SubmissionRecord, TrialOutcome } from '$lib/types/learning';
import { emptyLearningState, loadLearningState as loadLocalLearningState, recordProblemIssued as recordLocalProblemIssued, recordSubmission as recordLocalSubmission, saveCurrentStage as saveLocalCurrentStage, saveDraft as saveLocalDraft, saveFeedbackPreference as saveLocalFeedbackPreference, saveProgressionSettings as saveLocalProgressionSettings, saveTopicPreference as saveLocalTopicPreference } from './local-store';
import { isLearningPhase, isValidRequiredPasses } from './progression';
import { requireSupabase } from '$lib/services/supabase';
import type { AuthState } from '$lib/features/auth/auth-state';
import { createProblemSpecification, isProblemFeatureSignature, practiceTaskPromptHash, promptHash, questionSetFromGenerationContract } from './problem-generator';
import { skillStatKey } from './learning-design';
import { isTopicSelectionMode, normalizeCustomTopics } from './topic-preferences';

export type LearningScope = { mode: 'local' } | { mode: 'cloud'; userId: string };
type SubmissionInput = {
	requestId: string;
	task: PracticeTask;
	text: string;
	feedback: FeedbackResult;
	basicAnswers?: Record<string, string>;
};
const PROGRESS_SELECT = 'current_stage_id, highest_unlocked_stage_id, learning_phase, phase_passes, phase_attempts, frontier_learning_phase, frontier_phase_passes, frontier_phase_attempts, required_training_passes, promotion_test_question_count, required_retraining_passes, easy_feedback_enabled, topic_selection_mode, custom_topics, completed_at';

type ProgressRow = Pick<Database['public']['Tables']['learning_progress']['Row'],
	'current_stage_id' | 'highest_unlocked_stage_id' | 'learning_phase' | 'phase_passes' | 'phase_attempts' |
	'frontier_learning_phase' | 'frontier_phase_passes' | 'frontier_phase_attempts' | 'required_training_passes' |
	'promotion_test_question_count' | 'required_retraining_passes' | 'easy_feedback_enabled' |
	'topic_selection_mode' | 'custom_topics' | 'completed_at'>;

function progressFromRow(row: ProgressRow): LearningProgress {
	return {
		currentStageId: row.current_stage_id, highestUnlockedStageId: row.highest_unlocked_stage_id,
		phase: isLearningPhase(row.learning_phase) ? row.learning_phase : 'training', phasePasses: row.phase_passes, phaseAttempts: row.phase_attempts,
		frontierPhase: isLearningPhase(row.frontier_learning_phase) ? row.frontier_learning_phase : 'training', frontierPhasePasses: row.frontier_phase_passes, frontierPhaseAttempts: row.frontier_phase_attempts,
		requiredTrainingPasses: row.required_training_passes, promotionTestQuestionCount: row.promotion_test_question_count, requiredRetrainingPasses: row.required_retraining_passes,
		easyFeedbackEnabled: row.easy_feedback_enabled,
		topicSelectionMode: isTopicSelectionMode(row.topic_selection_mode) ? row.topic_selection_mode : 'random',
		customTopics: normalizeCustomTopics(row.custom_topics ?? []),
		courseCompletedAt: row.completed_at,
	};
}

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
	return /^[A-Z0-9_]{1,80}$/i.test(error.code) ? error.code : undefined;
}

function feedbackErrorReason(error: unknown): string | undefined {
	if (!error || typeof error !== 'object' || !('reason' in error) || typeof error.reason !== 'string') return undefined;
	return /^[A-Z0-9_]{1,80}$/i.test(error.reason) ? error.reason : undefined;
}

export function submissionErrorMessage(error: unknown): string {
	const code = databaseErrorCode(error);
	const reason = feedbackErrorReason(error);
	if (code === 'request_input_limit' || (code === 'feedback_budget_exceeded' && reason === 'request_input_limit')) return 'Claude添削への入力が暫定上限を超えました。提出内容は保存されていません。この問題は運営側で上限の再調整が必要です。';
	if (code === 'feedback_budget_exceeded' && reason === 'request_output_limit') return 'Claude添削の出力上限設定に問題があります。提出内容は保存されていません。運営側で設定の修正が必要です。';
	if (code === 'feedback_budget_exceeded' && reason === 'disabled') return 'Claude添削は現在停止しています。提出内容は保存されていません。時間をおいて、もう一度お試しください。';
	if (code === 'feedback_budget_exceeded') return '本日のAI添削上限に達しました。提出内容は保存されていません。時間をおいて、もう一度お試しください。';
	if (code === 'feedback_preference_unavailable') return '解説の設定を確認できませんでした。提出内容は保存されていません。もう一度お試しください。';
	if (code === 'revision_context_unavailable') return '前回の添削結果を確認できませんでした。提出内容は保存されていません。もう一度お試しください。';
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
	if (!Array.isArray(feedback.priorityFeedback) || feedback.priorityFeedback.length < 1 || feedback.priorityFeedback.length > 5 || !feedback.priorityFeedback.every((item) => {
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

export function parseTrialOutcome(value: unknown): TrialOutcome | undefined {
	if (value === null || value === undefined) return undefined;
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('生成問題の試用結果が不正です。');
	const outcome = value as Record<string, unknown>;
	if (!['active', 'approved', 'private_verified', 'disqualified'].includes(String(outcome.status))
		|| !Number.isInteger(outcome.revisionCount) || Number(outcome.revisionCount) < 0 || Number(outcome.revisionCount) > 5
		|| outcome.maxRevisionCount !== 5) throw new Error('生成問題の試用結果が不正です。');
	if (outcome.modelAnswers !== undefined && (!Array.isArray(outcome.modelAnswers) || !outcome.modelAnswers.every((item) => {
		return Boolean(item && typeof item === 'object' && isString((item as Record<string, unknown>).label)
			&& isString((item as Record<string, unknown>).answer) && isString((item as Record<string, unknown>).explanation));
	}))) throw new Error('生成問題の模範解答が不正です。');
	return outcome as unknown as TrialOutcome;
}

export async function loadLearningState(scope: LearningScope): Promise<LocalLearningState> {
	if (scope.mode === 'local') return loadLocalLearningState();
	const client = requireSupabase();
	const [draftResult, submissionResult, feedbackResult, progressResult, historyResult, skillStatsResult, problemBankResult] = await Promise.all([
		client.from('drafts').select('task_key, body, updated_at').eq('learner_id', scope.userId).order('updated_at', { ascending: false }),
		client.from('submissions').select('id, task_key, stage_id, task_title, body, learning_phase, trial_resolution, submitted_at').eq('learner_id', scope.userId).order('submitted_at', { ascending: false }),
		client.from('feedback_results').select('submission_id, result').eq('learner_id', scope.userId),
		client.from('learning_progress').select(PROGRESS_SELECT).eq('learner_id', scope.userId).single(),
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
		const trialOutcome = parseTrialOutcome(submission.trial_resolution);
		return feedback ? [{ id: submission.id, taskId: submission.task_key, stageId: submission.stage_id, taskTitle: submission.task_title, text: submission.body, submittedAt: submission.submitted_at, feedback, phase: isLearningPhase(submission.learning_phase) ? submission.learning_phase : 'training', ...(trialOutcome ? { trialOutcome } : {}) }] : [];
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
		return { id: item.task_key, problemId: item.id, stageId: item.stage_id, topicKey: features.topicKey, title: item.title, prompt: item.prompt, hint: item.hint, questionSet: questionSetFromGenerationContract(features), features };
	});
	return {
		version: 5,
		approvedProblems,
		drafts,
		submissions,
		problemHistory,
		skillStats,
		progress: progressFromRow(progressRow)
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

const problemProvisionRequests = new Map<string, Promise<PracticeTask>>();

async function stableProblemGenerationRequestId(userId: string, taskId: string): Promise<string> {
	const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${userId}:${taskId}`))).slice(0, 16);
	digest[6] = (digest[6] & 0x0f) | 0x50;
	digest[8] = (digest[8] & 0x3f) | 0x80;
	const hex = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function provisionProblemOnce(scope: LearningScope, task: PracticeTask, history: ProblemHistoryRecord[]): Promise<PracticeTask> {
	if (!task.features) throw new Error('問題の特徴署名がありません。');
	if (scope.mode === 'local' || task.problemId || task.features.generation.source === 'curated' || task.features.generation.source === 'ai') {
		await issueProblem(scope, task);
		return task;
	}
	const specification = createProblemSpecification(task.stageId, task.features.seed, {
		selectionReason: task.features.selectionReason,
		targetSkill: task.features.skillTargets[0],
		customTopic: task.features.customTopic,
		avoidFingerprints: history.filter((item) => item.stageId === task.stageId).slice(0, 12).map((item) => item.features.fingerprint),
	});
	const { data, error } = await requireSupabase().functions.invoke('problem-generation', {
		body: {
			requestId: await stableProblemGenerationRequestId(scope.userId, task.id),
			taskId: task.id,
			stageId: task.stageId,
			featureSignature: task.features as unknown as Json,
			specification,
		},
	});
	if (error) {
		if (task.features.customTopic) throw error;
		// A temporary AI or budget failure must not stop learning. The already
		// reviewed local variant remains available and is recorded normally.
		console.warn('Claude問題生成を利用できなかったため、ローカル問題を使用します。', error);
		await issueProblem(scope, task);
		return task;
	}
	if (!data || typeof data !== 'object' || !('problem' in data) || !data.problem || typeof data.problem !== 'object') {
		throw new Error('問題生成結果の応答形式が正しくありません。');
	}
	const raw = data.problem as Record<string, unknown>;
	const features = raw.featureSignature;
	if (!isString(raw.id) || !isString(raw.problemId) || Number(raw.stageId) !== task.stageId
		|| !isString(raw.title) || !isString(raw.prompt) || !isString(raw.hint) || !isProblemFeatureSignature(features)) {
		throw new Error('問題生成結果の必須項目がありません。');
	}
	return {
		id: raw.id,
		problemId: raw.problemId,
		stageId: Number(raw.stageId),
		topicKey: features.topicKey,
		title: raw.title,
		prompt: raw.prompt,
		hint: raw.hint,
		questionSet: questionSetFromGenerationContract(features),
		features,
	};
}

export async function provisionProblem(scope: LearningScope, task: PracticeTask, history: ProblemHistoryRecord[]): Promise<PracticeTask> {
	const requestKey = scope.mode === 'cloud' ? `${scope.userId}:${task.stageId}` : `local:${task.stageId}`;
	const existing = problemProvisionRequests.get(requestKey);
	if (existing) return existing;
	const request = provisionProblemOnce(scope, task, history).finally(() => {
		if (problemProvisionRequests.get(requestKey) === request) problemProvisionRequests.delete(requestKey);
	});
	problemProvisionRequests.set(requestKey, request);
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
	const trialOutcome = parseTrialOutcome(record.trialOutcome);
	return { id: record.id, taskId: record.taskKey, stageId: record.stageId, taskTitle: record.taskTitle, text: record.body, submittedAt: record.submittedAt, feedback: parseFeedback(record.feedback), phase: isLearningPhase(record.learningPhase) ? record.learningPhase : 'training', ...(trialOutcome ? { trialOutcome } : {}) };
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
		learnerAnswer: input.basicAnswers?.[question.id] ?? '',
		referenceAnswers: question.acceptedAnswers,
		referenceAnswerLabel: question.answerLabel,
		gradingPoint: question.explanation,
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
		let reason: string | undefined;
		const context = (error as { context?: { json?: () => Promise<unknown> } }).context;
		if (context?.json) {
			const body = await context.json().catch(() => null) as { error?: unknown; reason?: unknown } | null;
			if (typeof body?.error === 'string') code = body.error;
			if (typeof body?.reason === 'string') reason = body.reason;
		}
		const failure = new Error(code) as Error & { code: string; reason?: string };
		failure.code = code;
		if (reason) failure.reason = reason;
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
		.select(PROGRESS_SELECT)
		.single();
	if (error) throw error;
	return progressFromRow(data);
}

export async function saveFeedbackPreference(scope: LearningScope, enabled: boolean): Promise<LearningProgress> {
	if (scope.mode === 'local') return saveLocalFeedbackPreference(enabled);
	const { data, error } = await requireSupabase().from('learning_progress')
		.update({ easy_feedback_enabled: enabled }).eq('learner_id', scope.userId)
		.select(PROGRESS_SELECT).single();
	if (error) throw error;
	return progressFromRow(data);
}

export async function saveTopicPreference(scope: LearningScope, mode: LearningProgress['topicSelectionMode'], topics: string[]): Promise<LearningProgress> {
	const customTopics = normalizeCustomTopics(topics);
	if (!isTopicSelectionMode(mode) || (mode === 'custom' && customTopics.length === 0)) throw new Error('自由設定ではテーマを1つ以上入力してください。');
	if (scope.mode === 'local') return saveLocalTopicPreference(mode, customTopics);
	const { data, error } = await requireSupabase().from('learning_progress')
		.update({ topic_selection_mode: mode, custom_topics: customTopics }).eq('learner_id', scope.userId)
		.select(PROGRESS_SELECT).single();
	if (error) throw error;
	return progressFromRow(data);
}

export async function saveCurrentStage(scope: LearningScope, stageId: number): Promise<LearningProgress> {
	if (scope.mode === 'local') return saveLocalCurrentStage(stageId);
	const { data, error } = await requireSupabase().rpc('select_learning_stage', { p_stage_id: stageId });
	if (error) throw error;
	if (!data || Array.isArray(data) || typeof data !== 'object') throw new Error('段階変更結果が不正です。');
	const { data: preference, error: preferenceError } = await requireSupabase().from('learning_progress')
		.select('easy_feedback_enabled, topic_selection_mode, custom_topics').eq('learner_id', scope.userId).single();
	if (preferenceError) throw preferenceError;
	const progress = data as Record<string, Json | undefined>;
	return {
		currentStageId: Number(progress.currentStageId),
		highestUnlockedStageId: Number(progress.highestUnlockedStageId),
		phase: isLearningPhase(progress.phase) ? progress.phase : 'training',
		phasePasses: Number(progress.phasePasses),
		phaseAttempts: Number(progress.phaseAttempts),
		frontierPhase: isLearningPhase(progress.frontierPhase) ? progress.frontierPhase : 'training',
		frontierPhasePasses: Number(progress.frontierPhasePasses),
		frontierPhaseAttempts: Number(progress.frontierPhaseAttempts),
		requiredTrainingPasses: Number(progress.requiredTrainingPasses),
		promotionTestQuestionCount: Number(progress.promotionTestQuestionCount),
		requiredRetrainingPasses: Number(progress.requiredRetrainingPasses),
		easyFeedbackEnabled: preference.easy_feedback_enabled,
		topicSelectionMode: isTopicSelectionMode(preference.topic_selection_mode) ? preference.topic_selection_mode : 'random',
		customTopics: normalizeCustomTopics(preference.custom_topics ?? []),
		courseCompletedAt: typeof progress.courseCompletedAt === 'string' ? progress.courseCompletedAt : null,
	};
}

export function emptyRemoteState(): LocalLearningState {
	return emptyLearningState();
}
