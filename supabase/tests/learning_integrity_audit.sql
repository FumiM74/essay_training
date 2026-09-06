-- Read-only aggregate checks. Never include emails, answer bodies, or tokens.
with checks as (
select 'missing_progress' as check_name, count(*) as issue_count from public.profiles p
where not exists (select 1 from public.learning_progress l where l.learner_id = p.id)
union all
select 'missing_feedback', count(*) from public.submissions s
where not exists (select 1 from public.feedback_results f where f.submission_id = s.id)
union all
select 'submission_without_problem', count(*) from public.submissions s
where not exists (select 1 from public.problem_history h where h.learner_id = s.learner_id and h.task_key = s.task_key)
union all
select 'feedback_owner_mismatch', count(*) from public.feedback_results f join public.submissions s on s.id = f.submission_id where f.learner_id <> s.learner_id
union all
select 'duplicate_open_stage', count(*) from (select learner_id, stage_id from public.problem_history where submitted_at is null group by 1,2 having count(*) > 1) q
union all
select 'completed_without_submission', count(*) from public.problem_history h where submitted_at is not null and not exists (select 1 from public.submissions s where s.learner_id = h.learner_id and s.task_key = h.task_key)
union all
select 'one_shot_or_pass_still_open', count(*) from public.problem_history h where submitted_at is null and exists (
  select 1 from public.submissions s join public.feedback_results f on f.submission_id = s.id
  where s.learner_id = h.learner_id and s.task_key = h.task_key and (s.learning_phase = 'promotion_test' or f.decision = 'pass'))
union all
select 'skill_stats_count_mismatch', count(*) from public.learner_skill_stats t where t.attempts <> (select count(*) from public.skill_results r where r.learner_id = t.learner_id and r.stage_id = t.stage_id and r.skill_key = t.skill_key)
union all
select 'missing_skill_stats', count(*) from (select distinct learner_id, stage_id, skill_key from public.skill_results r where not exists (select 1 from public.learner_skill_stats t where t.learner_id = r.learner_id and t.stage_id = r.stage_id and t.skill_key = r.skill_key)) q
union all
select 'public_tables_without_rls', count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
union all
select 'unvalidated_constraints', count(*) from pg_constraint c join pg_namespace n on n.oid = c.connamespace where n.nspname = 'public' and not c.convalidated
)

select (select jsonb_object_agg(check_name, issue_count) from checks) as checks,
 (select count(*) from public.profiles) as profiles,
 (select count(*) from public.submissions) as submissions,
 (select count(*) from public.problem_history) as problem_history,
 (select count(*) from public.drafts) as drafts;
