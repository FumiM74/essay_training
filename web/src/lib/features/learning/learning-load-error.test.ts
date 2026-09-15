import { describe, expect, it } from 'vitest';
import { LearningStateLoadError, ProblemIssueError, databaseErrorCode, learningLoadErrorMessage, parseTrialOutcome, shouldReuseSubmissionRequest, submissionErrorMessage } from './learning-service';

describe('learning load errors', () => {
	it('5回終了した生成問題の模範解答情報を検証する', () => {
		expect(parseTrialOutcome({ status: 'disqualified', revisionCount: 5, maxRevisionCount: 5,
			modelAnswers: [{ label: '模範解答例', answer: '解答例です。', explanation: '条件を満たしています。' }] }))
			.toMatchObject({ status: 'disqualified', revisionCount: 5 });
		expect(() => parseTrialOutcome({ status: 'disqualified', revisionCount: 6, maxRevisionCount: 5 })).toThrow();
	});
	it('失敗した読込項目と安全なエラーコードを表示する', () => {
		expect(learningLoadErrorMessage(new LearningStateLoadError('progress', 'PGRST116')))
			.toBe('学習進捗を読み込めませんでした（エラーコード: PGRST116）。もう一度読み込んでください。');
		expect(learningLoadErrorMessage(new LearningStateLoadError('problem_history')))
			.toBe('問題履歴を読み込めませんでした。もう一度読み込んでください。');
	});

	it('想定外の失敗では特定項目を誤って断定しない', () => {
		expect(learningLoadErrorMessage(new Error('network failed')))
			.toBe('学習データを読み込めませんでした。通信状態を確認して、もう一度お試しください。');
	});

	it('問題発行の失敗をデータ読込の失敗と区別する', () => {
		expect(learningLoadErrorMessage(new ProblemIssueError('P0001')))
			.toBe('現在の問題を開始できませんでした（エラーコード: P0001）。もう一度読み込んでください。');
	});

	it('画面表示用には安全なDBエラーコードだけを取り出す', () => {
		expect(databaseErrorCode({ code: '23505' })).toBe('23505');
		expect(databaseErrorCode({ code: 'question_set_problem_mismatch' })).toBe('question_set_problem_mismatch');
		expect(databaseErrorCode({ code: '<script>' })).toBeUndefined();
	});

	it('Claude予算エラーの実際の原因を区別して表示する', () => {
		expect(submissionErrorMessage({ code: 'feedback_budget_exceeded', reason: 'request_input_limit' })).toContain('入力が暫定上限を超えました');
		expect(submissionErrorMessage({ code: 'feedback_budget_exceeded', reason: 'daily_limit' })).toContain('本日のAI添削上限');
		expect(submissionErrorMessage({ code: 'feedback_budget_exceeded', reason: 'disabled' })).toContain('現在停止しています');
		expect(submissionErrorMessage({ code: 'feedback_budget_exceeded', reason: 'request_output_limit' })).toContain('出力上限設定');
	});

	it('確定したClaude失敗では次回提出に新しいリクエストIDを使う', () => {
		expect(shouldReuseSubmissionRequest({ code: 'provider_http_400' })).toBe(false);
		expect(shouldReuseSubmissionRequest({ code: 'previous_feedback_failed' })).toBe(false);
		expect(shouldReuseSubmissionRequest({ code: 'feedback_in_progress' })).toBe(true);
		expect(shouldReuseSubmissionRequest(new Error('接続が切れた'))).toBe(true);
	});
});
