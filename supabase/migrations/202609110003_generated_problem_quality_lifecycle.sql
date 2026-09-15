-- Generated problems are independently reviewed, field-tested with one learner,
-- and shared only after that learner passes in fewer than five revision results.

alter table public.problem_bank drop constraint if exists problem_bank_status_check;
alter table public.problem_bank add constraint problem_bank_status_check
  check (status in ('draft', 'trial', 'qa', 'approved', 'rejected', 'archived'));
alter table public.problem_bank add column canonical_prompt_hash text;
update public.problem_bank set canonical_prompt_hash = prompt_hash where canonical_prompt_hash is null;
alter table public.problem_bank add constraint problem_bank_canonical_prompt_hash_length
  check (canonical_prompt_hash is null or char_length(canonical_prompt_hash) between 8 and 160);
create unique index problem_bank_one_approved_canonical_prompt
  on public.problem_bank (stage_id, canonical_prompt_hash) where status = 'approved' and canonical_prompt_hash is not null;

alter table public.submissions add column trial_resolution jsonb;

create table public.problem_trials (
  problem_id uuid primary key references public.problem_bank(id) on delete cascade,
  learner_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'active'
    check (status in ('active', 'approved', 'private_verified', 'disqualified')),
  revision_count smallint not null default 0 check (revision_count between 0 and 5),
  max_revision_count smallint not null default 5 check (max_revision_count = 5),
  custom_topic boolean not null default false,
  model_answers jsonb not null check (jsonb_typeof(model_answers) = 'array'),
  passed_at timestamptz,
  disqualified_at timestamptz,
  disqualification_reason text,
  promoted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (learner_id, problem_id)
);
create index problem_trials_owner_status on public.problem_trials (learner_id, status, created_at desc);
create trigger problem_trials_set_updated_at before update on public.problem_trials
for each row execute procedure public.set_updated_at();

create table public.problem_quality_reviews (
  id uuid primary key default gen_random_uuid(),
  problem_id uuid not null references public.problem_bank(id) on delete cascade,
  review_attempt smallint not null check (review_attempt between 1 and 2),
  verdict text not null check (verdict in ('approve', 'revise', 'reject')),
  review jsonb not null check (jsonb_typeof(review) = 'object'),
  provider text not null check (char_length(provider) between 1 and 80),
  model text not null check (char_length(model) between 1 and 120),
  prompt_version text not null check (char_length(prompt_version) between 1 and 120),
  provider_request_id text check (char_length(provider_request_id) <= 200),
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  cache_creation_input_tokens integer not null default 0 check (cache_creation_input_tokens >= 0),
  cache_read_input_tokens integer not null default 0 check (cache_read_input_tokens >= 0),
  created_at timestamptz not null default now(),
  unique (problem_id, review_attempt)
);

alter table public.problem_trials enable row level security;
alter table public.problem_quality_reviews enable row level security;
revoke all on table public.problem_trials, public.problem_quality_reviews from public, anon, authenticated;

alter table public.ai_usage_events drop constraint if exists ai_usage_events_operation_check;
alter table public.ai_usage_events add constraint ai_usage_events_operation_check
  check (operation in ('problem_generation', 'problem_generation_repair', 'problem_quality_review', 'feedback', 'feedback_simplification'));
alter table public.ai_budget_policies drop constraint if exists ai_budget_policies_operation_check;
alter table public.ai_budget_policies add constraint ai_budget_policies_operation_check
  check (operation in ('problem_generation', 'problem_generation_repair', 'problem_quality_review', 'feedback', 'feedback_simplification'));

insert into public.ai_budget_policies (
  operation, max_input_tokens_per_request, max_output_tokens_per_request,
  daily_requests_per_learner, daily_input_tokens_per_learner, daily_output_tokens_per_learner,
  review_status
) values
  ('problem_quality_review', 14000, 2200, 6, 84000, 13200, 'provisional'),
  ('problem_generation_repair', 18000, 3500, 3, 54000, 10500, 'provisional')
on conflict (operation) do update set
  max_input_tokens_per_request = excluded.max_input_tokens_per_request,
  max_output_tokens_per_request = excluded.max_output_tokens_per_request,
  daily_requests_per_learner = excluded.daily_requests_per_learner,
  daily_input_tokens_per_learner = excluded.daily_input_tokens_per_learner,
  daily_output_tokens_per_learner = excluded.daily_output_tokens_per_learner,
  review_status = 'provisional', updated_at = now();

create or replace function public.get_ai_suboperation_budget(
  p_learner_id uuid, p_operation text, p_estimated_input_tokens integer, p_requested_output_tokens integer
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_policy public.ai_budget_policies%rowtype;
  v_requests integer;
  v_input bigint;
  v_output bigint;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'service role required' using errcode = '42501'; end if;
  if p_operation not in ('problem_quality_review', 'problem_generation_repair') then raise exception 'invalid AI suboperation'; end if;
  select * into v_policy from public.ai_budget_policies where operation = p_operation;
  if not found or not v_policy.enabled then return jsonb_build_object('allowed', false, 'reason', 'disabled'); end if;
  if p_estimated_input_tokens > v_policy.max_input_tokens_per_request then return jsonb_build_object('allowed', false, 'reason', 'request_input_limit'); end if;
  if p_requested_output_tokens > v_policy.max_output_tokens_per_request then return jsonb_build_object('allowed', false, 'reason', 'request_output_limit'); end if;
  select count(*), coalesce(sum(input_tokens), 0), coalesce(sum(output_tokens), 0)
    into v_requests, v_input, v_output from public.ai_usage_events
    where learner_id = p_learner_id and operation = p_operation and created_at >= date_trunc('day', now());
  if v_requests >= v_policy.daily_requests_per_learner
    or v_input + p_estimated_input_tokens > v_policy.daily_input_tokens_per_learner
    or v_output + p_requested_output_tokens > v_policy.daily_output_tokens_per_learner
  then return jsonb_build_object('allowed', false, 'reason', 'daily_limit'); end if;
  return jsonb_build_object('allowed', true, 'reviewStatus', v_policy.review_status,
    'maxInputTokens', v_policy.max_input_tokens_per_request, 'maxOutputTokens', v_policy.max_output_tokens_per_request);
end;
$$;
revoke execute on function public.get_ai_suboperation_budget(uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.get_ai_suboperation_budget(uuid, text, integer, integer) to service_role;

create or replace function public.finalize_reviewed_ai_problem_generation(
  p_learner_id uuid, p_request_id uuid, p_task_key text, p_stage_id smallint,
  p_title text, p_prompt text, p_hint text, p_feature_signature jsonb, p_prompt_hash text,
  p_provider text, p_model text, p_provider_request_id text,
  p_input_tokens integer, p_output_tokens integer, p_cache_creation_input_tokens integer,
  p_cache_read_input_tokens integer, p_quality_reviews jsonb, p_repair_usage jsonb,
  p_model_answers jsonb
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_job public.ai_request_jobs%rowtype;
  v_problem public.problem_bank%rowtype;
  v_review jsonb;
  v_result jsonb;
  v_status text;
  v_task_key text;
  v_stored_hash text;
  v_suffix text := substring(replace(p_request_id::text, '-', '') from 1 for 8);
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'service role required' using errcode = '42501'; end if;
  select * into v_job from public.ai_request_jobs
    where learner_id = p_learner_id and operation = 'problem_generation' and request_id = p_request_id for update;
  if not found then raise exception 'AI request was not reserved'; end if;
  if v_job.status = 'succeeded' then return v_job.result; end if;
  if v_job.status <> 'pending' then raise exception 'AI request cannot be finalized'; end if;
  if v_job.model <> p_model then raise exception 'AI model does not match reservation'; end if;
  if jsonb_typeof(p_quality_reviews) <> 'array' or jsonb_array_length(p_quality_reviews) not between 1 and 2
    or p_quality_reviews -> -1 -> 'review' ->> 'verdict' <> 'approve'
  then raise exception 'problem did not pass independent quality review'; end if;
  if jsonb_typeof(p_model_answers) <> 'array' or jsonb_array_length(p_model_answers) < 1 then raise exception 'model answers are required'; end if;

  v_status := case when exists (select 1 from public.qa_test_learners where learner_id = p_learner_id and active) then 'qa' else 'trial' end;
  v_task_key := left(p_task_key, 110) || case when v_status = 'qa' then '-q' else '-i' end || v_suffix;
  v_stored_hash := left(p_prompt_hash, 148) || case when v_status = 'qa' then ':q' else ':i' end || v_suffix;

  insert into public.problem_bank (
    task_key, stage_id, title, prompt, hint, feature_signature, prompt_hash, canonical_prompt_hash,
    design_version, generation_source, provider, model, prompt_version, status,
    input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens, approved_at
  ) values (
    v_task_key, p_stage_id, p_title, p_prompt, p_hint, p_feature_signature, v_stored_hash, p_prompt_hash,
    p_feature_signature -> 'generation' ->> 'designVersion', 'ai', p_provider, p_model,
    p_feature_signature -> 'generation' ->> 'promptVersion', v_status,
    greatest(p_input_tokens, 0) + greatest(coalesce((p_repair_usage ->> 'inputTokens')::integer, 0), 0),
    greatest(p_output_tokens, 0) + greatest(coalesce((p_repair_usage ->> 'outputTokens')::integer, 0), 0),
    greatest(p_cache_creation_input_tokens, 0) + greatest(coalesce((p_repair_usage ->> 'cacheCreationInputTokens')::integer, 0), 0),
    greatest(p_cache_read_input_tokens, 0) + greatest(coalesce((p_repair_usage ->> 'cacheReadInputTokens')::integer, 0), 0), null
  ) returning * into v_problem;

  if v_status = 'trial' then
    insert into public.problem_trials (problem_id, learner_id, custom_topic, model_answers)
    values (v_problem.id, p_learner_id, p_feature_signature ? 'customTopic', p_model_answers);
  end if;

  for v_review in select value from jsonb_array_elements(p_quality_reviews) loop
    insert into public.problem_quality_reviews (
      problem_id, review_attempt, verdict, review, provider, model, prompt_version, provider_request_id,
      input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens
    ) values (
      v_problem.id, (v_review ->> 'attempt')::smallint, v_review -> 'review' ->> 'verdict', v_review -> 'review',
      p_provider, v_review ->> 'model', v_review ->> 'promptVersion', nullif(v_review ->> 'providerRequestId', ''),
      greatest((v_review ->> 'inputTokens')::integer, 0), greatest((v_review ->> 'outputTokens')::integer, 0),
      greatest((v_review ->> 'cacheCreationInputTokens')::integer, 0), greatest((v_review ->> 'cacheReadInputTokens')::integer, 0)
    );
    insert into public.ai_usage_events (
      learner_id, problem_id, operation, provider, model, provider_request_id, status,
      input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens
    ) values (
      p_learner_id, v_problem.id, 'problem_quality_review', p_provider, v_review ->> 'model',
      nullif(v_review ->> 'providerRequestId', ''), 'succeeded', greatest((v_review ->> 'inputTokens')::integer, 0),
      greatest((v_review ->> 'outputTokens')::integer, 0), greatest((v_review ->> 'cacheCreationInputTokens')::integer, 0),
      greatest((v_review ->> 'cacheReadInputTokens')::integer, 0)
    );
  end loop;
  if coalesce(p_repair_usage ->> 'providerRequestId', '') <> '' then
    insert into public.ai_usage_events (learner_id, problem_id, operation, provider, model, provider_request_id, status,
      input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens)
    values (p_learner_id, v_problem.id, 'problem_generation_repair', p_provider, p_model,
      p_repair_usage ->> 'providerRequestId', 'succeeded', greatest((p_repair_usage ->> 'inputTokens')::integer, 0),
      greatest((p_repair_usage ->> 'outputTokens')::integer, 0), greatest((p_repair_usage ->> 'cacheCreationInputTokens')::integer, 0),
      greatest((p_repair_usage ->> 'cacheReadInputTokens')::integer, 0));
  end if;

  perform set_config('request.jwt.claim.sub', p_learner_id::text, true);
  if v_status = 'qa' then
    perform public.issue_problem(v_problem.task_key, v_problem.stage_id, v_problem.title, v_problem.prompt, v_problem.hint,
      v_problem.feature_signature, v_problem.prompt_hash, v_problem.id);
  else
    -- issue_problem only accepts shared approved rows when an id is supplied.
    -- The service-only finalizer issues the verified trial copy first, then binds its id.
    perform public.issue_problem(v_problem.task_key, v_problem.stage_id, v_problem.title, v_problem.prompt, v_problem.hint,
      v_problem.feature_signature, v_problem.prompt_hash, null);
    update public.problem_history set problem_id = v_problem.id
      where learner_id = p_learner_id and task_key = v_problem.task_key;
  end if;

  v_result := jsonb_build_object('id', v_problem.task_key, 'problemId', v_problem.id, 'stageId', v_problem.stage_id,
    'title', v_problem.title, 'prompt', v_problem.prompt, 'hint', v_problem.hint, 'featureSignature', v_problem.feature_signature);
  insert into public.ai_usage_events (learner_id, problem_id, operation, provider, model, provider_request_id, status,
    input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens)
  values (p_learner_id, v_problem.id, 'problem_generation', p_provider, p_model, nullif(p_provider_request_id, ''), 'succeeded',
    greatest(p_input_tokens, 0), greatest(p_output_tokens, 0), greatest(p_cache_creation_input_tokens, 0), greatest(p_cache_read_input_tokens, 0));
  update public.ai_request_jobs set status = 'succeeded', result = v_result, error_code = null
    where learner_id = p_learner_id and operation = 'problem_generation' and request_id = p_request_id;
  return v_result;
end;
$$;
revoke execute on function public.finalize_reviewed_ai_problem_generation(uuid, uuid, text, smallint, text, text, text, jsonb, text, text, text, text, integer, integer, integer, integer, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.finalize_reviewed_ai_problem_generation(uuid, uuid, text, smallint, text, text, text, jsonb, text, text, text, text, integer, integer, integer, integer, jsonb, jsonb, jsonb) to service_role;

alter function public.submit_mock(uuid, text, smallint, text, text, jsonb)
  rename to submit_mock_before_trial_quality;
revoke execute on function public.submit_mock_before_trial_quality(uuid, text, smallint, text, text, jsonb) from public, anon, authenticated;

create function public.submit_mock(
  p_request_id uuid, p_task_key text, p_stage_id smallint, p_task_title text, p_body text, p_feedback jsonb
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_learner_id uuid := auth.uid();
  v_problem_id uuid;
  v_trial public.problem_trials%rowtype;
  v_result jsonb;
  v_existing boolean;
  v_resolution jsonb;
  v_duplicate uuid;
begin
  if v_learner_id is null then raise exception 'authentication required' using errcode = '42501'; end if;
  select exists (select 1 from public.submissions where learner_id = v_learner_id and request_id = p_request_id) into v_existing;
  select problem_id into v_problem_id from public.problem_history
    where learner_id = v_learner_id and task_key = p_task_key and stage_id = p_stage_id for update;
  if v_problem_id is not null then select * into v_trial from public.problem_trials
    where problem_id = v_problem_id and learner_id = v_learner_id for update; end if;

  v_result := public.submit_mock_before_trial_quality(p_request_id, p_task_key, p_stage_id, p_task_title, p_body, p_feedback);
  if v_existing or v_trial.problem_id is null or v_trial.status <> 'active' then return v_result; end if;

  if p_feedback ->> 'decision' = 'pass' then
    update public.problem_trials set passed_at = now() where problem_id = v_problem_id;
    if v_trial.custom_topic then
      update public.problem_trials set status = 'private_verified' where problem_id = v_problem_id;
      update public.problem_bank set status = 'archived' where id = v_problem_id;
      v_resolution := jsonb_build_object('status', 'private_verified', 'revisionCount', v_trial.revision_count, 'maxRevisionCount', 5);
    else
      perform pg_advisory_xact_lock(hashtextextended('approve:' || (select canonical_prompt_hash from public.problem_bank where id = v_problem_id), 0));
      select id into v_duplicate from public.problem_bank where stage_id = p_stage_id and status = 'approved'
        and canonical_prompt_hash = (select canonical_prompt_hash from public.problem_bank where id = v_problem_id) and id <> v_problem_id limit 1;
      if v_duplicate is null then
        update public.problem_bank set status = 'approved', approved_at = now() where id = v_problem_id;
      else
        update public.problem_bank set status = 'archived' where id = v_problem_id;
      end if;
      update public.problem_trials set status = 'approved', promoted_at = now() where problem_id = v_problem_id;
      v_resolution := jsonb_build_object('status', 'approved', 'revisionCount', v_trial.revision_count, 'maxRevisionCount', 5);
    end if;
  else
    update public.problem_trials set revision_count = revision_count + 1 where problem_id = v_problem_id returning * into v_trial;
    if v_trial.revision_count >= v_trial.max_revision_count then
      update public.problem_trials set status = 'disqualified', disqualified_at = now(),
        disqualification_reason = 'five_revision_results' where problem_id = v_problem_id;
      update public.problem_bank set status = 'rejected' where id = v_problem_id;
      update public.problem_history set submitted_at = now() where learner_id = v_learner_id and task_key = p_task_key;
      delete from public.drafts where learner_id = v_learner_id and task_key = p_task_key;
      v_resolution := jsonb_build_object('status', 'disqualified', 'revisionCount', v_trial.revision_count,
        'maxRevisionCount', v_trial.max_revision_count, 'modelAnswers', v_trial.model_answers);
    else
      v_resolution := jsonb_build_object('status', 'active', 'revisionCount', v_trial.revision_count,
        'maxRevisionCount', v_trial.max_revision_count);
    end if;
  end if;
  update public.submissions set trial_resolution = v_resolution
    where id = (v_result ->> 'id')::uuid and learner_id = v_learner_id;
  return v_result || jsonb_build_object('trialOutcome', v_resolution);
end;
$$;
revoke execute on function public.submit_mock(uuid, text, smallint, text, text, jsonb) from public, anon, authenticated;

comment on table public.problem_trials is 'Service-only field-test state. Five valid revise results permanently disqualify a generated problem from sharing.';
comment on table public.problem_quality_reviews is 'Independent pre-publication Claude reviews with prompt/model/token audit data.';
comment on function public.finalize_reviewed_ai_problem_generation(uuid, uuid, text, smallint, text, text, text, jsonb, text, text, text, text, integer, integer, integer, integer, jsonb, jsonb, jsonb) is
  'Stores an independently approved generated problem as a learner-scoped trial (or isolated QA row), records AI usage, and issues it atomically.';
