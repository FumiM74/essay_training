-- Keep the learner's furthest-stage progress while they review an earlier stage.
-- Unlocking is monotonic: navigation and review submissions must never relock a stage.

alter table public.learning_progress
  add column frontier_learning_phase text not null default 'training'
    check (frontier_learning_phase in ('training', 'promotion_test', 'retraining')),
  add column frontier_phase_passes smallint not null default 0 check (frontier_phase_passes >= 0),
  add column frontier_phase_attempts smallint not null default 0 check (frontier_phase_attempts >= 0);

update public.learning_progress
set frontier_learning_phase = case when current_stage_id = highest_unlocked_stage_id then learning_phase else 'training' end,
    frontier_phase_passes = case when current_stage_id = highest_unlocked_stage_id then phase_passes else 0 end,
    frontier_phase_attempts = case when current_stage_id = highest_unlocked_stage_id then phase_attempts else 0 end;

create or replace function public.preserve_learning_frontier() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and new.highest_unlocked_stage_id < old.highest_unlocked_stage_id then
    new.highest_unlocked_stage_id := old.highest_unlocked_stage_id;
  end if;

  if new.current_stage_id = new.highest_unlocked_stage_id then
    new.frontier_learning_phase := new.learning_phase;
    new.frontier_phase_passes := new.phase_passes;
    new.frontier_phase_attempts := new.phase_attempts;
  end if;
  return new;
end;
$$;

create trigger learning_progress_preserve_frontier
before insert or update on public.learning_progress
for each row execute procedure public.preserve_learning_frontier();

revoke execute on function public.preserve_learning_frontier() from public, anon, authenticated;

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
  if not found then raise exception 'learning progress is not initialized'; end if;
  if p_stage_id is null or p_stage_id < 1 or p_stage_id > v_progress.highest_unlocked_stage_id then
    raise exception 'stage is not unlocked';
  end if;

  if p_stage_id = v_progress.highest_unlocked_stage_id then
    update public.learning_progress
    set current_stage_id = p_stage_id,
        learning_phase = frontier_learning_phase,
        phase_passes = frontier_phase_passes,
        phase_attempts = frontier_phase_attempts
    where learner_id = v_learner_id
    returning * into v_progress;
  else
    update public.learning_progress
    set current_stage_id = p_stage_id,
        learning_phase = 'training',
        phase_passes = 0,
        phase_attempts = 0
    where learner_id = v_learner_id
    returning * into v_progress;
  end if;

  return jsonb_build_object(
    'currentStageId', v_progress.current_stage_id,
    'highestUnlockedStageId', v_progress.highest_unlocked_stage_id,
    'phase', v_progress.learning_phase,
    'phasePasses', v_progress.phase_passes,
    'phaseAttempts', v_progress.phase_attempts,
    'frontierPhase', v_progress.frontier_learning_phase,
    'frontierPhasePasses', v_progress.frontier_phase_passes,
    'frontierPhaseAttempts', v_progress.frontier_phase_attempts,
    'requiredTrainingPasses', v_progress.required_training_passes,
    'promotionTestQuestionCount', v_progress.promotion_test_question_count,
    'requiredRetrainingPasses', v_progress.required_retraining_passes,
    'courseCompletedAt', v_progress.completed_at
  );
end;
$$;

revoke execute on function public.select_learning_stage(smallint) from public, anon;
grant execute on function public.select_learning_stage(smallint) to authenticated;

alter function public.submit_mock(uuid, text, smallint, text, text, jsonb)
  rename to submit_mock_before_frontier_preservation;

revoke execute on function public.submit_mock_before_frontier_preservation(uuid, text, smallint, text, text, jsonb)
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
  v_review_passes smallint;
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

  v_result := public.submit_mock_before_frontier_preservation(
    p_request_id, p_task_key, p_stage_id, p_task_title, p_body, p_feedback
  );

  if v_before.current_stage_id < v_before.highest_unlocked_stage_id then
    v_review_passes := v_before.phase_passes;
    if not v_already_submitted and p_feedback ->> 'decision' = 'pass' then
      v_review_passes := least(
        v_before.phase_passes + 1,
        greatest(v_before.required_training_passes - 1, 0)
      );
    end if;

    update public.learning_progress
    set current_stage_id = v_before.current_stage_id,
        highest_unlocked_stage_id = v_before.highest_unlocked_stage_id,
        learning_phase = 'training',
        phase_passes = v_review_passes,
        phase_attempts = 0,
        completed_at = v_before.completed_at
    where learner_id = v_learner_id;
  end if;

  return v_result;
end;
$$;

revoke execute on function public.submit_mock(uuid, text, smallint, text, text, jsonb)
from public, anon, authenticated;

comment on function public.submit_mock(uuid, text, smallint, text, text, jsonb) is
  'Records a submission while preventing review work from changing the furthest-stage progression.';

comment on column public.learning_progress.frontier_learning_phase is
  'Saved phase for the highest unlocked stage while the learner reviews an earlier stage.';
