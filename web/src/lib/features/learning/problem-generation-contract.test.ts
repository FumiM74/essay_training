import { describe, expect, it } from 'vitest';
import { PROBLEM_GENERATION_MODEL, generatedProblemSchema, problemGenerationModel, validateGeneratedProblem, type ProblemGenerationSpecification } from '../../../../../supabase/functions/_shared/problem-generation-contract';
import { buildProblemGenerationPrompt } from '../../../../../supabase/functions/_shared/problem-generation-prompt';
import { parseProblemGenerationRequest } from '../../../../../supabase/functions/_shared/problem-generation-request';
import { QUALITY_DIMENSIONS, problemQualityReviewSchema, validateProblemQualityReview } from '../../../../../supabase/functions/_shared/problem-quality-contract';
import { buildProblemQualityPrompt, buildProblemRepairPrompt } from '../../../../../supabase/functions/_shared/problem-quality-prompt';
import { customTopicKey } from './topic-preferences';

const specification: ProblemGenerationSpecification = {
	stageId: 4,
	topicDomain: 'technology',
	topicKey: 'online-learning',
	promptFamily: 'opinion-and-reason',
	skillTargets: ['clear_claim', 'claim_reason_link', 'reason_specificity'],
	selectionReason: 'core',
	maximumPromptCharacters: 1200,
	avoidFingerprints: ['old-problem'],
};

const validProblem = {
	title: '対比と結論をつなぐ練習',
	prompt: '次の三文の内容はすべて残し、意味を保ったまま表現や順序を変えて構いません。利点と課題を対比したあと、両方を踏まえた結論を加え、文章全体を書き直してください。\nオンライン学習は繰り返し復習できる。\n端末を持たない家庭もある。\nオンライン学習は便利だ。',
	hint: '良い点と困る点を順に示します。最後に、両方を考えると何が必要かを書きましょう。',
	sourceUnits: [
		{ content: 'オンライン学習は繰り返し復習できる。', treatment: 'must_keep' as const },
		{ content: '端末を持たない家庭もある。', treatment: 'must_keep' as const },
		{ content: 'オンライン学習は便利だ。', treatment: 'must_keep' as const },
	],
	requiredAdditions: [{ role: '結論', description: '利点と課題の両方を踏まえた対応を示す。' }],
	acceptedAnswerExamples: ['オンライン学習は便利で、繰り返し復習できる。一方、端末を持たない家庭もある。そのため、利用環境を整える必要がある。'],
	gradingCriteria: [
		{ skillKey: 'clear_claim', passCondition: 'オンライン学習についての意見が明確である。' },
		{ skillKey: 'claim_reason_link', passCondition: '結論が利点と課題の両方を踏まえている。' },
		{ skillKey: 'reason_specificity', passCondition: '利用環境への配慮が必要な理由を具体的に示している。' },
	],
	hiddenRequirements: [],
	basicQuestions: [],
};

describe('Claude problem generation contract', () => {
	it('問題生成はSonnet 5を標準とし、環境変数で明示的に差し替えられる', () => {
		expect(PROBLEM_GENERATION_MODEL).toBe('claude-sonnet-5');
		expect(problemGenerationModel({})).toBe('claude-sonnet-5');
		expect(problemGenerationModel({ CLAUDE_PROBLEM_GENERATION_MODEL: 'evaluation-model' })).toBe('evaluation-model');
	});

	it('問題文・素材の扱い・追加条件・正解例・技能別基準が一致する問題を受け入れる', () => {
		expect(validateGeneratedProblem(validProblem, specification)).toEqual(validProblem);
		expect(JSON.stringify(generatedProblemSchema)).toContain('hiddenRequirements');
		expect(JSON.stringify(generatedProblemSchema)).not.toMatch(/maxItems|minLength|maxLength/);
	});

	it('正解例だけに存在する隠れた条件を拒否する', () => {
		expect(() => validateGeneratedProblem({ ...validProblem, hiddenRequirements: ['利用環境への配慮'] }, specification))
			.toThrow('hidden_grading_requirement');
	});

	it('課題文に示していない結論追加や素材の扱いを拒否する', () => {
		expect(() => validateGeneratedProblem({ ...validProblem, prompt: validProblem.prompt.replace('結論', '対応') }, specification))
			.toThrow('required_addition_not_disclosed');
		expect(() => validateGeneratedProblem({ ...validProblem, prompt: validProblem.prompt.replace('すべて残し', '整理し') }, specification))
			.toThrow('source_treatment_not_disclosed');
	});

	it('対象技能に対応する採点基準が欠けた問題を拒否する', () => {
		expect(() => validateGeneratedProblem({ ...validProblem, gradingCriteria: validProblem.gradingCriteria.slice(0, 1) }, specification))
			.toThrow('invalid_grading_criteria');
	});

	it('生成プロンプトは採点条件の開示と後続技能の除外を要求する', () => {
		const prompt = buildProblemGenerationPrompt(specification, { focus: '三文の流れ', notRequired: '長い小論文' });
		expect(prompt).toContain('正解例にだけ存在する条件');
		expect(prompt).toContain('この段階では要求しない内容: 長い小論文');
		expect(prompt).toContain('avoidFingerprints');
		expect(prompt).toContain('information_selection');
		expect(prompt).toContain('二文以内の自然な指示');
	});

	it('自由設定テーマを改変せず使うよう生成プロンプトへ明示する', () => {
		const custom = { ...specification, topicKey: 'learner-topic-b3f3ea65', customTopic: '少子化と教育' };
		const prompt = buildProblemGenerationPrompt(custom, { focus: '意見と理由', notRequired: '長い小論文' });
		expect(prompt).toContain('<learner_topic>少子化と教育</learner_topic>');
		expect(prompt).toContain('別のテーマへ置き換えたり');
	});

	it('ブラウザから渡す生成条件が段階別設計と一致する場合だけ受け入れる', () => {
		const featureSignature = {
			version: 2, fingerprint: 'pfs2:local', seed: 5, topicDomain: 'technology', topicKey: 'online-learning',
			promptFamily: 'opinion-and-reason', skillTargets: ['clear_claim', 'claim_reason_link', 'reason_specificity'],
			selectionReason: 'core', surfacePattern: 'direct',
			generation: { source: 'local_variant', designVersion: '2026-09-10', promptVersion: 'adaptive-local-v12' },
		};
		const request = { requestId: '123e4567-e89b-12d3-a456-426614174000', taskId: 'stage-4-generated-5-core', stageId: 4, featureSignature, specification };
		expect(parseProblemGenerationRequest(request)).toEqual(request);
		expect(() => parseProblemGenerationRequest({ ...request, featureSignature: { ...featureSignature, skillTargets: ['clear_claim'] } }))
			.toThrow('invalid_feature_signature');
	});

	it('自由設定テーマは20文字以内でテーマ固有IDと一致する場合だけ受け入れる', () => {
		const customTopic = '少子化と教育';
		const topicKey = customTopicKey(customTopic);
		const featureSignature = {
			version: 2, fingerprint: 'pfs2:custom', seed: 5, topicDomain: 'public_policy', topicKey, customTopic,
			promptFamily: 'opinion-and-reason', skillTargets: ['clear_claim', 'claim_reason_link', 'reason_specificity'],
			selectionReason: 'core', surfacePattern: 'direct',
			generation: { source: 'local_variant', designVersion: '2026-09-10', promptVersion: 'adaptive-local-v13' },
		};
		const customSpecification = { ...specification, topicDomain: 'public_policy', topicKey, customTopic };
		const request = { requestId: '123e4567-e89b-12d3-a456-426614174000', taskId: `stage-4-generated-5-core-clear_claim-t${topicKey.slice(-8)}`, stageId: 4, featureSignature, specification: customSpecification };
		expect(parseProblemGenerationRequest(request)).toEqual(request);
		expect(() => parseProblemGenerationRequest({ ...request, specification: { ...customSpecification, customTopic: '別テーマ' } })).toThrow('invalid_specification');
	});

	it('STEP 1の生成問題は指定された5分類を順番どおり保持する', () => {
		const stageOneSpecification: ProblemGenerationSpecification = {
			stageId: 1, topicDomain: 'education', topicKey: 'school-reading', promptFamily: 'five-question-language-basics',
			skillTargets: ['subject_predicate', 'particle_accuracy', 'auxiliary_accuracy', 'modifier_clarity', 'sentence_completion'],
			selectionReason: 'exploration', maximumPromptCharacters: 1200, avoidFingerprints: [],
		};
		const categories = ['subject_predicate', 'particle', 'auxiliary', 'word_order', 'sentence_revision'] as const;
		const skills = stageOneSpecification.skillTargets;
		const basicQuestions = categories.map((category, index) => ({
			category, instruction: '次の文を、示された条件に合わせて直してください。',
			prompt: `「学校で本を読む。」という内容をすべて残し、意味を保って言い換えても構いません。問題${index + 1}に答えてください。`,
			choices: [], referenceAnswers: ['学校で本を読む。'], referenceAnswerLabel: '学校で本を読む。',
			gradingPoint: '指定された文の形になっているかを確認します。', skillKey: skills[index],
			sourceUnits: [{ content: '学校で本を読む。', treatment: 'must_keep' as const }], requiredAdditions: [], hiddenRequirements: [],
		}));
		const problem = { title: '文の基本を確認する5問', prompt: '文の基本を確認する5問に答えてください。', hint: '一問ずつ文の意味を確認しましょう。',
			sourceUnits: [], requiredAdditions: [], acceptedAnswerExamples: [], gradingCriteria: [], hiddenRequirements: [], basicQuestions };
		expect(validateGeneratedProblem(problem, stageOneSpecification)).toEqual(problem);
	});

	it('STEP 2の情報選択問題は、材料の使用条件が曖昧なら拒否する', () => {
		const stageTwoSpecification: ProblemGenerationSpecification = {
			stageId: 2, topicDomain: 'education', topicKey: 'sentence-structure-mixed', promptFamily: 'three-question-sentence-structure',
			skillTargets: ['sentence_relation', 'modifier_clarity', 'sentence_completion'], selectionReason: 'exploration',
			maximumPromptCharacters: 1200, avoidFingerprints: [],
		};
		const basicQuestions = [
			{ category: 'relation_sentence', skillKey: 'sentence_relation' },
			{ category: 'clarity_revision', skillKey: 'modifier_clarity' },
			{ category: 'information_selection', skillKey: 'sentence_completion' },
		].map(({ category, skillKey }) => ({
			category, instruction: category === 'information_selection'
				? '意見と、その理由になる材料だけを使って、一文にしてください。言葉の形や順番は変えて構いません。'
				: '次の内容をすべて残し、意味を保って言い換えても構いません。',
			prompt: category === 'information_selection'
				? '意見：読書時間は必要だ。\n材料①：全員が本に触れられる。\n材料②：校庭に木がある。'
				: '読書時間は必要だ。',
			choices: [], referenceAnswers: ['全員が本に触れられるため、読書時間は必要だ。'],
			referenceAnswerLabel: '全員が本に触れられるため、読書時間は必要だ。', gradingPoint: '指定された関係が伝わるかを確認します。', skillKey,
			sourceUnits: category === 'information_selection'
				? [{ content: '読書時間は必要だ。', treatment: 'may_rephrase' as const }, { content: '全員が本に触れられる。', treatment: 'may_rephrase' as const }, { content: '校庭に木がある。', treatment: 'must_remove' as const }]
				: [{ content: '読書時間は必要だ。', treatment: 'must_keep' as const }],
			requiredAdditions: [], hiddenRequirements: [],
		}));
		const problem = { title: '一文を組み立てる3問', prompt: '三問に答えてください。', hint: '条件を一つずつ確認しましょう。',
			sourceUnits: [], requiredAdditions: [], acceptedAnswerExamples: [], gradingCriteria: [], hiddenRequirements: [], basicQuestions };
		expect(validateGeneratedProblem(problem, stageTwoSpecification)).toEqual(problem);
		const ambiguous = structuredClone(problem);
		ambiguous.basicQuestions[2].instruction = '目的と方法を選び、一文にまとめてください。';
		expect(() => validateGeneratedProblem(ambiguous, stageTwoSpecification)).toThrow('source_treatment_not_disclosed');
	});

	it('独立品質審査は全評価4点以上かつ重大問題なしの場合だけ承認する', () => {
		const approved = {
			verdict: 'approve', summary: '問題、解答例、採点条件が一致しています。',
			scores: Object.fromEntries(QUALITY_DIMENSIONS.map((key) => [key, 4])),
			issues: [], independentAnswerOutline: ['利点と課題を残し、両方を踏まえた結論を示す。'],
		};
		expect(validateProblemQualityReview(approved)).toEqual(approved);
		expect(() => validateProblemQualityReview({ ...approved, scores: { ...approved.scores, readability: 3 } }))
			.toThrow('inconsistent_problem_quality_review');
		expect(() => validateProblemQualityReview({ ...approved, issues: [{ code: 'hidden_requirement', severity: 'blocking', location: '採点基準', explanation: '問題文にない条件です。', suggestedFix: '条件を問題文へ明記します。' }] }))
			.toThrow('inconsistent_problem_quality_review');
		expect(JSON.stringify(problemQualityReviewSchema)).not.toMatch(/maxItems|minLength|maxLength/);
	});

	it('品質審査は生成者から独立して解答可能性を確認し、修正指示を問題全体へ反映する', () => {
		const reviewPrompt = buildProblemQualityPrompt(specification, { focus: '意見と理由', notRequired: '長い小論文' }, validProblem);
		expect(reviewPrompt).toContain('問題を自分で解き');
		expect(reviewPrompt).toContain('隠れた採点条件');
		expect(reviewPrompt).toContain('「補足」など役割の曖昧な見出し');
		const review = validateProblemQualityReview({
			verdict: 'revise', summary: '指示の一部を明確にする必要があります。',
			scores: Object.fromEntries(QUALITY_DIMENSIONS.map((key) => [key, key === 'instructionClarity' ? 3 : 4])),
			issues: [{ code: 'unclear_instruction', severity: 'blocking', location: '問題文', explanation: '追加する結論が曖昧です。', suggestedFix: '結論の役割を明記します。' }],
			independentAnswerOutline: ['利点と課題を対比し、対応を結論として加える。'],
		});
		expect(buildProblemRepairPrompt(specification, { focus: '意見と理由', notRequired: '長い小論文' }, validProblem, review))
			.toContain('元の段階、テーマ、対象技能、問題数を変更しない');
	});
});
