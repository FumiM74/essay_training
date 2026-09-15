import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const historyPage = readFileSync(resolve(process.cwd(), 'src/routes/history/+page.svelte'), 'utf8');
const tasksPage = readFileSync(resolve(process.cwd(), 'src/routes/tasks/+page.svelte'), 'utf8');
const appCss = readFileSync(resolve(process.cwd(), 'src/app.css'), 'utf8');
const authPanel = readFileSync(resolve(process.cwd(), 'src/lib/features/auth/AuthPanel.svelte'), 'utf8');
const taskPage = readFileSync(resolve(process.cwd(), 'src/routes/tasks/[taskId]/+page.svelte'), 'utf8');
const homePage = readFileSync(resolve(process.cwd(), 'src/routes/+page.svelte'), 'utf8');
const layoutPage = readFileSync(resolve(process.cwd(), 'src/routes/+layout.svelte'), 'utf8');
const progressPage = readFileSync(resolve(process.cwd(), 'src/routes/progress/+page.svelte'), 'utf8');

describe('学習画面の固定表示', () => {
	it('履歴と課題トップの文言・学習中の色分けを保持する', () => {
		expect(historyPage).toContain('>課題トップ画面へ</a>');
		expect(historyPage).not.toContain('履歴と異なる次の問題へ');
		expect(historyPage).toContain('{#if item.feedback.basicQuestionResults?.length}');
		expect(historyPage).toContain('{#each questionResults as result}');
		expect(historyPage).toContain('`${questionResults.length}問すべての採点結果と説明`');
		expect(historyPage).toContain('{result.question.instruction}');
		expect(historyPage).toContain('{result.question.prompt}');
		expect(historyPage).toContain('あなたの解答：');
		expect(appCss).toContain('.history-feedback-item h3 { margin: 0 0 7px; border-left: 4px solid #2e765f; padding-left: 10px;');
		expect(appCss).not.toContain("content: '■'");
		expect(appCss).toContain('.history-question-prompt');
		expect(appCss).toContain('font-size: 17px');
		expect(tasksPage).toContain("current && completed ? '復習中' : completed ? '完了' : frontier ? '学習中' : '未完了'");
		expect(tasksPage).toContain("frontier ? '学習に戻る' : '復習する'");
		expect(tasksPage).not.toContain('問題数に上限なし');
		expect(appCss).toContain('.status.learning');
		expect(appCss).toContain('background: #f8e5d2');
	});

	it('課題トップの内容①・内容②を改行で読みやすくし、開始ボタンをカード下部に置く', () => {
		expect(tasksPage).toContain('class="current-task-prompt"');
		expect(homePage).toContain('class="task-prompt"');
		expect(tasksPage).toContain('class="button current-task-action"');
		expect(appCss).toContain('.current-task-prompt, .task-prompt { white-space: pre-line; }');
		expect(appCss).toContain('.current-task { display: flex; flex-direction: column; align-items: stretch; gap: 0; }');
		expect(appCss).toContain('.current-task-action { align-self: flex-start;');
		expect(appCss).toContain('white-space: nowrap;');
	});

	it('復習するボタンは段階変更後の問題へ直接移動する', () => {
		expect(tasksPage).toContain("import { goto } from '$app/navigation';");
		expect(tasksPage).toContain('const task = selectNextPracticeTask(updated);');
		expect(tasksPage).toContain('await goto(`/tasks/${task.id}`);');
	});

	it('確認メール送信後は登録フォームではなく専用案内を表示する', () => {
		expect(authPanel).toContain('{#if registrationSent}');
		expect(authPanel).toContain('確認メールを送りました');
		expect(authPanel).toContain('メール内のリンクを開くと、登録が完了して学習を始められます。');
		expect(authPanel.indexOf('{#if registrationSent}')).toBeLessThan(authPanel.indexOf('<form'));
	});

	it('提出後は合否と進捗を示す先頭へスクロールし、結果欄の判定ラベルを重複させない', () => {
		expect(taskPage).toContain('const target = resultSummary ?? resultSection;');
		expect(taskPage).toContain('bind:this={resultSummary}');
		expect(taskPage).toContain('class="summary-decision"');
		expect(taskPage).toContain('<p class="eyebrow">結果</p>');
		expect(taskPage).not.toContain('5問セットの結果');
		expect(taskPage).not.toContain('正解済み・変更不要');
		expect(taskPage).not.toContain('class="decision"');
		expect(historyPage).toContain("class:needs-correction={Boolean(result.feedback?.title.includes('不正解'))}");
		expect(taskPage).toContain('bind:this={resultSection}');
		expect(taskPage).toContain("class:result-screen={screen === 'result'}");
		expect(taskPage).toContain("{#if screen !== 'result'}");
		expect(taskPage).toContain('await nextAnimationFrame();');
		expect(taskPage).toContain("window.scrollTo({ top, behavior: 'auto' })");
		expect(appCss).toContain('.result-screen .result { min-height: 100vh; }');
	});

	it('次の問題はDBで発行・再取得してから画面を移し、進級テスト開始直後も入力できる', () => {
		expect(taskPage).toContain('async function openNextTask()');
		expect(taskPage).toContain('provisionProblem(activeScope, candidate, learning.problemHistory)');
		expect(taskPage).toContain('const state = await loadLearningState(activeScope);');
		expect(taskPage).toContain('item.taskId === provisioned.id');
		expect(taskPage).toContain("await goto(`/tasks/${provisioned.id}`, { invalidateAll: true });");
		expect(taskPage).toContain('onclick={openNextTask}');
		expect(taskPage).toContain("isSubmitting ? '問題を準備中…' : '次の問題へ'");
		expect(taskPage).not.toContain('<a class="button" href={`/tasks/${nextTask.id}`}>次の問題へ</a>');
	});

	it('提出結果は自動遷移より優先し、学習者が次の操作を選ぶまで保持する', () => {
		expect(taskPage).toContain('shouldRestoreSubmissionResult(pending, Boolean(previous))');
		expect(taskPage).toContain('currentIssued.taskId !== activeTaskId && !resultMustBeShown');
		expect(taskPage).toContain('rememberSubmissionResult(submissionStorage(), submissionReceipt)');
		expect(taskPage).toContain('forgetPendingSubmission(submissionStorage(), submittedSnapshot?.task.id ?? task.id)');
	});

	it('課題選択の内部処理を課題ページへ表示しない', () => {
		expect(taskPage).not.toContain('同じ問題の偏りを防ぐため');
		expect(taskPage).not.toContain('提出履歴から別の問題を選んでいます');
	});

	it('ホーム画面の学習開始ボタンを一つに統一する', () => {
		expect(homePage.match(/>学習を始める<\/a>/g)).toHaveLength(1);
		expect(homePage).not.toContain('学習を続ける');
		expect(homePage).not.toContain('問題を開く');
		expect(homePage).not.toContain('最初の問題を始める');
	});

	it('ナビゲーションの進捗画面を設定も含む名称で表示する', () => {
		expect(layoutPage).toContain("{ href: '/progress', label: '進捗・設定' }");
	});

	it('進捗・設定画面で毎回の解説難易度を選べる', () => {
		expect(progressPage).toContain('<h1>学習進捗・設定</h1>');
		expect(progressPage).toContain('解説の難易度');
		expect(progressPage).toContain('<h2>添削をやさしい表現にする</h2>');
		expect(progressPage).toContain('role="switch"');
		expect(progressPage).toContain('ON・やさしい解説');
		expect(progressPage).toContain('解説文が長くなったり、最適な表現から若干ズレる場合もありますが');
		expect(progressPage).toContain('読みやすく学習を進めやすい表現になることを優先します。');
		expect(progressPage).toContain('合否や採点基準は変わりません');
	});

	it('解説は設定した難易度の一種類だけを修正入力欄の上へ引き継ぐ', () => {
		expect(taskPage).not.toContain('loadCachedSimplifiedFeedback');
		expect(taskPage).not.toContain('simplifiedFeedback');
		expect(taskPage).not.toContain('やさしい説明を見る');
		expect(taskPage).toContain('<strong>修正する点</strong>');
		expect(taskPage).toContain('{item.guidance}');
		expect(taskPage.indexOf('class="hint revision-guidance"')).toBeLessThan(taskPage.indexOf('bind:this={basicEditor}'));
		expect(taskPage.indexOf('class="hint revision-guidance"')).toBeLessThan(taskPage.indexOf('bind:this={answerTextarea}'));
	});

	it('解説が難しい場合の設定案内を課題トップと結果画面へ表示する', () => {
		const guide = '”添削をやさしい表現にする”をONにしてください。読みやすさを優先した解説を表示します。';
		expect(tasksPage).toContain(guide);
		expect(taskPage).toContain(guide);
		expect(tasksPage).toContain('class="current-task-footer"');
		expect(taskPage).toContain('class="feedback-setting-hint"');
		expect(appCss).toContain('.feedback-setting-hint');
	});

	it('問題セットは、修正時も結果時も問題ごとに解説を隣接して表示する', () => {
		expect(taskPage).toContain('class="question-revision-guidance"');
		expect(taskPage).toContain('questionFeedback?.guidance');
		expect(taskPage).toContain('class="question-result-list"');
		expect(taskPage).toContain('class="question-result-card"');
		expect(taskPage).toContain('class="question-result-answer"');
		expect(taskPage).toContain('class="question-result-feedback"');
		expect(taskPage).not.toContain('class="question-simple-feedback"');
		expect(appCss).toContain('.question-revision-guidance');
		expect(appCss).toContain('.question-result-card');
	});
});
