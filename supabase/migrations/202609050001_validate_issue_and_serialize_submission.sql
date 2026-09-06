-- Keep original migrations immutable. Preserve all learner records and grants.
do $$
declare
  definition text;
  function_name text;
  needle text := '  select exists (
    select 1 from public.submissions';
begin
  select pg_get_functiondef('public.issue_problem(text,smallint,text,text,text,jsonb,text,uuid)'::regprocedure) into definition;
  if position('on conflict do nothing;' in definition) = 0 then
    raise exception 'Unexpected issue_problem definition';
  end if;
  definition := replace(definition, 'on conflict do nothing;', 'on conflict do nothing;
  if not exists (
    select 1 from public.problem_history
    where learner_id = v_learner_id and stage_id = p_stage_id and submitted_at is null
  ) then
    raise exception ''problem was already used; choose a new problem'' using errcode = ''23505'';
  end if;');
  execute definition;

  -- Serialize before testing request_id. Otherwise a waiting retry can apply
  -- the promotion wrapper a second time after the first request commits.
  foreach function_name in array array['submit_mock', 'submit_mock_before_stage_one_sets'] loop
    select pg_get_functiondef(to_regprocedure('public.' || function_name || '(uuid,text,smallint,text,text,jsonb)')) into definition;
    if definition is null or position(needle in definition) = 0 then
      raise exception 'Unexpected submission wrapper: %', function_name;
    end if;
    definition := replace(definition, needle, '  perform 1 from public.learning_progress where learner_id = v_learner_id for update;
  if not found then raise exception ''learning progress is not initialized''; end if;

' || needle);
    execute definition;
  end loop;
end;
$$;

comment on function public.issue_problem(text, smallint, text, text, text, jsonb, text, uuid) is
  'Serializes issuance per learner. Reuses an open problem; rejects exhausted or duplicate content instead of false success.';
