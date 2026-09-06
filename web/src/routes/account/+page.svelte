<script lang="ts">
	import { authState, signOut, updatePassword } from '$lib/features/auth/auth-state';
	import { isSupabaseConfigured } from '$lib/services/supabase';

	let mode = $state<'account' | 'update-password'>('account');
	let password = $state('');
	let passwordConfirmation = $state('');
	let message = $state('');
	let errorMessage = $state('');
	let pending = $state(false);

	$effect(() => {
		if ($authState.status === 'recovery') mode = 'update-password';
	});

	async function submit() {
		pending = true; message = ''; errorMessage = '';
		try {
			if (mode === 'update-password' && password !== passwordConfirmation) {
				errorMessage = '確認用パスワードが一致しません。';
				return;
			}
			const error = await updatePassword(password);
			if (error) errorMessage = error;
			else {
				message = 'パスワードを更新しました。';
				mode = 'account';
			}
		} catch {
			errorMessage = '通信に失敗しました。接続を確認して、もう一度お試しください。';
		} finally { pending = false; }
	}
</script>

<main>
	<h1>アカウント</h1>
	{#if !isSupabaseConfigured}
		<section class="card empty"><h2>Supabase接続を準備中です</h2><p class="muted">開発者が <code>web/.env.local</code> にProject URLとPublishable keyを設定すると、ここで登録・ログインできます。</p></section>
	{:else if $authState.status === 'error'}
		<section class="card empty"><h2>認証状態を確認できません</h2><p class="notice error" role="alert">{$authState.message}</p></section>
	{:else if $authState.status === 'signed-in' && mode === 'account'}
		<section class="card"><h2>ログイン中です</h2><p>{ $authState.user.email }</p><p><a href="/progress">学習状況を確認</a></p><button class="button secondary" onclick={() => void signOut()}>ログアウト</button></section>
	{:else if mode === 'update-password'}
		<section class="card auth-card">
			<h2>新しいパスワードを設定</h2>
			<form onsubmit={(event) => { event.preventDefault(); void submit(); }}>
				<label>新しいパスワード<input bind:value={password} type="password" autocomplete="new-password" minlength="8" required /></label>
				<label>新しいパスワード（確認）<input bind:value={passwordConfirmation} type="password" autocomplete="new-password" minlength="8" required /></label>
				{#if errorMessage}<p class="notice error" role="alert">{errorMessage}</p>{/if}
				{#if message}<p class="notice">{message}</p>{/if}
				<button class="button" disabled={pending}>{pending ? '処理中…' : 'パスワードを更新する'}</button>
			</form>
		</section>
	{:else}
		<section class="card empty"><h2>ログインが必要です</h2><a class="button" href="/login">ログイン・新規登録へ</a></section>
	{/if}
</main>
