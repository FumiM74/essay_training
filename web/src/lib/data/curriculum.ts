import rawCurriculum from './curriculum.json';
import { MAX_STAGE_ID, type Curriculum, type PracticeTask } from '$lib/types/curriculum';

export function validateCurriculum(value: unknown): Curriculum {
	if (!value || typeof value !== 'object') throw new Error('カリキュラムがオブジェクトではありません。');
	const candidate = value as Partial<Curriculum>;
	if (candidate.schemaVersion !== '1.1') throw new Error('未対応のカリキュラム版です。');
	if (!Array.isArray(candidate.stages) || candidate.stages.length !== MAX_STAGE_ID + 1) throw new Error('段階0〜14が必要です。');
	const taskIds = new Set<string>();
	for (let index = 0; index < candidate.stages.length; index += 1) {
		const stage = candidate.stages[index];
		if (stage.id !== index || !stage.name || !stage.passSummary || !Array.isArray(stage.rubric) || !Array.isArray(stage.tasks)) {
			throw new Error(`段階${index}のデータが不正です。`);
		}
		if (index > 0 && stage.tasks.length < 3) throw new Error(`段階${index}には3問以上の練習課題が必要です。`);
		const topicKeys = new Set<string>();
		for (const task of stage.tasks) {
			if (!task.id || task.stageId !== index || !task.topicKey || !task.title || !task.prompt || !task.hint) throw new Error(`段階${index}の練習課題が不正です。`);
			if (taskIds.has(task.id)) throw new Error(`練習課題IDが重複しています: ${task.id}`);
			if (topicKeys.has(task.topicKey)) throw new Error(`段階${index}の話題が重複しています: ${task.topicKey}`);
			taskIds.add(task.id);
			topicKeys.add(task.topicKey);
		}
	}
	if (!Array.isArray(candidate.languageChecks) || candidate.languageChecks.length === 0) {
		throw new Error('日本語文成立チェックが必要です。');
	}
	return candidate as Curriculum;
}

export const curriculum = validateCurriculum(rawCurriculum);
export const practiceTasks = curriculum.stages.flatMap((stage) => stage.tasks);

export function getStageTasks(stageId: number): PracticeTask[] {
	return curriculum.stages.find((stage) => stage.id === stageId)?.tasks ?? [];
}

export function getPracticeTask(taskId: string): PracticeTask | undefined {
	return practiceTasks.find((task) => task.id === taskId);
}

export function getStage(stageId: number) {
	return curriculum.stages.find((stage) => stage.id === stageId);
}
