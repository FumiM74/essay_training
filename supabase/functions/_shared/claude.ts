import type { RuntimeEnv } from './runtime.ts';
import { CLAUDE_FEEDBACK_SYSTEM } from './token-estimate.ts';

export type ClaudeUsage = {
	inputTokens: number;
	outputTokens: number;
	cacheCreationInputTokens: number;
	cacheReadInputTokens: number;
};

export type ClaudeResult = { id: string; value: unknown; usage: ClaudeUsage };

export class ClaudeError extends Error {
	constructor(public readonly code: string, public readonly providerRequestId = '', public readonly usage?: ClaudeUsage) {
		super(code);
		this.name = 'ClaudeError';
	}
}

export async function callClaude(env: RuntimeEnv, input: { model: string; maxTokens: number; prompt: string; schema: unknown; userId: string; system?: string }): Promise<ClaudeResult> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 45_000);
	let response: Response;
	try {
		response = await fetch('https://api.anthropic.com/v1/messages', {
			method: 'POST', signal: controller.signal,
			headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
			body: JSON.stringify({
				model: input.model, max_tokens: input.maxTokens,
				metadata: { user_id: input.userId },
				system: input.system ?? CLAUDE_FEEDBACK_SYSTEM,
				messages: [{ role: 'user', content: input.prompt }],
				output_config: { format: { type: 'json_schema', schema: input.schema } },
			}),
		});
	} catch (error) {
		throw new ClaudeError(error instanceof DOMException && error.name === 'AbortError' ? 'provider_timeout' : 'provider_network_error');
	} finally { clearTimeout(timeout); }
	const providerHeaderId = response.headers.get('request-id') || '';
	const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
	if (!response.ok) throw new ClaudeError(`provider_http_${response.status}`, providerHeaderId);
	const usageRaw = payload.usage as Record<string, unknown> | undefined;
	const usage: ClaudeUsage = {
		inputTokens: Number(usageRaw?.input_tokens ?? 0), outputTokens: Number(usageRaw?.output_tokens ?? 0),
		cacheCreationInputTokens: Number(usageRaw?.cache_creation_input_tokens ?? 0), cacheReadInputTokens: Number(usageRaw?.cache_read_input_tokens ?? 0),
	};
	const id = typeof payload.id === 'string' ? payload.id : providerHeaderId;
	const content = Array.isArray(payload.content) ? payload.content : [];
	const textBlock = content.find((item) => item && typeof item === 'object' && (item as Record<string, unknown>).type === 'text') as Record<string, unknown> | undefined;
	if (!textBlock || typeof textBlock.text !== 'string') throw new ClaudeError('provider_missing_output', id, usage);
	try { return { id, value: JSON.parse(textBlock.text), usage }; }
	catch { throw new ClaudeError('provider_invalid_json', id, usage); }
}
