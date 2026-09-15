-- Reserve Claude problem generation, publish validated output to the shared
-- problem bank, and issue it to the requesting learner atomically.

create or replace function public.reserve_ai_problem_generation(
  p_learner_id uuid,
  p_request_id uuid,
  p_request_hash text,
  p_task_key text,
  p_stage_id smallint,
  p_feature_signature jsonb,
  p_model text,
  p_estimated_input_tokens integer,
  p_requested_output_tokens integer
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.ai_request_jobs%rowtype;
  v_policy public.ai_budget_policies%rowtype;
  v_progress public.learning_progress%rowtype;
  v_bank public.problem_bank%rowtype;
  v_request_count integer;
  v_input_tokens bigint;
  v_output_tokens bigint;
  v_pending_input bigint;
  v_pending_output bigint;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_learner_id is null or p_request_id is null then raise exception 'invalid request identity'; end if;
  if p_stage_id not between 1 and 14 then raise exception 'invalid stage'; end if;
  if p_task_key is null or char_length(p_task_key) not between 1 and 120 then raise exception 'invalid task key'; end if;
  if p_request_hash is null or char_length(p_request_hash) not between 16 and 128 then raise exception 'invalid request hash'; end if;
  if p_model is null or char_length(p_model) not between 1 and 120 then raise exception 'invalid model'; end if;
  if p_estimated_input_tokens is null or p_estimated_input_tokens not between 1 and 50000 then raise exception 'invalid estimated input tokens'; end if;
  if p_requested_output_tokens is null or p_requested_output_tokens not between 1 and 20000 then raise exception 'invalid requested output tokens'; end if;
  if p_feature_signature is null or char_length(p_feature_signature::text) > 12000
    or (p_feature_signature ->> 'version') is distinct from '2'
    or coalesce(p_feature_signature -> 'generation' ->> 'source', '') <> 'local_variant'
    or jsonb_typeof(p_feature_signature -> 'skillTargets') is distinct from 'array'
  then raise exception 'invalid problem feature signature'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_learner_id::text || ':problem_generation', 0));

  select * into v_existing from public.ai_request_jobs
  where learner_id = p_learner_id and operation = 'problem_generation' and request_id = p_request_id;
  if found then
    if v_existing.request_hash <> p_request_hash then
      raise exception 'request id was reused with different content' using errcode = '22023';
    end if;
    return jsonb_build_object('state', v_existing.status, 'result', v_existing.result, 'errorCode', v_existing.error_code);
  end if;

  select * into v_progress from public.learning_progress where learner_id = p_learner_id for update;
  if not found then raise exception 'learning progress is not initialized'; end if;
  if v_progress.current_stage_id <> p_stage_id then raise exception 'task is not in the current stage'; end if;
  if exists (select 1 from public.problem_history where learner_id = p_learner_id and stage_id = p_stage_id and submitted_at is null) then
    raise exception 'an unsubmitted problem already exists';
  end if;

  select * into v_bank from public.problem_bank
  where task_key = p_task_key and stage_id = p_stage_id and status = 'approved';
  if found then
    perform set_config('request.jwt.claim.sub', p_learner_id::text, true);
    perform public.issue_problem(v_bank.task_key, v_bank.stage_id, v_bank.title, v_bank.prompt, v_bank.hint, v_bank.feature_signature, v_bank.prompt_hash, v_bank.id);
    return jsonb_build_object('state', 'bank_available', 'result', jsonb_build_object(
      'id', v_bank.task_key, 'problemId', v_bank.id, 'stageId', v_bank.stage_id,
      'title', v_bank.title, 'prompt', v_bank.prompt, 'hint', v_bank.hint,
      'featureSignature', v_bank.feature_signature
    ));
  end if;

  select * into v_policy from public.ai_budget_policies where operation = 'problem_generation';
  if not found or not v_policy.enabled then return jsonb_build_object('state', 'rejected_budget', 'reason', 'disabled'); end if;
  if p_estimated_input_tokens > v_policy.max_input_tokens_per_request then
    return jsonb_build_object('state', 'rejected_budget', 'reason', 'request_input_limit');
  end if;
  if p_requested_output_tokens > v_policy.max_output_tokens_per_request then
    return jsonb_build_object('state', 'rejected_budget', 'reason', 'request_output_limit');
  end if;

  select count(*) into v_request_count from public.ai_request_jobs
  where learner_id = p_learner_id and operation = 'problem_generation' and created_at >= date_trunc('day', now());
  select coalesce(sum(input_tokens), 0), coalesce(sum(output_tokens), 0) into v_input_tokens, v_output_tokens
  from public.ai_usage_events where learner_id = p_learner_id and operation = 'problem_generation' and created_at >= date_trunc('day', now());
  select coalesce(sum(estimated_input_tokens), 0), coalesce(sum(requested_output_tokens), 0) into v_pending_input, v_pending_output
  from public.ai_request_jobs where learner_id = p_learner_id and operation = 'problem_generation'
    and status = 'pending' and created_at >= date_trunc('day', now());
  if v_request_count >= v_policy.daily_requests_per_learner
    or v_input_tokens + v_pending_input + p_estimated_input_tokens > v_policy.daily_input_tokens_per_learner
    or v_output_tokens + v_pending_output + p_requested_output_tokens > v_policy.daily_output_tokens_per_learner
  then return jsonb_build_object('state', 'rejected_budget', 'reason', 'daily_limit'); end if;

  insert into public.ai_request_jobs (
    learner_id, operation, request_id, request_hash, model, estimated_input_tokens, requested_output_tokens
  ) values (
    p_learner_id, 'problem_generation', p_request_id, p_request_hash, p_model, p_estimated_input_tokens, p_requested_output_tokens
  );
  return jsonb_build_object('state', 'reserved', 'policy', jsonb_build_object(
    'maxInputTokens', v_policy.max_input_tokens_per_request,
    'maxOutputTokens', v_policy.max_output_tokens_per_request,
    'reviewStatus', v_policy.review_status
  ));
end;
$$;

create or replace function public.finalize_ai_problem_generation(
  p_learner_id uuid,
  p_request_id uuid,
  p_task_key text,
  p_stage_id smallint,
  p_title text,
  p_prompt text,
  p_hint text,
  p_feature_signature jsonb,
  p_prompt_hash text,
  p_provider text,
  p_model text,
  p_provider_request_id text,
  p_input_tokens integer,
  p_output_tokens integer,
  p_cache_creation_input_tokens integer default 0,
  p_cache_read_input_tokens integer default 0
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.ai_request_jobs%rowtype;
  v_problem public.problem_bank%rowtype;
  v_result jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'service role required' using errcode = '42501'; end if;
  select * into v_job from public.ai_request_jobs
  where learner_id = p_learner_id and operation = 'problem_generation' and request_id = p_request_id for update;
  if not found then raise exception 'AI request was not reserved'; end if;
  if v_job.status = 'succeeded' then return v_job.result; end if;
  if v_job.status <> 'pending' then raise exception 'AI request cannot be finalized'; end if;
  if v_job.model <> p_model then raise exception 'AI model does not match reservation'; end if;

  insert into public.problem_bank (
    task_key, stage_id, title, prompt, hint, feature_signature, prompt_hash,
    design_version, generation_source, provider, model, prompt_version, status,
    input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens, approved_at
  ) values (
    p_task_key, p_stage_id, p_title, p_prompt, p_hint, p_feature_signature, p_prompt_hash,
    p_feature_signature -> 'generation' ->> 'designVersion', 'ai', p_provider, p_model,
    p_feature_signature -> 'generation' ->> 'promptVersion', 'approved',
    greatest(p_input_tokens, 0), greatest(p_output_tokens, 0), greatest(p_cache_creation_input_tokens, 0),
    greatest(p_cache_read_input_tokens, 0), now()
  ) on conflict do nothing;

  select * into v_problem from public.problem_bank
  where status = 'approved' and stage_id = p_stage_id
    and (task_key = p_task_key or prompt_hash = p_prompt_hash)
  order by (task_key = p_task_key) desc, created_at asc limit 1;
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

create or replace function public.fail_ai_problem_generation(
  p_learner_id uuid,
  p_request_id uuid,
  p_provider text,
  p_model text,
  p_provider_request_id text,
  p_error_code text,
  p_input_tokens integer default 0,
  p_output_tokens integer default 0
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_changed integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'service role required' using errcode = '42501'; end if;
  update public.ai_request_jobs set status = 'failed', error_code = left(coalesce(p_error_code, 'problem_generation_failed'), 80)
  where learner_id = p_learner_id and operation = 'problem_generation' and request_id = p_request_id and status = 'pending';
  get diagnostics v_changed = row_count;
  if v_changed = 1 then
    insert into public.ai_usage_events (learner_id, operation, provider, model, provider_request_id, status, input_tokens, output_tokens)
    values (p_learner_id, 'problem_generation', p_provider, p_model, nullif(p_provider_request_id, ''), 'failed', greatest(p_input_tokens, 0), greatest(p_output_tokens, 0));
  end if;
end;
$$;

revoke execute on function public.reserve_ai_problem_generation(uuid, uuid, text, text, smallint, jsonb, text, integer, integer) from public, anon, authenticated;
revoke execute on function public.finalize_ai_problem_generation(uuid, uuid, text, smallint, text, text, text, jsonb, text, text, text, text, integer, integer, integer, integer) from public, anon, authenticated;
revoke execute on function public.fail_ai_problem_generation(uuid, uuid, text, text, text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.reserve_ai_problem_generation(uuid, uuid, text, text, smallint, jsonb, text, integer, integer) to service_role;
grant execute on function public.finalize_ai_problem_generation(uuid, uuid, text, smallint, text, text, text, jsonb, text, text, text, text, integer, integer, integer, integer) to service_role;
grant execute on function public.fail_ai_problem_generation(uuid, uuid, text, text, text, text, integer, integer) to service_role;

update public.ai_budget_policies
set max_input_tokens_per_request = 12000,
    max_output_tokens_per_request = 7000,
    daily_requests_per_learner = 3,
    daily_input_tokens_per_learner = 36000,
    daily_output_tokens_per_learner = 21000,
    review_status = 'provisional',
    updated_at = now()
where operation = 'problem_generation';

comment on function public.reserve_ai_problem_generation(uuid, uuid, text, text, smallint, jsonb, text, integer, integer) is
  'Service-only idempotency and provisional budget reservation for Claude problem generation. Reuses an approved bank item before reserving paid work.';
comment on function public.finalize_ai_problem_generation(uuid, uuid, text, smallint, text, text, text, jsonb, text, text, text, text, integer, integer, integer, integer) is
  'Publishes validated AI output to the shared bank, records actual usage, and issues the problem atomically.';
