-- Plain-language feedback is now selected before submission through
-- learning_progress.easy_feedback_enabled. Remove the separate post-submit
-- Claude call and its cache while preserving official feedback and progress.

drop function if exists public.reserve_ai_feedback_simplification(uuid, uuid, uuid, text, text, integer);
drop function if exists public.finalize_ai_feedback_simplification(uuid, uuid, uuid, jsonb, text, text, text, integer, integer, integer, integer);
drop function if exists public.fail_ai_feedback_simplification(uuid, uuid, text, text, text, text, integer, integer);

drop table if exists public.feedback_simplifications;
delete from public.ai_budget_policies where operation = 'feedback_simplification';

-- Historical AI request and usage audit rows are intentionally retained.
-- Their operation check therefore continues to allow feedback_simplification.
