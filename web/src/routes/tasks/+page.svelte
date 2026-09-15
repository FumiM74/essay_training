<script lang="ts">
	import { goto } from '$app/navigation';
	import { curriculum } from '$lib/data/curriculum';
	import { authState } from '$lib/features/auth/auth-state';
	import { phaseLabel, phaseTarget, selectNextPracticeTask, NO_NEW_PROBLEM_MESSAGE } from '$lib/features/learning/progression';
	import { emptyRemoteState, learningScopeForAuth, loadLearningState, saveCurrentStage } from '$lib/features/learning/learning-service';

	let learning = $state(emptyRemoteState());
	let errorMessage = $state('');
	let learningLoaded = $state(false);
	let loadVersion = 0;
	let scope = $derived(learningScopeForAuth($authState));
	let pendingStage = $state<number | null>(null);
	let nextTask = $derived(selectNextPracticeTask(learning));
	let stages = curriculum.stages.filter((stage) => stage.id > 0);
	$effect(() => {
		const activeScope = scope; loadVersion += 1; const version = loadVersion;
		learningLoaded = false;
		if (!activeScope) { learning = emptyRemoteState(); errorMessage = ''; return; }
		void loadLearningState(activeScope).then((state) => { if (version === loadVersion) { learning = state; learningLoaded = true; errorMessage = ''; } }).catch(() => { if (version === loadVersion) errorMessage = '課題の進捗を読み込めませんでした。'; });
	});

	async function chooseStage(stageId: number) {
		if (!scope || stageId === learning.progress.currentStageId) return;
		pendingStage = stageId; errorMessage = '';
		try {
			const updated = { ...learning, progress: await saveCurrentStage(scope, stageId) };
			learning = updated;
			const task = selectNextPracticeTask(updated);
			if (!task) {
				errorMessage = NO_NEW_PROBLEM_MESSAGE;
				return;
			}
			await goto(`/tasks/${task.id}`);
		}
		catch { errorMessage = '段階を変更できませんでした。'; }
		finally { pendingStage = null; }
	}
</script>

<main>
	<p class="eyebrow">CURRICULUM</p><h1>14段階の反復トレーニング</h1><p class="lead">文の基本から本番形式の小論文まで、合格条件を満たすたびに段階的に進みます。問題履歴を使い、過去と同じ傾向を避けます。</p>
	{#if errorMessage}<p class="notice error" role="alert">{errorMessage}</p>{/if}
	{#if learningLoaded && nextTask}
		<section class="section card current-task"><div><p class="eyebrow">{phaseLabel(learning.progress.phase)}・STEP {nextTask.stageId}</p><h2>{nextTask.title}</h2><p class="current-task-prompt">{nextTask.prompt}</p><p class="muted">合格数 {learning.progress.phasePasses} / {phaseTarget(learning.progress)}問</p></div><div class="current-task-footer">{#if !learning.progress.easyFeedbackEnabled}<p class="feedback-setting-hint">解説が難しい場合は、<a href="/progress">進捗・設定画面</a>から、”添削をやさしい表現にする”をONにしてください。読みやすさを優先した解説を表示します。</p>{/if}<a class="button current-task-action" href={`/tasks/${nextTask.id}`}>取り組む</a></div></section>
	{:else if learningLoaded}<p class="notice">{NO_NEW_PROBLEM_MESSAGE}</p>{:else if scope && !errorMessage}<p class="notice">学習データを読み込んでいます。</p>{:else if !scope}<p class="notice">現在の問題を確認するにはログインしてください。</p>{/if}
	<section class="section task-list">
		{#each stages as stage}
			{@const reached = learningLoaded && stage.id <= learning.progress.highestUnlockedStageId}
			{@const current = learningLoaded && stage.id === learning.progress.currentStageId}
			{@const completed = learningLoaded && stage.id < learning.progress.highestUnlockedStageId}
			{@const frontier = learningLoaded && stage.id === learning.progress.highestUnlockedStageId}
			<article class:locked={!reached} class="card task-card"><span class="stage">STEP {stage.id}</span><h2>{stage.name}</h2><p>{stage.purpose}</p><footer><span class:done={completed && !current} class:learning={current || frontier} class="status">{!learningLoaded ? 'ログイン後に表示' : current && completed ? '復習中' : completed ? '完了' : frontier ? '学習中' : '未完了'}</span>{#if reached && !current}<button class="text-button" onclick={() => void chooseStage(stage.id)} disabled={pendingStage !== null}>{pendingStage === stage.id ? '変更中…' : frontier ? '学習に戻る' : '復習する'}</button>{/if}</footer></article>
		{/each}
	</section>
</main>
