import type { ProblemSelectionReason, SkillKey, TopicDomain } from '$lib/types/curriculum';

export const PROBLEM_DESIGN_VERSION = '2026-08-26';
export const LOCAL_PROMPT_VERSION = 'adaptive-local-v1';

export type StageProblemDesign = {
	promptFamily: string;
	coreSkills: SkillKey[];
	languagePatterns?: string[];
	perspectives?: string[];
	reasoningModes?: string[];
	evidenceModes?: string[];
	structurePatterns?: string[];
	sourceStructures?: string[];
	summaryOperations?: string[];
	issueConflicts?: string[];
	sourceUses?: string[];
	counterpositions?: string[];
	responseStrategies?: string[];
	synthesisPatterns?: string[];
};

const designs: Record<number, StageProblemDesign> = {
	1: { promptFamily: 'complete-one-sentence', coreSkills: ['sentence_completion', 'subject_predicate'], languagePatterns: ['single-subject-predicate', 'complete-sentence-ending'] },
	2: { promptFamily: 'clarify-one-sentence', coreSkills: ['modifier_clarity', 'particle_accuracy'], languagePatterns: ['modifier-target', 'particle-choice'] },
	3: { promptFamily: 'state-position', coreSkills: ['clear_claim', 'stance_specificity'], perspectives: ['support', 'oppose', 'conditional'] },
	4: { promptFamily: 'claim-and-reason', coreSkills: ['claim_reason_link', 'reason_specificity'], reasoningModes: ['cause-effect', 'purpose-means', 'value-judgment'] },
	5: { promptFamily: 'deepen-reason', coreSkills: ['causal_depth', 'reason_specificity'], reasoningModes: ['multi-step-causality', 'condition-and-result', 'comparison'] },
	6: { promptFamily: 'support-with-example', coreSkills: ['example_relevance', 'evidence_link'], evidenceModes: ['concrete-case', 'comparison-case', 'observed-change'] },
	7: { promptFamily: 'four-sentence-paragraph', coreSkills: ['paragraph_coherence', 'conclusion_alignment'], structurePatterns: ['claim-reason-example-conclusion', 'issue-claim-reason-conclusion'] },
	8: { promptFamily: 'analyze-source-structure', coreSkills: ['source_structure', 'source_evidence'], sourceStructures: ['claim-reason-example-reservation', 'problem-cause-response-effect'] },
	9: { promptFamily: 'objective-summary', coreSkills: ['summary_fidelity', 'opinion_exclusion'], sourceStructures: ['claim-reason-example-reservation', 'problem-cause-response-effect'], summaryOperations: ['retain-main-claim', 'retain-contrast', 'remove-example-detail'] },
	10: { promptFamily: 'source-based-opinion', coreSkills: ['source_integration', 'claim_evidence'], issueConflicts: ['freedom-vs-safety', 'efficiency-vs-fairness', 'cost-vs-benefit', 'individual-vs-society', 'innovation-vs-risk', 'uniformity-vs-diversity'], sourceUses: ['support', 'qualify', 'compare'] },
	11: { promptFamily: 'handle-counterposition', coreSkills: ['counterargument_fairness', 'rebuttal_reasoning'], counterpositions: ['cost-concern', 'fairness-concern', 'feasibility-concern', 'autonomy-concern'], responseStrategies: ['acknowledge-and-limit', 'condition-and-rebut', 'compare-priorities'] },
	12: { promptFamily: 'mini-essay', coreSkills: ['essay_structure', 'coherence', 'claim_evidence'], reasoningModes: ['cause-effect', 'comparison', 'trade-off'], evidenceModes: ['concrete-case', 'comparison-case'], synthesisPatterns: ['claim-two-reasons-conclusion', 'issue-claim-counterpoint-conclusion'] },
	13: { promptFamily: 'full-essay', coreSkills: ['prompt_alignment', 'logical_consistency', 'multi_perspective', 'conclusion_alignment'], reasoningModes: ['cause-effect', 'comparison', 'trade-off'], issueConflicts: ['freedom-vs-safety', 'efficiency-vs-fairness', 'cost-vs-benefit', 'individual-vs-society', 'innovation-vs-risk', 'uniformity-vs-diversity'], responseStrategies: ['acknowledge-and-limit', 'condition-and-rebut', 'compare-priorities'], synthesisPatterns: ['claim-multiple-evidence-counterpoint-conclusion', 'issue-analysis-proposal-qualification-conclusion'] },
};

const topicDomains: Record<string, TopicDomain> = {
	'accessible-design': 'public_policy',
	'school-reading': 'education',
	'smartphone-rules': 'technology',
	'community-events': 'community',
	'public-transport': 'public_policy',
	'learning-from-failure': 'education',
	'collaborative-learning': 'education',
	'online-learning': 'technology',
	'school-uniforms': 'ethics',
	'generative-ai': 'technology',
	'food-loss': 'environment',
	'disaster-preparedness': 'community',
	'school-rules': 'ethics',
	'news-structure': 'community',
	'intergenerational-community': 'community',
};

const skillGuidance: Record<SkillKey, string> = {
	sentence_completion: '文を途中で終わらせず、一文として完成させること',
	subject_predicate: '主語と述語の対応を明確にすること',
	modifier_clarity: '修飾する言葉と修飾される言葉の関係を明確にすること',
	particle_accuracy: '助詞の働きを確かめること',
	clear_claim: '自分の主張を一文ではっきり示すこと',
	stance_specificity: '何を重視する立場なのか具体化すること',
	claim_reason_link: '理由が主張を直接支えるようにすること',
	causal_depth: '原因から結果までを一段深く説明すること',
	reason_specificity: '抽象的な理由を具体化すること',
	example_relevance: '主張と関係する具体例を選ぶこと',
	evidence_link: '具体例が理由をどう支えるか示すこと',
	paragraph_coherence: '段落全体を一つの中心主張にそろえること',
	conclusion_alignment: '結論を最初の主張に対応させること',
	source_structure: '資料の主張・理由・例・留保を区別すること',
	source_evidence: '資料中の表現を根拠として示すこと',
	summary_fidelity: '資料の中心内容を正確に残すこと',
	opinion_exclusion: '自分の意見を要約に混ぜないこと',
	source_integration: '資料の内容と自分の意見の接点を示すこと',
	claim_evidence: '主張に対応する根拠を配置すること',
	counterargument_fairness: '反対意見を弱めず公平に扱うこと',
	rebuttal_reasoning: '反対意見を踏まえて自説を説明すること',
	essay_structure: '序論・本論・結論の役割を整えること',
	coherence: '各文と段落を中心主張へつなげること',
	prompt_alignment: '設問に正面から答えること',
	logical_consistency: '主張と根拠を最後まで一貫させること',
	multi_perspective: '複数の立場や条件を検討すること',
};

export function getStageProblemDesign(stageId: number): StageProblemDesign {
	const design = designs[stageId];
	if (!design) throw new Error(`段階${stageId}の問題設計がありません。`);
	return design;
}

export function topicDomainFor(topicKey: string): TopicDomain {
	const domain = topicDomains[topicKey];
	if (!domain) throw new Error(`題材「${topicKey}」の分野分類がありません。`);
	return domain;
}

export function selectFrom<T>(values: T[] | undefined, seed: number): T | undefined {
	return values?.length ? values[seed % values.length] : undefined;
}

export function selectionReasonForAttempt(attempt: number, hasWeakness: boolean): ProblemSelectionReason {
	const slot = Math.max(0, attempt) % 10;
	if (hasWeakness && slot < 5) return 'weakness';
	if (slot < 8) return 'core';
	return 'exploration';
}

export function skillGuidanceFor(skill: SkillKey): string {
	return skillGuidance[skill];
}

export function skillStatKey(stageId: number, skillKey: SkillKey): string {
	return `${stageId}:${skillKey}`;
}
