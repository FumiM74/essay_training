import type { TopicSelectionMode } from '$lib/types/learning';

export const MAX_CUSTOM_TOPICS = 3;
export const MAX_CUSTOM_TOPIC_CHARACTERS = 20;

export function isTopicSelectionMode(value: unknown): value is TopicSelectionMode {
	return value === 'random' || value === 'custom';
}

export function normalizeCustomTopics(values: readonly string[]): string[] {
	if (values.length > MAX_CUSTOM_TOPICS) throw new Error('自由設定のテーマは3つまでです。');
	const normalized = values.map((value) => value.normalize('NFKC').trim()).filter(Boolean);
	if (normalized.some((value) => Array.from(value).length > MAX_CUSTOM_TOPIC_CHARACTERS)) {
		throw new Error('自由設定のテーマは1件20文字以内で入力してください。');
	}
	const unique = [...new Set(normalized)];
	if (unique.length !== normalized.length) throw new Error('同じテーマを重複して設定できません。');
	return unique;
}

export function customTopicKey(topic: string): string {
	let hash = 2166136261;
	for (const character of topic.normalize('NFKC')) {
		hash ^= character.codePointAt(0) ?? 0;
		hash = Math.imul(hash, 16777619);
	}
	return `learner-topic-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
