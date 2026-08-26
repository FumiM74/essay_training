import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(resolve(process.cwd(), '../supabase/migrations/202608210001_initial_schema.sql'), 'utf8');
const rlsTest = readFileSync(resolve(process.cwd(), '../supabase/tests/learner_data_rls.sql'), 'utf8');

describe('Supabase adaptive learning contract', () => {
	it('旧4軸カラムを残さず段階別特徴署名のRPCを定義する', () => {
		expect(migration).not.toContain('feature_vectors');
		expect(migration).toContain('p_feature_signature jsonb');
		expect(migration).toContain('p_prompt_hash text');
		expect(migration).toContain('p_problem_id uuid default null');
		expect(rlsTest).toContain('"version":2');
	});

	it.each(['skill_results', 'learner_skill_stats', 'problem_bank', 'problem_history', 'ai_usage_events', 'ai_budget_policies'])(
		'%sでRLSを有効にする',
		(table) => expect(migration).toContain(`alter table public.${table} enable row level security`),
	);

	it('提出と同じトランザクションで技能結果と習熟度を更新する', () => {
		expect(migration).toContain('insert into public.skill_results');
		expect(migration).toContain('insert into public.learner_skill_stats');
		expect(migration).toContain('skill result is not a target of the issued problem');
		expect(rlsTest).toContain('Idempotent retry changed skill stats twice');
	});

	it('問題生成と添削のトークン上限・使用量保存を定義する', () => {
		expect(migration).toContain("('problem_generation', 1800, 700, 3, 5400, 2100)");
		expect(migration).toContain("('feedback', 6000, 1800, 20, 120000, 36000)");
		expect(migration).toContain('cache_creation_input_tokens');
		expect(migration).toContain('cache_read_input_tokens');
		expect(migration).toContain("review_status text not null default 'provisional'");
		expect(migration).toContain('ask the service owner');
	});
});
