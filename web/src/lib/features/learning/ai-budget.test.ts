import { describe, expect, it } from 'vitest';
import { DEFAULT_AI_BUDGETS, decideProblemProvision, estimateTokensForGuard, fitsRequestEnvelope, withinDailyBudget } from './ai-budget';

describe('AI budget policy', () => {
	it('開発時の既定値は本番承認済みとして扱わない', () => {
		expect(DEFAULT_AI_BUDGETS.problem_generation.reviewStatus).toBe('provisional');
		expect(DEFAULT_AI_BUDGETS.feedback.reviewStatus).toBe('provisional');
	});

	it('適合する承認済み問題があればAIを呼ばない', () => {
		expect(decideProblemProvision({ compatibleApprovedProblems: 1, generationEnabled: true, usage: { requests: 0, inputTokens: 0, outputTokens: 0 } })).toEqual({
			source: 'problem_bank', reason: 'compatible_approved_problem',
		});
	});

	it('問題バンクに不足があり予算内の時だけ生成する', () => {
		expect(decideProblemProvision({ compatibleApprovedProblems: 0, generationEnabled: true, usage: { requests: 0, inputTokens: 0, outputTokens: 0 } }).source).toBe('ai');
		expect(decideProblemProvision({ compatibleApprovedProblems: 0, generationEnabled: true, usage: { requests: 3, inputTokens: 0, outputTokens: 0 } })).toEqual({
			source: 'local_fallback', reason: 'budget_exhausted',
		});
	});

	it('プロバイダー呼び出し前に保守的な入力・出力上限を検査する', () => {
		const policy = DEFAULT_AI_BUDGETS.problem_generation;
		expect(estimateTokensForGuard('日本語の短い問題仕様')).toBeGreaterThan(0);
		expect(fitsRequestEnvelope('短い仕様', policy.maxOutputTokensPerRequest, policy)).toBe(true);
		expect(fitsRequestEnvelope('長'.repeat(2000), 100, policy)).toBe(false);
		expect(withinDailyBudget({ requests: 0, inputTokens: policy.dailyInputTokensPerLearner, outputTokens: 0 }, policy)).toBe(false);
	});
});
