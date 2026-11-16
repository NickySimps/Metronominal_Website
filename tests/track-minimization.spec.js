const { test, expect } = require('@playwright/test');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
let server;
let origin;
test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const file = pathname === '/' ? 'index.html' : pathname.slice(1);
    const full = path.resolve(root, file);
    if (!full.startsWith(root + path.sep) || !fs.existsSync(full)) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', full.endsWith('.css') ? 'text/css' : full.endsWith('.js') ? 'text/javascript' : full.endsWith('.json') ? 'application/json' : 'text/html');
    res.end(fs.readFileSync(full));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(() => server?.close());

test('unselected rendered tracks compact without hiding beats or disabling controls', async ({ page }) => {
  await page.goto(origin);
  await page.locator('link[href="track-compaction.css"]').evaluate(el => { el.disabled = true; });
  const tracks = page.locator('#all-tracks-wrapper > .track');
  await expect(tracks.first()).toBeVisible();
  const addTrackButton = page.locator('#add-track-btn');
  await expect(addTrackButton).toBeVisible();
  await addTrackButton.click();
  await expect.poll(() => tracks.count()).toBeGreaterThan(1);
  const selected = page.locator('#all-tracks-wrapper > .track.selected');
  const other = page.locator('#all-tracks-wrapper > .track:not(.selected)').first();
  await expect(selected).toHaveCount(1);
  const before = await other.evaluate(el => el.getBoundingClientRect().height);

  await page.locator('link[href="track-compaction.css"]').evaluate(el => { el.disabled = false; });
  await expect.poll(() => other.evaluate(el => el.getBoundingClientRect().height)).toBeLessThan(before);
  await expect(selected.locator('.track-record-btn')).toBeVisible();
  await expect(selected.locator('.track-volume-slider')).toBeVisible();
  for (const selector of ['.track-record-btn', '.track-mute-btn', '.track-solo-btn', '.track-action-row .duplicate-track-btn', '.track-sound-controls', '.track-bottom-sliders-row', '.bar-display-container'])
    await expect(other.locator(selector)).toBeVisible();

  const mute = other.locator('.track-mute-btn');
  await mute.focus();
  await expect(mute).toBeFocused();
  expect(await mute.evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThan(0);
  const solo = other.locator('.track-solo-btn');
  await solo.click();
  await expect(solo).toHaveAttribute('aria-pressed', 'true');
  await solo.click();
  await expect(solo).toHaveAttribute('aria-pressed', 'false');
  await other.hover();
  expect(await other.evaluate(el => getComputedStyle(el.querySelector('.track-action-row')).opacity)).toBe('1');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await other.evaluate(el => getComputedStyle(el).transitionDuration.split(',').map(x => parseFloat(x)).every(x => x === 0))).toBe(true);
});
