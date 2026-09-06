import { describe, expect, it } from 'vitest';
import { LearningStateLoadError, ProblemIssueError, databaseErrorCode, learningLoadErrorMessage, shouldReuseSubmissionRequest } from './learning-service';

describe('learning load errors', () => {
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
		expect(databaseErrorCode({ code: '<script>' })).toBeUndefined();
	});

	it('確定したClaude失敗では次回提出に新しいリクエストIDを使う', () => {
		expect(shouldReuseSubmissionRequest({ code: 'provider_http_400' })).toBe(false);
		expect(shouldReuseSubmissionRequest({ code: 'previous_feedback_failed' })).toBe(false);
		expect(shouldReuseSubmissionRequest({ code: 'feedback_in_progress' })).toBe(true);
		expect(shouldReuseSubmissionRequest(new Error('接続が切れた'))).toBe(true);
	});
});
