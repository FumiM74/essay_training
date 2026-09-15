-- Learners can use the broad built-in topic bank or up to three concise topics
-- of their own. The application applies these preferences from STEP 4 onward.

create or replace function public.valid_custom_learning_topics(p_topics text[])
returns boolean
language sql
immutable
strict
set search_path = public, pg_temp
as $$
  select cardinality(p_topics) <= 3
    and not exists (
      select 1
      from unnest(p_topics) as topic
      where topic <> btrim(topic)
        or char_length(topic) not between 1 and 20
    )
    and cardinality(p_topics) = (
      select count(distinct topic)
      from unnest(p_topics) as topic
    );
$$;

alter table public.learning_progress
  add column if not exists topic_selection_mode text not null default 'random',
  add column if not exists custom_topics text[] not null default '{}';

alter table public.learning_progress
  drop constraint if exists learning_progress_topic_selection_mode_check,
  add constraint learning_progress_topic_selection_mode_check
    check (topic_selection_mode in ('random', 'custom')),
  drop constraint if exists learning_progress_custom_topics_check,
  add constraint learning_progress_custom_topics_check
    check (public.valid_custom_learning_topics(custom_topics)),
  drop constraint if exists learning_progress_custom_mode_topics_check,
  add constraint learning_progress_custom_mode_topics_check
    check (topic_selection_mode = 'random' or cardinality(custom_topics) between 1 and 3);

grant update (topic_selection_mode, custom_topics) on public.learning_progress to authenticated;

comment on column public.learning_progress.topic_selection_mode is
  'random uses the built-in university-entrance topic bank; custom uses learner topics from STEP 4 onward.';
comment on column public.learning_progress.custom_topics is
  'One to three unique, trimmed learner topics, each at most 20 characters.';
