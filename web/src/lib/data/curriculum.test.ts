import { describe, expect, it } from 'vitest';
import { stageAnswerExampleFor } from '$lib/features/learning/learning-design';
import { curriculum, practiceTasks, validateCurriculum } from './curriculum';

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
	});

	it('壊れたカリキュラムを拒否する', () => {
		expect(() => validateCurriculum({ schemaVersion: '1.1', stages: [] })).toThrow();
	});
});
