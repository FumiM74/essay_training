import type { FeedbackResult } from '$lib/types/contracts';

// Drafts may contain JSON from editing or display text written by the submission RPC.
// Submitted per-question answers are the reliable fallback after a reload.
export function restoreBasicAnswers(feedback: FeedbackResult | null, draft?: string): Record<string, string> {
	const answers = Object.fromEntries((feedback?.basicQuestionResults ?? []).map((r) => [r.questionId, r.answer]));
	try {
		const parsed: unknown = JSON.parse(draft ?? 'null');
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
			for (const [key, value] of Object.entries(parsed)) if (typeof value === 'string') answers[key] = value;
		}
	} catch { /* Submission display text is not a JSON draft. */ }
	for (const result of feedback?.basicQuestionResults ?? []) if (result.correct) answers[result.questionId] = result.answer;
	return answers;
}
