import { browser } from '$app/environment';
import type { User } from '@supabase/supabase-js';
import { writable } from 'svelte/store';
import { isSupabaseConfigured, requireSupabase } from '$lib/services/supabase';

export type AuthState =
	| { status: 'loading'; user: null }
	| { status: 'local'; user: null }
	| { status: 'signed-out'; user: null }
	| { status: 'signed-in'; user: User }
	| { status: 'recovery'; user: User }
	| { status: 'error'; user: null; message: string };

export const authState = writable<AuthState>(isSupabaseConfigured ? { status: 'loading', user: null } : { status: 'local', user: null });

let initialized = false;

export async function initializeAuth(): Promise<void> {
	if (!browser || initialized) return;
	initialized = true;
	if (!isSupabaseConfigured) {
		authState.set({ status: 'local', user: null });
		return;
	}
	const client = requireSupabase();
	const { data, error } = await client.auth.getSession();
	if (error) {
		authState.set({ status: 'error', user: null, message: '認証状態を確認できませんでした。再読み込みしてください。' });
		return;
	}
	authState.set(data.session?.user ? { status: 'signed-in', user: data.session.user } : { status: 'signed-out', user: null });
	client.auth.onAuthStateChange((event, session) => {
		if (event === 'PASSWORD_RECOVERY' && session?.user) authState.set({ status: 'recovery', user: session.user });
		else authState.set(session?.user ? { status: 'signed-in', user: session.user } : { status: 'signed-out', user: null });
	});
}

export async function signUp(email: string, password: string, displayName: string): Promise<string | null> {
	const { error } = await requireSupabase().auth.signUp({
		email,
		password,
		options: { data: { display_name: displayName }, emailRedirectTo: `${window.location.origin}/account` }
	});
	return error?.message ?? null;
}

export async function signIn(email: string, password: string): Promise<string | null> {
	const { error } = await requireSupabase().auth.signInWithPassword({ email, password });
	return error?.message ?? null;
}

export async function sendPasswordReset(email: string): Promise<string | null> {
	const { error } = await requireSupabase().auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/account` });
	return error?.message ?? null;
}

export async function updatePassword(password: string): Promise<string | null> {
	const { error } = await requireSupabase().auth.updateUser({ password });
	if (!error) {
		const { data } = await requireSupabase().auth.getUser();
		if (data.user) authState.set({ status: 'signed-in', user: data.user });
	}
	return error?.message ?? null;
}

export async function signOut(): Promise<void> {
	await requireSupabase().auth.signOut();
}
