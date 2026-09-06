import { describe, it, expect } from 'vitest';
import { restoreBasicAnswers } from './basic-revision';
import { basicQuestionSet } from './problem-generator';
import { createBasicQuestionSetFeedback } from './feedback';

describe('basic set revision', () => {
	it('提出表示用テキストでも全問の解答を結果から復元する', () => {
		const questions = basicQuestionSet(3);
		const answers = Object.fromEntries(questions.map(q => [q.id, q.acceptedAnswers[0]]));
		answers[questions[0].id] = '誤答';
		const feedback = createBasicQuestionSetFeedback(questions, answers);
		expect(restoreBasicAnswers(feedback, '問題1：誤答')).toEqual(answers);
		const edited = { ...answers, [questions[0].id]: '修正途中', [questions[1].id]: '変更しない' };
		expect(restoreBasicAnswers(feedback, JSON.stringify(edited))).toEqual({ ...answers, [questions[0].id]: '修正途中' });
	});
	it('初回入力はJSON下書きを復元し、不正な型は無視する', () => {
		expect(restoreBasicAnswers(null, '{"q":"入力","bad":42}')).toEqual({q:'入力'});
		expect(restoreBasicAnswers(null, 'invalid')).toEqual({});
	});
});
