import type { SkillResult } from '$lib/types/contracts';
import { SKILL_KEYS, type SkillKey } from '$lib/types/curriculum';
import type { LearnerSkillStat } from '$lib/types/learning';
import { skillStatKey } from './learning-design';

const RECENT_RESULT_WEIGHT = 0.35;
const INITIAL_MASTERY = 0.5;

function outcomeScore(result: SkillResult): number {
	if (result.outcome === 'achieved') return 1;
	if (result.outcome === 'partial') return 0.5;
	return 0;
}

export function updateSkillStats(
	current: Record<string, LearnerSkillStat>,
	stageId: number,
	results: SkillResult[],
	practicedAt: string,
): Record<string, LearnerSkillStat> {
	const next = { ...current };
	for (const result of results) {
		const key = skillStatKey(stageId, result.skillKey);
		const previous = next[key];
		const priorScore = previous?.masteryScore ?? INITIAL_MASTERY;
		const masteryScore = Number((priorScore * (1 - RECENT_RESULT_WEIGHT) + outcomeScore(result) * RECENT_RESULT_WEIGHT).toFixed(4));
		next[key] = {
			stageId,
			skillKey: result.skillKey,
			attempts: (previous?.attempts ?? 0) + 1,
			achievedCount: (previous?.achievedCount ?? 0) + (result.outcome === 'achieved' ? 1 : 0),
			partialCount: (previous?.partialCount ?? 0) + (result.outcome === 'partial' ? 1 : 0),
			missedCount: (previous?.missedCount ?? 0) + (result.outcome === 'missed' ? 1 : 0),
			masteryScore,
			lastOutcome: result.outcome,
			lastPracticedAt: practicedAt,
		};
	}
	return next;
}

export function weakestSkillsForStage(stats: Record<string, LearnerSkillStat>, stageId: number): SkillKey[] {
	return Object.values(stats)
		.filter((item) => item.stageId === stageId && (
			(item.lastOutcome !== 'achieved' && item.masteryScore < 0.75)
			|| (item.attempts >= 3 && item.masteryScore < 0.6)
		))
		.sort((left, right) => left.masteryScore - right.masteryScore || left.attempts - right.attempts || left.skillKey.localeCompare(right.skillKey))
		.map((item) => item.skillKey);
}

export function isLearnerSkillStats(value: unknown): value is Record<string, LearnerSkillStat> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	return Object.values(value as Record<string, unknown>).every((item) => {
		if (!item || typeof item !== 'object') return false;
		const stat = item as Partial<LearnerSkillStat>;
		return Number.isInteger(stat.stageId) && Number(stat.stageId) >= 1 && Number(stat.stageId) <= 13
			&& typeof stat.skillKey === 'string' && (SKILL_KEYS as readonly string[]).includes(stat.skillKey)
			&& Number.isInteger(stat.attempts) && Number(stat.attempts) >= 1
			&& Number.isInteger(stat.achievedCount) && Number(stat.achievedCount) >= 0
			&& Number.isInteger(stat.partialCount) && Number(stat.partialCount) >= 0
			&& Number.isInteger(stat.missedCount) && Number(stat.missedCount) >= 0
			&& Number(stat.attempts) === Number(stat.achievedCount) + Number(stat.partialCount) + Number(stat.missedCount)
			&& typeof stat.masteryScore === 'number' && stat.masteryScore >= 0 && stat.masteryScore <= 1
			&& ['achieved', 'partial', 'missed'].includes(String(stat.lastOutcome))
			&& typeof stat.lastPracticedAt === 'string';
	});
}
