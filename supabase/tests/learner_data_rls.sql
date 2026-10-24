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

-- Production revokes submit_mock from browser users. This transaction-local,
-- security-definer wrapper lets the RLS suite exercise the same internal
-- progression transaction without reopening that browser permission.
create function pg_temp.test_submit_mock(
  p_request_id uuid, p_task_key text, p_stage_id smallint,
  p_task_title text, p_body text, p_feedback jsonb
) returns jsonb language sql security definer set search_path = public, pg_temp
as $$ select public.submit_mock(p_request_id, p_task_key, p_stage_id, p_task_title, p_body, p_feedback) $$;
grant execute on function pg_temp.test_submit_mock(uuid, text, smallint, text, text, jsonb) to authenticated;

-- Normalize the disposable users inside this rolled-back transaction.
update public.profiles set role = 'learner' where id in (select id from test_users);
update public.learning_progress
set current_stage_id = 1, highest_unlocked_stage_id = 1, learning_phase = 'training', phase_passes = 0,
  phase_attempts = 0, required_training_passes = 2, promotion_test_question_count = 2,
  required_retraining_passes = 2, completed_at = null
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

-- Only progression targets are user-editable; progression itself is updated by submit_mock.
update public.learning_progress
set required_training_passes = 2, promotion_test_question_count = 2, required_retraining_passes = 2
where learner_id = auth.uid();

do $$
declare
  request_one uuid := gen_random_uuid();
  request_pass uuid := gen_random_uuid();
	request_test uuid := gen_random_uuid();
	  features_a jsonb := '{"version":2,"fingerprint":"pfs2:a","seed":0,"topicDomain":"education","topicKey":"school-reading","promptFamily":"five-question-language-basics","skillTargets":["subject_predicate","particle_accuracy","auxiliary_accuracy","modifier_clarity","sentence_completion"],"selectionReason":"core","surfacePattern":"direct","languagePattern":"balanced-five-slot-set","generation":{"source":"curated","designVersion":"2026-09-02","promptVersion":"adaptive-local-v5"}}';
	  features_b jsonb := '{"version":2,"fingerprint":"pfs2:b","seed":1,"topicDomain":"technology","topicKey":"smartphone-rules","promptFamily":"five-question-language-basics","skillTargets":["subject_predicate","particle_accuracy","auxiliary_accuracy","modifier_clarity","sentence_completion"],"selectionReason":"exploration","surfacePattern":"reader-check","languagePattern":"balanced-five-slot-set","generation":{"source":"curated","designVersion":"2026-09-02","promptVersion":"adaptive-local-v5"}}';
	pass_feedback jsonb := '{"schemaVersion":"1","languageStatus":"clean","decision":"pass","priorityFeedback":[{"title":"確認","guidance":"5問すべて正解です。"}],"skillResults":[{"skillKey":"subject_predicate","outcome":"achieved","severity":0,"evidence":"主語と述語が正解です。"},{"skillKey":"particle_accuracy","outcome":"achieved","severity":0,"evidence":"助詞が正解です。"},{"skillKey":"auxiliary_accuracy","outcome":"achieved","severity":0,"evidence":"文末が正解です。"},{"skillKey":"modifier_clarity","outcome":"achieved","severity":0,"evidence":"語順が正解です。"},{"skillKey":"sentence_completion","outcome":"achieved","severity":0,"evidence":"文の修正が正解です。"}]}';
	revise_feedback jsonb := '{"schemaVersion":"1","languageStatus":"revision_required","decision":"revise","priorityFeedback":[{"title":"問題1：不正解","guidance":"正解と理由を確認してください。"}],"skillResults":[{"skillKey":"subject_predicate","outcome":"missed","severity":2,"evidence":"主語と述語が不正解です。"},{"skillKey":"particle_accuracy","outcome":"achieved","severity":0,"evidence":"助詞が正解です。"},{"skillKey":"auxiliary_accuracy","outcome":"achieved","severity":0,"evidence":"文末が正解です。"},{"skillKey":"modifier_clarity","outcome":"achieved","severity":0,"evidence":"語順が正解です。"},{"skillKey":"sentence_completion","outcome":"achieved","severity":0,"evidence":"文の修正が正解です。"}]}';
begin
  perform public.issue_problem('rls-stage-1-a', 1::smallint, 'RLS test A', '問題A', 'ヒント', features_a, 'fnv1a:aaaaaaaa', null::uuid);
	perform pg_temp.test_submit_mock(request_one, 'rls-stage-1-a', 1::smallint, 'RLS test A', '未完成', revise_feedback);
	if not exists (select 1 from public.drafts where learner_id = auth.uid() and task_key = 'rls-stage-1-a')
	  or not exists (select 1 from public.problem_history where learner_id = auth.uid() and task_key = 'rls-stage-1-a' and submitted_at is null)
	then raise exception 'Failed stage-1 training set must remain editable'; end if;
	perform pg_temp.test_submit_mock(request_pass, 'rls-stage-1-a', 1::smallint, 'RLS test A', '完成した本文です。', pass_feedback);
	perform pg_temp.test_submit_mock(request_pass, 'rls-stage-1-a', 1::smallint, 'RLS test A', '完成した本文です。', pass_feedback);
  if (select phase_passes from public.learning_progress where learner_id = auth.uid()) <> 1
		or (select count(*) from public.submissions where learner_id = auth.uid() and task_key in ('rls-stage-1-a', 'rls-stage-1-a-pass')) <> 2
		or (select attempts from public.learner_skill_stats where learner_id = auth.uid() and stage_id = 1 and skill_key = 'sentence_completion') <> 2
	then raise exception 'Stage-1 revision or idempotent retry was not recorded correctly'; end if;

  begin
    perform public.issue_problem('rls-duplicate-content', 1::smallint, 'Duplicate', '問題A', 'ヒント', features_a, 'fnv1a:aaaaaaaa', null::uuid);
    raise exception 'Duplicate content was falsely reported as issued';
  exception when unique_violation then null;
  end;
  if exists (select 1 from public.problem_history where learner_id = auth.uid() and submitted_at is null) then
    raise exception 'Duplicate issue created an open problem';
  end if;

  perform public.issue_problem('rls-stage-1-b', 1::smallint, 'RLS test B', '問題B', 'ヒント', features_b, 'fnv1a:bbbbbbbb', null::uuid);
	perform pg_temp.test_submit_mock(gen_random_uuid(), 'rls-stage-1-b', 1::smallint, 'RLS test B', '本文です。', pass_feedback);
  if (select learning_phase from public.learning_progress where learner_id = auth.uid()) <> 'promotion_test' then
    raise exception 'Training target did not start promotion test';
  end if;

  perform public.issue_problem('rls-test-1', 1::smallint, 'Promotion 1', '問題P1', 'ヒント', features_a, 'fnv1a:cccccccc', null::uuid);
	perform pg_temp.test_submit_mock(request_test, 'rls-test-1', 1::smallint, 'Promotion 1', '本文です。', pass_feedback);
	perform pg_temp.test_submit_mock(request_test, 'rls-test-1', 1::smallint, 'Promotion 1', '本文です。', pass_feedback);
  if (select phase_passes <> 1 or phase_attempts <> 1 from public.learning_progress where learner_id = auth.uid()) then
    raise exception 'Promotion retry counted twice';
  end if;
  perform public.issue_problem('rls-test-2', 1::smallint, 'Promotion 2', '問題P2', 'ヒント', features_a, 'fnv1a:dddddddd', null::uuid);
	perform pg_temp.test_submit_mock(gen_random_uuid(), 'rls-test-2', 1::smallint, 'Promotion 2', '未完成', revise_feedback);
  if (select learning_phase <> 'promotion_test' or phase_passes <> 1 or phase_attempts <> 2
      from public.learning_progress where learner_id = auth.uid()) then
    raise exception 'Failed promotion question did not retain accumulated passes';
  end if;
  if exists (select 1 from public.drafts where learner_id = auth.uid() and task_key = 'rls-test-2')
    or not exists (select 1 from public.problem_history where learner_id = auth.uid() and task_key = 'rls-test-2' and submitted_at is null)
  then
    raise exception 'Promotion-test revision did not keep the same problem open';
  end if;

	perform pg_temp.test_submit_mock(gen_random_uuid(), 'rls-test-2', 1::smallint, 'Promotion 2', '修正した本文です。', pass_feedback);
  if (select current_stage_id from public.learning_progress where learner_id = auth.uid()) <> 2 then
	    raise exception 'Corrected promotion-test answer did not advance the stage';
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
