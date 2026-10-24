-- Promotion tests now keep the same problem open after a revise result.
-- Learners correct only the unresolved subquestions or revise the same long answer.
-- Generated trial problems still stop after their fifth revise result.

alter function public.submit_mock(uuid, text, smallint, text, text, jsonb)
  rename to submit_mock_before_revisionable_promotion_tests;

revoke execute on function public.submit_mock_before_revisionable_promotion_tests(uuid, text, smallint, text, text, jsonb)
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
declare
  v_learner_id uuid := auth.uid();
  v_result jsonb;
begin
  if v_learner_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  v_result := public.submit_mock_before_revisionable_promotion_tests(
    p_request_id, p_task_key, p_stage_id, p_task_title, p_body, p_feedback
  );

  -- Older progression wrappers close every failed promotion-test problem.
  -- Reopen it after the atomic submission unless the generated-problem quality
  -- lifecycle deliberately ended the problem on its fifth revise result.
  if v_result ->> 'learningPhase' = 'promotion_test'
    and p_feedback ->> 'decision' = 'revise'
    and coalesce(v_result #>> '{trialOutcome,status}', '') <> 'disqualified'
    and not exists (
      select 1 from public.problem_history
      where learner_id = v_learner_id
        and stage_id = p_stage_id
        and task_key <> p_task_key
        and submitted_at is null
    )
  then
    update public.problem_history
    set submitted_at = null
    where learner_id = v_learner_id
      and task_key = p_task_key
      and stage_id = p_stage_id;
  end if;

  return v_result;
end;
$$;

revoke execute on function public.submit_mock(uuid, text, smallint, text, text, jsonb)
from public, anon;
grant execute on function public.submit_mock(uuid, text, smallint, text, text, jsonb)
to authenticated;

comment on function public.submit_mock(uuid, text, smallint, text, text, jsonb) is
  'Records submissions atomically. Revise results keep training and promotion-test problems open; disqualified generated trials remain closed.';

create or replace function public.get_latest_revision_context(
  p_learner_id uuid,
  p_task_key text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.problem_history
    where learner_id = p_learner_id
      and task_key = p_task_key
      and submitted_at is null
  ) then
    return null;
  end if;

  select jsonb_build_object(
    'previousAnswer', s.body,
    'previousFeedback', f.result
  ) into v_result
  from public.submissions s
  join public.feedback_results f on f.submission_id = s.id and f.learner_id = s.learner_id
  where s.learner_id = p_learner_id
    and s.task_key = p_task_key
    and f.decision = 'revise'
  order by s.submitted_at desc
  limit 1;

  return v_result;
end;
$$;

revoke execute on function public.get_latest_revision_context(uuid, text)
from public, anon, authenticated;
grant execute on function public.get_latest_revision_context(uuid, text)
to service_role;

comment on function public.get_latest_revision_context(uuid, text) is
  'Returns the latest saved revise result for an open problem to the feedback Edge Function only.';
