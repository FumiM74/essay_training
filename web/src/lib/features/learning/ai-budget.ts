export type AiOperation = 'problem_generation' | 'feedback';

export type AiBudgetPolicy = {
	operation: AiOperation;
	reviewStatus: 'provisional' | 'approved';
	maxInputTokensPerRequest: number;
	maxOutputTokensPerRequest: number;
	dailyRequestsPerLearner: number;
	dailyInputTokensPerLearner: number;
	dailyOutputTokensPerLearner: number;
};

export type AiUsageSummary = {
	requests: number;
	inputTokens: number;
	outputTokens: number;
};

export type ProblemProvisionDecision =
	| { source: 'problem_bank'; reason: 'compatible_approved_problem' }
	| { source: 'ai'; reason: 'bank_gap_within_budget' }
	| { source: 'local_fallback'; reason: 'budget_exhausted' | 'generation_disabled' };

// IMPORTANT: These values are temporary development guards, not a product decision.
// They directly affect problem/feedback quality. Before the final release test, ask the
// service owner to choose and explicitly approve production limits from measured usage.
// Do not silently promote these defaults to production-plan limits.
export const DEFAULT_AI_BUDGETS: Record<AiOperation, AiBudgetPolicy> = {
	problem_generation: {
		operation: 'problem_generation',
		reviewStatus: 'provisional',
		// Includes the reserved worst case for one validation retry.
		maxInputTokensPerRequest: 12000,
		maxOutputTokensPerRequest: 7000,
		dailyRequestsPerLearner: 3,
		dailyInputTokensPerLearner: 36000,
		dailyOutputTokensPerLearner: 21000,
	},
	feedback: {
		operation: 'feedback',
		reviewStatus: 'provisional',
		maxInputTokensPerRequest: 8000,
		maxOutputTokensPerRequest: 1800,
		dailyRequestsPerLearner: 20,
		dailyInputTokensPerLearner: 160000,
		dailyOutputTokensPerLearner: 36000,
	},
};

export function withinDailyBudget(usage: AiUsageSummary, policy: AiBudgetPolicy): boolean {
	return usage.requests < policy.dailyRequestsPerLearner
		&& usage.inputTokens < policy.dailyInputTokensPerLearner
		&& usage.outputTokens < policy.dailyOutputTokensPerLearner;
}

export function decideProblemProvision(input: {
	compatibleApprovedProblems: number;
	generationEnabled: boolean;
	usage: AiUsageSummary;
	policy?: AiBudgetPolicy;
}): ProblemProvisionDecision {
	if (input.compatibleApprovedProblems > 0) return { source: 'problem_bank', reason: 'compatible_approved_problem' };
	if (!input.generationEnabled) return { source: 'local_fallback', reason: 'generation_disabled' };
	if (!withinDailyBudget(input.usage, input.policy ?? DEFAULT_AI_BUDGETS.problem_generation)) {
		return { source: 'local_fallback', reason: 'budget_exhausted' };
	}
	return { source: 'ai', reason: 'bank_gap_within_budget' };
}

// Billing uses the provider's returned token counts. This estimate is only a
// conservative preflight guard for Japanese text before making a request.
export function estimateTokensForGuard(text: string): number {
	return Math.ceil(Array.from(text.normalize('NFKC')).length * 1.2);
}

export function fitsRequestEnvelope(input: string, requestedOutputTokens: number, policy: AiBudgetPolicy): boolean {
	return estimateTokensForGuard(input) <= policy.maxInputTokensPerRequest
		&& requestedOutputTokens > 0
		&& requestedOutputTokens <= policy.maxOutputTokensPerRequest;
}
