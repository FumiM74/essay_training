-- An unlocked stage may be selected even while a different stage has an open task.
-- The open task is retained, so returning to that stage resumes it instead of losing work.

create or replace function public.select_learning_stage(p_stage_id smallint) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_learner_id uuid := auth.uid();
  v_progress public.learning_progress%rowtype;
begin
  if v_learner_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select * into v_progress
  from public.learning_progress
  where learner_id = v_learner_id
  for update;

  if not found then
    raise exception 'learning progress is not initialized';
  end if;

  if p_stage_id is null or p_stage_id < 1 or p_stage_id > v_progress.highest_unlocked_stage_id then
    raise exception 'stage is not unlocked';
  end if;

  -- Do not delete or invalidate an open task in another stage. issue_problem
  -- resumes the open task when the learner later returns to that stage.
  update public.learning_progress
  set current_stage_id = p_stage_id,
      learning_phase = 'training',
      phase_passes = 0,
      phase_attempts = 0
  where learner_id = v_learner_id
  returning * into v_progress;

  return jsonb_build_object(
    'currentStageId', v_progress.current_stage_id,
    'highestUnlockedStageId', v_progress.highest_unlocked_stage_id,
    'phase', v_progress.learning_phase,
    'phasePasses', v_progress.phase_passes,
    'phaseAttempts', v_progress.phase_attempts,
    'requiredTrainingPasses', v_progress.required_training_passes,
    'promotionTestQuestionCount', v_progress.promotion_test_question_count,
    'requiredRetrainingPasses', v_progress.required_retraining_passes,
    'courseCompletedAt', v_progress.completed_at
  );
end;
$$;

revoke execute on function public.select_learning_stage(smallint) from public, anon;
grant execute on function public.select_learning_stage(smallint) to authenticated;

comment on function public.select_learning_stage(smallint) is
  'Selects any unlocked stage without discarding an open task in another stage.';
