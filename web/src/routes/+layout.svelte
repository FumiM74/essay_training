<script lang="ts">
	let { children } = $props();
</script>

<svelte:head>
	<title>文章の型トレーニング</title>
	<meta name="description" content="小論文の文章の型を、少しずつ身につける学習アプリ" />
</svelte:head>

{@render children()}
