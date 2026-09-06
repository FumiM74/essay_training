-- Run with: supabase db query --linked --file supabase/tests/claude_feedback_security.sql
-- No Anthropic request is made. All disposable rows are rolled back.
begin;

create temp table claude_test_user (id uuid primary key);
insert into claude_test_user values (gen_random_uuid());
grant select on claude_test_user to service_role;
grant select on public.ai_usage_events to service_role;

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select id, 'authenticated', 'authenticated', format('claude-pipeline-%s@example.invalid', id),
  '', now(), '{"provider":"email","providers":["email"]}'::jsonb,
  '{"display_name":"Claude pipeline test"}'::jsonb, now(), now()
from claude_test_user;

update public.learning_progress
set current_stage_id = 2, highest_unlocked_stage_id = 2
where learner_id = (select id from claude_test_user);

select set_config('request.jwt.claim.sub', (select id::text from claude_test_user), true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select public.issue_problem(
  'claude-pipeline-stage-2', 2::smallint, 'Claude pipeline test',
  '次の二つの内容を一文にまとめてください。', '意見と理由を自然につないでください。',
  '{"version":2,"fingerprint":"pfs2:claude-pipeline","seed":0,"topicDomain":"education","topicKey":"school-reading","promptFamily":"clarify-one-sentence","skillTargets":["modifier_clarity","particle_accuracy"],"selectionReason":"core","surfacePattern":"direct","languagePattern":"modifier-target","generation":{"source":"curated","designVersion":"2026-09-03","promptVersion":"adaptive-local-v7"}}'::jsonb,
  'fnv1a:claudefeedback', null::uuid
);

do $$
begin
  begin
    perform public.submit_mock(
      gen_random_uuid(), 'claude-pipeline-stage-2', 2::smallint, 'forged', '偽の答案。',
      '{"schemaVersion":"1.0","languageStatus":"clean","decision":"pass","priorityFeedback":[{"title":"偽判定","guidance":"ブラウザが作った判定です。"}],"skillResults":[{"skillKey":"modifier_clarity","outcome":"achieved","severity":0,"evidence":"偽の根拠です。"},{"skillKey":"particle_accuracy","outcome":"achieved","severity":0,"evidence":"偽の根拠です。"}]}'::jsonb
    );
    raise exception 'Authenticated browser could execute submit_mock';
  exception when insufficient_privilege then null;
  end;
end;
$$;

reset role;
select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;

do $$
declare
  learner uuid := (select id from claude_test_user);
  request_id uuid := gen_random_uuid();
  reservation jsonb;
  submission jsonb;
  reused jsonb;
  feedback jsonb := '{"schemaVersion":"1.0","languageStatus":"clean","decision":"pass","priorityFeedback":[{"title":"良い点","guidance":"意見と理由が自然につながっています。"}],"skillResults":[{"skillKey":"modifier_clarity","outcome":"achieved","severity":0,"evidence":"修飾先が読み取れます。"},{"skillKey":"particle_accuracy","outcome":"achieved","severity":0,"evidence":"助詞の使い方が自然です。"}]}';
begin
  reservation := public.reserve_ai_feedback(
    learner, request_id, 'claude-pipeline-stage-2', 2::smallint,
    repeat('a', 64), 'claude-sonnet-test', 24, 1200
  );
  if reservation ->> 'state' <> 'reserved' then raise exception 'AI request was not reserved: %', reservation; end if;

  submission := public.finalize_ai_feedback(
    learner, request_id, 'claude-pipeline-stage-2', 2::smallint,
    '理由が分かるため、意見に納得できる。', feedback,
    'anthropic', 'claude-sonnet-test', 'msg_test_claude_pipeline', 420, 180, 0, 0
  );
  if submission ->> 'id' is null or submission ->> 'taskKey' <> 'claude-pipeline-stage-2' then
    raise exception 'Validated feedback was not saved: %', submission;
  end if;
  if not exists (
    select 1 from public.ai_usage_events
    where learner_id = learner and provider_request_id = 'msg_test_claude_pipeline'
      and input_tokens = 420 and output_tokens = 180 and status = 'succeeded'
  ) then raise exception 'Provider usage was not saved'; end if;

  reused := public.reserve_ai_feedback(
    learner, request_id, 'claude-pipeline-stage-2', 2::smallint,
    repeat('a', 64), 'claude-sonnet-test', 24, 1200
  );
  if reused ->> 'state' <> 'succeeded' or reused -> 'result' ->> 'id' <> submission ->> 'id' then
    raise exception 'Idempotent retry did not reuse the saved submission';
  end if;
end;
$$;

reset role;
rollback;
