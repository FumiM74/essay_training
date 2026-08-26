import { browser, dev } from '$app/environment';
import { env } from '$env/dynamic/public';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/types/database';

const url = env.PUBLIC_SUPABASE_URL;
const publishableKey = env.PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const forceLocalDemo = dev && env.PUBLIC_LOCAL_DEMO === 'true';

export const isSupabaseConfigured = !forceLocalDemo && Boolean(url && publishableKey);

export const supabase: SupabaseClient<Database> | null = isSupabaseConfigured
	? createClient<Database>(url, publishableKey, {
			auth: { persistSession: browser, autoRefreshToken: browser, detectSessionInUrl: browser }
		})
	: null;

export function requireSupabase(): SupabaseClient<Database> {
	if (!supabase) throw new Error('Supabase接続情報が設定されていません。');
	return supabase;
}
