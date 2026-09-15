import { describe, expect, it } from 'vitest';
import { learningScopeForAuth, parseFeedback } from './learning-service';

const validFeedback = {
	schemaVersion: '1',
	languageStatus: 'clean',
	decision: 'pass',
	priorityFeedback: [{ title: '構成', guidance: '明確です。' }],
	skillResults: [{ skillKey: 'clear_claim', outcome: 'achieved', severity: 0, evidence: '主張が明確です。' }]
};

describe('parseFeedback', () => {
	it('完全な添削結果を受け入れる', () => {
		expect(parseFeedback(validFeedback)).toEqual(validFeedback);
	});

	it('旧添削結果は技能評価を捏造せず空配列として移行する', () => {
		const { skillResults: _unused, ...legacy } = validFeedback;
		expect(parseFeedback(legacy).skillResults).toEqual([]);
	});

	it('不完全または矛盾した結果を拒否する', () => {
		expect(() => parseFeedback({ ...validFeedback, priorityFeedback: [] })).toThrow();
		expect(() => parseFeedback({ ...validFeedback, priorityFeedback: Array.from({ length: 6 }, () => ({ title: '構成', guidance: '明確です。' })) })).toThrow();
		expect(() => parseFeedback({ ...validFeedback, languageStatus: 'revision_required', decision: 'pass' })).toThrow();
		expect(() => parseFeedback({ ...validFeedback, priorityFeedback: [{ title: '', guidance: 'x' }] })).toThrow();
		expect(() => parseFeedback({ ...validFeedback, skillResults: [{ skillKey: 'unknown', outcome: 'achieved', severity: 0, evidence: 'x' }] })).toThrow();
		expect(() => parseFeedback({ ...validFeedback, skillResults: [validFeedback.skillResults[0], validFeedback.skillResults[0]] })).toThrow();
	});

	it('STEP 1の5問分の解説を受け入れる', () => {
		const priorityFeedback = Array.from({ length: 5 }, (_, index) => ({ title: `問題${index + 1}`, guidance: '解説です。' }));
		expect(parseFeedback({ ...validFeedback, priorityFeedback }).priorityFeedback).toHaveLength(5);
	});
});

describe('learningScopeForAuth', () => {
	it('Supabase設定済みの未ログイン状態をローカル保存へ落とさない', () => {
		expect(learningScopeForAuth({ status: 'signed-out', user: null })).toBeNull();
		expect(learningScopeForAuth({ status: 'loading', user: null })).toBeNull();
		expect(learningScopeForAuth({ status: 'local', user: null })).toEqual({ mode: 'local' });
	});
});
