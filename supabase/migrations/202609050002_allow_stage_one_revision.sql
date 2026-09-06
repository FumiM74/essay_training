-- Training sets remain open on failure; promotion tests remain one-shot.
-- The underlying wrapper already serializes requests and enforces idempotency.
create or replace function public.submit_mock(
  p_request_id uuid, p_task_key text, p_stage_id smallint,
  p_task_title text, p_body text, p_feedback jsonb
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '42501'; end if;
  return public.submit_mock_before_stage_one_sets(
    p_request_id, p_task_key, p_stage_id, p_task_title, p_body, p_feedback
  );
end;
$$;
revoke execute on function public.submit_mock(uuid, text, smallint, text, text, jsonb) from public, anon;
grant execute on function public.submit_mock(uuid, text, smallint, text, text, jsonb) to authenticated;
comment on function public.submit_mock(uuid, text, smallint, text, text, jsonb) is
  'Training allows revision including stage-1 sets. Only promotion tests are one-shot.';
