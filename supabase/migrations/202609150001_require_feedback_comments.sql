-- A saved result must always contain enough feedback to render the result screen.
-- STEP 1 uses five comments, STEP 2/3 use three, and later stages use one to three.
alter function public.submit_mock(uuid, text, smallint, text, text, jsonb)
  rename to submit_mock_before_feedback_comment_guard;
revoke execute on function public.submit_mock_before_feedback_comment_guard(uuid, text, smallint, text, text, jsonb)
  from public, anon, authenticated;

create function public.submit_mock(
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
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if jsonb_typeof(p_feedback -> 'priorityFeedback') is distinct from 'array'
    or jsonb_array_length(p_feedback -> 'priorityFeedback') not between 1 and 5 then
    raise exception 'feedback must contain between 1 and 5 comments' using errcode = '22023';
  end if;

  return public.submit_mock_before_feedback_comment_guard(
    p_request_id,
    p_task_key,
    p_stage_id,
    p_task_title,
    p_body,
    p_feedback
  );
end;
$$;

revoke execute on function public.submit_mock(uuid, text, smallint, text, text, jsonb)
  from public, anon, authenticated;

comment on function public.submit_mock(uuid, text, smallint, text, text, jsonb) is
  'Service-only submission boundary. Rejects results without 1-5 learner-visible feedback comments before saving progress.';
