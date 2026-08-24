<script lang="ts">
	import { demoAccess, demoFeedback, demoSession, demoTask } from '$lib/features/learning/mock-data';

	let draft = $state('');
	let submitted = $state(false);
	let savedAt = $state('まだ保存されていません');
	const characterCount = $derived(draft.length);

	function saveDraft() { savedAt = 'いま保存しました'; }
	function submit() { if (draft.trim()) submitted = true; }
</script>

<svelte:head><meta name="theme-color" content="#174e52" /></svelte:head>

<main>
	<header><strong>文章の型トレーニング</strong><span><i></i>{demoSession.displayName}</span></header>
	<section class="hero"><p>現在のステップ</p><h1>ステップ {demoTask.stage}<br />{demoTask.title}</h1><span>短い文章から、伝わる順番を身につけます。</span></section>
	<section class="workspace">
		<article><p class="label">今回の課題</p><p class="prompt">{demoTask.prompt}</p><aside><strong>ヒント</strong> 「私は〜と思う。」の形から始めると、主張が明確になります。</aside></article>
		<article><div class="editor-title"><div><p class="label">あなたの解答</p><small>{savedAt}</small></div><small>{characterCount} 文字</small></div><textarea bind:value={draft} oninput={saveDraft} placeholder="ここに解答を書いてください。"></textarea><div class="actions"><small>送信すると、文章のつながりを確認して添削します。</small><button onclick={submit} disabled={!draft.trim() || !demoAccess.canSubmit}>添削を受け取る</button></div></article>
	</section>
	{#if submitted}<section class="feedback"><div><p>添削結果</p><b>合格</b></div>{#each demoFeedback.priorityFeedback as item}<h2>{item.title}</h2><span>{item.guidance}</span>{/each}<button class="secondary" onclick={() => (submitted = false)}>書き直す</button></section>{/if}
	<footer>無料体験: あと {demoAccess.remainingSubmissions} 回提出できます <span>履歴</span></footer>
</main>

<style>
	:global(*) { box-sizing: border-box; } :global(body) { margin: 0; background: #f7f4ec; color: #15383a; font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Yu Gothic", sans-serif; } main { width: min(100%, 920px); margin: auto; padding: 24px 24px 48px; } header, header span, .editor-title, .actions, .feedback > div, footer { display:flex; align-items:center; justify-content:space-between; gap:16px; } header { padding-bottom:34px; font-size:14px; } header span { color:#5a6c68; } i { width:9px; height:9px; background:#e8a34a; border-radius:50%; } .hero { padding:22px 0 38px; } .hero p, .label, .feedback p { margin:0 0 8px; color:#b15d37; font-size:13px; font-weight:700; letter-spacing:.08em; } h1 { margin:0; color:#174e52; font-size:clamp(34px,8vw,56px); line-height:1.13; letter-spacing:-.05em; } .hero span { display:block; margin-top:16px; color:#64736d; } .workspace { display:grid; grid-template-columns:.9fr 1.1fr; gap:18px; } article, .feedback { border:1px solid #dcd8ca; border-radius:18px; background:#fffdf8; padding:26px; box-shadow:0 10px 24px rgb(30 62 58 / 5%); } .prompt { margin:0; font-size:18px; line-height:1.8; } aside { margin-top:25px; padding:15px; border-radius:12px; background:#edf3ed; color:#49635b; font-size:14px; line-height:1.65; } aside strong { display:block; color:#245a53; } small { color:#75807b; } textarea { width:100%; min-height:216px; margin:18px 0; resize:vertical; border:0; border-radius:10px; background:#f8f7f1; padding:16px; color:#15383a; font:inherit; font-size:16px; line-height:1.8; outline:2px solid transparent; } textarea:focus { outline-color:#83aca4; } .actions { align-items:flex-end; } .actions small { max-width:230px; line-height:1.5; } button { border:0; border-radius:999px; padding:12px 18px; background:#174e52; color:white; font:inherit; font-weight:700; cursor:pointer; white-space:nowrap; } button:disabled { cursor:not-allowed; background:#aeb8b2; } .feedback { margin-top:18px; border-color:#c9ddd3; background:#f3faf5; } .feedback h2 { margin:8px 0; font-size:21px; } .feedback span { line-height:1.7; } .feedback b { border-radius:999px; padding:7px 10px; background:#e5eee7; color:#3f6953; font-size:13px; } .secondary { display:block; margin-top:20px; background:transparent; color:#174e52; outline:1px solid #91aaa0; } footer { margin-top:35px; padding-top:20px; border-top:1px solid #ddd7c9; color:#697772; font-size:13px; } @media (max-width:680px) { main { padding:18px 16px 36px; } .workspace { grid-template-columns:1fr; } article,.feedback { padding:21px; } .actions { align-items:stretch; flex-direction:column; } .actions small { max-width:none; } .actions button { width:100%; } footer { align-items:flex-start; flex-direction:column; } }
</style>
