import { describe, expect, it } from 'vitest';
import { buildClaudeFeedbackPrompt, createMockFeedback } from './feedback';

describe('stage-aware feedback', () => {
	it('段階1では文字数・理由・具体例を要求せず、完成した一文を合格にする', () => {
		const result = createMockFeedback('地域の交流が深まると思う。', 1, ['sentence_completion', 'subject_predicate']);
		expect(result.decision).toBe('pass');
		expect(JSON.stringify(result)).not.toContain('文字');
		expect(JSON.stringify(result)).not.toContain('具体例を加えて');
	});

	it('段階1で二文書いた場合は理由の追加ではなく一文への整理を案内する', () => {
		const result = createMockFeedback('参加は大切だ。交流が増える。', 1);
		expect(result.decision).toBe('revise');
		expect(result.priorityFeedback[0].guidance).toContain('追加の説明や具体例を求めません');
		expect(result.priorityFeedback[0].guidance).toContain('一文');
	});

	it('段階2は一文、段階3は二文を形式条件として判定する', () => {
		expect(createMockFeedback('理由が分かるため、意見に納得できる。', 2).decision).toBe('pass');
		expect(createMockFeedback('意見を示す。なぜなら、理由があるからだ。', 3).decision).toBe('pass');
		expect(createMockFeedback('理由があるため、意見を示す。', 3).decision).toBe('revise');
	});

	it('Claude用指示は段階固有の評価焦点と後段階を要求しない規則を含む', () => {
		const prompt = buildClaudeFeedbackPrompt({
			stageId: 1,
			prompt: '地域行事への参加が大切だと思う理由を、一文で書いてください。',
			hint: '主語と述語を対応させてください。',
			passSummary: '主語・述語が対応し、一文で意味が完結',
			rubric: [],
			answer: '地域の交流が深まると思う。',
			skillTargets: ['sentence_completion', 'subject_predicate'],
		});
		expect(prompt).toContain('この段階では要求しないこと: 理由や具体例を書くこと、長い文章を書くこと');
		expect(prompt).toContain('どの言葉を、どこへ移す・何へ置き換える・何の後に加える');
		expect(prompt).toContain('後の段階で学ぶ技能を理由に不合格にしない');
		expect(prompt).toContain('要修正時1件・合格時2〜3件');
	});
});
