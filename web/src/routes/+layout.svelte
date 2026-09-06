<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { authState, initializeAuth } from '$lib/features/auth/auth-state';
	import { authRedirectTarget } from '$lib/features/auth/auth-routing';
	import { isSupabaseConfigured } from '$lib/services/supabase';
	import '../app.css';

	let { children } = $props();

	const navigation = [
		{ href: '/', label: 'ホーム' },
		{ href: '/tasks', label: '課題' },
		{ href: '/history', label: '履歴' },
		{ href: '/progress', label: '進捗・設定' },
		{ href: '/account', label: 'アカウント' }
	];

	function isCurrent(href: string) {
		return href === '/' ? page.url.pathname === '/' : page.url.pathname.startsWith(href);
	}

	let pendingRedirect = $state<string | null>(null);
	const isLoginPage = $derived(page.url.pathname === '/login');

	$effect(() => {
		const target = authRedirectTarget($authState.status, page.url.pathname, isSupabaseConfigured);
		if (!target || target === pendingRedirect) return;
		pendingRedirect = target;
		void goto(target, { replaceState: true }).finally(() => { pendingRedirect = null; });
	});

	onMount(() => { void initializeAuth(); });
</script>

<svelte:head>
	<title>文章の型トレーニング</title>
	<meta name="description" content="小論文の文章の型を、少しずつ身につける学習アプリ" />
	<meta name="theme-color" content="#174e52" />
	<link rel="manifest" href="/manifest.webmanifest" />
	<link rel="icon" href="/app-icon.svg" />
</svelte:head>

{#if isLoginPage}
	<div class="auth-shell">
		<header class="auth-header">
			<a class="brand" href="/login" aria-label="文章の型トレーニング">
				<span class="brand-mark" aria-hidden="true"></span>
				<span><strong>文章の型</strong><small>トレーニング</small></span>
			</a>
		</header>
		{@render children()}
	</div>
{:else if isSupabaseConfigured && ($authState.status === 'loading' || pendingRedirect)}
	<div class="auth-loading" role="status">
		<span class="brand-mark" aria-hidden="true"></span>
		<p>認証状態を確認しています…</p>
	</div>
{:else}
<div class="app-shell">
	<header class="site-header">
		<a class="brand" href="/" aria-label="文章の型トレーニング ホーム">
			<span class="brand-mark" aria-hidden="true"></span>
			<span><strong>文章の型</strong><small>トレーニング</small></span>
		</a>
		<nav aria-label="メインナビゲーション">
			{#each navigation as item}
				<a href={item.href} aria-current={isCurrent(item.href) ? 'page' : undefined}>{item.label}</a>
			{/each}
		</nav>
		{#if $authState.status === 'signed-in'}
			<a class="local-badge account-badge" href="/account"><i></i>{$authState.user.email}</a>
		{:else if $authState.status === 'local'}
			<span class="local-badge"><i></i>ローカル体験版</span>
		{:else}
			<a class="local-badge account-badge" href="/login"><i></i>ログイン</a>
		{/if}
	</header>
	{@render children()}
</div>
{/if}
