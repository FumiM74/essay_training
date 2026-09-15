import { getPracticeTask, getStage, getStageTasks } from '$lib/data/curriculum';
import { MAX_STAGE_ID, SKILL_KEYS, type BasicQuestion, type PracticeTask, type ProblemFeatureSignature, type ProblemSelectionReason, type ProblemSpecification, type SkillKey, type TopicDomain } from '$lib/types/curriculum';
import type { ProblemHistoryRecord } from '$lib/types/learning';
import { getStageProblemDesign, LOCAL_PROMPT_VERSION, PROBLEM_DESIGN_VERSION, selectFrom, topicDomainFor } from './learning-design';
import { curatedQuestionSet } from './curated-question-sets';
import { customTopicKey, MAX_CUSTOM_TOPIC_CHARACTERS, normalizeCustomTopics } from './topic-preferences';

type GenerationOptions = {
	selectionReason?: ProblemSelectionReason;
	targetSkill?: SkillKey;
	customTopic?: string;
	topicKeyOverride?: string;
};

const surfacePatterns = ['direct', 'reader-check', 'revision-focus', 'explain-clearly'] as const;

function isNonEmptyString(value: unknown, maximum = 200): value is string {
	return typeof value === 'string' && value.length > 0 && value.length <= maximum;
}

function isCustomTopicText(value: unknown): value is string {
	return typeof value === 'string' && value.trim() === value && value.length > 0 && Array.from(value).length <= MAX_CUSTOM_TOPIC_CHARACTERS;
}

function isStringArray(value: unknown, maximum: number, maximumCharacters = 200): value is string[] {
	return Array.isArray(value) && value.length > 0 && value.length <= maximum && value.every((item) => isNonEmptyString(item, maximumCharacters));
}

function isSkillArray(value: unknown): value is SkillKey[] {
	return isStringArray(value, 8) && value.every((item) => (SKILL_KEYS as readonly string[]).includes(item));
}

function isAiGenerationContract(value: unknown): value is NonNullable<ProblemFeatureSignature['generationContract']> {
	if (!value || typeof value !== 'object') return false;
	const contract = value as Record<string, unknown>;
	const categories = ['subject_predicate', 'particle', 'auxiliary', 'word_order', 'sentence_revision',
		'relation_sentence', 'clarity_revision', 'information_selection', 'sentence_order', 'missing_link', 'flow_revision'];
	return Array.isArray(contract.acceptedAnswerExamples) && contract.acceptedAnswerExamples.every((item) => isNonEmptyString(item, 5000))
		&& Array.isArray(contract.gradingCriteria) && contract.gradingCriteria.every((item) => item && typeof item === 'object'
			&& (SKILL_KEYS as readonly string[]).includes(String((item as Record<string, unknown>).skillKey))
			&& isNonEmptyString((item as Record<string, unknown>).passCondition, 600))
		&& Array.isArray(contract.hiddenRequirements) && contract.hiddenRequirements.length === 0
		&& Array.isArray(contract.basicQuestions) && contract.basicQuestions.length <= 5
		&& contract.basicQuestions.every((item) => item && typeof item === 'object'
			&& categories.includes(String((item as Record<string, unknown>).category))
			&& isNonEmptyString((item as Record<string, unknown>).instruction, 500)
			&& isNonEmptyString((item as Record<string, unknown>).prompt, 2400)
			&& Array.isArray((item as Record<string, unknown>).choices)
			&& ((item as Record<string, unknown>).choices as unknown[]).every((choice) => isNonEmptyString(choice))
			&& isStringArray((item as Record<string, unknown>).referenceAnswers, 6, 3000)
			&& isNonEmptyString((item as Record<string, unknown>).referenceAnswerLabel, 1000)
			&& isNonEmptyString((item as Record<string, unknown>).gradingPoint, 600)
			&& (SKILL_KEYS as readonly string[]).includes(String((item as Record<string, unknown>).skillKey)));
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
		&& (candidate.customTopic === undefined || (isCustomTopicText(candidate.customTopic) && candidate.topicKey === customTopicKey(candidate.customTopic)))
		&& isNonEmptyString(candidate.promptFamily)
		&& isSkillArray(candidate.skillTargets)
		&& ['weakness', 'core', 'exploration'].includes(String(candidate.selectionReason))
		&& isNonEmptyString(candidate.surfacePattern)
		&& optionalFeatures.every((item) => item === undefined || isNonEmptyString(item))
		&& Boolean(generation
			&& ['curated', 'local_variant', 'ai'].includes(String(generation.source))
			&& isNonEmptyString(generation.designVersion)
			&& isNonEmptyString(generation.promptVersion)
			&& (generation.model === undefined || isNonEmptyString(generation.model)))
		&& (candidate.generationContract === undefined || isAiGenerationContract(candidate.generationContract));
}

export function questionSetFromGenerationContract(features: ProblemFeatureSignature): BasicQuestion[] | undefined {
	const questions = features.generationContract?.basicQuestions;
	if (!questions?.length) return undefined;
	return questions.map((question, index) => ({
		id: `ai-${features.fingerprint}-${index + 1}`,
		category: question.category,
		instruction: question.instruction,
		prompt: question.prompt,
		...(question.choices.length ? { choices: question.choices } : {}),
		multiline: question.choices.length === 0,
		acceptedAnswers: question.referenceAnswers,
		answerLabel: question.referenceAnswerLabel,
		explanation: question.gradingPoint,
		skillKey: question.skillKey,
	}));
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
	const topicSuffix = features.topicKey.startsWith('learner-topic-') ? `-t${features.topicKey.slice(-8)}` : '';
	return `stage-${stageId}-generated-${encode(seed)}-${features.selectionReason}-${features.skillTargets[0]}${topicSuffix}`;
}

function parseGeneratedTaskId(taskId: string): { stageId: number; seed: number; options: GenerationOptions } | null {
	const match = /^stage-(\d+)-generated-([0-9a-z]+)(?:-(weakness|core|exploration)-([a-z0-9_]+?))?(?:-t([0-9a-f]{8}))?(?:-(?:q|i)([0-9a-f]{8}))?$/.exec(taskId);
	if (!match) return null;
	const stageId = Number(match[1]);
	const seed = decode(match[2]);
	const targetSkill = match[4];
	if (stageId < 1 || stageId > MAX_STAGE_ID || seed === null) return null;
	if (targetSkill && !(SKILL_KEYS as readonly string[]).includes(targetSkill)) return null;
	return {
		stageId,
		seed,
		options: match[3] && targetSkill ? {
			selectionReason: match[3] as ProblemSelectionReason,
			targetSkill: targetSkill as SkillKey,
			...(match[5] ? { topicKeyOverride: `learner-topic-${match[5]}` } : {}),
		} : {},
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

export function basicQuestionSet(seed: number): BasicQuestion[] {
	return curatedQuestionSet(1, seed) ?? [];
}

export function questionSetForStage(stageId: number, seed: number): BasicQuestion[] | undefined {
	return curatedQuestionSet(stageId, seed);
}

export function promptHash(value: string): string {
	return `fnv1a:${hashText(normalizePrompt(value))}`;
}

export function practiceTaskPromptHash(task: Pick<PracticeTask, 'prompt' | 'questionSet'>): string {
	if (!task.questionSet?.length) return promptHash(task.prompt);
	const questionText = task.questionSet.map((question) => [
		question.category,
		question.instruction,
		question.prompt,
		...(question.choices ?? []),
		...question.acceptedAnswers,
		question.answerLabel,
		question.explanation,
	].join('\n')).join('\n---\n');
	return promptHash(`${task.prompt}\n${questionText}`);
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
	return [...new Set(primary ? [primary, ...core] : core)].slice(0, 8);
}

const mixedQuestionSetTopicKeys: Partial<Record<number, string>> = {
	1: 'language-basics-mixed',
	2: 'sentence-structure-mixed',
	3: 'logic-flow-mixed',
};

export function createProblemFeatures(stageId: number, seed: number, options: GenerationOptions = {}): ProblemFeatureSignature {
	const templates = getStageTasks(stageId);
	if (!Number.isSafeInteger(seed) || seed < 0 || !templates.length) throw new Error(`段階${stageId}の問題を生成できません。`);
	const design = getStageProblemDesign(stageId);
	const topic = templates[seed % templates.length];
	const normalizedCustomTopic = options.customTopic === undefined ? undefined : normalizeCustomTopics([options.customTopic])[0];
	if (normalizedCustomTopic && stageId < 4) throw new Error('自由設定のテーマはSTEP 4以降で使用できます。');
	const topicKey = normalizedCustomTopic ? customTopicKey(normalizedCustomTopic) : options.topicKeyOverride ?? mixedQuestionSetTopicKeys[stageId] ?? topic.topicKey;
	const variant = Math.floor(seed / templates.length);
	const skillTargets = uniqueSkills(options.targetSkill, design.coreSkills);
	const signature = {
		version: 2 as const,
		seed,
		topicDomain: normalizedCustomTopic || options.topicKeyOverride ? 'public_policy' as const : topicDomainFor(topicKey),
		topicKey,
		...(normalizedCustomTopic ? { customTopic: normalizedCustomTopic } : {}),
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
			source: normalizedCustomTopic || options.topicKeyOverride || seed >= templates.length ? 'local_variant' as const : 'curated' as const,
			designVersion: PROBLEM_DESIGN_VERSION,
			promptVersion: LOCAL_PROMPT_VERSION,
		},
	};
	const fingerprintSource = JSON.stringify({
		stageId,
		topic: signature.topicKey,
		customTopic: signature.customTopic,
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
		fixedSet: stageId <= 3 ? seed % templates.length : undefined,
	});
	return { ...signature, fingerprint: `pfs2:${hashText(fingerprintSource)}` };
}

function customTopicPrompt(stageId: number, topic: string): string {
	const quoted = `「${topic}」`;
	switch (stageId) {
		case 4: return `${quoted}について、二文で書いてください。\n\n一文目：あなたの意見\n二文目：その理由`;
		case 5: return `${quoted}についての意見を一つ決め、その理由を、「何が起こり、その結果どうなるのか」が分かるように説明してください。`;
		case 6: return `${quoted}について、意見・理由・具体例の順に三文で書いてください。`;
		case 7: return `${quoted}を題材にした段落を分析し、関係のない文を除いて、必要な説明を補う問題です。`;
		case 8: return `${quoted}について、主張・理由・具体例・結論が自然につながる一段落を書いてください。`;
		case 9: return `${quoted}を扱った意見文を、筆者の主張・理由・反対の立場を残して要約する問題です。`;
		case 10: return `${quoted}を扱った意見文を読み、その内容に触れながら自分の意見を書く問題です。`;
		case 11: return `${quoted}について、自分の意見、反対の立場、反対意見を踏まえても自分の意見を選ぶ理由を書いてください。`;
		case 12: return `${quoted}について、主張・理由・具体例・反対意見とそれへの答え・結論の構成メモを作ってください。`;
		case 13: return `${quoted}について、主張・理由・具体例・結論が一貫する、複数段落の短い小論文を書いてください。`;
		case 14: return `${quoted}を扱った資料を読み、資料を使って自分の意見を論じる小論文問題です。`;
		default: throw new Error('自由設定のテーマを使用できない段階です。');
	}
}

function varyTaskWording(prompt: string, surfacePattern: string): string {
	if (surfacePattern === 'direct') return prompt;
	if (surfacePattern === 'reader-check') {
		return prompt
			.replace(/書いてください。$/, '書きましょう。')
			.replace(/説明してください。$/, '説明しましょう。')
			.replace(/要約してください。$/, '要約しましょう。')
			.replace(/検討してください。$/, '検討しましょう。');
	}
	if (surfacePattern === 'revision-focus') {
		return prompt
			.replace(/書いてください。$/, '自分の言葉で書いてください。')
			.replace(/説明してください。$/, '自分の言葉で説明してください。')
			.replace(/要約してください。$/, '自分の言葉で要約してください。');
	}
	return prompt
		.replace(/書いてください。$/, '述べてください。')
		.replace(/説明してください。$/, '述べてください。')
		.replace(/要約してください。$/, 'まとめてください。')
		.replace(/検討してください。$/, '考えてください。');
}

export function generatePracticeTask(stageId: number, seed: number, options: GenerationOptions = {}): PracticeTask {
	const templates = getStageTasks(stageId);
	if (!Number.isSafeInteger(seed) || seed < 0 || !templates.length) throw new Error('問題生成IDが不正です。');
	const features = createProblemFeatures(stageId, seed, options);
	const base = templates[seed % templates.length];
	const prompt = stageId <= 3
		? stageId === 1
			? '文を正しく組み立てるための基礎問題5問に解答してください。'
			: stageId === 2
				? '情報の関係と読みやすさを考え、一文を組み立てる3問に解答してください。'
				: '文の順序や説明のつながりを考え、論理の流れを整える3問に解答してください。'
		: features.customTopic ? customTopicPrompt(stageId, features.customTopic)
			: features.generation.source === 'curated' ? base.prompt : varyTaskWording(base.prompt, features.surfacePattern);
	const hint = base.hint;
	return {
		id: generatedTaskId(stageId, seed, features),
		stageId,
		topicKey: features.topicKey,
		title: features.customTopic ? `${getStage(stageId)?.name ?? `段階${stageId}`}：${features.customTopic}`
			: `${getStage(stageId)?.name ?? `段階${stageId}`}：${features.selectionReason === 'weakness' ? '重点練習' : features.selectionReason === 'core' ? '基本練習' : '発展練習'}`,
		prompt,
		hint,
		questionSet: questionSetForStage(stageId, seed),
		features,
	};
}

export function resolvePracticeTask(taskId: string): PracticeTask | undefined {
	const existing = getPracticeTask(taskId);
	if (existing) {
		const stageTasks = getStageTasks(existing.stageId);
		const seed = Math.max(0, stageTasks.findIndex((task) => task.id === taskId));
		return { ...existing, questionSet: questionSetForStage(existing.stageId, seed), features: createProblemFeatures(existing.stageId, seed) };
	}
	const generated = parseGeneratedTaskId(taskId);
	// QA・試用問題の接尾辞も発行済み問題IDの一部である。URLを解析して
	// 内容を復元するときもIDを落とさず、DB上のtask_keyと画面を一致させる。
	return generated ? { ...generatePracticeTask(generated.stageId, generated.seed, generated.options), id: taskId } : undefined;
}

export function historyTask(record: ProblemHistoryRecord): PracticeTask {
	const isLegacyLocalVariant = record.features.generation.source === 'local_variant'
		&& record.features.generation.promptVersion === 'adaptive-local-v1';
	const isAiGenerated = record.features.generation.source === 'ai';
	const needsCurrentCopy = !isAiGenerated && record.features.generation.promptVersion !== LOCAL_PROMPT_VERSION;
	const separator = record.prompt.lastIndexOf('\n\n');
	const legacyCleanedPrompt = isLegacyLocalVariant && separator >= 0 ? record.prompt.slice(0, separator) : record.prompt;
	const restored = resolvePracticeTask(record.taskId);
	const prompt = record.stageId <= 3
		? (needsCurrentCopy && restored ? restored.prompt : legacyCleanedPrompt).replace(/（セット\d+）$/, '')
		: needsCurrentCopy && restored ? restored.prompt : legacyCleanedPrompt;
	const currentBaseHint = getStageTasks(record.stageId).find((task) => task.topicKey === record.features.topicKey)?.hint;
	const hint = needsCurrentCopy && (restored?.hint || currentBaseHint)
		? restored?.hint ?? currentBaseHint!
		: record.hint;
	return {
		id: record.taskId,
		problemId: record.problemId,
		stageId: record.stageId,
		topicKey: record.features.topicKey,
		title: needsCurrentCopy && restored ? restored.title : record.taskTitle,
		prompt,
		hint,
		questionSet: isAiGenerated ? questionSetFromGenerationContract(record.features) : restored?.questionSet,
		features: needsCurrentCopy && restored ? restored.features : record.features,
	};
}

export function isKnownTopicDomain(value: string): value is TopicDomain {
	return ['education', 'technology', 'community', 'public_policy', 'environment', 'ethics'].includes(value);
}
