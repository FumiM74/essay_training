import type { FeedbackDecision } from '$lib/types/contracts';
import type { LearningPhase, LearningProgress } from '$lib/types/learning';
import { MAX_STAGE_ID } from '$lib/types/curriculum';

export type TaskResultAction = 'revise' | 'next' | 'course_complete';

export function resultProgress(before: LearningProgress, decision: FeedbackDecision, after?: LearningProgress): LearningProgress {
	if (after && after.currentStageId === before.currentStageId && after.phase === before.phase) return after;
	return { ...before, phasePasses: before.phasePasses + (decision === 'pass' ? 1 : 0) };
}

export function canAnswerTask(input: {
	hasScope: boolean;
	learningLoaded: boolean;
	isCurrentStage: boolean;
	isRecommendedTask: boolean;
	isActiveTask: boolean;
	isResultScreen: boolean;
	isSubmitting?: boolean;
}): boolean {
	return input.hasScope
		&& input.learningLoaded
		&& input.isCurrentStage
		&& input.isActiveTask
		&& !input.isResultScreen
		&& !input.isSubmitting;
}

export function taskResultAction(input: {
	decision: FeedbackDecision;
	phase: LearningPhase;
	stageId: number;
	courseCompleted: boolean;
}): TaskResultAction {
	if (input.courseCompleted && input.stageId === MAX_STAGE_ID && input.phase === 'promotion_test' && input.decision === 'pass') return 'course_complete';
	if (input.decision === 'revise' && input.phase !== 'promotion_test') return 'revise';
	return 'next';
}
