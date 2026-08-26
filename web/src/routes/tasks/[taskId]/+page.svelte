<script lang="ts">
	import { onDestroy } from 'svelte';
	import { authState } from '$lib/features/auth/auth-state';
	import { createMockFeedback } from '$lib/features/learning/feedback';
	import { selectNextPracticeTask } from '$lib/features/learning/progression';
	import { issueProblem, learningScopeForAuth, loadLearningState, saveDraft, submit as submitLearning, type LearningScope } from '$lib/features/learning/learning-service';
	import { createSaveQueue } from '$lib/features/learning/save-queue';
	import type { FeedbackResult } from '$lib/types/contracts';
	import type { DraftRecord } from '$lib/types/learning';
	import { emptyLearningState } from '$lib/features/learning/local-store';

	let { data } = $props();
	let draft = $state('');
	let savedAt = $state('まだ保存されていません');
	let feedback = $state<FeedbackResult | null>(null);
	let errorMessage = $state('');
	let isSubmitting = $state(false);
	let learning = $state(emptyLearningState());
	let progressMessage = $state('');
	let learningLoaded = $state(false);
	let restoreVersion = 0;
	let pendingSubmissionId: string | null = null;
	let characterCount = $derived(draft.length);
	let scope = $derived(learningScopeForAuth($authState));
	let nextTask = $derived(selectNextPracticeTask(learning));
	let task = $derived(nextTask?.id === data.task.id ? nextTask : data.task);
	let isCurrentStage = $derived(task.stageId === learning.progress.currentStageId);
	let isRecommendedTask = $derived(nextTask?.id === task.id);
	let canLearn = $derived(scope !== null && learningLoaded && isCurrentStage && isRecommendedTask);
	const draftSaver = createSaveQueue<{ scope: LearningScope; taskId: string; text: string }, DraftRecord>(
		(job) => saveDraft(job.scope, job.taskId, job.text)
	);

	$effect(() => {
		const activeScope = scope;
		restoreVersion += 1;
		const version = restoreVersion;
		draftSaver.cancel();
		learningLoaded = false;
		if (!activeScope) {
			draft = '';
			savedAt = $authState.status === 'loading' ? '認証状態を確認中です' : 'ログインすると保存できます';
			return;
		}
		void restoreDraft(activeScope, version);
	});

	onDestroy(() => { void draftSaver.flush(); });

	async function restoreDraft(activeScope: LearningScope, version: number) {
		try {
			let state = await loadLearningState(activeScope);
			if (version !== restoreVersion) return;
			const recommended = selectNextPracticeTask(state);
			const wasIssued = state.problemHistory.some((item) => item.taskId === data.task.id);
			if (!wasIssued && recommended?.id === data.task.id) {
				await issueProblem(activeScope, recommended);
				state = await loadLearningState(activeScope);
			}
			learning = state;
			learningLoaded = true;
			const saved = state.drafts[task.id];
			draft = saved?.text ?? '';
			savedAt = saved ? `${new Date(saved.updatedAt).toLocaleString('ja-JP')}に保存` : 'まだ保存されていません';
		} catch { if (version === restoreVersion) errorMessage = '下書きを読み込めませんでした。'; }
	}

	function handleInput() {
		if (!scope) return;
		pendingSubmissionId = null;
		savedAt = '保存待ち';
		draftSaver.schedule(
			{ scope, taskId: task.id, text: draft },
			(saved) => { savedAt = `${new Date(saved.updatedAt).toLocaleTimeString('ja-JP')}に保存`; errorMessage = ''; },
			() => { errorMessage = '下書きを保存できませんでした。接続を確認して、もう一度入力してください。'; }
		);
	}

	async function submit() {
		if (!draft.trim() || !scope) return;
		isSubmitting = true;
		try {
			await draftSaver.flush();
			feedback = createMockFeedback(draft, task.stageId, task.features?.skillTargets);
			pendingSubmissionId ??= crypto.randomUUID();
			const previousStage = learning.progress.currentStageId;
			const submission = await submitLearning(scope, { requestId: pendingSubmissionId, taskId: task.id, stageId: task.stageId, taskTitle: task.title, text: draft, feedback });
			feedback = submission.feedback;
			learning = await loadLearningState(scope);
			progressMessage = learning.progress.currentStageId > previousStage
				? `連続合格を達成し、段階${learning.progress.currentStageId}へ進みました。`
				: feedback.decision === 'pass'
					? `連続合格 ${learning.progress.consecutivePasses} / ${learning.progress.requiredConsecutivePasses}回です。`
					: '不合格のため、連続合格数は0に戻りました。';
			pendingSubmissionId = null;
			savedAt = '提出履歴に保存しました';
			errorMessage = '';
		} catch {
			feedback = null;
			errorMessage = '提出を保存できませんでした。接続を確認して、もう一度お試しください。';
		} finally { isSubmitting = false; }
	}
</script>

<main>
	<p class="eyebrow">STEP {task.stageId}</p><h1>{task.title}</h1><p class="lead">{data.stage.purpose}。{$authState.status === 'signed-in' ? '入力内容はアカウントへ自動保存されます。' : $authState.status === 'local' ? '入力内容はこのブラウザへ自動保存されます。' : '続けるにはログインしてください。'}</p>
	{#if $authState.status === 'signed-out'}<p class="notice">学習記録を保存するには、<a href="/account"><strong>ログインまたは新規登録</strong></a>してください。</p>{/if}
	{#if scope && learningLoaded && !feedback && !isCurrentStage}<p class="notice">この問題は現在の段階ではありません。<a href="/tasks"><strong>現在の問題へ戻ってください。</strong></a></p>{:else if scope && learningLoaded && !feedback && !isRecommendedTask}<p class="notice">同じ問題の偏りを防ぐため、提出履歴から別の問題を選んでいます。{#if nextTask}<a href={`/tasks/${nextTask.id}`}><strong>今回の問題を開く</strong></a>{/if}</p>{/if}
	{#if errorMessage}<p class="notice error" role="alert">{errorMessage}</p>{/if}
	{#if progressMessage}<p class="notice">{progressMessage}</p>{/if}
	<section class="editor-layout">
		<article class="card"><p class="eyebrow">今回の課題</p><p class="prompt">{task.prompt}</p><div class="hint"><strong>ヒント</strong>{task.hint}</div><h3>合格の目安</h3><p class="muted">{data.stage.passSummary}</p>{#if data.stage.rubric.length}<ul class="rubric-list">{#each data.stage.rubric as item}<li><strong>{item.item}:</strong> {item.passCondition}</li>{/each}</ul>{/if}</article>
		<article class="card"><div class="editor-head"><div><p class="eyebrow">あなたの解答</p><small class="muted">{savedAt}</small></div><small class="muted">{characterCount}文字</small></div><textarea bind:value={draft} oninput={handleInput} placeholder="ここに解答を書いてください。" aria-label="解答" disabled={!canLearn}></textarea><div class="editor-actions"><small class="muted">提出するとモック添削が表示され、履歴と活動グリッドへ記録されます。</small><button class="button" onclick={submit} disabled={!draft.trim() || isSubmitting || !canLearn}>{isSubmitting ? '保存中…' : '添削を受け取る'}</button></div></article>
	</section>
	{#if feedback}
		<section class="card result"><div class="result-head"><div><p class="eyebrow">モック添削結果</p><h2>{feedback.decision === 'pass' ? 'この問題は合格です' : '次の問題で改善しましょう'}</h2></div><span class:revise={feedback.decision === 'revise'} class="decision">{feedback.decision === 'pass' ? '合格' : '要修正'}</span></div>{#each feedback.priorityFeedback as item}<h3>{item.title}</h3><p>{item.guidance}</p>{/each}<div class="editor-actions">{#if nextTask}<a class="button" href={`/tasks/${nextTask.id}`}>次の問題へ</a>{/if}<a class="button secondary" href="/history">履歴を見る</a></div></section>
	{/if}
</main>
