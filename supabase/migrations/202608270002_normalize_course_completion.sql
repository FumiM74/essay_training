-- A completed learner may keep practising stage 13. Do not leave the UI in a completed test attempt.
create or replace function public.normalize_course_completion() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.completed_at is null and new.completed_at is not null then
    new.learning_phase := 'training';
    new.phase_passes := 0;
    new.phase_attempts := 0;
  end if;
  return new;
end;
$$;
create trigger progress_normalize_course_completion
before update on public.learning_progress
for each row execute procedure public.normalize_course_completion();
revoke execute on function public.normalize_course_completion() from public, anon, authenticated;

