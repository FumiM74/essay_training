import { browser } from '$app/environment';
import type { FeedbackResult } from '$lib/types/contracts';
import type { PracticeTask } from '$lib/types/curriculum';
import type { LearningProgress, LocalLearningState, ProblemHistoryRecord, SubmissionRecord } from '$lib/types/learning';
import { createProblemFeatures, isProblemFeatureSignature, promptHash, resolvePracticeTask } from './problem-generator';
import { applySubmissionToProgress, defaultLearningProgress, deriveProgress, isValidRequiredPasses, selectLearningStage } from './progression';
import { isLearnerSkillStats, updateSkillStats } from './mastery';

const STORAGE_KEY = 'essay-training-local-state-v4';
const VERSION_3_STORAGE_KEY = 'essay-training-local-state-v3';
const VERSION_2_STORAGE_KEY = 'essay-training-local-state-v2';
const LEGACY_STORAGE_KEY = 'essay-training-local-state-v1';
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export function emptyLearningState(): LocalLearningState {
	return { version: 4, drafts: {}, submissions: [], problemHistory: [], skillStats: {}, progress: defaultLearningProgress() };
}

function storageOrNull(storage?: StorageLike | null): StorageLike | null {
	if (storage !== undefined) return storage;
	return browser ? window.localStorage : null;
}

function validProgress(value: unknown): value is LearningProgress {
	if (!value || typeof value !== 'object') return false;
	const progress = value as Partial<LearningProgress>;
	return Number.isInteger(progress.currentStageId) && Number(progress.currentStageId) >= 1 && Number(progress.currentStageId) <= 13
		&& Number.isInteger(progress.highestUnlockedStageId) && Number(progress.highestUnlockedStageId) >= Number(progress.currentStageId) && Number(progress.highestUnlockedStageId) <= 13
		&& Number.isInteger(progress.consecutivePasses) && Number(progress.consecutivePasses) >= 0
		&& isValidRequiredPasses(Number(progress.requiredConsecutivePasses))
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
		};
	});
}

function migrateProgress(progress: unknown, submissions: SubmissionRecord[]): LearningProgress {
	if (progress && typeof progress === 'object') {
		const old = progress as Partial<LearningProgress>;
		const currentStageId = Number(old.currentStageId);
		const storedHighest = Number(old.highestUnlockedStageId);
		const required = Number(old.requiredConsecutivePasses);
		const consecutive = Number(old.consecutivePasses);
		if (Number.isInteger(currentStageId) && currentStageId >= 1 && currentStageId <= 13 && isValidRequiredPasses(required) && Number.isInteger(consecutive) && consecutive >= 0) {
			const highestUnlockedStageId = old.courseCompletedAt
				? 13
				: Number.isInteger(storedHighest) && storedHighest >= currentStageId && storedHighest <= 13 ? storedHighest : currentStageId;
			return {
				currentStageId,
				highestUnlockedStageId,
				consecutivePasses: consecutive,
				requiredConsecutivePasses: required,
				courseCompletedAt: typeof old.courseCompletedAt === 'string' ? old.courseCompletedAt : null,
			};
		}
	}
	return deriveProgress(submissions);
}

function validProblemHistory(value: unknown): value is ProblemHistoryRecord[] {
	return Array.isArray(value) && value.every((item) => Boolean(item && typeof item === 'object'
		&& typeof (item as ProblemHistoryRecord).taskId === 'string'
		&& Number.isInteger((item as ProblemHistoryRecord).stageId) && (item as ProblemHistoryRecord).stageId >= 1 && (item as ProblemHistoryRecord).stageId <= 13
		&& typeof (item as ProblemHistoryRecord).taskTitle === 'string'
		&& typeof (item as ProblemHistoryRecord).prompt === 'string'
		&& typeof (item as ProblemHistoryRecord).hint === 'string'
		&& isProblemFeatureSignature((item as ProblemHistoryRecord).features)
		&& typeof (item as ProblemHistoryRecord).promptHash === 'string'
		&& typeof (item as ProblemHistoryRecord).issuedAt === 'string'
		&& ((item as ProblemHistoryRecord).submittedAt === null || typeof (item as ProblemHistoryRecord).submittedAt === 'string')));
}

function migrateProblemHistory(value: unknown, submissions: SubmissionRecord[]): ProblemHistoryRecord[] {
	if (!Array.isArray(value)) return historyFromSubmissions(submissions);
	const migrated = value.flatMap((item): ProblemHistoryRecord[] => {
		if (!item || typeof item !== 'object') return [];
		const old = item as Partial<ProblemHistoryRecord>;
		if (typeof old.taskId !== 'string' || !Number.isInteger(old.stageId) || Number(old.stageId) < 1 || Number(old.stageId) > 13
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
		if (parsed.version === 4 && validProgress(parsed.progress)) {
			return { version: 4, drafts: parsed.drafts, submissions: parsed.submissions, problemHistory: validProblemHistory(parsed.problemHistory) ? parsed.problemHistory : migrateProblemHistory(parsed.problemHistory, parsed.submissions), skillStats: isLearnerSkillStats(parsed.skillStats) ? parsed.skillStats : skillStatsFromSubmissions(parsed.submissions), progress: parsed.progress };
		}
		if (parsed.version === 1 || parsed.version === 2 || parsed.version === 3) return { version: 4, drafts: parsed.drafts, submissions: parsed.submissions, problemHistory: migrateProblemHistory(parsed.problemHistory, parsed.submissions), skillStats: skillStatsFromSubmissions(parsed.submissions), progress: migrateProgress(parsed.progress, parsed.submissions) };
		return emptyLearningState();
	} catch {
		return emptyLearningState();
	}
}

export function loadLearningState(storage?: StorageLike | null): LocalLearningState {
	const target = storageOrNull(storage);
	if (!target) return emptyLearningState();
	return parseLearningState(target.getItem(STORAGE_KEY) ?? target.getItem(VERSION_3_STORAGE_KEY) ?? target.getItem(VERSION_2_STORAGE_KEY) ?? target.getItem(LEGACY_STORAGE_KEY));
}

export function recordProblemIssued(task: PracticeTask, storage?: StorageLike | null): ProblemHistoryRecord {
	if (!task.features) throw new Error('問題の特徴署名がありません。');
	const state = loadLearningState(storage);
	const existing = state.problemHistory.find((item) => item.taskId === task.id);
	if (existing) return existing;
	if (task.stageId !== state.progress.currentStageId) throw new Error('現在の段階以外の問題は開始できません。');
	const active = state.problemHistory.find((item) => item.stageId === task.stageId && item.submittedAt === null);
	if (active) return active;
	const record: ProblemHistoryRecord = { taskId: task.id, problemId: task.problemId ?? null, stageId: task.stageId, taskTitle: task.title, prompt: task.prompt, hint: task.hint, features: task.features, promptHash: promptHash(task.prompt), issuedAt: new Date().toISOString(), submittedAt: null };
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
	const submittedTask = state.submissions.find((item) => item.taskId === input.taskId);
	if (submittedTask) return submittedTask;
	const submittedAt = new Date().toISOString();
	const record: SubmissionRecord = {
		id: input.requestId,
		taskId: input.taskId,
		stageId: input.stageId,
		taskTitle: input.taskTitle,
		text: input.text,
		feedback: input.feedback,
		submittedAt
	};
	state.submissions.unshift(record);
	const history = state.problemHistory.find((item) => item.taskId === input.taskId);
	if (history) history.submittedAt = submittedAt;
	else {
		const task = resolvePracticeTask(input.taskId);
		state.problemHistory.unshift({
			taskId: input.taskId, problemId: task?.problemId ?? null, stageId: input.stageId, taskTitle: input.taskTitle,
			prompt: task?.prompt ?? input.taskTitle, hint: task?.hint ?? '合格条件を確認して書きましょう。',
			features: task?.features ?? createProblemFeatures(input.stageId, stableSeed(input.taskId)),
			promptHash: promptHash(task?.prompt ?? input.taskTitle),
			issuedAt: submittedAt, submittedAt,
		});
	}
	delete state.drafts[input.taskId];
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

export function saveRequiredConsecutivePasses(required: number, storage?: StorageLike | null): LearningProgress {
	if (!isValidRequiredPasses(required)) throw new Error('連続合格回数は1〜10回で指定してください。');
	const state = loadLearningState(storage);
	state.progress = { ...state.progress, requiredConsecutivePasses: required };
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
