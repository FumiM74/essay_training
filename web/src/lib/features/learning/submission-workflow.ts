import type { PracticeTask } from '$lib/types/curriculum';
import type { FeedbackResult } from '$lib/types/contracts';
import type { LearningProgress } from '$lib/types/learning';

export type SubmissionSnapshot = { task: PracticeTask; text: string; feedback: FeedbackResult; progress: LearningProgress };

export type PendingSubmission = {
	taskId: string;
	requestId: string;
	startedAt: string;
	progress?: LearningProgress;
	status?: 'submitting' | 'result_ready';
};

type SubmissionStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const PENDING_SUBMISSION_KEY = 'essay-training:pending-submission';
const PENDING_SUBMISSION_MAX_AGE_MS = 30 * 60 * 1000;

// Copy nested question/feedback data too; Svelte state and editor objects remain mutable.
export function captureSubmission(value: SubmissionSnapshot): SubmissionSnapshot {
	return JSON.parse(JSON.stringify(value));
}

export function rememberPendingSubmission(storage: SubmissionStorage | null, pending: PendingSubmission): void {
	storage?.setItem(PENDING_SUBMISSION_KEY, JSON.stringify(pending));
}

export function pendingSubmissionForTask(
	storage: SubmissionStorage | null,
	taskId: string,
	now = Date.now(),
): PendingSubmission | null {
	const raw = storage?.getItem(PENDING_SUBMISSION_KEY);
	if (!raw) return null;
	try {
		const value = JSON.parse(raw) as Partial<PendingSubmission>;
		const requestId = value.requestId;
		const startedAtText = value.startedAt;
		const startedAt = typeof startedAtText === 'string' ? Date.parse(startedAtText) : Number.NaN;
		const status = value.status === 'result_ready' ? 'result_ready' : 'submitting';
		if (value.taskId !== taskId || typeof requestId !== 'string' || typeof startedAtText !== 'string' || !Number.isFinite(startedAt)
			|| now - startedAt < 0 || (status === 'submitting' && now - startedAt > PENDING_SUBMISSION_MAX_AGE_MS)) return null;
		const progress = value.progress && typeof value.progress === 'object' ? value.progress as LearningProgress : undefined;
		return { taskId: value.taskId, requestId, startedAt: startedAtText, ...(progress ? { progress } : {}), status };
	} catch {
		return null;
	}
}

export function rememberSubmissionResult(storage: SubmissionStorage | null, pending: PendingSubmission): void {
	rememberPendingSubmission(storage, { ...pending, status: 'result_ready' });
}

export function shouldRestoreSubmissionResult(pending: PendingSubmission | null, hasSavedSubmission: boolean): boolean {
	return hasSavedSubmission && pending?.status === 'result_ready';
}

export function forgetPendingSubmission(storage: SubmissionStorage | null, taskId: string): void {
	const raw = storage?.getItem(PENDING_SUBMISSION_KEY);
	if (!raw) return;
	try {
		const value = JSON.parse(raw) as Partial<PendingSubmission>;
		if (value.taskId === taskId) storage?.removeItem(PENDING_SUBMISSION_KEY);
	} catch {
		storage?.removeItem(PENDING_SUBMISSION_KEY);
	}
}

// A failed read after a successful write must never be reported as a failed submission.
export async function saveThenRefresh<T, S>(save: () => Promise<T>, refresh: () => Promise<S>): Promise<
	{ submission: T; synced: true; state: S } | { submission: T; synced: false; error: unknown }
> {
	const submission = await save();
	try { return { submission, synced: true, state: await refresh() }; }
	catch (error) { return { submission, synced: false, error }; }
}
