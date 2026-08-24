-- Initial schema. Learner-owned data is isolated with PostgreSQL RLS.
create extension if not exists "pgcrypto";

create type public.app_role as enum ('learner', 'admin');
create type public.assignment_status as enum ('active', 'completed', 'archived');
create type public.entitlement_status as enum ('active', 'expired', 'revoked');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text check (char_length(display_name) between 1 and 80),
  role public.app_role not null default 'learner',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.rubric_versions (
  id uuid primary key default gen_random_uuid(), version text not null unique,
  content jsonb not null, created_at timestamptz not null default now(), published_at timestamptz
);
create table public.instruction_versions (
  id uuid primary key default gen_random_uuid(), version text not null unique,
  content jsonb not null, created_at timestamptz not null default now(), published_at timestamptz
);
create table public.tasks (
  id uuid primary key default gen_random_uuid(), stage_id smallint not null check (stage_id between 0 and 13),
  title text not null check (char_length(title) between 1 and 160), prompt text not null check (char_length(prompt) between 1 and 12000),
  rubric_version_id uuid not null references public.rubric_versions(id),
  instruction_version_id uuid not null references public.instruction_versions(id),
  created_at timestamptz not null default now(), archived_at timestamptz
);
create table public.task_assignments (
  id uuid primary key default gen_random_uuid(), learner_id uuid not null references public.profiles(id) on delete cascade,
  task_id uuid not null references public.tasks(id), stage_id smallint not null check (stage_id between 0 and 13),
  status public.assignment_status not null default 'active', assigned_at timestamptz not null default now(), completed_at timestamptz,
  unique (learner_id, task_id)
);
create unique index one_active_assignment_per_learner on public.task_assignments (learner_id) where status = 'active';
create table public.drafts (
  id uuid primary key default gen_random_uuid(), learner_id uuid not null references public.profiles(id) on delete cascade,
  assignment_id uuid not null references public.task_assignments(id) on delete cascade,
  body text not null default '' check (char_length(body) <= 20000), updated_at timestamptz not null default now(),
  unique (learner_id, assignment_id)
);
create table public.submissions (
  id uuid primary key default gen_random_uuid(), learner_id uuid not null references public.profiles(id) on delete cascade,
  assignment_id uuid not null references public.task_assignments(id), request_id uuid not null,
  revision_no integer not null check (revision_no > 0), body text not null check (char_length(body) between 1 and 20000),
  rubric_version_id uuid not null references public.rubric_versions(id), instruction_version_id uuid not null references public.instruction_versions(id),
  submitted_at timestamptz not null default now(), unique (learner_id, request_id), unique (assignment_id, revision_no)
);
create table public.feedback_results (
  id uuid primary key default gen_random_uuid(), submission_id uuid not null unique references public.submissions(id) on delete cascade,
  learner_id uuid not null references public.profiles(id) on delete cascade, schema_version text not null,
  language_status text not null check (language_status in ('clean', 'minor_issue', 'revision_required')),
  decision text not null check (decision in ('pass', 'revise')), result jsonb not null, created_at timestamptz not null default now(),
  check ((language_status <> 'revision_required') or decision = 'revise')
);
create table public.learning_progress (
  learner_id uuid primary key references public.profiles(id) on delete cascade,
  current_stage_id smallint not null default 0 check (current_stage_id between 0 and 13),
  consecutive_passes smallint not null default 0 check (consecutive_passes >= 0),
  required_consecutive_passes smallint not null default 3 check (required_consecutive_passes between 1 and 10),
  individual_instruction text check (char_length(individual_instruction) <= 4000), updated_at timestamptz not null default now()
);
create table public.entitlements (
  id uuid primary key default gen_random_uuid(), learner_id uuid not null references public.profiles(id) on delete cascade,
  status public.entitlement_status not null default 'active', source text not null check (source in ('free_trial', 'subscription', 'one_time')),
  starts_at timestamptz not null default now(), expires_at timestamptz, submission_limit integer check (submission_limit is null or submission_limit >= 0),
  used_submissions integer not null default 0 check (used_submissions >= 0), provider text, provider_reference text,
  created_at timestamptz not null default now(), unique (provider, provider_reference)
);
create table public.payment_events (
  id uuid primary key default gen_random_uuid(), provider text not null, provider_event_id text not null,
  payload jsonb not null, processed_at timestamptz, created_at timestamptz not null default now(), unique (provider, provider_event_id)
);

create or replace function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
create trigger profiles_set_updated_at before update on public.profiles for each row execute procedure public.set_updated_at();
create trigger drafts_set_updated_at before update on public.drafts for each row execute procedure public.set_updated_at();
create trigger progress_set_updated_at before update on public.learning_progress for each row execute procedure public.set_updated_at();
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = public as $$ select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'); $$;
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$ begin insert into public.profiles (id, display_name) values (new.id, coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), '学習者')); insert into public.learning_progress (learner_id) values (new.id); return new; end; $$;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

alter table public.profiles enable row level security; alter table public.rubric_versions enable row level security; alter table public.instruction_versions enable row level security; alter table public.tasks enable row level security; alter table public.task_assignments enable row level security; alter table public.drafts enable row level security; alter table public.submissions enable row level security; alter table public.feedback_results enable row level security; alter table public.learning_progress enable row level security; alter table public.entitlements enable row level security; alter table public.payment_events enable row level security;
create policy "profile owns profile" on public.profiles for select using (id = auth.uid() or public.is_admin());
create policy "profile updates profile" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());
create policy "admin manages profiles" on public.profiles for all using (public.is_admin()) with check (public.is_admin());
create policy "learner reads assigned task" on public.tasks for select using (public.is_admin() or exists (select 1 from public.task_assignments a where a.task_id = tasks.id and a.learner_id = auth.uid()));
create policy "admin manages tasks" on public.tasks for all using (public.is_admin()) with check (public.is_admin());
create policy "learner reads assignments" on public.task_assignments for select using (learner_id = auth.uid() or public.is_admin());
create policy "admin manages assignments" on public.task_assignments for all using (public.is_admin()) with check (public.is_admin());
create policy "learner manages drafts" on public.drafts for all using (learner_id = auth.uid() or public.is_admin()) with check (learner_id = auth.uid() or public.is_admin());
create policy "learner reads submissions" on public.submissions for select using (learner_id = auth.uid() or public.is_admin());
create policy "learner reads feedback" on public.feedback_results for select using (learner_id = auth.uid() or public.is_admin());
create policy "learner reads progress" on public.learning_progress for select using (learner_id = auth.uid() or public.is_admin());
create policy "learner reads entitlements" on public.entitlements for select using (learner_id = auth.uid() or public.is_admin());
create policy "admin reads payment events" on public.payment_events for select using (public.is_admin());
create policy "learner reads published rubrics" on public.rubric_versions for select using ((auth.uid() is not null and published_at is not null) or public.is_admin());
create policy "admin manages rubrics" on public.rubric_versions for all using (public.is_admin()) with check (public.is_admin());
create policy "learner reads published instructions" on public.instruction_versions for select using ((auth.uid() is not null and published_at is not null) or public.is_admin());
create policy "admin manages instructions" on public.instruction_versions for all using (public.is_admin()) with check (public.is_admin());
-- Writes to submissions, feedback_results, entitlements and payment_events are limited to trusted Edge Functions.
