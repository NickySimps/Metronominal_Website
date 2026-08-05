const CACHE_NAME = 'metronominal-v140';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './style.css',
  './track-actions.css',
  './script.js',
  './Click1.mp3',
  './Click2.mp3',
  './Crank1.mp3',
  './Crank2.mp3',
  './manifest.json',
  './js/appState.js',
  './js/audioController.js',
  './js/audioEffects.js',
  './js/audioSerialization.js',
  './js/barControlsController.js',
  './js/barDisplayController.js',
  './js/beatTiming.js',
  './js/domSelectors.js',
  './js/metronomeEngine.js',
  './js/metronomeWorker.js',
  './js/oscilloscope.js',
  './js/playbackController.js',
  './js/presetController.js',
  './js/recordingManager.js',
  './js/recordingVisualizer.js',
  './js/slider.js',
  './js/songController.js',
  './js/soundSettingsModal.js',
  './js/soundSynth.js',
  './js/stickyControls.js',
  './js/tempoController.js',
  './js/themeController.js',
  './js/tracksController.js',
  './js/uiController.js',
  './js/userInteraction.js',
  './js/utils.js',
  './js/volumeController.js',
  './js/webrtc.js',
  './js/vendor/qrcode.min.js',
  './js/3D/3dTheme.js',
  './js/3D/threeDCameraManager.js',
  './js/3D/threeDConstants.js',
  './js/3D/threeDControlsManager.js',
  './js/3D/threeDInteractionManager.js',
  './js/3D/threeDMeasuresManager.js',
  './js/3D/threeDObjectFactory.js',
  './js/3D/threeDSceneManager.js',
  './assets/logo.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      console.log('[Service Worker] Caching static assets');
      await Promise.allSettled(
        ASSETS_TO_CACHE.map((url) => cache.add(url).catch((err) => console.warn(`Failed to cache ${url}:`, err)))
      );
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log('[Service Worker] Deleting old cache:', cache);
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  // Only handle HTTP and HTTPS scheme requests (ignore chrome-extension, ws, file, etc.)
  if (!event.request.url.startsWith('http://') && !event.request.url.startsWith('https://')) {
    return;
  }

  // Ignore Live Server & WebSocket injected dev scripts
  if (event.request.url.includes('live-reload') || event.request.url.includes('browser-sync') || event.request.url.includes('_liveServer')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(() => cachedResponse);

      return cachedResponse || fetchPromise;
    })
  );
});
