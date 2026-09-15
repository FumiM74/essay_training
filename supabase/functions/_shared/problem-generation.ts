import { callClaude, type ClaudeResult } from './claude.ts';
import { STAGE_FEEDBACK_DESIGN } from './feedback-contract.ts';
import { generatedProblemSchema, problemGenerationModel, validateGeneratedProblem, type GeneratedProblem, type ProblemGenerationSpecification } from './problem-generation-contract.ts';
import { buildProblemGenerationPrompt, CLAUDE_PROBLEM_GENERATION_SYSTEM } from './problem-generation-prompt.ts';
import type { RuntimeEnv } from './runtime.ts';

export async function generateProblemWithClaude(
	env: RuntimeEnv,
	input: { specification: ProblemGenerationSpecification; maxTokens: number; userId: string },
): Promise<{ problem: GeneratedProblem; model: string; claude: ClaudeResult }> {
	const stageDesign = STAGE_FEEDBACK_DESIGN[input.specification.stageId];
	if (!stageDesign) throw new Error('missing_stage_design');
	const model = problemGenerationModel(env);
	const claude = await callClaude(env, {
		model,
		maxTokens: input.maxTokens,
		prompt: buildProblemGenerationPrompt(input.specification, stageDesign),
		schema: generatedProblemSchema,
		userId: input.userId,
		system: CLAUDE_PROBLEM_GENERATION_SYSTEM,
	});
	try {
		return { problem: validateGeneratedProblem(claude.value, input.specification), model, claude };
	} catch (error) {
		throw new GeneratedProblemValidationError(error instanceof Error ? error.message : 'invalid_generated_problem', claude);
	}
}

export async function repairProblemWithClaude(
	env: RuntimeEnv,
	input: { specification: ProblemGenerationSpecification; maxTokens: number; userId: string; prompt: string },
): Promise<{ problem: GeneratedProblem; model: string; claude: ClaudeResult }> {
	const model = problemGenerationModel(env);
	const claude = await callClaude(env, {
		model, maxTokens: input.maxTokens, prompt: input.prompt, schema: generatedProblemSchema,
		userId: input.userId, system: CLAUDE_PROBLEM_GENERATION_SYSTEM,
	});
	try { return { problem: validateGeneratedProblem(claude.value, input.specification), model, claude }; }
	catch (error) { throw new GeneratedProblemValidationError(error instanceof Error ? error.message : 'invalid_generated_problem', claude); }
}

export class GeneratedProblemValidationError extends Error {
	constructor(public readonly code: string, public readonly claude: ClaudeResult) {
		super(code);
		this.name = 'GeneratedProblemValidationError';
	}
}
