<script lang="ts">
	import { authState, sendPasswordReset, signIn, signUp } from './auth-state';

	let mode = $state<'sign-in' | 'sign-up' | 'reset'>('sign-in');
	let email = $state('');
	let password = $state('');
	let displayName = $state('');
	let message = $state('');
	let errorMessage = $state('');
	let pending = $state(false);
	let registrationSent = $state(false);

	function changeMode(nextMode: typeof mode) {
		mode = nextMode;
		message = '';
		errorMessage = '';
		registrationSent = false;
	}

	async function submit() {
		pending = true;
		message = '';
		errorMessage = '';
		try {
			const error = mode === 'sign-in'
				? await signIn(email, password)
				: mode === 'sign-up'
					? await signUp(email, password, displayName.trim() || '学習者')
					: await sendPasswordReset(email);
			if (error) errorMessage = error;
			else if (mode === 'sign-up') registrationSent = true;
			else if (mode === 'reset') message = 'パスワード再設定メールを送信しました。';
		} catch {
			errorMessage = '通信に失敗しました。接続を確認して、もう一度お試しください。';
		} finally {
			pending = false;
		}
	}
</script>

<section class="card auth-card">
	{#if registrationSent}
		<div class="auth-confirmation" role="status">
			<span class="confirmation-mark" aria-hidden="true">✓</span>
			<p class="eyebrow">新規登録</p>
			<h2>確認メールを送りました</h2>
			<p><strong>{email}</strong> に確認メールを送信しました。</p>
			<p class="muted">メール内のリンクを開くと、登録が完了して学習を始められます。届かない場合は、迷惑メールフォルダも確認してください。</p>
			<button class="text-button" onclick={() => changeMode('sign-in')}>ログイン画面へ戻る</button>
		</div>
	{:else}
		<div class="auth-tabs" role="tablist" aria-label="認証方法">
			<button class:active={mode === 'sign-in'} role="tab" aria-selected={mode === 'sign-in'} onclick={() => changeMode('sign-in')}>ログイン</button>
			<button class:active={mode === 'sign-up'} role="tab" aria-selected={mode === 'sign-up'} onclick={() => changeMode('sign-up')}>新規登録</button>
		</div>
		<h2>{mode === 'sign-in' ? 'ログイン' : mode === 'sign-up' ? '初めての方はこちら' : 'パスワードを再設定'}</h2>
		{#if mode === 'sign-up'}
			<p class="muted">メールアドレスとパスワードで無料アカウントを作成します。</p>
		{/if}
		<form onsubmit={(event) => { event.preventDefault(); void submit(); }}>
			{#if mode === 'sign-up'}
				<label>表示名<input bind:value={displayName} maxlength="80" autocomplete="name" /></label>
			{/if}
			<label>メールアドレス<input bind:value={email} type="email" autocomplete="email" required /></label>
			{#if mode !== 'reset'}
				<label>パスワード<input bind:value={password} type="password" autocomplete={mode === 'sign-in' ? 'current-password' : 'new-password'} minlength="8" required /></label>
			{/if}
			{#if $authState.status === 'error'}
				<p class="notice error" role="alert">{$authState.message}</p>
			{/if}
			{#if errorMessage}<p class="notice error" role="alert">{errorMessage}</p>{/if}
			{#if message}<p class="notice" role="status">{message}</p>{/if}
			<button class="button" disabled={pending}>
				{pending ? '処理中…' : mode === 'sign-in' ? 'ログインする' : mode === 'sign-up' ? 'アカウントを登録する' : '再設定メールを送る'}
			</button>
		</form>
		{#if mode === 'sign-in'}
			<button class="text-button" onclick={() => changeMode('reset')}>パスワードを忘れた場合</button>
		{:else if mode === 'reset'}
			<button class="text-button" onclick={() => changeMode('sign-in')}>ログインへ戻る</button>
		{/if}
	{/if}
</section>
