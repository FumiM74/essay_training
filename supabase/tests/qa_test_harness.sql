-- Run with: supabase db query --linked --file supabase/tests/qa_test_harness.sql
-- Exercises QA seeding, isolation, finalization and reset in one rolled-back transaction.
begin;

create temp table qa_test_users (id uuid primary key, n smallint unique not null);
insert into qa_test_users values (gen_random_uuid(), 1), (gen_random_uuid(), 2);
grant select on qa_test_users to service_role, authenticated;

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select id, 'authenticated', 'authenticated', format('qa-harness-%s@example.invalid', id), '', now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"display_name":"QA harness test"}'::jsonb, now(), now()
from qa_test_users;

select set_config('request.jwt.claim.role', 'service_role', true);

select public.register_qa_test_learner(
  (select id from qa_test_users where n = 1),
  'Rolled-back QA integration test'
);

select public.seed_qa_fixed_exhaustion(
  (select id from qa_test_users where n = 1),
  4::smallint,
  (
    select jsonb_agg(jsonb_build_object(
      'taskKey', format('stage-4-generated-%s-core-clear_claim', to_hex(seed)),
      'stageId', 4,
      'title', format('QA fixture %s', seed + 1),
      'prompt', format('QA fixture prompt %s', seed + 1),
      'hint', 'QA fixture hint',
      'promptHash', format('qa-fixture-hash-%s', seed),
      'featureSignature', jsonb_build_object(
        'version', 2,
        'fingerprint', format('qa-fixture-fingerprint-%s', seed),
        'seed', seed,
        'topicDomain', 'education',
        'topicKey', 'qa-fixed-stage-4',
        'promptFamily', 'qa-fixed-exhaustion',
        'skillTargets', jsonb_build_array('clear_claim'),
        'selectionReason', 'core',
        'surfacePattern', 'qa-fixture',
        'generation', jsonb_build_object('source', 'curated', 'designVersion', 'qa-harness-v1', 'promptVersion', 'qa-harness-v1')
      )
    ) order by seed)
    from generate_series(0, 9) seed
  )
);

do $$
declare v_user uuid := (select id from qa_test_users where n = 1);
begin
  if (select count(*) from public.problem_history where learner_id = v_user) <> 10 then
    raise exception 'QA seed did not create ten consumed problems';
  end if;
  if (select current_stage_id <> 4 or highest_unlocked_stage_id <> 14 from public.learning_progress where learner_id = v_user) then
    raise exception 'QA seed did not prepare the requested stage';
  end if;
end;
$$;

do $$
declare
  v_user uuid := (select id from qa_test_users where n = 1);
  v_request uuid := gen_random_uuid();
  v_features jsonb := '{"version":2,"fingerprint":"qa-generated-fingerprint","seed":10,"topicDomain":"education","topicKey":"qa-stage-4","promptFamily":"qa-generation-test","skillTargets":["clear_claim"],"selectionReason":"core","surfacePattern":"qa-test","generation":{"source":"local_variant","designVersion":"qa-harness-v1","promptVersion":"qa-harness-v1"}}';
  v_result jsonb;
begin
  perform public.reserve_ai_problem_generation(v_user, v_request, 'qa-integration-request-hash',
    'stage-4-generated-a-core-clear_claim', 4::smallint, v_features, 'qa-test-model', 100, 100);
  v_result := public.finalize_ai_problem_generation(v_user, v_request,
    'stage-4-generated-a-core-clear_claim', 4::smallint, 'QA generated title', 'QA generated prompt', 'QA generated hint',
    v_features, 'fnv1a:qa-generated', 'anthropic', 'qa-test-model', gen_random_uuid()::text, 100, 50, 0, 0);
  if v_result ->> 'id' !~ '-q[0-9a-f]{8}$' then raise exception 'QA task id is not isolated'; end if;
  if not exists (
    select 1 from public.problem_bank
    where id = (v_result ->> 'problemId')::uuid and status = 'qa' and prompt_hash like 'qa:%'
  ) then raise exception 'QA problem or prompt hash is not isolated'; end if;
end;
$$;

create temp table generated_qa_problem as
select b.* from public.problem_bank b where b.status = 'qa';
grant select on generated_qa_problem to authenticated;
update public.learning_progress
set current_stage_id = 4, highest_unlocked_stage_id = 4
where learner_id = (select id from qa_test_users where n = 2);

reset role;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', (select id::text from qa_test_users where n = 2), true);
set local role authenticated;

do $$
declare v_problem generated_qa_problem%rowtype;
begin
  if (select count(*) from public.problem_bank where status = 'qa') <> 0 then
    raise exception 'A normal learner can read QA problems';
  end if;
  select * into v_problem from generated_qa_problem limit 1;
  begin
    perform public.issue_problem(v_problem.task_key, v_problem.stage_id, v_problem.title, v_problem.prompt,
      v_problem.hint, v_problem.feature_signature, v_problem.prompt_hash, v_problem.id);
    raise exception 'A normal learner issued a QA problem';
  exception when others then
    if sqlerrm = 'A normal learner issued a QA problem' then raise; end if;
  end;
end;
$$;

reset role;
select set_config('request.jwt.claim.role', 'service_role', true);
select public.reset_qa_test_learner((select id from qa_test_users where n = 1));

do $$
declare v_user uuid := (select id from qa_test_users where n = 1);
begin
  if exists (select 1 from public.problem_bank where status = 'qa') then raise exception 'QA problem was not deleted'; end if;
  if exists (select 1 from public.problem_history where learner_id = v_user) then raise exception 'QA history was not deleted'; end if;
  if exists (select 1 from public.submissions where learner_id = v_user) then raise exception 'QA submissions were not deleted'; end if;
  if (select current_stage_id <> 1 or highest_unlocked_stage_id <> 1 from public.learning_progress where learner_id = v_user) then
    raise exception 'QA progression was not reset to defaults';
  end if;
end;
$$;

reset role;
rollback;
