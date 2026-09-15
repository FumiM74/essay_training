import { callClaude, ClaudeError, type ClaudeUsage } from '../_shared/claude.ts';
import { PROBLEM_GENERATION_PROMPT_VERSION, generatedProblemSchema, problemGenerationModel } from '../_shared/problem-generation-contract.ts';
import { buildProblemGenerationPrompt, CLAUDE_PROBLEM_GENERATION_SYSTEM } from '../_shared/problem-generation-prompt.ts';
import { PROBLEM_QUALITY_PROMPT_VERSION, problemModelAnswers, problemQualityReviewSchema, validateProblemQualityReview, type ProblemQualityReview } from '../_shared/problem-quality-contract.ts';
import { buildProblemQualityPrompt, buildProblemRepairPrompt, CLAUDE_PROBLEM_QUALITY_SYSTEM } from '../_shared/problem-quality-prompt.ts';
import { parseProblemGenerationRequest } from '../_shared/problem-generation-request.ts';
import { generateProblemWithClaude, GeneratedProblemValidationError, repairProblemWithClaude } from '../_shared/problem-generation.ts';
import { STAGE_FEEDBACK_DESIGN } from '../_shared/feedback-contract.ts';
import { authenticate, corsHeaders, jsonResponse, readEnv, rpc, sha256 } from '../_shared/runtime.ts';
import { estimateClaudeInputTokens } from '../_shared/token-estimate.ts';

type Reservation = {
	state: 'reserved' | 'pending' | 'succeeded' | 'failed' | 'bank_available' | 'rejected_budget';
	result?: unknown;
	errorCode?: string;
	reason?: string;
	policy?: { maxInputTokens: number; maxOutputTokens: number; reviewStatus: string };
};

type SuboperationBudget = { allowed: boolean; reason?: string; maxInputTokens?: number; maxOutputTokens?: number };

const emptyUsage = (): ClaudeUsage => ({ inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 });
function addUsage(total: ClaudeUsage, usage: ClaudeUsage) {
	total.inputTokens += usage.inputTokens;
	total.outputTokens += usage.outputTokens;
	total.cacheCreationInputTokens += usage.cacheCreationInputTokens;
	total.cacheReadInputTokens += usage.cacheReadInputTokens;
}

function promptHash(value: string): string {
	let hash = 2166136261;
	const normalized = value.normalize('NFKC').toLowerCase().replace(/[\s　]+/g, '').replace(/[「」『』（）()、。！？!?]/g, '');
	for (const character of normalized) {
		hash ^= character.codePointAt(0) ?? 0;
		hash = Math.imul(hash, 16777619);
	}
	return `fnv1a:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

Deno.serve(async (request) => {
	let env;
	try { env = readEnv(); }
	catch { return jsonResponse(request, { error: 'server_configuration_error' }, 500); }
	if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request, env) });
	if (request.method !== 'POST') return jsonResponse(request, { error: 'method_not_allowed' }, 405, env);
	let learnerId = '';
	let input: ReturnType<typeof parseProblemGenerationRequest>;
	try {
		learnerId = await authenticate(request, env);
		input = parseProblemGenerationRequest(await request.json());
	} catch (error) {
		const code = error instanceof Error ? error.message : 'invalid_request';
		return jsonResponse(request, { error: code }, code === 'authentication_required' ? 401 : 400, env);
	}

	const model = problemGenerationModel(env);
	const maxTokens = input.stageId <= 3 ? 3500 : 2200;
	const stageDesign = STAGE_FEEDBACK_DESIGN[input.stageId];
	if (!stageDesign) return jsonResponse(request, { error: 'missing_stage_design' }, 500, env);
	const prompt = buildProblemGenerationPrompt(input.specification, stageDesign);
	const estimatedInputTokens = estimateClaudeInputTokens(prompt, generatedProblemSchema, CLAUDE_PROBLEM_GENERATION_SYSTEM) * 2;
	const requestedOutputTokens = maxTokens * 2;
	const requestHash = await sha256(JSON.stringify({
		taskId: input.taskId, featureSignature: input.featureSignature,
		specification: input.specification, promptVersion: PROBLEM_GENERATION_PROMPT_VERSION,
	}));
	let reservation: Reservation;
	try {
		reservation = await rpc(env, 'reserve_ai_problem_generation', {
			p_learner_id: learnerId, p_request_id: input.requestId, p_request_hash: requestHash,
			p_task_key: input.taskId, p_stage_id: input.stageId, p_feature_signature: input.featureSignature,
			p_model: model, p_estimated_input_tokens: estimatedInputTokens,
			p_requested_output_tokens: requestedOutputTokens,
		});
	} catch (error) {
		return jsonResponse(request, { error: error instanceof Error ? error.message : 'reservation_failed' }, 409, env);
	}
	if (reservation.state === 'succeeded' || reservation.state === 'bank_available') {
		return jsonResponse(request, { problem: reservation.result, reused: true }, 200, env);
	}
	if (reservation.state === 'pending') return jsonResponse(request, { error: 'problem_generation_in_progress' }, 409, env);
	if (reservation.state === 'failed') return jsonResponse(request, { error: reservation.errorCode || 'previous_problem_generation_failed' }, 409, env);
	if (reservation.state === 'rejected_budget') return jsonResponse(request, { error: 'problem_generation_budget_exceeded', reason: reservation.reason }, 429, env);
	if (!reservation.policy || estimatedInputTokens > reservation.policy.maxInputTokens || requestedOutputTokens > reservation.policy.maxOutputTokens) {
		await rpc(env, 'fail_ai_problem_generation', {
			p_learner_id: learnerId, p_request_id: input.requestId, p_provider: 'anthropic', p_model: model,
			p_provider_request_id: '', p_error_code: 'request_limit', p_input_tokens: 0, p_output_tokens: 0,
		}).catch(() => undefined);
		return jsonResponse(request, { error: 'problem_generation_budget_exceeded', reason: 'request_limit' }, 429, env);
	}

	const usage = emptyUsage();
	const initialUsage = emptyUsage();
	let repairUsage: (ClaudeUsage & { providerRequestId: string }) | null = null;
	const qualityReviews: Array<{
		attempt: number; review: ProblemQualityReview; model: string; promptVersion: string; providerRequestId: string;
		inputTokens: number; outputTokens: number; cacheCreationInputTokens: number; cacheReadInputTokens: number;
	}> = [];
	let providerRequestId = '';
	let lastCode = 'problem_generation_failed';
	for (let attempt = 0; attempt < 2; attempt += 1) {
		try {
			let generated = await generateProblemWithClaude(env, {
				specification: input.specification, maxTokens, userId: learnerId,
			});
			providerRequestId = generated.claude.id;
			addUsage(usage, generated.claude.usage);
			addUsage(initialUsage, generated.claude.usage);

			const reviewModel = env.CLAUDE_PROBLEM_REVIEW_MODEL || model;
			const runQualityReview = async (reviewAttempt: number): Promise<ProblemQualityReview> => {
				const reviewPrompt = buildProblemQualityPrompt(input.specification, stageDesign, generated.problem);
				const reviewInputTokens = estimateClaudeInputTokens(reviewPrompt, problemQualityReviewSchema, CLAUDE_PROBLEM_QUALITY_SYSTEM);
				const budget = await rpc<SuboperationBudget>(env, 'get_ai_suboperation_budget', {
					p_learner_id: learnerId, p_operation: 'problem_quality_review',
					p_estimated_input_tokens: reviewInputTokens, p_requested_output_tokens: 1800,
				});
				if (!budget.allowed) throw new Error(`problem_quality_review_budget_${budget.reason || 'exceeded'}`);
				const result = await callClaude(env, {
					model: reviewModel, maxTokens: 1800, prompt: reviewPrompt, schema: problemQualityReviewSchema,
					userId: learnerId, system: CLAUDE_PROBLEM_QUALITY_SYSTEM,
				});
				const review = validateProblemQualityReview(result.value);
				qualityReviews.push({ attempt: reviewAttempt, review, model: reviewModel,
					promptVersion: PROBLEM_QUALITY_PROMPT_VERSION, providerRequestId: result.id, ...result.usage });
				return review;
			};

			let review = await runQualityReview(1);
			if (review.verdict !== 'approve') {
				if (review.verdict === 'reject') throw new Error('problem_quality_rejected');
				const repairPrompt = buildProblemRepairPrompt(input.specification, stageDesign, generated.problem, review);
				const repairInputTokens = estimateClaudeInputTokens(repairPrompt, generatedProblemSchema, CLAUDE_PROBLEM_GENERATION_SYSTEM);
				const repairBudget = await rpc<SuboperationBudget>(env, 'get_ai_suboperation_budget', {
					p_learner_id: learnerId, p_operation: 'problem_generation_repair',
					p_estimated_input_tokens: repairInputTokens, p_requested_output_tokens: maxTokens,
				});
				if (!repairBudget.allowed) throw new Error(`problem_generation_repair_budget_${repairBudget.reason || 'exceeded'}`);
				const repaired = await repairProblemWithClaude(env, {
					specification: input.specification, maxTokens, userId: learnerId, prompt: repairPrompt,
				});
				generated = repaired;
				repairUsage = { providerRequestId: repaired.claude.id, ...repaired.claude.usage };
				addUsage(usage, repaired.claude.usage);
				review = await runQualityReview(2);
				if (review.verdict !== 'approve') throw new Error('problem_quality_rejected_after_repair');
			}
			const generationContract = {
				acceptedAnswerExamples: generated.problem.acceptedAnswerExamples,
				gradingCriteria: generated.problem.gradingCriteria,
				hiddenRequirements: generated.problem.hiddenRequirements,
				basicQuestions: generated.problem.basicQuestions.map((question) => ({
					category: question.category, instruction: question.instruction, prompt: question.prompt,
					choices: question.choices, referenceAnswers: question.referenceAnswers,
					referenceAnswerLabel: question.referenceAnswerLabel, gradingPoint: question.gradingPoint,
					skillKey: question.skillKey,
				})),
			};
			const fingerprint = `pfs2:${(await sha256(JSON.stringify({
				stageId: input.stageId, prompt: generated.problem.prompt, contract: generationContract,
			}))).slice(0, 32)}`;
			const featureSignature = {
				...input.featureSignature,
				fingerprint,
				generation: {
					source: 'ai',
					designVersion: (input.featureSignature.generation as Record<string, unknown>).designVersion,
					promptVersion: PROBLEM_GENERATION_PROMPT_VERSION,
					model: generated.model,
				},
				generationContract,
			};
			if (JSON.stringify(featureSignature).length > 11000) throw new Error('generated_problem_too_large');
			const questionText = generationContract.basicQuestions.map((question) => [
				question.category, question.instruction, question.prompt, ...question.choices,
				...question.referenceAnswers, question.referenceAnswerLabel, question.gradingPoint,
			].join('\n')).join('\n---\n');
			const generatedPromptHash = promptHash(questionText ? `${generated.problem.prompt}\n${questionText}` : generated.problem.prompt);
			const problem = await rpc(env, 'finalize_reviewed_ai_problem_generation', {
				p_learner_id: learnerId, p_request_id: input.requestId, p_task_key: input.taskId,
				p_stage_id: input.stageId, p_title: generated.problem.title, p_prompt: generated.problem.prompt,
				p_hint: generated.problem.hint, p_feature_signature: featureSignature, p_prompt_hash: generatedPromptHash,
				p_provider: 'anthropic', p_model: generated.model, p_provider_request_id: providerRequestId,
				p_input_tokens: initialUsage.inputTokens, p_output_tokens: initialUsage.outputTokens,
				p_cache_creation_input_tokens: initialUsage.cacheCreationInputTokens,
				p_cache_read_input_tokens: initialUsage.cacheReadInputTokens,
				p_quality_reviews: qualityReviews,
				p_repair_usage: repairUsage ?? {},
				p_model_answers: problemModelAnswers(generated.problem),
			});
			return jsonResponse(request, { problem, model: generated.model, reused: false }, 200, env);
		} catch (error) {
			if (error instanceof GeneratedProblemValidationError) {
				providerRequestId = error.claude.id;
				addUsage(usage, error.claude.usage);
				addUsage(initialUsage, error.claude.usage);
				lastCode = error.code;
				if (attempt === 0 && qualityReviews.length === 0) continue;
			} else if (error instanceof ClaudeError) {
				providerRequestId = error.providerRequestId;
				if (error.usage) addUsage(usage, error.usage);
				lastCode = error.code;
			} else lastCode = error instanceof Error ? error.message : 'problem_generation_failed';
			break;
		}
	}
	await rpc(env, 'fail_ai_problem_generation', {
		p_learner_id: learnerId, p_request_id: input.requestId, p_provider: 'anthropic', p_model: model,
		p_provider_request_id: providerRequestId, p_error_code: lastCode,
		p_input_tokens: usage.inputTokens, p_output_tokens: usage.outputTokens,
	}).catch(() => undefined);
	return jsonResponse(request, { error: lastCode }, lastCode.startsWith('provider_') ? 502 : 422, env);
});
