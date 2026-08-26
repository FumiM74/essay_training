<script lang="ts">
	import { curriculum } from '$lib/data/curriculum';
	import { authState } from '$lib/features/auth/auth-state';
	import { selectNextPracticeTask } from '$lib/features/learning/progression';
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
		try { learning = { ...learning, progress: await saveCurrentStage(scope, stageId) }; }
		catch { errorMessage = '段階を変更できませんでした。'; }
		finally { pendingStage = null; }
	}
</script>

<main>
	<p class="eyebrow">CURRICULUM</p><h1>13段階の反復トレーニング</h1><p class="lead">合格条件を満たすまで、必要な数だけ問題を生成します。複数の特徴ベクトルと問題履歴を使い、過去と同じ傾向を避けます。</p>
	{#if errorMessage}<p class="notice error" role="alert">{errorMessage}</p>{/if}
	{#if learningLoaded && nextTask}
		<section class="section card current-task"><div><p class="eyebrow">現在の問題・STEP {nextTask.stageId}</p><h2>{nextTask.title}</h2><p>{nextTask.prompt}</p><p class="muted">連続合格 {learning.progress.consecutivePasses} / {learning.progress.requiredConsecutivePasses}回</p></div><a class="button" href={`/tasks/${nextTask.id}`}>取り組む</a></section>
	{:else if scope && !errorMessage}<p class="notice">学習データを読み込んでいます。</p>{:else if !scope}<p class="notice">現在の問題を確認するにはログインしてください。</p>{/if}
	<section class="section task-list">
		{#each stages as stage}
			{@const reached = learningLoaded && stage.id <= learning.progress.highestUnlockedStageId}
			{@const current = learningLoaded && stage.id === learning.progress.currentStageId}
			<article class:locked={!reached} class="card task-card"><span class="stage">STEP {stage.id}</span><h2>{stage.name}</h2><p>{stage.purpose}</p><footer><span class:done={reached && !current} class="status">{!learningLoaded ? 'ログイン後に表示' : current ? '学習中' : reached ? '到達済み' : '未解放'}</span>{#if reached && !current}<button class="text-button" onclick={() => void chooseStage(stage.id)} disabled={pendingStage !== null}>{pendingStage === stage.id ? '変更中…' : 'この段階を選ぶ'}</button>{:else if current}<strong>問題数に上限なし</strong>{/if}</footer></article>
		{/each}
	</section>
</main>
