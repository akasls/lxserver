const CACHE_NAME = 'lx-music-web-v4';
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './login.html',
    './app.js',
    // CSS
    './css/theme_variables.css',
    './assets/fontawesome/css/all.min.css',
    // 核心 JS
    './js/lyric-parser.js',
    './js/lyric-utils.js',
    './js/lyric-card.js',
    './js/quality.js',
    './js/user_sync.js',
    './js/batch_pagination.js',
    './js/single_song_ops.js',
    './js/songlist_manager.js',
    './js/pwa.js',
    './js/theme_manager.js',
    './js/tailwind_setup.js',
    './js/log_viewer.js',
    // 第三方库
    './assets/tailwindcss.js',
    './js/crypto-js.min.js',
    './js/NoSleep.min.js',
    './js/Sortable.min.js',
    './js/marked.min.js',
    // 音频效果
    './js/sound-effects.js',
    './js/visualizer.js',
    './js/wave.js',
    // 变调器
    './js/pitch-shifter/fft.js',
    './js/pitch-shifter/ola-processor.js',
    './js/pitch-shifter/phase-vocoder.js',
    // 静态资源
    './assets/logo.svg',
];

const AUDIO_CACHE_NAME = 'lx-music-audio-v1';

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS_TO_CACHE);
        })
    );
    self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // 1. 特殊处理音频请求 (可能是代理请求或直接链接)
    // 拦截 API 下载/流接口 或 常见的音频后缀
    const isAudioRequest = url.pathname.includes('/api/music/download') ||
        url.pathname.includes('/api/music/cache/file') ||
        url.href.match(/\.(mp3|flac|m4a|ogg|aac)(\?.*)?$/i);

    if (isAudioRequest && event.request.method === 'GET') {
        event.respondWith(
            caches.open(AUDIO_CACHE_NAME).then((cache) => {
                return cache.match(event.request).then((response) => {
                    if (response) {
                        console.log('[SW] Audio Cache Hit:', url.pathname);
                        return response;
                    }

                    return fetch(event.request).then((networkResponse) => {
                        // 只有 200 或 206 (Partial Content) 才缓存
                        if (networkResponse && (networkResponse.status === 200 || networkResponse.status === 206)) {
                            console.log('[SW] Caching Audio:', url.pathname);
                            cache.put(event.request, networkResponse.clone());
                        }
                        return networkResponse;
                    });
                });
            })
        );
        return;
    }

    // 2. 常规静态资源采用 Network First 或 Stale-While-Revalidate
    if (event.request.method !== 'GET') return;

    event.respondWith(
        fetch(event.request)
            .then((response) => {
                // 如果请求成功，更新缓存并返回
                if (response && response.status === 200 && response.type === 'basic') {
                    const responseToCache = response.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseToCache);
                    });
                }
                return response;
            })
            .catch(() => {
                // 网络不可用时，尝试从缓存获取
                return caches.match(event.request);
            })
    );
});

const KNOWN_CACHES = [CACHE_NAME, AUDIO_CACHE_NAME];

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (!KNOWN_CACHES.includes(cacheName)) {
                        console.log('[SW] Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
    self.clients.claim();
});
