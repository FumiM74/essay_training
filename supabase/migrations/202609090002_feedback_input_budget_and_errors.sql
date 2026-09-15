-- Count the complete STEP 1-3 Claude request before reserving budget.
-- Easy feedback remains part of the same request and never consumes a second call.

drop function if exists public.reserve_ai_feedback(uuid, uuid, text, smallint, text, text, integer, integer);

create function public.reserve_ai_feedback(
  p_learner_id uuid,
  p_request_id uuid,
  p_task_key text,
  p_stage_id smallint,
  p_request_hash text,
  p_model text,
  p_answer_length integer,
  p_requested_output_tokens integer,
  p_estimated_input_tokens integer default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.ai_request_jobs%rowtype;
  v_policy public.ai_budget_policies%rowtype;
  v_problem public.problem_history%rowtype;
  v_request_count integer;
  v_input_tokens bigint;
  v_output_tokens bigint;
  v_pending_input bigint;
  v_pending_output bigint;
  v_estimated_input integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_learner_id is null or p_request_id is null then raise exception 'invalid request identity'; end if;
  if p_stage_id not between 1 and 14 then raise exception 'invalid stage'; end if;
  if p_task_key is null or char_length(p_task_key) not between 1 and 120 then raise exception 'invalid task key'; end if;
  if p_request_hash is null or char_length(p_request_hash) not between 16 and 128 then raise exception 'invalid request hash'; end if;
  if p_model is null or char_length(p_model) not between 1 and 120 then raise exception 'invalid model'; end if;
  if p_answer_length is null or p_answer_length not between 1 and 20000 then raise exception 'invalid answer length'; end if;
  if p_estimated_input_tokens is not null and p_estimated_input_tokens not between 1 and 50000 then
    raise exception 'invalid estimated input tokens';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_learner_id::text || ':feedback', 0));

  select * into v_existing
  from public.ai_request_jobs
  where learner_id = p_learner_id and operation = 'feedback' and request_id = p_request_id;
  if found then
    if v_existing.request_hash <> p_request_hash then
      raise exception 'request id was reused with different content' using errcode = '22023';
    end if;
    return jsonb_build_object(
      'state', v_existing.status,
      'result', v_existing.result,
      'errorCode', v_existing.error_code
    );
  end if;

  select * into v_policy from public.ai_budget_policies where operation = 'feedback';
  if not found or not v_policy.enabled then
    return jsonb_build_object('state', 'rejected_budget', 'reason', 'disabled');
  end if;
  if p_requested_output_tokens <= 0 or p_requested_output_tokens > v_policy.max_output_tokens_per_request then
    return jsonb_build_object('state', 'rejected_budget', 'reason', 'request_output_limit');
  end if;

  select * into v_problem
  from public.problem_history
  where learner_id = p_learner_id
    and task_key = p_task_key
    and stage_id = p_stage_id
    and submitted_at is null
  for update;
  if not found then raise exception 'task was not issued or was already submitted'; end if;

  -- STEP 1-3 send a server-computed estimate for the complete prompt and JSON
  -- schema. Later stages use this conservative fallback and are rechecked by
  -- the Edge Function against the fully assembled request before Claude runs.
  v_estimated_input := coalesce(
    p_estimated_input_tokens,
    ceil((
      octet_length(v_problem.prompt) + octet_length(v_problem.hint)
      + octet_length(v_problem.feature_signature::text)
    ) / 3.0)::integer + p_answer_length + 768
  );
  if v_estimated_input > v_policy.max_input_tokens_per_request then
    return jsonb_build_object('state', 'rejected_budget', 'reason', 'request_input_limit');
  end if;

  select count(*) into v_request_count
  from public.ai_request_jobs
  where learner_id = p_learner_id and operation = 'feedback'
    and created_at >= date_trunc('day', now());
  select coalesce(sum(input_tokens), 0), coalesce(sum(output_tokens), 0)
    into v_input_tokens, v_output_tokens
  from public.ai_usage_events
  where learner_id = p_learner_id and operation = 'feedback'
    and created_at >= date_trunc('day', now());
  select coalesce(sum(estimated_input_tokens), 0), coalesce(sum(requested_output_tokens), 0)
    into v_pending_input, v_pending_output
  from public.ai_request_jobs
  where learner_id = p_learner_id and operation = 'feedback' and status = 'pending'
    and created_at >= date_trunc('day', now());

  if v_request_count >= v_policy.daily_requests_per_learner
    or v_input_tokens + v_pending_input + v_estimated_input > v_policy.daily_input_tokens_per_learner
    or v_output_tokens + v_pending_output + p_requested_output_tokens > v_policy.daily_output_tokens_per_learner
  then
    return jsonb_build_object('state', 'rejected_budget', 'reason', 'daily_limit');
  end if;

  insert into public.ai_request_jobs (
    learner_id, operation, request_id, request_hash, model,
    estimated_input_tokens, requested_output_tokens
  ) values (
    p_learner_id, 'feedback', p_request_id, p_request_hash, p_model,
    v_estimated_input, p_requested_output_tokens
  );

  return jsonb_build_object(
    'state', 'reserved',
    'problem', jsonb_build_object(
      'taskKey', v_problem.task_key,
      'stageId', v_problem.stage_id,
      'taskTitle', v_problem.task_title,
      'prompt', v_problem.prompt,
      'hint', v_problem.hint,
      'promptHash', v_problem.prompt_hash,
      'featureSignature', v_problem.feature_signature,
      'learningPhase', v_problem.learning_phase
    ),
    'policy', jsonb_build_object(
      'maxInputTokens', v_policy.max_input_tokens_per_request,
      'maxOutputTokens', v_policy.max_output_tokens_per_request,
      'reviewStatus', v_policy.review_status
    )
  );
end;
$$;

revoke execute on function public.reserve_ai_feedback(uuid, uuid, text, smallint, text, text, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.reserve_ai_feedback(uuid, uuid, text, smallint, text, text, integer, integer, integer)
  to service_role;

comment on function public.reserve_ai_feedback(uuid, uuid, text, smallint, text, text, integer, integer, integer) is
  'Service-only idempotency reservation. STEP 1-3 use the complete serialized Claude input estimate; easy wording is included in the same feedback request.';

update public.ai_budget_policies
set max_input_tokens_per_request = 8000,
    daily_input_tokens_per_learner = 160000,
    review_status = 'provisional',
    updated_at = now()
where operation = 'feedback';

comment on table public.ai_budget_policies is
  'AI quality/cost limits. Values are provisional development guards. Easy feedback is part of the normal feedback call and does not have a separate request budget. Ask the service owner to approve final limits during release testing.';
