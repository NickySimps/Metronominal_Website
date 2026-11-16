'use strict';
// Run: node --test checks/voice-offline-assets.test.cjs
// Real loopback HTTP, Chromium, HTTP cache, worker upgrade and offline navigation.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const baseline = '73afd23b9e828a423fdd4b279edbf6cc222b1226';
const gitFile = file => execFileSync('git', ['show', `${baseline}:${file}`], { cwd: root, maxBuffer: 20 * 1024 * 1024 });
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const assets = source => [...source.matchAll(/'\.\/([^']*)'/g)].map(match => '/' + match[1]);
const fileFor = url => url === '/' ? 'index.html' : url.slice(1);
const cacheName = source => source.match(/const CACHE_NAME = '([^']+)'/)[1];
const required = [
  '/js/melodySchema.js', '/js/melodyScheduler.js', '/js/melodyVoice.js',
  '/js/voiceCaptureSession.js', '/js/voicePitchDetector.js', '/js/voiceNoteTracker.js',
  '/js/voiceNoteDisplay.js', '/js/voiceTakeEditor.js', '/js/voiceTakeMapping.js',
  '/voice-note-display.css', '/voice-take-editor.css',
  '/js/melodyReuse.js', '/melody-reuse.css',
];
const mime = url => url.endsWith('.js') ? 'text/javascript' : url.endsWith('.css') ? 'text/css' : url.endsWith('.mp3') ? 'audio/mpeg' : url.endsWith('.png') ? 'image/png' : url.endsWith('.json') ? 'application/json' : 'text/html';

function candidate() {
  const sw = fs.readFileSync(path.join(root, 'sw.js'));
  const urls = assets(sw.toString());
  for (const url of required) {
    assert.ok(fs.statSync(path.join(root, fileFor(url))).isFile(), `Missing local asset: ${url}`);
    assert.ok(urls.includes(url), `Missing voice/melody precache asset: ${url}`);
  }
  // Discover current feature modules as well, so a future new module cannot be
  // silently omitted by retaining the fixed required list above.
  for (const file of fs.readdirSync(path.join(root, 'js')).filter(file => /^(voice|melody).*\.js$/.test(file))) {
    assert.ok(urls.includes('/js/' + file), `Uncached feature module: ${file}`);
  }
  assert.equal(new Set(urls).size, urls.length, 'Duplicate precache entries');
  assert.ok(urls.every(url => !/^\/(tests|checks|test-results)(\/|-)/.test(url)), 'Test artifacts must not be cached');
  const bytes = new Map(urls.map(url => [url, fs.readFileSync(path.join(root, fileFor(url)))]));
  // Follow every relative import/re-export, including dynamic literal imports.
  // All local dependencies of each feature must be present as real cached bytes.
  const visited = new Set();
  function visit(url) {
    if (visited.has(url)) return;
    visited.add(url);
    assert.ok(bytes.has(url), `Imported local module is not precached: ${url}`);
    const source = bytes.get(url).toString();
    const imports = /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["'](\.[^"']+)["']/g;
    for (const match of source.matchAll(imports)) {
      const dependency = new URL(match[1], 'http://localhost' + url).pathname;
      visit(dependency);
    }
  }
  required.filter(url => url.endsWith('.js')).forEach(visit);
  return { sw, urls, bytes, name: cacheName(sw.toString()) };
}

test('all voice/melody modules, their local imports and both stylesheets are real precache assets', () => {
  const current = candidate();
  assert.notEqual(current.name, cacheName(gitFile('sw.js').toString()), 'Upgrade must use a new cache namespace');
});

test('old controlled client retrieves exact new bytes, then reloads and imports voice/melody offline', { timeout: 120000 }, async () => {
  const current = candidate();
  const oldSW = gitFile('sw.js');
  const oldName = cacheName(oldSW.toString());
  assert.notEqual(current.name, oldName);
  const oldURLs = assets(oldSW.toString());
  const oldBytes = new Map(oldURLs.map(url => [url, gitFile(fileFor(url))]));
  const expectedHashes = Object.fromEntries([...current.bytes].map(([url, bytes]) => [url, sha(bytes)]));
  // Negative control: only the worker served by this test is changed; disk source
  // is untouched. Fresh old HTTP entries must then cause candidate hash failure.
  const servedSW = process.env.VOICE_OFFLINE_NEGATIVE_NO_RELOAD === '1'
    ? Buffer.from(current.sw.toString().replace("{ cache: 'reload' }", "{ cache: 'default' }")) : current.sw;
  let phase = 'old';
  const requests = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost').pathname;
    requests.push({ phase, url });
    res.setHeader('Cache-Control', ['/sw.js', '/upgrade-client.html'].includes(url) ? 'no-store' : 'public, max-age=86400');
    res.setHeader('Content-Type', mime(url));
    if (url === '/sw.js') return res.end(phase === 'old' ? oldSW : servedSW);
    if (url === '/upgrade-client.html') return res.end('<!doctype html><title>Local controlled upgrade probe</title>');
    const bytes = (phase === 'old' ? oldBytes : current.bytes).get(url);
    if (!bytes) { res.writeHead(404); return res.end('Not found'); }
    res.end(bytes);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ serviceWorkers: 'allow' });
    const page = await context.newPage();
    await page.goto(origin + '/upgrade-client.html');
    await page.evaluate(async urls => {
      for (const url of urls) {
        const response = await fetch(url, { cache: 'reload' });
        if (!response.ok) throw new Error(`Old HTTP warm failed: ${url}`);
        await response.arrayBuffer();
      }
      await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
      window.oldController = navigator.serviceWorker.controller;
      window.controllerChanges = 0;
      navigator.serviceWorker.addEventListener('controllerchange', () => window.controllerChanges++);
    }, oldURLs);
    assert.deepEqual(await page.evaluate(() => caches.keys()), [oldName]);
    const session = await context.newCDPSession(page);
    await session.send('Network.setBypassServiceWorker', { bypass: true });
    const beforeProbe = requests.length;
    const oldState = await page.evaluate(async () => (await fetch('/js/appState.js')).text());
    assert.equal(sha(Buffer.from(oldState)), sha(oldBytes.get('/js/appState.js')));
    assert.equal(requests.slice(beforeProbe).filter(request => request.url === '/js/appState.js').length, 0, 'Old HTTP cache is not genuinely fresh');
    assert.notEqual(sha(oldBytes.get('/js/appState.js')), expectedHashes['/js/appState.js'], 'Fixture needs changed real application bytes');
    await session.send('Network.setBypassServiceWorker', { bypass: false });
    phase = 'candidate';
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
    // Await CacheStorage in evaluate, then poll plain results: an async
    // waitForFunction predicate can yield a truthy Promise before rollout.
    let rollout;
    const deadline = Date.now() + 20000;
    do {
      rollout = await page.evaluate(async () => ({ keys: await caches.keys(), changes: window.controllerChanges }));
      if (rollout.changes > 0 && rollout.keys.length === 1 && rollout.keys[0] === current.name) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    } while (Date.now() < deadline);
    assert.deepEqual(rollout, { keys: [current.name], changes: 1 }, 'Candidate did not replace old worker/cache');
    assert.deepEqual(await page.evaluate(() => ({ changes: window.controllerChanges, replaced: navigator.serviceWorker.controller !== window.oldController })), { changes: 1, replaced: true });
    const hashAssets = async cache => page.evaluate(async ({ urls, name }) => {
      const storage = name ? await caches.open(name) : null;
      const hashes = {};
      for (const url of urls) {
        const response = storage ? await storage.match(url) : await fetch(url);
        if (!response || !response.ok) throw new Error(`Missing offline asset: ${url}`);
        hashes[url] = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await response.arrayBuffer()))].map(n => n.toString(16).padStart(2, '0')).join('');
      }
      return hashes;
    }, { urls: current.urls, name: cache });
    assert.deepEqual(await hashAssets(current.name), expectedHashes, 'Installed cache contains stale or missing candidate bytes');
    assert.deepEqual(current.urls.filter(url => !requests.some(request => request.phase === 'candidate' && request.url === url)), [], 'Install did not retrieve every asset from candidate server');
    await context.setOffline(true);
    await new Promise(resolve => server.close(resolve));
    assert.deepEqual(await hashAssets(null), expectedHashes, 'Offline fetch bytes differ');
    const navigation = await page.goto(origin + '/index.html', { waitUntil: 'commit' });
    assert.equal(navigation.fromServiceWorker(), true);
    assert.equal(sha(await navigation.body()), expectedHashes['/index.html']);
    const reload = await page.reload({ waitUntil: 'commit' });
    assert.equal(reload.fromServiceWorker(), true);
    assert.equal(sha(await reload.body()), expectedHashes['/index.html']);
    assert.ok(await page.evaluate(() => !!navigator.serviceWorker.controller));
    assert.deepEqual(await hashAssets(null), expectedHashes, 'Reload lost cached candidate bytes');
    // Exercise actual module linking/evaluation offline, not only CacheStorage keys.
    const exports = await page.evaluate(async urls => {
      const result = {};
      for (const url of urls) result[url] = Object.keys(await import(url));
      return result;
    }, required.filter(url => url.endsWith('.js')));
    for (const [url, names] of Object.entries(exports)) assert.ok(names.length, `Offline module failed to export: ${url}`);
    for (const [url, bytes] of current.bytes) assert.equal(sha(fs.readFileSync(path.join(root, fileFor(url)))), sha(bytes), `Concurrent candidate edit: ${url}`);
    assert.equal(sha(fs.readFileSync(path.join(root, 'sw.js'))), sha(current.sw));
    console.log(JSON.stringify({ baseline, browser: browser.version(), oldCache: oldName, newCache: current.name, oldFreshHttpCacheProven: true, cacheHashesVerified: current.urls.length, offlineHashesVerified: current.urls.length, offlineNavigationAndReload: true, offlineFeatureImports: Object.keys(exports), swSha256: sha(current.sw), candidateSnapshotUnchanged: true, limit: 'Loopback Chromium offline shell/assets and feature-module imports; not full app boot with uncached external CDN dependencies, deployment, mobile or microphone certification.' }, null, 2));
    await context.close();
  } finally {
    if (browser) await browser.close();
    if (server.listening) await new Promise(resolve => server.close(resolve));
  }
});
