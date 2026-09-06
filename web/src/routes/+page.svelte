<script lang="ts">
	import ActivityGrid from '$lib/components/ActivityGrid.svelte';
	import { getStage } from '$lib/data/curriculum';
	import { TOTAL_STAGE_COUNT } from '$lib/types/curriculum';
	import { authState } from '$lib/features/auth/auth-state';
	import { completedStageCount, phaseLabel, phaseTarget, selectNextPracticeTask, NO_NEW_PROBLEM_MESSAGE } from '$lib/features/learning/progression';
	import { emptyRemoteState, learningScopeForAuth, loadLearningState } from '$lib/features/learning/learning-service';

	let learning = $state(emptyRemoteState());
	let loadError = $state('');
	let learningLoaded = $state(false);
	let loadVersion = 0;
	let scope = $derived(learningScopeForAuth($authState));
	let completedStages = $derived(completedStageCount(learning.progress));
	let currentStage = $derived(getStage(learning.progress.currentStageId));
	let nextTask = $derived(selectNextPracticeTask(learning));
	let rate = $derived(Math.round((completedStages / TOTAL_STAGE_COUNT) * 100));
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
		<div><p class="eyebrow">ESSAY TRAINING</p><h1>短い一文から、<br />小論文の型を身につける。</h1><p class="lead">各段階で合格を積み重ね、進級テストに合格すると次の段階へ進みます。</p></div>
	</section>
	{#if loadError}<p class="notice error" role="alert">{loadError}</p>{/if}
	{#if scope && !learningLoaded && !loadError}<p class="notice">学習データを読み込んでいます。</p>{/if}
	<section class="section grid three">
		<article class="card"><p class="eyebrow">現在の段階</p><div class="stat"><strong>{learningLoaded ? learning.progress.currentStageId : '—'}</strong><span>/ {TOTAL_STAGE_COUNT}</span></div><p class="muted">{learningLoaded ? currentStage?.name : 'ログイン後に表示します'}</p></article>
		<article class="card"><p class="eyebrow">{learningLoaded ? phaseLabel(learning.progress.phase) : '学習状況'}</p><div class="stat"><strong>{learningLoaded ? learning.progress.phasePasses : '—'}</strong><span>/ {learningLoaded ? phaseTarget(learning.progress) : '—'}問合格</span></div><div class="progress-bar"><span style={`width:${learningLoaded ? Math.min(100, learning.progress.phasePasses / phaseTarget(learning.progress) * 100) : 0}%`}></span></div></article>
		<article class="card"><p class="eyebrow">完了した段階</p><div class="stat"><strong>{learningLoaded ? completedStages : '—'}</strong><span>/ {TOTAL_STAGE_COUNT}段階</span></div><p class="muted">{learningLoaded ? `全体 ${rate}%` : 'ログイン後に表示します'}</p></article>
	</section>
	<section class="section grid two">
		<article class="card"><p class="eyebrow">次の問題</p>{#if learningLoaded && nextTask}<h2>ステップ {nextTask.stageId}　{nextTask.title}</h2><p class="task-prompt">{nextTask.prompt}</p><a class="button" href={`/tasks/${nextTask.id}`}>学習を始める</a>{:else if learningLoaded}<p>{NO_NEW_PROBLEM_MESSAGE}</p><a class="button secondary" href="/tasks">課題トップ画面へ</a>{:else if scope}<p class="muted">読み込み中です。</p>{:else}<p class="muted">ログインすると現在の問題を確認できます。</p>{/if}</article>
		<article class="card"><ActivityGrid submissions={learning.submissions} /></article>
	</section>
</main>
