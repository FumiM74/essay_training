import { describe, expect, it } from 'vitest';
import { createProblemSpecification, generatePracticeTask, practiceTaskPromptHash, promptHash, questionSetForStage, resolvePracticeTask } from './problem-generator';

describe('practice task prompt hash', () => {
	it('通常の単独問題は課題文から識別値を作る', () => {
		const task = generatePracticeTask(4, 0);
		expect(practiceTaskPromptHash(task)).toBe(promptHash(task.prompt));
	});

	it('STEP 1は共通課題文ではなく5問セットの内容を区別する', () => {
		const first = generatePracticeTask(1, 0);
		const second = generatePracticeTask(1, 1);
		expect(first.prompt).toBe(second.prompt);
		expect(practiceTaskPromptHash(first)).not.toBe(practiceTaskPromptHash(second));
	});

	it('STEP 2・3は共通課題文でも3問セットの内容を区別する', () => {
		for (const stageId of [2, 3]) {
			const first = generatePracticeTask(stageId, 0);
			const second = generatePracticeTask(stageId, 1);
			expect(first.questionSet).toHaveLength(3);
			expect(second.questionSet).toHaveLength(3);
			expect(first.prompt).toBe(second.prompt);
			expect(practiceTaskPromptHash(first)).not.toBe(practiceTaskPromptHash(second));
		}
	});

	it('STEP 1〜3は最初の10セット内で同じ小問を再出題しない', () => {
		for (const stageId of [1, 2, 3]) {
			const sets = Array.from({ length: 10 }, (_, seed) => questionSetForStage(stageId, seed)!);
			expect(new Set(sets.map((questions) => practiceTaskPromptHash({ prompt: '', questionSet: questions }))).size).toBe(10);
			for (let slot = 0; slot < sets[0].length; slot += 1) {
				const questionCopies = sets.map((questions) => `${questions[slot].instruction}\n${questions[slot].prompt}`);
				expect(new Set(questionCopies).size).toBe(10);
			}
		}
	});

	it('STEP 1〜3の全110小問は表示・採点に必要な情報を備えている', () => {
		for (const stageId of [1, 2, 3]) {
			for (let seed = 0; seed < 10; seed += 1) {
				for (const question of questionSetForStage(stageId, seed)!) {
					expect(question.instruction.trim()).not.toBe('');
					expect(question.prompt.trim()).not.toBe('');
					expect(question.acceptedAnswers.length).toBeGreaterThan(0);
					expect(question.answerLabel.trim()).not.toBe('');
					expect(question.explanation.trim()).not.toBe('');
					expect(question.acceptedAnswers).toContain(question.answerLabel);
					if (question.choices) expect(question.choices).toContain(question.answerLabel);
				}
			}
		}
	});

	it('STEP 1〜3はセット内容に合う共通トピックと異なる特徴署名を持つ', () => {
		const expectedTopicKeys = ['language-basics-mixed', 'sentence-structure-mixed', 'logic-flow-mixed'];
		for (const stageId of [1, 2, 3]) {
			const tasks = Array.from({ length: 10 }, (_, seed) => generatePracticeTask(stageId, seed));
			expect(tasks.every((task) => task.topicKey === expectedTopicKeys[stageId - 1])).toBe(true);
			expect(new Set(tasks.map((task) => task.features!.fingerprint)).size).toBe(10);
		}
	});

	it('問題セットは採点資料が変わった場合も別の識別値になる', () => {
		const task = generatePracticeTask(3, 0);
		const originalHash = practiceTaskPromptHash(task);
		const changed = structuredClone(task);
		changed.questionSet![0].acceptedAnswers = ['変更後の正解例'];
		expect(practiceTaskPromptHash(changed)).not.toBe(originalHash);
	});

	it('STEP 2の曖昧な文では、誰が行動した文に直すかを明示する', () => {
		const questions = Array.from({ length: 10 }, (_, index) => questionSetForStage(2, index)![1]);
		const presentationQuestion = questions.find((question) => question.prompt.includes('発表した'));
		expect(presentationQuestion?.instruction).toContain('誰が誰に発表した');
		expect(presentationQuestion?.answerLabel).toContain('生徒は');
	});

	it('STEP 2の情報選択10問は、短い指示で使う内容と材料を明示する', () => {
		const questions = Array.from({ length: 10 }, (_, index) => questionSetForStage(2, index)![2]);
		for (const question of questions) {
			expect(question.category).toBe('information_selection');
			expect(question.instruction).toMatch(/(意見と、その理由になる|目的と、目的に合う|方針と、その理由になる|利点と利用条件に関係する)材料だけを使って/);
			expect(question.instruction).toContain('言葉の形や順番は変えて構いません');
			expect(question.instruction.length).toBeLessThanOrEqual(65);
			expect(question.prompt).toMatch(/^(意見|目的|方針|話題)：/);
			expect(question.prompt).toContain('材料①：');
			expect(question.prompt).not.toContain('補足：');
			expect(question.prompt).not.toContain('中心となる');
			expect(question.explanation).toMatch(/材料.+使います/);
			expect(question.explanation).toContain('使いません');
			expect(question.explanation).not.toContain('中心となる');
		}
	});

	it('STEP 3の文章修正では、元の各文をどう扱うかと必要な結論を問題文に明示する', () => {
		const questions = Array.from({ length: 3 }, (_, index) => questionSetForStage(3, index)![2]);
		expect(questions).toHaveLength(3);
		expect(questions[0].instruction).toContain('関係のない一文を除いて');
		expect(questions[1].instruction).toContain('どちらか一文だけを残し');
		expect(questions[2].instruction).toContain('三つの内容をすべて使って');
		expect(questions[2].instruction).toContain('「オンライン学習は便利だ」という内容も残します');
		expect(questions[2].instruction).toContain('両方を踏まえた結論');
		expect(questions[2].answerLabel).toContain('便利');
	});

	it('自由設定テーマをSTEP 4以降の特徴署名・問題ID・生成仕様へ一貫して含める', () => {
		const task = generatePracticeTask(8, 0, { customTopic: '少子化と教育' });
		expect(task.prompt).toContain('少子化と教育');
		expect(task.features).toMatchObject({ customTopic: '少子化と教育', generation: { source: 'local_variant' } });
		expect(task.id).toMatch(/-t[0-9a-f]{8}$/);
		expect(resolvePracticeTask(task.id)).toMatchObject({ id: task.id, topicKey: task.topicKey, stageId: 8 });
		const specification = createProblemSpecification(8, 0, { customTopic: '少子化と教育' });
		expect(specification.customTopic).toBe('少子化と教育');
		expect(specification.topicKey).toBe(task.topicKey);
	});

	it('自由設定テーマは20文字・STEP 4以降という制限を守る', () => {
		expect(() => generatePracticeTask(3, 0, { customTopic: '教育' })).toThrow();
		expect(() => generatePracticeTask(4, 0, { customTopic: 'あ'.repeat(21) })).toThrow();
	});

	it('QA専用接尾辞を自由設定テーマとして解釈しない', () => {
		const task = resolvePracticeTask('stage-4-generated-a-core-clear_claim-q1234abcd');
		expect(task).toMatchObject({ stageId: 4 });
		expect(task?.features?.customTopic).toBeUndefined();
		expect(task?.features?.topicKey).not.toBe('learner-topic-1234abcd');
	});

	it('個別試用問題の接尾辞を通常の生成問題として開ける', () => {
		const taskId = 'stage-4-generated-a-core-clear_claim-i1234abcd';
		const task = resolvePracticeTask(taskId);
		expect(task).toMatchObject({ id: taskId, stageId: 4 });
		expect(task?.features?.customTopic).toBeUndefined();
	});

	it('QA問題の接尾辞も発行済み問題IDとして保持する', () => {
		const taskId = 'stage-1-generated-a-core-sentence_completion-q1234abcd';
		expect(resolvePracticeTask(taskId)).toMatchObject({ id: taskId, stageId: 1 });
	});

	it('全段階の試用問題IDを保持し、選択式・記述式の入力対象を復元する', () => {
		for (let stageId = 1; stageId <= 14; stageId += 1) {
			const base = generatePracticeTask(stageId, 10, { selectionReason: 'core' });
			const taskId = `${base.id}-i1234abcd`;
			const restored = resolvePracticeTask(taskId);
			expect(restored).toMatchObject({ id: taskId, stageId });
			if (stageId <= 3) expect(restored?.questionSet?.length).toBe(stageId === 1 ? 5 : 3);
			else expect(restored?.questionSet).toBeUndefined();
		}
	});

	it('自由設定テーマの試用問題IDもそのまま保持する', () => {
		const base = generatePracticeTask(8, 10, { customTopic: '地域医療' });
		const taskId = `${base.id}-i1234abcd`;
		expect(resolvePracticeTask(taskId)).toMatchObject({ id: taskId, stageId: 8 });
	});

	it('STEP 1の助詞問題は、実際に起こり得る誤用を直す内容にする', () => {
		const questions = Array.from({ length: 10 }, (_, seed) => questionSetForStage(1, seed)![4]);
		const particleRevision = questions.find((question) => question.instruction === '助詞の誤りを直した文を選んでください。');
		expect(particleRevision).toMatchObject({
			prompt: '私は毎朝、図書館で通っている。',
			answerLabel: '私は毎朝、図書館に通っている。',
		});
		expect(particleRevision?.prompt).not.toContain('がを');
	});
});
