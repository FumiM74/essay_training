-- Promotion tests use one-shot questions. Failed answers move to a new question,
-- while accumulated passes are retained until the learner reaches the target.

alter table public.learning_progress
  alter column required_training_passes set default 10;

-- Development has no production learners yet. Move the former default to the new default,
-- and retire any in-flight retraining state without deleting its history.
update public.learning_progress
set required_training_passes = 10
where required_training_passes = 3;

update public.learning_progress
set learning_phase = 'promotion_test', phase_passes = 0, phase_attempts = 0
where learning_phase = 'retraining';

alter function public.submit_mock(uuid, text, smallint, text, text, jsonb)
  rename to submit_mock_before_accumulated_test;

revoke execute on function public.submit_mock_before_accumulated_test(uuid, text, smallint, text, text, jsonb)
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
  v_before public.learning_progress%rowtype;
  v_result jsonb;
  v_already_submitted boolean;
  v_passed boolean := p_feedback ->> 'decision' = 'pass';
  v_next_passes smallint;
begin
  if v_learner_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select exists (
    select 1 from public.submissions
    where learner_id = v_learner_id and request_id = p_request_id
  ) into v_already_submitted;

  select * into v_before
  from public.learning_progress
  where learner_id = v_learner_id
  for update;
  if not found then raise exception 'learning progress is not initialized'; end if;

  v_result := public.submit_mock_before_accumulated_test(
    p_request_id, p_task_key, p_stage_id, p_task_title, p_body, p_feedback
  );

  if v_already_submitted or v_result ->> 'learningPhase' <> 'promotion_test' then
    return v_result;
  end if;

  -- A promotion-test answer is final for that question, whether it passes or fails.
  delete from public.drafts
  where learner_id = v_learner_id and task_key = p_task_key;

  update public.problem_history
  set submitted_at = coalesce(submitted_at, now())
  where learner_id = v_learner_id and task_key = p_task_key;

  v_next_passes := v_before.phase_passes + case when v_passed then 1 else 0 end;

  if v_next_passes >= v_before.promotion_test_question_count and v_before.current_stage_id = 13 then
    update public.learning_progress
    set current_stage_id = 13,
        highest_unlocked_stage_id = 13,
        learning_phase = 'training',
        phase_passes = 0,
        phase_attempts = 0,
        completed_at = coalesce(v_before.completed_at, now())
    where learner_id = v_learner_id;
  elsif v_next_passes >= v_before.promotion_test_question_count then
    update public.learning_progress
    set current_stage_id = v_before.current_stage_id + 1,
        highest_unlocked_stage_id = greatest(v_before.highest_unlocked_stage_id, v_before.current_stage_id + 1),
        learning_phase = 'training',
        phase_passes = 0,
        phase_attempts = 0,
        completed_at = v_before.completed_at
    where learner_id = v_learner_id;
  else
    update public.learning_progress
    set current_stage_id = v_before.current_stage_id,
        highest_unlocked_stage_id = v_before.highest_unlocked_stage_id,
        learning_phase = 'promotion_test',
        phase_passes = v_next_passes,
        phase_attempts = v_before.phase_attempts + 1,
        completed_at = v_before.completed_at
    where learner_id = v_learner_id;
  end if;

  return v_result;
end;
$$;

revoke execute on function public.submit_mock(uuid, text, smallint, text, text, jsonb)
from public, anon;
grant execute on function public.submit_mock(uuid, text, smallint, text, text, jsonb)
to authenticated;

comment on function public.submit_mock(uuid, text, smallint, text, text, jsonb) is
  'Records a submission atomically. Promotion-test failures complete the question and retain accumulated passes.';
