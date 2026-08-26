export type RubricItem = {
	area: string;
	item: string;
	passCondition: string;
	requirement: string;
	aiNotes: string;
};

export type PracticeTask = {
	id: string;
	problemId?: string | null;
	stageId: number;
	topicKey: string;
	title: string;
	prompt: string;
	hint: string;
	features?: ProblemFeatureSignature;
};

export type TopicDomain = 'education' | 'technology' | 'community' | 'public_policy' | 'environment' | 'ethics';

export const SKILL_KEYS = [
	'sentence_completion', 'subject_predicate', 'modifier_clarity', 'particle_accuracy',
	'clear_claim', 'stance_specificity', 'claim_reason_link', 'causal_depth',
	'reason_specificity', 'example_relevance', 'evidence_link', 'paragraph_coherence',
	'conclusion_alignment', 'source_structure', 'source_evidence', 'summary_fidelity',
	'opinion_exclusion', 'source_integration', 'claim_evidence', 'counterargument_fairness',
	'rebuttal_reasoning', 'essay_structure', 'coherence', 'prompt_alignment',
	'logical_consistency', 'multi_perspective',
] as const;

export type SkillKey = typeof SKILL_KEYS[number];

export type ProblemSelectionReason = 'weakness' | 'core' | 'exploration';
export type ProblemGenerationSource = 'curated' | 'local_variant' | 'ai';

export type ProblemFeatureSignature = {
	version: 2;
	fingerprint: string;
	seed: number;
	topicDomain: TopicDomain;
	topicKey: string;
	promptFamily: string;
	skillTargets: SkillKey[];
	selectionReason: ProblemSelectionReason;
	surfacePattern: string;
	languagePattern?: string;
	perspective?: string;
	reasoning?: string;
	evidenceMode?: string;
	structurePattern?: string;
	sourceStructure?: string;
	summaryOperation?: string;
	issueConflict?: string;
	sourceUse?: string;
	counterposition?: string;
	responseStrategy?: string;
	synthesisPattern?: string;
	generation: {
		source: ProblemGenerationSource;
		designVersion: string;
		promptVersion: string;
		model?: string;
	};
};

export type ProblemSpecification = Omit<ProblemFeatureSignature, 'version' | 'fingerprint' | 'seed' | 'surfacePattern' | 'generation'> & {
	stageId: number;
	avoidFingerprints: string[];
	maximumPromptCharacters: number;
};

export type CurriculumStage = {
	id: number;
	name: string;
	purpose: string;
	learnerAction: string;
	passSummary: string;
	progression: string;
	notes: string;
	rubric: RubricItem[];
	tasks: PracticeTask[];
};

export type LanguageCheck = {
	type: string;
	area: string;
	check: string;
	problemExample: string;
	feedbackGuidance: string;
};

export type Curriculum = {
	schemaVersion: '1.1';
	sourceFile: string;
	duplicateRowsRemoved: number;
	stages: CurriculumStage[];
	languageChecks: LanguageCheck[];
};
