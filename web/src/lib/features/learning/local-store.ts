import { browser } from '$app/environment';
import type { FeedbackResult } from '$lib/types/contracts';
import { MAX_STAGE_ID, type PracticeTask } from '$lib/types/curriculum';
import type { LearningProgress, LocalLearningState, ProblemHistoryRecord, SubmissionRecord } from '$lib/types/learning';
import { createProblemFeatures, isProblemFeatureSignature, practiceTaskPromptHash, promptHash, resolvePracticeTask } from './problem-generator';
import { applySubmissionToProgress, defaultLearningProgress, deriveProgress, isLearningPhase, isValidRequiredPasses, selectLearningStage } from './progression';
import { isLearnerSkillStats, updateSkillStats } from './mastery';
import { isTopicSelectionMode, normalizeCustomTopics } from './topic-preferences';

const STORAGE_KEY = 'essay-training-local-state-v5';
const VERSION_4_STORAGE_KEY = 'essay-training-local-state-v4';
const VERSION_3_STORAGE_KEY = 'essay-training-local-state-v3';
const VERSION_2_STORAGE_KEY = 'essay-training-local-state-v2';
const LEGACY_STORAGE_KEY = 'essay-training-local-state-v1';
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export function emptyLearningState(): LocalLearningState {
	return { version: 5, drafts: {}, submissions: [], problemHistory: [], skillStats: {}, progress: defaultLearningProgress() };
}

function storageOrNull(storage?: StorageLike | null): StorageLike | null {
	if (storage !== undefined) return storage;
	return browser ? window.localStorage : null;
}

function validProgress(value: unknown): value is LearningProgress {
	if (!value || typeof value !== 'object') return false;
	const progress = value as Partial<LearningProgress>;
	return Number.isInteger(progress.currentStageId) && Number(progress.currentStageId) >= 1 && Number(progress.currentStageId) <= MAX_STAGE_ID
		&& Number.isInteger(progress.highestUnlockedStageId) && Number(progress.highestUnlockedStageId) >= Number(progress.currentStageId) && Number(progress.highestUnlockedStageId) <= MAX_STAGE_ID
		&& isLearningPhase(progress.phase)
		&& Number.isInteger(progress.phasePasses) && Number(progress.phasePasses) >= 0
		&& Number.isInteger(progress.phaseAttempts) && Number(progress.phaseAttempts) >= 0
		&& isLearningPhase(progress.frontierPhase)
		&& Number.isInteger(progress.frontierPhasePasses) && Number(progress.frontierPhasePasses) >= 0
		&& Number.isInteger(progress.frontierPhaseAttempts) && Number(progress.frontierPhaseAttempts) >= 0
		&& isValidRequiredPasses(Number(progress.requiredTrainingPasses))
		&& isValidRequiredPasses(Number(progress.promotionTestQuestionCount))
		&& isValidRequiredPasses(Number(progress.requiredRetrainingPasses))
		&& typeof progress.easyFeedbackEnabled === 'boolean'
		&& isTopicSelectionMode(progress.topicSelectionMode)
		&& Array.isArray(progress.customTopics)
		&& (() => { try { return normalizeCustomTopics(progress.customTopics).length === progress.customTopics.length; } catch { return false; } })()
		&& (progress.topicSelectionMode === 'random' || progress.customTopics.length > 0)
		&& (progress.courseCompletedAt === null || typeof progress.courseCompletedAt === 'string');
}

function stableSeed(value: string): number {
	let hash = 0;
	for (const character of value) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
	return hash;
}

function historyFromSubmissions(submissions: SubmissionRecord[]): ProblemHistoryRecord[] {
	return submissions.map((submission) => {
		const task = resolvePracticeTask(submission.taskId);
		return {
			taskId: submission.taskId,
			problemId: task?.problemId ?? null,
			stageId: submission.stageId,
			taskTitle: submission.taskTitle,
			prompt: task?.prompt ?? submission.taskTitle,
			hint: task?.hint ?? '合格条件を確認して書きましょう。',
			features: task?.features ?? createProblemFeatures(submission.stageId, stableSeed(submission.taskId)),
			promptHash: promptHash(task?.prompt ?? submission.taskTitle),
			issuedAt: submission.submittedAt,
			submittedAt: submission.submittedAt,
			phase: submission.phase ?? 'training',
		};
	});
}

function migrateProgress(progress: unknown, submissions: SubmissionRecord[]): LearningProgress {
	if (progress && typeof progress === 'object') {
		const old = progress as Partial<LearningProgress>;
		const currentStageId = Number(old.currentStageId);
		const storedHighest = Number(old.highestUnlockedStageId);
		const legacy = old as Partial<LearningProgress> & { requiredConsecutivePasses?: number; consecutivePasses?: number };
		const required = Number(legacy.requiredTrainingPasses ?? legacy.requiredConsecutivePasses);
		const consecutive = Number(legacy.phasePasses ?? legacy.consecutivePasses);
		let customTopics: string[] = [];
		try { customTopics = Array.isArray(legacy.customTopics) ? normalizeCustomTopics(legacy.customTopics) : []; } catch { customTopics = []; }
		if (Number.isInteger(currentStageId) && currentStageId >= 1 && currentStageId <= MAX_STAGE_ID && isValidRequiredPasses(required) && Number.isInteger(consecutive) && consecutive >= 0) {
			const highestUnlockedStageId = old.courseCompletedAt
				? MAX_STAGE_ID
				: Number.isInteger(storedHighest) && storedHighest >= currentStageId && storedHighest <= MAX_STAGE_ID ? storedHighest : currentStageId;
			return {
				currentStageId,
				highestUnlockedStageId,
				phase: legacy.phase === 'retraining' ? 'promotion_test' : isLearningPhase(legacy.phase) ? legacy.phase : 'training',
				phasePasses: consecutive,
				phaseAttempts: Number.isInteger(legacy.phaseAttempts) ? Number(legacy.phaseAttempts) : 0,
				frontierPhase: isLearningPhase(legacy.frontierPhase) ? legacy.frontierPhase : legacy.phase === 'retraining' ? 'promotion_test' : isLearningPhase(legacy.phase) ? legacy.phase : 'training',
				frontierPhasePasses: Number.isInteger(legacy.frontierPhasePasses) ? Number(legacy.frontierPhasePasses) : consecutive,
				frontierPhaseAttempts: Number.isInteger(legacy.frontierPhaseAttempts) ? Number(legacy.frontierPhaseAttempts) : Number.isInteger(legacy.phaseAttempts) ? Number(legacy.phaseAttempts) : 0,
				requiredTrainingPasses: required,
				promotionTestQuestionCount: isValidRequiredPasses(Number(legacy.promotionTestQuestionCount)) ? Number(legacy.promotionTestQuestionCount) : 3,
				requiredRetrainingPasses: isValidRequiredPasses(Number(legacy.requiredRetrainingPasses)) ? Number(legacy.requiredRetrainingPasses) : 3,
				easyFeedbackEnabled: legacy.easyFeedbackEnabled === true,
				topicSelectionMode: legacy.topicSelectionMode === 'custom' && customTopics.length > 0 ? 'custom' : 'random',
				customTopics,
				courseCompletedAt: typeof old.courseCompletedAt === 'string' ? old.courseCompletedAt : null,
			};
		}
	}
	return deriveProgress(submissions);
}

function validProblemHistory(value: unknown): value is ProblemHistoryRecord[] {
	return Array.isArray(value) && value.every((item) => Boolean(item && typeof item === 'object'
		&& typeof (item as ProblemHistoryRecord).taskId === 'string'
		&& Number.isInteger((item as ProblemHistoryRecord).stageId) && (item as ProblemHistoryRecord).stageId >= 1 && (item as ProblemHistoryRecord).stageId <= MAX_STAGE_ID
		&& typeof (item as ProblemHistoryRecord).taskTitle === 'string'
		&& typeof (item as ProblemHistoryRecord).prompt === 'string'
		&& typeof (item as ProblemHistoryRecord).hint === 'string'
		&& isProblemFeatureSignature((item as ProblemHistoryRecord).features)
		&& typeof (item as ProblemHistoryRecord).promptHash === 'string'
		&& typeof (item as ProblemHistoryRecord).issuedAt === 'string'
		&& isLearningPhase((item as ProblemHistoryRecord).phase)
		&& ((item as ProblemHistoryRecord).submittedAt === null || typeof (item as ProblemHistoryRecord).submittedAt === 'string')));
}

function migrateProblemHistory(value: unknown, submissions: SubmissionRecord[]): ProblemHistoryRecord[] {
	if (!Array.isArray(value)) return historyFromSubmissions(submissions);
	const migrated = value.flatMap((item): ProblemHistoryRecord[] => {
		if (!item || typeof item !== 'object') return [];
		const old = item as Partial<ProblemHistoryRecord>;
		if (typeof old.taskId !== 'string' || !Number.isInteger(old.stageId) || Number(old.stageId) < 1 || Number(old.stageId) > MAX_STAGE_ID
			|| typeof old.taskTitle !== 'string' || typeof old.prompt !== 'string' || typeof old.hint !== 'string'
			|| typeof old.issuedAt !== 'string' || (old.submittedAt !== null && typeof old.submittedAt !== 'string')) return [];
		const task = resolvePracticeTask(old.taskId);
		return [{
			taskId: old.taskId,
			problemId: typeof old.problemId === 'string' ? old.problemId : task?.problemId ?? null,
			stageId: Number(old.stageId),
			taskTitle: old.taskTitle,
			prompt: old.prompt,
			hint: old.hint,
			features: isProblemFeatureSignature(old.features) ? old.features : task?.features ?? createProblemFeatures(Number(old.stageId), stableSeed(old.taskId)),
			promptHash: typeof old.promptHash === 'string' ? old.promptHash : promptHash(old.prompt),
			issuedAt: old.issuedAt,
			submittedAt: old.submittedAt ?? null,
			phase: isLearningPhase(old.phase) ? old.phase : 'training',
		}];
	});
	return migrated.length ? migrated : historyFromSubmissions(submissions);
}

function skillStatsFromSubmissions(submissions: SubmissionRecord[]) {
	let stats: LocalLearningState['skillStats'] = {};
	for (const submission of [...submissions].reverse()) {
		stats = updateSkillStats(stats, submission.stageId, submission.feedback.skillResults ?? [], submission.submittedAt);
	}
	return stats;
}

export function parseLearningState(raw: string | null): LocalLearningState {
	if (!raw) return emptyLearningState();
	try {
		const parsed = JSON.parse(raw) as { version?: number; drafts?: LocalLearningState['drafts']; submissions?: SubmissionRecord[]; problemHistory?: ProblemHistoryRecord[]; skillStats?: unknown; progress?: unknown };
		if (!parsed.drafts || typeof parsed.drafts !== 'object' || !Array.isArray(parsed.submissions)) return emptyLearningState();
		if (parsed.version === 5 && validProgress(parsed.progress)) {
			return { version: 5, drafts: parsed.drafts, submissions: parsed.submissions, problemHistory: validProblemHistory(parsed.problemHistory) ? parsed.problemHistory : migrateProblemHistory(parsed.problemHistory, parsed.submissions), skillStats: isLearnerSkillStats(parsed.skillStats) ? parsed.skillStats : skillStatsFromSubmissions(parsed.submissions), progress: parsed.progress.phase === 'retraining' ? { ...parsed.progress, phase: 'promotion_test', phasePasses: 0, phaseAttempts: 0 } : parsed.progress };
		}
		if ([1, 2, 3, 4, 5].includes(Number(parsed.version))) {
			const submissions = parsed.submissions.map((item) => ({ ...item, phase: isLearningPhase(item.phase) ? item.phase : 'training' }));
			return { version: 5, drafts: parsed.drafts, submissions, problemHistory: migrateProblemHistory(parsed.problemHistory, submissions), skillStats: skillStatsFromSubmissions(submissions), progress: migrateProgress(parsed.progress, submissions) };
		}
		return emptyLearningState();
	} catch {
		return emptyLearningState();
	}
}

export function loadLearningState(storage?: StorageLike | null): LocalLearningState {
	const target = storageOrNull(storage);
	if (!target) return emptyLearningState();
	return parseLearningState(target.getItem(STORAGE_KEY) ?? target.getItem(VERSION_4_STORAGE_KEY) ?? target.getItem(VERSION_3_STORAGE_KEY) ?? target.getItem(VERSION_2_STORAGE_KEY) ?? target.getItem(LEGACY_STORAGE_KEY));
}

export function recordProblemIssued(task: PracticeTask, storage?: StorageLike | null): ProblemHistoryRecord {
	if (!task.features) throw new Error('問題の特徴署名がありません。');
	const state = loadLearningState(storage);
	const existing = state.problemHistory.find((item) => item.taskId === task.id);
	if (existing) return existing;
	if (task.stageId !== state.progress.currentStageId) throw new Error('現在の段階以外の問題は開始できません。');
	const active = state.problemHistory.find((item) => item.stageId === task.stageId && item.submittedAt === null);
	if (active) return active;
	const record: ProblemHistoryRecord = { taskId: task.id, problemId: task.problemId ?? null, stageId: task.stageId, taskTitle: task.title, prompt: task.prompt, hint: task.hint, features: task.features, promptHash: practiceTaskPromptHash(task), issuedAt: new Date().toISOString(), submittedAt: null, phase: state.progress.phase };
	state.problemHistory.unshift(record);
	writeLearningState(state, storage);
	return record;
}

function writeLearningState(state: LocalLearningState, storage?: StorageLike | null): void {
	storageOrNull(storage)?.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function saveDraft(taskId: string, text: string, storage?: StorageLike | null): LocalLearningState {
	const state = loadLearningState(storage);
	state.drafts[taskId] = { taskId, text, updatedAt: new Date().toISOString() };
	writeLearningState(state, storage);
	return state;
}

export function recordSubmission(
	input: { requestId: string; taskId: string; stageId: number; taskTitle: string; text: string; feedback: FeedbackResult },
	storage?: StorageLike | null
): SubmissionRecord {
	const state = loadLearningState(storage);
	const existing = state.submissions.find((item) => item.id === input.requestId);
	if (existing) return existing;
	const history = state.problemHistory.find((item) => item.taskId === input.taskId);
	if (history?.submittedAt) return state.submissions.find((item) => item.taskId === input.taskId && item.feedback.decision === 'pass') ?? state.submissions.find((item) => item.taskId === input.taskId)!;
	const submittedAt = new Date().toISOString();
	const record: SubmissionRecord = {
		id: input.requestId,
		taskId: input.taskId,
		stageId: input.stageId,
		taskTitle: input.taskTitle,
		text: input.text,
		feedback: input.feedback,
		phase: history?.phase ?? state.progress.phase,
		submittedAt
	};
	state.submissions.unshift(record);
	const advancesToNewProblem = record.phase === 'promotion_test' || input.feedback.decision === 'pass';
	if (history && advancesToNewProblem) history.submittedAt = submittedAt;
	else if (!history) {
		const task = resolvePracticeTask(input.taskId);
		state.problemHistory.unshift({
			taskId: input.taskId, problemId: task?.problemId ?? null, stageId: input.stageId, taskTitle: input.taskTitle,
			prompt: task?.prompt ?? input.taskTitle, hint: task?.hint ?? '合格条件を確認して書きましょう。',
			features: task?.features ?? createProblemFeatures(input.stageId, stableSeed(input.taskId)),
			promptHash: task ? practiceTaskPromptHash(task) : promptHash(input.taskTitle),
			issuedAt: submittedAt, submittedAt: advancesToNewProblem ? submittedAt : null,
			phase: state.progress.phase,
		});
	}
	if (advancesToNewProblem) delete state.drafts[input.taskId];
	else state.drafts[input.taskId] = { taskId: input.taskId, text: input.text, updatedAt: submittedAt };
	state.skillStats = updateSkillStats(state.skillStats, input.stageId, input.feedback.skillResults ?? [], submittedAt);
	state.progress = applySubmissionToProgress(state.progress, record);
	writeLearningState(state, storage);
	return record;
}

export function saveCurrentStage(stageId: number, storage?: StorageLike | null): LearningProgress {
	const state = loadLearningState(storage);
	state.progress = selectLearningStage(state.progress, stageId);
	writeLearningState(state, storage);
	return state.progress;
}

export function saveProgressionSettings(settings: Pick<LearningProgress, 'requiredTrainingPasses' | 'promotionTestQuestionCount' | 'requiredRetrainingPasses'>, storage?: StorageLike | null): LearningProgress {
	if (!Object.values(settings).every(isValidRequiredPasses)) throw new Error('各回数は1〜10回で指定してください。');
	const state = loadLearningState(storage);
	state.progress = { ...state.progress, ...settings };
	writeLearningState(state, storage);
	return state.progress;
}

export function saveFeedbackPreference(enabled: boolean, storage?: StorageLike | null): LearningProgress {
	const state = loadLearningState(storage);
	state.progress = { ...state.progress, easyFeedbackEnabled: enabled };
	writeLearningState(state, storage);
	return state.progress;
}

export function saveTopicPreference(mode: LearningProgress['topicSelectionMode'], topics: string[], storage?: StorageLike | null): LearningProgress {
	const customTopics = normalizeCustomTopics(topics);
	if (!isTopicSelectionMode(mode) || (mode === 'custom' && customTopics.length === 0)) throw new Error('自由設定ではテーマを1つ以上入力してください。');
	const state = loadLearningState(storage);
	state.progress = { ...state.progress, topicSelectionMode: mode, customTopics };
	writeLearningState(state, storage);
	return state.progress;
}

export function dateKey(value: string | Date): string {
	const date = typeof value === 'string' ? new Date(value) : value;
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

export function activityCounts(state: LocalLearningState): Map<string, number> {
	const counts = new Map<string, number>();
	for (const submission of state.submissions) {
		const key = dateKey(submission.submittedAt);
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}
	return counts;
}
