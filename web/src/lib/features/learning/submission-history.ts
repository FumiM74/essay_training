import type { BasicQuestion } from '$lib/types/curriculum';
import type { SubmissionRecord } from '$lib/types/learning';
import { resolvePracticeTask } from './problem-generator';

export type BasicQuestionHistoryItem = {
	questionNumber: number;
	question?: Pick<BasicQuestion, 'instruction' | 'prompt'>;
	answer: string;
	feedback?: SubmissionRecord['feedback']['priorityFeedback'][number];
};

function basicAnswers(text: string): Map<number, string> {
	const answers = new Map<number, string>();
	for (const line of text.split('\n')) {
		const matched = /^問題(\d+)：(.*)$/.exec(line);
		if (matched) answers.set(Number(matched[1]), matched[2].trim());
	}
	return answers;
}

export function questionSetHistoryItems(submission: SubmissionRecord): BasicQuestionHistoryItem[] {
	const snapshots = submission.feedback.basicQuestionResults;
	if (snapshots?.length) {
		return snapshots.map((snapshot, index) => ({
			questionNumber: index + 1,
			question: {
				instruction: snapshot.instruction,
				prompt: snapshot.prompt,
			},
			answer: snapshot.answer,
			feedback: submission.feedback.priorityFeedback[index],
		}));
	}
	const questions = resolvePracticeTask(submission.taskId)?.questionSet ?? [];
	const answers = basicAnswers(submission.text);
	const itemCount = Math.max(questions.length, submission.feedback.priorityFeedback.length, answers.size);
	return Array.from({ length: itemCount }, (_, index) => ({
		questionNumber: index + 1,
		question: questions[index],
		answer: answers.get(index + 1) ?? '',
		feedback: submission.feedback.priorityFeedback[index],
	}));
}

export const stageOneHistoryItems = questionSetHistoryItems;
