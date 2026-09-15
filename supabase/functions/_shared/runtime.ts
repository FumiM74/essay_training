export type RuntimeEnv = {
	SUPABASE_URL: string;
	SUPABASE_SERVICE_ROLE_KEY: string;
	ANTHROPIC_API_KEY: string;
	ALLOWED_ORIGINS?: string;
	CLAUDE_HAIKU_MODEL?: string;
	CLAUDE_SONNET_MODEL?: string;
	CLAUDE_PROBLEM_GENERATION_MODEL?: string;
	CLAUDE_PROBLEM_REVIEW_MODEL?: string;
};

const defaultOrigins = [
	'https://essay-training-staging.language-training.workers.dev',
	'http://localhost:5173',
	'http://127.0.0.1:5173',
];

export function readEnv(): RuntimeEnv {
	const required = (name: string): string => {
		const value = Deno.env.get(name);
		if (!value) throw new Error(`missing_${name.toLowerCase()}`);
		return value;
	};
	return {
		SUPABASE_URL: required('SUPABASE_URL'),
		SUPABASE_SERVICE_ROLE_KEY: required('SUPABASE_SERVICE_ROLE_KEY'),
		ANTHROPIC_API_KEY: required('ANTHROPIC_API_KEY'),
		ALLOWED_ORIGINS: Deno.env.get('ALLOWED_ORIGINS'),
		CLAUDE_HAIKU_MODEL: Deno.env.get('CLAUDE_HAIKU_MODEL'),
		CLAUDE_SONNET_MODEL: Deno.env.get('CLAUDE_SONNET_MODEL'),
		CLAUDE_PROBLEM_GENERATION_MODEL: Deno.env.get('CLAUDE_PROBLEM_GENERATION_MODEL'),
		CLAUDE_PROBLEM_REVIEW_MODEL: Deno.env.get('CLAUDE_PROBLEM_REVIEW_MODEL'),
	};
}

export function corsHeaders(request: Request, env?: Pick<RuntimeEnv, 'ALLOWED_ORIGINS'>): HeadersInit {
	const origin = request.headers.get('origin') || '';
	const allowed = new Set([...(env?.ALLOWED_ORIGINS?.split(',').map((item) => item.trim()).filter(Boolean) ?? []), ...defaultOrigins]);
	return {
		'Access-Control-Allow-Origin': allowed.has(origin) ? origin : defaultOrigins[0],
		'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
		'Access-Control-Allow-Methods': 'POST, OPTIONS',
		'Vary': 'Origin',
	};
}

export function jsonResponse(request: Request, body: unknown, status: number, env?: Pick<RuntimeEnv, 'ALLOWED_ORIGINS'>): Response {
	return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(request, env), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}

export async function authenticate(request: Request, env: RuntimeEnv): Promise<string> {
	const authorization = request.headers.get('authorization');
	if (!authorization?.startsWith('Bearer ')) throw new Error('authentication_required');
	const response = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { authorization, apikey: env.SUPABASE_SERVICE_ROLE_KEY } });
	if (!response.ok) throw new Error('authentication_required');
	const user = await response.json() as { id?: unknown };
	if (typeof user.id !== 'string') throw new Error('authentication_required');
	return user.id;
}

export async function rpc<T>(env: RuntimeEnv, name: string, parameters: Record<string, unknown>): Promise<T> {
	const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${name}`, {
		method: 'POST',
		headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json' },
		body: JSON.stringify(parameters),
	});
	if (!response.ok) {
		const error = await response.json().catch(() => ({})) as { code?: string; message?: string };
		throw new Error(error.code || error.message || `rpc_${name}_failed`);
	}
	return await response.json() as T;
}

export async function sha256(value: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
