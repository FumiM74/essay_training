import { describe, expect, it } from 'vitest';
import { curriculum, practiceTasks, validateCurriculum } from './curriculum';

describe('curriculum', () => {
	it('段階0〜13と重複のない問題生成テンプレートを読み込める', () => {
		expect(curriculum.stages.map((stage) => stage.id)).toEqual(Array.from({ length: 14 }, (_, index) => index));
		expect(practiceTasks.length).toBeGreaterThan(0);
		for (const stage of curriculum.stages.filter((item) => item.id > 0)) {
			expect(stage.tasks.length).toBeGreaterThanOrEqual(3);
			expect(new Set(stage.tasks.map((task) => task.id)).size).toBe(stage.tasks.length);
			expect(new Set(stage.tasks.map((task) => task.topicKey)).size).toBe(stage.tasks.length);
		}
	});

	it('段階13のルーブリック識別子に重複がない', () => {
		const rubric = curriculum.stages[13].rubric;
		const keys = rubric.map((item) => `${item.area}|${item.item}`);
		expect(new Set(keys).size).toBe(keys.length);
	});

	it('壊れたカリキュラムを拒否する', () => {
		expect(() => validateCurriculum({ schemaVersion: '1.1', stages: [] })).toThrow();
	});
});
