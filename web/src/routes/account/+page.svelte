<script lang="ts">
	import { authState, sendPasswordReset, signIn, signOut, signUp, updatePassword } from '$lib/features/auth/auth-state';
	import { isSupabaseConfigured } from '$lib/services/supabase';

	let mode = $state<'sign-in' | 'sign-up' | 'reset' | 'update-password'>('sign-in');
	let email = $state('');
	let password = $state('');
	let displayName = $state('');
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
			const error = mode === 'sign-in'
				? await signIn(email, password)
				: mode === 'sign-up'
					? await signUp(email, password, displayName.trim() || '学習者')
					: mode === 'reset'
						? await sendPasswordReset(email)
						: await updatePassword(password);
			if (error) errorMessage = error;
			else {
				message = mode === 'sign-up' ? '確認メールを送信しました。メール内のリンクを開いて登録を完了してください。' : mode === 'reset' ? 'パスワード再設定メールを送信しました。' : mode === 'update-password' ? 'パスワードを更新しました。' : 'ログインしました。';
				if (mode === 'update-password') mode = 'sign-in';
			}
		} catch {
			errorMessage = '通信に失敗しました。接続を確認して、もう一度お試しください。';
		} finally { pending = false; }
	}
</script>

<main>
	<p class="eyebrow">ACCOUNT</p><h1>アカウント</h1>
	{#if !isSupabaseConfigured}
		<section class="card empty"><h2>Supabase接続を準備中です</h2><p class="muted">開発者が <code>web/.env.local</code> にProject URLとPublishable keyを設定すると、ここで登録・ログインできます。</p></section>
	{:else if $authState.status === 'error'}
		<section class="card empty"><h2>認証状態を確認できません</h2><p class="notice error" role="alert">{$authState.message}</p></section>
	{:else if $authState.status === 'signed-in' && mode !== 'update-password'}
		<section class="card"><h2>ログイン中です</h2><p>{ $authState.user.email }</p><p class="muted">提出、下書き、進捗はこのアカウントに保存されます。</p><button class="button secondary" onclick={() => void signOut()}>ログアウト</button></section>
	{:else}
		<section class="card auth-card"><div class="auth-tabs"><button class:active={mode === 'sign-in'} onclick={() => (mode = 'sign-in')}>ログイン</button><button class:active={mode === 'sign-up'} onclick={() => (mode = 'sign-up')}>新規登録</button></div>
			<h2>{mode === 'sign-in' ? 'ログイン' : mode === 'sign-up' ? '新規登録' : mode === 'reset' ? 'パスワード再設定メール' : '新しいパスワードを設定'}</h2>
			<form onsubmit={(event) => { event.preventDefault(); void submit(); }}>
				{#if mode === 'sign-up'}<label>表示名<input bind:value={displayName} maxlength="80" autocomplete="name" /></label>{/if}
				{#if mode !== 'update-password'}<label>メールアドレス<input bind:value={email} type="email" autocomplete="email" required /></label>{/if}
				{#if mode !== 'reset'}<label>{mode === 'update-password' ? '新しいパスワード' : 'パスワード'}<input bind:value={password} type="password" autocomplete={mode === 'sign-in' ? 'current-password' : 'new-password'} minlength="8" required /></label>{/if}
				{#if mode === 'update-password'}<label>新しいパスワード（確認）<input bind:value={passwordConfirmation} type="password" autocomplete="new-password" minlength="8" required /></label>{/if}
				{#if errorMessage}<p class="notice error" role="alert">{errorMessage}</p>{/if}
				{#if message}<p class="notice">{message}</p>{/if}
				<button class="button" disabled={pending}>{pending ? '処理中…' : mode === 'sign-in' ? 'ログインする' : mode === 'sign-up' ? '登録する' : mode === 'reset' ? 'メールを送る' : 'パスワードを更新する'}</button>
			</form>
			{#if mode === 'sign-in' || mode === 'sign-up'}<button class="text-button" onclick={() => (mode = 'reset')}>パスワードを忘れた場合</button>{:else if mode === 'reset'}<button class="text-button" onclick={() => (mode = 'sign-in')}>ログインへ戻る</button>{/if}
		</section>
	{/if}
</main>
