import { build, files, version } from '$service-worker';

const worker = self as unknown as ServiceWorkerGlobalScope;
const cacheName = `essay-training-${version}`;
const assets = [...build, ...files];

worker.addEventListener('install', (event) => {
	event.waitUntil(caches.open(cacheName).then((cache) => cache.addAll(assets)).then(() => worker.skipWaiting()));
});

worker.addEventListener('activate', (event) => {
	event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== cacheName).map((key) => caches.delete(key)))).then(() => worker.clients.claim()));
});

worker.addEventListener('fetch', (event) => {
	if (event.request.method !== 'GET') return;
	event.respondWith(fetch(event.request).catch(() => caches.match(event.request).then((response) => response ?? caches.match('/'))));
});
