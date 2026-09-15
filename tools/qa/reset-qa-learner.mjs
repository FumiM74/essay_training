import { readFile } from 'node:fs/promises';

function required(name) { const value = process.env[name]; if (!value) throw new Error(`${name} is required in tools/qa/.env.qa.local`); return value; }
if (process.argv[2] !== '--confirm-reset') throw new Error('Confirmation required: --confirm-reset');
await readFile(new URL('./.env.qa.local', import.meta.url), 'utf8');
const url = required('SUPABASE_URL').replace(/\/$/, ''); const key = required('SUPABASE_SERVICE_ROLE_KEY'); const userId = required('QA_TEST_USER_ID'); const email = required('QA_TEST_EMAIL');
const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
const userResponse = await fetch(`${url}/auth/v1/admin/users/${userId}`, { headers });
if (!userResponse.ok) throw new Error(`Test user lookup failed: ${await userResponse.text()}`);
const userPayload = await userResponse.json();
const user = userPayload.user ?? userPayload;
if (user.email !== email) throw new Error('QA_TEST_EMAIL does not match QA_TEST_USER_ID. No data was changed.');
const response = await fetch(`${url}/rest/v1/rpc/reset_qa_test_learner`, { method: 'POST', headers, body: JSON.stringify({ p_learner_id: userId }) });
if (!response.ok) throw new Error(`Reset failed: ${await response.text()}`);
console.log(`QA learner reset complete: ${email}`);
