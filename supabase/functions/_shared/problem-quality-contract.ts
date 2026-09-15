import type { GeneratedProblem } from './problem-generation-contract.ts';

export const PROBLEM_QUALITY_PROMPT_VERSION = 'problem-quality-review-v2';
export const PROBLEM_REPAIR_PROMPT_VERSION = 'problem-quality-repair-v1';

export const QUALITY_DIMENSIONS = [
	'instructionClarity', 'internalConsistency', 'answerability', 'readability',
	'stageAlignment', 'gradingFairness', 'answerContractConsistency',
] as const;

export type QualityDimension = typeof QUALITY_DIMENSIONS[number];
export type ProblemQualityReview = {
	verdict: 'approve' | 'revise' | 'reject';
	summary: string;
	scores: Record<QualityDimension, number>;
	issues: Array<{
		code: string;
		severity: 'blocking' | 'warning';
		location: string;
		explanation: string;
		suggestedFix: string;
	}>;
	independentAnswerOutline: string[];
};

function boundedText(value: unknown, maximum: number): value is string {
	return typeof value === 'string' && value.trim().length > 0 && value.length <= maximum;
}

export function validateProblemQualityReview(value: unknown): ProblemQualityReview {
	if (!value || typeof value !== 'object') throw new Error('invalid_problem_quality_review');
	const review = value as Record<string, unknown>;
	if (!['approve', 'revise', 'reject'].includes(String(review.verdict)) || !boundedText(review.summary, 1200)) {
		throw new Error('invalid_problem_quality_verdict');
	}
	if (!review.scores || typeof review.scores !== 'object') throw new Error('invalid_problem_quality_scores');
	const scores = review.scores as Record<string, unknown>;
	if (!QUALITY_DIMENSIONS.every((key) => Number.isInteger(scores[key]) && Number(scores[key]) >= 1 && Number(scores[key]) <= 5)) {
		throw new Error('invalid_problem_quality_scores');
	}
	if (!Array.isArray(review.issues) || review.issues.length > 12 || !review.issues.every((issue) => {
		if (!issue || typeof issue !== 'object') return false;
		const item = issue as Record<string, unknown>;
		return /^[a-z0-9_]{1,60}$/.test(String(item.code))
			&& ['blocking', 'warning'].includes(String(item.severity))
			&& boundedText(item.location, 240) && boundedText(item.explanation, 1200) && boundedText(item.suggestedFix, 1200);
	})) throw new Error('invalid_problem_quality_issues');
	if (!Array.isArray(review.independentAnswerOutline) || review.independentAnswerOutline.length < 1
		|| review.independentAnswerOutline.length > 8 || !review.independentAnswerOutline.every((item) => boundedText(item, 1200))) {
		throw new Error('invalid_problem_quality_answer_outline');
	}
	const blocking = (review.issues as ProblemQualityReview['issues']).some((item) => item.severity === 'blocking');
	const weakScore = QUALITY_DIMENSIONS.some((key) => Number(scores[key]) < 4);
	if (review.verdict === 'approve' && (blocking || weakScore)) throw new Error('inconsistent_problem_quality_review');
	if (review.verdict !== 'approve' && !blocking && !weakScore) throw new Error('inconsistent_problem_quality_review');
	return review as unknown as ProblemQualityReview;
}

export const problemQualityReviewSchema = {
	type: 'object', additionalProperties: false,
	properties: {
		verdict: { type: 'string', enum: ['approve', 'revise', 'reject'] },
		summary: { type: 'string' },
		scores: { type: 'object', additionalProperties: false, properties: Object.fromEntries(
			QUALITY_DIMENSIONS.map((key) => [key, { type: 'integer' }]),
		), required: [...QUALITY_DIMENSIONS] },
		issues: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
			code: { type: 'string' }, severity: { type: 'string', enum: ['blocking', 'warning'] },
			location: { type: 'string' }, explanation: { type: 'string' }, suggestedFix: { type: 'string' },
		}, required: ['code', 'severity', 'location', 'explanation', 'suggestedFix'] } },
		independentAnswerOutline: { type: 'array', items: { type: 'string' } },
	},
	required: ['verdict', 'summary', 'scores', 'issues', 'independentAnswerOutline'],
} as const;

export function problemModelAnswers(problem: GeneratedProblem): Array<{ label: string; answer: string; explanation: string }> {
	if (problem.basicQuestions.length) return problem.basicQuestions.map((question, index) => ({
		label: `問題${index + 1}`,
		answer: question.referenceAnswerLabel,
		explanation: question.gradingPoint,
	}));
	return problem.acceptedAnswerExamples.map((answer, index) => ({
		label: problem.acceptedAnswerExamples.length === 1 ? '模範解答例' : `模範解答例${index + 1}`,
		answer,
		explanation: problem.gradingCriteria.map((item) => item.passCondition).join(' '),
	}));
}
