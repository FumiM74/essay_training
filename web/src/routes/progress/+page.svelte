<script lang="ts">
	import ActivityGrid from '$lib/components/ActivityGrid.svelte';
	import { essayTopics } from '$lib/data/essay-topic-bank';
	import { curriculum, getStage } from '$lib/data/curriculum';
	import { TOTAL_STAGE_COUNT } from '$lib/types/curriculum';
	import { authState } from '$lib/features/auth/auth-state';
	import { completedStageCount, MAX_PROGRESSION_COUNT, MIN_PROGRESSION_COUNT, phaseLabel, phaseTarget, selectNextPracticeTask, NO_NEW_PROBLEM_MESSAGE } from '$lib/features/learning/progression';
	import { emptyRemoteState, learningScopeForAuth, loadLearningState, saveCurrentStage, saveFeedbackPreference, saveProgressionSettings, saveTopicPreference } from '$lib/features/learning/learning-service';
	import { MAX_CUSTOM_TOPIC_CHARACTERS } from '$lib/features/learning/topic-preferences';
	import type { TopicSelectionMode } from '$lib/types/learning';

	let learning = $state(emptyRemoteState());
	let errorMessage = $state('');
	let settingMessage = $state('');
	let pending = $state(false);
	let learningLoaded = $state(false);
	let requiredTrainingInput = $state(10);
	let promotionTestInput = $state(3);
	let stageInput = $state(1);
	let easyFeedbackInput = $state(false);
	let topicModeInput = $state<TopicSelectionMode>('random');
	let customTopicInputs = $state(['', '', '']);
	let loadVersion = 0;
	let scope = $derived(learningScopeForAuth($authState));
	let completedStages = $derived(completedStageCount(learning.progress));
	let rate = $derived(Math.round((completedStages / TOTAL_STAGE_COUNT) * 100));
	let activityDays = $derived(new Set(learning.submissions.map((item) => new Date(item.submittedAt).toLocaleDateString('ja-JP'))).size);
	let currentStage = $derived(getStage(learning.progress.currentStageId));
	let nextTask = $derived(selectNextPracticeTask(learning));
	let choices = Array.from({ length: MAX_PROGRESSION_COUNT - MIN_PROGRESSION_COUNT + 1 }, (_, index) => index + MIN_PROGRESSION_COUNT);
	$effect(() => {
		const activeScope = scope; loadVersion += 1; const version = loadVersion;
		learningLoaded = false;
		if (!activeScope) { learning = emptyRemoteState(); requiredTrainingInput = 10; promotionTestInput = 3; stageInput = 1; easyFeedbackInput = false; topicModeInput = 'random'; customTopicInputs = ['', '', '']; errorMessage = ''; return; }
		void loadLearningState(activeScope).then((state) => { if (version === loadVersion) { learning = state; requiredTrainingInput = state.progress.requiredTrainingPasses; promotionTestInput = state.progress.promotionTestQuestionCount; stageInput = state.progress.currentStageId; easyFeedbackInput = state.progress.easyFeedbackEnabled; topicModeInput = state.progress.topicSelectionMode; customTopicInputs = [...state.progress.customTopics, '', '', ''].slice(0, 3); learningLoaded = true; errorMessage = ''; } }).catch(() => { if (version === loadVersion) errorMessage = '学習進捗を読み込めませんでした。'; });
	});

	function topicCharacters(value: string) { return Array.from(value).length; }

	async function saveTopics() {
		if (!scope) return;
		pending = true; settingMessage = ''; errorMessage = '';
		try {
			const progress = await saveTopicPreference(scope, topicModeInput, customTopicInputs);
			learning = { ...learning, progress };
			customTopicInputs = [...progress.customTopics, '', '', ''].slice(0, 3);
			settingMessage = topicModeInput === 'random' ? '論点をランダムに選ぶ設定を保存しました。' : '自由設定のテーマを保存しました。次に始める問題から反映されます。';
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'テーマ設定を保存できませんでした。';
		} finally { pending = false; }
	}

	async function saveRequirement() {
		if (!scope) return;
		pending = true; settingMessage = ''; errorMessage = '';
		try {
			const progress = await saveProgressionSettings(scope, { requiredTrainingPasses: Number(requiredTrainingInput), promotionTestQuestionCount: Number(promotionTestInput), requiredRetrainingPasses: learning.progress.requiredRetrainingPasses });
			learning = { ...learning, progress };
			settingMessage = '進級条件を保存しました。現在までの合格数は維持されます。';
		} catch { errorMessage = '進級条件を保存できませんでした。'; }
		finally { pending = false; }
	}

	async function changeEasyFeedback() {
		if (!scope) return;
		const requested = easyFeedbackInput;
		pending = true; settingMessage = ''; errorMessage = '';
		try {
			const progress = await saveFeedbackPreference(scope, requested);
			learning = { ...learning, progress };
			settingMessage = requested ? 'やさしい解説を使用します。次の提出から反映されます。' : '通常の解説を使用します。次の提出から反映されます。';
		} catch {
			easyFeedbackInput = learning.progress.easyFeedbackEnabled;
			errorMessage = '解説の難易度を保存できませんでした。';
		} finally { pending = false; }
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
	<p class="eyebrow">LEARNING PROGRESS</p><h1>学習進捗・設定</h1><p class="lead">現在の段階、学習フェーズ、合格数を確認できます。進級テストは合格数を維持したまま、規定数に達するまで続きます。</p>
	{#if errorMessage}<p class="notice error" role="alert">{errorMessage}</p>{/if}
	{#if scope && !learningLoaded && !errorMessage}<p class="notice">学習データを読み込んでいます。</p>{/if}
	{#if settingMessage}<p class="notice">{settingMessage}</p>{/if}
	<section class="section grid three"><article class="card"><p class="eyebrow">現在の段階</p><div class="stat"><strong>{learningLoaded ? learning.progress.currentStageId : '—'}</strong><span>/ {TOTAL_STAGE_COUNT}</span></div><p class="muted">{learningLoaded ? currentStage?.name : 'ログイン後に表示します'}</p></article><article class="card"><p class="eyebrow">{learningLoaded ? phaseLabel(learning.progress.phase) : '学習状況'}</p><div class="stat"><strong>{learningLoaded ? learning.progress.phasePasses : '—'}</strong><span>/ {learningLoaded ? phaseTarget(learning.progress) : '—'}問合格</span></div><div class="progress-bar"><span style={`width:${learningLoaded ? Math.min(100, learning.progress.phasePasses / phaseTarget(learning.progress) * 100) : 0}%`}></span></div></article><article class="card"><p class="eyebrow">完了段階</p><div class="stat"><strong>{learningLoaded ? completedStages : '—'}</strong><span>/ {TOTAL_STAGE_COUNT}</span></div><p class="muted">{learningLoaded ? `活動 ${activityDays}日・全体 ${rate}%` : 'ログイン後に表示します'}</p></article></section>
	<section class="section grid two">
		<article class="card"><p class="eyebrow">進級条件</p><h2>学習ループの回数設定</h2><p class="muted">トレーニングは初期値10問、進級テストは初期値3問です。1〜10問で変更できます。</p><label>進級テスト前に必要な合格数<select bind:value={requiredTrainingInput} aria-label="進級テスト前に必要な合格数" disabled={!scope || !learningLoaded || pending}>{#each choices as count}<option value={count}>{count}問</option>{/each}</select></label><label>進級テストで必要な合格数<select bind:value={promotionTestInput} aria-label="進級テストで必要な合格数" disabled={!scope || !learningLoaded || pending}>{#each choices as count}<option value={count}>{count}問</option>{/each}</select></label><div class="setting-row"><button class="button secondary" onclick={() => void saveRequirement()} disabled={!scope || !learningLoaded || pending}>{pending ? '保存中…' : '設定を保存'}</button></div></article>
		<article class="card"><p class="eyebrow">取り組む段階</p><h2>到達済みの段階へ移動</h2><p class="muted">以前の段階へ戻っても、過去の問題傾向を記憶したまま新しい問題を選びます。</p><div class="setting-row"><select bind:value={stageInput} aria-label="取り組む段階" disabled={!scope || !learningLoaded || pending}>{#each curriculum.stages.filter((stage) => stage.id >= 1 && stage.id <= learning.progress.highestUnlockedStageId) as stage}<option value={stage.id}>段階{stage.id}：{stage.name}</option>{/each}</select><button class="button secondary" onclick={() => void changeStage()} disabled={!scope || !learningLoaded || pending || Number(stageInput) === learning.progress.currentStageId}>この段階へ移動</button></div></article>
	</section>
	<section class="section card"><p class="eyebrow">解説の難易度</p><h2>添削をやさしい表現にする</h2><p class="muted">ONにすると解説をやさしい表現で返します。解説文が長くなったり、最適な表現から若干ズレる場合もありますが、読みやすく学習を進めやすい表現になることを優先します。合否や採点基準は変わりません。</p><label class="toggle-setting"><input type="checkbox" role="switch" bind:checked={easyFeedbackInput} onchange={() => void changeEasyFeedback()} disabled={!scope || !learningLoaded || pending} /><span class="toggle-track" aria-hidden="true"><span></span></span><strong>{easyFeedbackInput ? 'ON・やさしい解説' : 'OFF・通常の解説'}</strong></label></section>
	<section class="section card topic-settings">
		<p class="eyebrow">問題のテーマ</p><h2>STEP 4以降で取り組む論点</h2>
		<p class="muted">ランダムでは、大学入試を想定した{essayTopics.length}の論点から、過去の出題と偏らない問題を選びます。自由設定では、入力したテーマを使って問題を作ります。解答中の問題は変更されません。</p>
		<div class="topic-mode-options" role="radiogroup" aria-label="問題のテーマ設定">
			<label><input type="radio" bind:group={topicModeInput} value="random" disabled={!scope || !learningLoaded || pending} /><span><strong>ランダム</strong><small>登録済みの論点から選ぶ（デフォルト）</small></span></label>
			<label><input type="radio" bind:group={topicModeInput} value="custom" disabled={!scope || !learningLoaded || pending} /><span><strong>自由設定</strong><small>自分で入力したテーマから選ぶ</small></span></label>
		</div>
		{#if topicModeInput === 'custom'}
			<div class="custom-topic-list">
				{#each customTopicInputs as topic, index}
					<label>テーマ {index + 1}<input type="text" bind:value={customTopicInputs[index]} maxlength={MAX_CUSTOM_TOPIC_CHARACTERS} placeholder={index === 0 ? '例：少子化と教育' : '任意'} disabled={!scope || !learningLoaded || pending} /><small>{topicCharacters(topic)} / {MAX_CUSTOM_TOPIC_CHARACTERS}文字</small></label>
				{/each}
			</div>
			<p class="muted">20文字以内で簡潔に入力してください。1つ以上、3つまで設定できます。</p>
		{/if}
		<div class="setting-row"><button class="button secondary" onclick={() => void saveTopics()} disabled={!scope || !learningLoaded || pending}>{pending ? '保存中…' : 'テーマ設定を保存'}</button></div>
	</section>
	<section class="section card"><p class="eyebrow">次の問題</p>{#if learningLoaded && nextTask}<h2>{nextTask.title}</h2><p class="task-prompt">{nextTask.prompt}</p><a class="button secondary" href={`/tasks/${nextTask.id}`}>問題を開く</a>{:else if learningLoaded}<p>{NO_NEW_PROBLEM_MESSAGE}</p>{:else if scope}<p class="muted">読み込み中です。</p>{:else}<p class="muted">ログインすると現在の問題を確認できます。</p>{/if}</section>
	{#if learningLoaded}<section class="section card"><ActivityGrid submissions={learning.submissions} /></section>{/if}
	<section class="section"><div class="section-header"><h2>段階別の状況</h2><a class="button secondary" href="/tasks">問題一覧へ</a></div><div class="task-list">{#each curriculum.stages.filter((stage) => stage.id > 0) as stage}{@const completed = learningLoaded && stage.id < learning.progress.highestUnlockedStageId}{@const current = learningLoaded && stage.id === learning.progress.currentStageId}{@const frontier = learningLoaded && stage.id === learning.progress.highestUnlockedStageId}<article class:locked={!learningLoaded || stage.id > learning.progress.highestUnlockedStageId} class="card task-card"><span class="stage">STEP {stage.id}</span><h2>{stage.name}</h2><p>{stage.passSummary}</p><footer><span class:done={completed && !current} class="status">{!learningLoaded ? 'ログイン後に表示' : current && completed ? '復習中' : completed ? '完了' : frontier ? '学習中' : '未完了'}</span><strong>{completed ? '復習可能' : frontier ? '続きから' : '—'}</strong></footer></article>{/each}</div></section>
</main>
