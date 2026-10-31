'use strict';
// Real browser + HTTP cache + unchanged committed v194 worker; no SW mocks/routes.
// Run: node --test checks/sw-v195-controlled-upgrade.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const gitFile = file => execFileSync('git', ['show', `2a68cf5:${file}`], { cwd: root, maxBuffer: 20 * 1024 * 1024 });
const assets = source => [...source.matchAll(/'\.\/([^']*)'/g)].map(match => '/' + match[1]);
const fileFor = url => url === '/' ? 'index.html' : url.slice(1);
const mime = url => url.endsWith('.js') ? 'text/javascript' : url.endsWith('.css') ? 'text/css' : url.endsWith('.mp3') ? 'audio/mpeg' : url.endsWith('.png') ? 'image/png' : url.endsWith('.json') ? 'application/json' : 'text/html';

test('v194 controlled cached client upgrades to v195 and serves exact candidate bytes offline', { timeout: 120000 }, async () => {
  const baselineSW = gitFile('sw.js');
  assert.match(baselineSW.toString(), /metronominal-v194/);
  const candidateSW = fs.readFileSync(path.join(root, 'sw.js'));
  // Fault injection is test-server-only: prove genuine fresh old HTTP entries
  // defeat installation if the existing reload policy is accidentally removed.
  const servedCandidateSW = process.env.SW_V195_NEGATIVE_NO_RELOAD === '1'
    ? Buffer.from(candidateSW.toString().replace("{ cache: 'reload' }", "{ cache: 'default' }"))
    : candidateSW;
  const oldPaths = assets(baselineSW.toString()), newPaths = assets(candidateSW.toString());
  const oldBytes = new Map(oldPaths.map(url => [url, gitFile(fileFor(url))]));
  const candidateBytes = new Map(newPaths.map(url => [url, fs.readFileSync(path.join(root, fileFor(url)))]));
  const expectedHashes = Object.fromEntries([...candidateBytes].map(([url, bytes]) => [url, sha(bytes)]));
  let phase = 'v194';
  const requests = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost').pathname;
    requests.push({ phase, url });
    res.setHeader('Cache-Control', url === '/sw.js' || url === '/upgrade-client.html' ? 'no-store' : 'public, max-age=86400');
    res.setHeader('Content-Type', mime(url));
    if (url === '/sw.js') return res.end(phase === 'v194' ? baselineSW : servedCandidateSW);
    if (url === '/upgrade-client.html') return res.end('<!doctype html><title>Controlled upgrade probe</title>');
    const bytes = (phase === 'v194' ? oldBytes : candidateBytes).get(url);
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
    // Prime genuinely fresh old HTTP responses before any worker controls the client.
    await page.evaluate(async urls => {
      for (const url of urls) {
        const response = await fetch(url, { cache: 'reload' });
        if (!response.ok) throw new Error(`Old HTTP warm failed: ${url}`);
        await response.arrayBuffer();
      }
    }, oldPaths);
    await page.evaluate(async () => {
      await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
    });
    assert.deepEqual(await page.evaluate(() => caches.keys()), ['metronominal-v194']);
    const oldHTML = await page.evaluate(async () => {
      const response = await fetch('/index.html');
      return response.text();
    });
    assert.equal(sha(Buffer.from(oldHTML)), sha(oldBytes.get('/index.html')));
    const oldController = await page.evaluate(() => {
      window.__oldController = navigator.serviceWorker.controller;
      window.__controllerChanges = 0;
      navigator.serviceWorker.addEventListener('controllerchange', () => window.__controllerChanges++);
      return { controlled: !!window.__oldController, scriptURL: window.__oldController.scriptURL };
    });
    assert.equal(oldController.controlled, true);
    // Verify default fetch really uses the fresh old HTTP cache (worker bypassed
    // only for this diagnostic), so the stale-cache precondition is not assumed.
    const session = await context.newCDPSession(page);
    await session.send('Network.setBypassServiceWorker', { bypass: true });
    const beforeProbe = requests.length;
    const oldScript = await page.evaluate(async () => (await fetch('/script.js')).text());
    assert.equal(sha(Buffer.from(oldScript)), sha(oldBytes.get('/script.js')));
    assert.equal(requests.slice(beforeProbe).filter(r => r.url === '/script.js').length, 0, 'Old script was not a fresh HTTP cache hit');
    await session.send('Network.setBypassServiceWorker', { bypass: false });
    // Drain any v194 stale-while-revalidate requests before switching the server.
    await page.waitForTimeout(200);
    phase = 'candidate';
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
    // Poll awaited CacheStorage results with a bounded deadline.
    let rollout;
    const deadline = Date.now() + 15000;
    do {
      rollout = await page.evaluate(async () => ({ keys: await caches.keys(), changes: window.__controllerChanges }));
      if (rollout.keys.length === 1 && rollout.keys[0] === 'metronominal-v195' && rollout.changes > 0) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    } while (Date.now() < deadline);
    assert.ok(rollout.keys.length === 1 && rollout.keys[0] === 'metronominal-v195' && rollout.changes > 0, `Candidate did not roll to v195: ${JSON.stringify(rollout)}`);
    assert.deepEqual(await page.evaluate(() => caches.keys()), ['metronominal-v195']);
    const controllerEvidence = await page.evaluate(() => ({ changes: window.__controllerChanges, replaced: navigator.serviceWorker.controller !== window.__oldController }));
    assert.equal(controllerEvidence.replaced, true);
    assert.equal(controllerEvidence.changes, 1);
    const missingNetwork = newPaths.filter(url => !requests.some(req => req.phase === 'candidate' && req.url === url));
    const cacheHashes = await page.evaluate(async urls => {
      const cache = await caches.open('metronominal-v195');
      const result = {};
      for (const url of urls) {
        const response = await cache.match(url);
        if (!response) throw new Error(`Missing new cache entry: ${url}`);
        result[url] = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await response.arrayBuffer()))].map(n => n.toString(16).padStart(2, '0')).join('');
      }
      return result;
    }, newPaths);
    const mismatchedHashes = newPaths.filter(url => cacheHashes[url] !== expectedHashes[url]);
    assert.deepEqual(mismatchedHashes.map(url => ({ url, actual: cacheHashes[url], expected: expectedHashes[url] })), [], 'New CacheStorage bytes differ from candidate');
    assert.deepEqual(missingNetwork, [], 'Candidate install reused stale HTTP assets');
    await context.setOffline(true);
    await new Promise(resolve => server.close(resolve));
    const offlineHashes = await page.evaluate(async urls => {
      const result = {};
      for (const url of urls) {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Offline fetch failed: ${url}`);
        result[url] = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await response.arrayBuffer()))].map(n => n.toString(16).padStart(2, '0')).join('');
      }
      return result;
    }, newPaths);
    assert.deepEqual(offlineHashes, expectedHashes, 'Controlled offline fetch returned stale bytes');
    const navigation = await page.goto(origin + '/index.html', { waitUntil: 'commit' });
    assert.equal(navigation.fromServiceWorker(), true);
    assert.equal(sha(await navigation.body()), expectedHashes['/index.html']);
    assert.equal(await page.evaluate(() => !!navigator.serviceWorker.controller), true);
    const changedOldAssets = oldPaths.filter(url => candidateBytes.has(url) && sha(oldBytes.get(url)) !== expectedHashes[url]);
    assert.ok(changedOldAssets.includes('/script.js'), 'Fixture needs genuinely changed script.js');
    for (const motion of ['/interaction-motion.css', '/js/interactionMotion.js']) assert.ok(offlineHashes[motion], `Missing exact motion verification: ${motion}`);
    // Detect concurrent source changes rather than calling a stale snapshot current.
    for (const [url, bytes] of candidateBytes) assert.equal(sha(fs.readFileSync(path.join(root, fileFor(url)))), sha(bytes), `Candidate changed during test: ${url}`);
    assert.equal(sha(fs.readFileSync(path.join(root, 'sw.js'))), sha(candidateSW));
    console.log(JSON.stringify({ baseline: '2a68cf5', browser: browser.version(), origin, oldCache: 'metronominal-v194', newCache: 'metronominal-v195', oldFreshHttpCacheProven: true, controllerEvidence, candidateNetworkAssets: newPaths.length, cacheHashesVerified: Object.keys(cacheHashes).length, offlineHashesVerified: Object.keys(offlineHashes).length, offlineNavigationFromServiceWorker: navigation.fromServiceWorker(), changedOldAssets, motion: { css: offlineHashes['/interaction-motion.css'], js: offlineHashes['/js/interactionMotion.js'] }, swSha256: sha(candidateSW), indexSha256: expectedHashes['/index.html'], sourceSnapshotUnchanged: true, limit: 'Local Chromium controlled probe plus actual offline HTML navigation; not deployed/mobile/CDN/native application behavior certification.' }, null, 2));
    await context.close();
  } finally {
    if (browser) await browser.close();
    if (server.listening) await new Promise(resolve => server.close(resolve));
  }
});
