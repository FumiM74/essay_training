-- Stage 1 now grades five independent skills in one set. Upgrade previously
-- issued or banked stage-1 problems so all five results pass RPC validation.

update public.problem_history
set feature_signature = jsonb_set(
  jsonb_set(feature_signature, '{promptFamily}', '"five-question-language-basics"'::jsonb),
  '{skillTargets}',
  '["subject_predicate","particle_accuracy","auxiliary_accuracy","modifier_clarity","sentence_completion"]'::jsonb
)
where stage_id = 1;

update public.problem_bank
set feature_signature = jsonb_set(
  jsonb_set(feature_signature, '{promptFamily}', '"five-question-language-basics"'::jsonb),
  '{skillTargets}',
  '["subject_predicate","particle_accuracy","auxiliary_accuracy","modifier_clarity","sentence_completion"]'::jsonb
)
where stage_id = 1;
