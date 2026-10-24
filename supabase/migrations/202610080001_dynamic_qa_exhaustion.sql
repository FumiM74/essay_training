-- Keep the isolated QA exhaustion harness aligned with the current curriculum.
-- The caller supplies every current fixed problem seed.  This function also
-- records all currently approved shared problems as consumed for the QA learner,
-- so the next provision request reaches Claude instead of another bank problem.

create or replace function public.seed_qa_fixed_exhaustion(
  p_learner_id uuid,
  p_stage_id smallint,
  p_problems jsonb
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item jsonb;
  v_bank public.problem_bank%rowtype;
  v_submission_id uuid;
  v_feedback jsonb;
  v_skill text;
  v_expected_seed integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.qa_test_learners
    where learner_id = p_learner_id and active
  ) then
    raise exception 'active QA learner was not found';
  end if;
  if p_stage_id not between 1 and 14
    or jsonb_typeof(p_problems) <> 'array'
    or jsonb_array_length(p_problems) not between 1 and 500
  then
    raise exception 'invalid QA seed request';
  end if;

  perform public.reset_qa_test_learner(p_learner_id);
  update public.learning_progress
  set current_stage_id = p_stage_id,
      highest_unlocked_stage_id = 14,
      learning_phase = 'training',
      phase_passes = 0,
      phase_attempts = 0,
      frontier_learning_phase = 'training',
      frontier_phase_passes = 0,
      frontier_phase_attempts = 0,
      completed_at = null,
      updated_at = now()
  where learner_id = p_learner_id;

  for v_item in select value from jsonb_array_elements(p_problems) loop
    if coalesce((v_item ->> 'stageId')::smallint, 0) <> p_stage_id
      or coalesce((v_item -> 'featureSignature' ->> 'seed')::integer, -1) <> v_expected_seed
      or coalesce(char_length(v_item ->> 'taskKey'), 0) not between 1 and 120
      or coalesce(char_length(v_item ->> 'title'), 0) not between 1 and 160
      or coalesce(char_length(v_item ->> 'prompt'), 0) not between 1 and 16000
      or coalesce(char_length(v_item ->> 'hint'), 0) not between 1 and 2000
      or coalesce(char_length(v_item ->> 'promptHash'), 0) not between 8 and 160
      or coalesce(v_item -> 'featureSignature' ->> 'version', '') <> '2'
      or jsonb_typeof(v_item -> 'featureSignature' -> 'skillTargets') <> 'array'
    then
      raise exception 'invalid or non-contiguous QA fixture at seed %', v_expected_seed;
    end if;
    v_skill := v_item -> 'featureSignature' -> 'skillTargets' ->> 0;
    if coalesce(char_length(v_skill), 0) = 0 then
      raise exception 'invalid QA fixture skill';
    end if;

    insert into public.problem_history (
      learner_id, task_key, stage_id, task_title, prompt, hint,
      feature_signature, prompt_hash, design_version, generation_source,
      submitted_at, learning_phase
    ) values (
      p_learner_id, v_item ->> 'taskKey', p_stage_id, v_item ->> 'title',
      v_item ->> 'prompt', v_item ->> 'hint', v_item -> 'featureSignature',
      v_item ->> 'promptHash',
      v_item -> 'featureSignature' -> 'generation' ->> 'designVersion',
      v_item -> 'featureSignature' -> 'generation' ->> 'source',
      now() - interval '1 minute', 'training'
    );

    insert into public.submissions (
      learner_id, task_key, request_id, stage_id, task_title, body,
      learning_phase, submitted_at
    ) values (
      p_learner_id, v_item ->> 'taskKey', gen_random_uuid(), p_stage_id,
      v_item ->> 'title', 'QA fixture: fixed problem consumed.',
      'training', now() - interval '1 minute'
    ) returning id into v_submission_id;

    v_feedback := jsonb_build_object(
      'schemaVersion', '1.0',
      'languageStatus', 'clean',
      'decision', 'pass',
      'priorityFeedback', jsonb_build_array(jsonb_build_object(
        'title', 'QA fixture',
        'guidance', 'Fixed problem is marked as consumed for QA only.'
      )),
      'skillResults', jsonb_build_array(jsonb_build_object(
        'skillKey', v_skill,
        'outcome', 'achieved',
        'severity', 0,
        'evidence', 'QA fixture pass.'
      ))
    );
    insert into public.feedback_results (
      submission_id, learner_id, schema_version, language_status, decision, result
    ) values (
      v_submission_id, p_learner_id, '1.0', 'clean', 'pass', v_feedback
    );
    insert into public.skill_results (
      submission_id, learner_id, stage_id, skill_key, outcome, severity, evidence
    ) values (
      v_submission_id, p_learner_id, p_stage_id, v_skill,
      'achieved', 0, 'QA fixture pass.'
    );
    v_expected_seed := v_expected_seed + 1;
  end loop;

  -- Approved shared problems are normally preferred over Claude.  Mark them as
  -- completed only in this learner's history; the shared bank rows are unchanged.
  for v_bank in
    select * from public.problem_bank
    where stage_id = p_stage_id and status = 'approved'
    order by created_at, id
  loop
    v_skill := coalesce(
      nullif(v_bank.feature_signature -> 'skillTargets' ->> 0, ''),
      'qa_consumed'
    );
    insert into public.problem_history (
      learner_id, task_key, problem_id, stage_id, task_title, prompt, hint,
      feature_signature, prompt_hash, design_version, generation_source,
      submitted_at, learning_phase
    ) values (
      p_learner_id, v_bank.task_key, v_bank.id, v_bank.stage_id,
      v_bank.title, v_bank.prompt, v_bank.hint, v_bank.feature_signature,
      v_bank.prompt_hash, v_bank.design_version, v_bank.generation_source,
      now() - interval '30 seconds', 'training'
    );

    insert into public.submissions (
      learner_id, task_key, request_id, stage_id, task_title, body,
      learning_phase, submitted_at
    ) values (
      p_learner_id, v_bank.task_key, gen_random_uuid(), v_bank.stage_id,
      v_bank.title, 'QA fixture: approved shared problem consumed.',
      'training', now() - interval '30 seconds'
    ) returning id into v_submission_id;

    v_feedback := jsonb_build_object(
      'schemaVersion', '1.0',
      'languageStatus', 'clean',
      'decision', 'pass',
      'priorityFeedback', jsonb_build_array(jsonb_build_object(
        'title', 'QA fixture',
        'guidance', 'Approved shared problem is marked as consumed for QA only.'
      )),
      'skillResults', jsonb_build_array(jsonb_build_object(
        'skillKey', v_skill,
        'outcome', 'achieved',
        'severity', 0,
        'evidence', 'QA fixture pass.'
      ))
    );
    insert into public.feedback_results (
      submission_id, learner_id, schema_version, language_status, decision, result
    ) values (
      v_submission_id, p_learner_id, '1.0', 'clean', 'pass', v_feedback
    );
    insert into public.skill_results (
      submission_id, learner_id, stage_id, skill_key, outcome, severity, evidence
    ) values (
      v_submission_id, p_learner_id, v_bank.stage_id, v_skill,
      'achieved', 0, 'QA fixture pass.'
    );
  end loop;
end;
$$;

revoke execute on function public.seed_qa_fixed_exhaustion(uuid, smallint, jsonb)
  from public, anon, authenticated;
grant execute on function public.seed_qa_fixed_exhaustion(uuid, smallint, jsonb)
  to service_role;
