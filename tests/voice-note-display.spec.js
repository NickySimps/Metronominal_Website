const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

// Standalone fixture: actual production bytes, no app, audio, CDN or transport.
test.use({ channel: 'chrome' });
let server, origin;
test.beforeAll(async () => {
  const root = path.resolve(__dirname, '..');
  server = http.createServer((req, res) => {
    const assets = {
      '/js/voiceNoteDisplay.js': ['js/voiceNoteDisplay.js', 'text/javascript'],
      '/voice-note-display.css': ['voice-note-display.css', 'text/css'],
    };
    if (req.url === '/') {
      res.setHeader('Content-Type', 'text/html');
      res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/voice-note-display.css"><style>body{margin:16px;--Background:#e3ffe8;--ReadableOnBackground:#000;--font-family:Arial,sans-serif}</style><main id="mount"><span id="unowned">Keep me</span></main>');
      return;
    }
    if (req.url === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    const asset = assets[req.url];
    if (!asset) { res.writeHead(404); res.end(); return; }
    fs.readFile(path.join(root, asset[0]), (error, bytes) => {
      res.writeHead(error ? 404 : 200, { 'Content-Type': asset[1] });
      res.end(error ? '' : bytes);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async () => { await new Promise(resolve => server.close(resolve)); });
const errors = new WeakMap();
test.beforeEach(async ({ page }) => {
  const observed = [];
  errors.set(page, observed);
  page.on('pageerror', error => observed.push(error.message));
  page.on('console', message => { if (message.type() === 'error') observed.push(message.text()); });
  page.on('requestfailed', request => observed.push(`${request.url()}: ${request.failure().errorText}`));
});
test.afterEach(async ({ page }) => { expect(errors.get(page)).toEqual([]); });

async function mount(page, options = {}) {
  await page.goto(origin);
  await page.evaluate(async options => {
    const { createVoiceNoteDisplay } = await import('/js/voiceNoteDisplay.js');
    window.display = createVoiceNoteDisplay(document.querySelector('#mount'), options);
  }, options);
}
const update = (page, value) => page.evaluate(value => window.display.update(value), value);

test('commits stable identity changes once and displays signed intervals above the fixed note', async ({ page }) => {
  await page.clock.install({ time: new Date('2020-01-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2020-01-02T00:00:00Z'));
  await mount(page);
  await update(page, { id: 60, label: 'C4', interval: null });
  await page.clock.fastForward(300);
  await update(page, { id: 62, label: 'D4', interval: 2 });
  await page.clock.fastForward(119);
  expect(await page.locator('.voice-note-display__current').textContent()).toBe('C4');
  // Returning to the committed note cancels a jitter candidate.
  await update(page, { id: 60, label: 'C4', interval: 999 });
  await page.clock.fastForward(150);
  expect(await page.locator('.voice-note-display__departing').count()).toBe(0);
  await update(page, { id: 62, label: 'D4', interval: 2 });
  await page.clock.fastForward(60);
  await update(page, { id: 62, label: 'D4', interval: 2 });
  await page.clock.fastForward(60);
  expect(await page.locator('.voice-note-display__current').textContent()).toBe('D4');
  await expect(page.locator('.voice-note-display__interval')).toHaveText('↑ 2');
  await expect(page.locator('.voice-note-display__departing')).toHaveText('C4');
  const same = await page.evaluate(() => {
    const node = document.querySelector('.voice-note-display__departing');
    window.display.update({ id: 62, label: 'jitter label', interval: -9 });
    return node === document.querySelector('.voice-note-display__departing');
  });
  expect(same).toBe(true);
  expect(await page.locator('.voice-note-display__current').textContent()).toBe('D4');
  await page.clock.fastForward(300);
  expect(await page.locator('.voice-note-display__departing').count()).toBe(0);
  await update(page, { id: 59, label: 'B3', interval: -3 });
  await page.clock.fastForward(120);
  await expect(page.locator('.voice-note-display__interval')).toHaveText('↓ 3');
  await page.clock.fastForward(300);
  await expect(page.getByRole('status')).toHaveText('Note B3, down 3');
});

test('keeps the current anchor fixed, wiggles only its glyph, and slides the old note left at 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 560 });
  await mount(page, { stabilityMs: 0 });
  await update(page, { id: 60, label: 'C4' });
  const anchor = await page.locator('.voice-note-display__current').boundingBox();
  expect(anchor.width).toBeGreaterThan(30);
  const held = await page.evaluate(() => {
    const root = document.querySelector('.voice-note-display');
    const animation = root.getAnimations({ subtree: true }).find(a => a.animationName === 'voice-note-held');
    if (!animation) return null;
    window.heldAnimation = animation;
    animation.pause();
    animation.currentTime = 250;
    return { target: animation.effect.target.className, duration: animation.effect.getTiming().duration };
  });
  expect(held).toEqual({ target: 'voice-note-display__glyph', duration: 1600 });
  expect(await page.locator('.voice-note-display__current').boundingBox()).toEqual(anchor);
  await update(page, { id: 60, label: 'C4' });
  expect(await page.evaluate(() => document.querySelector('.voice-note-display__glyph').getAnimations()[0] === window.heldAnimation)).toBe(true);
  await update(page, { id: 64, label: 'E4', interval: 4 });
  await expect(page.locator('.voice-note-display__current')).toHaveText('E4');
  expect(await page.locator('.voice-note-display__current').boundingBox()).toEqual(anchor);
  const movement = await page.evaluate(() => {
    const old = document.querySelector('.voice-note-display__departing');
    const animation = old.getAnimations()[0];
    if (!animation) return null;
    animation.pause();
    animation.currentTime = 150;
    return { left: old.getBoundingClientRect().left, opacity: Number(getComputedStyle(old).opacity), duration: animation.effect.getTiming().duration };
  });
  expect(movement.duration).toBe(300);
  expect(movement.left).toBeLessThan(anchor.x - 10);
  expect(movement.opacity).toBeLessThan(1);
  const interval = await page.locator('.voice-note-display__interval').boundingBox();
  expect(interval.y + interval.height).toBeLessThanOrEqual(anchor.y);
  const bounds = await page.locator('.voice-note-display').boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
});

test('honors initial and live reduced-motion changes without losing note or interval information', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mount(page, { stabilityMs: 0 });
  await update(page, { id: 60, label: 'C4' });
  expect(await page.locator('.voice-note-display__glyph').evaluate(node => node.getAnimations().length)).toBe(0);
  await update(page, { id: 64, label: 'E4', interval: 4 });
  await expect(page.locator('.voice-note-display__current')).toHaveText('E4');
  await expect(page.locator('.voice-note-display__interval')).toHaveText('↑ 4');
  expect(await page.locator('.voice-note-display__departing').count()).toBe(0);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect.poll(() => page.locator('.voice-note-display__glyph').evaluate(node => node.getAnimations().length)).toBe(1);
  await update(page, { id: 62, label: 'D4', interval: -2 });
  await expect(page.locator('.voice-note-display__current')).toHaveText('D4');
  await expect(page.locator('.voice-note-display__departing')).toHaveCount(1);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('.voice-note-display__departing')).toHaveCount(0);
  expect(await page.locator('.voice-note-display').evaluate(node => node.getAnimations({ subtree: true }).length)).toBe(0);
  await expect(page.locator('.voice-note-display__interval')).toHaveText('↓ 2');
});

test('rejects malformed updates atomically rather than displaying invalid identities or intervals', async ({ page }) => {
  await mount(page);
  await update(page, { id: 60, label: 'C4' });
  const result = await page.evaluate(() => {
    const invalid = [ {}, { id: NaN, label: 'bad' }, { id: {}, label: 'bad' },
      { id: 61, label: '' }, { id: 61, label: 12 }, { id: 61, label: 'bad', interval: NaN },
      { id: 61, label: 'bad', interval: 1.2 }, { id: 61, label: 'bad', interval: '2' } ];
    return invalid.map(note => { try { window.display.update(note); return false; } catch (e) { return e instanceof TypeError; } });
  });
  expect(result.every(Boolean)).toBe(true);
  await expect(page.locator('.voice-note-display__current')).toHaveText('C4');
  const invalidOptions = await page.evaluate(async () => {
    const { createVoiceNoteDisplay } = await import('/js/voiceNoteDisplay.js');
    return [-1, Infinity, '120'].map(stabilityMs => {
      try { createVoiceNoteDisplay(document.querySelector('#mount'), { stabilityMs }); return false; }
      catch (e) { return e instanceof TypeError; }
    });
  });
  expect(invalidOptions.every(Boolean)).toBe(true);
  await expect(page.locator('.voice-note-display')).toHaveCount(1);
});

test('announces a four-note 200ms melody periodically and preserves its final identity through silence', async ({ page }) => {
  await page.clock.install({ time: new Date('2020-01-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2020-01-02T00:00:00Z'));
  await mount(page);
  await page.evaluate(() => {
    window.announcements = [];
    const status = document.querySelector('[role=status]');
    new MutationObserver(() => window.announcements.push({ text: status.textContent, time: Date.now() }))
      .observe(status, { childList: true, subtree: true });
  });
  for (const [id, label] of [[60, 'C4'], [62, 'D4'], [64, 'E4'], [65, 'F4']]) {
    await update(page, { id, label });
    await page.clock.runFor(200);
  }
  const during = await page.evaluate(() => window.announcements);
  expect(during.length).toBe(2);
  await update(page, null);
  await expect(page.locator('.voice-note-display__current')).toHaveText('—');
  // Repeated silence must not cancel the final committed note's pending status.
  await page.clock.runFor(50);
  await update(page, null);
  await page.clock.runFor(300);
  await expect(page.getByRole('status')).toHaveText('Note F4');
  const announcements = await page.evaluate(() => window.announcements);
  expect(announcements.length).toBeLessThanOrEqual(3);
  expect(announcements.every(entry => entry.text)).toBe(true);
  for (let i = 1; i < announcements.length; i++) {
    expect(announcements[i].time - announcements[i - 1].time).toBeGreaterThanOrEqual(300);
  }
  expect(await page.getByRole('status').ariaSnapshot()).toContain('Note F4');
  await page.clock.runFor(2000);
  expect(await page.evaluate(() => window.announcements)).toEqual(announcements);
});

test('bounds history and live announcements during bursts, then clears and restarts cleanly', async ({ page }) => {
  await page.clock.install({ time: new Date('2020-01-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2020-01-02T00:00:00Z'));
  await mount(page);
  await page.evaluate(() => {
    window.announcements = [];
    new MutationObserver(() => window.announcements.push(document.querySelector('[role=status]').textContent))
      .observe(document.querySelector('[role=status]'), { childList: true, subtree: true });
  });
  for (let id = 60; id < 80; id++) {
    await update(page, { id, label: `N${id}`, interval: 1 });
    await page.clock.runFor(120);
    expect(await page.locator('.voice-note-display__departing').count()).toBeLessThanOrEqual(1);
    expect(await page.locator('.voice-note-display *').count()).toBeLessThanOrEqual(6);
  }
  const during = await page.evaluate(() => window.announcements.length);
  expect(during).toBeGreaterThanOrEqual(6);
  expect(during).toBeLessThanOrEqual(8);
  await page.clock.runFor(300);
  await expect(page.getByRole('status')).toHaveText('Note N79, up 1');
  const count = await page.evaluate(() => window.announcements.length);
  expect(count).toBeLessThanOrEqual(9);
  for (let i = 0; i < 50; i++) await update(page, { id: 79, label: 'N79', interval: 1 });
  await page.clock.fastForward(500);
  expect(await page.evaluate(() => window.announcements.length)).toBe(count);
  await update(page, { id: 80, label: 'pending', interval: 1 });
  await update(page, null);
  await page.clock.fastForward(1000);
  await expect(page.locator('.voice-note-display__current')).toHaveText('—');
  await expect(page.getByRole('status')).toHaveText('Note N79, up 1');
  await expect(page.locator('.voice-note-display__interval')).toBeEmpty();
  await expect(page.locator('.voice-note-display__departing')).toHaveCount(0);
  expect(await page.locator('.voice-note-display__glyph').evaluate(node => node.getAnimations().length)).toBe(0);
  await update(page, { id: 'restart', label: 'C4', interval: 0 });
  await expect(page.locator('.voice-note-display__current')).toHaveText('C4');
  await expect(page.locator('.voice-note-display__interval')).toHaveText('= 0');
});

test('keeps unstable candidates and repeated samples out of the live region', async ({ page }) => {
  await page.clock.install({ time: new Date('2020-01-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2020-01-02T00:00:00Z'));
  await mount(page);
  await update(page, { id: 60, label: 'C4' });
  await page.clock.runFor(300);
  await page.evaluate(() => {
    window.announcements = [];
    const status = document.querySelector('[role=status]');
    new MutationObserver(() => window.announcements.push(status.textContent))
      .observe(status, { childList: true, subtree: true });
  });
  for (let i = 0; i < 20; i++) {
    await update(page, { id: i % 2 ? 61 : 62, label: 'unstable' });
    await page.clock.runFor(50);
    await update(page, { id: 60, label: 'ignored metadata', interval: 999 });
    await page.clock.runFor(50);
  }
  await page.clock.runFor(500);
  await expect(page.getByRole('status')).toHaveText('Note C4');
  expect(await page.evaluate(() => window.announcements)).toEqual([]);
});

test('destroy removes all owned timers, media listeners and animations without removing siblings', async ({ page }) => {
  await page.addInitScript(() => {
    window.pendingTimers = new Set();
    const set = window.setTimeout.bind(window), clear = window.clearTimeout.bind(window);
    window.setTimeout = (callback, delay, ...args) => {
      const id = set(() => { window.pendingTimers.delete(id); callback(...args); }, delay);
      window.pendingTimers.add(id);
      return id;
    };
    window.clearTimeout = id => { window.pendingTimers.delete(id); clear(id); };
    window.mediaListeners = new Set();
    const add = MediaQueryList.prototype.addEventListener;
    const remove = MediaQueryList.prototype.removeEventListener;
    MediaQueryList.prototype.addEventListener = function(type, fn, ...args) {
      if (type === 'change') window.mediaListeners.add(fn);
      return add.call(this, type, fn, ...args);
    };
    MediaQueryList.prototype.removeEventListener = function(type, fn, ...args) {
      window.mediaListeners.delete(fn);
      return remove.call(this, type, fn, ...args);
    };
  });
  await mount(page, { stabilityMs: 0 });
  await update(page, { id: 60, label: 'C4' });
  await update(page, { id: 62, label: 'D4', interval: 2 });
  await expect(page.locator('.voice-note-display__current')).toHaveText('D4');
  const result = await page.evaluate(async () => {
    const root = document.querySelector('.voice-note-display');
    window.detachedStatus = root.querySelector('[role=status]');
    window.staleAnnouncements = [];
    new MutationObserver(() => window.staleAnnouncements.push(window.detachedStatus.textContent))
      .observe(window.detachedStatus, { childList: true, subtree: true });
    const before = { timers: window.pendingTimers.size, listeners: window.mediaListeners.size };
    const { createVoiceNoteDisplay } = await import('/js/voiceNoteDisplay.js');
    const other = createVoiceNoteDisplay(document.querySelector('#mount'));
    other.update({ id: 'a', label: 'A4' });
    other.update({ id: 'b', label: 'B4', interval: 2 }); // pending candidate at destruction
    other.destroy();
    window.display.destroy();
    window.display.destroy();
    window.display.update({ id: 65, label: 'F4' }); // inert after destruction
    return { before, timers: window.pendingTimers.size, listeners: window.mediaListeners.size,
      animations: root.getAnimations({ subtree: true }).filter(a => a.playState === 'running').length };
  });
  expect(result.before.timers).toBeGreaterThan(0);
  expect(result.before.timers).toBeLessThanOrEqual(3);
  expect(result.before.listeners).toBe(1);
  expect(result.timers).toBe(0);
  expect(result.listeners).toBe(0);
  expect(result.animations).toBe(0);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.staleAnnouncements)).toEqual([]);
  expect(await page.evaluate(() => window.pendingTimers.size)).toBe(0);
  await expect(page.locator('.voice-note-display')).toHaveCount(0);
  await expect(page.locator('#unowned')).toHaveText('Keep me');
});

for (const width of [320, 1280]) {
  test(`theme tokens retain contrast and bounded geometry at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 600 });
    await mount(page);
    await update(page, { id: 'long', label: 'A very long literal note label that must not expand its container', interval: 12345 });
    const palettes = [['#e3ffe8', '#000000'], ['#111111', '#ffffff'], ['#ffffff', '#000000'], ['#301060', '#ffffff']];
    for (const [background, foreground] of palettes) {
      const colors = await page.evaluate(({ background, foreground }) => {
        const root = document.querySelector('.voice-note-display');
        root.style.setProperty('--Background', background);
        root.style.setProperty('--ReadableOnBackground', foreground);
        const style = getComputedStyle(root);
        const rect = root.getBoundingClientRect();
        return { bg: style.backgroundColor, fg: style.color, left: rect.left, right: rect.right,
          overflow: document.documentElement.scrollWidth > innerWidth };
      }, { background, foreground });
      const luminance = color => color.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => {
        const c = v / 255;
        return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;
      }).reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
      const a = luminance(colors.bg), b = luminance(colors.fg);
      expect((Math.max(a, b) + .05) / (Math.min(a, b) + .05)).toBeGreaterThanOrEqual(4.5);
      expect(colors.left).toBeGreaterThanOrEqual(0);
      expect(colors.right).toBeLessThanOrEqual(width);
      expect(colors.overflow).toBe(false);
    }
  });
}

test('renders supplied note text safely with a quiet initial status', async ({ page }) => {
  await mount(page);
  await expect(page.getByRole('status')).toBeEmpty();
  await update(page, { id: 60, label: '<img src=x onerror=alert(1)>', interval: null });
  await expect(page.locator('.voice-note-display__current')).toHaveText('<img src=x onerror=alert(1)>');
  expect(await page.locator('#mount img').count()).toBe(0);
  await expect(page.getByRole('status')).toHaveText('Note <img src=x onerror=alert(1)>');
  await expect(page.locator('.voice-note-display__visual')).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('#unowned')).toHaveText('Keep me');
});
