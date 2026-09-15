export const PROBLEM_GENERATION_MODEL = 'claude-sonnet-5';
export const PROBLEM_GENERATION_PROMPT_VERSION = 'problem-generation-v5';

export const STAGE_PROBLEM_SKILLS: Record<number, string[]> = {
	1: ['subject_predicate', 'particle_accuracy', 'auxiliary_accuracy', 'modifier_clarity', 'sentence_completion'],
	2: ['sentence_relation', 'modifier_clarity', 'sentence_completion'],
	3: ['paragraph_coherence', 'claim_reason_link', 'paragraph_analysis'],
	4: ['clear_claim', 'claim_reason_link', 'reason_specificity'],
	5: ['causal_depth', 'reason_specificity'],
	6: ['example_relevance', 'evidence_link'],
	7: ['paragraph_analysis', 'source_structure', 'paragraph_coherence', 'conclusion_alignment'],
	8: ['paragraph_coherence', 'conclusion_alignment'],
	9: ['summary_fidelity', 'opinion_exclusion'],
	10: ['source_integration', 'claim_evidence'],
	11: ['counterargument_fairness', 'rebuttal_reasoning'],
	12: ['outline_planning', 'essay_structure', 'claim_evidence'],
	13: ['essay_structure', 'coherence', 'claim_evidence'],
	14: ['prompt_alignment', 'logical_consistency', 'multi_perspective', 'conclusion_alignment'],
};

export type SourceTreatment = 'must_keep' | 'may_rephrase' | 'must_remove';
export type GeneratedQuestionCategory = 'subject_predicate' | 'particle' | 'auxiliary' | 'word_order' | 'sentence_revision'
	| 'relation_sentence' | 'clarity_revision' | 'information_selection'
	| 'sentence_order' | 'missing_link' | 'flow_revision';

export type GeneratedBasicQuestion = {
	category: GeneratedQuestionCategory;
	instruction: string;
	prompt: string;
	choices: string[];
	referenceAnswers: string[];
	referenceAnswerLabel: string;
	gradingPoint: string;
	skillKey: string;
	sourceUnits: Array<{ content: string; treatment: SourceTreatment }>;
	requiredAdditions: Array<{ role: string; description: string }>;
	hiddenRequirements: string[];
};

export type ProblemGenerationSpecification = {
	stageId: number;
	topicDomain: string;
	topicKey: string;
	customTopic?: string;
	promptFamily: string;
	skillTargets: string[];
	selectionReason: 'weakness' | 'core' | 'exploration';
	maximumPromptCharacters: number;
	avoidFingerprints: string[];
};

export type GeneratedProblem = {
	title: string;
	prompt: string;
	hint: string;
	sourceUnits: Array<{ content: string; treatment: SourceTreatment }>;
	requiredAdditions: Array<{ role: string; description: string }>;
	acceptedAnswerExamples: string[];
	gradingCriteria: Array<{ skillKey: string; passCondition: string }>;
	hiddenRequirements: string[];
	basicQuestions: GeneratedBasicQuestion[];
};

export function problemGenerationModel(env: { CLAUDE_PROBLEM_GENERATION_MODEL?: string }): string {
	return env.CLAUDE_PROBLEM_GENERATION_MODEL || PROBLEM_GENERATION_MODEL;
}

function nonEmpty(value: unknown, maximum: number): value is string {
	return typeof value === 'string' && value.trim().length > 0 && value.length <= maximum;
}

function normalized(value: string): string {
	return value.normalize('NFKC').replace(/[\s　「」『』（）()、。！？!?]/g, '');
}

const questionDesignByStage: Record<number, Array<{ category: GeneratedQuestionCategory; skillKey: string }>> = {
	1: [
		{ category: 'subject_predicate', skillKey: 'subject_predicate' },
		{ category: 'particle', skillKey: 'particle_accuracy' },
		{ category: 'auxiliary', skillKey: 'auxiliary_accuracy' },
		{ category: 'word_order', skillKey: 'modifier_clarity' },
		{ category: 'sentence_revision', skillKey: 'sentence_completion' },
	],
	2: [
		{ category: 'relation_sentence', skillKey: 'sentence_relation' },
		{ category: 'clarity_revision', skillKey: 'modifier_clarity' },
		{ category: 'information_selection', skillKey: 'sentence_completion' },
	],
	3: [
		{ category: 'sentence_order', skillKey: 'paragraph_coherence' },
		{ category: 'missing_link', skillKey: 'claim_reason_link' },
		{ category: 'flow_revision', skillKey: 'paragraph_analysis' },
	],
};

export function questionDesignForGeneration(stageId: number) {
	return questionDesignByStage[stageId] ?? [];
}

function validateSourceDisclosure(container: { instruction?: string; prompt: string; sourceUnits: GeneratedProblem['sourceUnits']; requiredAdditions: GeneratedProblem['requiredAdditions'] }) {
	const learnerText = `${container.instruction ?? ''}\n${container.prompt}`;
	const normalizedLearnerText = normalized(learnerText);
	for (const source of container.sourceUnits) {
		if (!normalizedLearnerText.includes(normalized(source.content))) throw new Error('source_not_shown_to_learner');
		const disclosurePatterns: Record<SourceTreatment, RegExp> = {
			must_keep: /残|すべて使|省かず/,
			may_rephrase: /言い換|表現.{0,8}変|意味.{0,8}保|言葉の形や順(番|序).{0,8}変/,
			must_remove: /除|削|使わない|使いません|含めない|材料だけを使/,
		};
		if (!disclosurePatterns[source.treatment].test(learnerText)) throw new Error('source_treatment_not_disclosed');
	}
	for (const addition of container.requiredAdditions) {
		if (!normalizedLearnerText.includes(normalized(addition.role))) throw new Error('required_addition_not_disclosed');
	}
}

function validateGeneratedBasicQuestion(value: unknown, expected: { category: GeneratedQuestionCategory; skillKey: string }): value is GeneratedBasicQuestion {
	if (!value || typeof value !== 'object') return false;
	const question = value as Record<string, unknown>;
	if (question.category !== expected.category || question.skillKey !== expected.skillKey
		|| !nonEmpty(question.instruction, 500) || !nonEmpty(question.prompt, 2400)
		|| !Array.isArray(question.choices) || question.choices.length > 8 || !question.choices.every((item) => nonEmpty(item, 200))
		|| !Array.isArray(question.referenceAnswers) || question.referenceAnswers.length < 1 || question.referenceAnswers.length > 6
		|| !question.referenceAnswers.every((item) => nonEmpty(item, 3000))
		|| !nonEmpty(question.referenceAnswerLabel, 1000) || !nonEmpty(question.gradingPoint, 600)
		|| !Array.isArray(question.sourceUnits) || question.sourceUnits.length > 8
		|| !question.sourceUnits.every((item) => item && typeof item === 'object' && nonEmpty((item as Record<string, unknown>).content, 1000)
			&& ['must_keep', 'may_rephrase', 'must_remove'].includes(String((item as Record<string, unknown>).treatment)))
		|| !Array.isArray(question.requiredAdditions) || question.requiredAdditions.length > 4
		|| !question.requiredAdditions.every((item) => item && typeof item === 'object' && nonEmpty((item as Record<string, unknown>).role, 80)
			&& nonEmpty((item as Record<string, unknown>).description, 500))
		|| !Array.isArray(question.hiddenRequirements) || question.hiddenRequirements.length !== 0) return false;
	validateSourceDisclosure(question as unknown as GeneratedBasicQuestion);
	if (expected.category === 'information_selection') {
		const instruction = String(question.instruction);
		const sourceUnits = question.sourceUnits as GeneratedBasicQuestion['sourceUnits'];
		if (!/(意見と、その理由になる|目的と、目的に合う|方針と、その理由になる|利点と利用条件に関係する)材料だけを使って/.test(instruction)
			|| !/(言葉の形や順(番|序).{0,8}変|意味を保って言い換)/.test(instruction)
			|| !sourceUnits.some((source) => source.treatment === 'must_remove')
			|| !sourceUnits.some((source) => source.treatment === 'must_keep' || source.treatment === 'may_rephrase')) {
			throw new Error('ambiguous_information_selection');
		}
	}
	return true;
}

export function validateGeneratedProblem(value: unknown, specification: ProblemGenerationSpecification): GeneratedProblem {
	if (!value || typeof value !== 'object') throw new Error('invalid_generated_problem');
	const problem = value as Record<string, unknown>;
	if (!nonEmpty(problem.title, 160) || !nonEmpty(problem.prompt, specification.maximumPromptCharacters)
		|| !nonEmpty(problem.hint, 1000)) throw new Error('invalid_generated_problem_text');
	const questionDesign = questionDesignForGeneration(specification.stageId);
	if (questionDesign.length && ((problem.sourceUnits as unknown[])?.length !== 0
		|| (problem.requiredAdditions as unknown[])?.length !== 0
		|| (problem.acceptedAnswerExamples as unknown[])?.length !== 0
		|| (problem.gradingCriteria as unknown[])?.length !== 0)) throw new Error('invalid_question_set_top_level_contract');
	if (!Array.isArray(problem.basicQuestions) || problem.basicQuestions.length !== questionDesign.length) throw new Error('invalid_generated_question_count');
	for (let index = 0; index < questionDesign.length; index += 1) {
		if (!validateGeneratedBasicQuestion(problem.basicQuestions[index], questionDesign[index])) throw new Error('invalid_generated_question');
	}
	if (!Array.isArray(problem.sourceUnits) || problem.sourceUnits.length > 12
		|| !problem.sourceUnits.every((item) => item && typeof item === 'object'
			&& nonEmpty((item as Record<string, unknown>).content, 1000)
			&& ['must_keep', 'may_rephrase', 'must_remove'].includes(String((item as Record<string, unknown>).treatment)))) {
		throw new Error('invalid_source_units');
	}
	if (!Array.isArray(problem.requiredAdditions) || problem.requiredAdditions.length > 8
		|| !problem.requiredAdditions.every((item) => item && typeof item === 'object'
			&& nonEmpty((item as Record<string, unknown>).role, 80)
			&& nonEmpty((item as Record<string, unknown>).description, 500))) throw new Error('invalid_required_additions');
	const expectedAnswerExampleMinimum = questionDesign.length ? 0 : 1;
	if (!Array.isArray(problem.acceptedAnswerExamples) || problem.acceptedAnswerExamples.length < expectedAnswerExampleMinimum
		|| problem.acceptedAnswerExamples.length > 4 || !problem.acceptedAnswerExamples.every((item) => nonEmpty(item, 5000))) {
		throw new Error('invalid_answer_examples');
	}
	const expectedTopLevelCriteria = questionDesign.length ? 0 : specification.skillTargets.length;
	if (!Array.isArray(problem.gradingCriteria) || problem.gradingCriteria.length !== expectedTopLevelCriteria
		|| !problem.gradingCriteria.every((item) => item && typeof item === 'object'
			&& specification.skillTargets.includes(String((item as Record<string, unknown>).skillKey))
			&& nonEmpty((item as Record<string, unknown>).passCondition, 600))) throw new Error('invalid_grading_criteria');
	const criterionSkills = questionDesign.length
		? (problem.basicQuestions as GeneratedBasicQuestion[]).map((item) => item.skillKey)
		: (problem.gradingCriteria as Array<{ skillKey: string }>).map((item) => item.skillKey);
	if (new Set(criterionSkills).size !== criterionSkills.length || specification.skillTargets.some((skill) => !criterionSkills.includes(skill))) throw new Error('invalid_grading_skills');
	if (!Array.isArray(problem.hiddenRequirements) || problem.hiddenRequirements.length !== 0) throw new Error('hidden_grading_requirement');
	validateSourceDisclosure(problem as unknown as GeneratedProblem);
	return problem as GeneratedProblem;
}

const sourceUnitSchema = { type: 'object', additionalProperties: false, properties: {
	content: { type: 'string' }, treatment: { type: 'string', enum: ['must_keep', 'may_rephrase', 'must_remove'] },
}, required: ['content', 'treatment'] } as const;
const requiredAdditionSchema = { type: 'object', additionalProperties: false, properties: {
	role: { type: 'string' }, description: { type: 'string' },
}, required: ['role', 'description'] } as const;

export const generatedProblemSchema = {
	type: 'object', additionalProperties: false,
	properties: {
		title: { type: 'string', description: '1〜160文字の課題タイトル' },
		prompt: { type: 'string', description: '学習者に表示する課題文。採点に必要な条件をすべて明記する' },
		hint: { type: 'string', description: '課題文に条件を追加せず、取り組み方だけを説明する' },
		sourceUnits: { type: 'array', description: '単問段階では0〜12件。問題セット段階では空配列', items: sourceUnitSchema },
		requiredAdditions: { type: 'array', description: '単問段階では0〜8件。問題セット段階では空配列', items: requiredAdditionSchema },
		acceptedAnswerExamples: { type: 'array', description: '単問段階は1〜4件、問題セット段階は空配列', items: { type: 'string' } },
		gradingCriteria: { type: 'array', description: '単問段階は対象技能ごとに1件、問題セット段階は空配列', items: { type: 'object', additionalProperties: false, properties: {
			skillKey: { type: 'string' }, passCondition: { type: 'string' },
		}, required: ['skillKey', 'passCondition'] } },
		hiddenRequirements: { type: 'array', items: { type: 'string' }, description: '必ず空配列。アプリ側検証で空配列以外を拒否する' },
		basicQuestions: { type: 'array', description: 'STEP 1は指定順の5問、STEP 2・3は指定順の3問、STEP 4以降は空配列', items: {
			type: 'object', additionalProperties: false, properties: {
				category: { type: 'string' }, instruction: { type: 'string' }, prompt: { type: 'string' },
				choices: { type: 'array', items: { type: 'string' }, description: '選択式以外は空配列' },
				referenceAnswers: { type: 'array', items: { type: 'string' } }, referenceAnswerLabel: { type: 'string' },
				gradingPoint: { type: 'string' }, skillKey: { type: 'string' },
				sourceUnits: { type: 'array', items: sourceUnitSchema }, requiredAdditions: { type: 'array', items: requiredAdditionSchema },
				hiddenRequirements: { type: 'array', items: { type: 'string' }, description: '必ず空配列' },
			}, required: ['category', 'instruction', 'prompt', 'choices', 'referenceAnswers', 'referenceAnswerLabel', 'gradingPoint', 'skillKey', 'sourceUnits', 'requiredAdditions', 'hiddenRequirements'],
		} },
	},
	required: ['title', 'prompt', 'hint', 'sourceUnits', 'requiredAdditions', 'acceptedAnswerExamples', 'gradingCriteria', 'hiddenRequirements', 'basicQuestions'],
} as const;
