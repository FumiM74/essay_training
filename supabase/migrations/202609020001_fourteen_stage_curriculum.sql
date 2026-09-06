-- Expand the curriculum from 13 to 14 stages and make stage 1 a one-shot five-question set.

alter table public.tasks drop constraint tasks_stage_id_check;
alter table public.tasks add constraint tasks_stage_id_check check (stage_id between 0 and 14);
alter table public.task_assignments drop constraint task_assignments_stage_id_check;
alter table public.task_assignments add constraint task_assignments_stage_id_check check (stage_id between 0 and 14);
alter table public.submissions drop constraint submissions_stage_id_check;
alter table public.submissions add constraint submissions_stage_id_check check (stage_id between 1 and 14);
alter table public.skill_results drop constraint skill_results_stage_id_check;
alter table public.skill_results add constraint skill_results_stage_id_check check (stage_id between 1 and 14);
alter table public.learner_skill_stats drop constraint learner_skill_stats_stage_id_check;
alter table public.learner_skill_stats add constraint learner_skill_stats_stage_id_check check (stage_id between 1 and 14);
alter table public.problem_bank drop constraint problem_bank_stage_id_check;
alter table public.problem_bank add constraint problem_bank_stage_id_check check (stage_id between 1 and 14);
alter table public.problem_history drop constraint problem_history_stage_id_check;
alter table public.problem_history add constraint problem_history_stage_id_check check (stage_id between 1 and 14);
alter table public.learning_progress drop constraint learning_progress_check;
alter table public.learning_progress drop constraint learning_progress_current_stage_id_check;
alter table public.learning_progress add constraint learning_progress_current_stage_id_check check (current_stage_id between 1 and 14);
alter table public.learning_progress add constraint learning_progress_check check (highest_unlocked_stage_id between current_stage_id and 14);

do $$
declare
  v_definition text;
begin
  select pg_get_functiondef('public.submit_mock_before_accumulated_test(uuid,text,smallint,text,text,jsonb)'::regprocedure)
  into v_definition;
  v_definition := replace(v_definition, 'not between 1 and 13', 'not between 1 and 14');
  v_definition := replace(v_definition, 'v_current_stage = 13', 'v_current_stage = 14');
  v_definition := replace(v_definition, 'highest_unlocked_stage_id = 13', 'highest_unlocked_stage_id = 14');
  execute v_definition;

  select pg_get_functiondef('public.submit_mock(uuid,text,smallint,text,text,jsonb)'::regprocedure)
  into v_definition;
  v_definition := replace(v_definition, 'v_before.current_stage_id = 13', 'v_before.current_stage_id = 14');
  v_definition := replace(v_definition, 'current_stage_id = 13', 'current_stage_id = 14');
  v_definition := replace(v_definition, 'highest_unlocked_stage_id = 13', 'highest_unlocked_stage_id = 14');
  execute v_definition;
end;
$$;

alter function public.submit_mock(uuid, text, smallint, text, text, jsonb)
  rename to submit_mock_before_stage_one_sets;

revoke execute on function public.submit_mock_before_stage_one_sets(uuid, text, smallint, text, text, jsonb)
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
  v_already_submitted boolean;
  v_result jsonb;
begin
  if v_learner_id is null then raise exception 'authentication required' using errcode = '42501'; end if;

  select exists (
    select 1 from public.submissions
    where learner_id = v_learner_id and request_id = p_request_id
  ) into v_already_submitted;

  v_result := public.submit_mock_before_stage_one_sets(
    p_request_id, p_task_key, p_stage_id, p_task_title, p_body, p_feedback
  );

  -- Stage 1 reveals every answer after submission. A failed set must therefore
  -- close and move to a fresh set instead of allowing the revealed answers to be copied.
  if not v_already_submitted
    and p_stage_id = 1
    and v_result ->> 'learningPhase' <> 'promotion_test'
    and p_feedback ->> 'decision' = 'revise'
  then
    delete from public.drafts where learner_id = v_learner_id and task_key = p_task_key;
    update public.problem_history
    set submitted_at = coalesce(submitted_at, now())
    where learner_id = v_learner_id and task_key = p_task_key;
  end if;

  return v_result;
end;
$$;

revoke execute on function public.submit_mock(uuid, text, smallint, text, text, jsonb)
from public, anon;
grant execute on function public.submit_mock(uuid, text, smallint, text, text, jsonb)
to authenticated;

comment on function public.submit_mock(uuid, text, smallint, text, text, jsonb) is
  'Records submissions atomically. Stage-1 sets and promotion-test questions are one-shot.';
