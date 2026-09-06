export const SKILL_KEYS = [
	'sentence_completion', 'subject_predicate', 'modifier_clarity', 'particle_accuracy', 'auxiliary_accuracy',
	'sentence_relation', 'paragraph_analysis', 'outline_planning', 'clear_claim', 'stance_specificity',
	'claim_reason_link', 'causal_depth', 'reason_specificity', 'example_relevance', 'evidence_link',
	'paragraph_coherence', 'conclusion_alignment', 'source_structure', 'source_evidence', 'summary_fidelity',
	'opinion_exclusion', 'source_integration', 'claim_evidence', 'counterargument_fairness', 'rebuttal_reasoning',
	'essay_structure', 'coherence', 'prompt_alignment', 'logical_consistency', 'multi_perspective',
] as const;

export type SkillKey = typeof SKILL_KEYS[number];
export type ModelTier = 'haiku' | 'sonnet';

export type BasicQuestionInput = {
	id: string;
	category: 'subject_predicate' | 'particle' | 'auxiliary' | 'word_order' | 'sentence_revision'
		| 'relation_sentence' | 'clarity_revision' | 'information_selection'
		| 'sentence_order' | 'missing_link' | 'flow_revision';
	instruction: string;
	prompt: string;
	choices?: string[];
	answer: string;
};

export type FeedbackRequest = {
	requestId: string;
	taskId: string;
	stageId: number;
	answer: string;
	basicQuestions?: BasicQuestionInput[];
};

export type SkillResult = {
	skillKey: SkillKey;
	outcome: 'achieved' | 'partial' | 'missed';
	severity: 0 | 1 | 2;
	evidence: string;
};

export type FeedbackResult = {
	schemaVersion: string;
	languageStatus: 'clean' | 'minor_issue' | 'revision_required';
	decision: 'pass' | 'revise';
	priorityFeedback: Array<{ title: string; guidance: string }>;
	skillResults: SkillResult[];
	basicQuestionResults?: Array<{
		questionId: string;
		instruction: string;
		prompt: string;
		answer: string;
		correct: boolean;
		answerLabel: string;
		explanation: string;
	}>;
};

export const STAGE_FEEDBACK_DESIGN: Record<number, { focus: string; notRequired: string }> = {
	1: { focus: '5領域の小問題それぞれで、文の基本要素を意味に合う形で使い分けられているか', notRequired: '理由や具体例を書くこと、長い文章を書くこと' },
	2: { focus: '3問それぞれで、情報の関係を読み取り、修飾先を明確にし、必要な情報を選んで読みやすい一文を作れるか', notRequired: '自分で新しい主張や具体例を考えること、段落を書くこと' },
	3: { focus: '3問それぞれで、文の順序、説明の不足、重複や脱線を見つけ、2〜4文の論理の流れを整えられるか', notRequired: '自分で論題への意見や具体例を考えること、長い段落を書くこと' },
	4: { focus: '問いへの意見が明確で、二文目が「なぜそう考えるのか」を説明しているか', notRequired: '具体例、反対意見、段落の構成' },
	5: { focus: '理由によって何が起こり、どのような結果になるのかまで順番に説明しているか', notRequired: '具体例、反対意見、小論文全体の構成' },
	6: { focus: '具体例が、直前に書いた理由が実際に当てはまる場面になっているか', notRequired: '反対意見、資料の読み取り、小論文全体の構成' },
	7: { focus: '段落の各文の役割を判別し、不要文・不適切な順序・論理の飛躍を発見して修正できるか', notRequired: '自分の賛否、長い小論文を書くこと' },
	8: { focus: '主張・理由・具体例・結論が同じ話題を支え、自然な一段落になっているか', notRequired: '資料の引用、反対意見、長い小論文' },
	9: { focus: '筆者が何を主張し、なぜそう述べているのかを残し、自分の意見を加えていないか', notRequired: '自分の主張、反論、細かな具体例' },
	10: { focus: '課題文のどの内容に注目したかが分かり、自分の意見と理由がつながっているか', notRequired: '反対意見への反論、本番と同じ長さの小論文' },
	11: { focus: '反対の立場を正確に示し、納得できる点を認めたうえで、自分の意見を選ぶ理由を書いているか', notRequired: '資料全体の詳しい要約、本番と同じ文章量' },
	12: { focus: '主張・理由・具体例・反対意見への答え・結論を、一貫した構成として設計できているか', notRequired: '完成した文章として書くこと' },
	13: { focus: '最初の意見、理由、具体例、最後の結論が複数段落を通して同じ答えを支えているか', notRequired: '本番と同じ文章量、すべての論点を扱うこと' },
	14: { focus: '設問への答えを示し、理由・具体例・別の立場・結論がその答えからずれていないか', notRequired: '設問で求められていない知識や論点を増やすこと' },
};

export function modelTierForStage(stageId: number): ModelTier {
	if (!Number.isInteger(stageId) || stageId < 1 || stageId > 14) throw new Error('invalid_stage');
	return [1, 4].includes(stageId) ? 'haiku' : 'sonnet';
}

export function modelForStage(stageId: number, env: { CLAUDE_HAIKU_MODEL?: string; CLAUDE_SONNET_MODEL?: string }): string {
	return modelTierForStage(stageId) === 'haiku'
		? env.CLAUDE_HAIKU_MODEL || 'claude-haiku-4-5-20251001'
		: env.CLAUDE_SONNET_MODEL || 'claude-sonnet-4-6';
}

export function outputTokenLimit(stageId: number): number {
	return stageId <= 3 ? 1400 : 1200;
}

export function questionSetSizeForStage(stageId: number): number | null {
	if (stageId === 1) return 5;
	if (stageId === 2 || stageId === 3) return 3;
	return null;
}

const questionCategoriesByStage: Record<number, BasicQuestionInput['category'][]> = {
	1: ['subject_predicate', 'particle', 'auxiliary', 'word_order', 'sentence_revision'],
	2: ['relation_sentence', 'clarity_revision', 'information_selection'],
	3: ['sentence_order', 'missing_link', 'flow_revision'],
};

function nonEmpty(value: unknown, maximum = 2000): value is string {
	return typeof value === 'string' && value.trim().length > 0 && value.length <= maximum;
}

export function parseFeedbackRequest(value: unknown): FeedbackRequest {
	if (!value || typeof value !== 'object') throw new Error('invalid_request');
	const input = value as Record<string, unknown>;
	if (typeof input.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(input.requestId)) throw new Error('invalid_request_id');
	if (!nonEmpty(input.taskId, 120)) throw new Error('invalid_task_id');
	if (!Number.isInteger(input.stageId) || Number(input.stageId) < 1 || Number(input.stageId) > 14) throw new Error('invalid_stage');
	if (!nonEmpty(input.answer, 20000)) throw new Error('invalid_answer');
	const stageId = Number(input.stageId);
	const questionSetSize = questionSetSizeForStage(stageId);
	if (questionSetSize !== null) {
		if (!Array.isArray(input.basicQuestions) || input.basicQuestions.length !== questionSetSize) throw new Error('invalid_basic_questions');
		const ids = new Set<string>();
		for (const raw of input.basicQuestions) {
			if (!raw || typeof raw !== 'object') throw new Error('invalid_basic_question');
			const question = raw as Record<string, unknown>;
			if (!nonEmpty(question.id, 120) || ids.has(question.id)) throw new Error('invalid_basic_question_id');
			ids.add(question.id);
			if (!questionCategoriesByStage[stageId]?.includes(question.category as BasicQuestionInput['category'])) throw new Error('invalid_basic_question_category');
			if (!nonEmpty(question.instruction, 500) || !nonEmpty(question.prompt, 2000) || !nonEmpty(question.answer, 3000)) throw new Error('invalid_basic_question_text');
			if (question.choices !== undefined && (!Array.isArray(question.choices) || question.choices.length < 2 || question.choices.length > 8 || !question.choices.every((item) => nonEmpty(item, 200)))) throw new Error('invalid_basic_question_choices');
		}
	} else if (input.basicQuestions !== undefined) throw new Error('unexpected_basic_questions');
	return input as FeedbackRequest;
}

const categorySkill: Record<BasicQuestionInput['category'], SkillKey> = {
	subject_predicate: 'subject_predicate', particle: 'particle_accuracy', auxiliary: 'auxiliary_accuracy',
	word_order: 'modifier_clarity', sentence_revision: 'sentence_completion',
	relation_sentence: 'sentence_relation', clarity_revision: 'modifier_clarity', information_selection: 'sentence_completion',
	sentence_order: 'paragraph_coherence', missing_link: 'claim_reason_link', flow_revision: 'paragraph_analysis',
};

export function skillForBasicQuestion(question: BasicQuestionInput): SkillKey {
	return categorySkill[question.category];
}

export function validateFeedback(value: unknown, expectedSkills: SkillKey[]): FeedbackResult {
	if (!value || typeof value !== 'object') throw new Error('invalid_feedback');
	const result = value as Record<string, unknown>;
	if (result.schemaVersion !== '1.0') throw new Error('invalid_schema_version');
	if (!['clean', 'minor_issue', 'revision_required'].includes(String(result.languageStatus))) throw new Error('invalid_language_status');
	if (!['pass', 'revise'].includes(String(result.decision))) throw new Error('invalid_decision');
	if (result.languageStatus === 'revision_required' && result.decision !== 'revise') throw new Error('inconsistent_decision');
	if (!Array.isArray(result.priorityFeedback) || result.priorityFeedback.length < 1 || result.priorityFeedback.length > 3
		|| !result.priorityFeedback.every((item) => item && typeof item === 'object' && nonEmpty((item as Record<string, unknown>).title, 120) && nonEmpty((item as Record<string, unknown>).guidance, 1000))) throw new Error('invalid_priority_feedback');
	if (!Array.isArray(result.skillResults) || result.skillResults.length !== expectedSkills.length) throw new Error('invalid_skill_results');
	const actual = new Set<string>();
	for (const raw of result.skillResults) {
		if (!raw || typeof raw !== 'object') throw new Error('invalid_skill_result');
		const item = raw as Record<string, unknown>;
		if (!expectedSkills.includes(item.skillKey as SkillKey) || actual.has(String(item.skillKey))) throw new Error('unexpected_skill');
		actual.add(String(item.skillKey));
		if (!['achieved', 'partial', 'missed'].includes(String(item.outcome)) || ![0, 1, 2].includes(Number(item.severity)) || !nonEmpty(item.evidence, 500)) throw new Error('invalid_skill_result');
	}
	return result as FeedbackResult;
}
