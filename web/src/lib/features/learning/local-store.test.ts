import { describe, expect, it } from 'vitest';
import { createBasicQuestionSetFeedback, createMockFeedback } from './feedback';
import { generatePracticeTask } from './problem-generator';
import { activityCounts, loadLearningState, parseLearningState, recordProblemIssued, recordSubmission, saveCurrentStage, saveDraft, saveFeedbackPreference, saveProgressionSettings, saveTopicPreference } from './local-store';

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
		const feedback = createMockFeedback('私は、公共の場にはだれもが使いやすいデザインが必要だと思います。', 1);
		recordSubmission({ requestId: 'request-1', taskId: 'stage-1-practice-1', stageId: 1, taskTitle: '一文完成の練習', text: '本文です。', feedback }, storage);
		const state = loadLearningState(storage);
		expect(state.submissions).toHaveLength(1);
		expect(state.progress.phasePasses).toBe(1);
		expect([...activityCounts(state).values()]).toEqual([1]);
	});

	it('旧version 1の保存データを問題履歴ごとversion 5へ移行する', () => {
		const feedback = createMockFeedback('私は、公共の場にはだれもが使いやすいデザインが必要だと思います。', 1);
		const legacy = JSON.stringify({ version: 1, drafts: {}, submissions: [{ id: 'old', taskId: 'stage-1-practice-1', stageId: 1, taskTitle: '旧問題', text: '本文です。', submittedAt: '2026-08-24T00:00:00Z', feedback }] });
		const state = parseLearningState(legacy);
		expect(state.version).toBe(5);
		expect(state.submissions).toHaveLength(1);
		expect(state.problemHistory).toHaveLength(1);
		expect(state.progress).toMatchObject({ currentStageId: 1, highestUnlockedStageId: 1, phase: 'training', phasePasses: 1, requiredTrainingPasses: 10 });
	});

	it('version 3の問題履歴だけが壊れていても提出履歴から安全に再構築する', () => {
		const feedback = createMockFeedback('私は、公共の場にはだれもが使いやすいデザインが必要だと思います。', 1);
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
		expect(state.problemHistory[0].features).toMatchObject({ version: 2, promptFamily: 'five-question-language-basics' });
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
		storage.setItem('essay-training-local-state-v5', JSON.stringify(state));
		const progress = saveCurrentStage(1, storage);
		expect(progress).toMatchObject({ currentStageId: 1, highestUnlockedStageId: 3, phase: 'training', phasePasses: 0 });
	});

	it('復習の前後で最高到達段階の進級状態を保存する', () => {
		const storage = memoryStorage();
		const state = loadLearningState(storage);
		state.progress = { ...state.progress, currentStageId: 5, highestUnlockedStageId: 5, phase: 'promotion_test', phasePasses: 2, phaseAttempts: 3, frontierPhase: 'promotion_test', frontierPhasePasses: 2, frontierPhaseAttempts: 3 };
		storage.setItem('essay-training-local-state-v5', JSON.stringify(state));
		expect(saveCurrentStage(2, storage)).toMatchObject({ currentStageId: 2, highestUnlockedStageId: 5, frontierPhase: 'promotion_test', frontierPhasePasses: 2 });
		expect(saveCurrentStage(5, storage)).toMatchObject({ currentStageId: 5, highestUnlockedStageId: 5, phase: 'promotion_test', phasePasses: 2, phaseAttempts: 3 });
	});

	it('同じrequestIdの再送で提出と連続合格を二重計上しない', () => {
		const storage = memoryStorage();
		const feedback = createMockFeedback('私は、公共の場にはだれもが使いやすいデザインが必要だと思います。', 1);
		const input = { requestId: 'same-request', taskId: 'stage-1-practice-1', stageId: 1, taskTitle: '一文完成の練習', text: '本文です。', feedback };
		recordSubmission(input, storage);
		recordSubmission(input, storage);
		const state = loadLearningState(storage);
		expect(state.submissions).toHaveLength(1);
		expect(state.progress.phasePasses).toBe(1);
	});

	it('同じ問題を別のrequestIdで送っても連続合格を二重計上しない', () => {
		const storage = memoryStorage();
		const feedback = createMockFeedback('私は、公共の場にはだれもが使いやすいデザインが必要だと思います。', 1);
		const input = { requestId: 'first-request', taskId: 'stage-1-practice-1', stageId: 1, taskTitle: '一文完成の練習', text: '本文です。', feedback };
		recordSubmission(input, storage);
		recordSubmission({ ...input, requestId: 'second-request' }, storage);
		const state = loadLearningState(storage);
		expect(state.submissions).toHaveLength(1);
		expect(state.progress.phasePasses).toBe(1);
	});

	it('進級テストと訓練の回数を1〜10回で変更できる', () => {
		const storage = memoryStorage();
		const settings = { requiredTrainingPasses: 5, promotionTestQuestionCount: 4, requiredRetrainingPasses: 2 };
		expect(saveProgressionSettings(settings, storage)).toMatchObject(settings);
		expect(() => saveProgressionSettings({ ...settings, promotionTestQuestionCount: 0 }, storage)).toThrow();
		expect(() => saveProgressionSettings({ ...settings, requiredRetrainingPasses: 11 }, storage)).toThrow();
	});

	it('解説の難易度を初期値OFFで保存し、いつでも切り替えられる', () => {
		const storage = memoryStorage();
		expect(loadLearningState(storage).progress.easyFeedbackEnabled).toBe(false);
		expect(saveFeedbackPreference(true, storage).easyFeedbackEnabled).toBe(true);
		expect(loadLearningState(storage).progress.easyFeedbackEnabled).toBe(true);
		expect(saveFeedbackPreference(false, storage).easyFeedbackEnabled).toBe(false);
	});

	it('論点はランダムを初期値とし、自由設定を3件・各20文字まで保存する', () => {
		const storage = memoryStorage();
		expect(loadLearningState(storage).progress).toMatchObject({ topicSelectionMode: 'random', customTopics: [] });
		expect(saveTopicPreference('custom', ['少子化と教育', '地域医療'], storage)).toMatchObject({ topicSelectionMode: 'custom', customTopics: ['少子化と教育', '地域医療'] });
		expect(() => saveTopicPreference('custom', [], storage)).toThrow();
		expect(() => saveTopicPreference('custom', ['一', '二', '三', '四'], storage)).toThrow();
		expect(() => saveTopicPreference('custom', ['あ'.repeat(21)], storage)).toThrow();
	});

	it('進級テストの要修正は同じ問題と答案を保持し、合格数を変えない', () => {
		const storage = memoryStorage();
		const state = loadLearningState(storage);
		state.progress = { ...state.progress, phase: 'promotion_test', phasePasses: 1, phaseAttempts: 1 };
		storage.setItem('essay-training-local-state-v5', JSON.stringify(state));
		const task = generatePracticeTask(1, 8);
		recordProblemIssued(task, storage);
		const feedback = createMockFeedback('短い', 1, task.features?.skillTargets);
		recordSubmission({ requestId: 'promotion-fail', taskId: task.id, stageId: 1, taskTitle: task.title, text: '短い', feedback }, storage);
		const after = loadLearningState(storage);
		expect(after.problemHistory.find((item) => item.taskId === task.id)?.submittedAt).toBeNull();
		expect(after.drafts[task.id]?.text).toBe('短い');
		expect(after.progress).toMatchObject({ phase: 'promotion_test', phasePasses: 1, phaseAttempts: 2 });
	});

	it('段階1は同じセットを修正し、全問正解後だけ合格数を増やす', () => {
		const storage = memoryStorage();
		const task = generatePracticeTask(1, 3);
		recordProblemIssued(task, storage);
		const answers = Object.fromEntries(task.questionSet!.map((question) => [question.id, question.acceptedAnswers[0]]));
		answers[task.questionSet![0].id] = '誤答';
		const feedback = createBasicQuestionSetFeedback(task.questionSet!, answers);
		recordSubmission({ requestId: 'stage-one-fail', taskId: task.id, stageId: 1, taskTitle: task.title, text: '5問の解答', feedback }, storage);
		const state = loadLearningState(storage);
		expect(state.problemHistory.find((item) => item.taskId === task.id)?.submittedAt).toBeNull();
		expect(state.problemHistory.filter((item) => item.taskId === task.id)).toHaveLength(1);
		expect(state.drafts[task.id]).toBeDefined();
		expect(state.progress.phasePasses).toBe(0);
		answers[task.questionSet![0].id] = task.questionSet![0].acceptedAnswers[0];
		const corrected = { requestId: 'stage-one-pass', taskId: task.id, stageId: 1, taskTitle: task.title, text: '修正済み', feedback: createBasicQuestionSetFeedback(task.questionSet!, answers) };
		recordSubmission(corrected, storage);
		recordSubmission(corrected, storage);
		const after = loadLearningState(storage);
		expect(after.progress.phasePasses).toBe(1);
		expect(after.submissions).toHaveLength(2);
		expect(after.problemHistory).toHaveLength(1);
		expect(after.problemHistory[0].submittedAt).not.toBeNull();
		expect(after.drafts[task.id]).toBeUndefined();
	});

	it('要修正の答案を同じ問題で再提出でき、合格時だけ問題を完了する', () => {
		const storage = memoryStorage();
		const initial = loadLearningState(storage);
		initial.progress = { ...initial.progress, currentStageId: 2, highestUnlockedStageId: 2 };
		storage.setItem('essay-training-local-state-v5', JSON.stringify(initial));
		const task = generatePracticeTask(2, 7);
		recordProblemIssued(task, storage);
		const revise = createMockFeedback('短い', 2, task.features?.skillTargets);
		recordSubmission({ requestId: 'revision-1', taskId: task.id, stageId: 2, taskTitle: task.title, text: '短い', feedback: revise }, storage);
		let state = loadLearningState(storage);
		expect(state.submissions).toHaveLength(1);
		expect(state.problemHistory[0].submittedAt).toBeNull();
		expect(state.drafts[task.id].text).toBe('短い');
		const pass = createMockFeedback('私は、公共の場にはだれもが使いやすいデザインが必要だと思います。', 2, task.features?.skillTargets);
		recordSubmission({ requestId: 'revision-2', taskId: task.id, stageId: 2, taskTitle: task.title, text: '修正した本文です。', feedback: pass }, storage);
		state = loadLearningState(storage);
		expect(state.submissions).toHaveLength(2);
		expect(state.problemHistory[0].submittedAt).not.toBeNull();
		expect(state.drafts[task.id]).toBeUndefined();
		expect(state.progress.phasePasses).toBe(1);
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
