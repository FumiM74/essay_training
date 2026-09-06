-- Claude feedback is executed only by the feedback Edge Function.
-- Browser clients can no longer submit a self-authored grading result.

create table public.ai_request_jobs (
  learner_id uuid not null references public.profiles(id) on delete cascade,
  operation text not null check (operation in ('problem_generation', 'feedback')),
  request_id uuid not null,
  request_hash text not null check (char_length(request_hash) between 16 and 128),
  status text not null default 'pending' check (status in ('pending', 'succeeded', 'failed')),
  model text not null check (char_length(model) between 1 and 120),
  estimated_input_tokens integer not null check (estimated_input_tokens >= 0),
  requested_output_tokens integer not null check (requested_output_tokens > 0),
  result jsonb,
  error_code text check (char_length(error_code) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (learner_id, operation, request_id)
);

comment on table public.ai_request_jobs is
  'Server-only idempotency and budget reservations for paid AI calls. Failed or uncertain calls are not retried under the same request id.';

create index ai_request_jobs_daily_budget
  on public.ai_request_jobs (learner_id, operation, created_at desc);

create trigger ai_request_jobs_set_updated_at
before update on public.ai_request_jobs
for each row execute procedure public.set_updated_at();

alter table public.ai_request_jobs enable row level security;
revoke all on table public.ai_request_jobs from public, anon, authenticated;

create or replace function public.reserve_ai_feedback(
  p_learner_id uuid,
  p_request_id uuid,
  p_task_key text,
  p_stage_id smallint,
  p_request_hash text,
  p_model text,
  p_answer_length integer,
  p_requested_output_tokens integer
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

  -- Conservative Japanese-text preflight. Provider-reported usage is the billing source of truth.
  v_estimated_input := ceil((
    char_length(v_problem.prompt) + char_length(v_problem.hint)
    + char_length(v_problem.feature_signature::text) + p_answer_length + 1800
  ) * 1.2)::integer;
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

create or replace function public.finalize_ai_feedback(
  p_learner_id uuid,
  p_request_id uuid,
  p_task_key text,
  p_stage_id smallint,
  p_body text,
  p_feedback jsonb,
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
  v_problem public.problem_history%rowtype;
  v_submission jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  select * into v_job from public.ai_request_jobs
  where learner_id = p_learner_id and operation = 'feedback' and request_id = p_request_id
  for update;
  if not found then raise exception 'AI request was not reserved'; end if;
  if v_job.status = 'succeeded' then return v_job.result; end if;
  if v_job.status <> 'pending' then raise exception 'AI request cannot be finalized'; end if;
  if v_job.model <> p_model then raise exception 'AI model does not match reservation'; end if;

  select * into v_problem from public.problem_history
  where learner_id = p_learner_id and task_key = p_task_key and stage_id = p_stage_id
  for update;
  if not found then raise exception 'issued problem was not found'; end if;

  -- The underlying transaction function was designed around auth.uid(). Only this
  -- service-role function may set the verified learner id before calling it.
  perform set_config('request.jwt.claim.sub', p_learner_id::text, true);
  v_submission := public.submit_mock(
    p_request_id, p_task_key, p_stage_id, v_problem.task_title, p_body, p_feedback
  );

  insert into public.ai_usage_events (
    learner_id, submission_id, operation, provider, model, provider_request_id,
    status, input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens
  ) values (
    p_learner_id, (v_submission ->> 'id')::uuid, 'feedback', p_provider, p_model,
    nullif(p_provider_request_id, ''), 'succeeded', greatest(p_input_tokens, 0),
    greatest(p_output_tokens, 0), greatest(p_cache_creation_input_tokens, 0),
    greatest(p_cache_read_input_tokens, 0)
  );

  update public.ai_request_jobs
  set status = 'succeeded', result = v_submission, error_code = null
  where learner_id = p_learner_id and operation = 'feedback' and request_id = p_request_id;
  return v_submission;
end;
$$;

create or replace function public.fail_ai_feedback(
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
declare
  v_changed integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  update public.ai_request_jobs
  set status = 'failed', error_code = left(coalesce(p_error_code, 'provider_error'), 80)
  where learner_id = p_learner_id and operation = 'feedback' and request_id = p_request_id
    and status = 'pending';
  get diagnostics v_changed = row_count;
  if v_changed = 1 then
    insert into public.ai_usage_events (
      learner_id, operation, provider, model, provider_request_id, status,
      input_tokens, output_tokens
    ) values (
      p_learner_id, 'feedback', p_provider, p_model, nullif(p_provider_request_id, ''),
      'failed', greatest(p_input_tokens, 0), greatest(p_output_tokens, 0)
    );
  end if;
end;
$$;

revoke execute on function public.reserve_ai_feedback(uuid, uuid, text, smallint, text, text, integer, integer)
  from public, anon, authenticated;
revoke execute on function public.finalize_ai_feedback(uuid, uuid, text, smallint, text, jsonb, text, text, text, integer, integer, integer, integer)
  from public, anon, authenticated;
revoke execute on function public.fail_ai_feedback(uuid, uuid, text, text, text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.reserve_ai_feedback(uuid, uuid, text, smallint, text, text, integer, integer) to service_role;
grant execute on function public.finalize_ai_feedback(uuid, uuid, text, smallint, text, jsonb, text, text, text, integer, integer, integer, integer) to service_role;
grant execute on function public.fail_ai_feedback(uuid, uuid, text, text, text, text, integer, integer) to service_role;

revoke execute on function public.submit_mock(uuid, text, smallint, text, text, jsonb)
  from public, anon, authenticated;

comment on function public.reserve_ai_feedback(uuid, uuid, text, smallint, text, text, integer, integer) is
  'Service-only idempotency reservation and provisional per-learner budget guard for Claude feedback.';
comment on function public.finalize_ai_feedback(uuid, uuid, text, smallint, text, jsonb, text, text, text, integer, integer, integer, integer) is
  'Service-only atomic boundary for validated Claude feedback, progression, and provider usage.';
