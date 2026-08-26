import { error } from '@sveltejs/kit';
import { getStage } from '$lib/data/curriculum';
import { resolvePracticeTask } from '$lib/features/learning/problem-generator';

export function load({ params }) {
	const task = resolvePracticeTask(params.taskId);
	if (!task) error(404, '課題が見つかりません。');
	const stage = getStage(task.stageId);
	if (!stage) error(404, '段階が見つかりません。');
	return { task, stage };
}
