'use strict';
// Real CDN modules and native browser loading: no request routes or mocked SDKs.
// Run against a local/deployed static server with THREE_STARTUP_URL.
const assert = require('node:assert/strict');
const { chromium } = require('@playwright/test');

(async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = [], failures = [], modules = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('requestfailed', request => failures.push({ url: request.url(), error: request.failure()?.errorText }));
    page.on('response', response => {
      if (response.url().includes('cdn.jsdelivr.net/npm/three')) {
        modules.push({ url: response.url(), status: response.status(), version: response.headers()['x-jsd-version'] });
      }
    });
    await page.goto(process.env.THREE_STARTUP_URL || 'http://127.0.0.1:4189/', { waitUntil: 'networkidle' });
    assert.deepEqual(errors, [], `Native startup errors: ${JSON.stringify(errors)}; requests: ${JSON.stringify(failures)}`);
    const map = await page.locator('script[type="importmap"]').evaluate(el => JSON.parse(el.textContent).imports);
    assert.equal(map.three, 'https://cdn.jsdelivr.net/npm/three@0.187.0/build/three.module.js');
    assert.equal(map['three/examples/jsm/'], 'https://cdn.jsdelivr.net/npm/three@0.187.0/examples/jsm/');
    const result = await page.evaluate(async () => {
      const THREE = await import('three');
      const { TextGeometry } = await import('three/examples/jsm/geometries/TextGeometry.js');
      const { FontLoader } = await import('three/examples/jsm/loaders/FontLoader.js');
      const app = (await import('./js/appState.js')).default;
      return { revision: THREE.REVISION, textGeometry: typeof TextGeometry, fontLoader: typeof FontLoader,
        tracks: app.getTracks().length, ready: !document.querySelector('#performance-view-btn').disabled };
    });
    assert.deepEqual(result, { revision: '187', textGeometry: 'function', fontLoader: 'function', tracks: 1, ready: true });
    assert.ok(modules.length >= 4, `Expected core, split core, TextGeometry and FontLoader: ${JSON.stringify(modules)}`);
    for (const module of modules) {
      assert.equal(module.status, 200, module.url);
      assert.equal(module.version, '0.187.0', module.url);
      assert.ok(module.url.includes('/three@0.187.0/'), module.url);
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ result, modules, requestFailures: failures }, null, 2));
    await context.close();
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
