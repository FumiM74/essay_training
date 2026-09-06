-- Concurrent page initialisation can try to issue different candidates for the same stage.
-- Treat every uniqueness conflict as another request winning the race.
do $$
declare
  v_definition text;
begin
  select pg_get_functiondef('public.issue_problem(text,smallint,text,text,text,jsonb,text,uuid)'::regprocedure)
  into v_definition;

  if position('on conflict (learner_id, task_key) do nothing' in v_definition) = 0 then
    raise exception 'issue_problem conflict handler was not found';
  end if;

  v_definition := replace(
    v_definition,
    'on conflict (learner_id, task_key) do nothing',
    'on conflict do nothing'
  );
  execute v_definition;
end;
$$;

comment on function public.issue_problem(text, smallint, text, text, text, jsonb, text, uuid) is
  'Issues at most one open problem per stage. Concurrent duplicate or competing requests are idempotent.';
