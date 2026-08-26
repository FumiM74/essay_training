<script lang="ts">
	import type { SubmissionRecord } from '$lib/types/learning';
	import { dateKey } from '$lib/features/learning/local-store';

	let { submissions, year = new Date().getFullYear() }: { submissions: SubmissionRecord[]; year?: number } = $props();
	type ActivityDay = { date: Date; key: string; count: number; inYear: boolean };

	function createDays(records: SubmissionRecord[], targetYear: number): ActivityDay[] {
		const counts = new Map<string, number>();
		for (const record of records) {
			const key = dateKey(record.submittedAt);
			counts.set(key, (counts.get(key) ?? 0) + 1);
		}
		const first = new Date(targetYear, 0, 1);
		first.setDate(first.getDate() - ((first.getDay() + 6) % 7));
		return Array.from({ length: 371 }, (_, index) => {
			const date = new Date(first);
			date.setDate(first.getDate() + index);
			const key = dateKey(date);
			return { date, key, count: counts.get(key) ?? 0, inYear: date.getFullYear() === targetYear };
		});
	}

	function level(count: number) { return count === 0 ? 0 : Math.min(4, count); }
	function createMonthLabels(targetYear: number): string[] {
		const labels = Array.from({ length: 53 }, () => '');
		const first = new Date(targetYear, 0, 1);
		first.setDate(first.getDate() - ((first.getDay() + 6) % 7));
		for (let month = 0; month < 12; month += 1) {
			const monthStart = new Date(targetYear, month, 1);
			const week = Math.floor((monthStart.getTime() - first.getTime()) / (7 * 24 * 60 * 60 * 1000));
			labels[Math.max(0, Math.min(52, week))] = `${month + 1}月`;
		}
		return labels;
	}
	let days = $derived(createDays(submissions, year));
	let monthLabels = $derived(createMonthLabels(year));
	let total = $derived(days.reduce((sum, day) => sum + day.count, 0));
</script>

<section class="activity" aria-label={`${year}年の日次活動`}>
	<div class="activity-title"><strong>{year}年の活動</strong><span>{total} 回の提出</span></div>
	<div class="months" aria-hidden="true">{#each monthLabels as month}<span>{month}</span>{/each}</div>
	<div class="activity-scroll">
		<div class="weekday-labels" aria-hidden="true"><span>月</span><span></span><span>水</span><span></span><span>金</span><span></span><span>日</span></div>
		<div class="activity-grid">
			{#each days as day}
				<span class:outside={!day.inYear} class={`level-${level(day.count)}`} title={`${day.date.toLocaleDateString('ja-JP')}: ${day.count}回`} aria-hidden={day.count === 0} aria-label={day.count ? `${day.date.toLocaleDateString('ja-JP')}、提出${day.count}回` : undefined}></span>
			{/each}
		</div>
	</div>
	<div class="legend"><span>少ない</span>{#each [0,1,2,3,4] as item}<i class={`level-${item}`}></i>{/each}<span>多い</span></div>
</section>

<style>
	.activity { overflow: hidden; }
	.activity-title { display: flex; align-items: center; justify-content: space-between; margin-bottom: 13px; }
	.activity-title strong { color: #174e52; font-size: 18px; }
	.activity-title span, .legend { color: #73817c; font-size: 12px; }
	.months { display: grid; grid-template-columns: repeat(53, 12px); gap: 3px; min-width: 742px; margin-left: 28px; color: #71807b; font-size: 10px; }
	.months span { white-space: nowrap; }
	.activity-scroll { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 6px; }
	.weekday-labels { width: 20px; flex: 0 0 20px; display: grid; grid-template-rows: repeat(7, 12px); gap: 3px; color: #83908b; font-size: 9px; line-height: 12px; }
	.activity-grid { display: grid; grid-template-rows: repeat(7, 12px); grid-auto-flow: column; grid-auto-columns: 12px; gap: 3px; min-width: 742px; }
	.activity-grid span, .legend i { border-radius: 3px; background: #e5e8e4; }
	.activity-grid span { width: 12px; height: 12px; }
	.activity-grid .outside { opacity: .35; }
	.level-0 { background: #e5e8e4 !important; }
	.level-1 { background: #9be9a8 !important; }
	.level-2 { background: #40c463 !important; }
	.level-3 { background: #30a14e !important; }
	.level-4 { background: #216e39 !important; }
	.legend { display: flex; align-items: center; justify-content: flex-end; gap: 4px; margin-top: 10px; }
	.legend i { width: 12px; height: 12px; }
</style>
