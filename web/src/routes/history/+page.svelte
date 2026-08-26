<script lang="ts">
	import { authState } from '$lib/features/auth/auth-state';
	import { emptyRemoteState, learningScopeForAuth, loadLearningState } from '$lib/features/learning/learning-service';
	let learning = $state(emptyRemoteState());
	let errorMessage = $state('');
	let loadVersion = 0;
	$effect(() => {
		const scope = learningScopeForAuth($authState); loadVersion += 1; const version = loadVersion;
		if (!scope) { learning = emptyRemoteState(); errorMessage = ''; return; }
		void loadLearningState(scope).then((state) => { if (version === loadVersion) { learning = state; errorMessage = ''; } }).catch(() => { if (version === loadVersion) errorMessage = '提出履歴を読み込めませんでした。'; });
	});
</script>

<main>
	<p class="eyebrow">SUBMISSION HISTORY</p><h1>提出履歴</h1><p class="lead">モック添削へ提出した文章と結果を、新しい順に確認できます。</p>
	{#if errorMessage}<p class="notice error" role="alert">{errorMessage}</p>{/if}
	<section class="section history-list">
		{#if learning.submissions.length === 0}
			<div class="card empty"><h2>まだ提出履歴がありません</h2><p class="muted">課題を選び、最初の解答を提出してみましょう。</p><a class="button" href="/tasks">課題を選ぶ</a></div>
		{:else}
			{#each learning.submissions as item}
				<article class="card history-item"><div class="history-head"><div><p class="eyebrow">STEP {item.stageId}</p><h2>{item.taskTitle}</h2></div><span class:revise={item.feedback.decision === 'revise'} class="decision">{item.feedback.decision === 'pass' ? '合格' : '要修正'}</span></div><time datetime={item.submittedAt}>{new Date(item.submittedAt).toLocaleString('ja-JP')}</time><p>{item.text}</p><p class="muted"><strong>{item.feedback.priorityFeedback[0]?.title}</strong> — {item.feedback.priorityFeedback[0]?.guidance}</p><a class="button secondary" href="/tasks">履歴と異なる次の問題へ</a></article>
			{/each}
		{/if}
	</section>
</main>
