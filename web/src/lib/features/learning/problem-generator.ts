import { getPracticeTask, getStage, getStageTasks } from '$lib/data/curriculum';
import { SKILL_KEYS, type PracticeTask, type ProblemFeatureSignature, type ProblemSelectionReason, type ProblemSpecification, type SkillKey, type TopicDomain } from '$lib/types/curriculum';
import type { ProblemHistoryRecord } from '$lib/types/learning';
import { getStageProblemDesign, LOCAL_PROMPT_VERSION, PROBLEM_DESIGN_VERSION, selectFrom, skillGuidanceFor, topicDomainFor } from './learning-design';

type GenerationOptions = {
	selectionReason?: ProblemSelectionReason;
	targetSkill?: SkillKey;
};

const surfacePatterns = ['direct', 'reader-check', 'revision-focus', 'explain-clearly'] as const;

function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0 && value.length <= 200;
}

function isStringArray(value: unknown, maximum: number): value is string[] {
	return Array.isArray(value) && value.length > 0 && value.length <= maximum && value.every(isNonEmptyString);
}

function isSkillArray(value: unknown): value is SkillKey[] {
	return isStringArray(value, 8) && value.every((item) => (SKILL_KEYS as readonly string[]).includes(item));
}

export function isProblemFeatureSignature(value: unknown): value is ProblemFeatureSignature {
	if (!value || typeof value !== 'object') return false;
	const candidate = value as Partial<ProblemFeatureSignature>;
	const generation = candidate.generation as Partial<ProblemFeatureSignature['generation']> | undefined;
	const optionalFeatures = [candidate.languagePattern, candidate.perspective, candidate.reasoning, candidate.evidenceMode,
		candidate.structurePattern, candidate.sourceStructure, candidate.summaryOperation, candidate.issueConflict,
		candidate.sourceUse, candidate.counterposition, candidate.responseStrategy, candidate.synthesisPattern];
	return candidate.version === 2
		&& isNonEmptyString(candidate.fingerprint)
		&& Number.isSafeInteger(candidate.seed) && Number(candidate.seed) >= 0
		&& ['education', 'technology', 'community', 'public_policy', 'environment', 'ethics'].includes(String(candidate.topicDomain))
		&& isNonEmptyString(candidate.topicKey)
		&& isNonEmptyString(candidate.promptFamily)
		&& isSkillArray(candidate.skillTargets)
		&& ['weakness', 'core', 'exploration'].includes(String(candidate.selectionReason))
		&& isNonEmptyString(candidate.surfacePattern)
		&& optionalFeatures.every((item) => item === undefined || isNonEmptyString(item))
		&& Boolean(generation
			&& ['curated', 'local_variant', 'ai'].includes(String(generation.source))
			&& isNonEmptyString(generation.designVersion)
			&& isNonEmptyString(generation.promptVersion)
			&& (generation.model === undefined || isNonEmptyString(generation.model)));
}

export function createProblemSpecification(
	stageId: number,
	seed: number,
	options: GenerationOptions & { avoidFingerprints?: string[] } = {},
): ProblemSpecification {
	const signature = createProblemFeatures(stageId, seed, options);
	const {
		version: _version,
		fingerprint: _fingerprint,
		seed: _seed,
		surfacePattern: _surfacePattern,
		generation: _generation,
		...features
	} = signature;
	return {
		stageId,
		...features,
		avoidFingerprints: [...new Set(options.avoidFingerprints ?? [])].slice(0, 12),
		maximumPromptCharacters: stageId >= 8 ? 8000 : 1200,
	};
}

function encode(seed: number): string {
	return seed.toString(36);
}

function decode(value: string): number | null {
	if (!/^[0-9a-z]+$/.test(value)) return null;
	const seed = Number.parseInt(value, 36);
	return Number.isSafeInteger(seed) && seed >= 0 ? seed : null;
}

function generatedTaskId(stageId: number, seed: number, features: ProblemFeatureSignature): string {
	return `stage-${stageId}-generated-${encode(seed)}-${features.selectionReason}-${features.skillTargets[0]}`;
}

function parseGeneratedTaskId(taskId: string): { stageId: number; seed: number; options: GenerationOptions } | null {
	const match = /^stage-(\d+)-generated-([0-9a-z]+)(?:-(weakness|core|exploration)-([a-z0-9_]+))?$/.exec(taskId);
	if (!match) return null;
	const stageId = Number(match[1]);
	const seed = decode(match[2]);
	const targetSkill = match[4];
	if (stageId < 1 || stageId > 13 || seed === null) return null;
	if (targetSkill && !(SKILL_KEYS as readonly string[]).includes(targetSkill)) return null;
	return {
		stageId,
		seed,
		options: match[3] && targetSkill ? { selectionReason: match[3] as ProblemSelectionReason, targetSkill: targetSkill as SkillKey } : {},
	};
}

function hashText(value: string): string {
	let hash = 2166136261;
	for (const character of value.normalize('NFKC')) {
		hash ^= character.codePointAt(0) ?? 0;
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0).toString(16).padStart(8, '0');
}

export function normalizePrompt(value: string): string {
	return value.normalize('NFKC').toLowerCase().replace(/[\s　]+/g, '').replace(/[「」『』（）()、。！？!?]/g, '');
}

export function promptHash(value: string): string {
	return `fnv1a:${hashText(normalizePrompt(value))}`;
}

export function promptNgrams(value: string, width = 3): Set<string> {
	const normalized = normalizePrompt(value);
	if (normalized.length <= width) return new Set(normalized ? [normalized] : []);
	return new Set(Array.from({ length: normalized.length - width + 1 }, (_, index) => normalized.slice(index, index + width)));
}

export function promptSimilarity(left: string, right: string): number {
	const a = promptNgrams(left);
	const b = promptNgrams(right);
	if (!a.size && !b.size) return 1;
	let intersection = 0;
	for (const item of a) if (b.has(item)) intersection += 1;
	return intersection / (a.size + b.size - intersection || 1);
}

export function generatedTaskSeed(taskId: string): number | null {
	return parseGeneratedTaskId(taskId)?.seed ?? null;
}

function uniqueSkills(primary: SkillKey | undefined, core: SkillKey[]): SkillKey[] {
	return [...new Set(primary ? [primary, ...core] : core)].slice(0, 3);
}

export function createProblemFeatures(stageId: number, seed: number, options: GenerationOptions = {}): ProblemFeatureSignature {
	const templates = getStageTasks(stageId);
	if (!Number.isSafeInteger(seed) || seed < 0 || !templates.length) throw new Error(`段階${stageId}の問題を生成できません。`);
	const design = getStageProblemDesign(stageId);
	const topic = templates[seed % templates.length];
	const variant = Math.floor(seed / templates.length);
	const skillTargets = uniqueSkills(options.targetSkill, design.coreSkills);
	const signature = {
		version: 2 as const,
		seed,
		topicDomain: topicDomainFor(topic.topicKey),
		topicKey: topic.topicKey,
		promptFamily: design.promptFamily,
		skillTargets,
		selectionReason: options.selectionReason ?? 'exploration',
		surfacePattern: surfacePatterns[variant % surfacePatterns.length],
		languagePattern: selectFrom(design.languagePatterns, variant),
		perspective: selectFrom(design.perspectives, variant),
		reasoning: selectFrom(design.reasoningModes, variant),
		evidenceMode: selectFrom(design.evidenceModes, variant),
		structurePattern: selectFrom(design.structurePatterns, variant),
		sourceStructure: selectFrom(design.sourceStructures, variant),
		summaryOperation: selectFrom(design.summaryOperations, variant),
		issueConflict: selectFrom(design.issueConflicts, variant),
		sourceUse: selectFrom(design.sourceUses, variant),
		counterposition: selectFrom(design.counterpositions, variant),
		responseStrategy: selectFrom(design.responseStrategies, variant),
		synthesisPattern: selectFrom(design.synthesisPatterns, variant),
		generation: {
			source: seed < templates.length ? 'curated' as const : 'local_variant' as const,
			designVersion: PROBLEM_DESIGN_VERSION,
			promptVersion: LOCAL_PROMPT_VERSION,
		},
	};
	const fingerprintSource = JSON.stringify({
		stageId,
		topic: signature.topicKey,
		family: signature.promptFamily,
		skills: signature.skillTargets,
		surface: signature.surfacePattern,
		language: signature.languagePattern,
		perspective: signature.perspective,
		reasoning: signature.reasoning,
		evidence: signature.evidenceMode,
		structure: signature.structurePattern,
		sourceStructure: signature.sourceStructure,
		summary: signature.summaryOperation,
		conflict: signature.issueConflict,
		sourceUse: signature.sourceUse,
		counter: signature.counterposition,
		response: signature.responseStrategy,
		synthesis: signature.synthesisPattern,
	});
	return { ...signature, fingerprint: `pfs2:${hashText(fingerprintSource)}` };
}

function focusInstruction(skill: SkillKey, surfacePattern: string): string {
	const guidance = skillGuidanceFor(skill);
	switch (surfacePattern) {
		case 'reader-check': return `読み手が迷わないよう、${guidance}を意識してください。`;
		case 'revision-focus': return `書いた後に、${guidance}を確認してください。`;
		case 'explain-clearly': return `${guidance}が伝わる書き方を選んでください。`;
		default: return `今回は、${guidance}を特に意識してください。`;
	}
}

export function generatePracticeTask(stageId: number, seed: number, options: GenerationOptions = {}): PracticeTask {
	const templates = getStageTasks(stageId);
	if (!Number.isSafeInteger(seed) || seed < 0 || !templates.length) throw new Error('問題生成IDが不正です。');
	const features = createProblemFeatures(stageId, seed, options);
	const base = templates[seed % templates.length];
	const prompt = features.generation.source === 'curated'
		? base.prompt
		: `${base.prompt}\n\n${focusInstruction(features.skillTargets[0], features.surfacePattern)}`;
	return {
		id: generatedTaskId(stageId, seed, features),
		stageId,
		topicKey: base.topicKey,
		title: `${getStage(stageId)?.name ?? `段階${stageId}`}：${features.selectionReason === 'weakness' ? '重点練習' : features.selectionReason === 'core' ? '基本練習' : '発展練習'}`,
		prompt,
		hint: base.hint,
		features,
	};
}

export function resolvePracticeTask(taskId: string): PracticeTask | undefined {
	const existing = getPracticeTask(taskId);
	if (existing) {
		const stageTasks = getStageTasks(existing.stageId);
		const seed = Math.max(0, stageTasks.findIndex((task) => task.id === taskId));
		return { ...existing, features: createProblemFeatures(existing.stageId, seed) };
	}
	const generated = parseGeneratedTaskId(taskId);
	return generated ? generatePracticeTask(generated.stageId, generated.seed, generated.options) : undefined;
}

export function historyTask(record: ProblemHistoryRecord): PracticeTask {
	return { id: record.taskId, problemId: record.problemId, stageId: record.stageId, topicKey: record.features.topicKey, title: record.taskTitle, prompt: record.prompt, hint: record.hint, features: record.features };
}

export function isKnownTopicDomain(value: string): value is TopicDomain {
	return ['education', 'technology', 'community', 'public_policy', 'environment', 'ethics'].includes(value);
}
