-- Replace streak-based progression with training -> promotion test -> retraining.
-- Existing streak counts and learner-selected targets are retained as training pass counts.

alter table public.learning_progress rename column consecutive_passes to phase_passes;
alter table public.learning_progress rename column required_consecutive_passes to required_training_passes;
alter table public.learning_progress
  add column learning_phase text not null default 'training'
    check (learning_phase in ('training', 'promotion_test', 'retraining')),
  add column phase_attempts smallint not null default 0 check (phase_attempts >= 0),
  add column promotion_test_question_count smallint not null default 3
    check (promotion_test_question_count between 1 and 10),
  add column required_retraining_passes smallint not null default 3
    check (required_retraining_passes between 1 and 10);

alter table public.problem_history
  add column learning_phase text not null default 'training'
    check (learning_phase in ('training', 'promotion_test', 'retraining'));
alter table public.submissions
  add column learning_phase text not null default 'training'
    check (learning_phase in ('training', 'promotion_test', 'retraining'));

alter table public.submissions drop constraint submissions_learner_id_task_key_key;
create index submissions_owner_task_submitted_at
  on public.submissions (learner_id, task_key, submitted_at desc);

revoke update (required_training_passes) on table public.learning_progress from authenticated;
grant update (required_training_passes, promotion_test_question_count, required_retraining_passes)
  on table public.learning_progress to authenticated;

create or replace function public.set_problem_learning_phase() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  select learning_phase into new.learning_phase
  from public.learning_progress
  where learner_id = new.learner_id;
  if new.learning_phase is null then raise exception 'learning progress is not initialized'; end if;
  return new;
end;
$$;
create trigger problem_history_set_learning_phase
before insert on public.problem_history
for each row execute procedure public.set_problem_learning_phase();
revoke execute on function public.set_problem_learning_phase() from public, anon, authenticated;

create or replace function public.select_learning_stage(p_stage_id smallint) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_learner_id uuid := auth.uid();
  v_progress public.learning_progress%rowtype;
begin
  if v_learner_id is null then raise exception 'authentication required' using errcode = '42501'; end if;
  select * into v_progress from public.learning_progress where learner_id = v_learner_id for update;
  if not found then raise exception 'learning progress is not initialized'; end if;
  if p_stage_id is null or p_stage_id < 1 or p_stage_id > v_progress.highest_unlocked_stage_id then raise exception 'stage is not unlocked'; end if;
  if exists (select 1 from public.problem_history where learner_id = v_learner_id and submitted_at is null) then
    raise exception 'finish the current problem before changing stages';
  end if;
  update public.learning_progress
  set current_stage_id = p_stage_id, learning_phase = 'training', phase_passes = 0, phase_attempts = 0
  where learner_id = v_learner_id returning * into v_progress;
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

create or replace function public.submit_mock(
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
  v_submission_id uuid;
  v_current_stage smallint;
  v_highest_unlocked smallint;
  v_phase text;
  v_problem_phase text;
  v_phase_passes smallint;
  v_phase_attempts smallint;
  v_training_target smallint;
  v_test_count smallint;
  v_retraining_target smallint;
  v_language_status text := p_feedback ->> 'languageStatus';
  v_decision text := p_feedback ->> 'decision';
  v_skill jsonb;
  v_skill_score numeric(5,4);
begin
  if v_learner_id is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if p_request_id is null then raise exception 'request id is required'; end if;
  if p_task_key is null or char_length(p_task_key) not between 1 and 120 then raise exception 'invalid task key'; end if;
  if p_stage_id not between 1 and 13 then raise exception 'invalid stage'; end if;
  if p_task_title is null or char_length(p_task_title) not between 1 and 160 then raise exception 'invalid task title'; end if;
  if p_body is null or char_length(p_body) not between 1 and 20000 then raise exception 'invalid body'; end if;
  if coalesce(char_length(p_feedback ->> 'schemaVersion'), 0) = 0 then raise exception 'invalid feedback schema'; end if;
  if v_language_status not in ('clean', 'minor_issue', 'revision_required') then raise exception 'invalid language status'; end if;
  if v_decision not in ('pass', 'revise') then raise exception 'invalid decision'; end if;
  if jsonb_typeof(p_feedback -> 'priorityFeedback') is distinct from 'array' then raise exception 'invalid priority feedback'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_feedback -> 'priorityFeedback') item
    where jsonb_typeof(item) <> 'object'
      or coalesce(char_length(item ->> 'title'), 0) = 0
      or coalesce(char_length(item ->> 'guidance'), 0) = 0
  ) then raise exception 'invalid priority feedback item'; end if;
  if jsonb_typeof(p_feedback -> 'skillResults') is distinct from 'array'
    or jsonb_array_length(p_feedback -> 'skillResults') not between 1 and 8
  then raise exception 'invalid skill results'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_feedback -> 'skillResults') item
    where jsonb_typeof(item) <> 'object'
      or coalesce(item ->> 'skillKey', '') !~ '^[a-z0-9_]{1,80}$'
      or (item ->> 'outcome') not in ('achieved', 'partial', 'missed')
      or jsonb_typeof(item -> 'severity') is distinct from 'number'
      or (item ->> 'severity')::integer not between 0 and 2
      or coalesce(char_length(item ->> 'evidence'), 0) not between 1 and 500
  ) then raise exception 'invalid skill result item'; end if;
  if (select count(*) <> count(distinct item ->> 'skillKey') from jsonb_array_elements(p_feedback -> 'skillResults') item)
  then raise exception 'duplicate skill result'; end if;
  if v_language_status = 'revision_required' and v_decision <> 'revise' then raise exception 'inconsistent feedback'; end if;

  select id into v_submission_id
  from public.submissions
  where learner_id = v_learner_id and request_id = p_request_id;

  if v_submission_id is null then
    select current_stage_id, highest_unlocked_stage_id, learning_phase, phase_passes, phase_attempts,
      required_training_passes, promotion_test_question_count, required_retraining_passes
    into v_current_stage, v_highest_unlocked, v_phase, v_phase_passes, v_phase_attempts,
      v_training_target, v_test_count, v_retraining_target
    from public.learning_progress
    where learner_id = v_learner_id for update;
    if not found then raise exception 'learning progress is not initialized'; end if;

    select learning_phase into v_problem_phase
    from public.problem_history
    where learner_id = v_learner_id and task_key = p_task_key and stage_id = p_stage_id and submitted_at is null
    for update;
    if not found then
      select s.id into v_submission_id
      from public.submissions s
      join public.feedback_results f on f.submission_id = s.id
      where s.learner_id = v_learner_id and s.task_key = p_task_key and f.decision = 'pass'
      order by s.submitted_at desc limit 1;
      if v_submission_id is null then raise exception 'task was not issued or was already submitted'; end if;
    else
      if p_stage_id <> v_current_stage then raise exception 'task is not in the current stage'; end if;
      if exists (
        select 1 from jsonb_array_elements(p_feedback -> 'skillResults') result
        where not exists (
          select 1 from public.problem_history h
          cross join lateral jsonb_array_elements_text(h.feature_signature -> 'skillTargets') target(skill_key)
          where h.learner_id = v_learner_id and h.task_key = p_task_key and target.skill_key = result ->> 'skillKey'
        )
      ) then raise exception 'skill result is not a target of the issued problem'; end if;

      insert into public.submissions (learner_id, task_key, request_id, stage_id, task_title, body, learning_phase)
      values (v_learner_id, p_task_key, p_request_id, p_stage_id, p_task_title, p_body, v_problem_phase)
      returning id into v_submission_id;

      insert into public.feedback_results (submission_id, learner_id, schema_version, language_status, decision, result)
      values (v_submission_id, v_learner_id, p_feedback ->> 'schemaVersion', v_language_status, v_decision, p_feedback);

      for v_skill in select value from jsonb_array_elements(p_feedback -> 'skillResults') loop
        v_skill_score := case v_skill ->> 'outcome' when 'achieved' then 1.0000 when 'partial' then 0.5000 else 0.0000 end;
        insert into public.skill_results (submission_id, learner_id, stage_id, skill_key, outcome, severity, evidence)
        values (v_submission_id, v_learner_id, p_stage_id, v_skill ->> 'skillKey', v_skill ->> 'outcome', (v_skill ->> 'severity')::smallint, v_skill ->> 'evidence');
        insert into public.learner_skill_stats (
          learner_id, stage_id, skill_key, attempts, achieved_count, partial_count, missed_count,
          mastery_score, last_outcome, last_practiced_at
        ) values (
          v_learner_id, p_stage_id, v_skill ->> 'skillKey', 1,
          case when v_skill ->> 'outcome' = 'achieved' then 1 else 0 end,
          case when v_skill ->> 'outcome' = 'partial' then 1 else 0 end,
          case when v_skill ->> 'outcome' = 'missed' then 1 else 0 end,
          round((0.5000 * 0.6500 + v_skill_score * 0.3500)::numeric, 4), v_skill ->> 'outcome', now()
        ) on conflict (learner_id, stage_id, skill_key) do update set
          attempts = public.learner_skill_stats.attempts + 1,
          achieved_count = public.learner_skill_stats.achieved_count + case when excluded.last_outcome = 'achieved' then 1 else 0 end,
          partial_count = public.learner_skill_stats.partial_count + case when excluded.last_outcome = 'partial' then 1 else 0 end,
          missed_count = public.learner_skill_stats.missed_count + case when excluded.last_outcome = 'missed' then 1 else 0 end,
          mastery_score = round((public.learner_skill_stats.mastery_score * 0.6500 + v_skill_score * 0.3500)::numeric, 4),
          last_outcome = excluded.last_outcome, last_practiced_at = excluded.last_practiced_at;
      end loop;

      if v_decision = 'pass' then
        delete from public.drafts where learner_id = v_learner_id and task_key = p_task_key;
        update public.problem_history set submitted_at = now() where learner_id = v_learner_id and task_key = p_task_key;
      else
        insert into public.drafts (learner_id, task_key, body)
        values (v_learner_id, p_task_key, p_body)
        on conflict (learner_id, task_key) do update set body = excluded.body;
      end if;

      if v_problem_phase = v_phase then
        if v_phase = 'promotion_test' and v_decision = 'revise' then
          update public.learning_progress set learning_phase = 'retraining', phase_passes = 0, phase_attempts = 0
          where learner_id = v_learner_id;
        elsif v_phase = 'promotion_test' and v_decision = 'pass' and v_phase_attempts + 1 >= v_test_count and v_current_stage = 13 then
          update public.learning_progress set phase_passes = v_phase_passes + 1, phase_attempts = v_phase_attempts + 1,
            highest_unlocked_stage_id = 13, completed_at = coalesce(completed_at, now()) where learner_id = v_learner_id;
        elsif v_phase = 'promotion_test' and v_decision = 'pass' and v_phase_attempts + 1 >= v_test_count then
          update public.learning_progress set current_stage_id = v_current_stage + 1,
            highest_unlocked_stage_id = greatest(v_highest_unlocked, v_current_stage + 1),
            learning_phase = 'training', phase_passes = 0, phase_attempts = 0 where learner_id = v_learner_id;
        elsif v_phase = 'promotion_test' and v_decision = 'pass' then
          update public.learning_progress set phase_passes = v_phase_passes + 1, phase_attempts = v_phase_attempts + 1
          where learner_id = v_learner_id;
        elsif v_phase = 'training' and v_decision = 'pass' and v_phase_passes + 1 >= v_training_target then
          update public.learning_progress set learning_phase = 'promotion_test', phase_passes = 0, phase_attempts = 0
          where learner_id = v_learner_id;
        elsif v_phase = 'retraining' and v_decision = 'pass' and v_phase_passes + 1 >= v_retraining_target then
          update public.learning_progress set learning_phase = 'promotion_test', phase_passes = 0, phase_attempts = 0
          where learner_id = v_learner_id;
        elsif v_decision = 'pass' then
          update public.learning_progress set phase_passes = v_phase_passes + 1 where learner_id = v_learner_id;
        end if;
      end if;
    end if;
  end if;

  return (
    select jsonb_build_object(
      'id', s.id, 'taskKey', s.task_key, 'stageId', s.stage_id, 'taskTitle', s.task_title,
      'body', s.body, 'submittedAt', s.submitted_at, 'learningPhase', s.learning_phase, 'feedback', f.result
    )
    from public.submissions s join public.feedback_results f on f.submission_id = s.id
    where s.id = v_submission_id and s.learner_id = v_learner_id
  );
end;
$$;

