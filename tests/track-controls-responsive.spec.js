const { test, expect } = require('@playwright/test');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

let server;
let origin;
test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/compact-track-icons.css') {
      res.writeHead(200, { 'content-type': 'text/css; charset=utf-8' });
      return res.end(fs.readFileSync(path.join(__dirname, '..', 'compact-track-icons.css')));
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/compact-track-icons.css"><section class="track" style="width:260px"><div class="track-controls"><button class="track-record-btn" aria-label="Toggle recording"><span class="control-icon" aria-hidden="true">●</span><span class="record-label">Rec</span></button><button class="track-mute-btn" aria-label="Mute track" title="Mute track"><span class="track-action-icon" aria-hidden="true">⍉</span><span class="track-action-label">Mute</span></button><button class="track-solo-btn" aria-label="Solo track" title="Solo track"><span class="track-action-icon" aria-hidden="true">★</span><span class="track-action-label">Solo</span></button><button class="track-remove-btn" aria-label="Remove track" title="Remove track"><span class="track-action-icon" aria-hidden="true">✖</span><span class="track-action-label">Remove</span></button></div></section>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async () => { if (server) await new Promise(resolve => server.close(resolve)); });

test('track controls switch to themed icons when their track is cramped and retain accessible names', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 700 });
  await page.goto(origin);
  await expect(page.locator('link[rel="stylesheet"]')).toHaveAttribute('href', '/compact-track-icons.css');
  await expect(page.locator('.track-controls .track-record-btn')).toBeVisible();
  const controls = page.locator('.track-controls');
  await expect(controls.getByRole('button', { name: 'Toggle recording' })).toBeVisible();
  await expect(controls.getByRole('button', { name: 'Mute track' })).toBeVisible();
  await expect(controls.getByRole('button', { name: 'Solo track' })).toBeVisible();
  await expect(controls.getByRole('button', { name: 'Remove track' })).toBeVisible();
  await expect(page.locator('.track-solo-btn .track-action-label')).toBeHidden();
  await expect(page.locator('.track-solo-btn .track-action-icon')).toBeVisible();
  const targets = await controls.locator('button').evaluateAll(buttons => buttons.map(button => {
    const rect = button.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }));
  expect(targets).toHaveLength(4);
  for (const target of targets) {
    expect(target.width).toBeGreaterThanOrEqual(44);
    expect(target.height).toBeGreaterThanOrEqual(44);
  }
  let activated = 0;
  await controls.locator('button').evaluateAll(buttons => buttons.forEach(button => button.addEventListener('click', () => button.dataset.clicked = 'true')));
  for (const button of await controls.locator('button').all()) await button.click();
  activated = await controls.locator('button[data-clicked="true"]').count();
  expect(activated).toBe(4);
  const theme = await page.locator('.track-solo-btn').evaluate(el => ({ color: getComputedStyle(el).color, background: getComputedStyle(el).backgroundColor }));
  expect(theme.color).not.toBe('rgba(0, 0, 0, 0)');
  expect(theme.background).not.toBe('rgba(0, 0, 0, 0)');
});
