import type { PracticeTask, ProblemFeatureSignature, SkillKey } from '$lib/types/curriculum';
import type { LearningProgress, LocalLearningState, SubmissionRecord } from '$lib/types/learning';
import { generatePracticeTask, generatedTaskSeed, historyTask, promptHash, promptSimilarity } from './problem-generator';
import { getStageProblemDesign, selectionReasonForAttempt } from './learning-design';
import { weakestSkillsForStage } from './mastery';

export const DEFAULT_REQUIRED_CONSECUTIVE_PASSES = 3;
export const MIN_REQUIRED_CONSECUTIVE_PASSES = 1;
export const MAX_REQUIRED_CONSECUTIVE_PASSES = 10;

export function defaultLearningProgress(): LearningProgress {
	return {
		currentStageId: 1,
		highestUnlockedStageId: 1,
		consecutivePasses: 0,
		requiredConsecutivePasses: DEFAULT_REQUIRED_CONSECUTIVE_PASSES,
		courseCompletedAt: null,
	};
}

export function isValidRequiredPasses(value: number): boolean {
	return Number.isInteger(value) && value >= MIN_REQUIRED_CONSECUTIVE_PASSES && value <= MAX_REQUIRED_CONSECUTIVE_PASSES;
}

export function applySubmissionToProgress(progress: LearningProgress, submission: SubmissionRecord): LearningProgress {
	if (submission.stageId !== progress.currentStageId) return progress;
	if (submission.feedback.decision !== 'pass') return { ...progress, consecutivePasses: 0 };

	const nextStreak = progress.consecutivePasses + 1;
	if (nextStreak < progress.requiredConsecutivePasses) return { ...progress, consecutivePasses: nextStreak };
	if (progress.currentStageId === 13) {
		return { ...progress, highestUnlockedStageId: 13, consecutivePasses: progress.requiredConsecutivePasses, courseCompletedAt: progress.courseCompletedAt ?? submission.submittedAt };
	}
	const nextStage = progress.currentStageId + 1;
	return { ...progress, currentStageId: nextStage, highestUnlockedStageId: Math.max(progress.highestUnlockedStageId, nextStage), consecutivePasses: 0 };
}

export function deriveProgress(submissions: SubmissionRecord[], required = DEFAULT_REQUIRED_CONSECUTIVE_PASSES): LearningProgress {
	let progress = { ...defaultLearningProgress(), requiredConsecutivePasses: required };
	for (const submission of [...submissions].reverse()) progress = applySubmissionToProgress(progress, submission);
	return progress;
}

export function completedStageCount(progress: LearningProgress): number {
	return progress.courseCompletedAt ? 13 : Math.max(0, progress.highestUnlockedStageId - 1);
}

export function selectLearningStage(progress: LearningProgress, stageId: number): LearningProgress {
	if (!Number.isInteger(stageId) || stageId < 1 || stageId > progress.highestUnlockedStageId) throw new Error('未到達の段階は選べません。');
	return { ...progress, currentStageId: stageId, consecutivePasses: 0 };
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
	let weight = 4;
	let score = (left.topicKey === right.topicKey ? 2 : left.topicDomain === right.topicDomain ? 0.7 : 0)
		+ (left.promptFamily === right.promptFamily ? 0.75 : 0)
		+ overlap(left.skillTargets, right.skillTargets) * 1.25;
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
	const promptHashes = new Set(stageHistory.map((item) => item.promptHash));
	const largestSeed = stageHistory.reduce((largest, item) => Math.max(largest, generatedTaskSeed(item.taskId) ?? item.features.seed), -1);
	const startSeed = largestSeed + 1;
	const completedAttempts = stageHistory.filter((item) => item.submittedAt !== null).length;
	const weak = weakestSkillsForStage(state.skillStats, stageId);
	const selectionReason = selectionReasonForAttempt(completedAttempts, weak.length > 0);
	const targetSkill = selectedSkill(state, stageId, completedAttempts, selectionReason);
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
		if (stageHistory.some((item) => item.taskId === candidate.id) || fingerprints.has(candidate.features.fingerprint)) continue;
		const candidateHash = promptHash(candidate.prompt);
		if (promptHashes.has(candidateHash)) continue;
		const semanticSimilarity = recent.reduce((maximum, previous) => Math.max(maximum, featureSignatureSimilarity(candidate.features!, previous.features)), 0);
		const surfaceSimilarity = recent.reduce((maximum, previous) => Math.max(maximum, promptSimilarity(candidate.prompt, previous.prompt)), 0);
		const topicPenalty = (topicUsage.get(candidate.features.topicKey) ?? 0) * 0.16;
		const domainPenalty = (domainUsage.get(candidate.features.topicDomain) ?? 0) * 0.03;
		const score = semanticSimilarity * 1.8 + surfaceSimilarity * 1.2 + topicPenalty + domainPenalty;
		if (score < bestBankScore) { bestBank = candidate; bestBankScore = score; }
	}
	if (bestBank) return bestBank;

	let best: PracticeTask | undefined;
	let bestScore = Number.POSITIVE_INFINITY;
	for (let offset = 0; offset < 160; offset += 1) {
		const candidate = generatePracticeTask(stageId, startSeed + offset, { selectionReason, targetSkill });
		if (!candidate.features || fingerprints.has(candidate.features.fingerprint)) continue;
		const candidateHash = promptHash(candidate.prompt);
		if (promptHashes.has(candidateHash)) continue;
		const semanticSimilarity = recent.reduce((maximum, previous) => Math.max(maximum, featureSignatureSimilarity(candidate.features!, previous.features)), 0);
		const surfaceSimilarity = recent.reduce((maximum, previous) => Math.max(maximum, promptSimilarity(candidate.prompt, previous.prompt)), 0);
		const topicPenalty = (topicUsage.get(candidate.features.topicKey) ?? 0) * 0.16;
		const domainPenalty = (domainUsage.get(candidate.features.topicDomain) ?? 0) * 0.03;
		const targetPenalty = candidate.features.skillTargets.includes(targetSkill) ? 0 : 2;
		const score = semanticSimilarity * 1.8 + surfaceSimilarity * 1.2 + topicPenalty + domainPenalty + targetPenalty;
		if (score < bestScore) { best = candidate; bestScore = score; }
	}
	return best ?? generatePracticeTask(stageId, startSeed + 160, { selectionReason, targetSkill });
}
