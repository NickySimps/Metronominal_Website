const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const os = require('node:os');
const root = path.join(__dirname, '..');
const temp = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'mounted-recording-'));
const wavPath = path.join(temp, 'generated.wav');
const rate = 48000, frames = rate * 6, wav = Buffer.alloc(44 + frames * 2);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
wav.write('data', 36); wav.writeUInt32LE(frames * 2, 40);
for (let i = 0; i < frames; i++) wav.writeInt16LE(Math.round(12000 * Math.sin(2 * Math.PI * 440 * i / rate)), 44 + i * 2);
fs.writeFileSync(wavPath, wav);
test.use({ channel: 'chrome', launchOptions: { args: ['--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wavPath}`] }, permissions: ['microphone'] });
let server, origin;
test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const file = path.resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
    const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg' };
    fs.readFile(file, (error, bytes) => { res.writeHead(error ? 404 : 200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' }); res.end(bytes); });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); origin = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async () => { await new Promise(resolve => server.close(resolve)); fs.rmSync(temp, { recursive: true, force: true }); });
async function ready(page) {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.generatedStreams = [];
    const acquire = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => { const stream = await acquire(constraints); generatedStreams.push(stream); return stream; };
  });
  const initialized = page.waitForEvent('console', { predicate: m => m.text().includes('Metronominal initialized successfully.'), timeout: 60000 });
  await page.goto(origin); await initialized;
  await page.evaluate(async () => {
    window.a = (await import('/js/appState.js')).default;
    window.audio = (await import('/js/audioController.js')).default;
    (await import('/js/monitoring.js')).default.setMuted(true);
    window.themes = (await import('/js/themeController.js')).default;
    window.tracks = (await import('/js/tracksController.js')).default;
  });
  return errors;
}
test('mounted Rec opens without acquisition and switches waveform to voice only within the menu', async ({ page }) => {
  const errors = await ready(page);
  await expect(page.locator('#recording-mode-controls')).toBeHidden();
  await page.locator('.track-record-btn').first().click();
  await expect(page.locator('#recording-start-btn')).toBeVisible();
  expect(await page.evaluate(() => generatedStreams.length)).toBe(0);
  await page.locator('#recording-mode-voice-btn').click();
  await expect(page.locator('#recording-waveform-canvas')).toBeHidden();
  await expect(page.locator('#voice-note-container')).toBeVisible();
  await expect(page.locator('#recording-mode-voice-btn')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#recording-mode-sample-btn').click();
  await expect(page.locator('#recording-waveform-canvas')).toBeVisible();
  await expect(page.locator('#voice-note-container')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.locator('#recording-mode-controls')).toBeHidden();
  expect(errors).toEqual([]);
});
test('mounted generated-microphone take applies and reuses through the real track action', async ({ page }) => {
  const errors = await ready(page);
  await page.locator('.track-record-btn').first().click();
  await page.locator('#recording-mode-voice-btn').click();
  await page.locator('#recording-start-btn').click();
  await expect(page.locator('.voice-note-display__glyph')).toHaveText('A4', { timeout: 10000 });
  await page.waitForTimeout(450);
  await page.locator('#recording-stop-btn').click();
  await expect(page.locator('.voice-take-editor')).toBeVisible();
  const before = await page.evaluate(() => a.getTracks().length);
  await page.getByRole('button', { name: 'Apply draft', exact: true }).click();
  await expect.poll(() => page.evaluate(() => a.getTracks().length)).toBe(before + 1);
  await expect(page.locator('#recording-display-modal')).toBeHidden();
  const sourceIndex = await page.evaluate(() => { const source = a.getTracks().length - 1; a.addTrack(); a.updateTrack(a.getTracks().length - 1, { mainBeatSound: { sound: 'Synth Triangle', settings: { volume: 1 } }, barSettings: structuredClone(a.getTracks()[source].barSettings) }); tracks.renderTracks(); return source; });
  const targetIndex = await page.evaluate(() => a.getTracks().length - 1);
  await page.locator(`.track[data-container-index="${sourceIndex}"] .track-reuse-notes-btn`).click();
  await expect(page.locator('#melody-reuse-modal')).toBeVisible();
  await page.locator('#melody-reuse-target').selectOption(String(targetIndex));
  await page.locator('#melody-reuse-apply').click();
  expect(await page.evaluate(({sourceIndex,targetIndex}) => ({ same: JSON.stringify(a.getTracks()[sourceIndex].melody) === JSON.stringify(a.getTracks()[targetIndex].melody), sound: a.getTracks()[targetIndex].mainBeatSound.sound, ended: generatedStreams.every(stream => stream.getTracks().every(track => track.readyState === 'ended')) }), {sourceIndex,targetIndex})).toEqual({ same: true, sound: 'Synth Triangle', ended: true });
  expect(errors).toEqual([]);
});
async function auditModal(page, selector) {
  return page.locator(selector).evaluate(modal => {
    const rgb = value => (value.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
    const luminance = value => rgb(value).map(c => { c /= 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; }).reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
    const background = el => {
      const layers = [];
      for (let node = el; node; node = node.parentElement) {
        const values = (getComputedStyle(node).backgroundColor.match(/[\d.]+/g) || []).map(Number);
        if (values.length >= 3) layers.push({ rgb: values.slice(0, 3), alpha: values.length === 4 ? values[3] : 1 });
      }
      const result = layers.reverse().reduce((bg, layer) => layer.rgb.map((c, i) => c * layer.alpha + bg[i] * (1 - layer.alpha)), [255, 255, 255]);
      return `rgb(${result.join(',')})`;
    };
    const r = modal.getBoundingClientRect();
    const controls = [...modal.querySelectorAll('button,select,input')].filter(el => el.getBoundingClientRect().width && el.getBoundingClientRect().height).map(el => { const r = el.getBoundingClientRect(); return { id: el.id, left: r.left, right: r.right, height: r.height, font: getComputedStyle(el).fontFamily, parentFont: getComputedStyle(el.parentElement).fontFamily }; });
    const contrast = [...modal.querySelectorAll('h2,p,label,legend,button,select,.voice-note-display__glyph')].filter(el => !el.disabled && el.getBoundingClientRect().width && el.getBoundingClientRect().height).map(el => { const color = getComputedStyle(el).color, bg = background(el), a = luminance(color), b = luminance(bg); return { label: el.id || el.className || el.tagName, color, background: bg, ratio: (Math.max(a,b) + .05) / (Math.min(a,b) + .05) }; });
    return { left: r.left, right: r.right, controls, contrast };
  });
}
for (const width of [320, 390, 1280]) test(`mounted themed recording and reuse geometry at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 900 }); const errors = await ready(page);
  await page.locator('.track-record-btn').first().click();
  await page.locator('#recording-mode-voice-btn').click();
  const themeNames = await page.locator('[data-theme]').evaluateAll(els => [...new Set(els.map(el => el.dataset.theme))].filter(name => name !== '3d'));
  themeNames.push('random', 'random');
  const failures = [];
  const audit = async (selector, surface) => {
    for (const theme of themeNames) {
      await page.evaluate(theme => { if (theme === 'random') document.querySelector('#random-theme-btn').click(); else themes.applyTheme(theme); }, theme);
      await page.evaluate(() => { for (const a of document.getAnimations()) if (Number.isFinite(a.effect?.getComputedTiming().endTime)) a.finish(); });
      const result = await auditModal(page, selector);
      if (result.left < 0 || result.right > width + 1) failures.push({ theme, surface, modal: result });
      for (const control of result.controls) if (control.left < 0 || control.right > width + 1 || control.height < 43 || control.font !== control.parentFont) failures.push({theme,surface,control});
      for (const text of result.contrast) if (text.ratio < 4.5) failures.push({theme,surface,text});
    }
  };
  await audit('#recording-display-modal', 'recording');
  await page.screenshot({ path: `V:/MetronominalTeam/voice-recording/recording-menu-${width}.png` });
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    const source = a.getTracks()[0];
    a.updateTrack(0, { mainBeatSound: { sound: 'Synth Sine', settings: { ...a.getDefaultSoundSettings('Synth Sine') } }, melody: { version: 1, bars: source.barSettings.map((_, i) => i ? [] : [{ id: 'geometry-note', midi: 69, startTick: 0, durationTicks: 960, velocity: .8 }]) } });
    a.addTrack(); a.updateTrack(a.getTracks().length - 1, { mainBeatSound: { sound: 'Synth Triangle', settings: { ...a.getDefaultSoundSettings('Synth Triangle') } }, barSettings: structuredClone(source.barSettings) });
    tracks.renderTracks();
  });
  await page.locator('.track[data-container-index="0"] .track-reuse-notes-btn').click();
  await audit('#melody-reuse-modal', 'reuse');
  await testInfo.attach('theme-geometry.json', { body: JSON.stringify({ width, themeNames, failures }, null, 2), contentType: 'application/json' });
  expect(failures).toEqual([]); expect(errors).toEqual([]);
  await page.screenshot({ path: `V:/MetronominalTeam/voice-recording/melody-reuse-${width}.png` });
});
