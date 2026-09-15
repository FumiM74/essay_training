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
	phase: LearningPhase;
	trialOutcome?: TrialOutcome;
};

export type TrialOutcome = {
	status: 'active' | 'approved' | 'private_verified' | 'disqualified';
	revisionCount: number;
	maxRevisionCount: 5;
	modelAnswers?: Array<{ label: string; answer: string; explanation: string }>;
};

export type LearningPhase = 'training' | 'promotion_test' | 'retraining';
export type TopicSelectionMode = 'random' | 'custom';

export type LearningProgress = {
	currentStageId: number;
	highestUnlockedStageId: number;
	phase: LearningPhase;
	phasePasses: number;
	phaseAttempts: number;
	frontierPhase: LearningPhase;
	frontierPhasePasses: number;
	frontierPhaseAttempts: number;
	requiredTrainingPasses: number;
	promotionTestQuestionCount: number;
	requiredRetrainingPasses: number;
	easyFeedbackEnabled: boolean;
	topicSelectionMode: TopicSelectionMode;
	customTopics: string[];
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
	phase: LearningPhase;
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
	version: 5;
	approvedProblems?: PracticeTask[];
	drafts: Record<string, DraftRecord>;
	submissions: SubmissionRecord[];
	problemHistory: ProblemHistoryRecord[];
	skillStats: Record<string, LearnerSkillStat>;
	progress: LearningProgress;
};
