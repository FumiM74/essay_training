import type { PracticeTask } from '$lib/types/curriculum';
import type { FeedbackResult } from '$lib/types/contracts';
import type { LearningProgress } from '$lib/types/learning';

export type SubmissionSnapshot = { task: PracticeTask; text: string; feedback: FeedbackResult; progress: LearningProgress };

// Copy nested question/feedback data too; Svelte state and editor objects remain mutable.
export function captureSubmission(value: SubmissionSnapshot): SubmissionSnapshot {
	return JSON.parse(JSON.stringify(value));
}

// A failed read after a successful write must never be reported as a failed submission.
export async function saveThenRefresh<T, S>(save: () => Promise<T>, refresh: () => Promise<S>): Promise<
	{ submission: T; synced: true; state: S } | { submission: T; synced: false; error: unknown }
> {
	const submission = await save();
	try { return { submission, synced: true, state: await refresh() }; }
	catch (error) { return { submission, synced: false, error }; }
}
