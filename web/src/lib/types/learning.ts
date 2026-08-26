import type { FeedbackResult } from './contracts';
import type { PracticeTask, ProblemFeatureSignature, SkillKey } from './curriculum';
import type { SkillOutcome } from './contracts';

export type DraftRecord = {
	taskId: string;
	text: string;
	updatedAt: string;
};

export type SubmissionRecord = {
	id: string;
	taskId: string;
	stageId: number;
	taskTitle: string;
	text: string;
	submittedAt: string;
	feedback: FeedbackResult;
};

export type LearningProgress = {
	currentStageId: number;
	highestUnlockedStageId: number;
	consecutivePasses: number;
	requiredConsecutivePasses: number;
	courseCompletedAt: string | null;
};

export type ProblemHistoryRecord = {
	taskId: string;
	problemId?: string | null;
	stageId: number;
	taskTitle: string;
	prompt: string;
	hint: string;
	features: ProblemFeatureSignature;
	promptHash: string;
	issuedAt: string;
	submittedAt: string | null;
};

export type LearnerSkillStat = {
	stageId: number;
	skillKey: SkillKey;
	attempts: number;
	achievedCount: number;
	partialCount: number;
	missedCount: number;
	masteryScore: number;
	lastOutcome: SkillOutcome;
	lastPracticedAt: string;
};

export type LocalLearningState = {
	version: 4;
	approvedProblems?: PracticeTask[];
	drafts: Record<string, DraftRecord>;
	submissions: SubmissionRecord[];
	problemHistory: ProblemHistoryRecord[];
	skillStats: Record<string, LearnerSkillStat>;
	progress: LearningProgress;
};
