-- Run with: supabase db query --linked --file supabase/tests/learner_data_rls.sql
-- Two disposable Auth users and all test data are created inside this transaction.
-- The final rollback removes everything, including the Auth users.
begin;

create temp table test_users (id uuid primary key, n smallint unique not null);
insert into test_users values (gen_random_uuid(), 1), (gen_random_uuid(), 2);

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select
  id, 'authenticated', 'authenticated', format('rls-%s@example.invalid', id),
  '', now(), '{"provider":"email","providers":["email"]}'::jsonb,
  '{"display_name":"RLS test learner"}'::jsonb, now(), now()
from test_users;

grant select on test_users to authenticated;

-- Normalize the disposable users inside this rolled-back transaction.
update public.profiles set role = 'learner' where id in (select id from test_users);
update public.learning_progress
set current_stage_id = 1, highest_unlocked_stage_id = 1, consecutive_passes = 0, required_consecutive_passes = 3, completed_at = null
where learner_id in (select id from test_users);

select set_config('request.jwt.claim.sub', (select id::text from test_users where n = 1), true);
set local role authenticated;

insert into public.drafts (learner_id, task_key, body)
values (auth.uid(), 'rls-test', 'user-a');

do $$
begin
  if (select count(*) from public.drafts where task_key = 'rls-test') <> 1 then
    raise exception 'User A cannot read own draft';
  end if;
end;
$$;

-- Only the requirement setting is user-editable; progression is updated by submit_mock.
update public.learning_progress
set required_consecutive_passes = 3
where learner_id = auth.uid();

do $$
declare
  request_one uuid := gen_random_uuid();
  features_a jsonb := '{"version":2,"fingerprint":"pfs2:a","seed":0,"topicDomain":"education","topicKey":"school-reading","promptFamily":"complete-one-sentence","skillTargets":["sentence_completion"],"selectionReason":"core","surfacePattern":"direct","languagePattern":"single-subject-predicate","generation":{"source":"curated","designVersion":"2026-08-26","promptVersion":"adaptive-local-v1"}}';
  features_b jsonb := '{"version":2,"fingerprint":"pfs2:b","seed":1,"topicDomain":"technology","topicKey":"smartphone-rules","promptFamily":"complete-one-sentence","skillTargets":["subject_predicate"],"selectionReason":"exploration","surfacePattern":"reader-check","languagePattern":"complete-sentence-ending","generation":{"source":"curated","designVersion":"2026-08-26","promptVersion":"adaptive-local-v1"}}';
  features_c jsonb := '{"version":2,"fingerprint":"pfs2:c","seed":2,"topicDomain":"community","topicKey":"community-events","promptFamily":"complete-one-sentence","skillTargets":["sentence_completion"],"selectionReason":"weakness","surfacePattern":"revision-focus","languagePattern":"single-subject-predicate","generation":{"source":"local_variant","designVersion":"2026-08-26","promptVersion":"adaptive-local-v1"}}';
begin
  perform public.issue_problem('rls-stage-1-a', 1::smallint, 'RLS test A', '問題A', 'ヒント', features_a, 'fnv1a:aaaaaaaa', null::uuid);
  perform public.submit_mock(request_one, 'rls-stage-1-a', 1::smallint, 'RLS test A', '本文です。',
    '{"schemaVersion":"1","languageStatus":"clean","decision":"pass","priorityFeedback":[{"title":"確認","guidance":"合格です。"}],"skillResults":[{"skillKey":"sentence_completion","outcome":"achieved","severity":0,"evidence":"文が完成しています。"}]}'::jsonb);
  perform public.submit_mock(request_one, 'rls-stage-1-a', 1::smallint, 'RLS test A', '本文です。',
    '{"schemaVersion":"1","languageStatus":"clean","decision":"pass","priorityFeedback":[{"title":"確認","guidance":"合格です。"}],"skillResults":[{"skillKey":"sentence_completion","outcome":"achieved","severity":0,"evidence":"文が完成しています。"}]}'::jsonb);
  if (select consecutive_passes from public.learning_progress where learner_id = auth.uid()) <> 1 then
    raise exception 'Idempotent retry changed the pass streak twice';
  end if;
  perform public.submit_mock(gen_random_uuid(), 'rls-stage-1-a', 1::smallint, 'RLS test A', '別の送信IDです。',
    '{"schemaVersion":"1","languageStatus":"clean","decision":"pass","priorityFeedback":[{"title":"確認","guidance":"合格です。"}],"skillResults":[{"skillKey":"sentence_completion","outcome":"achieved","severity":0,"evidence":"文が完成しています。"}]}'::jsonb);
  if (select consecutive_passes from public.learning_progress where learner_id = auth.uid()) <> 1
    or (select count(*) from public.submissions where learner_id = auth.uid() and task_key = 'rls-stage-1-a') <> 1
  then
    raise exception 'The same task was counted more than once';
  end if;

  if (select attempts from public.learner_skill_stats where learner_id = auth.uid() and stage_id = 1 and skill_key = 'sentence_completion') <> 1 then
    raise exception 'Idempotent retry changed skill stats twice';
  end if;
  perform public.issue_problem('rls-stage-1-b', 1::smallint, 'RLS test B', '問題B', 'ヒント', features_b, 'fnv1a:bbbbbbbb', null::uuid);
  perform public.submit_mock(gen_random_uuid(), 'rls-stage-1-b', 1::smallint, 'RLS test B', '本文です。',
    '{"schemaVersion":"1","languageStatus":"clean","decision":"pass","priorityFeedback":[{"title":"確認","guidance":"合格です。"}],"skillResults":[{"skillKey":"subject_predicate","outcome":"partial","severity":1,"evidence":"主述の対応を再確認します。"}]}'::jsonb);
  perform public.issue_problem('rls-stage-1-c', 1::smallint, 'RLS test C', '問題C', 'ヒント', features_c, 'fnv1a:cccccccc', null::uuid);
  perform public.submit_mock(gen_random_uuid(), 'rls-stage-1-c', 1::smallint, 'RLS test C', '本文です。',
    '{"schemaVersion":"1","languageStatus":"clean","decision":"pass","priorityFeedback":[{"title":"確認","guidance":"合格です。"}],"skillResults":[{"skillKey":"sentence_completion","outcome":"achieved","severity":0,"evidence":"文が完成しています。"}]}'::jsonb);
  if (select current_stage_id from public.learning_progress where learner_id = auth.uid()) <> 2 then
    raise exception 'Three consecutive passes did not advance the stage';
  end if;
  perform public.select_learning_stage(1::smallint);
  if (select current_stage_id <> 1 or highest_unlocked_stage_id <> 2 from public.learning_progress where learner_id = auth.uid()) then
    raise exception 'Returning to an earlier stage lost the unlocked stage';
  end if;
end;
$$;

do $$
begin
  begin
    update public.learning_progress set current_stage_id = 13 where learner_id = auth.uid();
    raise exception 'Learner changed own current stage';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

reset role;
select set_config('request.jwt.claim.sub', (select id::text from test_users where n = 2), true);
set local role authenticated;

do $$
begin
  if exists (select 1 from public.drafts where task_key = 'rls-test') then
    raise exception 'User B can read User A draft';
  end if;
  if exists (select 1 from public.learner_skill_stats where skill_key = 'sentence_completion') then
    raise exception 'User B can read User A skill stats';
  end if;
  if exists (select 1 from public.problem_history where task_key = 'rls-stage-1-a') then
    raise exception 'User B can read User A problem history';
  end if;
end;
$$;

do $$
begin
  begin
    insert into public.drafts (learner_id, task_key, body)
    values ((select id from test_users where n = 1), 'rls-forbidden', 'forbidden');
    raise exception 'User B inserted a draft for User A';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

do $$
begin
  begin
    update public.profiles set role = 'admin' where id = auth.uid();
    raise exception 'Learner changed own role';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

reset role;

-- Unauthenticated clients have no table privilege and cannot read learner data.
select set_config('request.jwt.claim.sub', '', true);
set local role anon;
do $$
begin
  begin
    perform 1 from public.drafts limit 1;
    raise exception 'Unauthenticated client read learner drafts';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

reset role;

-- Promote User A only inside this rolled-back transaction and verify the admin policy.
update public.profiles
set role = 'admin'
where id = (select id from test_users where n = 1);
select set_config('request.jwt.claim.sub', (select id::text from test_users where n = 1), true);
set local role authenticated;

insert into public.drafts (learner_id, task_key, body)
values ((select id from test_users where n = 2), 'rls-admin', 'admin-created');

do $$
begin
  if not exists (
    select 1 from public.drafts
    where learner_id = (select id from test_users where n = 2)
      and task_key = 'rls-admin'
  ) then
    raise exception 'Admin cannot manage another learner draft';
  end if;
end;
$$;

reset role;
rollback;
