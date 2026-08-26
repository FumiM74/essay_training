import { describe, expect, it } from 'vitest';
import { createMockFeedback } from './feedback';
import { generatePracticeTask } from './problem-generator';
import { activityCounts, loadLearningState, parseLearningState, recordProblemIssued, recordSubmission, saveCurrentStage, saveDraft, saveRequiredConsecutivePasses } from './local-store';

function memoryStorage() {
	const values = new Map<string, string>();
	return {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => values.set(key, value)
	};
}

describe('local learning store', () => {
	it('下書きを保存して復元する', () => {
		const storage = memoryStorage();
		saveDraft('stage-1-practice-1', '下書きです。', storage);
		expect(loadLearningState(storage).drafts['stage-1-practice-1'].text).toBe('下書きです。');
	});

	it('提出を履歴・完了・日次活動へ反映する', () => {
		const storage = memoryStorage();
		const feedback = createMockFeedback('私は公共の場で使いやすいデザインが必要だと思います。多くの人が安全に利用できるからです。', 1);
		recordSubmission({ requestId: 'request-1', taskId: 'stage-1-practice-1', stageId: 1, taskTitle: '一文完成の練習', text: '本文です。', feedback }, storage);
		const state = loadLearningState(storage);
		expect(state.submissions).toHaveLength(1);
		expect(state.progress.consecutivePasses).toBe(1);
		expect([...activityCounts(state).values()]).toEqual([1]);
	});

	it('旧version 1の保存データを問題履歴ごとversion 4へ移行する', () => {
		const feedback = createMockFeedback('私は公共の場で使いやすいデザインが必要だと思います。多くの人が安全に利用できるからです。', 1);
		const legacy = JSON.stringify({ version: 1, drafts: {}, submissions: [{ id: 'old', taskId: 'stage-1-practice-1', stageId: 1, taskTitle: '旧問題', text: '本文です。', submittedAt: '2026-08-24T00:00:00Z', feedback }] });
		const state = parseLearningState(legacy);
		expect(state.version).toBe(4);
		expect(state.submissions).toHaveLength(1);
		expect(state.problemHistory).toHaveLength(1);
		expect(state.progress).toMatchObject({ currentStageId: 1, highestUnlockedStageId: 1, consecutivePasses: 1, requiredConsecutivePasses: 3 });
	});

	it('version 3の問題履歴だけが壊れていても提出履歴から安全に再構築する', () => {
		const feedback = createMockFeedback('私は公共の場で使いやすいデザインが必要だと思います。多くの人が安全に利用できるからです。', 1);
		const submission = { id: 'repair', taskId: 'stage-1-practice-1', stageId: 1, taskTitle: '復旧問題', text: '本文です。', submittedAt: '2026-08-24T00:00:00Z', feedback };
		const raw = JSON.stringify({ version: 3, drafts: {}, submissions: [submission], problemHistory: [{ broken: true }], progress: { ...loadLearningState(null).progress } });
		const state = parseLearningState(raw);
		expect(state.submissions).toHaveLength(1);
		expect(state.problemHistory[0]).toMatchObject({ taskId: submission.taskId, submittedAt: submission.submittedAt });
	});

	it('表示した問題の段階別特徴署名を保存し、同じ問題を二重登録しない', () => {
		const storage = memoryStorage();
		const task = generatePracticeTask(1, 42);
		recordProblemIssued(task, storage);
		recordProblemIssued(task, storage);
		const state = loadLearningState(storage);
		expect(state.problemHistory).toHaveLength(1);
		expect(state.problemHistory[0].features).toMatchObject({ version: 2, promptFamily: 'complete-one-sentence' });
		expect(state.problemHistory[0].promptHash).toMatch(/^fnv1a:/);
	});

	it('同じ段階で未提出問題を二重発行しない', () => {
		const storage = memoryStorage();
		const first = generatePracticeTask(1, 1);
		const second = generatePracticeTask(1, 2);
		recordProblemIssued(first, storage);
		expect(recordProblemIssued(second, storage).taskId).toBe(first.id);
		expect(loadLearningState(storage).problemHistory).toHaveLength(1);
	});

	it('到達済み段階へ戻っても最高到達段階を保持する', () => {
		const storage = memoryStorage();
		const state = loadLearningState(storage);
		state.progress.currentStageId = 3;
		state.progress.highestUnlockedStageId = 3;
		storage.setItem('essay-training-local-state-v4', JSON.stringify(state));
		const progress = saveCurrentStage(1, storage);
		expect(progress).toMatchObject({ currentStageId: 1, highestUnlockedStageId: 3, consecutivePasses: 0 });
	});

	it('同じrequestIdの再送で提出と連続合格を二重計上しない', () => {
		const storage = memoryStorage();
		const feedback = createMockFeedback('私は公共の場で使いやすいデザインが必要だと思います。多くの人が安全に利用できるからです。', 1);
		const input = { requestId: 'same-request', taskId: 'stage-1-practice-1', stageId: 1, taskTitle: '一文完成の練習', text: '本文です。', feedback };
		recordSubmission(input, storage);
		recordSubmission(input, storage);
		const state = loadLearningState(storage);
		expect(state.submissions).toHaveLength(1);
		expect(state.progress.consecutivePasses).toBe(1);
	});

	it('同じ問題を別のrequestIdで送っても連続合格を二重計上しない', () => {
		const storage = memoryStorage();
		const feedback = createMockFeedback('私は公共の場で使いやすいデザインが必要だと思います。多くの人が安全に利用できるからです。', 1);
		const input = { requestId: 'first-request', taskId: 'stage-1-practice-1', stageId: 1, taskTitle: '一文完成の練習', text: '本文です。', feedback };
		recordSubmission(input, storage);
		recordSubmission({ ...input, requestId: 'second-request' }, storage);
		const state = loadLearningState(storage);
		expect(state.submissions).toHaveLength(1);
		expect(state.progress.consecutivePasses).toBe(1);
	});

	it('必要な連続合格回数を1〜10回で変更できる', () => {
		const storage = memoryStorage();
		expect(saveRequiredConsecutivePasses(5, storage).requiredConsecutivePasses).toBe(5);
		expect(() => saveRequiredConsecutivePasses(0, storage)).toThrow();
		expect(() => saveRequiredConsecutivePasses(11, storage)).toThrow();
	});

	it('提出結果から技能別習熟度を更新する', () => {
		const storage = memoryStorage();
		const feedback = createMockFeedback('短い', 1, ['subject_predicate']);
		recordSubmission({ requestId: 'skill-result', taskId: 'stage-1-practice-skill', stageId: 1, taskTitle: '技能問題', text: '短い', feedback }, storage);
		const stat = loadLearningState(storage).skillStats['1:subject_predicate'];
		expect(stat).toMatchObject({ attempts: 1, missedCount: 1, skillKey: 'subject_predicate' });
		expect(stat.masteryScore).toBeLessThan(0.5);
	});

	it('旧versionの提出に技能評価がなければ習熟度を捏造しない', () => {
		const legacyFeedback = { schemaVersion: '1', languageStatus: 'clean', decision: 'pass', priorityFeedback: [] };
		const raw = JSON.stringify({ version: 3, drafts: {}, submissions: [{ id: 'legacy-no-skills', taskId: 'stage-1-practice-1', stageId: 1, taskTitle: '旧問題', text: '本文', submittedAt: '2026-08-24T00:00:00Z', feedback: legacyFeedback }] });
		expect(parseLearningState(raw).skillStats).toEqual({});
	});
});
