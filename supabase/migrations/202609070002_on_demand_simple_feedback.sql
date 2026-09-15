-- Optional plain-language explanations never affect grading or progression.
-- They are generated only after a learner asks, then cached per submission.

alter table public.ai_request_jobs drop constraint if exists ai_request_jobs_operation_check;
alter table public.ai_request_jobs add constraint ai_request_jobs_operation_check
  check (operation in ('problem_generation', 'feedback', 'feedback_simplification'));
alter table public.ai_usage_events drop constraint if exists ai_usage_events_operation_check;
alter table public.ai_usage_events add constraint ai_usage_events_operation_check
  check (operation in ('problem_generation', 'feedback', 'feedback_simplification'));
alter table public.ai_budget_policies drop constraint if exists ai_budget_policies_operation_check;
alter table public.ai_budget_policies add constraint ai_budget_policies_operation_check
  check (operation in ('problem_generation', 'feedback', 'feedback_simplification'));

insert into public.ai_budget_policies (
  operation, max_input_tokens_per_request, max_output_tokens_per_request,
  daily_requests_per_learner, daily_input_tokens_per_learner, daily_output_tokens_per_learner
) values ('feedback_simplification', 2600, 600, 5, 13000, 3000)
on conflict (operation) do nothing;

comment on table public.ai_budget_policies is
  'AI quality/cost limits. Seed values are provisional development guards; ask the service owner and set review_status=approved during the final release test. feedback_simplification is an optional, cached plain-language rewrite.';

create table public.feedback_simplifications (
  submission_id uuid primary key references public.submissions(id) on delete cascade,
  learner_id uuid not null references public.profiles(id) on delete cascade,
  schema_version text not null check (schema_version = '1.0'),
  reading_level text not null check (reading_level = 'upper_elementary_to_junior_high'),
  result jsonb not null,
  created_at timestamptz not null default now(),
  check (char_length(result::text) <= 8000)
);
create index feedback_simplifications_owner_created on public.feedback_simplifications (learner_id, created_at desc);
alter table public.feedback_simplifications enable row level security;
create policy "learner reads own feedback simplification" on public.feedback_simplifications
  for select using (learner_id = auth.uid() or public.is_admin());
revoke all on table public.feedback_simplifications from anon, authenticated;
grant select on table public.feedback_simplifications to authenticated;

create or replace function public.reserve_ai_feedback_simplification(
  p_learner_id uuid, p_submission_id uuid, p_request_id uuid, p_request_hash text,
  p_model text, p_requested_output_tokens integer
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_existing public.ai_request_jobs%rowtype;
  v_policy public.ai_budget_policies%rowtype;
  v_submission record;
  v_cached jsonb;
  v_request_count integer;
  v_input_tokens bigint;
  v_output_tokens bigint;
  v_pending_input bigint;
  v_pending_output bigint;
  v_estimated_input integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'service role required' using errcode = '42501'; end if;
  if p_learner_id is null or p_submission_id is null or p_request_id is null then raise exception 'invalid request identity'; end if;
  if p_request_hash is null or char_length(p_request_hash) not between 16 and 128 then raise exception 'invalid request hash'; end if;
  if p_model is null or char_length(p_model) not between 1 and 120 then raise exception 'invalid model'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_learner_id::text || ':feedback_simplification:' || p_submission_id::text, 0));

  select fs.result into v_cached from public.feedback_simplifications fs
  where fs.submission_id = p_submission_id and fs.learner_id = p_learner_id;
  if found then return jsonb_build_object('state', 'succeeded', 'result', v_cached); end if;

  select * into v_existing from public.ai_request_jobs
  where learner_id = p_learner_id and operation = 'feedback_simplification' and request_id = p_request_id;
  if found then
    if v_existing.request_hash <> p_request_hash then raise exception 'request id was reused with different content' using errcode = '22023'; end if;
    return jsonb_build_object('state', v_existing.status, 'result', v_existing.result, 'errorCode', v_existing.error_code);
  end if;

  select s.stage_id, f.result as feedback into v_submission
  from public.submissions s join public.feedback_results f on f.submission_id = s.id
  where s.id = p_submission_id and s.learner_id = p_learner_id and f.learner_id = p_learner_id
    and f.decision = 'revise';
  if not found then return jsonb_build_object('state', 'rejected_budget', 'reason', 'feedback_not_revisable'); end if;

  select * into v_policy from public.ai_budget_policies where operation = 'feedback_simplification';
  if not found or not v_policy.enabled then return jsonb_build_object('state', 'rejected_budget', 'reason', 'disabled'); end if;
  if p_requested_output_tokens <= 0 or p_requested_output_tokens > v_policy.max_output_tokens_per_request then return jsonb_build_object('state', 'rejected_budget', 'reason', 'request_output_limit'); end if;
  v_estimated_input := ceil((char_length(v_submission.feedback::text) + 1000) * 1.2)::integer;
  if v_estimated_input > v_policy.max_input_tokens_per_request then return jsonb_build_object('state', 'rejected_budget', 'reason', 'request_input_limit'); end if;

  select count(*) into v_request_count from public.ai_request_jobs
  where learner_id = p_learner_id and operation = 'feedback_simplification' and created_at >= date_trunc('day', now());
  select coalesce(sum(input_tokens), 0), coalesce(sum(output_tokens), 0) into v_input_tokens, v_output_tokens
  from public.ai_usage_events where learner_id = p_learner_id and operation = 'feedback_simplification' and created_at >= date_trunc('day', now());
  select coalesce(sum(estimated_input_tokens), 0), coalesce(sum(requested_output_tokens), 0) into v_pending_input, v_pending_output
  from public.ai_request_jobs where learner_id = p_learner_id and operation = 'feedback_simplification' and status = 'pending' and created_at >= date_trunc('day', now());
  if v_request_count >= v_policy.daily_requests_per_learner
    or v_input_tokens + v_pending_input + v_estimated_input > v_policy.daily_input_tokens_per_learner
    or v_output_tokens + v_pending_output + p_requested_output_tokens > v_policy.daily_output_tokens_per_learner
  then return jsonb_build_object('state', 'rejected_budget', 'reason', 'daily_limit'); end if;

  insert into public.ai_request_jobs (learner_id, operation, request_id, request_hash, model, estimated_input_tokens, requested_output_tokens)
  values (p_learner_id, 'feedback_simplification', p_request_id, p_request_hash, p_model, v_estimated_input, p_requested_output_tokens);
  return jsonb_build_object('state', 'reserved', 'submission', jsonb_build_object('stageId', v_submission.stage_id, 'feedback', v_submission.feedback));
end;
$$;

create or replace function public.finalize_ai_feedback_simplification(
  p_learner_id uuid, p_submission_id uuid, p_request_id uuid, p_result jsonb,
  p_provider text, p_model text, p_provider_request_id text, p_input_tokens integer, p_output_tokens integer,
  p_cache_creation_input_tokens integer default 0, p_cache_read_input_tokens integer default 0
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_job public.ai_request_jobs%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'service role required' using errcode = '42501'; end if;
  select * into v_job from public.ai_request_jobs where learner_id = p_learner_id and operation = 'feedback_simplification' and request_id = p_request_id for update;
  if not found then raise exception 'AI request was not reserved'; end if;
  if v_job.status = 'succeeded' then return v_job.result; end if;
  if v_job.status <> 'pending' or v_job.model <> p_model then raise exception 'AI request cannot be finalized'; end if;
  if not exists (select 1 from public.submissions s join public.feedback_results f on f.submission_id = s.id where s.id = p_submission_id and s.learner_id = p_learner_id and f.decision = 'revise') then raise exception 'feedback is not revisable'; end if;
  insert into public.feedback_simplifications (submission_id, learner_id, schema_version, reading_level, result)
  values (p_submission_id, p_learner_id, '1.0', 'upper_elementary_to_junior_high', p_result)
  on conflict (submission_id) do nothing;
  select result into p_result from public.feedback_simplifications where submission_id = p_submission_id and learner_id = p_learner_id;
  insert into public.ai_usage_events (learner_id, submission_id, operation, provider, model, provider_request_id, status, input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens)
  values (p_learner_id, p_submission_id, 'feedback_simplification', p_provider, p_model, nullif(p_provider_request_id, ''), 'succeeded', greatest(p_input_tokens, 0), greatest(p_output_tokens, 0), greatest(p_cache_creation_input_tokens, 0), greatest(p_cache_read_input_tokens, 0));
  update public.ai_request_jobs set status = 'succeeded', result = p_result, error_code = null
  where learner_id = p_learner_id and operation = 'feedback_simplification' and request_id = p_request_id;
  return p_result;
end;
$$;

create or replace function public.fail_ai_feedback_simplification(
  p_learner_id uuid, p_request_id uuid, p_provider text, p_model text, p_provider_request_id text,
  p_error_code text, p_input_tokens integer default 0, p_output_tokens integer default 0
) returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_changed integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'service role required' using errcode = '42501'; end if;
  update public.ai_request_jobs set status = 'failed', error_code = left(coalesce(p_error_code, 'provider_error'), 80)
  where learner_id = p_learner_id and operation = 'feedback_simplification' and request_id = p_request_id and status = 'pending';
  get diagnostics v_changed = row_count;
  if v_changed = 1 then insert into public.ai_usage_events (learner_id, operation, provider, model, provider_request_id, status, input_tokens, output_tokens)
    values (p_learner_id, 'feedback_simplification', p_provider, p_model, nullif(p_provider_request_id, ''), 'failed', greatest(p_input_tokens, 0), greatest(p_output_tokens, 0)); end if;
end;
$$;

revoke execute on function public.reserve_ai_feedback_simplification(uuid, uuid, uuid, text, text, integer) from public, anon, authenticated;
revoke execute on function public.finalize_ai_feedback_simplification(uuid, uuid, uuid, jsonb, text, text, text, integer, integer, integer, integer) from public, anon, authenticated;
revoke execute on function public.fail_ai_feedback_simplification(uuid, uuid, text, text, text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.reserve_ai_feedback_simplification(uuid, uuid, uuid, text, text, integer) to service_role;
grant execute on function public.finalize_ai_feedback_simplification(uuid, uuid, uuid, jsonb, text, text, text, integer, integer, integer, integer) to service_role;
grant execute on function public.fail_ai_feedback_simplification(uuid, uuid, text, text, text, text, integer, integer) to service_role;
