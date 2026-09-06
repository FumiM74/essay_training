import { describe, expect, it, vi } from 'vitest';
import { captureSubmission, saveThenRefresh } from './submission-workflow';
import { generatePracticeTask } from './problem-generator';
import { createBasicQuestionSetFeedback } from './feedback';
import { defaultLearningProgress } from './progression';

describe('保存と再読込の境界', () => {
	it('送信後の編集・進捗更新が保存用スナップショットを変更しない', () => {
		const task = generatePracticeTask(1, 0);
		const source = { task, text: '送信した解答', feedback: createBasicQuestionSetFeedback(task.questionSet!, {}), progress: defaultLearningProgress() };
		const snapshot = captureSubmission(source);
		source.text = '後から編集';
		source.task.questionSet![0].prompt = '別問題';
		source.progress.phasePasses = 10;
		expect(snapshot.text).toBe('送信した解答');
		expect(snapshot.task.questionSet![0].prompt).not.toBe('別問題');
		expect(snapshot.progress.phasePasses).toBe(0);
	});
	it('保存後の読込失敗でも保存結果を保持し、保存を繰り返さない', async () => {
		const record = { id: 'saved', text: '解答' };
		const save = vi.fn().mockResolvedValue(record);
		const refresh = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ passes: 1 });
		const result = await saveThenRefresh(save, refresh);
		expect(result).toMatchObject({ submission: record, synced: false });
		expect(await refresh()).toEqual({ passes: 1 });
		expect(save).toHaveBeenCalledTimes(1);
	});
	it('保存自体の失敗は成功として扱わない', async () => {
		const refresh = vi.fn();
		await expect(saveThenRefresh(async () => { throw new Error('write failed'); }, refresh)).rejects.toThrow('write failed');
		expect(refresh).not.toHaveBeenCalled();
	});
	it('保存と読込が成功したら両方の結果を返す', async () => {
		expect(await saveThenRefresh(async () => 'saved', async () => 'state')).toEqual({ submission: 'saved', synced: true, state: 'state' });
	});
});
