-- Isolated QA harness for exercising the fixed-problem exhaustion boundary.
-- Only service_role can register, seed, or reset the explicitly registered QA learner.

create table public.qa_test_learners (
  learner_id uuid primary key references public.profiles(id) on delete cascade,
  label text not null check (char_length(label) between 1 and 120),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.qa_test_learners enable row level security;
revoke all on table public.qa_test_learners from public, anon, authenticated;

alter table public.problem_bank drop constraint problem_bank_status_check;
alter table public.problem_bank add constraint problem_bank_status_check
  check (status in ('draft', 'qa', 'approved', 'rejected', 'archived'));

create or replace function public.register_qa_test_learner(p_learner_id uuid, p_label text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'service role required' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles where id = p_learner_id) then raise exception 'QA learner profile was not found'; end if;
  insert into public.qa_test_learners (learner_id, label, active)
  values (p_learner_id, p_label, true)
  on conflict (learner_id) do update set label = excluded.label, active = true, updated_at = now();
end;
$$;

create or replace function public.reset_qa_test_learner(p_learner_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'service role required' using errcode = '42501'; end if;
  if not exists (select 1 from public.qa_test_learners where learner_id = p_learner_id and active) then raise exception 'active QA learner was not found'; end if;

  delete from public.problem_bank
  where status = 'qa' and id in (select problem_id from public.ai_usage_events where learner_id = p_learner_id and problem_id is not null);
  delete from public.ai_usage_events where learner_id = p_learner_id;
  delete from public.ai_request_jobs where learner_id = p_learner_id;
  delete from public.drafts where learner_id = p_learner_id;
  delete from public.submissions where learner_id = p_learner_id;
  delete from public.problem_history where learner_id = p_learner_id;
  delete from public.learner_skill_stats where learner_id = p_learner_id;
  update public.learning_progress
  set current_stage_id = 1, highest_unlocked_stage_id = 1, learning_phase = 'training', phase_passes = 0, phase_attempts = 0,
      frontier_learning_phase = 'training', frontier_phase_passes = 0, frontier_phase_attempts = 0, completed_at = null, updated_at = now()
  where learner_id = p_learner_id;
end;
$$;

create or replace function public.seed_qa_fixed_exhaustion(p_learner_id uuid, p_stage_id smallint, p_problems jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_item jsonb;
  v_submission_id uuid;
  v_feedback jsonb;
  v_skill text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'service role required' using errcode = '42501'; end if;
  if not exists (select 1 from public.qa_test_learners where learner_id = p_learner_id and active) then raise exception 'active QA learner was not found'; end if;
  if p_stage_id not between 1 and 14 or jsonb_typeof(p_problems) <> 'array' or jsonb_array_length(p_problems) <> 10 then raise exception 'invalid QA seed request'; end if;
  perform public.reset_qa_test_learner(p_learner_id);
  update public.learning_progress
  set current_stage_id = p_stage_id, highest_unlocked_stage_id = 14, learning_phase = 'training', phase_passes = 0, phase_attempts = 0,
      frontier_learning_phase = 'training', frontier_phase_passes = 0, frontier_phase_attempts = 0, completed_at = null, updated_at = now()
  where learner_id = p_learner_id;

  for v_item in select value from jsonb_array_elements(p_problems) loop
    if coalesce((v_item ->> 'stageId')::smallint, 0) <> p_stage_id
      or coalesce(char_length(v_item ->> 'taskKey'), 0) not between 1 and 120
      or coalesce(char_length(v_item ->> 'title'), 0) not between 1 and 160
      or coalesce(char_length(v_item ->> 'prompt'), 0) not between 1 and 16000
      or coalesce(char_length(v_item ->> 'hint'), 0) not between 1 and 2000
      or coalesce(char_length(v_item ->> 'promptHash'), 0) not between 8 and 160
      or coalesce(v_item -> 'featureSignature' ->> 'version', '') <> '2'
      or jsonb_typeof(v_item -> 'featureSignature' -> 'skillTargets') <> 'array'
    then raise exception 'invalid QA fixture'; end if;
    v_skill := v_item -> 'featureSignature' -> 'skillTargets' ->> 0;
    if coalesce(char_length(v_skill), 0) = 0 then raise exception 'invalid QA fixture skill'; end if;

    insert into public.problem_history (learner_id, task_key, stage_id, task_title, prompt, hint, feature_signature, prompt_hash, design_version, generation_source, submitted_at, learning_phase)
    values (p_learner_id, v_item ->> 'taskKey', p_stage_id, v_item ->> 'title', v_item ->> 'prompt', v_item ->> 'hint',
      v_item -> 'featureSignature', v_item ->> 'promptHash', v_item -> 'featureSignature' -> 'generation' ->> 'designVersion',
      v_item -> 'featureSignature' -> 'generation' ->> 'source', now() - interval '1 minute', 'training');

    insert into public.submissions (learner_id, task_key, request_id, stage_id, task_title, body, learning_phase, submitted_at)
    values (p_learner_id, v_item ->> 'taskKey', gen_random_uuid(), p_stage_id, v_item ->> 'title', 'QA fixture: fixed problem consumed.', 'training', now() - interval '1 minute')
    returning id into v_submission_id;
    v_feedback := jsonb_build_object('schemaVersion', '1.0', 'languageStatus', 'clean', 'decision', 'pass',
      'priorityFeedback', jsonb_build_array(jsonb_build_object('title', 'QA fixture', 'guidance', 'Fixed problem is marked as consumed for QA only.')),
      'skillResults', jsonb_build_array(jsonb_build_object('skillKey', v_skill, 'outcome', 'achieved', 'severity', 0, 'evidence', 'QA fixture pass.')));
    insert into public.feedback_results (submission_id, learner_id, schema_version, language_status, decision, result)
    values (v_submission_id, p_learner_id, '1.0', 'clean', 'pass', v_feedback);
    insert into public.skill_results (submission_id, learner_id, stage_id, skill_key, outcome, severity, evidence)
    values (v_submission_id, p_learner_id, p_stage_id, v_skill, 'achieved', 0, 'QA fixture pass.');
  end loop;
end;
$$;

do $$
declare v_definition text;
begin
  select pg_get_functiondef('public.issue_problem(text,smallint,text,text,text,jsonb,text,uuid)'::regprocedure) into v_definition;
  if position('where b.id = p_problem_id and b.status = ''approved'' and b.stage_id = p_stage_id' in v_definition) = 0 then raise exception 'Unexpected issue_problem definition'; end if;
  v_definition := replace(v_definition,
    'where b.id = p_problem_id and b.status = ''approved'' and b.stage_id = p_stage_id',
    'where b.id = p_problem_id and (b.status = ''approved'' or (b.status = ''qa'' and exists (select 1 from public.qa_test_learners q where q.learner_id = v_learner_id and q.active))) and b.stage_id = p_stage_id');
  execute v_definition;
end;
$$;

create or replace function public.finalize_ai_problem_generation(
  p_learner_id uuid, p_request_id uuid, p_task_key text, p_stage_id smallint, p_title text, p_prompt text, p_hint text,
  p_feature_signature jsonb, p_prompt_hash text, p_provider text, p_model text, p_provider_request_id text,
  p_input_tokens integer, p_output_tokens integer, p_cache_creation_input_tokens integer default 0, p_cache_read_input_tokens integer default 0
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_job public.ai_request_jobs%rowtype; v_problem public.problem_bank%rowtype; v_result jsonb; v_status text; v_task_key text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'service role required' using errcode = '42501'; end if;
  select * into v_job from public.ai_request_jobs where learner_id = p_learner_id and operation = 'problem_generation' and request_id = p_request_id for update;
  if not found then raise exception 'AI request was not reserved'; end if;
  if v_job.status = 'succeeded' then return v_job.result; end if;
  if v_job.status <> 'pending' then raise exception 'AI request cannot be finalized'; end if;
  if v_job.model <> p_model then raise exception 'AI model does not match reservation'; end if;
  v_status := case when exists (select 1 from public.qa_test_learners where learner_id = p_learner_id and active) then 'qa' else 'approved' end;
  -- Keep QA-generated problems out of the shared task-key namespace.  The suffix is
  -- accepted by the existing generated-task parser and prevents a test run from
  -- blocking a normal learner who later reaches the same generated candidate.
  v_task_key := case when v_status = 'qa'
    then left(p_task_key, 109) || '-t' || substring(replace(p_learner_id::text, '-', '') from 1 for 8)
    else p_task_key end;
  insert into public.problem_bank (task_key, stage_id, title, prompt, hint, feature_signature, prompt_hash, design_version, generation_source, provider, model, prompt_version, status, input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens, approved_at)
  values (v_task_key, p_stage_id, p_title, p_prompt, p_hint, p_feature_signature, p_prompt_hash, p_feature_signature -> 'generation' ->> 'designVersion', 'ai', p_provider, p_model, p_feature_signature -> 'generation' ->> 'promptVersion', v_status, greatest(p_input_tokens,0), greatest(p_output_tokens,0), greatest(p_cache_creation_input_tokens,0), greatest(p_cache_read_input_tokens,0), case when v_status = 'approved' then now() else null end) on conflict do nothing;
  select * into v_problem from public.problem_bank where status = v_status and stage_id = p_stage_id and (task_key = v_task_key or prompt_hash = p_prompt_hash) order by (task_key = v_task_key) desc, created_at asc limit 1;
  if not found then raise exception 'validated problem could not be published'; end if;
  perform set_config('request.jwt.claim.sub', p_learner_id::text, true);
  perform public.issue_problem(v_problem.task_key, v_problem.stage_id, v_problem.title, v_problem.prompt, v_problem.hint, v_problem.feature_signature, v_problem.prompt_hash, v_problem.id);
  v_result := jsonb_build_object('id', v_problem.task_key, 'problemId', v_problem.id, 'stageId', v_problem.stage_id, 'title', v_problem.title, 'prompt', v_problem.prompt, 'hint', v_problem.hint, 'featureSignature', v_problem.feature_signature);
  insert into public.ai_usage_events (learner_id, problem_id, operation, provider, model, provider_request_id, status, input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens)
  values (p_learner_id, v_problem.id, 'problem_generation', p_provider, p_model, nullif(p_provider_request_id,''), 'succeeded', greatest(p_input_tokens,0), greatest(p_output_tokens,0), greatest(p_cache_creation_input_tokens,0), greatest(p_cache_read_input_tokens,0));
  update public.ai_request_jobs set status = 'succeeded', result = v_result, error_code = null where learner_id = p_learner_id and operation = 'problem_generation' and request_id = p_request_id;
  return v_result;
end;
$$;

revoke execute on function public.register_qa_test_learner(uuid,text), public.reset_qa_test_learner(uuid), public.seed_qa_fixed_exhaustion(uuid,smallint,jsonb) from public, anon, authenticated;
grant execute on function public.register_qa_test_learner(uuid,text), public.reset_qa_test_learner(uuid), public.seed_qa_fixed_exhaustion(uuid,smallint,jsonb) to service_role;
