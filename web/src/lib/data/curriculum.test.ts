import { describe, expect, it } from 'vitest';
import { stageAnswerExampleFor } from '$lib/features/learning/learning-design';
import { curriculum, practiceTasks, validateCurriculum } from './curriculum';
import { essayTopics } from './essay-topic-bank';

describe('curriculum', () => {
	it('段階0〜14と重複のない問題生成テンプレートを読み込める', () => {
		expect(curriculum.stages.map((stage) => stage.id)).toEqual(Array.from({ length: 15 }, (_, index) => index));
		expect(practiceTasks.length).toBeGreaterThan(0);
		for (const stage of curriculum.stages.filter((item) => item.id > 0)) {
			expect(stage.tasks.length).toBeGreaterThanOrEqual(3);
			expect(new Set(stage.tasks.map((task) => task.id)).size).toBe(stage.tasks.length);
			expect(new Set(stage.tasks.map((task) => task.topicKey)).size).toBe(stage.tasks.length);
		}
	});

	it('STEP 4〜14は大学入試を想定した50以上の論点を共有する', () => {
		expect(essayTopics.length).toBeGreaterThanOrEqual(50);
		expect(new Set(essayTopics.map((topic) => topic.key)).size).toBe(essayTopics.length);
		expect(new Set(essayTopics.map((topic) => topic.domain)).size).toBeGreaterThanOrEqual(6);
		for (let stageId = 4; stageId <= 14; stageId += 1) {
			expect(curriculum.stages[stageId].tasks).toHaveLength(essayTopics.length);
			expect(new Set(curriculum.stages[stageId].tasks.map((task) => task.topicKey))).toEqual(new Set(essayTopics.map((topic) => topic.key)));
		}
	});

	it('段階14のルーブリック識別子に重複がない', () => {
		const rubric = curriculum.stages[14].rubric;
		const keys = rubric.map((item) => `${item.area}|${item.item}`);
		expect(new Set(keys).size).toBe(keys.length);
	});

	it('段階3は論理の流れを整える3問セットで統一されている', () => {
		const stage = curriculum.stages[3];
		for (const task of stage.tasks) {
			expect(task.prompt).toContain('論理の流れを整える3問');
			expect(task.hint).toContain('文の順序');
			expect(task.hint).toContain('重複や関係の薄い文');
		}
		const example = stageAnswerExampleFor(3);
		expect(example?.text.match(/。/g)).toHaveLength(3);
		expect(example?.hintExplanation).toContain('主張、理由、具体例の順');
	});

	it('段階2は情報を整理して一文を作る3問セットで統一されている', () => {
		const stage = curriculum.stages[2];
		for (const task of stage.tasks) {
			expect(task.prompt).toContain('一文を組み立てる3問');
			expect(task.hint).toContain('情報どうしの関係');
			expect(task.hint).toContain('必要な内容を選び');
		}
		const example = stageAnswerExampleFor(2);
		expect(example?.text.match(/。/g)).toHaveLength(1);
		expect(example?.hintExplanation).toContain('句点は文末に一つだけ');
		expect(example?.additionalExamples).toHaveLength(2);
	});

	it('段階7は各セットで反対意見への答えを求め、旧来の固定文を使わない', () => {
		const prompts = curriculum.stages[7].tasks.map((task) => task.prompt);
		for (const prompt of prompts) {
			expect(prompt).toContain('反対意見または課題に答える一文を補い');
			expect(prompt).not.toContain('この課題について具体的な行動');
		}
		expect(prompts.filter((prompt) => prompt.includes('昨年、地域の図書館は入口を改修した'))).toHaveLength(0);
	});

	it('後半段階は要約・資料利用・構成メモ・小論文の提出条件を明示する', () => {
		for (const task of curriculum.stages[9].tasks) {
			expect(task.prompt).toContain('反対の立場または課題を残してください');
			expect(task.prompt).toContain('細かな具体例');
		}
		for (const task of curriculum.stages[10].tasks) {
			expect(task.prompt).toContain('理由・具体例・反対意見');
			expect(task.prompt).toContain('賛成でも反対でも構いません');
		}
		for (const task of curriculum.stages[12].tasks) expect(task.prompt).toContain('反対意見と、それへの答え');
		for (const task of curriculum.stages[13].tasks) expect(task.hint).not.toContain('構成メモに沿って');
		for (const task of curriculum.stages[14].tasks) {
			expect(task.prompt).toContain('資料中の内容を一つ以上');
			expect(task.prompt).toContain('賛成でも反対でも構いません');
		}
	});

	it('全段階の課題で、扱いを説明しない「補足」や曖昧な選択指示を使わない', () => {
		for (const task of practiceTasks) {
			expect(task.prompt).not.toContain('補足：');
			expect(task.prompt).not.toMatch(/目的と方法を選|問題と対策を選|利点と条件を選|考えと理由を選|方針と理由を選/);
		}
	});

	it('同じ題材の設問は段階4・8・11〜14で同じ論点を使う', () => {
		const question = (prompt: string) => prompt.match(/「([^」]+)」/)?.[1];
		for (let index = 0; index < essayTopics.length; index += 1) {
			const expected = question(curriculum.stages[4].tasks[index].prompt);
			for (const stageId of [8, 11, 12, 13, 14]) {
				expect(question(curriculum.stages[stageId].tasks[index].prompt)).toBe(expected);
			}
		}
	});

	it('壊れたカリキュラムを拒否する', () => {
		expect(() => validateCurriculum({ schemaVersion: '1.1', stages: [] })).toThrow();
	});
});
