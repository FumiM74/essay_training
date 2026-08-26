import { describe, expect, it, vi } from 'vitest';
import { createSaveQueue } from './save-queue';

describe('createSaveQueue', () => {
	it('入力をまとめて最後の内容だけを保存する', async () => {
		vi.useFakeTimers();
		const saved: string[] = [];
		const queue = createSaveQueue(async (value: string) => { saved.push(value); return value; }, 500);
		queue.schedule('a', () => {}, () => {});
		queue.schedule('ab', () => {}, () => {});
		queue.schedule('abc', () => {}, () => {});
		await vi.advanceTimersByTimeAsync(500);
		await queue.flush();
		expect(saved).toEqual(['abc']);
		vi.useRealTimers();
	});

	it('保存を直列化して古い完了通知を無視する', async () => {
		vi.useFakeTimers();
		const calls: string[] = [];
		const completed: string[] = [];
		let active = 0;
		let maxActive = 0;
		const queue = createSaveQueue(async (value: string) => {
			calls.push(value); active += 1; maxActive = Math.max(maxActive, active);
			await new Promise((resolve) => setTimeout(resolve, 100));
			active -= 1;
			return value;
		}, 0);
		queue.schedule('old', (value) => completed.push(value), () => {});
		await vi.advanceTimersByTimeAsync(0);
		queue.schedule('new', (value) => completed.push(value), () => {});
		await vi.advanceTimersByTimeAsync(0);
		await vi.advanceTimersByTimeAsync(200);
		await queue.flush();
		expect(calls).toEqual(['old', 'new']);
		expect(maxActive).toBe(1);
		expect(completed).toEqual(['new']);
		vi.useRealTimers();
	});
});
