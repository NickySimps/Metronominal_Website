const { test, expect } = require('@playwright/test');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createSyncServer } = require('../../MetronomeSignalServer/server');
let signal, web, origin, signalURL;
test.beforeAll(async () => {
  signal = createSyncServer({ port: 0, logger: {log(){},warn(){}} });
  await new Promise(r => signal.wss.once('listening', r));
  signalURL = `ws://127.0.0.1:${signal.wss.address().port}`;
  const root = path.resolve(__dirname, '..');
  web = http.createServer((req, res) => {
    const file = path.resolve(root, `.${decodeURIComponent(new URL(req.url, 'http://localhost').pathname)}`);
    if (!file.startsWith(root + path.sep) && file !== root) { res.writeHead(403); res.end(); return; }
    const target = fs.existsSync(file) && fs.statSync(file).isDirectory() ? path.join(file, 'index.html') : file;
    fs.readFile(target, (err, data) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.setHeader('Content-Type', target.endsWith('.js') ? 'text/javascript' : target.endsWith('.css') ? 'text/css' : target.endsWith('.html') ? 'text/html' : 'application/octet-stream'); res.end(data);
    });
  });
  await new Promise(r => web.listen(0, '127.0.0.1', r)); origin = `http://127.0.0.1:${web.address().port}`;
});
test.afterAll(async () => { await signal?.close(); await new Promise(r => web?.close(r)); });
for (const skew of [30000, -30000]) test(`confidence freshness uses synchronized time with ${skew}ms browser skew`, async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  try {
    await context.addInitScript(({ url, skew }) => {
      const now = Date.now.bind(Date); Date.now = () => now() + skew;
      const Native = window.WebSocket;
      window.WebSocket = class extends Native { constructor(endpoint, ...args) { super(endpoint === 'ws://127.0.0.1:10000' ? url : endpoint, ...args); } };
    }, {url: signalURL, skew});
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message)); await page.goto(origin);
    await expect.poll(() => page.evaluate(async () => {
      const m = await import('./js/webrtc.js'); const s = m.getRehearsalRoomState();
      return m.getSyncDiagnostics().timeSyncReady && s.participants.find(p => p.peerId === s.ownPeerId)?.clockQuality;
    })).toBe('good');
    await page.evaluate(() => { document.querySelector('#rehearsal-room-root').closest('details').open = true; });
    const row = page.locator('[data-rehearsal-grid] tbody tr').filter({hasText:'(you)'});
    await expect(row.locator('td').nth(3)).toHaveText('good');
    await expect(row.locator('td').nth(4)).not.toHaveText('Unknown / stale');
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});
test('confidence never treats unsynchronized, stale or implausibly future reports as fresh', async ({ page }) => {
  const source = fs.readFileSync(path.resolve(__dirname, '../js/rehearsalRoomController.js'), 'utf8');
  await page.route('http://confidence.test/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/js/rehearsalRoomController.js') return route.fulfill({contentType:'text/javascript', body:source});
    // The real controller imports motion; serve its genuine dependency, not the HTML fixture.
    if (url.pathname === '/js/interactionMotion.js') return route.fulfill({contentType:'text/javascript', path:path.resolve(__dirname, '../js/interactionMotion.js')});
    if (url.pathname === '/js/webrtc.js') return route.fulfill({contentType:'text/javascript', body:`
      export const getRehearsalRoomState = () => window.fixture;
      export const getSyncDiagnostics = () => window.diagnostics;
      export const getTimeOffset = () => window.diagnostics.clockOffset;
      export const setRehearsalReadiness = () => true;
      export const requestRehearsalControl = () => true;
      export const approveRehearsalControl = () => true;
      export const reconnectSynchronization = () => true;
      export const resyncRehearsalRoom = () => true;
      export const restoreOwnRehearsalRoom = () => true;
    `});
    return route.fulfill({contentType:'text/html', body:'<section id="root"></section>'});
  });
  await page.goto('http://confidence.test/');
  await page.evaluate(async () => {
    Date.now = () => 1700000030000;
    window.diagnostics = {timeSyncReady:true, clockOffset:-30000};
    window.fixture = {supported:true,joined:true,isHost:true,ownPeerId:'one',localName:'',explicitReady:false,hostConnected:true,requests:[],participants:[{peerId:'one',name:'Peer',role:'host',ready:true,connected:true,clockQuality:'good',audioState:'running',rtt:1,reportedAt:1700000000000}]};
    (await import('./js/rehearsalRoomController.js')).initializeRehearsalRoomControls(document.querySelector('#root'));
  });
  const clock = page.locator('tbody td').nth(3), audio = page.locator('tbody td').nth(4);
  await expect(clock).toHaveText('good');
  for (const mode of ['unsynchronized','stale','future']) {
    await page.evaluate(mode => {
      diagnostics.timeSyncReady = mode !== 'unsynchronized';
      fixture.participants[0].reportedAt = mode === 'stale' ? 1699999980000 : mode === 'future' ? 1700000020000 : 1700000000000;
      document.dispatchEvent(new Event('rehearsalroomchange'));
    }, mode);
    await expect(clock).toHaveText('Unknown / stale');
    await expect(audio).toHaveText('Unknown / stale');
  }
});
