-- Review fixes for the isolated QA harness.
-- Keep applied migration history immutable and replace only the affected functions.

create or replace function public.reset_qa_test_learner(p_learner_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'service role required' using errcode = '42501'; end if;
  if not exists (select 1 from public.qa_test_learners where learner_id = p_learner_id and active) then raise exception 'active QA learner was not found'; end if;

  -- Keep ai_usage_events until the QA problem ids have been selected.  Delete
  -- problem_history before problem_bank because its problem_id FK has NO ACTION.
  delete from public.drafts where learner_id = p_learner_id;
  delete from public.submissions where learner_id = p_learner_id;
  delete from public.problem_history where learner_id = p_learner_id;
  delete from public.learner_skill_stats where learner_id = p_learner_id;
  delete from public.problem_bank
  where status = 'qa'
    and id in (
      select problem_id from public.ai_usage_events
      where learner_id = p_learner_id and problem_id is not null
    );
  delete from public.ai_usage_events where learner_id = p_learner_id;
  delete from public.ai_request_jobs where learner_id = p_learner_id;

  -- An UPDATE cannot lower highest_unlocked_stage_id because the production
  -- frontier trigger deliberately preserves it. Recreate this QA-only row so
  -- all settings and progression return to their real defaults.
  delete from public.learning_progress where learner_id = p_learner_id;
  insert into public.learning_progress (learner_id) values (p_learner_id);
end;
$$;

create or replace function public.finalize_ai_problem_generation(
  p_learner_id uuid, p_request_id uuid, p_task_key text, p_stage_id smallint, p_title text, p_prompt text, p_hint text,
  p_feature_signature jsonb, p_prompt_hash text, p_provider text, p_model text, p_provider_request_id text,
  p_input_tokens integer, p_output_tokens integer, p_cache_creation_input_tokens integer default 0, p_cache_read_input_tokens integer default 0
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_job public.ai_request_jobs%rowtype;
  v_problem public.problem_bank%rowtype;
  v_result jsonb;
  v_status text;
  v_qa_key text;
  v_task_key text;
  v_prompt_hash text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'service role required' using errcode = '42501'; end if;
  select * into v_job from public.ai_request_jobs
  where learner_id = p_learner_id and operation = 'problem_generation' and request_id = p_request_id for update;
  if not found then raise exception 'AI request was not reserved'; end if;
  if v_job.status = 'succeeded' then return v_job.result; end if;
  if v_job.status <> 'pending' then raise exception 'AI request cannot be finalized'; end if;
  if v_job.model <> p_model then raise exception 'AI model does not match reservation'; end if;

  v_status := case when exists (
    select 1 from public.qa_test_learners where learner_id = p_learner_id and active
  ) then 'qa' else 'approved' end;
  v_qa_key := substring(replace(p_learner_id::text, '-', '') from 1 for 8);
  -- -q is a QA-only suffix. It is distinct from -t, which the web app reserves
  -- for learner-defined topics. The prompt hash also gets its own namespace so
  -- a QA row can never occupy the unique hash of a normal approved problem.
  v_task_key := case when v_status = 'qa' then left(p_task_key, 109) || '-q' || v_qa_key else p_task_key end;
  v_prompt_hash := case when v_status = 'qa' then 'qa:' || v_qa_key || ':' || left(p_prompt_hash, 147) else p_prompt_hash end;

  insert into public.problem_bank (
    task_key, stage_id, title, prompt, hint, feature_signature, prompt_hash,
    design_version, generation_source, provider, model, prompt_version, status,
    input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens, approved_at
  ) values (
    v_task_key, p_stage_id, p_title, p_prompt, p_hint, p_feature_signature, v_prompt_hash,
    p_feature_signature -> 'generation' ->> 'designVersion', 'ai', p_provider, p_model,
    p_feature_signature -> 'generation' ->> 'promptVersion', v_status,
    greatest(p_input_tokens, 0), greatest(p_output_tokens, 0), greatest(p_cache_creation_input_tokens, 0),
    greatest(p_cache_read_input_tokens, 0), case when v_status = 'approved' then now() else null end
  ) on conflict do nothing;

  select * into v_problem from public.problem_bank
  where status = v_status and stage_id = p_stage_id
    and (task_key = v_task_key or prompt_hash = v_prompt_hash)
  order by (task_key = v_task_key) desc, created_at asc limit 1;
  if not found then raise exception 'validated problem could not be published'; end if;

  perform set_config('request.jwt.claim.sub', p_learner_id::text, true);
  perform public.issue_problem(v_problem.task_key, v_problem.stage_id, v_problem.title, v_problem.prompt, v_problem.hint,
    v_problem.feature_signature, v_problem.prompt_hash, v_problem.id);
  v_result := jsonb_build_object(
    'id', v_problem.task_key, 'problemId', v_problem.id, 'stageId', v_problem.stage_id,
    'title', v_problem.title, 'prompt', v_problem.prompt, 'hint', v_problem.hint,
    'featureSignature', v_problem.feature_signature
  );
  insert into public.ai_usage_events (
    learner_id, problem_id, operation, provider, model, provider_request_id, status,
    input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens
  ) values (
    p_learner_id, v_problem.id, 'problem_generation', p_provider, p_model, nullif(p_provider_request_id, ''), 'succeeded',
    greatest(p_input_tokens, 0), greatest(p_output_tokens, 0), greatest(p_cache_creation_input_tokens, 0), greatest(p_cache_read_input_tokens, 0)
  );
  update public.ai_request_jobs set status = 'succeeded', result = v_result, error_code = null
  where learner_id = p_learner_id and operation = 'problem_generation' and request_id = p_request_id;
  return v_result;
end;
$$;

revoke execute on function public.reset_qa_test_learner(uuid) from public, anon, authenticated;
revoke execute on function public.finalize_ai_problem_generation(uuid, uuid, text, smallint, text, text, text, jsonb, text, text, text, text, integer, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.reset_qa_test_learner(uuid) to service_role;
grant execute on function public.finalize_ai_problem_generation(uuid, uuid, text, smallint, text, text, text, jsonb, text, text, text, text, integer, integer, integer, integer) to service_role;
