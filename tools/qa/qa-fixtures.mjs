import { createHash } from 'node:crypto';

const stageSkills = {
  1: ['subject_predicate', 'particle_accuracy', 'auxiliary_accuracy', 'modifier_clarity', 'sentence_completion'],
  2: ['sentence_relation', 'modifier_clarity', 'sentence_completion'], 3: ['paragraph_coherence', 'claim_reason_link', 'paragraph_analysis'],
  4: ['clear_claim'], 5: ['causal_depth'], 6: ['example_relevance'], 7: ['paragraph_analysis'], 8: ['paragraph_coherence'], 9: ['summary_fidelity'],
  10: ['source_integration'], 11: ['counterargument_fairness'], 12: ['outline_planning'], 13: ['essay_structure'], 14: ['prompt_alignment'],
};

function hash(value) { return `qa:${createHash('sha256').update(value).digest('hex').slice(0, 32)}`; }

export function qaFixturesForStage(stageId) {
  const skills = stageSkills[stageId];
  if (!skills) throw new Error('stage must be between 1 and 14');
  return Array.from({ length: 10 }, (_, seed) => {
    const skill = skills[seed % skills.length];
    const taskKey = `stage-${stageId}-generated-${seed.toString(36)}-core-${skill}`;
    const prompt = `QA用の固定問題履歴 ${stageId}-${seed + 1}。この問題は固定問題を使い切った状態を再現するためだけに投入されます。`;
    const featureSignature = {
      version: 2, fingerprint: hash(`${taskKey}:feature`), seed, topicDomain: 'education', topicKey: `qa-fixed-stage-${stageId}`,
      promptFamily: 'qa-fixed-exhaustion', skillTargets: [skill], selectionReason: 'core', surfacePattern: 'qa-fixture',
      generation: { source: 'curated', designVersion: 'qa-harness-v1', promptVersion: 'qa-harness-v1' },
    };
    return { taskKey, stageId, title: `QA固定問題 ${seed + 1}/10`, prompt, hint: 'QA専用の投入済み履歴です。', featureSignature, promptHash: hash(`${taskKey}:prompt`) };
  });
}
