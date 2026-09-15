import type { ProblemSelectionReason, SkillKey, TopicDomain } from '$lib/types/curriculum';
import { essayTopicDomains } from '$lib/data/essay-topic-bank';

export const PROBLEM_DESIGN_VERSION = '2026-09-10';
export const LOCAL_PROMPT_VERSION = 'adaptive-local-v16';

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

export type StageFeedbackDesign = {
	focus: string;
	notRequired: string;
};

export type StageAnswerExample = {
	text: string;
	hintExplanation: string;
	additionalExamples?: Array<{ label: string; text: string; hintExplanation: string }>;
};

const designs: Record<number, StageProblemDesign> = {
	1: { promptFamily: 'five-question-language-basics', coreSkills: ['subject_predicate', 'particle_accuracy', 'auxiliary_accuracy', 'modifier_clarity', 'sentence_completion'], languagePatterns: ['balanced-five-slot-set'] },
	2: { promptFamily: 'three-question-sentence-structure', coreSkills: ['sentence_relation', 'modifier_clarity', 'sentence_completion'], languagePatterns: ['relation', 'clarity', 'selection'] },
	3: { promptFamily: 'three-question-logic-flow', coreSkills: ['paragraph_coherence', 'claim_reason_link', 'paragraph_analysis'], languagePatterns: ['order', 'missing-link', 'flow-revision'] },
	4: { promptFamily: 'opinion-and-reason', coreSkills: ['clear_claim', 'claim_reason_link', 'reason_specificity'], perspectives: ['support', 'oppose', 'conditional'], reasoningModes: ['cause-effect', 'purpose-means', 'value-judgment'] },
	5: { promptFamily: 'deepen-reason', coreSkills: ['causal_depth', 'reason_specificity'], reasoningModes: ['multi-step-causality', 'condition-and-result', 'comparison'] },
	6: { promptFamily: 'support-with-example', coreSkills: ['example_relevance', 'evidence_link'], evidenceModes: ['concrete-case', 'comparison-case', 'observed-change'] },
	7: { promptFamily: 'analyze-and-revise-paragraph', coreSkills: ['paragraph_analysis', 'source_structure', 'paragraph_coherence', 'conclusion_alignment'], structurePatterns: ['counterclaim-claim-reason-example-conclusion', 'reorder-remove-bridge'], sourceStructures: ['claim-reason-example-reservation'] },
	8: { promptFamily: 'construct-paragraph', coreSkills: ['paragraph_coherence', 'conclusion_alignment'], structurePatterns: ['claim-reason-example-conclusion', 'issue-claim-reason-conclusion'] },
	9: { promptFamily: 'objective-summary', coreSkills: ['summary_fidelity', 'opinion_exclusion'], sourceStructures: ['claim-reason-example-reservation', 'problem-cause-response-effect'], summaryOperations: ['retain-main-claim', 'retain-contrast', 'remove-example-detail'] },
	10: { promptFamily: 'source-based-opinion', coreSkills: ['source_integration', 'claim_evidence'], issueConflicts: ['freedom-vs-safety', 'efficiency-vs-fairness', 'cost-vs-benefit', 'individual-vs-society', 'innovation-vs-risk', 'uniformity-vs-diversity'], sourceUses: ['support', 'qualify', 'compare'] },
	11: { promptFamily: 'handle-counterposition', coreSkills: ['counterargument_fairness', 'rebuttal_reasoning'], counterpositions: ['cost-concern', 'fairness-concern', 'feasibility-concern', 'autonomy-concern'], responseStrategies: ['acknowledge-and-limit', 'condition-and-rebut', 'compare-priorities'] },
	12: { promptFamily: 'essay-outline', coreSkills: ['outline_planning', 'essay_structure', 'claim_evidence'], reasoningModes: ['cause-effect', 'comparison', 'trade-off'], synthesisPatterns: ['claim-reason-example-counterpoint-conclusion'] },
	13: { promptFamily: 'mini-essay', coreSkills: ['essay_structure', 'coherence', 'claim_evidence'], reasoningModes: ['cause-effect', 'comparison', 'trade-off'], evidenceModes: ['concrete-case', 'comparison-case'], synthesisPatterns: ['claim-two-reasons-conclusion', 'issue-claim-counterpoint-conclusion'] },
	14: { promptFamily: 'full-essay', coreSkills: ['prompt_alignment', 'logical_consistency', 'multi_perspective', 'conclusion_alignment'], reasoningModes: ['cause-effect', 'comparison', 'trade-off'], issueConflicts: ['freedom-vs-safety', 'efficiency-vs-fairness', 'cost-vs-benefit', 'individual-vs-society', 'innovation-vs-risk', 'uniformity-vs-diversity'], responseStrategies: ['acknowledge-and-limit', 'condition-and-rebut', 'compare-priorities'], synthesisPatterns: ['claim-multiple-evidence-counterpoint-conclusion', 'issue-analysis-proposal-qualification-conclusion'] },
};

const feedbackDesigns: Record<number, StageFeedbackDesign> = {
	1: { focus: '5領域の小問題すべてに正解し、文の基本要素を使い分けられているか', notRequired: '理由や具体例を書くこと、長い文章を書くこと' },
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

const stageAnswerExamples: Partial<Record<number, StageAnswerExample>> = {
	2: {
		text: '毎日さまざまな文章に触れられるため、学校では読書の時間を設けるべきだ。',
		hintExplanation: '「毎日さまざまな文章に触れられる」という理由と、「学校では読書の時間を設けるべきだ」という意見を、「ため」で一文につないでいます。句点は文末に一つだけ置いています。',
		additionalExamples: [
			{ label: '説明する言葉を近くに置く例', text: '私は友人と、駅の近くにある図書館へ行った。', hintExplanation: '「駅の近くにある」を「図書館」の直前に置き、どの場所を説明しているのかを明確にしています。' },
			{ label: '必要な情報を選ぶ例', text: '車を持たない人の通院や通学を支えられるため、地域のバスを維持するべきだ。', hintExplanation: 'バスを維持する意見に直接つながる情報だけを選び、一文にしています。' },
		],
	},
	3: {
		text: '学校では読書の時間を設けるべきだ。家庭環境に左右されず、文章を読む機会を持てるからだ。例えば、朝の読書を続ければ、すべての生徒が本に触れられる。',
		hintExplanation: '「読書の時間を設けるべきだ」という主張のあとに理由を置き、最後にその理由が当てはまる具体例を示しています。主張、理由、具体例の順なので、読み手が考えの流れを追えます。',
		additionalExamples: [
			{ label: '不足する説明を補う例', text: '路線バスがなくなると、車を運転できない人は病院へ行きにくくなる。', hintExplanation: '「バスを使う人がいる」という事実と、「路線を残す必要がある」という結論の間を説明しています。' },
			{ label: '流れを直す例', text: '生成AIは考えを整理する助けになる。回答に誤りが含まれることもある。だから、別の資料でも確かめながら使うべきだ。', hintExplanation: '利点、注意点、両方を踏まえた結論の順に並べています。' },
		],
	},
	4: {
		text: '地域の図書館は必要だ。なぜなら、誰もが学べる場所を提供しているからだ。',
		hintExplanation: '一文目の「地域の図書館は必要だ」が意見です。二文目では、必要だと考える理由を「誰もが学べる場所を提供しているからだ」と説明しています。同じ意見の言い換えではなく、「なぜ必要なのか」が分かります。',
	},
	5: {
		text: '公共交通を維持すべきだ。なぜなら、移動手段がなくなると、通学や通院が難しくなる人がいるからだ。',
		hintExplanation: '「移動手段がなくなる」が最初に起こること、「通学や通院が難しくなる」がその結果です。公共交通が必要だという意見を繰り返すだけでなく、なくなると誰がどう困るのかまで説明しています。',
	},
	6: {
		text: '食品ロスを減らすべきだ。なぜなら、食べられる食品の廃棄は資源の無駄になるからだ。例えば、販売期限の近い商品を値引きすれば、廃棄を減らせる。',
		hintExplanation: '二文目は「食べられる食品を捨てると資源が無駄になる」という理由です。三文目の「期限の近い商品を値引きする」は、その無駄を実際に減らす場面になっています。例を読むと、理由が現実にどう当てはまるかが分かります。',
	},
};

const topicDomains: Record<string, TopicDomain> = {
	'language-basics-mixed': 'education',
	'sentence-structure-mixed': 'education',
	'logic-flow-mixed': 'education',
	'accessible-design': 'public_policy',
	'school-reading': 'education',
	'smartphone-rules': 'technology',
	'community-events': 'community',
	'public-transport': 'public_policy',
	'learning-from-failure': 'education',
	'collaborative-learning': 'education',
	'online-learning': 'technology',
	'school-uniforms': 'ethics',
	...essayTopicDomains,
	'generative-ai': 'technology',
	'food-loss': 'environment',
	'disaster-preparedness': 'community',
	'school-rules': 'ethics',
	'news-structure': 'community',
	'intergenerational-community': 'community',
};

const skillGuidance: Record<SkillKey, string> = {
	sentence_completion: '「誰が・何が」と「どうする・どのようだ」を書き、最後に「。」まで付けてください',
	subject_predicate: '「誰が・何が」に当たる言葉と、「どうする・どのようだ」に当たる言葉を組み合わせてください',
	modifier_clarity: '説明する言葉を、説明される言葉の近くに置いてください',
	particle_accuracy: '「が・を・に・で」などを選び直し、誰が何をする文なのかが迷わず読めるようにしてください',
	auxiliary_accuracy: '「た・ない・たい・ます」などを使い、時・否定・希望・丁寧さが正しく伝わる文末にしてください',
	sentence_relation: '理由なら「ため」、対比なら「一方で」など、関係に合う言葉を使って二つの内容を一文にまとめてください',
	paragraph_analysis: '各文の役割を示し、関係のない文を除き、必要な説明を補って自然な順序へ直してください',
	outline_planning: '主張、理由、具体例、反対意見とそれへの答え、結論を短く書き、同じ設問への答えを支える順に並べてください',
	clear_claim: '自分の主張を一文ではっきり示してください',
	stance_specificity: '賛成・反対、または何を大切にする考えなのかをはっきり書いてください',
	claim_reason_link: '「なぜその意見なのか」が二文目を読むと分かるようにしてください',
	causal_depth: '理由によって何が起こり、その結果どうなるのかまで書いてください',
	reason_specificity: '「よいから」「大切だから」で終わらず、何がどう変わるのかを書いてください',
	example_relevance: '書いた理由が実際に当てはまる場面を具体例にしてください',
	evidence_link: 'その具体例から、なぜ意見に納得できるのかが分かるようにしてください',
	paragraph_coherence: '四文すべてを同じ意見について書いてください',
	conclusion_alignment: '最後の文を、最初に書いた意見への答えにしてください',
	source_structure: '課題文から、筆者の意見・理由・具体例・反対意見や例外を分けてください',
	source_evidence: '判断に使った課題文の言葉や内容を示してください',
	summary_fidelity: '筆者の主張、主な理由、反対の立場や課題を残し、細かな具体例を省いてください',
	opinion_exclusion: '「私は」など、自分の意見を要約に加えないでください',
	source_integration: '課題文のどの内容をもとに自分の意見を考えたのかを書いてください',
	claim_evidence: '自分の意見のあとに、その意見を選ぶ理由や事実を書いてください',
	counterargument_fairness: '反対の立場を実際より弱くせず、納得できる形で紹介してください',
	rebuttal_reasoning: '反対の立場に納得できる点を認めたうえで、それでも自分の意見を選ぶ理由を書いてください',
	essay_structure: '最初に意見を示し、途中で理由と例を説明し、最後に結論を書いてください',
	coherence: '各文と各段落が、最初に示した意見とどうつながるか分かるようにしてください',
	prompt_alignment: '設問で聞かれたことへの答えを、文章の最初と最後に示してください',
	logical_consistency: '途中で理由や結論を変えず、最後まで同じ意見を支えてください',
	multi_perspective: '自分とは異なる立場や、条件が変わる場合についても考えてください',
};

export function getStageProblemDesign(stageId: number): StageProblemDesign {
	const design = designs[stageId];
	if (!design) throw new Error(`段階${stageId}の問題設計がありません。`);
	return design;
}

export function getStageFeedbackDesign(stageId: number): StageFeedbackDesign {
	const design = feedbackDesigns[stageId];
	if (!design) throw new Error(`段階${stageId}の添削設計がありません。`);
	return design;
}

export function stageAnswerExampleFor(stageId: number): StageAnswerExample | null {
	return stageAnswerExamples[stageId] ?? null;
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
