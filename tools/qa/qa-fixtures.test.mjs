import assert from 'node:assert/strict';
import test from 'node:test';
import { fixedProblemCountForStage, qaFixturesForStage } from './qa-fixtures.mjs';

test('QA fixtures follow every stage current fixed-problem count', () => {
  for (let stageId = 1; stageId <= 14; stageId += 1) {
    const expected = fixedProblemCountForStage(stageId);
    const fixtures = qaFixturesForStage(stageId);
    assert.equal(fixtures.length, expected);
    assert.deepEqual(fixtures.map((item) => item.featureSignature.seed), Array.from({ length: expected }, (_, seed) => seed));
    assert.equal(new Set(fixtures.map((item) => item.taskKey)).size, expected);
    assert.ok(fixtures.every((item) => item.taskKey.endsWith('-q00000000')));
  }
});

test('expanded stages are not reduced to the former ten-problem assumption', () => {
  for (const stageId of [1, 2, 3]) assert.equal(fixedProblemCountForStage(stageId), 10);
  for (let stageId = 4; stageId <= 14; stageId += 1) assert.ok(fixedProblemCountForStage(stageId) > 10);
});
