<script lang="ts">
	import ActivityGrid from '$lib/components/ActivityGrid.svelte';
	import { curriculum, getStage } from '$lib/data/curriculum';
	import { authState } from '$lib/features/auth/auth-state';
	import { completedStageCount, MAX_REQUIRED_CONSECUTIVE_PASSES, MIN_REQUIRED_CONSECUTIVE_PASSES, selectNextPracticeTask } from '$lib/features/learning/progression';
	import { emptyRemoteState, learningScopeForAuth, loadLearningState, saveCurrentStage, saveRequiredConsecutivePasses } from '$lib/features/learning/learning-service';

	let learning = $state(emptyRemoteState());
	let errorMessage = $state('');
	let settingMessage = $state('');
	let pending = $state(false);
	let learningLoaded = $state(false);
	let requiredInput = $state(3);
	let stageInput = $state(1);
	let loadVersion = 0;
	let scope = $derived(learningScopeForAuth($authState));
	let completedStages = $derived(completedStageCount(learning.progress));
	let rate = $derived(Math.round((completedStages / 13) * 100));
	let activityDays = $derived(new Set(learning.submissions.map((item) => new Date(item.submittedAt).toLocaleDateString('ja-JP'))).size);
	let currentStage = $derived(getStage(learning.progress.currentStageId));
	let nextTask = $derived(selectNextPracticeTask(learning));
	let choices = Array.from({ length: MAX_REQUIRED_CONSECUTIVE_PASSES - MIN_REQUIRED_CONSECUTIVE_PASSES + 1 }, (_, index) => index + MIN_REQUIRED_CONSECUTIVE_PASSES);
	$effect(() => {
		const activeScope = scope; loadVersion += 1; const version = loadVersion;
		learningLoaded = false;
		if (!activeScope) { learning = emptyRemoteState(); requiredInput = 3; errorMessage = ''; return; }
		void loadLearningState(activeScope).then((state) => { if (version === loadVersion) { learning = state; requiredInput = state.progress.requiredConsecutivePasses; stageInput = state.progress.currentStageId; learningLoaded = true; errorMessage = ''; } }).catch(() => { if (version === loadVersion) errorMessage = '学習進捗を読み込めませんでした。'; });
	});

	async function saveRequirement() {
		if (!scope) return;
		pending = true; settingMessage = ''; errorMessage = '';
		try {
			const progress = await saveRequiredConsecutivePasses(scope, Number(requiredInput));
			learning = { ...learning, progress };
			settingMessage = `進級条件を${progress.requiredConsecutivePasses}回の連続合格に変更しました。`;
		} catch { errorMessage = '進級条件を保存できませんでした。'; }
		finally { pending = false; }
	}

	async function changeStage() {
		if (!scope) return;
		pending = true; settingMessage = ''; errorMessage = '';
		try {
			const progress = await saveCurrentStage(scope, Number(stageInput));
			learning = { ...learning, progress };
			settingMessage = `段階${progress.currentStageId}へ移動しました。以前の問題履歴は維持されます。`;
		} catch { stageInput = learning.progress.currentStageId; errorMessage = '段階を変更できませんでした。'; }
		finally { pending = false; }
	}
</script>

<main>
	<p class="eyebrow">LEARNING PROGRESS</p><h1>学習進捗</h1><p class="lead">現在の段階、連続合格数、提出活動を確認できます。不合格になると現在段階の連続合格数は0に戻ります。</p>
	{#if errorMessage}<p class="notice error" role="alert">{errorMessage}</p>{/if}
	{#if scope && !learningLoaded && !errorMessage}<p class="notice">学習データを読み込んでいます。</p>{/if}
	{#if settingMessage}<p class="notice">{settingMessage}</p>{/if}
	<section class="section grid three"><article class="card"><p class="eyebrow">現在の段階</p><div class="stat"><strong>{learningLoaded ? learning.progress.currentStageId : '—'}</strong><span>/ 13</span></div><p class="muted">{learningLoaded ? currentStage?.name : 'ログイン後に表示します'}</p></article><article class="card"><p class="eyebrow">連続合格</p><div class="stat"><strong>{learningLoaded ? learning.progress.consecutivePasses : '—'}</strong><span>/ {learningLoaded ? learning.progress.requiredConsecutivePasses : '—'}回</span></div><div class="progress-bar"><span style={`width:${learningLoaded ? Math.min(100, learning.progress.consecutivePasses / learning.progress.requiredConsecutivePasses * 100) : 0}%`}></span></div></article><article class="card"><p class="eyebrow">完了段階</p><div class="stat"><strong>{learningLoaded ? completedStages : '—'}</strong><span>/ 13</span></div><p class="muted">{learningLoaded ? `活動 ${activityDays}日・全体 ${rate}%` : 'ログイン後に表示します'}</p></article></section>
	<section class="section grid two">
		<article class="card"><p class="eyebrow">進級条件</p><h2>必要な連続合格回数</h2><p class="muted">初期値は3回です。1〜10回から自分に合う難しさを選べます。</p><div class="setting-row"><select bind:value={requiredInput} aria-label="必要な連続合格回数" disabled={!scope || !learningLoaded || pending}>{#each choices as count}<option value={count}>{count}回</option>{/each}</select><button class="button secondary" onclick={() => void saveRequirement()} disabled={!scope || !learningLoaded || pending}>{pending ? '保存中…' : '設定を保存'}</button></div></article>
		<article class="card"><p class="eyebrow">取り組む段階</p><h2>到達済みの段階へ移動</h2><p class="muted">以前の段階へ戻っても、過去の問題傾向を記憶したまま新しい問題を選びます。</p><div class="setting-row"><select bind:value={stageInput} aria-label="取り組む段階" disabled={!scope || !learningLoaded || pending}>{#each curriculum.stages.filter((stage) => stage.id >= 1 && stage.id <= learning.progress.highestUnlockedStageId) as stage}<option value={stage.id}>段階{stage.id}：{stage.name}</option>{/each}</select><button class="button secondary" onclick={() => void changeStage()} disabled={!scope || !learningLoaded || pending || Number(stageInput) === learning.progress.currentStageId}>この段階へ移動</button></div></article>
	</section>
	<section class="section card"><p class="eyebrow">次の問題</p>{#if learningLoaded && nextTask}<h2>{nextTask.title}</h2><p>{nextTask.prompt}</p><a class="button secondary" href={`/tasks/${nextTask.id}`}>問題を開く</a>{:else if scope}<p class="muted">読み込み中です。</p>{:else}<p class="muted">ログインすると現在の問題を確認できます。</p>{/if}</section>
	{#if learningLoaded}<section class="section card"><ActivityGrid submissions={learning.submissions} /></section>{/if}
	<section class="section"><div class="section-header"><h2>段階別の状況</h2><a class="button secondary" href="/tasks">問題一覧へ</a></div><div class="task-list">{#each curriculum.stages.filter((stage) => stage.id > 0) as stage}<article class:locked={!learningLoaded || stage.id > learning.progress.highestUnlockedStageId} class="card task-card"><span class="stage">STEP {stage.id}</span><h2>{stage.name}</h2><p>{stage.passSummary}</p><footer><span class:done={learningLoaded && stage.id < learning.progress.highestUnlockedStageId} class="status">{!learningLoaded ? 'ログイン後に表示' : stage.id === learning.progress.currentStageId ? '学習中' : stage.id <= learning.progress.highestUnlockedStageId ? '到達済み' : '未解放'}</span><strong>{stage.id <= learning.progress.highestUnlockedStageId ? '反復可能' : '—'}</strong></footer></article>{/each}</div></section>
</main>
