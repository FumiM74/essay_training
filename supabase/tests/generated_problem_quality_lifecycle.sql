-- Run with: supabase db query --linked --file supabase/tests/generated_problem_quality_lifecycle.sql
-- No Anthropic request is made. All disposable rows are rolled back.
begin;

create temp table quality_test_user (id uuid primary key);
insert into quality_test_user values (gen_random_uuid());
grant select on quality_test_user to service_role;

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select id, 'authenticated', 'authenticated', format('quality-lifecycle-%s@example.invalid', id), '', now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{"display_name":"Quality lifecycle test"}'::jsonb, now(), now()
from quality_test_user;

select set_config('request.jwt.claim.role', 'service_role', true);

do $$
declare
  learner uuid := (select id from quality_test_user);
  generation_request uuid := gen_random_uuid();
  problem jsonb;
  problem_id uuid;
  v_task_key text;
  submit_result jsonb;
  approved_problem_id uuid;
  quality_review jsonb := '{"attempt":1,"review":{"verdict":"approve","summary":"問題と採点条件が一致しています。","scores":{"instructionClarity":4,"internalConsistency":4,"answerability":4,"readability":4,"stageAlignment":4,"gradingFairness":4,"answerContractConsistency":4},"issues":[],"independentAnswerOutline":["意見と理由を二文で示す。"]},"model":"quality-test-model","promptVersion":"problem-quality-review-v1","providerRequestId":"quality_review_lifecycle_1","inputTokens":300,"outputTokens":100,"cacheCreationInputTokens":0,"cacheReadInputTokens":0}';
  features jsonb := '{"version":2,"fingerprint":"pfs2:quality-lifecycle","seed":100,"topicDomain":"education","topicKey":"school-reading","promptFamily":"opinion-and-reason","skillTargets":["clear_claim"],"selectionReason":"core","surfacePattern":"direct","generation":{"source":"ai","designVersion":"quality-test-v1","promptVersion":"problem-generation-v3","model":"generation-test-model"},"generationContract":{"acceptedAnswerExamples":["読書時間を設けるべきだ。考えを深められるからだ。"],"gradingCriteria":[{"skillKey":"clear_claim","passCondition":"意見が明確である。"}],"hiddenRequirements":[],"basicQuestions":[]}}';
  revise_feedback jsonb := '{"schemaVersion":"1.0","languageStatus":"revision_required","decision":"revise","priorityFeedback":[{"title":"意見を明確にしましょう","guidance":"何をするべきかを書いてください。"}],"skillResults":[{"skillKey":"clear_claim","outcome":"missed","severity":2,"evidence":"意見が明確ではありません。"}]}';
  pass_feedback jsonb := '{"schemaVersion":"1.0","languageStatus":"clean","decision":"pass","priorityFeedback":[{"title":"意見が明確です","guidance":"何をするべきかが明確です。"}],"skillResults":[{"skillKey":"clear_claim","outcome":"achieved","severity":0,"evidence":"意見が明確です。"}]}';
begin
  update public.learning_progress set current_stage_id = 4, highest_unlocked_stage_id = 4 where learner_id = learner;
  perform public.reserve_ai_problem_generation(learner, generation_request, repeat('a', 64),
    'stage-4-generated-2s-core-clear_claim', 4::smallint, features || '{"generation":{"source":"local_variant","designVersion":"quality-test-v1","promptVersion":"adaptive-local-v13"}}',
    'generation-test-model', 500, 500);
  problem := public.finalize_reviewed_ai_problem_generation(
    learner, generation_request, 'stage-4-generated-2s-core-clear_claim', 4::smallint,
    '意見と理由を書く練習', '学校に読書時間を設けることについて、意見と理由を二文で書いてください。',
    '一文目に意見、二文目に理由を書きましょう。', features, 'fnv1a:qualitylifecycle',
    'anthropic', 'generation-test-model', 'generation_quality_lifecycle_1', 500, 200, 0, 0,
    jsonb_build_array(quality_review), '{}'::jsonb,
    '[{"label":"模範解答例","answer":"読書時間を設けるべきだ。考えを深められるからだ。","explanation":"意見と理由を分けて示しています。"}]'::jsonb
  );
  problem_id := (problem ->> 'problemId')::uuid;
  v_task_key := problem ->> 'id';
  if (select status from public.problem_bank where id = problem_id) <> 'trial' then raise exception 'Generated problem was shared before field testing'; end if;

  perform set_config('request.jwt.claim.sub', learner::text, true);
  for attempt in 1..5 loop
    submit_result := public.submit_mock(gen_random_uuid(), v_task_key, 4::smallint, '意見と理由を書く練習',
      '読書について考えた。', revise_feedback);
    if attempt < 5 and submit_result -> 'trialOutcome' ->> 'status' <> 'active' then raise exception 'Trial ended before five revisions'; end if;
  end loop;
  if submit_result -> 'trialOutcome' ->> 'status' <> 'disqualified'
    or jsonb_array_length(submit_result -> 'trialOutcome' -> 'modelAnswers') <> 1
  then raise exception 'Fifth revision did not return the model answer'; end if;
  if (select status from public.problem_bank where id = problem_id) <> 'rejected'
    or exists (select 1 from public.problem_history where learner_id = learner and task_key = v_task_key and submitted_at is null)
  then raise exception 'Disqualified problem remained available or shareable'; end if;

  insert into public.problem_bank (task_key, stage_id, title, prompt, hint, feature_signature, prompt_hash,
    canonical_prompt_hash, design_version, generation_source, provider, model, prompt_version, status)
  values ('stage-4-generated-2t-core-clear_claim-iapproved', 4, '承認試験', '意見と理由を二文で書いてください。',
    '意見を先に書きます。', features, 'fnv1a:approvedtrial:i1', 'fnv1a:approvedtrial', 'quality-test-v1',
    'ai', 'anthropic', 'generation-test-model', 'problem-generation-v3', 'trial') returning id into approved_problem_id;
  insert into public.problem_trials (problem_id, learner_id, model_answers)
  values (approved_problem_id, learner, '[{"label":"模範解答例","answer":"読書時間を設けるべきだ。考えを深められるからだ。","explanation":"意見と理由を示しています。"}]');
  perform public.issue_problem('stage-4-generated-2t-core-clear_claim-iapproved', 4::smallint, '承認試験',
    '意見と理由を二文で書いてください。', '意見を先に書きます。', features, 'fnv1a:approvedtrial:i1', null::uuid);
  update public.problem_history set problem_id = approved_problem_id
    where learner_id = learner and task_key = 'stage-4-generated-2t-core-clear_claim-iapproved';
  submit_result := public.submit_mock(gen_random_uuid(), 'stage-4-generated-2t-core-clear_claim-iapproved', 4::smallint,
    '承認試験', '読書時間を設けるべきだ。考えを深められるからだ。', pass_feedback);
  if submit_result -> 'trialOutcome' ->> 'status' <> 'approved'
    or (select status from public.problem_bank where id = approved_problem_id) <> 'approved'
  then raise exception 'Passed common-topic trial was not promoted'; end if;
end;
$$;

do $$
begin
  if has_table_privilege('authenticated', 'public.problem_trials', 'select')
    or has_table_privilege('authenticated', 'public.problem_quality_reviews', 'select')
  then raise exception 'Learner can read server-only quality tables'; end if;
end;
$$;

rollback;
