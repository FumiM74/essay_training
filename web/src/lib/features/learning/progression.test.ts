import { describe, expect, it } from 'vitest';
import type { FeedbackResult } from '$lib/types/contracts';
import type { LearningProgress, LocalLearningState, ProblemHistoryRecord, SubmissionRecord } from '$lib/types/learning';
import { basicQuestionSet, createProblemSpecification, generatePracticeTask, historyTask, isProblemFeatureSignature, practiceTaskPromptHash, resolvePracticeTask } from './problem-generator';

import { createBasicQuestionSetFeedback } from './feedback';
import { applySubmissionToProgress, defaultLearningProgress, featureSignatureSimilarity, restoredSubmissionProgressMessage, selectLearningStage, selectNextPracticeTask, submissionDecisionLabel, submissionProgressMessage } from './progression';
import { updateSkillStats, weakestSkillsForStage } from './mastery';
import { selectionReasonForAttempt, skillGuidanceFor, stageAnswerExampleFor } from './learning-design';

const pass: FeedbackResult = { schemaVersion: '1', languageStatus: 'clean', decision: 'pass', priorityFeedback: [], skillResults: [] };
const revise: FeedbackResult = { schemaVersion: '1', languageStatus: 'minor_issue', decision: 'revise', priorityFeedback: [], skillResults: [] };

function submission(id: string, stageId: number, decision: 'pass' | 'revise' = 'pass'): SubmissionRecord {
	return { id, taskId: id, stageId, taskTitle: id, text: '本文です。', submittedAt: `2026-08-25T00:00:0${id.length % 10}Z`, feedback: decision === 'pass' ? pass : revise, phase: 'training' };
}

function emptyState(): LocalLearningState {
	return { version: 5, drafts: {}, submissions: [], problemHistory: [], skillStats: {}, progress: defaultLearningProgress() };
}

function history(seed: number, submitted = true, stageId = 1): ProblemHistoryRecord {
	const task = generatePracticeTask(stageId, seed);
	return { taskId: task.id, stageId, taskTitle: task.title, prompt: task.prompt, hint: task.hint, features: task.features!, promptHash: practiceTaskPromptHash(task), issuedAt: `2026-08-25T00:00:${String(seed).padStart(2, '0')}Z`, submittedAt: submitted ? `2026-08-25T00:01:${String(seed).padStart(2, '0')}Z` : null, phase: 'training' };
}

describe('stage progression', () => {
	it('画面停止後にDBから復元した提出結果の進行状況を説明する', () => {
		const trainingPass = submission('training-pass', 1);
		expect(restoredSubmissionProgressMessage(trainingPass, { ...defaultLearningProgress(), phasePasses: 1 })).toBe('進級テストまであと9問');
		expect(restoredSubmissionProgressMessage(trainingPass, { ...defaultLearningProgress(), phase: 'promotion_test', phasePasses: 0 })).toBe('次の問題から3問の進級テストです。');
		expect(restoredSubmissionProgressMessage({ ...trainingPass, phase: 'promotion_test' }, { ...defaultLearningProgress(), currentStageId: 2, highestUnlockedStageId: 2 })).toBe('段階2へ進みました。');
		expect(restoredSubmissionProgressMessage({ ...submission('test-fail', 1, 'revise'), phase: 'promotion_test' }, { ...defaultLearningProgress(), phase: 'retraining' })).toBe('進級テストは不合格でした。次は再トレーニングです。');
	});

	it('再提出できる結果は段階やフェーズにかかわらず要修正と表示する', () => {
		expect(submissionDecisionLabel('promotion_test', 'revise')).toBe('要修正');
		expect(submissionDecisionLabel('training', 'revise')).toBe('要修正');
		expect(submissionDecisionLabel('retraining', 'revise')).toBe('要修正');
		expect(submissionDecisionLabel('promotion_test', 'pass')).toBe('合格');
	});

	it('通常訓練は初期値10問で、規定数の合格後に進級テストへ移る', () => {
		expect(defaultLearningProgress().requiredTrainingPasses).toBe(10);
		let progress = { ...defaultLearningProgress(), requiredTrainingPasses: 3 };
		progress = applySubmissionToProgress(progress, submission('one', 1));
		progress = applySubmissionToProgress(progress, submission('two', 1));
		expect(progress).toMatchObject({ currentStageId: 1, highestUnlockedStageId: 1, phase: 'training', phasePasses: 2 });
		progress = applySubmissionToProgress(progress, submission('three', 1));
		expect(progress).toMatchObject({ currentStageId: 1, phase: 'promotion_test', phasePasses: 0 });
		for (const id of ['test-1', 'test-2', 'test-3']) progress = applySubmissionToProgress(progress, { ...submission(id, 1), phase: 'promotion_test' });
		expect(progress).toMatchObject({ currentStageId: 2, highestUnlockedStageId: 2, phase: 'training', phasePasses: 0 });
	});

	it('通常訓練と進級テストの不合格では合格数を減らさない', () => {
		let progress = applySubmissionToProgress(defaultLearningProgress(), submission('one', 1));
		progress = applySubmissionToProgress(progress, submission('wrong-stage', 2));
		expect(progress.phasePasses).toBe(1);
		progress = applySubmissionToProgress(progress, submission('revise', 1, 'revise'));
		expect(progress).toMatchObject({ currentStageId: 1, phase: 'training', phasePasses: 1 });
		progress = { ...progress, phase: 'promotion_test', phasePasses: 1, phaseAttempts: 1 };
		progress = applySubmissionToProgress(progress, { ...submission('failed-test', 1, 'revise'), phase: 'promotion_test' });
		expect(progress).toMatchObject({ phase: 'promotion_test', phasePasses: 1, phaseAttempts: 2 });
	});

	it('進級テストは不合格を挟んでも規定合格数に達すれば進級する', () => {
		let progress: LearningProgress = { ...defaultLearningProgress(), phase: 'promotion_test' };
		for (const [id, decision] of [['pass-1', 'pass'], ['fail-1', 'revise'], ['pass-2', 'pass'], ['fail-2', 'revise'], ['pass-3', 'pass']] as const) {
			progress = applySubmissionToProgress(progress, { ...submission(id, 1, decision), phase: 'promotion_test' });
		}
		expect(progress).toMatchObject({ currentStageId: 2, highestUnlockedStageId: 2, phase: 'training', phasePasses: 0, phaseAttempts: 0 });
	});

	it('到達済み段階へ戻れて、最高到達段階と修了記録を失わない', () => {
		const completed = { ...defaultLearningProgress(), currentStageId: 14, highestUnlockedStageId: 14, courseCompletedAt: '2026-08-25T00:00:00Z' };
		const returned = selectLearningStage(completed, 4);
		expect(returned).toMatchObject({ currentStageId: 4, highestUnlockedStageId: 14, phase: 'training', phasePasses: 0, courseCompletedAt: completed.courseCompletedAt });
		expect(() => selectLearningStage(defaultLearningProgress(), 2)).toThrow();
	});

	it('復習後に最高到達段階へ戻ると進級テストの状態を復元する', () => {
		const frontier = { ...defaultLearningProgress(), currentStageId: 5, highestUnlockedStageId: 5, phase: 'promotion_test' as const, phasePasses: 2, phaseAttempts: 3, frontierPhase: 'promotion_test' as const, frontierPhasePasses: 2, frontierPhaseAttempts: 3 };
		const reviewing = selectLearningStage(frontier, 2);
		expect(reviewing).toMatchObject({ currentStageId: 2, highestUnlockedStageId: 5, phase: 'training', phasePasses: 0, frontierPhase: 'promotion_test', frontierPhasePasses: 2, frontierPhaseAttempts: 3 });
		const resumed = selectLearningStage(reviewing, 5);
		expect(resumed).toMatchObject({ currentStageId: 5, highestUnlockedStageId: 5, phase: 'promotion_test', phasePasses: 2, phaseAttempts: 3 });
	});

	it('完了済み段階の復習提出は先の段階を閉じず、全段階の進級は即時に保存される', () => {
		const reviewing = { ...defaultLearningProgress(), currentStageId: 2, highestUnlockedStageId: 5 };
		const reviewed = applySubmissionToProgress(reviewing, submission('review-pass', 2));
		expect(reviewed).toMatchObject({ currentStageId: 2, highestUnlockedStageId: 5, phase: 'training' });

		for (let stageId = 1; stageId < 14; stageId += 1) {
			const before = { ...defaultLearningProgress(), currentStageId: stageId, highestUnlockedStageId: stageId, phase: 'promotion_test' as const, phasePasses: 2, phaseAttempts: 2, frontierPhase: 'promotion_test' as const, frontierPhasePasses: 2, frontierPhaseAttempts: 2 };
			const after = applySubmissionToProgress(before, { ...submission(`promotion-${stageId}`, stageId), phase: 'promotion_test' });
			expect(after).toMatchObject({ currentStageId: stageId + 1, highestUnlockedStageId: stageId + 1, phase: 'training', phasePasses: 0 });
		}
	});

	it('段階14の条件達成で全課程を修了する', () => {
		let progress: LearningProgress = { ...defaultLearningProgress(), currentStageId: 14, highestUnlockedStageId: 14, phase: 'promotion_test', phasePasses: 2, phaseAttempts: 2 };
		progress = applySubmissionToProgress(progress, { ...submission('final', 14), phase: 'promotion_test' });
		expect(progress.currentStageId).toBe(14);
		expect(progress.courseCompletedAt).not.toBeNull();
		expect(progress).toMatchObject({ phase: 'training', phasePasses: 0, phaseAttempts: 0 });
	});

	it('提出後は判定と次の節目までの残り合格数を表示する', () => {
		const before = { ...defaultLearningProgress(), requiredTrainingPasses: 3, phasePasses: 1 };
		const revised = applySubmissionToProgress(before, submission('revise-message', 1, 'revise'));
		expect(submissionProgressMessage(before, revised, 'revise')).toBe('進級テストまであと2問');
		const passed = applySubmissionToProgress(before, submission('pass-message', 1));
		expect(submissionProgressMessage(before, passed, 'pass')).toBe('進級テストまであと1問');
		const testBefore = { ...defaultLearningProgress(), phase: 'promotion_test' as const, phasePasses: 1, phaseAttempts: 2 };
		const testFailed = applySubmissionToProgress(testBefore, { ...submission('test-fail-message', 1, 'revise'), phase: 'promotion_test' });
		expect(submissionProgressMessage(testBefore, testFailed, 'revise')).toBe('合格数は1/3のままです。同じ問題を修正して再提出してください。');
	});

	it('進級した場合の案内は段階名だけを表示する', () => {
		const before = { ...defaultLearningProgress(), phase: 'promotion_test' as const, phasePasses: 2 };
		const after = { ...defaultLearningProgress(), currentStageId: 2, highestUnlockedStageId: 2 };
		expect(submissionProgressMessage(before, after, 'pass')).toBe('段階2へ進みました。');
	});
});

describe('problem generation and rotation', () => {
	it.each([1, 2, 3, 4, 7, 14])('段階%sの候補が尽きても既出問題を返さない', (stageId) => {
		const state = emptyState();
		state.progress = { ...state.progress, currentStageId: stageId, highestUnlockedStageId: stageId };
		const seen = new Set<string>();
		for (let i = 0; i < 100; i++) {
			const task = selectNextPracticeTask(state);
			if (!task) { expect(seen.size).toBeGreaterThan(0); return; }
			const hash = practiceTaskPromptHash(task);
			expect(seen.has(hash)).toBe(false);
			seen.add(hash);
			state.problemHistory.unshift({ taskId: task.id, stageId, taskTitle: task.title, prompt: task.prompt, hint: task.hint, features: task.features!, promptHash: hash, issuedAt: '2026-09-05', submittedAt: '2026-09-05', phase: 'training' });
		}
		throw new Error('有限のモック問題を使い切る想定');
	});
	it('全段階のヒントと技能別案内に抽象的な旧表現を残さない', () => {
		const unclearPhrases = /助詞を確認|助詞の働きを確かめ|中心をそろえ|接点を示|一貫させましょう/;
		for (let stageId = 1; stageId <= 14; stageId += 1) {
			for (let seed = 0; seed < 10; seed += 1) expect(generatePracticeTask(stageId, seed).hint).not.toMatch(unclearPhrases);
			for (const skill of generatePracticeTask(stageId, 0).features!.skillTargets) expect(skillGuidanceFor(skill)).not.toMatch(unclearPhrases);
		}
	});

	it('段階2の全問題で指定されたヒントを表示する', () => {
		const expected = '各問題の指示を読み、情報どうしの関係が迷わず伝わる一文を作りましょう。必要な内容を選び、説明する言葉は説明される言葉の近くに置いてください。';
		for (let seed = 0; seed < 20; seed += 1) expect(generatePracticeTask(2, seed).hint).toBe(expected);
	});

	it('固定解答例は自由記述を始める段階2〜6だけに表示する', () => {
		expect(stageAnswerExampleFor(1)).toBeNull();
		for (let stageId = 2; stageId <= 6; stageId += 1) expect(stageAnswerExampleFor(stageId)).not.toBeNull();
		for (let stageId = 7; stageId <= 14; stageId += 1) expect(stageAnswerExampleFor(stageId)).toBeNull();
	});

	it('履歴がある時は苦手50%・中核30%・探索20%の10問周期になる', () => {
		expect(Array.from({ length: 10 }, (_, attempt) => selectionReasonForAttempt(attempt, true))).toEqual([
			'weakness', 'weakness', 'weakness', 'weakness', 'weakness', 'core', 'core', 'core', 'exploration', 'exploration',
		]);
	});
	it('未提出の発行済み問題を再表示し、重複発行を防ぐ', () => {
		const state = emptyState();
		const first = selectNextPracticeTask(state)!;
		state.problemHistory = [{ taskId: first.id, stageId: 1, taskTitle: first.title, prompt: first.prompt, hint: first.hint, features: first.features!, promptHash: practiceTaskPromptHash(first), issuedAt: '2026-08-25T00:00:00Z', submittedAt: null, phase: 'training' }];
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
		state.progress = { ...state.progress, currentStageId: 2, highestUnlockedStageId: 2 };
		state.problemHistory = Array.from({ length: 5 }, (_, seed) => history(seed, true, 2));
		const next = selectNextPracticeTask(state)!;
		expect(state.problemHistory.some((item) => item.features.fingerprint === next.features?.fingerprint)).toBe(false);
		const similarity = Math.max(...state.problemHistory.map((item) => featureSignatureSimilarity(item.features, next.features!)));
		expect(similarity).toBeLessThan(1);
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
		expect(afterOneCycle.prompt).toBe(first.prompt);
		expect(afterOneCycle.prompt).not.toMatch(/（セット\d+）/);
		expect(afterOneCycle.questionSet?.map((question) => question.id)).not.toEqual(first.questionSet?.map((question) => question.id));
		expect(afterOneCycle.features?.fingerprint).not.toBe(first.features?.fingerprint);
		expect(afterOneCycle.features?.generation.source).toBe('local_variant');
		expect(afterOneCycle.prompt).not.toContain('主語と述語の対応を明確に');
		expect(afterOneCycle.hint).toContain('主語と述語');
	});

	it('段階1の固定10セットを使い切った後は、同期選択で重複問題を返さない', () => {
		const state = emptyState();
		state.problemHistory = Array.from({ length: 10 }, (_, seed) => history(seed));
		expect(selectNextPracticeTask(state)).toBeUndefined();
	});

	it('旧版で発行済みの問題も表示時に評価指示を本文からヒントへ移す', () => {
		const record = history(10);
		record.prompt = `${record.prompt}\n\n主語と述語の対応を明確にすることが伝わる書き方を選んでください。`;
		record.features = { ...record.features, generation: { ...record.features.generation, promptVersion: 'adaptive-local-v1' } };
		const task = historyTask(record);
		expect(task.prompt).not.toContain('主語と述語の対応を明確に');
		expect(task.hint).toContain('主語と述語');
	});

	it('旧版の発行済み問題も現在の分かりやすいヒントへ置き換える', () => {
		const record = history(0, false, 2);
		record.hint = '助詞を確認し、どの説明がどの言葉にかかるかを明確にしましょう。';
		record.features = { ...record.features, generation: { ...record.features.generation, promptVersion: 'adaptive-local-v2' } };
		const task = historyTask(record);
		expect(task.hint).toContain('情報どうしの関係');
		expect(task.hint).not.toContain('助詞を確認');
	});

	it('旧版で発行済みの段階3問題も3問の論理構成課題へ置き換える', () => {
		const record = history(8, false, 3);
		record.prompt = '次の二文の関係が伝わるように、接続する言葉を補ってください。「制服は必要だ。負担を減らせるからだ。」';
		record.features = { ...record.features, generation: { ...record.features.generation, promptVersion: 'adaptive-local-v5' } };
		const task = historyTask(record);
		expect(task.prompt).toContain('論理の流れを整える3問');
		expect(task.questionSet).toHaveLength(3);
		expect(task.prompt).not.toContain('接続する言葉を補ってください');
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
		state.progress = { ...state.progress, currentStageId: 4, highestUnlockedStageId: 4 };
		const bankTask = generatePracticeTask(4, 20, { selectionReason: 'core', targetSkill: 'clear_claim' });
		bankTask.id = 'approved-bank-problem';
		bankTask.problemId = '00000000-0000-0000-0000-000000000001';
		bankTask.features = { ...bankTask.features!, generation: { ...bankTask.features!.generation, source: 'ai', model: 'test-model' } };
		state.approvedProblems = [bankTask];
		expect(selectNextPracticeTask(state)).toMatchObject({ id: bankTask.id, problemId: bankTask.problemId });
	});

	it('14段階の全テンプレートに題材分類と段階別技能が定義されている', () => {
		for (let stageId = 1; stageId <= 14; stageId += 1) {
			for (let seed = 0; seed < 10; seed += 1) {
				const task = generatePracticeTask(stageId, seed);
				expect(task.features?.topicDomain).toBeTruthy();
				expect(task.features?.skillTargets.length).toBeGreaterThan(0);
			}
		}
	});

	it('自由設定ではSTEP 4以降に登録テーマを順番に使い、ランダム問題と混ぜない', () => {
		const state = emptyState();
		state.progress = { ...state.progress, currentStageId: 4, highestUnlockedStageId: 4, topicSelectionMode: 'custom', customTopics: ['地域医療', '少子化'] };
		const first = selectNextPracticeTask(state)!;
		expect(first.features?.customTopic).toBe('地域医療');
		state.problemHistory.unshift({ taskId: first.id, stageId: 4, taskTitle: first.title, prompt: first.prompt, hint: first.hint, features: first.features!, promptHash: practiceTaskPromptHash(first), issuedAt: '2026-09-10', submittedAt: '2026-09-10', phase: 'training' });
		expect(selectNextPracticeTask(state)?.features?.customTopic).toBe('少子化');
	});

	it('ランダム設定では自由設定から共有バンクへ生成された問題を選ばない', () => {
		const state = emptyState();
		state.progress = { ...state.progress, currentStageId: 4, highestUnlockedStageId: 4 };
		const custom = generatePracticeTask(4, 0, { customTopic: '地域医療', selectionReason: 'core', targetSkill: 'clear_claim' });
		custom.features = { ...custom.features!, generation: { ...custom.features!.generation, source: 'ai' } };
		state.approvedProblems = [custom];
		expect(selectNextPracticeTask(state)?.features?.customTopic).toBeUndefined();
	});

	it('段階1は異なる5領域から1問ずつ出し、全問正解だけを合格にする', () => {
		const questions = basicQuestionSet(0);
		expect(generatePracticeTask(1, 0).features?.skillTargets).toHaveLength(5);
		expect(questions).toHaveLength(5);
		expect(new Set(questions.map((question) => question.category)).size).toBe(5);
		const correct = Object.fromEntries(questions.map((question) => [question.id, question.acceptedAnswers[0]]));
		expect(createBasicQuestionSetFeedback(questions, correct).decision).toBe('pass');
		const oneWrong = { ...correct, [questions[0].id]: '誤答' };
		const feedback = createBasicQuestionSetFeedback(questions, oneWrong);
		expect(feedback.decision).toBe('revise');
		expect(feedback.priorityFeedback).toHaveLength(5);
		const correctedAnswers = { ...oneWrong, [questions[0].id]: questions[0].acceptedAnswers[0], [questions[1].id]: '別の誤答' };
		const cumulative = createBasicQuestionSetFeedback(questions, correctedAnswers, feedback);
		expect(cumulative.basicQuestionResults?.[1].correct).toBe(true);
		expect(cumulative.decision).toBe('pass');
	});
});
