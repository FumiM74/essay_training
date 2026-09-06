-- Permit the explicit skills introduced by the 14-stage curriculum.

do $$
declare
  v_definition text;
begin
  select pg_get_functiondef('public.issue_problem(text,smallint,text,text,text,jsonb,text,uuid)'::regprocedure)
  into v_definition;
  v_definition := replace(
    v_definition,
    '''logical_consistency'', ''multi_perspective''',
    '''logical_consistency'', ''multi_perspective'', ''auxiliary_accuracy'', ''sentence_relation'', ''paragraph_analysis'', ''outline_planning'''
  );
  if v_definition not like '%auxiliary_accuracy%' then
    raise exception 'issue_problem skill allowlist was not updated';
  end if;
  execute v_definition;
end;
$$;
