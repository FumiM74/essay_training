import { STAGE_PROBLEM_SKILLS, type ProblemGenerationSpecification } from './problem-generation-contract.ts';

export type ProblemGenerationRequest = {
	requestId: string;
	taskId: string;
	stageId: number;
	featureSignature: Record<string, unknown>;
	specification: ProblemGenerationSpecification;
};

const domains = new Set(['education', 'technology', 'community', 'public_policy', 'environment', 'ethics']);
const selectionReasons = new Set(['weakness', 'core', 'exploration']);

function text(value: unknown, maximum: number): value is string {
	return typeof value === 'string' && value.trim().length > 0 && value.length <= maximum;
}

function stringArray(value: unknown, maximumItems: number, maximumCharacters: number): value is string[] {
	return Array.isArray(value) && value.length <= maximumItems && value.every((item) => text(item, maximumCharacters));
}

export function parseProblemGenerationRequest(value: unknown): ProblemGenerationRequest {
	if (!value || typeof value !== 'object') throw new Error('invalid_request');
	const input = value as Record<string, unknown>;
	if (typeof input.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(input.requestId)) throw new Error('invalid_request_id');
	if (!Number.isInteger(input.stageId) || Number(input.stageId) < 1 || Number(input.stageId) > 14) throw new Error('invalid_stage');
	const stageId = Number(input.stageId);
	if (!text(input.taskId, 120) || !new RegExp(`^stage-${stageId}-generated-`).test(input.taskId)) throw new Error('invalid_task_id');
	if (!input.featureSignature || typeof input.featureSignature !== 'object' || Array.isArray(input.featureSignature)) throw new Error('invalid_feature_signature');
	const feature = input.featureSignature as Record<string, unknown>;
	const generation = feature.generation as Record<string, unknown> | undefined;
	const allowedSkills = STAGE_PROBLEM_SKILLS[stageId];
	if (feature.version !== 2 || !Number.isSafeInteger(feature.seed) || Number(feature.seed) < 0
		|| !domains.has(String(feature.topicDomain)) || !text(feature.topicKey, 120) || !text(feature.promptFamily, 120)
		|| !stringArray(feature.skillTargets, 8, 80) || feature.skillTargets.length !== allowedSkills.length
		|| !feature.skillTargets.every((skill) => allowedSkills.includes(skill)) || new Set(feature.skillTargets).size !== feature.skillTargets.length
		|| !selectionReasons.has(String(feature.selectionReason)) || !text(feature.surfacePattern, 120)
		|| !generation || generation.source !== 'local_variant' || !text(generation.designVersion, 80) || !text(generation.promptVersion, 120)
		|| JSON.stringify(feature).length > 12000) throw new Error('invalid_feature_signature');
	if (feature.customTopic !== undefined && (!text(feature.customTopic, 40) || feature.customTopic.trim() !== feature.customTopic
		|| Array.from(feature.customTopic).length > 20 || stageId < 4 || feature.topicKey !== learnerTopicKey(feature.customTopic))) throw new Error('invalid_custom_topic');
	if (!input.specification || typeof input.specification !== 'object' || Array.isArray(input.specification)) throw new Error('invalid_specification');
	const specification = input.specification as Record<string, unknown>;
	if (specification.stageId !== stageId || specification.topicDomain !== feature.topicDomain
		|| specification.topicKey !== feature.topicKey || specification.promptFamily !== feature.promptFamily
		|| specification.selectionReason !== feature.selectionReason
		|| JSON.stringify(specification.skillTargets) !== JSON.stringify(feature.skillTargets)
		|| !Number.isInteger(specification.maximumPromptCharacters)
		|| Number(specification.maximumPromptCharacters) < 200 || Number(specification.maximumPromptCharacters) > 8000
		|| !stringArray(specification.avoidFingerprints, 12, 160)) throw new Error('invalid_specification');
	if (specification.customTopic !== feature.customTopic) throw new Error('invalid_specification');
	return input as unknown as ProblemGenerationRequest;
}

function learnerTopicKey(topic: string): string {
	let hash = 2166136261;
	for (const character of topic.normalize('NFKC')) {
		hash ^= character.codePointAt(0) ?? 0;
		hash = Math.imul(hash, 16777619);
	}
	return `learner-topic-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
