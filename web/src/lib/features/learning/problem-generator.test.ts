import { describe, expect, it } from 'vitest';
import { generatePracticeTask, practiceTaskPromptHash, promptHash } from './problem-generator';

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

	it('STEP 2・3は27セットを重複なく生成できる', () => {
		for (const stageId of [2, 3]) {
			const hashes = Array.from({ length: 27 }, (_, seed) => practiceTaskPromptHash(generatePracticeTask(stageId, seed)));
			expect(new Set(hashes).size).toBe(27);
		}
	});
});
