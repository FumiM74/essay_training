import { readFile } from 'node:fs/promises';
import { fixedProblemCountForStage, qaFixturesForStage } from './qa-fixtures.mjs';

function required(name) { const value = process.env[name]; if (!value) throw new Error(`${name} is required in tools/qa/.env.qa.local`); return value; }
function option(name) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; }
const stageId = Number(option('--stage'));
if (!Number.isInteger(stageId) || stageId < 1 || stageId > 14) throw new Error('Use --stage 1 through 14.');
if (option('--confirm') !== `seed-stage-${stageId}`) throw new Error(`Confirmation required: --confirm seed-stage-${stageId}`);
const configPath = new URL('./.env.qa.local', import.meta.url);
await readFile(configPath, 'utf8');
const url = required('SUPABASE_URL').replace(/\/$/, ''); const key = required('SUPABASE_SERVICE_ROLE_KEY');
const userId = required('QA_TEST_USER_ID'); const email = required('QA_TEST_EMAIL');
const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
async function call(path, body) { const response = await fetch(`${url}${path}`, { method: 'POST', headers, body: JSON.stringify(body) }); if (!response.ok) throw new Error(`${path}: ${await response.text()}`); return response.json().catch(() => null); }
async function countRows(path) {
  const response = await fetch(`${url}${path}`, { headers: { ...headers, Prefer: 'count=exact', Range: '0-0' } });
  if (!response.ok) throw new Error(`${path}: ${await response.text()}`);
  const range = response.headers.get('content-range');
  const count = Number(range?.split('/')[1]);
  if (!Number.isInteger(count) || count < 0) throw new Error(`Exact row count was not returned for ${path}.`);
  return count;
}
const userResponse = await fetch(`${url}/auth/v1/admin/users/${userId}`, { headers });
if (!userResponse.ok) throw new Error(`Test user lookup failed: ${await userResponse.text()}`);
const userPayload = await userResponse.json();
const user = userPayload.user ?? userPayload;
if (user.email !== email) throw new Error('QA_TEST_EMAIL does not match QA_TEST_USER_ID. No data was changed.');
const fixedProblemCount = fixedProblemCountForStage(stageId);
const approvedProblemCount = await countRows(`/rest/v1/problem_bank?stage_id=eq.${stageId}&status=eq.approved&select=id`);
await call('/rest/v1/rpc/register_qa_test_learner', { p_learner_id: userId, p_label: `QA seed account: ${email}` });
await call('/rest/v1/rpc/seed_qa_fixed_exhaustion', { p_learner_id: userId, p_stage_id: stageId, p_problems: qaFixturesForStage(stageId) });
const seededHistoryCount = await countRows(`/rest/v1/problem_history?learner_id=eq.${userId}&stage_id=eq.${stageId}&select=task_key`);
const expectedMinimum = fixedProblemCount + approvedProblemCount;
if (seededHistoryCount < expectedMinimum) {
  throw new Error(`QA seed verification failed: expected at least ${expectedMinimum} histories, found ${seededHistoryCount}.`);
}
console.log(`QA seed complete: ${email}, STEP ${stageId}. Fixed problems: ${fixedProblemCount}; approved shared problems: ${approvedProblemCount}; seeded histories: ${seededHistoryCount}. Open the normal app and start the next problem.`);
