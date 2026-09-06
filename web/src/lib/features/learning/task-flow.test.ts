import { describe, expect, it } from 'vitest';
import { canAnswerTask, resultProgress, taskResultAction } from './task-flow';
import { defaultLearningProgress } from './progression';

describe('task screen flow', () => {
	it('トレーニング最終合格は10/10として表示し、次の試験0/3と混ぜない', () => {
		const before = { ...defaultLearningProgress(), phasePasses: 9 };
		const after = { ...before, phase: 'promotion_test' as const, phasePasses: 0 };
		expect(resultProgress(before, 'pass', after)).toMatchObject({ phase: 'training', phasePasses: 10 });
	});
	it('進級テスト最終合格は元の段階3/3を表示する', () => {
		const before = { ...defaultLearningProgress(), phase: 'promotion_test' as const, phasePasses: 2 };
		const after = { ...defaultLearningProgress(), currentStageId: 2, highestUnlockedStageId: 2 };
		expect(resultProgress(before, 'pass', after)).toMatchObject({ currentStageId: 1, phase: 'promotion_test', phasePasses: 3 });
		expect(resultProgress(before, 'revise')).toMatchObject({ phasePasses: 2 });
	});
	it('要修正後は、現在の発行済み問題なら推奨問題の再計算に左右されず入力できる', () => {
		expect(canAnswerTask({
			hasScope: true,
			learningLoaded: true,
			isCurrentStage: true,
			isRecommendedTask: false,
			isActiveTask: true,
			isResultScreen: false,
		})).toBe(true);
	});

	it('古い問題URL、結果表示中、未ログインでは入力できない', () => {
		const base = { hasScope: true, learningLoaded: true, isCurrentStage: true, isRecommendedTask: true, isActiveTask: false, isResultScreen: false };
		expect(canAnswerTask(base)).toBe(false);
		expect(canAnswerTask({ ...base, isCurrentStage: false, isRecommendedTask: false })).toBe(false);
		expect(canAnswerTask({ ...base, isResultScreen: true })).toBe(false);
		expect(canAnswerTask({ ...base, hasScope: false })).toBe(false);
	});
	it('保存中は発行済みの解答欄もロックする', () => {
		const base = { hasScope: true, learningLoaded: true, isCurrentStage: true, isRecommendedTask: true, isActiveTask: true, isResultScreen: false };
		expect(canAnswerTask(base)).toBe(true);
		expect(canAnswerTask({ ...base, isSubmitting: true })).toBe(false);
	});

	it('通常問題の要修正だけを同じ問題の修正へ戻す', () => {
		expect(taskResultAction({ decision: 'revise', phase: 'training', stageId: 2, courseCompleted: false })).toBe('revise');
		expect(taskResultAction({ decision: 'revise', phase: 'training', stageId: 1, courseCompleted: false })).toBe('revise');
		expect(taskResultAction({ decision: 'revise', phase: 'promotion_test', stageId: 1, courseCompleted: false })).toBe('next');
		expect(taskResultAction({ decision: 'revise', phase: 'promotion_test', stageId: 2, courseCompleted: false })).toBe('next');
		expect(taskResultAction({ decision: 'pass', phase: 'training', stageId: 2, courseCompleted: false })).toBe('next');
	});

	it('最終段階の修了後は次の問題ではなく学習結果へ進む', () => {
		expect(taskResultAction({ decision: 'pass', phase: 'promotion_test', stageId: 14, courseCompleted: true })).toBe('course_complete');
	});
	it('全課程修了済みでも戻った段階で修正・次問へ進める', () => {
		for (const stageId of [2, 7, 14]) {
			expect(taskResultAction({ decision: 'revise', phase: 'training', stageId, courseCompleted: true })).toBe('revise');
			expect(taskResultAction({ decision: 'pass', phase: 'training', stageId, courseCompleted: true })).toBe('next');
			expect(taskResultAction({ decision: 'revise', phase: 'promotion_test', stageId, courseCompleted: true })).toBe('next');
		}
		expect(taskResultAction({ decision: 'pass', phase: 'promotion_test', stageId: 14, courseCompleted: false })).toBe('next');
	});
});
