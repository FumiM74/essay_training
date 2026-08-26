<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { authState, initializeAuth } from '$lib/features/auth/auth-state';
	import '../app.css';

	let { children } = $props();

	const navigation = [
		{ href: '/', label: 'ホーム' },
		{ href: '/tasks', label: '課題' },
		{ href: '/history', label: '履歴' },
		{ href: '/progress', label: '進捗' },
		{ href: '/account', label: 'アカウント' }
	];

	function isCurrent(href: string) {
		return href === '/' ? page.url.pathname === '/' : page.url.pathname.startsWith(href);
	}

	onMount(() => { void initializeAuth(); });
</script>

<svelte:head>
	<title>文章の型トレーニング</title>
	<meta name="description" content="小論文の文章の型を、少しずつ身につける学習アプリ" />
	<meta name="theme-color" content="#174e52" />
	<link rel="manifest" href="/manifest.webmanifest" />
	<link rel="icon" href="/app-icon.svg" />
</svelte:head>

<div class="app-shell">
	<header class="site-header">
		<a class="brand" href="/" aria-label="文章の型トレーニング ホーム">
			<span class="brand-mark">文</span>
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
			<a class="local-badge account-badge" href="/account"><i></i>ログイン</a>
		{/if}
	</header>
	{@render children()}
	<footer class="site-footer">
		<span>{$authState.status === 'local' ? 'データはこのブラウザ内だけに保存されます。' : 'ログインすると、学習データはアカウントに安全に保存されます。'}</span>
		<a href="/progress">学習状況を確認</a>
	</footer>
</div>
