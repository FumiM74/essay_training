-- Learners can choose whether every future Claude response uses simpler language.
-- The preference changes wording only; grading rules and progression stay unchanged.

alter table public.learning_progress
  add column easy_feedback_enabled boolean not null default false;

comment on column public.learning_progress.easy_feedback_enabled is
  'When true, feedback wording targets upper-elementary to junior-high readers. It must never change grading or progression.';

grant update (easy_feedback_enabled) on table public.learning_progress to authenticated;

create or replace function public.get_ai_feedback_preference(p_learner_id uuid) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_enabled boolean;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  select easy_feedback_enabled into v_enabled
  from public.learning_progress
  where learner_id = p_learner_id;
  if not found then raise exception 'learning progress is not initialized'; end if;
  return v_enabled;
end;
$$;

revoke execute on function public.get_ai_feedback_preference(uuid) from public, anon, authenticated;
grant execute on function public.get_ai_feedback_preference(uuid) to service_role;

comment on function public.get_ai_feedback_preference(uuid) is
  'Service-only lookup used by the feedback Edge Function. Browser input cannot override the saved explanation level.';
