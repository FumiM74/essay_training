<script lang="ts">
	import { authState } from '$lib/features/auth/auth-state';
	import { emptyRemoteState, learningScopeForAuth, loadLearningState } from '$lib/features/learning/learning-service';
	import { phaseLabel, submissionDecisionLabel } from '$lib/features/learning/progression';
	import { questionSetHistoryItems } from '$lib/features/learning/submission-history';
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
	<p class="eyebrow">SUBMISSION HISTORY</p><h1>提出履歴</h1><p class="lead">提出した解答と添削結果を、新しい順に確認できます。</p>
	{#if errorMessage}<p class="notice error" role="alert">{errorMessage}</p>{/if}
	<section class="section history-list">
		{#if learning.submissions.length === 0}
			<div class="card empty"><h2>まだ提出履歴がありません</h2><p class="muted">課題を選び、最初の解答を提出してみましょう。</p><a class="button" href="/tasks">課題を選ぶ</a></div>
		{:else}
			{#each learning.submissions as item}
				<article class="card history-item">
					<div class="history-head">
						<div>
							<p class="eyebrow history-stage"><span>STEP {item.stageId}</span><span class="history-phase">{phaseLabel(item.phase)}</span></p>
							<h2>{item.taskTitle}</h2>
						</div>
						<span class:revise={item.feedback.decision === 'revise'} class="decision">{submissionDecisionLabel(item.phase, item.feedback.decision, item.stageId)}</span>
					</div>
					<time datetime={item.submittedAt}>{new Date(item.submittedAt).toLocaleString('ja-JP')}</time>
					{#if item.feedback.basicQuestionResults?.length}
						{@const questionResults = questionSetHistoryItems(item)}
						<section class="history-feedback-list" aria-label={`${questionResults.length}問すべての採点結果と説明`}>
							{#each questionResults as result}
								<article class="history-feedback-item history-question-card" class:needs-correction={Boolean(result.feedback?.title.includes('不正解'))}>
									<h3>問題{result.questionNumber}</h3>
									{#if result.question}
										<p class="history-question-instruction">{result.question.instruction}</p>
										<p class="history-question-prompt">{result.question.prompt}</p>
									{:else}
										<p class="muted">この過去データの問題文は復元できませんでした。</p>
									{/if}
									<p class="history-response"><strong>あなたの解答：</strong>{result.answer || '未解答'}</p>
									{#if result.feedback}
										<p class:incorrect={result.feedback.title.includes('不正解')} class="history-question-result"><strong>{result.feedback.title.replace(/^問題\d+：/, '')}</strong></p>
										<p>{result.feedback.guidance}</p>
									{/if}
								</article>
							{/each}
						</section>
					{:else}
						<p class="history-answer">{item.text}</p>
						{#if item.feedback.priorityFeedback[0]}
							<p class="muted"><strong>{item.feedback.priorityFeedback[0].title}</strong> — {item.feedback.priorityFeedback[0].guidance}</p>
						{/if}
					{/if}
					<a class="button secondary" href="/tasks">課題トップ画面へ</a>
				</article>
			{/each}
		{/if}
	</section>
</main>
