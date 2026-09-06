<script lang="ts">
	import { onDestroy, tick } from 'svelte';
	import { authState } from '$lib/features/auth/auth-state';
	import { createBasicQuestionSetFeedback, createMockFeedback } from '$lib/features/learning/feedback';
	import { restoreBasicAnswers } from '$lib/features/learning/basic-revision';
	import { stageAnswerExampleFor } from '$lib/features/learning/learning-design';
	import { phaseLabel, phaseTarget, selectNextPracticeTask, submissionProgressMessage } from '$lib/features/learning/progression';
	import { issueProblem, learningLoadErrorMessage, learningScopeForAuth, loadLearningState, problemIssueError, saveDraft, shouldReuseSubmissionRequest, submissionErrorMessage, submit as submitLearning, type LearningScope } from '$lib/features/learning/learning-service';
	import { createSaveQueue } from '$lib/features/learning/save-queue';
	import { captureSubmission, saveThenRefresh, type SubmissionSnapshot } from '$lib/features/learning/submission-workflow';
	import { canAnswerTask, resultProgress, taskResultAction } from '$lib/features/learning/task-flow';
	import type { FeedbackResult } from '$lib/types/contracts';
	import type { DraftRecord } from '$lib/types/learning';
	import { emptyLearningState } from '$lib/features/learning/local-store';

	let { data } = $props();
	let draft = $state('');
	let basicAnswers = $state<Record<string, string>>({});
	let basicEditor = $state<HTMLDivElement>();
	function isCorrectAlready(questionId: string) { return revisionResults.some((r) => r.questionId === questionId && r.correct); }
	function needsCorrection(questionId: string) { return revisionResults.some((r) => r.questionId === questionId && !r.correct); }
	let savedAt = $state('まだ保存されていません');
	let feedback = $state<FeedbackResult | null>(null);
	let errorMessage = $state('');
	let isSubmitting = $state(false);
	let learning = $state(emptyLearningState());
	let progressMessage = $state('');
	let screen = $state<'answer' | 'result' | 'revision'>('answer');
	let revisionResults = $derived(screen === 'revision' ? feedback?.basicQuestionResults ?? [] : []);
	let resultPhase = $state<'training' | 'promotion_test' | 'retraining' | null>(null);
	let learningLoaded = $state(false);
	let resultSyncPending = $state(false);
	let submittedSnapshot = $state<SubmissionSnapshot | null>(null);
	let resultSection = $state<HTMLElement | null>(null);
	let resultSummary = $state<HTMLElement | null>(null);
	let answerTextarea = $state<HTMLTextAreaElement | null>(null);
	let restoreVersion = 0;
	let pendingSubmissionId: string | null = null;
	let characterCount = $derived(draft.length);
	let scope = $derived(learningScopeForAuth($authState));
	let nextTask = $derived(selectNextPracticeTask(learning));
	let task = $derived(nextTask?.id === data.task.id ? nextTask : data.task);
	let isCurrentStage = $derived(task.stageId === learning.progress.currentStageId);
	let isRecommendedTask = $derived(nextTask?.id === task.id);
	let isActiveTask = $derived(learning.problemHistory.some((item) => item.taskId === task.id && item.stageId === task.stageId && item.submittedAt === null));
	let canEdit = $derived(canAnswerTask({ hasScope: scope !== null, learningLoaded, isCurrentStage, isRecommendedTask, isActiveTask, isResultScreen: screen === 'result', isSubmitting }));
	let isQuestionSet = $derived(Boolean(task.questionSet?.length));
	let basicAnswersComplete = $derived(Boolean(task.questionSet?.every((question) => basicAnswers[question.id]?.trim())));
	let canSubmitAnswer = $derived(isQuestionSet ? basicAnswersComplete : Boolean(draft.trim()));
	let displayedProgress = $derived(screen === 'result' && submittedSnapshot && feedback
		? resultProgress(submittedSnapshot.progress, feedback.decision, resultSyncPending ? undefined : learning.progress)
		: learning.progress);
	let isPromotionTest = $derived(displayedProgress.phase !== 'training');
	let resultIsPromotionTest = $derived(resultPhase !== null && resultPhase !== 'training');
	let resultAction = $derived(feedback && resultPhase ? taskResultAction({ decision: feedback.decision, phase: resultPhase, stageId: task.stageId, courseCompleted: !resultSyncPending && learning.progress.courseCompletedAt !== null && resultPhase === 'promotion_test' && learning.progress.phase === 'training' }) : null);
	let answerExample = $derived(stageAnswerExampleFor(task.stageId));
	let feedbackEvidence = $derived(feedback ? [...new Set(feedback.skillResults.map((item) => item.evidence).filter(Boolean))] : []);
	const draftSaver = createSaveQueue<{ scope: LearningScope; taskId: string; text: string }, DraftRecord>(
		(job) => saveDraft(job.scope, job.taskId, job.text)
	);

	$effect(() => {
		const activeScope = scope;
		const activeTaskId = data.task.id;
		restoreVersion += 1;
		const version = restoreVersion;
		draftSaver.cancel();
		draft = '';
		basicAnswers = {};
		feedback = null;
		progressMessage = '';
		errorMessage = '';
		pendingSubmissionId = null;
		resultPhase = null;
		screen = 'answer';
		resultSyncPending = false;
		submittedSnapshot = null;
		isSubmitting = false;
		learningLoaded = false;
		if (!activeScope) {
			draft = '';
			savedAt = $authState.status === 'loading' ? '認証状態を確認中です' : 'ログインすると保存できます';
			return;
		}
		void restoreDraft(activeScope, version, activeTaskId);
	});

	onDestroy(() => { restoreVersion += 1; void draftSaver.flush(); });

	async function restoreDraft(activeScope: LearningScope, version: number, activeTaskId: string) {
		try {
			let state = await loadLearningState(activeScope);
			if (version !== restoreVersion) return;
			const recommended = selectNextPracticeTask(state);
			const issued = state.problemHistory.find((item) => item.taskId === activeTaskId && item.submittedAt === null);
			const needsCurrentProblemCopy = Boolean(issued && recommended?.features
				&& issued.features.generation.promptVersion !== recommended.features.generation.promptVersion);
			if ((!issued || needsCurrentProblemCopy) && recommended?.id === activeTaskId) {
				try { await issueProblem(activeScope, recommended); }
				catch (error) { throw problemIssueError(error); }
				state = await loadLearningState(activeScope);
			}
			if (version !== restoreVersion) return;
			learning = state;
			learningLoaded = true;
			if (!state.problemHistory.some((item) => item.taskId === activeTaskId && item.submittedAt === null)) {
				errorMessage = 'この問題は現在解答できません。課題トップ画面から現在の問題を選んでください。';
			}
			const saved = state.drafts[activeTaskId];
			if (task.questionSet?.length) {
				const previous = state.submissions.find((item) => item.taskId === activeTaskId);
				const revising = isActiveTask && previous?.feedback.decision === 'revise' && previous.phase !== 'promotion_test';
				if (revising) { feedback = previous.feedback; screen = 'revision'; }
				basicAnswers = restoreBasicAnswers(revising ? previous.feedback : null, saved?.text);
				draft = '';
			} else draft = saved?.text ?? '';
			savedAt = saved ? `${new Date(saved.updatedAt).toLocaleString('ja-JP')}に保存` : 'まだ保存されていません';
		} catch (error) {
			if (version !== restoreVersion) return;
			console.error('課題画面の初期化に失敗しました。', error);
			errorMessage = learningLoadErrorMessage(error);
			learningLoaded = false;
		}
	}

	function retryRestore() {
		if (!scope) return;
		errorMessage = '';
		learningLoaded = false;
		restoreVersion += 1;
		void restoreDraft(scope, restoreVersion, data.task.id);
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

	function handleBasicInput() {
		if (!scope) return;
		pendingSubmissionId = null;
		savedAt = '保存待ち';
		draftSaver.schedule(
			{ scope, taskId: task.id, text: JSON.stringify(basicAnswers) },
			(saved) => { savedAt = `${new Date(saved.updatedAt).toLocaleTimeString('ja-JP')}に保存`; errorMessage = ''; },
			() => { errorMessage = '下書きを保存できませんでした。接続を確認して、もう一度入力してください。'; }
		);
	}

	function basicSubmissionText(): string {
		return (task.questionSet ?? []).map((question, index) => `問題${index + 1}：${basicAnswers[question.id] ?? ''}`).join('\n');
	}

	function nextAnimationFrame(): Promise<void> {
		return new Promise((resolve) => requestAnimationFrame(() => resolve()));
	}

	async function showResultAtTop() {
		screen = 'result';
		await tick();
		await nextAnimationFrame();
		await nextAnimationFrame();
		const target = resultSummary ?? resultSection;
		if (!target) return;
		const top = target.getBoundingClientRect().top + window.scrollY;
		window.scrollTo({ top, behavior: 'auto' });
	}

	async function submit() {
		if (!canSubmitAnswer || !scope || !canEdit || isSubmitting) return;
		const version = restoreVersion;
		const activeScope = scope;
		const submittedText = isQuestionSet ? basicSubmissionText() : draft;
		const snapshot = captureSubmission({ task, text: submittedText, progress: learning.progress, feedback: isQuestionSet && task.questionSet
			? createBasicQuestionSetFeedback(task.questionSet, basicAnswers)
			: createMockFeedback(draft, task.stageId, task.features?.skillTargets) });
		pendingSubmissionId ??= crypto.randomUUID();
		const requestId = pendingSubmissionId;
		isSubmitting = true;
		try {
			await draftSaver.flush();
			if (version !== restoreVersion) return;
			const previousProgress = snapshot.progress;
			const outcome = await saveThenRefresh(
				() => submitLearning(activeScope, { requestId, task: snapshot.task, text: snapshot.text, feedback: snapshot.feedback, basicAnswers: isQuestionSet ? basicAnswers : undefined }),
				() => loadLearningState(activeScope),
			);
			if (version !== restoreVersion) return;
			const submission = outcome.submission;
			submittedSnapshot = { ...snapshot, text: submission.text };
			feedback = submission.feedback;
			resultPhase = submission.phase;
			resultSyncPending = !outcome.synced;
			if (outcome.synced) {
				learning = outcome.state;
				progressMessage = submissionProgressMessage(previousProgress, learning.progress, feedback.decision);
			}
			pendingSubmissionId = null;
			savedAt = '提出履歴に保存しました';
			errorMessage = outcome.synced ? '' : '提出は保存されました。進捗の更新を確認できませんでした。進捗を再読み込みしてください。';
			await showResultAtTop();
		} catch (error) {
			if (version !== restoreVersion) return;
			console.error('提出の保存に失敗しました。', error);
			if (!shouldReuseSubmissionRequest(error)) pendingSubmissionId = null;
			feedback = null;
			errorMessage = submissionErrorMessage(error);
		} finally { if (version === restoreVersion) isSubmitting = false; }
	}

	async function startRevision() {
		if (isQuestionSet) basicAnswers = restoreBasicAnswers(feedback);
		screen = 'revision';
		progressMessage = '';
		await tick();
		answerTextarea?.focus();
		const firstIncorrect = basicEditor?.querySelector<HTMLElement>('.needs-correction');
		firstIncorrect?.scrollIntoView({ block: 'start', behavior: 'auto' });
		firstIncorrect?.querySelector<HTMLInputElement | HTMLTextAreaElement>('input:not(:disabled), textarea:not(:disabled)')?.focus({ preventScroll: true });
	}

	async function refreshSavedResult() {
		if (!scope || isSubmitting) return;
		const version = restoreVersion;
		isSubmitting = true;
		try {
			const before = submittedSnapshot?.progress ?? learning.progress;
			const state = await loadLearningState(scope);
			if (version !== restoreVersion) return;
			learning = state;
			if (feedback) progressMessage = submissionProgressMessage(before, learning.progress, feedback.decision);
			resultSyncPending = false;
			errorMessage = '';
		} catch { if (version === restoreVersion) errorMessage = '提出は保存済みです。進捗を再読み込みできませんでした。通信状態を確認してください。'; }
		finally { if (version === restoreVersion) isSubmitting = false; }
	}
</script>

<main class:promotion-test-screen={isPromotionTest} class:result-screen={screen === 'result'}>
	<p class="eyebrow">STEP {task.stageId}・{phaseLabel(displayedProgress.phase)}</p><h1>{task.title}</h1>
	{#if isPromotionTest}
		<section class="phase-panel promotion-test-panel" aria-label="進級テストの状況"><div><p class="eyebrow">進級テスト</p><h2>テストでは一度だけ解答できます。</h2><p>不合格でも合格数は減りません。規定数に達すると次の段階へ進級します。</p></div><div class="phase-count"><span>現在合格数</span><strong>{displayedProgress.phasePasses}/{phaseTarget(displayedProgress)}</strong></div></section>
	{:else}
		<section class="phase-panel training-panel" aria-label="この段階で行うことと現在の合格数"><div class="phase-guidance"><h2>{data.stage.learnerAction}</h2></div><div class="phase-count"><span>現在合格数</span><strong>{displayedProgress.phasePasses}/{phaseTarget(displayedProgress)}</strong></div></section>
	{/if}
	{#if $authState.status === 'signed-out'}<p class="notice">学習記録を保存するには、<a href="/login"><strong>ログインまたは新規登録</strong></a>してください。</p>{/if}
	{#if scope && learningLoaded && !feedback && !isCurrentStage}<p class="notice">この問題は現在の段階ではありません。<a href="/tasks"><strong>現在の問題へ戻ってください。</strong></a></p>{/if}
	{#if errorMessage}<div class="notice error" role="alert"><p>{errorMessage}</p>{#if scope && !learningLoaded}<button class="text-button" onclick={retryRestore}>もう一度読み込む</button>{/if}</div>{/if}
	{#if feedback && screen === 'result'}
		<section bind:this={resultSummary} class="notice progress-notice result-summary" class:requires-revision={feedback.decision === 'revise'} role="status" aria-label="提出の判定と進捗">
			<strong class="summary-decision">{feedback.decision === 'pass' ? '合格' : resultIsPromotionTest ? '不合格' : '要修正'}</strong>
			{#if progressMessage}<p>{progressMessage}</p>{:else}<p>提出は保存されました。進捗を確認するには、下の「進捗を再読み込む」を押してください。</p>{/if}
		</section>
	{/if}
	{#if screen !== 'result'}<section class="editor-layout">
		<article class="card"><p class="eyebrow">今回の課題</p><p class="prompt task-prompt">{task.prompt}</p><div class="hint"><strong>ヒント</strong>{task.hint}</div>{#if answerExample}<section class="answer-example" aria-label="解答例とポイント"><p class="eyebrow">解答例</p><p class="example-text">{answerExample.text}</p><div class="hint-explanation"><strong>ポイント</strong><p>{answerExample.hintExplanation}</p></div></section>{/if}<h3>合格の目安</h3><p class="muted">{data.stage.passSummary}</p>{#if data.stage.rubric.length}<ul class="rubric-list">{#each data.stage.rubric as item}<li><strong>{item.item}:</strong> {item.passCondition}</li>{/each}</ul>{/if}</article>
		<article class="card"><div class="editor-head"><div><p class="eyebrow">{screen === 'revision' ? '解答を修正・再提出' : 'あなたの解答'}</p><small class="muted">{savedAt}</small></div>{#if !isQuestionSet}<small class="muted">{characterCount}文字</small>{/if}</div>{#if screen === 'revision' && feedback && !isQuestionSet}<div class="hint"><strong>修正する点</strong>{feedback.priorityFeedback[0]?.guidance ?? '添削結果を踏まえて修正してください。'}</div>{/if}{#if isQuestionSet}<div bind:this={basicEditor} class="basic-question-list">{#if screen === 'revision'}<p>正解済みの解答は保存されています。「ここを修正」の問題だけ直して、再提出してください。</p>{/if}{#each task.questionSet ?? [] as question, index}<fieldset class="basic-question" class:needs-correction={needsCorrection(question.id)} class:correct-already={isCorrectAlready(question.id)}><legend>問題{index + 1}{#if needsCorrection(question.id)}<span class="question-status">ここを修正</span>{:else if isCorrectAlready(question.id)}<span class="question-status">正解</span>{/if}</legend><p class="question-instruction">{question.instruction}</p><p class="question-prompt">{question.prompt}</p>{#if question.choices}<div class="choice-list">{#each question.choices as choice}<label><input type="radio" name={question.id} value={choice} bind:group={basicAnswers[question.id]} onchange={handleBasicInput} disabled={!canEdit || isCorrectAlready(question.id)} /> <span>{choice}</span></label>{/each}</div>{:else if question.multiline}<textarea class="basic-answer-textarea" bind:value={basicAnswers[question.id]} oninput={handleBasicInput} aria-label={`問題${index + 1}の解答`} disabled={!canEdit || isCorrectAlready(question.id)}></textarea>{:else}<input class="basic-answer-input" type="text" bind:value={basicAnswers[question.id]} oninput={handleBasicInput} aria-label={`問題${index + 1}の解答`} disabled={!canEdit || isCorrectAlready(question.id)} />{/if}</fieldset>{/each}</div>{:else}<textarea bind:this={answerTextarea} bind:value={draft} oninput={handleInput} placeholder="ここに解答を書いてください。" aria-label={screen === 'revision' ? '修正した解答' : '解答'} disabled={!canEdit}></textarea>{/if}<div class="editor-actions"><small class="muted">提出内容と添削結果は履歴に保存されます。</small><button class="button" onclick={submit} disabled={!canSubmitAnswer || isSubmitting || !canEdit}>{isSubmitting ? '保存中…' : screen === 'revision' ? '再提出' : '提出'}</button></div></article>
	</section>{/if}
	{#if feedback && screen === 'result'}
		<section bind:this={resultSection} class:promotion-result={resultIsPromotionTest} class="card result"><div class="result-head"><div><p class="eyebrow">結果</p><h2>{feedback.decision === 'pass' ? isQuestionSet ? `${task.questionSet?.length ?? 0}問すべて正解です` : 'この問題は合格です' : resultIsPromotionTest ? '今回は不合格です' : '解答を修正してください'}</h2></div></div>{#if feedback.decision === 'pass' || isQuestionSet}<div class="result-answer-grid"><section><p class="eyebrow">今回の課題</p><p class="result-text">{submittedSnapshot?.task.prompt ?? task.prompt}</p></section><section><p class="eyebrow">あなたの解答</p><p class="result-text submitted-answer">{submittedSnapshot?.text ?? ''}</p></section></div><section class="feedback-details"><h3>{isQuestionSet ? '問題ごとの解説' : '添削コメント'}</h3>{#each feedback.priorityFeedback as item}<article class="feedback-item"><h4>{item.title}</h4><p>{item.guidance}</p></article>{/each}{#if feedbackEvidence.length}<h3>判定の根拠</h3><ul>{#each feedbackEvidence as evidence}<li>{evidence}</li>{/each}</ul>{/if}</section>{:else}{#each feedback.priorityFeedback as item}<h3>{item.title}</h3><p>{item.guidance}</p>{/each}{/if}<div class="editor-actions">{#if resultSyncPending}<button class="button" onclick={refreshSavedResult} disabled={isSubmitting}>進捗を再読み込む</button>{:else if resultAction === 'revise'}<button class="button" onclick={startRevision}>解答を修正する</button>{:else if resultAction === 'course_complete'}<a class="button" href="/progress">学習結果を見る</a>{:else if nextTask}<a class="button" href={`/tasks/${nextTask.id}`}>次の問題へ</a>{:else}<a class="button" href="/tasks">課題トップ画面へ</a>{/if}<a class="button secondary" href="/history">履歴を見る</a></div></section>
	{/if}
</main>
