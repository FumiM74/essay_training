<script lang="ts">
	import { goto } from '$app/navigation';
	import { onDestroy, tick } from 'svelte';
	import { authState } from '$lib/features/auth/auth-state';
	import { createBasicQuestionSetFeedback, createMockFeedback } from '$lib/features/learning/feedback';
	import { restoreBasicAnswers } from '$lib/features/learning/basic-revision';
	import { stageAnswerExampleFor } from '$lib/features/learning/learning-design';
	import { phaseLabel, phaseTarget, restoredSubmissionProgressMessage, selectNextPracticeTask, submissionProgressMessage } from '$lib/features/learning/progression';
	import { learningLoadErrorMessage, learningScopeForAuth, loadLearningState, problemIssueError, provisionProblem, saveDraft, shouldReuseSubmissionRequest, submissionErrorMessage, submit as submitLearning, type LearningScope } from '$lib/features/learning/learning-service';
	import { createSaveQueue } from '$lib/features/learning/save-queue';
	import { captureSubmission, forgetPendingSubmission, pendingSubmissionForTask, rememberPendingSubmission, rememberSubmissionResult, saveThenRefresh, shouldRestoreSubmissionResult, type SubmissionSnapshot } from '$lib/features/learning/submission-workflow';
	import { canAnswerTask, resultProgress, taskResultAction } from '$lib/features/learning/task-flow';
	import type { FeedbackResult } from '$lib/types/contracts';
	import type { PracticeTask } from '$lib/types/curriculum';
	import type { DraftRecord, TrialOutcome } from '$lib/types/learning';
	import { emptyLearningState } from '$lib/features/learning/local-store';
	import { historyTask } from '$lib/features/learning/problem-generator';

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
	let basicResultItems = $derived(feedback?.basicQuestionResults ?? []);
	let resultPhase = $state<'training' | 'promotion_test' | 'retraining' | null>(null);
	let trialOutcome = $state<TrialOutcome | null>(null);
	let learningLoaded = $state(false);
	let resultSyncPending = $state(false);
	let submittedSnapshot = $state<SubmissionSnapshot | null>(null);
	let restoredTask = $state<PracticeTask | null>(null);
	let restoredResultProgress = $state<typeof learning.progress | null>(null);
	let resultSection = $state<HTMLElement | null>(null);
	let resultSummary = $state<HTMLElement | null>(null);
	let answerTextarea = $state<HTMLTextAreaElement | null>(null);
	let restoreVersion = 0;
	let pendingSubmissionId: string | null = null;
	let characterCount = $derived(draft.length);
	let scope = $derived(learningScopeForAuth($authState));
	let nextTask = $derived(selectNextPracticeTask(learning));
	let task = $derived(restoredTask ?? (nextTask?.id === data.task.id ? nextTask : data.task));
	let isCurrentStage = $derived(task.stageId === learning.progress.currentStageId);
	let isRecommendedTask = $derived(nextTask?.id === task.id);
	let isActiveTask = $derived(learning.problemHistory.some((item) => item.taskId === task.id && item.stageId === task.stageId && item.submittedAt === null));
	let canEdit = $derived(canAnswerTask({ hasScope: scope !== null, learningLoaded, isCurrentStage, isRecommendedTask, isActiveTask, isResultScreen: screen === 'result', isSubmitting }));
	let isQuestionSet = $derived(Boolean(task.questionSet?.length));
	let basicAnswersComplete = $derived(Boolean(task.questionSet?.every((question) => basicAnswers[question.id]?.trim())));
	let canSubmitAnswer = $derived(isQuestionSet ? basicAnswersComplete : Boolean(draft.trim()));
	let displayedProgress = $derived(restoredResultProgress ?? (screen === 'result' && submittedSnapshot && feedback
		? resultProgress(submittedSnapshot.progress, feedback.decision, resultSyncPending ? undefined : learning.progress)
		: learning.progress));
	let isPromotionTest = $derived(displayedProgress.phase !== 'training');
	let resultIsPromotionTest = $derived(resultPhase !== null && resultPhase !== 'training');
	let trialDisqualified = $derived(trialOutcome?.status === 'disqualified');
	let resultAction = $derived(feedback && resultPhase ? trialDisqualified ? 'next' : taskResultAction({ decision: feedback.decision, phase: resultPhase, stageId: task.stageId, courseCompleted: !resultSyncPending && learning.progress.courseCompletedAt !== null && resultPhase === 'promotion_test' && learning.progress.phase === 'training' }) : null);
	let answerExample = $derived(stageAnswerExampleFor(task.stageId));
	let feedbackEvidence = $derived(feedback ? [...new Set(feedback.skillResults.map((item) => item.evidence).filter(Boolean))] : []);

	function feedbackForQuestion(questionId: string) {
		const index = basicResultItems.findIndex((item) => item.questionId === questionId);
		return index >= 0 ? feedback?.priorityFeedback[index] : undefined;
	}

	const draftSaver = createSaveQueue<{ scope: LearningScope; taskId: string; text: string }, DraftRecord>(
		(job) => saveDraft(job.scope, job.taskId, job.text)
	);

	function submissionStorage(): Storage | null {
		return typeof sessionStorage === 'undefined' ? null : sessionStorage;
	}

	function wait(milliseconds: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, milliseconds));
	}

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
		pendingSubmissionId = pendingSubmissionForTask(submissionStorage(), activeTaskId)?.requestId ?? null;
		resultPhase = null;
		trialOutcome = null;
		screen = 'answer';
		resultSyncPending = false;
		submittedSnapshot = null;
		restoredTask = null;
		restoredResultProgress = null;
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
			const pending = pendingSubmissionForTask(submissionStorage(), activeTaskId);
			if (pending && !state.submissions.some((item) => item.taskId === activeTaskId)) {
				for (let attempt = 0; attempt < 8; attempt += 1) {
					await wait(1500);
					if (version !== restoreVersion) return;
					state = await loadLearningState(activeScope);
					if (state.submissions.some((item) => item.taskId === activeTaskId)) break;
				}
			}
			const recommended = selectNextPracticeTask(state);
			const issued = state.problemHistory.find((item) => item.taskId === activeTaskId && item.submittedAt === null);
			const previous = state.submissions.find((item) => item.taskId === activeTaskId);
			const history = state.problemHistory.find((item) => item.taskId === activeTaskId);
			const currentIssued = state.problemHistory.find((item) => item.stageId === state.progress.currentStageId && item.submittedAt === null);
			const resultMustBeShown = shouldRestoreSubmissionResult(pending, Boolean(previous));
			if (!issued && currentIssued && currentIssued.taskId !== activeTaskId && !resultMustBeShown) {
				await goto(`/tasks/${currentIssued.taskId}`, { replaceState: true });
				return;
			}
			if (!issued && previous) {
				const recoveredTask = history ? historyTask(history) : data.task;
				const beforeProgress = pending?.progress;
				learning = state;
				learningLoaded = true;
				restoredTask = recoveredTask;
				feedback = previous.feedback;
				resultPhase = previous.phase;
				trialOutcome = previous.trialOutcome ?? null;
				restoredResultProgress = beforeProgress
					? resultProgress(beforeProgress, previous.feedback.decision, state.progress)
					: { ...state.progress, currentStageId: previous.stageId, phase: previous.phase };
				submittedSnapshot = { task: recoveredTask, text: previous.text, progress: beforeProgress ?? state.progress, feedback: previous.feedback };
				progressMessage = previous.trialOutcome?.status === 'disqualified'
					? '模範解答を確認して、次の問題へ進んでください。現在の合格数は変わりません。'
					: beforeProgress
					? submissionProgressMessage(beforeProgress, state.progress, previous.feedback.decision)
					: restoredSubmissionProgressMessage(previous, state.progress);
				savedAt = '提出履歴から結果を復元しました';
				errorMessage = '';
				pendingSubmissionId = null;
				if (pending) rememberSubmissionResult(submissionStorage(), pending);
				await showResultAtTop();
				return;
			}
			if (!issued && recommended && recommended.id !== activeTaskId) {
				await goto(`/tasks/${recommended.id}`, { replaceState: true });
				return;
			}
			const needsCurrentProblemCopy = Boolean(issued && recommended?.features
				&& issued.features.generation.promptVersion !== recommended.features.generation.promptVersion);
			if ((!issued || needsCurrentProblemCopy) && recommended?.id === activeTaskId) {
				try {
					const provisioned = await provisionProblem(activeScope, recommended, state.problemHistory);
					if (provisioned.id !== activeTaskId) {
						await goto(`/tasks/${provisioned.id}`, { replaceState: true });
						return;
					}
				}
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
			const activeProblem = state.problemHistory.some((item) => item.taskId === activeTaskId && item.stageId === task.stageId && item.submittedAt === null);
			const revising = Boolean(activeProblem && previous?.feedback.decision === 'revise' && previous.phase !== 'promotion_test');
			if (revising && previous) {
				feedback = previous.feedback;
				screen = 'revision';
			}
			if (task.questionSet?.length) {
				basicAnswers = restoreBasicAnswers(revising ? previous?.feedback ?? null : null, saved?.text);
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
		forgetPendingSubmission(submissionStorage(), task.id);
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
		forgetPendingSubmission(submissionStorage(), task.id);
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
		const rememberedSubmission = pendingSubmissionForTask(submissionStorage(), snapshot.task.id);
		pendingSubmissionId ??= crypto.randomUUID();
		const requestId = pendingSubmissionId;
		const submissionReceipt = {
			taskId: snapshot.task.id,
			requestId,
			startedAt: rememberedSubmission?.startedAt ?? new Date().toISOString(),
			progress: rememberedSubmission?.progress ?? snapshot.progress,
		};
		rememberPendingSubmission(submissionStorage(), { ...submissionReceipt, status: 'submitting' });
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
			trialOutcome = submission.trialOutcome ?? null;
			resultSyncPending = !outcome.synced;
			if (outcome.synced) {
				learning = outcome.state;
				progressMessage = submission.trialOutcome?.status === 'disqualified'
					? '模範解答を確認して、次の問題へ進んでください。現在の合格数は変わりません。'
					: submissionProgressMessage(previousProgress, learning.progress, feedback.decision);
			}
			pendingSubmissionId = null;
			rememberSubmissionResult(submissionStorage(), submissionReceipt);
			savedAt = '提出履歴に保存しました';
			errorMessage = outcome.synced ? '' : '提出は保存されました。進捗の更新を確認できませんでした。進捗を再読み込みしてください。';
			await showResultAtTop();
		} catch (error) {
			if (version !== restoreVersion) return;
			console.error('提出の保存に失敗しました。', error);
			if (!shouldReuseSubmissionRequest(error)) {
				pendingSubmissionId = null;
				forgetPendingSubmission(submissionStorage(), snapshot.task.id);
			}
			feedback = null;
			errorMessage = submissionErrorMessage(error);
		} finally { if (version === restoreVersion) isSubmitting = false; }
	}

	async function startRevision() {
		forgetPendingSubmission(submissionStorage(), submittedSnapshot?.task.id ?? task.id);
		pendingSubmissionId = null;
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

	async function openNextTask() {
		const activeScope = scope;
		const candidate = nextTask;
		if (!activeScope || !candidate || isSubmitting) return;
		const version = restoreVersion;
		isSubmitting = true;
		errorMessage = '';
		forgetPendingSubmission(submissionStorage(), submittedSnapshot?.task.id ?? task.id);
		try {
			let provisioned: PracticeTask;
			try {
				// Issue the next problem before changing the URL. Otherwise the new
				// screen can briefly see an unissued problem and keep its editor locked
				// until a full browser reload refreshes the problem history.
				provisioned = await provisionProblem(activeScope, candidate, learning.problemHistory);
			} catch (error) {
				throw problemIssueError(error);
			}
			if (version !== restoreVersion) return;
			const state = await loadLearningState(activeScope);
			if (version !== restoreVersion) return;
			const issued = state.problemHistory.some((item) => item.taskId === provisioned.id
				&& item.stageId === provisioned.stageId && item.submittedAt === null);
			if (!issued) throw problemIssueError(new Error('発行した問題を再取得できませんでした。'));
			learning = state;
			await goto(`/tasks/${provisioned.id}`, { invalidateAll: true });
		} catch (error) {
			if (version !== restoreVersion) return;
			console.error('次の問題の開始に失敗しました。', error);
			errorMessage = learningLoadErrorMessage(error);
		} finally {
			if (version === restoreVersion) isSubmitting = false;
		}
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
			<strong class="summary-decision">{trialDisqualified ? '練習終了' : feedback.decision === 'pass' ? '合格' : resultIsPromotionTest ? '不合格' : '要修正'}</strong>
			{#if progressMessage}<p>{progressMessage}</p>{:else}<p>提出は保存されました。進捗を確認するには、下の「進捗を再読み込む」を押してください。</p>{/if}
		</section>
	{/if}
	{#if screen !== 'result'}
		<section class="editor-layout">
			<article class="card"><p class="eyebrow">今回の課題</p><p class="prompt task-prompt">{task.prompt}</p><div class="hint"><strong>ヒント</strong>{task.hint}</div>{#if answerExample}<section class="answer-example" aria-label="書き方の例とポイント"><p class="eyebrow">書き方の例</p><p class="example-note">今回の問題の解答ではありません。</p><p class="example-text">{answerExample.text}</p><div class="hint-explanation"><strong>ポイント</strong><p>{answerExample.hintExplanation}</p></div>{#each answerExample.additionalExamples ?? [] as example}<div class="additional-example"><strong>{example.label}</strong><p class="example-text">{example.text}</p><div class="hint-explanation"><strong>ポイント</strong><p>{example.hintExplanation}</p></div></div>{/each}</section>{/if}<h3>合格の目安</h3><p class="muted">{data.stage.passSummary}</p>{#if data.stage.rubric.length}<ul class="rubric-list">{#each data.stage.rubric as item}<li><strong>{item.item}:</strong> {item.passCondition}</li>{/each}</ul>{/if}</article>
			<article class="card">
				<div class="editor-head"><div><p class="eyebrow">{screen === 'revision' ? '解答を修正・再提出' : 'あなたの解答'}</p><small class="muted">{savedAt}</small></div>{#if !isQuestionSet}<small class="muted">{characterCount}文字</small>{/if}</div>
				{#if screen === 'revision' && feedback && !isQuestionSet}
					<section class="hint revision-guidance" aria-label="修正する点">
						<strong>修正する点</strong>
						<div class="revision-guidance-list">
							{#if feedback.priorityFeedback.length}
								{#each feedback.priorityFeedback as item}
									<article class="revision-guidance-item"><h4>{item.title}</h4><p>{item.guidance}</p></article>
								{/each}
							{:else}
								<p>添削結果を踏まえて修正してください。</p>
							{/if}
						</div>
					</section>
				{/if}
				{#if isQuestionSet}
					<div bind:this={basicEditor} class="basic-question-list">
						{#if screen === 'revision'}<p>正解済みの解答は保存されています。「ここを修正」の問題だけ直して、再提出してください。</p>{/if}
						{#each task.questionSet ?? [] as question, index}
							{@const questionFeedback = feedbackForQuestion(question.id)}
							<fieldset class="basic-question" class:needs-correction={needsCorrection(question.id)} class:correct-already={isCorrectAlready(question.id)}>
								<legend>問題{index + 1}{#if needsCorrection(question.id)}<span class="question-status">ここを修正</span>{:else if isCorrectAlready(question.id)}<span class="question-status">正解</span>{/if}</legend>
								<p class="question-instruction">{question.instruction}</p><p class="question-prompt">{question.prompt}</p>
								{#if screen === 'revision' && needsCorrection(question.id)}
									<section class="question-revision-guidance" aria-label={`問題${index + 1}の解説`}>
										<strong>修正する点</strong>
										<p>{questionFeedback?.guidance ?? 'この問題をもう一度見直して、修正してください。'}</p>
									</section>
								{/if}
								{#if question.choices}<div class="choice-list">{#each question.choices as choice}<label><input type="radio" name={question.id} value={choice} bind:group={basicAnswers[question.id]} onchange={handleBasicInput} disabled={!canEdit || isCorrectAlready(question.id)} /> <span>{choice}</span></label>{/each}</div>{:else if question.multiline}<textarea class="basic-answer-textarea" bind:value={basicAnswers[question.id]} oninput={handleBasicInput} aria-label={`問題${index + 1}の解答`} disabled={!canEdit || isCorrectAlready(question.id)}></textarea>{:else}<input class="basic-answer-input" type="text" bind:value={basicAnswers[question.id]} oninput={handleBasicInput} aria-label={`問題${index + 1}の解答`} disabled={!canEdit || isCorrectAlready(question.id)} />{/if}
							</fieldset>
						{/each}
					</div>
				{:else}
					<textarea bind:this={answerTextarea} bind:value={draft} oninput={handleInput} placeholder="ここに解答を書いてください。" aria-label={screen === 'revision' ? '修正した解答' : '解答'} disabled={!canEdit}></textarea>
				{/if}
				<div class="editor-actions"><small class="muted">提出内容と添削結果は履歴に保存されます。</small><button class="button" onclick={submit} disabled={!canSubmitAnswer || isSubmitting || !canEdit}>{isSubmitting ? '保存中…' : screen === 'revision' ? '再提出' : '提出'}</button></div>
			</article>
		</section>
	{/if}
	{#if feedback && screen === 'result'}
		<section bind:this={resultSection} class:promotion-result={resultIsPromotionTest} class="card result">
			<div class="result-head"><div><p class="eyebrow">結果</p><h2>{trialDisqualified ? 'この問題の練習はここで終了します' : feedback.decision === 'pass' ? isQuestionSet ? `${task.questionSet?.length ?? 0}問すべて正解です` : 'この問題は合格です' : resultIsPromotionTest ? '今回は不合格です' : '解答を修正してください'}</h2></div></div>
			{#if isQuestionSet && basicResultItems.length}
				<section class="question-result-list" aria-label="問題ごとの結果">
					{#each basicResultItems as questionResult, index}
						{@const questionFeedback = feedback.priorityFeedback[index]}
						<article class="question-result-card" class:needs-correction={!questionResult.correct}>
							<header><h3>問題{index + 1}</h3><span class:incorrect={!questionResult.correct} class="question-result-status">{questionResult.correct ? '正解' : '不正解'}</span></header>
							<p class="question-instruction">{questionResult.instruction}</p><p class="question-prompt">{questionResult.prompt}</p>
							<section class="question-result-answer"><p class="eyebrow">あなたの解答</p><p>{questionResult.answer || '未解答'}</p></section>
							<section class="question-result-feedback"><p class="eyebrow">解説</p><h4>{questionFeedback?.title ?? (questionResult.correct ? '正解です' : 'ここを見直しましょう')}</h4><p>{questionFeedback?.guidance ?? `${questionResult.correct ? '正しく解答できています。' : `正解は「${questionResult.answerLabel}」です。`}${questionResult.explanation}`}</p></section>
						</article>
					{/each}
				</section>
			{:else if feedback.decision === 'pass'}
				<div class="result-answer-grid"><section><p class="eyebrow">今回の課題</p><p class="result-text">{submittedSnapshot?.task.prompt ?? task.prompt}</p></section><section><p class="eyebrow">あなたの解答</p><p class="result-text submitted-answer">{submittedSnapshot?.text ?? ''}</p></section></div><section class="feedback-details"><h3>添削コメント</h3>{#each feedback.priorityFeedback as item}<article class="feedback-item"><h4>{item.title}</h4><p>{item.guidance}</p></article>{/each}{#if feedbackEvidence.length}<h3>判定の根拠</h3><ul>{#each feedbackEvidence as evidence}<li>{evidence}</li>{/each}</ul>{/if}</section>
			{:else}
				{#each feedback.priorityFeedback as item}<h3>{item.title}</h3><p>{item.guidance}</p>{/each}
			{/if}
			{#if trialDisqualified && trialOutcome?.modelAnswers?.length}
				<section class="model-answer-panel" aria-label="模範解答と解説">
					<h3>模範解答例</h3>
					<p>この問題では複数の書き方が考えられます。次の例と解説を確認して、次の問題へ進んでください。</p>
					{#each trialOutcome.modelAnswers as modelAnswer}
						<article class="model-answer-item">
							<h4>{modelAnswer.label}</h4>
							<p class="model-answer-text">{modelAnswer.answer}</p>
							<p><strong>ポイント</strong></p><p>{modelAnswer.explanation}</p>
						</article>
					{/each}
				</section>
			{/if}
			{#if feedback.decision === 'revise' && !trialDisqualified && !resultIsPromotionTest && !learning.progress.easyFeedbackEnabled}
				<p class="feedback-setting-hint">解説が難しい場合は、<a href="/progress">進捗・設定画面</a>から、”添削をやさしい表現にする”をONにしてください。読みやすさを優先した解説を表示します。</p>
			{/if}
			<div class="editor-actions">{#if resultSyncPending}<button class="button" onclick={refreshSavedResult} disabled={isSubmitting}>進捗を再読み込む</button>{:else if resultAction === 'revise'}<button class="button" onclick={startRevision}>解答を修正する</button>{:else if resultAction === 'course_complete'}<a class="button" href="/progress">学習結果を見る</a>{:else if nextTask}<button class="button" onclick={openNextTask} disabled={isSubmitting}>{isSubmitting ? '問題を準備中…' : '次の問題へ'}</button>{:else}<a class="button" href="/tasks">課題トップ画面へ</a>{/if}<a class="button secondary" href="/history">履歴を見る</a></div>
		</section>
	{/if}
</main>
