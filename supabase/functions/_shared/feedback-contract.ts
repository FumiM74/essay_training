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
	learnerAnswer: string;
	referenceAnswers: string[];
	referenceAnswerLabel: string;
	gradingPoint: string;
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
	7: { focus: '段落の各文の役割を判別し、不要文を除き、反対意見や課題への答えを補って自然な順序に直せるか', notRequired: '自分の賛否、長い小論文を書くこと' },
	8: { focus: '主張・理由・具体例・結論が同じ話題を支え、自然な一段落になっているか', notRequired: '資料の引用、反対意見、長い小論文' },
	9: { focus: '筆者の主張、主な理由、反対の立場や課題を残し、細かな具体例と自分の意見を加えていないか', notRequired: '自分の主張、反論、細かな具体例' },
	10: { focus: '意見文の理由・具体例・反対意見のどれに注目したかが分かり、自分の意見と理由がつながっているか', notRequired: '反対意見への反論、本番と同じ長さの小論文' },
	11: { focus: '反対の立場を正確に示し、納得できる点を認めたうえで、自分の意見を選ぶ理由を書いているか', notRequired: '資料全体の詳しい要約、本番と同じ文章量' },
	12: { focus: '主張・理由・具体例・反対意見とそれへの答え・結論を、一貫した構成として設計できているか', notRequired: '完成した文章として書くこと' },
	13: { focus: '最初の意見、理由、具体例、最後の結論が複数段落を通して同じ答えを支えているか', notRequired: '本番と同じ文章量、すべての論点を扱うこと' },
	14: { focus: '設問への答えを示し、資料の内容、自分の理由と具体例、別の立場への応答、結論が一貫しているか', notRequired: '設問で求められていない知識や論点を増やすこと' },
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
			if (!nonEmpty(question.instruction, 500) || !nonEmpty(question.prompt, 2000) || !nonEmpty(question.learnerAnswer, 3000)
				|| !Array.isArray(question.referenceAnswers) || question.referenceAnswers.length < 1 || question.referenceAnswers.length > 12
				|| !question.referenceAnswers.every((item) => nonEmpty(item, 3000))
				|| !nonEmpty(question.referenceAnswerLabel, 300) || !nonEmpty(question.gradingPoint, 600)) throw new Error('invalid_basic_question_text');
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

const emptyAnswerClaim = /(?:解答|回答|答案|補う一文)(?:が|は)?(?:示されてい(?:ない|ません)|書かれてい(?:ない|ません)|入力されてい(?:ない|ません)|ありません|ない)|(?:空欄|未回答|未解答)(?:です|のまま)?/;

export function validateFeedback(value: unknown, expectedSkills: SkillKey[], learnerAnswer?: string): FeedbackResult {
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
	const skills = result.skillResults as SkillResult[];
	if (result.decision === 'pass' && skills.some((item) => item.outcome === 'missed' || item.severity === 2)) throw new Error('inconsistent_skill_decision');
	if (result.decision === 'revise' && skills.every((item) => item.outcome === 'achieved' && item.severity === 0)) throw new Error('inconsistent_skill_decision');
	if (learnerAnswer?.trim() && (result.priorityFeedback as Array<{ guidance: string }>).some((item) => emptyAnswerClaim.test(item.guidance))) throw new Error('inconsistent_answer_presence');
	return result as FeedbackResult;
}

function normalizedAnswer(value: string): string {
	return value.normalize('NFKC').toLowerCase().replace(/[\s　「」『』（）()、。！？!?]/g, '');
}

export function completeQuestionSetFeedback(value: unknown, questions: BasicQuestionInput[]): FeedbackResult {
	if (!value || typeof value !== 'object') throw new Error('invalid_basic_feedback');
	const raw = value as Record<string, unknown>;
	if (raw.schemaVersion !== '1.0' || !['clean', 'revision_required'].includes(String(raw.languageStatus)) || !['pass', 'revise'].includes(String(raw.decision))) throw new Error('invalid_basic_feedback');
	if (!Array.isArray(raw.basicQuestionResults) || raw.basicQuestionResults.length !== questions.length) throw new Error('invalid_basic_results');
	const compact = raw.basicQuestionResults.map((item) => {
		if (!item || typeof item !== 'object') throw new Error('invalid_basic_result');
		const result = item as Record<string, unknown>;
		if (typeof result.questionId !== 'string' || result.questionId.length > 120
			|| typeof result.correct !== 'boolean'
			|| typeof result.answerLabel !== 'string' || !result.answerLabel.trim() || result.answerLabel.length > 300
			|| typeof result.explanation !== 'string' || !result.explanation.trim() || result.explanation.length > 600) throw new Error('invalid_basic_result');
		return result as { questionId: string; correct: boolean; answerLabel: string; explanation: string };
	});
	const byId = new Map(compact.map((item) => [item.questionId, item]));
	if (byId.size !== questions.length) throw new Error('invalid_basic_result_id');
	const full = questions.map((question) => {
		const item = byId.get(question.id);
		if (!item) throw new Error('invalid_basic_result_id');
		const learner = normalizedAnswer(question.learnerAnswer);
		const matchesReference = question.referenceAnswers.some((answer) => normalizedAnswer(answer) === learner);
		const matchesClaudeAnswer = normalizedAnswer(item.answerLabel) === learner;
		const correctedFalseNegative = !item.correct && (matchesReference || matchesClaudeAnswer);
		return {
			...item,
			correct: item.correct || matchesReference || matchesClaudeAnswer,
			answerLabel: correctedFalseNegative ? question.referenceAnswerLabel : item.answerLabel,
			explanation: correctedFalseNegative ? question.gradingPoint : item.explanation,
			instruction: question.instruction,
			prompt: question.prompt,
			answer: question.learnerAnswer,
		};
	});
	const allCorrect = full.every((item) => item.correct);
	return {
		schemaVersion: '1.0', languageStatus: allCorrect ? 'clean' : 'revision_required', decision: allCorrect ? 'pass' : 'revise',
		priorityFeedback: full.map((item, index) => ({
			title: `問題${index + 1}：${item.correct ? '正解' : '不正解'}`,
			guidance: `${item.correct ? '正しく解答できています。' : `正解例は「${item.answerLabel}」です。`}${item.explanation}`,
		})),
		skillResults: full.map((item, index) => ({
			skillKey: skillForBasicQuestion(questions[index]), outcome: item.correct ? 'achieved' : 'missed', severity: item.correct ? 0 : 2,
			evidence: `${item.correct ? '正解' : '不正解'}：${item.explanation}`.slice(0, 500),
		})),
		basicQuestionResults: full,
	};
}
