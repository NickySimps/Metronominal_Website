const { test, expect } = require('@playwright/test');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
test.use({ channel: 'chrome' });
let server, origin;
test.beforeAll(async () => {
  const root = path.resolve(__dirname, '..');
  const assets = { '/js/voiceTakeEditor.js': 'text/javascript', '/js/melodySchema.js': 'text/javascript', '/voice-take-editor.css': 'text/css' };
  server = http.createServer((req, res) => {
    if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/voice-take-editor.css"><style>body{margin:8px}</style><button id="opener">Open</button><main id="mount"><span>Unowned</span></main>'); return; }
    if (req.url === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    if (!assets[req.url]) { res.writeHead(404); res.end(); return; }
    fs.readFile(path.join(root, req.url.slice(1)), (err, bytes) => { res.writeHead(err ? 404 : 200, { 'Content-Type': assets[req.url] }); res.end(err ? '' : bytes); });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async () => { await new Promise(resolve => server.close(resolve)); });
const observations = new WeakMap();
test.beforeEach(async ({ page }) => {
  const observed = { errors: [], unexpected: [], requests: [] }; observations.set(page, observed);
  page.on('pageerror', error => observed.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') observed.errors.push(message.text()); });
  await page.route('**/*', route => {
    const url = new URL(route.request().url()); observed.requests.push(url.pathname);
    if (url.origin === origin && ['/', '/voice-take-editor.css', '/js/voiceTakeEditor.js', '/js/melodySchema.js', '/favicon.ico'].includes(url.pathname)) return route.continue();
    observed.unexpected.push(route.request().url()); return route.abort();
  });
  await page.addInitScript(() => {
    window.forbiddenEffects = [];
    for (const [object, name] of [[Storage.prototype, 'setItem'], [IDBFactory.prototype, 'open'], [navigator.mediaDevices, 'getUserMedia']]) {
      if (object) object[name] = function () { window.forbiddenEffects.push(name); throw new Error(`Forbidden effect: ${name}`); };
    }
  });
});
test.afterEach(async ({ page }) => {
  const observed = observations.get(page);
  expect(observed.errors).toEqual([]); expect(observed.unexpected).toEqual([]);
  if (!page.isClosed()) expect(await page.evaluate(() => window.forbiddenEffects)).toEqual([]);
});
async function mount(page, melody = { version: 1, bars: [[{ id: 'take_0', midi: 60, startTick: 0, durationTicks: 480, velocity: 0.8 }], []] }, settings = [{ beats: 4 }, { beats: 3 }]) {
  await page.goto(origin);
  await page.evaluate(async ({ melody, settings }) => {
    const { createVoiceTakeEditor } = await import('/js/voiceTakeEditor.js');
    window.source = melody; window.settings = settings; window.applied = []; window.cancelled = 0;
    document.querySelector('#opener').focus();
    window.editor = createVoiceTakeEditor(document.querySelector('#mount'), { melody, barSettings: settings,
      onApply: value => window.applied.push(value), onCancel: () => window.cancelled++ });
  }, { melody, settings });
}
for (const width of [320, 390, 1280]) {
  test(`native ${width}px geometry, keyboard focus, contrast and reduced motion`, async ({ page }) => {
    await page.setViewportSize({ width, height: 720 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await mount(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    const geometry = await page.locator('.voice-take-editor').evaluate(root => {
      const rect = root.getBoundingClientRect();
      const controls = [...root.querySelectorAll('button,input,select')].map(node => {
        const box = node.getBoundingClientRect();
        return { width: box.width, height: box.height, x: box.x, right: box.right, grid: !!node.closest('.voice-take-editor__viewport') };
      });
      const strip = root.querySelector('.voice-take-editor__duration').getBoundingClientRect();
      const lane = root.querySelector('.voice-take-editor__lane').getBoundingClientRect();
      const viewport = root.querySelector('.voice-take-editor__viewport');
      return { left: rect.left, right: rect.right, controls, durationRatio: strip.width / lane.width, scrollable: viewport.scrollWidth > viewport.clientWidth, animations: root.getAnimations({ subtree: true }).length };
    });
    expect(geometry.left).toBeGreaterThanOrEqual(0); expect(geometry.right).toBeLessThanOrEqual(width);
    for (const c of geometry.controls) { expect(c.width).toBeGreaterThanOrEqual(44); expect(c.height).toBeGreaterThanOrEqual(44); if (!c.grid) { expect(c.x).toBeGreaterThanOrEqual(0); expect(c.right).toBeLessThanOrEqual(width); } }
    expect(geometry.durationRatio).toBeCloseTo(0.125, 3);
    expect(geometry.scrollable).toBe(width < 600); expect(geometry.animations).toBe(0);
    await page.getByRole('button', { name: /Select note take_0/ }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: /Select note take_0/ })).toBeFocused();
    const outline = await page.getByRole('button', { name: /Select note take_0/ }).evaluate(node => ({ style: getComputedStyle(node).outlineStyle, width: parseFloat(getComputedStyle(node).outlineWidth) }));
    expect(outline.style).not.toBe('none'); expect(outline.width).toBeGreaterThanOrEqual(2);
    const contrasts = await page.locator('.voice-take-editor').evaluate(root => {
      const luminance = color => { const rgb = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722; };
      return [root, ...root.querySelectorAll('button,input,select')].map(node => {
        const style = getComputedStyle(node), a = luminance(style.color), b = luminance(style.backgroundColor);
        return { label: node.getAttribute('aria-label') || node.textContent.slice(0,40), ratio: (Math.max(a,b) + .05) / (Math.min(a,b) + .05) };
      });
    });
    for (const item of contrasts) expect(item.ratio, item.label).toBeGreaterThanOrEqual(4.5);
    await test.info().attach(`geometry-${width}`, { body: JSON.stringify({ geometry, contrasts, browserVersion: page.context().browser().version() }, null, 2), contentType: 'application/json' });
    await page.screenshot({ path: test.info().outputPath(`editor-${width}.png`), fullPage: true });
  });
}

test('grid selection, snap, atomic bounds, transposition, history and Cancel stay detached', async ({ page }) => {
  await mount(page, { version: 1, sampleRootMidi: 60, bars: [[
    { id: 'one', midi: 60, startTick: 0, durationTicks: 480, velocity: 0.8 },
    { id: 'two', midi: 127, startTick: 1920, durationTicks: 960, velocity: 1 }
  ], []] });
  await expect(page.getByRole('button', { name: /Select note two/ })).toBeVisible();
  await page.getByRole('button', { name: /Select note two/ }).click();
  await page.getByLabel('MIDI pitch').fill('126');
  await expect(page.getByRole('button', { name: 'Apply draft', exact: true })).toBeDisabled();
  await page.getByLabel('Snap ticks').selectOption('240');
  await page.getByLabel('Onset ticks').fill('2000');
  await page.getByRole('button', { name: 'Update note', exact: true }).click();
  expect(await page.evaluate(() => editor.getDraft().bars[0][1].startTick)).toBe(1920);
  await page.getByRole('button', { name: 'Transpose all up', exact: true }).click();
  expect(await page.evaluate(() => editor.getDraft().bars[0].map(n => n.midi))).toEqual([61, 127]);
  await page.getByRole('button', { name: 'Transpose all up', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Invalid melody');
  expect(await page.evaluate(() => editor.getDraft().bars[0].map(n => n.midi))).toEqual([61, 127]);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect(await page.evaluate(() => editor.getDraft().bars[0].map(n => n.midi))).toEqual([60, 126]);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await page.getByLabel('Duration ticks').fill('3000');
  await page.getByRole('button', { name: 'Update note', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Invalid melody');
  expect(await page.evaluate(() => editor.getDraft().bars[0][1].durationTicks)).toBe(960);
  await page.getByRole('button', { name: 'Discard field changes', exact: true }).click();
  await page.getByRole('button', { name: 'Delete note', exact: true }).click();
  expect(await page.evaluate(() => editor.getDraft().bars[0].length)).toBe(1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect(await page.evaluate(() => editor.getDraft().bars[0].length)).toBe(2);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await page.evaluate(() => ({ applied: applied.length, cancelled, pitch: source.bars[0][0].midi }))).toEqual({ applied: 0, cancelled: 1, pitch: 60 });
  await expect(page.locator('#opener')).toBeFocused();
  await expect(page.locator('#mount')).toHaveText('Unowned');
});

test('Cancel discards the draft and last-note deletion keeps keyboard focus reachable', async ({ page }) => {
  await mount(page);
  await page.getByRole('button', { name: 'Delete note', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeFocused();
  await expect(page.getByLabel('MIDI pitch')).toBeDisabled();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await page.evaluate(() => editor.getDraft())).toEqual(await page.evaluate(() => source));
});

test('deleting on a later page selects the adjacent remaining note without jumping pages', async ({ page }) => {
  const melody = { version: 1, bars: [Array.from({ length: 20 }, (_, i) => ({ id: `page_${i}`, midi: 80 - i, startTick: i * 120, durationTicks: 120, velocity: 0.8 }))] };
  await mount(page, melody, [{ beats: 32 }]);
  await page.locator('select[aria-label="Note page"]').selectOption('1');
  await page.getByRole('button', { name: /Select note page_17/ }).click();
  await page.getByRole('button', { name: 'Delete note', exact: true }).click();
  await expect(page.locator('select[aria-label="Note page"]')).toHaveValue('1');
  await expect(page.getByRole('button', { name: /Select note page_18/ })).toHaveAttribute('aria-pressed', 'true');
});

test('all 2048 notes are reachable with a bounded DOM and no truncation', async ({ page }) => {
  const melody = { version: 1, bars: Array.from({ length: 64 }, (_, bar) => bar < 16 ? Array.from({ length: 128 }, (_, i) => ({ id: `n_${bar}_${i}`, midi: i, startTick: i * 120, durationTicks: 1, velocity: i / 127 })) : []) };
  await mount(page, melody, Array.from({ length: 64 }, () => ({ beats: 32 })));
  const result = await page.evaluate(() => {
    const root = document.querySelector('.voice-take-editor'), seen = new Set(); let maxNodes = 0;
    const bar = root.querySelector('select'), page = root.querySelectorAll('select')[1];
    for (let b = 0; b < 64; b++) {
      bar.value = String(b); bar.dispatchEvent(new Event('change'));
      const count = page.options.length;
      for (let p = 0; p < count; p++) {
        page.value = String(p); page.dispatchEvent(new Event('change'));
        root.querySelectorAll('[data-note-id]').forEach(note => seen.add(note.dataset.noteId));
        maxNodes = Math.max(maxNodes, root.querySelectorAll('*').length);
      }
    }
    return { seen: [...seen], maxNodes, total: editor.getDraft().bars.flat().length };
  });
  expect(result.total).toBe(2048); expect(result.seen.sort()).toEqual(melody.bars.flat().map(n => n.id).sort()); expect(result.maxNodes).toBeLessThan(350);
  await page.getByLabel('Bar', { exact: true }).selectOption('15');
  await page.getByLabel('Note page', { exact: true }).selectOption('7');
  await page.getByRole('button', { name: /Select note n_15_1,/ }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Delete note', exact: true }).click();
  await expect(page.getByLabel('Note page', { exact: true })).toHaveValue('7');
  await expect(page.getByLabel('MIDI pitch')).toHaveValue('0');
  await page.getByLabel('MIDI pitch').fill('1');
  await page.getByRole('button', { name: 'Update note', exact: true }).click();
  expect(await page.evaluate(() => editor.getDraft().bars[15].find(n => n.id === 'n_15_0').midi)).toBe(1);
  await page.getByRole('button', { name: 'Delete note', exact: true }).click();
  await expect(page.getByLabel('Note page', { exact: true })).toHaveValue('7');
  await expect(page.getByLabel('MIDI pitch')).toHaveValue('2');
});

test('invalid data, accessors, prototype keys and over-limit input are rejected without mounting', async ({ page }) => {
  await page.goto(origin);
  const result = await page.evaluate(async () => {
    const { createVoiceTakeEditor } = await import('/js/voiceTakeEditor.js');
    const note = { id: 'safe', midi: 60, startTick: 0, durationTicks: 1, velocity: 0.8 };
    let getters = 0;
    const getter = { ...note }; Object.defineProperty(getter, 'midi', { enumerable: true, get() { getters++; return 60; } });
    const invalid = [
      { version: 1, bars: [[{ ...note, midi: 128 }]] },
      { version: 1, bars: [[{ ...note, id: '<img-onerror=x>' }]] },
      { version: 1, bars: [[{ ...note, velocity: NaN }]] },
      { version: 1, bars: [[{ ...note, startTick: -0 }]] },
      { version: 1, bars: [[{ ...note, durationTicks: 961 }]] },
      { version: 1, bars: [[getter]] },
      { version: 1, bars: [[Object.assign(Object.create({ injected: true }), note)]] },
      JSON.parse('{"version":1,"bars":[[]],"__proto__":{"polluted":true}}'),
      { version: 1, bars: [Array.from({ length: 129 }, (_, i) => ({ ...note, id: `x_${i}` }))] },
      { version: 1, bars: [[note, { ...note }]] }
    ];
    const rejected = invalid.map(melody => { try { createVoiceTakeEditor(document.querySelector('#mount'), { melody, barSettings: [{ beats: 1 }], onApply() {} }); return false; } catch (error) { return error instanceof TypeError; } });
    let rootRequired = false;
    try { createVoiceTakeEditor(document.querySelector('#mount'), { melody: { version: 1, bars: [[]] }, barSettings: [{ beats: 1 }], requireSampleRoot: true, onApply() {} }); } catch (e) { rootRequired = e instanceof TypeError; }
    return { rejected, getters, mounted: document.querySelectorAll('.voice-take-editor').length, polluted: Object.prototype.polluted === true, rootRequired };
  });
  expect(result).toEqual({ rejected: Array(10).fill(true), getters: 0, mounted: 0, polluted: false, rootRequired: true });
});

test('rejected Apply stays open, repeated Apply is fenced, and stale callbacks cannot touch a newer editor', async ({ page }) => {
  await mount(page);
  await page.evaluate(async () => {
    editor.destroy();
    const { createVoiceTakeEditor } = await import('/js/voiceTakeEditor.js');
    window.calls = 0;
    window.editor = createVoiceTakeEditor(document.querySelector('#mount'), { melody: source, barSettings: settings,
      onApply: value => { calls++; window.delivered = value; return new Promise((resolve, reject) => { window.resolveApply = resolve; window.rejectApply = reject; }); } });
  });
  await page.getByRole('button', { name: 'Apply draft', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Apply draft', exact: true })).toBeDisabled();
  await expect(page.getByLabel('MIDI pitch')).toBeDisabled();
  await page.evaluate(() => rejectApply(new Error('<img src=x onerror=alert(1)>')));
  await expect(page.getByRole('status')).toHaveText('<img src=x onerror=alert(1)>');
  await expect(page.locator('.voice-take-editor img')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Apply draft', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Apply draft', exact: true })).toBeFocused();
  await page.evaluate(() => { delivered.bars[0][0].midi = 99; });
  expect(await page.evaluate(() => editor.getDraft().bars[0][0].midi)).toBe(60);
  await page.getByRole('button', { name: 'Apply draft', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('#opener')).toBeFocused();
  await page.evaluate(async () => {
    const { createVoiceTakeEditor } = await import('/js/voiceTakeEditor.js');
    window.newer = createVoiceTakeEditor(document.querySelector('#mount'), { melody: source, barSettings: settings,
      onApply: () => new Promise(resolve => { window.resolveNewer = resolve; }) });
    resolveApply();
  });
  await expect(page.locator('.voice-take-editor')).toHaveCount(1); expect(await page.evaluate(() => calls)).toBe(2);
  await expect(page.getByRole('status')).toHaveText('Draft ready.');
  await page.getByRole('button', { name: 'Apply draft', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Apply draft', exact: true })).toBeDisabled();
  await page.evaluate(() => resolveNewer());
  await expect(page.locator('.voice-take-editor')).toHaveCount(0);
  await expect(page.locator('#opener')).toBeFocused();
});

test('detached note correction requires explicit validated Apply and returns an isolated clone', async ({ page }) => {
  await mount(page);
  await page.getByLabel('MIDI pitch').fill('64');
  await page.getByLabel('Onset ticks').fill('240');
  await page.getByLabel('Duration ticks').fill('960');
  await page.getByLabel('Velocity', { exact: true }).fill('0.4');
  await page.getByRole('button', { name: 'Update note', exact: true }).click();
  expect(await page.evaluate(() => ({ original: source.bars[0][0].midi, applied: applied.length, draft: editor.getDraft().bars[0][0] }))).toEqual({ original: 60, applied: 0, draft: { id: 'take_0', midi: 64, startTick: 240, durationTicks: 960, velocity: 0.4 } });
  await page.getByRole('button', { name: 'Apply draft', exact: true }).click();
  expect(await page.evaluate(async () => {
    const { validateMelody } = await import('/js/melodySchema.js');
    const value = validateMelody(applied[0], settings);
    applied[0].bars[0][0].midi = 20;
    return { value, original: source.bars[0][0].midi, draft: editor.getDraft().bars[0][0].midi, count: applied.length };
  })).toEqual({ value: { version: 1, bars: [[{ id: 'take_0', midi: 64, startTick: 240, durationTicks: 960, velocity: 0.4 }], []] }, original: 60, draft: 64, count: 1 });
  await expect(page.locator('.voice-take-editor')).toHaveCount(0);
  await expect(page.locator('#opener')).toBeFocused();
});

test('numeric refusal is atomic, pending fields never disappear, and edge snapping never clips', async ({ page }) => {
  await mount(page);
  const baseline = await page.evaluate(() => editor.getDraft());
  for (const [label, value] of [['MIDI pitch', '60.5'], ['MIDI pitch', '128'], ['Onset ticks', '-1'], ['Onset ticks', '-0'], ['Onset ticks', ''], ['Duration ticks', '0'], ['Velocity', '1.01'], ['Velocity', '-0.1']]) {
    await page.getByLabel(label, { exact: true }).fill(value);
    await page.getByRole('button', { name: 'Update note', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Invalid melody');
    expect(await page.evaluate(() => editor.getDraft())).toEqual(baseline);
    await expect(page.getByRole('button', { name: 'Apply draft', exact: true })).toBeDisabled();
    await page.getByLabel('Bar', { exact: true }).selectOption('1');
    await expect(page.getByLabel('Bar', { exact: true })).toHaveValue('0');
    await page.getByRole('button', { name: 'Discard field changes', exact: true }).click();
  }
  await page.getByLabel('Onset ticks').fill('3839'); await page.getByLabel('Duration ticks').fill('1');
  await page.getByLabel('Snap ticks').selectOption('240');
  await page.getByRole('button', { name: 'Update note', exact: true }).click();
  expect(await page.evaluate(() => editor.getDraft())).toEqual(baseline);
  await expect(page.getByRole('status')).toContainText('Invalid melody');
});

test('snap validation accepts raw edits that normalize to a valid bar-local note', async ({ page }) => {
  await mount(page, { version: 1, bars: [[{ id: 'edge', midi: 60, startTick: 2880, durationTicks: 960, velocity: 0.8 }]] }, [{ beats: 4 }]);
  await page.getByLabel('Onset ticks').fill('2900');
  await page.getByLabel('Snap ticks').selectOption('240');
  await page.getByRole('button', { name: 'Update note', exact: true }).click();
  expect(await page.evaluate(() => editor.getDraft().bars[0][0])).toEqual({ id: 'edge', midi: 60, startTick: 2880, durationTicks: 960, velocity: 0.8 });
  await expect(page.getByRole('status')).toHaveText('Note updated in draft.');
});

test('history clones, root and source isolation survive 50-step history cap and branch edits', async ({ page }) => {
  await mount(page, { version: 1, sampleRootMidi: 42, bars: [[{ id: '__proto__', midi: 60, startTick: 0, durationTicks: 240, velocity: 0 }]] }, [{ beats: 1 }]);
  const result = await page.evaluate(() => {
    source.bars[0][0].midi = 1; settings[0].beats = 32;
    const copy = editor.getDraft(); copy.bars[0][0].midi = 2;
    const root = document.querySelector('.voice-take-editor');
    const find = name => [...root.querySelectorAll('button')].find(b => b.textContent === name);
    for (let i = 0; i < 51; i++) find('Transpose all up').click();
    let undos = 0; while (!find('Undo').disabled && undos < 100) { find('Undo').click(); undos++; }
    const afterUndo = editor.getDraft(); find('Redo').click(); find('Transpose all down').click();
    return { undos, afterUndo, redoDisabled: find('Redo').disabled, final: editor.getDraft(), notes: root.querySelectorAll('[data-note-id]').length };
  });
  expect(result.undos).toBe(50); expect(result.afterUndo.bars[0][0].midi).toBe(61); expect(result.afterUndo.sampleRootMidi).toBe(42);
  expect(result.redoDisabled).toBe(true); expect(result.final.bars[0][0]).toEqual({ id: '__proto__', midi: 61, startTick: 0, durationTicks: 240, velocity: 0 }); expect(result.notes).toBe(1);
});
