import { describe, expect, it } from 'vitest';
import type { FeedbackResult } from '$lib/types/contracts';
import type { LocalLearningState, ProblemHistoryRecord, SubmissionRecord } from '$lib/types/learning';
import { createProblemSpecification, generatePracticeTask, isProblemFeatureSignature, promptHash, promptSimilarity, resolvePracticeTask } from './problem-generator';
import { applySubmissionToProgress, defaultLearningProgress, featureSignatureSimilarity, selectLearningStage, selectNextPracticeTask } from './progression';
import { updateSkillStats, weakestSkillsForStage } from './mastery';
import { selectionReasonForAttempt } from './learning-design';

const pass: FeedbackResult = { schemaVersion: '1', languageStatus: 'clean', decision: 'pass', priorityFeedback: [], skillResults: [] };
const revise: FeedbackResult = { schemaVersion: '1', languageStatus: 'minor_issue', decision: 'revise', priorityFeedback: [], skillResults: [] };

function submission(id: string, stageId: number, decision: 'pass' | 'revise' = 'pass'): SubmissionRecord {
	return { id, taskId: id, stageId, taskTitle: id, text: '本文です。', submittedAt: `2026-08-25T00:00:0${id.length % 10}Z`, feedback: decision === 'pass' ? pass : revise };
}

function emptyState(): LocalLearningState {
	return { version: 4, drafts: {}, submissions: [], problemHistory: [], skillStats: {}, progress: defaultLearningProgress() };
}

function history(seed: number, submitted = true, stageId = 1): ProblemHistoryRecord {
	const task = generatePracticeTask(stageId, seed);
	return { taskId: task.id, stageId, taskTitle: task.title, prompt: task.prompt, hint: task.hint, features: task.features!, promptHash: promptHash(task.prompt), issuedAt: `2026-08-25T00:00:${String(seed).padStart(2, '0')}Z`, submittedAt: submitted ? `2026-08-25T00:01:${String(seed).padStart(2, '0')}Z` : null };
}

describe('stage progression', () => {
	it('同じ段階で3回連続合格すると次の段階を解放する', () => {
		let progress = defaultLearningProgress();
		progress = applySubmissionToProgress(progress, submission('one', 1));
		progress = applySubmissionToProgress(progress, submission('two', 1));
		expect(progress).toMatchObject({ currentStageId: 1, highestUnlockedStageId: 1, consecutivePasses: 2 });
		progress = applySubmissionToProgress(progress, submission('three', 1));
		expect(progress).toMatchObject({ currentStageId: 2, highestUnlockedStageId: 2, consecutivePasses: 0 });
	});

	it('不合格で連続合格数を0へ戻し、別段階の提出は進級に数えない', () => {
		let progress = applySubmissionToProgress(defaultLearningProgress(), submission('one', 1));
		progress = applySubmissionToProgress(progress, submission('wrong-stage', 2));
		expect(progress.consecutivePasses).toBe(1);
		progress = applySubmissionToProgress(progress, submission('revise', 1, 'revise'));
		expect(progress).toMatchObject({ currentStageId: 1, consecutivePasses: 0 });
	});

	it('到達済み段階へ戻れて、最高到達段階と修了記録を失わない', () => {
		const completed = { ...defaultLearningProgress(), currentStageId: 13, highestUnlockedStageId: 13, courseCompletedAt: '2026-08-25T00:00:00Z' };
		const returned = selectLearningStage(completed, 4);
		expect(returned).toMatchObject({ currentStageId: 4, highestUnlockedStageId: 13, consecutivePasses: 0, courseCompletedAt: completed.courseCompletedAt });
		expect(() => selectLearningStage(defaultLearningProgress(), 2)).toThrow();
	});

	it('段階13の条件達成で全課程を修了する', () => {
		let progress = { ...defaultLearningProgress(), currentStageId: 13, highestUnlockedStageId: 13, consecutivePasses: 2 };
		progress = applySubmissionToProgress(progress, submission('final', 13));
		expect(progress.currentStageId).toBe(13);
		expect(progress.courseCompletedAt).not.toBeNull();
	});
});

describe('problem generation and rotation', () => {
	it('履歴がある時は苦手50%・中核30%・探索20%の10問周期になる', () => {
		expect(Array.from({ length: 10 }, (_, attempt) => selectionReasonForAttempt(attempt, true))).toEqual([
			'weakness', 'weakness', 'weakness', 'weakness', 'weakness', 'core', 'core', 'core', 'exploration', 'exploration',
		]);
	});
	it('未提出の発行済み問題を再表示し、重複発行を防ぐ', () => {
		const state = emptyState();
		const first = selectNextPracticeTask(state)!;
		state.problemHistory = [{ taskId: first.id, stageId: 1, taskTitle: first.title, prompt: first.prompt, hint: first.hint, features: first.features!, promptHash: promptHash(first.prompt), issuedAt: '2026-08-25T00:00:00Z', submittedAt: null }];
		expect(selectNextPracticeTask(state)?.id).toBe(first.id);
	});

	it('問題IDから選択理由と対象技能を同じ内容で復元する', () => {
		const state = emptyState();
		const selected = selectNextPracticeTask(state)!;
		const restored = resolvePracticeTask(selected.id)!;
		expect(restored.features).toEqual(selected.features);
		expect(restored.title).toBe(selected.title);
	});

	it('段階別特徴署名で履歴との類似度が低い未使用問題を選ぶ', () => {
		const state = emptyState();
		state.problemHistory = Array.from({ length: 12 }, (_, seed) => history(seed));
		const next = selectNextPracticeTask(state)!;
		expect(state.problemHistory.some((item) => item.features.fingerprint === next.features?.fingerprint)).toBe(false);
		const similarity = Math.max(...state.problemHistory.map((item) => featureSignatureSimilarity(item.features, next.features!)));
		expect(similarity).toBeLessThan(1);
		expect(state.problemHistory.every((item) => promptSimilarity(item.prompt, next.prompt) < 1)).toBe(true);
	});

	it('以前の段階へ戻っても、その段階の全履歴を使って別傾向を選ぶ', () => {
		const state = emptyState();
		state.progress = { ...state.progress, currentStageId: 1, highestUnlockedStageId: 3 };
		state.problemHistory = [history(0), history(1), history(2)];
		const next = selectNextPracticeTask(state)!;
		expect(state.problemHistory.map((item) => item.taskId)).not.toContain(next.id);
	});

	it('承認済み問題を使い切った後は重点を変えたローカル代替問題を作る', () => {
		const first = generatePracticeTask(1, 0);
		const afterOneCycle = generatePracticeTask(1, 10);
		expect(afterOneCycle.prompt).not.toBe(first.prompt);
		expect(afterOneCycle.features?.fingerprint).not.toBe(first.features?.fingerprint);
		expect(afterOneCycle.features?.generation.source).toBe('local_variant');
	});

	it('苦手技能がある場合は10問中5問の枠でその技能を狙う', () => {
		const state = emptyState();
		state.skillStats = updateSkillStats({}, 1, [{ skillKey: 'subject_predicate', outcome: 'missed', severity: 2, evidence: '主述不一致' }], '2026-08-25T00:00:00Z');
		const next = selectNextPracticeTask(state)!;
		expect(next.features).toMatchObject({ selectionReason: 'weakness' });
		expect(next.features?.skillTargets).toContain('subject_predicate');
	});

	it('初回達成した技能を数値の平滑化だけで苦手扱いしない', () => {
		const stats = updateSkillStats({}, 1, [{ skillKey: 'subject_predicate', outcome: 'achieved', severity: 0, evidence: '達成' }], '2026-08-25T00:00:00Z');
		expect(stats['1:subject_predicate'].masteryScore).toBeLessThan(0.75);
		expect(weakestSkillsForStage(stats, 1)).toEqual([]);
	});

	it('AIへ渡す問題仕様には答案や全履歴を含めず、回避指紋を12件に制限する', () => {
		const specification = createProblemSpecification(10, 3, { avoidFingerprints: Array.from({ length: 20 }, (_, index) => `old-${index}`) });
		expect(specification).toMatchObject({ stageId: 10, promptFamily: 'source-based-opinion', maximumPromptCharacters: 8000 });
		expect(specification.avoidFingerprints).toHaveLength(12);
		expect(JSON.stringify(specification)).not.toContain('answer');
	});

	it('未知の技能コードを含む特徴署名を拒否する', () => {
		const signature = generatePracticeTask(1, 0).features!;
		expect(isProblemFeatureSignature({ ...signature, skillTargets: ['unknown_skill'] })).toBe(false);
	});

	it('狙う技能に合う未使用の承認済み問題をローカル代替より優先する', () => {
		const state = emptyState();
		const bankTask = generatePracticeTask(1, 20, { selectionReason: 'core', targetSkill: 'sentence_completion' });
		bankTask.id = 'approved-bank-problem';
		bankTask.problemId = '00000000-0000-0000-0000-000000000001';
		bankTask.features = { ...bankTask.features!, generation: { ...bankTask.features!.generation, source: 'ai', model: 'test-model' } };
		state.approvedProblems = [bankTask];
		expect(selectNextPracticeTask(state)).toMatchObject({ id: bankTask.id, problemId: bankTask.problemId });
	});

	it('13段階の全テンプレートに題材分類と段階別技能が定義されている', () => {
		for (let stageId = 1; stageId <= 13; stageId += 1) {
			for (let seed = 0; seed < 10; seed += 1) {
				const task = generatePracticeTask(stageId, seed);
				expect(task.features?.topicDomain).toBeTruthy();
				expect(task.features?.skillTargets.length).toBeGreaterThan(0);
			}
		}
	});
});
