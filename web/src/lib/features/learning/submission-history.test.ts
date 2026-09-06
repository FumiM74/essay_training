import { describe, expect, it } from 'vitest';
import type { SubmissionRecord } from '$lib/types/learning';
import { createBasicQuestionSetFeedback } from './feedback';
import { generatePracticeTask } from './problem-generator';
import { stageOneHistoryItems } from './submission-history';

describe('STEP 1の提出履歴', () => {
	it('5問それぞれの問題文・解答・採点結果・説明を対応づける', () => {
		const task = generatePracticeTask(1, 0);
		const questions = task.questionSet!;
		const answers = Object.fromEntries(questions.map((question) => [question.id, question.answerLabel]));
		const submission: SubmissionRecord = {
			id: 'submission-1',
			taskId: task.id,
			stageId: 1,
			taskTitle: task.title,
			text: questions.map((question, index) => `問題${index + 1}：${answers[question.id]}`).join('\n'),
			submittedAt: '2026-09-03T00:00:00.000Z',
			feedback: createBasicQuestionSetFeedback(questions, answers),
			phase: 'training',
		};

		const items = stageOneHistoryItems(submission);
		expect(items).toHaveLength(5);
		expect(items.map((item) => item.question?.prompt)).toEqual(questions.map((question) => question.prompt));
		expect(items.map((item) => item.answer)).toEqual(questions.map((question) => question.answerLabel));
		expect(items.every((item) => item.feedback?.title.includes('正解'))).toBe(true);
		expect(items.every((item) => Boolean(item.feedback?.guidance))).toBe(true);
	});

	it('今後問題バンクが変わっても保存時の問題文を優先して表示する', () => {
		const task = generatePracticeTask(1, 1);
		const questions = task.questionSet!;
		const answers = Object.fromEntries(questions.map((question) => [question.id, question.answerLabel]));
		const feedback = createBasicQuestionSetFeedback(questions, answers);
		const submission: SubmissionRecord = {
			id: 'submission-snapshot',
			taskId: 'unknown-old-task',
			stageId: 1,
			taskTitle: task.title,
			text: '',
			submittedAt: '2026-09-03T00:00:00.000Z',
			feedback,
			phase: 'training',
		};

		const items = stageOneHistoryItems(submission);
		expect(items.map((item) => item.question?.prompt)).toEqual(questions.map((question) => question.prompt));
		expect(items.map((item) => item.answer)).toEqual(questions.map((question) => question.answerLabel));
	});
});
