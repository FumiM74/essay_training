<script lang="ts">
	import ActivityGrid from '$lib/components/ActivityGrid.svelte';
	import { getStage } from '$lib/data/curriculum';
	import { authState } from '$lib/features/auth/auth-state';
	import { completedStageCount, selectNextPracticeTask } from '$lib/features/learning/progression';
	import { emptyRemoteState, learningScopeForAuth, loadLearningState } from '$lib/features/learning/learning-service';

	let learning = $state(emptyRemoteState());
	let loadError = $state('');
	let learningLoaded = $state(false);
	let loadVersion = 0;
	let scope = $derived(learningScopeForAuth($authState));
	let completedStages = $derived(completedStageCount(learning.progress));
	let currentStage = $derived(getStage(learning.progress.currentStageId));
	let nextTask = $derived(selectNextPracticeTask(learning));
	let rate = $derived(Math.round((completedStages / 13) * 100));
	$effect(() => {
		const activeScope = scope;
		loadVersion += 1;
		const version = loadVersion;
		learningLoaded = false;
		if (!activeScope) { learning = emptyRemoteState(); loadError = ''; return; }
		void loadLearningState(activeScope).then((state) => { if (version === loadVersion) { learning = state; learningLoaded = true; loadError = ''; } }).catch(() => { if (version === loadVersion) loadError = '学習データを読み込めませんでした。再読み込みしてください。'; });
	});
</script>

<main>
	<section class="hero-row">
		<div><p class="eyebrow">ESSAY TRAINING</p><h1>短い一文から、<br />小論文の型を身につける。</h1><p class="lead">各段階で異なる問題に繰り返し取り組み、連続合格すると次の段階へ進みます。</p></div>
		{#if learningLoaded && nextTask}<a class="button" href={`/tasks/${nextTask.id}`}>{learning.submissions.length ? '学習を続ける' : '最初の問題を始める'}</a>{/if}
	</section>
	{#if loadError}<p class="notice error" role="alert">{loadError}</p>{/if}
	{#if scope && !learningLoaded && !loadError}<p class="notice">学習データを読み込んでいます。</p>{/if}
	<section class="section grid three">
		<article class="card"><p class="eyebrow">現在の段階</p><div class="stat"><strong>{learningLoaded ? learning.progress.currentStageId : '—'}</strong><span>/ 13</span></div><p class="muted">{learningLoaded ? currentStage?.name : 'ログイン後に表示します'}</p></article>
		<article class="card"><p class="eyebrow">連続合格</p><div class="stat"><strong>{learningLoaded ? learning.progress.consecutivePasses : '—'}</strong><span>/ {learningLoaded ? learning.progress.requiredConsecutivePasses : '—'}回</span></div><div class="progress-bar"><span style={`width:${learningLoaded ? Math.min(100, learning.progress.consecutivePasses / learning.progress.requiredConsecutivePasses * 100) : 0}%`}></span></div></article>
		<article class="card"><p class="eyebrow">完了した段階</p><div class="stat"><strong>{learningLoaded ? completedStages : '—'}</strong><span>/ 13段階</span></div><p class="muted">{learningLoaded ? `全体 ${rate}%` : 'ログイン後に表示します'}</p></article>
	</section>
	<section class="section grid two">
		<article class="card"><p class="eyebrow">次の問題</p>{#if learningLoaded && nextTask}<h2>ステップ {nextTask.stageId}　{nextTask.title}</h2><p>{nextTask.prompt}</p><a class="button secondary" href={`/tasks/${nextTask.id}`}>問題を開く</a>{:else if learningLoaded}<h2>全段階を修了しました</h2><p>段階13の問題には引き続き取り組めます。</p>{:else if scope}<p class="muted">読み込み中です。</p>{:else}<p class="muted">ログインすると現在の問題を確認できます。</p>{/if}</article>
		<article class="card"><ActivityGrid submissions={learning.submissions} /></article>
	</section>
</main>
