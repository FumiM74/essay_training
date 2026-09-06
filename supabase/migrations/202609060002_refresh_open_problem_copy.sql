-- Refresh only the currently open copy when the local curriculum version changes.
-- Submitted problems and their historical snapshots are never changed.
do $$
declare
  definition text;
  early_open_check text := '  select task_key into v_active_task_key
  from public.problem_history
  where learner_id = v_learner_id and stage_id = p_stage_id and submitted_at is null
  for update;
  if found then return; end if;
';
  insertion_point text := '  insert into public.problem_history (';
  refreshed_open_check text := '  perform 1 from public.problem_history
  where learner_id = v_learner_id and stage_id = p_stage_id and submitted_at is null
  for update;
  if found then
    update public.problem_history
    set task_title = p_task_title,
        prompt = p_prompt,
        hint = p_hint,
        feature_signature = p_feature_signature,
        prompt_hash = p_prompt_hash,
        design_version = p_feature_signature -> ''generation'' ->> ''designVersion'',
        generation_source = p_feature_signature -> ''generation'' ->> ''source''
    where learner_id = v_learner_id
      and stage_id = p_stage_id
      and submitted_at is null
      and task_key = p_task_key
      and coalesce(feature_signature -> ''generation'' ->> ''promptVersion'', '''')
          <> coalesce(p_feature_signature -> ''generation'' ->> ''promptVersion'', '''');
    return;
  end if;

  insert into public.problem_history (';
begin
  select pg_get_functiondef('public.issue_problem(text,smallint,text,text,text,jsonb,text,uuid)'::regprocedure)
  into definition;
  if definition is null or position(early_open_check in definition) = 0 or position(insertion_point in definition) = 0 then
    raise exception 'Unexpected issue_problem definition';
  end if;
  definition := replace(definition, early_open_check, '');
  definition := replace(definition, insertion_point, refreshed_open_check);
  execute definition;
end;
$$;

comment on function public.issue_problem(text, smallint, text, text, text, jsonb, text, uuid) is
  'Serializes issuance and refreshes only an unsubmitted task when its validated prompt version changes.';
