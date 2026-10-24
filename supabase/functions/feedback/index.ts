import { callClaude, ClaudeError } from '../_shared/claude.ts';
import { SKILL_KEYS, completeQuestionSetFeedback, modelForStage, outputTokenLimit, parseFeedbackRequest, questionSetSizeForStage, skillForBasicQuestion, validateFeedback, type SkillKey } from '../_shared/feedback-contract.ts';
import { buildFeedbackPrompt, feedbackOutputSchema } from '../_shared/feedback-prompt.ts';
import { authenticate, corsHeaders, jsonResponse, readEnv, rpc, sha256 } from '../_shared/runtime.ts';
import { estimateClaudeInputTokens } from '../_shared/token-estimate.ts';

type Reservation = {
	state: 'reserved' | 'pending' | 'succeeded' | 'failed' | 'rejected_budget';
	result?: unknown;
	errorCode?: string;
	reason?: string;
	problem?: { taskKey: string; stageId: number; taskTitle: string; prompt: string; hint: string; promptHash: string; featureSignature: { skillTargets?: unknown }; learningPhase: string };
	policy?: { maxInputTokens: number; maxOutputTokens: number; reviewStatus: string };
};

type StoredRevision = {
	previousAnswer?: unknown;
	previousFeedback?: unknown;
};

function storedRevisionContext(value: StoredRevision | null): {
	previousAnswer: string;
	requestedChanges: Array<{ title: string; guidance: string }>;
} | undefined {
	if (!value || typeof value.previousAnswer !== 'string' || !value.previousAnswer.trim()
		|| !value.previousFeedback || typeof value.previousFeedback !== 'object' || Array.isArray(value.previousFeedback)) return undefined;
	const feedback = value.previousFeedback as Record<string, unknown>;
	if (feedback.decision !== 'revise' || !Array.isArray(feedback.priorityFeedback)) return undefined;
	const requestedChanges = feedback.priorityFeedback.flatMap((item) => {
		if (!item || typeof item !== 'object') return [];
		const raw = item as Record<string, unknown>;
		return typeof raw.title === 'string' && typeof raw.guidance === 'string'
			? [{ title: raw.title.slice(0, 120), guidance: raw.guidance.slice(0, 1000) }]
			: [];
	}).slice(0, 3);
	return requestedChanges.length ? { previousAnswer: value.previousAnswer.slice(0, 20000), requestedChanges } : undefined;
}

function lockedQuestionIds(value: StoredRevision | null): Set<string> {
	if (!value?.previousFeedback || typeof value.previousFeedback !== 'object' || Array.isArray(value.previousFeedback)) return new Set();
	const results = (value.previousFeedback as Record<string, unknown>).basicQuestionResults;
	if (!Array.isArray(results)) return new Set();
	return new Set(results.flatMap((item) => item && typeof item === 'object'
		&& (item as Record<string, unknown>).correct === true
		&& typeof (item as Record<string, unknown>).questionId === 'string'
		? [(item as Record<string, unknown>).questionId as string]
		: []));
}

function fnvHash(value: string): string {
	let hash = 2166136261;
	for (const character of value.normalize('NFKC').toLowerCase().replace(/[\s　]+/g, '').replace(/[「」『』（）()、。！？!?]/g, '')) {
		hash ^= character.codePointAt(0) ?? 0;
		hash = Math.imul(hash, 16777619);
	}
	return `fnv1a:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function questionSetPromptHash(prompt: string, questions: NonNullable<ReturnType<typeof parseFeedbackRequest>['basicQuestions']>): string {
	const questionText = questions.map((question) => [question.category, question.instruction, question.prompt, ...(question.choices ?? []),
		...question.referenceAnswers, question.referenceAnswerLabel, question.gradingPoint].join('\n')).join('\n---\n');
	return fnvHash(`${prompt}\n${questionText}`);
}

function expectedSkills(problem: NonNullable<Reservation['problem']>, questionSet?: NonNullable<ReturnType<typeof parseFeedbackRequest>['basicQuestions']>): SkillKey[] {
	if (questionSetSizeForStage(problem.stageId) !== null) return [...new Set((questionSet ?? []).map(skillForBasicQuestion))];
	const raw = problem.featureSignature?.skillTargets;
	if (!Array.isArray(raw) || raw.length < 1 || raw.length > 8
		|| !raw.every((item) => typeof item === 'string' && SKILL_KEYS.includes(item as SkillKey))
		|| new Set(raw).size !== raw.length) throw new Error('invalid_problem_skills');
	return raw as SkillKey[];
}

Deno.serve(async (request) => {
	let env;
	try { env = readEnv(); }
	catch { return jsonResponse(request, { error: 'server_configuration_error' }, 500); }
	if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request, env) });
	if (request.method !== 'POST') return jsonResponse(request, { error: 'method_not_allowed' }, 405, env);
	let learnerId = '';
	let input: ReturnType<typeof parseFeedbackRequest>;
	try {
		learnerId = await authenticate(request, env);
		input = parseFeedbackRequest(await request.json());
	} catch (error) {
		const code = error instanceof Error ? error.message : 'invalid_request';
		return jsonResponse(request, { error: code }, code === 'authentication_required' ? 401 : 400, env);
	}
	const model = modelForStage(input.stageId, env);
	const maxTokens = outputTokenLimit(input.stageId);
	const preliminarySkills = input.basicQuestions ? [...new Set(input.basicQuestions.map(skillForBasicQuestion))] : [];
	const preliminaryInputTokens = input.basicQuestions ? estimateClaudeInputTokens(
		buildFeedbackPrompt({ stageId: input.stageId, prompt: '', hint: '', skillTargets: preliminarySkills, learningPhase: 'training', easyFeedbackEnabled: true }, input.answer, input.basicQuestions, input.revisionContext),
		feedbackOutputSchema(input.stageId, preliminarySkills),
	) : null;
	const requestHash = await sha256(JSON.stringify({ taskId: input.taskId, stageId: input.stageId, answer: input.answer, basicQuestions: input.basicQuestions }));
	let reservation: Reservation;
	try {
		reservation = await rpc(env, 'reserve_ai_feedback', {
			p_learner_id: learnerId, p_request_id: input.requestId, p_task_key: input.taskId,
			p_stage_id: input.stageId, p_request_hash: requestHash, p_model: model,
			p_answer_length: input.answer.length, p_requested_output_tokens: maxTokens,
			p_estimated_input_tokens: preliminaryInputTokens,
		});
	} catch (error) { return jsonResponse(request, { error: error instanceof Error ? error.message : 'reservation_failed' }, 409, env); }
	if (reservation.state === 'succeeded') return jsonResponse(request, { submission: reservation.result, reused: true }, 200, env);
	if (reservation.state === 'pending') return jsonResponse(request, { error: 'feedback_in_progress' }, 409, env);
	if (reservation.state === 'failed') return jsonResponse(request, { error: reservation.errorCode || 'previous_feedback_failed' }, 409, env);
	if (reservation.state === 'rejected_budget') return jsonResponse(request, { error: 'feedback_budget_exceeded', reason: reservation.reason }, 429, env);
	const failReservation = async (code: string) => {
		await rpc(env, 'fail_ai_feedback', {
			p_learner_id: learnerId, p_request_id: input.requestId, p_provider: 'anthropic', p_model: model,
			p_provider_request_id: '', p_error_code: code, p_input_tokens: 0, p_output_tokens: 0,
		}).catch(() => undefined);
	};
	let easyFeedbackEnabled = false;
	let storedRevision: StoredRevision | null = null;
	try {
		storedRevision = await rpc<StoredRevision | null>(env, 'get_latest_revision_context', {
			p_learner_id: learnerId,
			p_task_key: input.taskId,
		});
	} catch {
		await failReservation('revision_context_unavailable');
		return jsonResponse(request, { error: 'revision_context_unavailable' }, 503, env);
	}
	try { easyFeedbackEnabled = await rpc<boolean>(env, 'get_ai_feedback_preference', { p_learner_id: learnerId }); }
	catch {
		await failReservation('feedback_preference_unavailable');
		return jsonResponse(request, { error: 'feedback_preference_unavailable' }, 503, env);
	}
	if (!reservation.problem || reservation.problem.stageId !== input.stageId || reservation.problem.taskKey !== input.taskId) {
		await failReservation('invalid_reservation');
		return jsonResponse(request, { error: 'invalid_reservation' }, 500, env);
	}
	const lockedIds = lockedQuestionIds(storedRevision);
	const effectiveBasicQuestions = input.basicQuestions?.map((question) => ({ ...question, lockedCorrect: lockedIds.has(question.id) }));
	const effectiveRevisionContext = effectiveBasicQuestions ? undefined : storedRevisionContext(storedRevision);
	if (questionSetSizeForStage(input.stageId) !== null && questionSetPromptHash(reservation.problem.prompt, effectiveBasicQuestions!) !== reservation.problem.promptHash) {
		await failReservation('question_set_problem_mismatch');
		return jsonResponse(request, { error: 'question_set_problem_mismatch' }, 409, env);
	}
	let providerRequestId = '';
	let providerUsage = { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };
	try {
		const skills = expectedSkills(reservation.problem, effectiveBasicQuestions);
		const prompt = buildFeedbackPrompt({
			stageId: input.stageId, prompt: reservation.problem.prompt, hint: reservation.problem.hint,
			skillTargets: skills, learningPhase: reservation.problem.learningPhase, easyFeedbackEnabled,
		}, input.answer, effectiveBasicQuestions, effectiveRevisionContext);
		const schema = feedbackOutputSchema(input.stageId, skills);
		const estimatedInputTokens = estimateClaudeInputTokens(prompt, schema);
		if (!reservation.policy || estimatedInputTokens > reservation.policy.maxInputTokens) {
			await failReservation('request_input_limit');
			return jsonResponse(request, { error: 'feedback_budget_exceeded', reason: 'request_input_limit' }, 429, env);
		}
		const claude = await callClaude(env, { model, maxTokens, prompt, schema, userId: learnerId });
		providerRequestId = claude.id;
		providerUsage = claude.usage;
		const feedback = questionSetSizeForStage(input.stageId) !== null
			? completeQuestionSetFeedback(claude.value, effectiveBasicQuestions!)
			: validateFeedback(claude.value, skills, input.answer);
		const submission = await rpc(env, 'finalize_ai_feedback', {
			p_learner_id: learnerId, p_request_id: input.requestId, p_task_key: input.taskId,
			p_stage_id: input.stageId, p_body: input.answer, p_feedback: feedback,
			p_provider: 'anthropic', p_model: model, p_provider_request_id: claude.id,
			p_input_tokens: claude.usage.inputTokens, p_output_tokens: claude.usage.outputTokens,
			p_cache_creation_input_tokens: claude.usage.cacheCreationInputTokens,
			p_cache_read_input_tokens: claude.usage.cacheReadInputTokens,
		});
		return jsonResponse(request, { submission, model }, 200, env);
	} catch (error) {
		const code = error instanceof ClaudeError ? error.code : error instanceof Error ? error.message : 'feedback_failed';
		const usage = error instanceof ClaudeError ? error.usage : providerUsage;
		providerRequestId = error instanceof ClaudeError ? error.providerRequestId : providerRequestId;
		await rpc(env, 'fail_ai_feedback', {
			p_learner_id: learnerId, p_request_id: input.requestId, p_provider: 'anthropic', p_model: model,
			p_provider_request_id: providerRequestId, p_error_code: code,
			p_input_tokens: usage.inputTokens, p_output_tokens: usage.outputTokens,
		}).catch(() => undefined);
		return jsonResponse(request, { error: code }, code.startsWith('provider_') ? 502 : 500, env);
	}
});
