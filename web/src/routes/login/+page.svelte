<script lang="ts">
	import AuthPanel from '$lib/features/auth/AuthPanel.svelte';
	import { isSupabaseConfigured } from '$lib/services/supabase';
</script>

<svelte:head><title>ログイン・新規登録 | 文章の型トレーニング</title></svelte:head>

<main class="auth-page">
	<section class="auth-intro">
		<p class="eyebrow">文章の型トレーニング</p>
		<h1>学習を始める</h1>
		<p class="lead">ログインすると続きから学習できます。初めての方は「新規登録」を選んでください。</p>
	</section>
	{#if isSupabaseConfigured}
		<AuthPanel />
	{:else}
		<section class="card auth-card empty">
			<h2>ローカル体験版です</h2>
			<p class="muted">この環境ではアカウント登録を使用しません。</p>
			<a class="button" href="/">体験版を開く</a>
		</section>
	{/if}
</main>
