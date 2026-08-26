export type SaveQueue<T, R> = {
	schedule(value: T, onSaved: (result: R) => void, onError: () => void): void;
	flush(): Promise<void>;
	cancel(): void;
};

export function createSaveQueue<T, R>(save: (value: T) => Promise<R>, delayMs = 500): SaveQueue<T, R> {
	let timer: ReturnType<typeof setTimeout> | null = null;
	let pending: { value: T; version: number; onSaved: (result: R) => void; onError: () => void } | null = null;
	let chain = Promise.resolve();
	let currentVersion = 0;

	function enqueue(): void {
		if (!pending) return;
		const job = pending;
		pending = null;
		chain = chain.then(async () => {
			try {
				const result = await save(job.value);
				if (job.version === currentVersion) job.onSaved(result);
			} catch {
				if (job.version === currentVersion) job.onError();
			}
		});
	}

	return {
		schedule(value, onSaved, onError) {
			currentVersion += 1;
			pending = { value, version: currentVersion, onSaved, onError };
			if (timer) clearTimeout(timer);
			timer = setTimeout(() => { timer = null; enqueue(); }, delayMs);
		},
		async flush() {
			if (timer) { clearTimeout(timer); timer = null; }
			enqueue();
			await chain;
		},
		cancel() {
			if (timer) clearTimeout(timer);
			timer = null;
			pending = null;
			currentVersion += 1;
		}
	};
}
