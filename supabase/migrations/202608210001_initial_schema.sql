-- Initial schema. Learner-owned data is isolated with PostgreSQL RLS.
create extension if not exists "pgcrypto";

create type public.app_role as enum ('learner', 'admin');
create type public.assignment_status as enum ('active', 'completed', 'archived');
create type public.entitlement_status as enum ('active', 'expired', 'revoked');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text check (char_length(display_name) between 1 and 80),
  role public.app_role not null default 'learner',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.rubric_versions (
  id uuid primary key default gen_random_uuid(), version text not null unique,
  content jsonb not null, created_at timestamptz not null default now(), published_at timestamptz
);
create table public.instruction_versions (
  id uuid primary key default gen_random_uuid(), version text not null unique,
  content jsonb not null, created_at timestamptz not null default now(), published_at timestamptz
);
create table public.tasks (
  id uuid primary key default gen_random_uuid(), stage_id smallint not null check (stage_id between 0 and 13),
  title text not null check (char_length(title) between 1 and 160), prompt text not null check (char_length(prompt) between 1 and 12000),
  rubric_version_id uuid not null references public.rubric_versions(id),
  instruction_version_id uuid not null references public.instruction_versions(id),
  created_at timestamptz not null default now(), archived_at timestamptz
);
create table public.task_assignments (
  id uuid primary key default gen_random_uuid(), learner_id uuid not null references public.profiles(id) on delete cascade,
  task_id uuid not null references public.tasks(id), stage_id smallint not null check (stage_id between 0 and 13),
  status public.assignment_status not null default 'active', assigned_at timestamptz not null default now(), completed_at timestamptz,
  unique (learner_id, task_id)
);
create unique index one_active_assignment_per_learner on public.task_assignments (learner_id) where status = 'active';
create table public.drafts (
  id uuid primary key default gen_random_uuid(), learner_id uuid not null references public.profiles(id) on delete cascade,
  task_key text not null check (char_length(task_key) between 1 and 120),
  body text not null default '' check (char_length(body) <= 20000), updated_at timestamptz not null default now(),
  unique (learner_id, task_key)
);
create table public.submissions (
  id uuid primary key default gen_random_uuid(), learner_id uuid not null references public.profiles(id) on delete cascade,
  task_key text not null check (char_length(task_key) between 1 and 120), request_id uuid not null,
  stage_id smallint not null check (stage_id between 1 and 13),
  task_title text not null check (char_length(task_title) between 1 and 160),
  body text not null check (char_length(body) between 1 and 20000),
  rubric_version_id uuid references public.rubric_versions(id), instruction_version_id uuid references public.instruction_versions(id),
  submitted_at timestamptz not null default now(),
  unique (learner_id, request_id),
  unique (learner_id, task_key)
);
create index submissions_owner_submitted_at on public.submissions (learner_id, submitted_at desc);
create table public.feedback_results (
  id uuid primary key default gen_random_uuid(), submission_id uuid not null unique references public.submissions(id) on delete cascade,
  learner_id uuid not null references public.profiles(id) on delete cascade, schema_version text not null,
  language_status text not null check (language_status in ('clean', 'minor_issue', 'revision_required')),
  decision text not null check (decision in ('pass', 'revise')), result jsonb not null, created_at timestamptz not null default now(),
  check ((language_status <> 'revision_required') or decision = 'revise')
);
create table public.skill_results (
  submission_id uuid not null references public.submissions(id) on delete cascade,
  learner_id uuid not null references public.profiles(id) on delete cascade,
  stage_id smallint not null check (stage_id between 1 and 13),
  skill_key text not null check (char_length(skill_key) between 1 and 80 and skill_key ~ '^[a-z0-9_]+$'),
  outcome text not null check (outcome in ('achieved', 'partial', 'missed')),
  severity smallint not null check (severity between 0 and 2),
  evidence text not null check (char_length(evidence) between 1 and 500),
  created_at timestamptz not null default now(),
  primary key (submission_id, skill_key)
);
create index skill_results_owner_stage_created on public.skill_results (learner_id, stage_id, created_at desc);
create table public.learning_progress (
  learner_id uuid primary key references public.profiles(id) on delete cascade,
  current_stage_id smallint not null default 1 check (current_stage_id between 1 and 13),
  highest_unlocked_stage_id smallint not null default 1 check (highest_unlocked_stage_id between current_stage_id and 13),
  consecutive_passes smallint not null default 0 check (consecutive_passes >= 0),
  required_consecutive_passes smallint not null default 3 check (required_consecutive_passes between 1 and 10),
  individual_instruction text check (char_length(individual_instruction) <= 4000),
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);
create table public.learner_skill_stats (
  learner_id uuid not null references public.profiles(id) on delete cascade,
  stage_id smallint not null check (stage_id between 1 and 13),
  skill_key text not null check (char_length(skill_key) between 1 and 80 and skill_key ~ '^[a-z0-9_]+$'),
  attempts integer not null default 0 check (attempts >= 0),
  achieved_count integer not null default 0 check (achieved_count >= 0),
  partial_count integer not null default 0 check (partial_count >= 0),
  missed_count integer not null default 0 check (missed_count >= 0),
  mastery_score numeric(5,4) not null default 0.5000 check (mastery_score between 0 and 1),
  last_outcome text not null check (last_outcome in ('achieved', 'partial', 'missed')),
  last_practiced_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (learner_id, stage_id, skill_key),
  check (attempts = achieved_count + partial_count + missed_count)
);
create index learner_skill_stats_weakest on public.learner_skill_stats (learner_id, stage_id, mastery_score, attempts);
create table public.problem_bank (
  id uuid primary key default gen_random_uuid(),
  task_key text not null unique check (char_length(task_key) between 1 and 120),
  stage_id smallint not null check (stage_id between 1 and 13),
  title text not null check (char_length(title) between 1 and 160),
  prompt text not null check (char_length(prompt) between 1 and 16000),
  hint text not null check (char_length(hint) between 1 and 2000),
  feature_signature jsonb not null check (
    char_length(feature_signature::text) <= 12000
    and (feature_signature ->> 'version') is not distinct from '2'
    and jsonb_typeof(feature_signature -> 'skillTargets') is not distinct from 'array'
    and jsonb_typeof(feature_signature -> 'generation') is not distinct from 'object'
  ),
  prompt_hash text not null check (char_length(prompt_hash) between 8 and 160),
  design_version text not null check (char_length(design_version) between 1 and 80),
  generation_source text not null check (generation_source in ('curated', 'local_variant', 'ai')),
  provider text check (char_length(provider) <= 80),
  model text check (char_length(model) <= 120),
  prompt_version text not null check (char_length(prompt_version) between 1 and 120),
  status text not null default 'draft' check (status in ('draft', 'approved', 'rejected', 'archived')),
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  cache_creation_input_tokens integer not null default 0 check (cache_creation_input_tokens >= 0),
  cache_read_input_tokens integer not null default 0 check (cache_read_input_tokens >= 0),
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  unique (stage_id, prompt_hash)
);
create index problem_bank_available on public.problem_bank (stage_id, status, created_at desc);
create table public.problem_history (
  learner_id uuid not null references public.profiles(id) on delete cascade,
  task_key text not null check (char_length(task_key) between 1 and 120),
  problem_id uuid references public.problem_bank(id),
  stage_id smallint not null check (stage_id between 1 and 13),
  task_title text not null check (char_length(task_title) between 1 and 160),
  prompt text not null check (char_length(prompt) between 1 and 16000),
  hint text not null check (char_length(hint) between 1 and 2000),
  feature_signature jsonb not null,
  prompt_hash text not null check (char_length(prompt_hash) between 8 and 160),
  design_version text not null check (char_length(design_version) between 1 and 80),
  generation_source text not null check (generation_source in ('curated', 'local_variant', 'ai')),
  issued_at timestamptz not null default now(),
  submitted_at timestamptz,
  primary key (learner_id, task_key),
  check (char_length(feature_signature::text) <= 12000),
  check ((feature_signature ->> 'version') is not distinct from '2'),
  check (jsonb_typeof(feature_signature -> 'skillTargets') is not distinct from 'array')
);
create index problem_history_owner_stage_issued on public.problem_history (learner_id, stage_id, issued_at desc);
create unique index problem_history_owner_prompt_hash on public.problem_history (learner_id, prompt_hash);
create unique index one_unsubmitted_problem_per_stage on public.problem_history (learner_id, stage_id) where submitted_at is null;
create table public.ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  learner_id uuid references public.profiles(id) on delete set null,
  problem_id uuid references public.problem_bank(id) on delete set null,
  submission_id uuid references public.submissions(id) on delete set null,
  operation text not null check (operation in ('problem_generation', 'feedback')),
  provider text not null check (char_length(provider) between 1 and 80),
  model text not null check (char_length(model) between 1 and 120),
  provider_request_id text check (char_length(provider_request_id) <= 200),
  status text not null check (status in ('succeeded', 'failed', 'rejected_budget', 'fallback')),
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  cache_creation_input_tokens integer not null default 0 check (cache_creation_input_tokens >= 0),
  cache_read_input_tokens integer not null default 0 check (cache_read_input_tokens >= 0),
  estimated_cost_microusd bigint check (estimated_cost_microusd is null or estimated_cost_microusd >= 0),
  pricing_version text check (char_length(pricing_version) <= 80),
  created_at timestamptz not null default now()
);
create index ai_usage_events_budget_lookup on public.ai_usage_events (learner_id, operation, created_at desc);
create unique index ai_usage_events_provider_request on public.ai_usage_events (provider, provider_request_id) where provider_request_id is not null;
create table public.ai_budget_policies (
  operation text primary key check (operation in ('problem_generation', 'feedback')),
  enabled boolean not null default true,
  -- This must remain provisional until the service owner approves production limits
  -- during the final release test. The seed values are development safety guards only.
  review_status text not null default 'provisional' check (review_status in ('provisional', 'approved')),
  max_input_tokens_per_request integer not null check (max_input_tokens_per_request > 0),
  max_output_tokens_per_request integer not null check (max_output_tokens_per_request > 0),
  daily_requests_per_learner integer not null check (daily_requests_per_learner > 0),
  daily_input_tokens_per_learner integer not null check (daily_input_tokens_per_learner > 0),
  daily_output_tokens_per_learner integer not null check (daily_output_tokens_per_learner > 0),
  updated_at timestamptz not null default now()
);
comment on table public.ai_budget_policies is
  'AI quality/cost limits. Seed values are provisional development guards; ask the service owner and set review_status=approved during the final release test.';
insert into public.ai_budget_policies (
  operation, max_input_tokens_per_request, max_output_tokens_per_request,
  daily_requests_per_learner, daily_input_tokens_per_learner, daily_output_tokens_per_learner
) values
  ('problem_generation', 1800, 700, 3, 5400, 2100),
  ('feedback', 6000, 1800, 20, 120000, 36000);
create table public.entitlements (
  id uuid primary key default gen_random_uuid(), learner_id uuid not null references public.profiles(id) on delete cascade,
  status public.entitlement_status not null default 'active', source text not null check (source in ('free_trial', 'subscription', 'one_time')),
  starts_at timestamptz not null default now(), expires_at timestamptz, submission_limit integer check (submission_limit is null or submission_limit >= 0),
  used_submissions integer not null default 0 check (used_submissions >= 0), provider text, provider_reference text,
  created_at timestamptz not null default now(), unique (provider, provider_reference)
);
create table public.payment_events (
  id uuid primary key default gen_random_uuid(), provider text not null, provider_event_id text not null,
  payload jsonb not null, processed_at timestamptz, created_at timestamptz not null default now(), unique (provider, provider_event_id)
);

create or replace function public.set_updated_at() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$ begin new.updated_at = now(); return new; end; $$;
create trigger profiles_set_updated_at before update on public.profiles for each row execute procedure public.set_updated_at();
create trigger drafts_set_updated_at before update on public.drafts for each row execute procedure public.set_updated_at();
create trigger progress_set_updated_at before update on public.learning_progress for each row execute procedure public.set_updated_at();
create trigger learner_skill_stats_set_updated_at before update on public.learner_skill_stats for each row execute procedure public.set_updated_at();
create trigger ai_budget_policies_set_updated_at before update on public.ai_budget_policies for each row execute procedure public.set_updated_at();
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = public as $$ select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'); $$;
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$ begin insert into public.profiles (id, display_name) values (new.id, coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), '学習者')); insert into public.learning_progress (learner_id) values (new.id); return new; end; $$;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

-- Also initialize users that existed before this schema was applied.
insert into public.profiles (id, display_name)
select id, coalesce(nullif(raw_user_meta_data ->> 'display_name', ''), '学習者')
from auth.users
on conflict (id) do nothing;
insert into public.learning_progress (learner_id)
select id from public.profiles
on conflict (learner_id) do nothing;

create or replace function public.issue_problem(
  p_task_key text,
  p_stage_id smallint,
  p_task_title text,
  p_prompt text,
  p_hint text,
  p_feature_signature jsonb,
  p_prompt_hash text,
  p_problem_id uuid default null
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_learner_id uuid := auth.uid();
  v_current_stage smallint;
begin
  if v_learner_id is null then raise exception 'authentication required' using errcode = '42501'; end if;
  select current_stage_id into v_current_stage from public.learning_progress where learner_id = v_learner_id for update;
  if not found then raise exception 'learning progress is not initialized'; end if;
  if p_stage_id <> v_current_stage then raise exception 'task is not in the current stage'; end if;
  perform 1 from public.problem_history
  where learner_id = v_learner_id and stage_id = p_stage_id and submitted_at is null
  for update;
  if found then return; end if;
  if p_task_key is null or char_length(p_task_key) not between 1 and 120 then raise exception 'invalid task key'; end if;
  if p_task_title is null or char_length(p_task_title) not between 1 and 160 then raise exception 'invalid task title'; end if;
  if p_prompt is null or char_length(p_prompt) not between 1 and 16000 then raise exception 'invalid prompt'; end if;
  if p_hint is null or char_length(p_hint) not between 1 and 2000 then raise exception 'invalid hint'; end if;
  if p_feature_signature is null or char_length(p_feature_signature::text) > 12000 then raise exception 'feature signature is too large'; end if;
  if (p_feature_signature ->> 'version') is distinct from '2'
    or coalesce(char_length(p_feature_signature ->> 'fingerprint'), 0) = 0
    or jsonb_typeof(p_feature_signature -> 'seed') is distinct from 'number'
    or coalesce(p_feature_signature ->> 'topicDomain', '') not in ('education', 'technology', 'community', 'public_policy', 'environment', 'ethics')
    or coalesce(char_length(p_feature_signature ->> 'topicKey'), 0) = 0
    or coalesce(char_length(p_feature_signature ->> 'promptFamily'), 0) = 0
    or jsonb_typeof(p_feature_signature -> 'skillTargets') is distinct from 'array'
    or jsonb_array_length(p_feature_signature -> 'skillTargets') not between 1 and 8
    or coalesce(p_feature_signature ->> 'selectionReason', '') not in ('weakness', 'core', 'exploration')
    or coalesce(char_length(p_feature_signature ->> 'surfacePattern'), 0) = 0
    or jsonb_typeof(p_feature_signature -> 'generation') is distinct from 'object'
    or coalesce(p_feature_signature -> 'generation' ->> 'source', '') not in ('curated', 'local_variant', 'ai')
    or coalesce(char_length(p_feature_signature -> 'generation' ->> 'designVersion'), 0) = 0
    or coalesce(char_length(p_feature_signature -> 'generation' ->> 'promptVersion'), 0) = 0
  then raise exception 'invalid problem feature signature'; end if;
  if exists (
    select 1 from jsonb_array_elements_text(p_feature_signature -> 'skillTargets') as skill(value)
    where value not in (
      'sentence_completion', 'subject_predicate', 'modifier_clarity', 'particle_accuracy',
      'clear_claim', 'stance_specificity', 'claim_reason_link', 'causal_depth',
      'reason_specificity', 'example_relevance', 'evidence_link', 'paragraph_coherence',
      'conclusion_alignment', 'source_structure', 'source_evidence', 'summary_fidelity',
      'opinion_exclusion', 'source_integration', 'claim_evidence', 'counterargument_fairness',
      'rebuttal_reasoning', 'essay_structure', 'coherence', 'prompt_alignment',
      'logical_consistency', 'multi_perspective'
    )
  ) then raise exception 'invalid skill target'; end if;
  if p_prompt_hash is null or char_length(p_prompt_hash) not between 8 and 160 then raise exception 'invalid prompt hash'; end if;
  if p_problem_id is not null and not exists (
    select 1 from public.problem_bank b
    where b.id = p_problem_id and b.status = 'approved' and b.stage_id = p_stage_id
      and b.task_key = p_task_key and b.prompt_hash = p_prompt_hash
  ) then raise exception 'problem bank item is not approved or does not match'; end if;

  insert into public.problem_history (
    learner_id, task_key, problem_id, stage_id, task_title, prompt, hint, feature_signature,
    prompt_hash, design_version, generation_source
  )
  values (
    v_learner_id, p_task_key, p_problem_id, p_stage_id, p_task_title, p_prompt, p_hint, p_feature_signature,
    p_prompt_hash, p_feature_signature -> 'generation' ->> 'designVersion', p_feature_signature -> 'generation' ->> 'source'
  )
  on conflict (learner_id, task_key) do nothing;
end;
$$;

create or replace function public.select_learning_stage(p_stage_id smallint) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_learner_id uuid := auth.uid();
  v_progress public.learning_progress%rowtype;
begin
  if v_learner_id is null then raise exception 'authentication required' using errcode = '42501'; end if;
  select * into v_progress from public.learning_progress where learner_id = v_learner_id for update;
  if not found then raise exception 'learning progress is not initialized'; end if;
  if p_stage_id is null or p_stage_id < 1 or p_stage_id > v_progress.highest_unlocked_stage_id then raise exception 'stage is not unlocked'; end if;
  update public.learning_progress set current_stage_id = p_stage_id, consecutive_passes = 0 where learner_id = v_learner_id
  returning * into v_progress;
  return jsonb_build_object(
    'currentStageId', v_progress.current_stage_id,
    'highestUnlockedStageId', v_progress.highest_unlocked_stage_id,
    'consecutivePasses', v_progress.consecutive_passes,
    'requiredConsecutivePasses', v_progress.required_consecutive_passes,
    'courseCompletedAt', v_progress.completed_at
  );
end;
$$;

create or replace function public.submit_mock(
  p_request_id uuid,
  p_task_key text,
  p_stage_id smallint,
  p_task_title text,
  p_body text,
  p_feedback jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_learner_id uuid := auth.uid();
  v_submission_id uuid;
  v_created boolean := false;
  v_current_stage smallint;
  v_consecutive_passes smallint;
  v_required_passes smallint;
  v_highest_unlocked smallint;
  v_language_status text := p_feedback ->> 'languageStatus';
  v_decision text := p_feedback ->> 'decision';
  v_skill jsonb;
  v_skill_score numeric(5,4);
begin
  if v_learner_id is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if p_request_id is null then raise exception 'request id is required'; end if;
  if p_task_key is null or char_length(p_task_key) not between 1 and 120 then raise exception 'invalid task key'; end if;
  if p_stage_id not between 1 and 13 then raise exception 'invalid stage'; end if;
  if p_task_title is null or char_length(p_task_title) not between 1 and 160 then raise exception 'invalid task title'; end if;
  if p_body is null or char_length(p_body) not between 1 and 20000 then raise exception 'invalid body'; end if;
  if coalesce(char_length(p_feedback ->> 'schemaVersion'), 0) = 0 then raise exception 'invalid feedback schema'; end if;
  if v_language_status not in ('clean', 'minor_issue', 'revision_required') then raise exception 'invalid language status'; end if;
  if v_decision not in ('pass', 'revise') then raise exception 'invalid decision'; end if;
  if jsonb_typeof(p_feedback -> 'priorityFeedback') is distinct from 'array' then raise exception 'invalid priority feedback'; end if;
  if exists (
    select 1
    from jsonb_array_elements(p_feedback -> 'priorityFeedback') as item
    where jsonb_typeof(item) <> 'object'
       or coalesce(char_length(item ->> 'title'), 0) = 0
       or coalesce(char_length(item ->> 'guidance'), 0) = 0
  ) then raise exception 'invalid priority feedback item'; end if;
  if jsonb_typeof(p_feedback -> 'skillResults') is distinct from 'array'
    or jsonb_array_length(p_feedback -> 'skillResults') not between 1 and 8
  then raise exception 'invalid skill results'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_feedback -> 'skillResults') as item
    where jsonb_typeof(item) <> 'object'
      or coalesce(item ->> 'skillKey', '') !~ '^[a-z0-9_]{1,80}$'
      or (item ->> 'outcome') not in ('achieved', 'partial', 'missed')
      or jsonb_typeof(item -> 'severity') is distinct from 'number'
      or (item ->> 'severity')::integer not between 0 and 2
      or coalesce(char_length(item ->> 'evidence'), 0) not between 1 and 500
  ) then raise exception 'invalid skill result item'; end if;
  if (
    select count(*) <> count(distinct item ->> 'skillKey')
    from jsonb_array_elements(p_feedback -> 'skillResults') as item
  ) then raise exception 'duplicate skill result'; end if;
  if v_language_status = 'revision_required' and v_decision <> 'revise' then raise exception 'inconsistent feedback'; end if;

	select current_stage_id, highest_unlocked_stage_id, consecutive_passes, required_consecutive_passes
	into v_current_stage, v_highest_unlocked, v_consecutive_passes, v_required_passes
	from public.learning_progress
	where learner_id = v_learner_id
	for update;

	if not found then raise exception 'learning progress is not initialized'; end if;

	select id into v_submission_id
	from public.submissions
	where learner_id = v_learner_id
	  and (request_id = p_request_id or task_key = p_task_key)
	order by (request_id = p_request_id) desc
	limit 1;

	if v_submission_id is null then
	  if p_stage_id <> v_current_stage then raise exception 'task is not in the current stage'; end if;
	  if not exists (
	    select 1 from public.problem_history
	    where learner_id = v_learner_id and task_key = p_task_key and stage_id = p_stage_id and submitted_at is null
	  ) then raise exception 'task was not issued or was already submitted'; end if;
	  if exists (
	    select 1
	    from jsonb_array_elements(p_feedback -> 'skillResults') as result
	    where not exists (
	      select 1
	      from public.problem_history h
	      cross join lateral jsonb_array_elements_text(h.feature_signature -> 'skillTargets') as target(skill_key)
	      where h.learner_id = v_learner_id and h.task_key = p_task_key and target.skill_key = result ->> 'skillKey'
	    )
	  ) then raise exception 'skill result is not a target of the issued problem'; end if;

	  insert into public.submissions (learner_id, task_key, request_id, stage_id, task_title, body)
	  values (v_learner_id, p_task_key, p_request_id, p_stage_id, p_task_title, p_body)
	  returning id into v_submission_id;
	  v_created := true;
	end if;

	if v_created then
    insert into public.feedback_results (submission_id, learner_id, schema_version, language_status, decision, result)
    values (v_submission_id, v_learner_id, p_feedback ->> 'schemaVersion', v_language_status, v_decision, p_feedback);

    for v_skill in select value from jsonb_array_elements(p_feedback -> 'skillResults')
    loop
      v_skill_score := case v_skill ->> 'outcome' when 'achieved' then 1.0000 when 'partial' then 0.5000 else 0.0000 end;
      insert into public.skill_results (
        submission_id, learner_id, stage_id, skill_key, outcome, severity, evidence
      ) values (
        v_submission_id, v_learner_id, p_stage_id, v_skill ->> 'skillKey', v_skill ->> 'outcome',
        (v_skill ->> 'severity')::smallint, v_skill ->> 'evidence'
      );
      insert into public.learner_skill_stats (
        learner_id, stage_id, skill_key, attempts, achieved_count, partial_count, missed_count,
        mastery_score, last_outcome, last_practiced_at
      ) values (
        v_learner_id, p_stage_id, v_skill ->> 'skillKey', 1,
        case when v_skill ->> 'outcome' = 'achieved' then 1 else 0 end,
        case when v_skill ->> 'outcome' = 'partial' then 1 else 0 end,
        case when v_skill ->> 'outcome' = 'missed' then 1 else 0 end,
        round((0.5000 * 0.6500 + v_skill_score * 0.3500)::numeric, 4),
        v_skill ->> 'outcome', now()
      )
      on conflict (learner_id, stage_id, skill_key) do update set
        attempts = public.learner_skill_stats.attempts + 1,
        achieved_count = public.learner_skill_stats.achieved_count + case when excluded.last_outcome = 'achieved' then 1 else 0 end,
        partial_count = public.learner_skill_stats.partial_count + case when excluded.last_outcome = 'partial' then 1 else 0 end,
        missed_count = public.learner_skill_stats.missed_count + case when excluded.last_outcome = 'missed' then 1 else 0 end,
        mastery_score = round((public.learner_skill_stats.mastery_score * 0.6500 + v_skill_score * 0.3500)::numeric, 4),
        last_outcome = excluded.last_outcome,
        last_practiced_at = excluded.last_practiced_at;
    end loop;

    delete from public.drafts where learner_id = v_learner_id and task_key = p_task_key;
    update public.problem_history set submitted_at = now() where learner_id = v_learner_id and task_key = p_task_key;

    if v_decision = 'revise' then
      update public.learning_progress set consecutive_passes = 0 where learner_id = v_learner_id;
    elsif v_consecutive_passes + 1 >= v_required_passes and v_current_stage = 13 then
      update public.learning_progress
      set highest_unlocked_stage_id = 13, consecutive_passes = v_required_passes, completed_at = coalesce(completed_at, now())
      where learner_id = v_learner_id;
    elsif v_consecutive_passes + 1 >= v_required_passes then
      update public.learning_progress
      set current_stage_id = v_current_stage + 1,
          highest_unlocked_stage_id = greatest(v_highest_unlocked, v_current_stage + 1),
          consecutive_passes = 0
      where learner_id = v_learner_id;
    else
      update public.learning_progress set consecutive_passes = v_consecutive_passes + 1 where learner_id = v_learner_id;
    end if;
  end if;

  return (
    select jsonb_build_object(
      'id', s.id,
      'taskKey', s.task_key,
      'stageId', s.stage_id,
      'taskTitle', s.task_title,
      'body', s.body,
      'submittedAt', s.submitted_at,
      'feedback', f.result
    )
    from public.submissions s
    join public.feedback_results f on f.submission_id = s.id
    where s.id = v_submission_id and s.learner_id = v_learner_id
  );
end;
$$;

alter table public.profiles enable row level security; alter table public.rubric_versions enable row level security; alter table public.instruction_versions enable row level security; alter table public.tasks enable row level security; alter table public.task_assignments enable row level security; alter table public.drafts enable row level security; alter table public.submissions enable row level security; alter table public.feedback_results enable row level security; alter table public.skill_results enable row level security; alter table public.learning_progress enable row level security; alter table public.learner_skill_stats enable row level security; alter table public.problem_bank enable row level security; alter table public.problem_history enable row level security; alter table public.ai_usage_events enable row level security; alter table public.ai_budget_policies enable row level security; alter table public.entitlements enable row level security; alter table public.payment_events enable row level security;
create policy "profile owns profile" on public.profiles for select using (id = auth.uid() or public.is_admin());
create policy "profile updates profile" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());
create policy "admin manages profiles" on public.profiles for all using (public.is_admin()) with check (public.is_admin());
create policy "learner reads assigned task" on public.tasks for select using (public.is_admin() or exists (select 1 from public.task_assignments a where a.task_id = tasks.id and a.learner_id = auth.uid()));
create policy "admin manages tasks" on public.tasks for all using (public.is_admin()) with check (public.is_admin());
create policy "learner reads assignments" on public.task_assignments for select using (learner_id = auth.uid() or public.is_admin());
create policy "admin manages assignments" on public.task_assignments for all using (public.is_admin()) with check (public.is_admin());
create policy "learner manages drafts" on public.drafts for all using (learner_id = auth.uid() or public.is_admin()) with check (learner_id = auth.uid() or public.is_admin());
create policy "learner reads submissions" on public.submissions for select using (learner_id = auth.uid() or public.is_admin());
create policy "learner reads feedback" on public.feedback_results for select using (learner_id = auth.uid() or public.is_admin());
create policy "learner reads skill results" on public.skill_results for select using (learner_id = auth.uid() or public.is_admin());
create policy "learner reads progress" on public.learning_progress for select using (learner_id = auth.uid() or public.is_admin());
create policy "learner updates progress settings" on public.learning_progress for update using (learner_id = auth.uid()) with check (learner_id = auth.uid());
create policy "learner reads skill stats" on public.learner_skill_stats for select using (learner_id = auth.uid() or public.is_admin());
create policy "learner reads approved problem bank" on public.problem_bank for select using (status = 'approved' or public.is_admin());
create policy "admin manages problem bank" on public.problem_bank for all using (public.is_admin()) with check (public.is_admin());
create policy "learner reads problem history" on public.problem_history for select using (learner_id = auth.uid() or public.is_admin());
create policy "learner reads own ai usage" on public.ai_usage_events for select using (learner_id = auth.uid() or public.is_admin());
create policy "admin reads ai budget policies" on public.ai_budget_policies for select using (public.is_admin());
create policy "admin manages ai budget policies" on public.ai_budget_policies for all using (public.is_admin()) with check (public.is_admin());
create policy "learner reads entitlements" on public.entitlements for select using (learner_id = auth.uid() or public.is_admin());
create policy "admin reads payment events" on public.payment_events for select using (public.is_admin());
create policy "learner reads published rubrics" on public.rubric_versions for select using ((auth.uid() is not null and published_at is not null) or public.is_admin());
create policy "admin manages rubrics" on public.rubric_versions for all using (public.is_admin()) with check (public.is_admin());
create policy "learner reads published instructions" on public.instruction_versions for select using ((auth.uid() is not null and published_at is not null) or public.is_admin());
create policy "admin manages instructions" on public.instruction_versions for all using (public.is_admin()) with check (public.is_admin());

-- Automatically exposing new tables is disabled. Grant only the operations used by the browser app.
grant usage on schema public to authenticated;
revoke all on table public.profiles, public.rubric_versions, public.instruction_versions, public.tasks,
  public.task_assignments, public.drafts, public.submissions, public.feedback_results, public.skill_results,
  public.learning_progress, public.learner_skill_stats, public.problem_bank, public.problem_history,
  public.ai_usage_events, public.ai_budget_policies, public.entitlements, public.payment_events
from anon, authenticated;
grant select on table public.profiles to authenticated;
grant update (display_name) on table public.profiles to authenticated;
grant select, insert, update, delete on table public.drafts to authenticated;
grant select on table public.submissions, public.feedback_results, public.skill_results, public.learning_progress,
  public.learner_skill_stats, public.problem_bank, public.problem_history, public.ai_usage_events, public.entitlements
to authenticated;
grant update (required_consecutive_passes) on table public.learning_progress to authenticated;

revoke execute on function public.submit_mock(uuid, text, smallint, text, text, jsonb) from public, anon;
grant execute on function public.submit_mock(uuid, text, smallint, text, text, jsonb) to authenticated;
revoke execute on function public.issue_problem(text, smallint, text, text, text, jsonb, text, uuid) from public, anon;
grant execute on function public.issue_problem(text, smallint, text, text, text, jsonb, text, uuid) to authenticated;
revoke execute on function public.select_learning_stage(smallint) from public, anon;
grant execute on function public.select_learning_stage(smallint) to authenticated;

-- Trigger-only helpers must not be callable through the Data API.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- Supabase Dashboard's automatic-RLS option may create this helper outside migrations.
-- Restrict it when present without making clean local installs depend on it.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke execute on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end;
$$;

-- Production writes to submissions and feedback_results move to the feedback Edge Function.
