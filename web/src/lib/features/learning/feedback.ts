import type { FeedbackResult } from '$lib/types/contracts';
import type { BasicQuestion, RubricItem, SkillKey } from '$lib/types/curriculum';
import { getStageFeedbackDesign, getStageProblemDesign } from './learning-design';

const requiredSentenceCounts: Partial<Record<number, number>> = { 1: 1, 2: 1, 3: 2, 4: 2, 6: 3 };

function completedSentenceCount(text: string): number {
	return text.match(/[。！？]/g)?.length ?? 0;
}

function sentenceCountGuidance(stageId: number, required: number): string {
	if (stageId === 1) return '段階1では、追加の説明や具体例を求めません。主語と述語が対応した一文を文末まで完成させてください。';
	return `この段階では、課題で指定された${required}文で内容をまとめてください。`;
}

export function createMockFeedback(text: string, stageId: number, skillTargets?: SkillKey[]): FeedbackResult {
	const normalized = text.trim();
	const hasSentenceEnd = /[。！？]$/.test(normalized);
	const requiredSentences = requiredSentenceCounts[stageId];
	const sentenceCount = completedSentenceCount(normalized);
	const hasRequiredSentenceCount = requiredSentences === undefined || sentenceCount === requiredSentences;
	const passes = hasSentenceEnd && hasRequiredSentenceCount;
	const targets = skillTargets?.length ? skillTargets : getStageProblemDesign(stageId).coreSkills;
	const stageDesign = getStageFeedbackDesign(stageId);

	if (passes) {
		return {
			schemaVersion: '1.0',
			languageStatus: 'clean',
			decision: 'pass',
			priorityFeedback: [
				{ title: '合格とした理由', guidance: `${stageDesign.focus.replace(/か$/, '')}ため、合格です。` },
				{ title: 'この段階では求めないこと', guidance: `${stageDesign.notRequired}は、まだ合格条件に含めません。今の段階で求められている書き方に集中できています。` },
			],
			skillResults: targets.map((skillKey) => ({ skillKey, outcome: 'achieved', severity: 0, evidence: 'ローカルモックの段階別形式条件を満たしました。' })),
		};
	}

	const guidance = !hasSentenceEnd
		? '文を途中で終わらせず、「。」などを付けて文末まで完成させてください。'
		: sentenceCountGuidance(stageId, requiredSentences!);
	return {
		schemaVersion: '1.0',
		languageStatus: !hasSentenceEnd ? 'revision_required' : 'minor_issue',
		decision: 'revise',
		priorityFeedback: [{ title: !hasSentenceEnd ? '文末まで完成させましょう' : '課題で指定された文数に整えましょう', guidance }],
		skillResults: targets.map((skillKey) => ({
			skillKey,
			outcome: 'missed',
			severity: !hasSentenceEnd ? 2 : 1,
			evidence: !hasSentenceEnd ? '文末が完結していません。' : `文数が指定と異なります（現在${sentenceCount}文）。`,
		})),
	};
}

function normalizedBasicAnswer(value: string): string {
	return value.normalize('NFKC').trim().replace(/[\s　、。！？!?]/g, '');
}

export function createBasicQuestionSetFeedback(
	questions: BasicQuestion[],
	answers: Record<string, string>,
	previousFeedback: FeedbackResult | null = null,
): FeedbackResult {
	const lockedCorrectIds = new Set(
		(previousFeedback?.basicQuestionResults ?? []).filter((result) => result.correct).map((result) => result.questionId),
	);
	const results = questions.map((question) => {
		const answer = answers[question.id] ?? '';
		const correct = lockedCorrectIds.has(question.id)
			|| question.acceptedAnswers.some((accepted) => normalizedBasicAnswer(accepted) === normalizedBasicAnswer(answer));
		return { question, answer, correct };
	});
	const allCorrect = results.every((result) => result.correct);
	return {
		schemaVersion: '1.0',
		languageStatus: allCorrect ? 'clean' : 'revision_required',
		decision: allCorrect ? 'pass' : 'revise',
		priorityFeedback: results.map(({ question, correct }, index) => ({
			title: `問題${index + 1}：${correct ? '正解' : '不正解'}`,
			guidance: `${correct ? '正しく解答できています。' : `正解は「${question.answerLabel}」です。`}${question.explanation}`,
		})),
		basicQuestionResults: results.map(({ question, answer, correct }) => ({
			questionId: question.id,
			instruction: question.instruction,
			prompt: question.prompt,
			answer,
			correct,
			answerLabel: question.answerLabel,
			explanation: question.explanation,
		})),
		skillResults: results.map(({ question, answer, correct }) => ({
			skillKey: question.skillKey,
			outcome: correct ? 'achieved' as const : 'missed' as const,
			severity: correct ? 0 as const : 2 as const,
			evidence: correct ? `「${answer}」と正しく解答しました。` : `「${answer || '未解答'}」と解答しました。正解は「${question.answerLabel}」です。`,
		})),
	};
}

export type ClaudeFeedbackContext = {
	stageId: number;
	prompt: string;
	hint: string;
	passSummary: string;
	rubric: RubricItem[];
	answer: string;
	skillTargets: SkillKey[];
};

export function buildClaudeFeedbackPrompt(context: ClaudeFeedbackContext): string {
	const design = getStageFeedbackDesign(context.stageId);
	const compactRubric = context.rubric.map(({ item, passCondition }) => ({ item, passCondition }));
	return [
		'あなたは小論文の文章構成トレーナーです。次の1答案だけを段階別に添削してください。',
		`段階: ${context.stageId}`,
		`この段階の評価焦点: ${design.focus}`,
		`この段階では要求しないこと: ${design.notRequired}`,
		'重要: 後の段階で学ぶ技能を理由に不合格にしないでください。文字数だけで判定せず、課題文に明記されていない文字数条件を追加しないでください。',
		'学習者向けのコメントでは、「確認する」「働きを確かめる」「関係を明確にする」だけで終えないでください。答案中の語句を示し、「どの言葉を、どこへ移す・何へ置き換える・何の後に加える」のように、次に行う修正を具体的で平易な日本語で説明してください。専門用語を使う場合は、同じ文で意味を説明してください。',
		'要修正の場合は、最優先の修正点を1つに絞り、学習者が次の再提出で直せる具体的な日本語で説明してください。合格の場合は、答案中の表現を根拠に、良かった点と任意の改善案を分けて詳しく説明してください。',
		`入力JSON: ${JSON.stringify({ prompt: context.prompt, hint: context.hint, passSummary: context.passSummary, rubric: compactRubric, skillTargets: context.skillTargets, answer: context.answer })}`,
		'FeedbackResult JSONだけを返してください。decisionはpassまたはrevise、priorityFeedbackは要修正時1件・合格時2〜3件、skillResultsは指定されたskillTargetsごとに具体的な根拠を返してください。',
	].join('\n');
}
