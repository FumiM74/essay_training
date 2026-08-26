import type { FeedbackResult } from '$lib/types/contracts';
import type { SkillKey } from '$lib/types/curriculum';
import { getStageProblemDesign } from './learning-design';

export function createMockFeedback(text: string, stageId: number, skillTargets?: SkillKey[]): FeedbackResult {
	const normalized = text.trim();
	const minimum = stageId >= 12 ? 180 : stageId >= 7 ? 80 : 35;
	const hasSentenceEnd = /[。！？]$/.test(normalized);
	const passes = normalized.length >= minimum && hasSentenceEnd;
	const targets = skillTargets?.length ? skillTargets : getStageProblemDesign(stageId).coreSkills;

	if (passes) {
		return {
			schemaVersion: '1.0',
			languageStatus: 'clean',
			decision: 'pass',
			priorityFeedback: [
				{ title: '課題の条件を満たしています', guidance: '主張と説明の関係を保ちながら、さらに具体的な根拠を加えると説得力が高まります。' }
			],
			skillResults: targets.map((skillKey) => ({ skillKey, outcome: 'achieved', severity: 0, evidence: 'モック判定の形式条件を満たしました。' })),
		};
	}

	return {
		schemaVersion: '1.0',
		languageStatus: hasSentenceEnd ? 'minor_issue' : 'revision_required',
		decision: 'revise',
		priorityFeedback: [
			{
				title: normalized.length < minimum ? '説明をもう少し具体化しましょう' : '文末まで書き切りましょう',
				guidance: normalized.length < minimum
					? `この練習では${minimum}文字程度を目安に、理由や具体例を加えてください。`
					: '文の終わりを「。」などで明確にすると、読み手が内容を区切って理解できます。'
			}
		],
		skillResults: targets.map((skillKey) => ({
			skillKey,
			outcome: hasSentenceEnd ? 'partial' : 'missed',
			severity: hasSentenceEnd ? 1 : 2,
			evidence: normalized.length < minimum ? '必要な説明量に達していません。' : '文末が完結していません。',
		})),
	};
}
