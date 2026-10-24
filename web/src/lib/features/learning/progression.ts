import { MAX_STAGE_ID, TOTAL_STAGE_COUNT, type PracticeTask, type ProblemFeatureSignature, type SkillKey } from '$lib/types/curriculum';
import type { FeedbackDecision } from '$lib/types/contracts';
import type { LearningPhase, LearningProgress, LocalLearningState, SubmissionRecord } from '$lib/types/learning';
import { generatePracticeTask, generatedTaskSeed, historyTask, practiceTaskPromptHash, promptSimilarity } from './problem-generator';
import { customTopicKey } from './topic-preferences';
import { getStageProblemDesign, selectionReasonForAttempt } from './learning-design';
import { weakestSkillsForStage } from './mastery';

export const DEFAULT_REQUIRED_TRAINING_PASSES = 10;
export const DEFAULT_PROMOTION_TEST_QUESTIONS = 3;
export const DEFAULT_REQUIRED_RETRAINING_PASSES = 3;
export const MIN_PROGRESSION_COUNT = 1;
export const MAX_PROGRESSION_COUNT = 10;

export function defaultLearningProgress(): LearningProgress {
	return {
		currentStageId: 1,
		highestUnlockedStageId: 1,
		phase: 'training',
		phasePasses: 0,
		phaseAttempts: 0,
		frontierPhase: 'training',
		frontierPhasePasses: 0,
		frontierPhaseAttempts: 0,
		requiredTrainingPasses: DEFAULT_REQUIRED_TRAINING_PASSES,
		promotionTestQuestionCount: DEFAULT_PROMOTION_TEST_QUESTIONS,
		requiredRetrainingPasses: DEFAULT_REQUIRED_RETRAINING_PASSES,
		easyFeedbackEnabled: false,
		topicSelectionMode: 'random',
		customTopics: [],
		courseCompletedAt: null,
	};
}

export function isValidRequiredPasses(value: number): boolean {
	return Number.isInteger(value) && value >= MIN_PROGRESSION_COUNT && value <= MAX_PROGRESSION_COUNT;
}

export function isLearningPhase(value: unknown): value is LearningPhase {
	return value === 'training' || value === 'promotion_test' || value === 'retraining';
}

export function phaseLabel(phase: LearningPhase): string {
	return phase === 'promotion_test' ? '進級テスト' : 'トレーニング';
}

export function submissionDecisionLabel(phase: LearningPhase, decision: FeedbackDecision, stageId?: number): string {
	if (decision === 'pass') return '合格';
	return '要修正';
}

export function phaseTarget(progress: LearningProgress): number {
	return progress.phase === 'training' ? progress.requiredTrainingPasses
		: progress.promotionTestQuestionCount;
}

export function submissionProgressMessage(before: LearningProgress, after: LearningProgress, decision: FeedbackDecision): string {
	if (!before.courseCompletedAt && after.courseCompletedAt) return `合格。段階${MAX_STAGE_ID}の進級テストに合格し、全課程を修了しました。`;
	if (after.currentStageId > before.currentStageId) return `段階${after.currentStageId}へ進みました。`;
	if (before.phase !== 'promotion_test' && after.phase === 'promotion_test') {
		return `合格。次の問題から${after.promotionTestQuestionCount}問の進級テストです。`;
	}
	if (after.phase === 'promotion_test') {
		const remaining = Math.max(0, after.promotionTestQuestionCount - after.phasePasses);
		const destination = after.currentStageId === MAX_STAGE_ID ? '全課程修了' : '次の段階';
		return decision === 'pass'
			? `合格。${destination}まで、進級テストであと${remaining}問合格です。`
			: `合格数は${after.phasePasses}/${after.promotionTestQuestionCount}のままです。同じ問題を修正して再提出してください。`;
	}
	const target = after.requiredTrainingPasses;
	const remaining = Math.max(0, target - after.phasePasses);
	return `進級テストまであと${remaining}問`;
}

export function restoredSubmissionProgressMessage(submission: SubmissionRecord, current: LearningProgress): string {
	const passed = submission.feedback.decision === 'pass';
	if (passed && submission.stageId === MAX_STAGE_ID && submission.phase === 'promotion_test' && current.courseCompletedAt) {
		return `段階${MAX_STAGE_ID}の進級テストに合格し、全課程を修了しました。`;
	}
	if (passed && current.currentStageId > submission.stageId) return `段階${current.currentStageId}へ進みました。`;
	if (submission.phase === 'promotion_test') {
		if (!passed && current.currentStageId === submission.stageId && current.phase === 'retraining') {
			return '進級テストは不合格でした。次は再トレーニングです。';
		}
		const remaining = Math.max(0, current.promotionTestQuestionCount - current.phasePasses);
		const destination = submission.stageId === MAX_STAGE_ID ? '全課程修了' : '次の段階';
		return passed
			? `${destination}まで、進級テストであと${remaining}問合格です。`
			: `同じ問題を修正して再提出してください。合格数は${current.phasePasses}/${current.promotionTestQuestionCount}のままです。`;
	}
	if (passed && current.currentStageId === submission.stageId && current.phase === 'promotion_test') {
		return `次の問題から${current.promotionTestQuestionCount}問の進級テストです。`;
	}
	return `進級テストまであと${Math.max(0, current.requiredTrainingPasses - current.phasePasses)}問`;
}

export function applySubmissionToProgress(progress: LearningProgress, submission: SubmissionRecord): LearningProgress {
	if (submission.stageId !== progress.currentStageId) return progress;
	if (submission.phase !== progress.phase) return progress;
	const passed = submission.feedback.decision === 'pass';
	if (progress.currentStageId < progress.highestUnlockedStageId) {
		if (!passed || progress.phase === 'promotion_test') return progress;
		return { ...progress, phasePasses: Math.min(progress.phasePasses + 1, Math.max(0, progress.requiredTrainingPasses - 1)) };
	}
	if (progress.phase === 'promotion_test') {
		const passedQuestions = progress.phasePasses + (passed ? 1 : 0);
		const attempts = progress.phaseAttempts + 1;
		if (passedQuestions < progress.promotionTestQuestionCount) return { ...progress, phasePasses: passedQuestions, phaseAttempts: attempts, frontierPhase: 'promotion_test', frontierPhasePasses: passedQuestions, frontierPhaseAttempts: attempts };
		if (progress.currentStageId === MAX_STAGE_ID) return { ...progress, highestUnlockedStageId: MAX_STAGE_ID, phase: 'training', phasePasses: 0, phaseAttempts: 0, frontierPhase: 'training', frontierPhasePasses: 0, frontierPhaseAttempts: 0, courseCompletedAt: progress.courseCompletedAt ?? submission.submittedAt };
		const nextStage = progress.currentStageId + 1;
		return { ...progress, currentStageId: nextStage, highestUnlockedStageId: Math.max(progress.highestUnlockedStageId, nextStage), phase: 'training', phasePasses: 0, phaseAttempts: 0, frontierPhase: 'training', frontierPhasePasses: 0, frontierPhaseAttempts: 0 };
	}
	if (!passed) return progress;
	const passes = progress.phasePasses + 1;
	const target = progress.requiredTrainingPasses;
	if (passes < target) return { ...progress, phasePasses: passes, frontierPhase: 'training', frontierPhasePasses: passes, frontierPhaseAttempts: progress.phaseAttempts };
	return { ...progress, phase: 'promotion_test', phasePasses: 0, phaseAttempts: 0, frontierPhase: 'promotion_test', frontierPhasePasses: 0, frontierPhaseAttempts: 0 };
}

export function deriveProgress(submissions: SubmissionRecord[], required = DEFAULT_REQUIRED_TRAINING_PASSES): LearningProgress {
	let progress = { ...defaultLearningProgress(), requiredTrainingPasses: required };
	for (const submission of [...submissions].reverse()) progress = applySubmissionToProgress(progress, submission);
	return progress;
}

export function completedStageCount(progress: LearningProgress): number {
	return progress.courseCompletedAt ? TOTAL_STAGE_COUNT : Math.max(0, progress.highestUnlockedStageId - 1);
}

export function selectLearningStage(progress: LearningProgress, stageId: number): LearningProgress {
	if (!Number.isInteger(stageId) || stageId < 1 || stageId > progress.highestUnlockedStageId) throw new Error('未到達の段階は選べません。');
	const frontier = progress.currentStageId === progress.highestUnlockedStageId
		? { phase: progress.phase, passes: progress.phasePasses, attempts: progress.phaseAttempts }
		: { phase: progress.frontierPhase, passes: progress.frontierPhasePasses, attempts: progress.frontierPhaseAttempts };
	if (stageId === progress.highestUnlockedStageId) {
		return { ...progress, currentStageId: stageId, phase: frontier.phase, phasePasses: frontier.passes, phaseAttempts: frontier.attempts, frontierPhase: frontier.phase, frontierPhasePasses: frontier.passes, frontierPhaseAttempts: frontier.attempts };
	}
	return { ...progress, currentStageId: stageId, phase: 'training', phasePasses: 0, phaseAttempts: 0, frontierPhase: frontier.phase, frontierPhasePasses: frontier.passes, frontierPhaseAttempts: frontier.attempts };
}

function overlap(left: string[], right: string[]): number {
	const a = new Set(left);
	const b = new Set(right);
	let common = 0;
	for (const item of a) if (b.has(item)) common += 1;
	return common / (a.size + b.size - common || 1);
}

const optionalFeatureKeys = [
	'languagePattern', 'perspective', 'reasoning', 'evidenceMode', 'structurePattern', 'sourceStructure',
	'summaryOperation', 'issueConflict', 'sourceUse', 'counterposition', 'responseStrategy', 'synthesisPattern',
] as const;

export function featureSignatureSimilarity(left: ProblemFeatureSignature, right: ProblemFeatureSignature): number {
	let weight = 4.5;
	let score = (left.topicKey === right.topicKey ? 2 : left.topicDomain === right.topicDomain ? 0.7 : 0)
		+ (left.promptFamily === right.promptFamily ? 0.75 : 0)
		+ overlap(left.skillTargets, right.skillTargets) * 1.25
		+ (left.surfacePattern === right.surfacePattern ? 0.5 : 0);
	for (const key of optionalFeatureKeys) {
		const leftValue = left[key];
		const rightValue = right[key];
		if (leftValue === undefined || rightValue === undefined) continue;
		weight += 0.5;
		if (leftValue === rightValue) score += 0.5;
	}
	return score / weight;
}

function selectedSkill(state: LocalLearningState, stageId: number, attempt: number, reason: 'weakness' | 'core' | 'exploration'): SkillKey {
	const design = getStageProblemDesign(stageId);
	const weak = weakestSkillsForStage(state.skillStats, stageId);
	if (reason === 'weakness' && weak.length) return weak[attempt % weak.length];
	return design.coreSkills[attempt % design.coreSkills.length];
}

export function selectNextPracticeTask(state: LocalLearningState): PracticeTask | undefined {
	const stageId = state.progress.currentStageId;
	const stageHistory = state.problemHistory.filter((item) => item.stageId === stageId);
	const active = stageHistory.find((item) => item.submittedAt === null);
	if (active) return historyTask(active);

	const fingerprints = new Set(stageHistory.map((item) => item.features.fingerprint));
	// Include reconstructed content for stage-1 history written with the old heading-only hash.
	const promptHashes = new Set(stageHistory.flatMap((item) => [item.promptHash, practiceTaskPromptHash(historyTask(item))]));
	const largestSeed = stageHistory.reduce((largest, item) => Math.max(largest, generatedTaskSeed(item.taskId) ?? item.features.seed), -1);
	const startSeed = largestSeed + 1;
	const completedAttempts = stageHistory.filter((item) => item.submittedAt !== null).length;
	const weak = weakestSkillsForStage(state.skillStats, stageId);
	const selectionReason = state.progress.phase === 'promotion_test' ? 'core'
		: state.progress.phase === 'retraining' && weak.length > 0 ? 'weakness'
			: selectionReasonForAttempt(completedAttempts, weak.length > 0);
	const targetSkill = selectedSkill(state, stageId, completedAttempts, selectionReason);
	const customTopic = stageId >= 4 && state.progress.topicSelectionMode === 'custom'
		? state.progress.customTopics[completedAttempts % state.progress.customTopics.length]
		: undefined;
	const preferredTopicKey = customTopic ? customTopicKey(customTopic) : undefined;
	const topicUsage = new Map<string, number>();
	const domainUsage = new Map<string, number>();
	for (const item of state.problemHistory) {
		topicUsage.set(item.features.topicKey, (topicUsage.get(item.features.topicKey) ?? 0) + 1);
		domainUsage.set(item.features.topicDomain, (domainUsage.get(item.features.topicDomain) ?? 0) + 1);
	}
	const recent = stageHistory.slice(0, 12);
	let bestBank: PracticeTask | undefined;
	let bestBankScore = Number.POSITIVE_INFINITY;
	for (const candidate of state.approvedProblems ?? []) {
		if (candidate.stageId !== stageId || !candidate.features || !candidate.features.skillTargets.includes(targetSkill)) continue;
		if (preferredTopicKey ? candidate.features.topicKey !== preferredTopicKey : candidate.features.customTopic !== undefined) continue;
		if (stageHistory.some((item) => item.taskId === candidate.id) || fingerprints.has(candidate.features.fingerprint)) continue;
		const candidateHash = practiceTaskPromptHash(candidate);
		if (promptHashes.has(candidateHash)) continue;
		const semanticSimilarity = recent.reduce((maximum, previous) => Math.max(maximum, featureSignatureSimilarity(candidate.features!, previous.features)), 0);
		const surfaceSimilarity = stageId <= 3 ? 0 : recent.reduce((maximum, previous) => Math.max(maximum, promptSimilarity(candidate.prompt, previous.prompt)), 0);
		const topicPenalty = (topicUsage.get(candidate.features.topicKey) ?? 0) * 0.16;
		const domainPenalty = (domainUsage.get(candidate.features.topicDomain) ?? 0) * 0.03;
		const score = semanticSimilarity * 1.8 + surfaceSimilarity * 1.2 + topicPenalty + domainPenalty;
		if (score < bestBankScore) { bestBank = candidate; bestBankScore = score; }
	}
	if (bestBank) return bestBank;

	let best: PracticeTask | undefined;
	let bestScore = Number.POSITIVE_INFINITY;
	for (let offset = 0; offset < 160; offset += 1) {
		const candidate = generatePracticeTask(stageId, startSeed + offset, { selectionReason, targetSkill, customTopic });
		if (!candidate.features || fingerprints.has(candidate.features.fingerprint)) continue;
		const candidateHash = practiceTaskPromptHash(candidate);
		if (promptHashes.has(candidateHash)) continue;
		const semanticSimilarity = recent.reduce((maximum, previous) => Math.max(maximum, featureSignatureSimilarity(candidate.features!, previous.features)), 0);
		const surfaceSimilarity = stageId <= 3 ? 0 : recent.reduce((maximum, previous) => Math.max(maximum, promptSimilarity(candidate.prompt, previous.prompt)), 0);
		const topicPenalty = (topicUsage.get(candidate.features.topicKey) ?? 0) * 0.16;
		const domainPenalty = (domainUsage.get(candidate.features.topicDomain) ?? 0) * 0.03;
		const targetPenalty = candidate.features.skillTargets.includes(targetSkill) ? 0 : 2;
		const score = semanticSimilarity * 1.8 + surfaceSimilarity * 1.2 + topicPenalty + domainPenalty + targetPenalty;
		if (score < bestScore) { best = candidate; bestScore = score; }
	}
	return best;
}

export const NO_NEW_PROBLEM_MESSAGE = 'この段階で未出題の問題がなくなりました。新しい問題の追加をお待ちください。学習記録は保存されています。';
