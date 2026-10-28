'use strict';
const { test, expect } = require('@playwright/test');
const prepare = require('./workflowTestPage.cjs');

const barSelector = '.bar-visual[data-container-index="0"][data-bar-index="0"]';
const modeSelector = { rest: '.rest-button', accent: '.accent-button', slice: '.slice-btn', edit: '.beat-edit-btn' };
test.use({ hasTouch: true, viewport: { width: 390, height: 800 } });

async function music(page) {
  return page.evaluate(async () => (await import(new URL('js/appState.js', document.baseURI))).default.getMusicalSnapshot());
}
async function setup(page, mode) {
  page.__gesturePageErrors = [];
  page.__gestureConsoleErrors = [];
  page.on('pageerror', error => page.__gesturePageErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && /precision|SyntaxError|ReferenceError|TypeError|Unexpected token/i.test(message.text())) page.__gestureConsoleErrors.push(message.text().slice(0, 700));
  });
  await prepare(page, test.info().config.metadata);
  await page.addInitScript(() => {
    window.__nativeGestureEvents = [];
    window.__gestureWireErrors = [];
    const NativeSocket = window.WebSocket;
    window.WebSocket = class extends NativeSocket {
      constructor(...args) {
        super(...args);
        this.addEventListener('message', event => {
          try {
            const message = JSON.parse(event.data);
            if (message.type === 'error') window.__gestureWireErrors.push({ type: 'error', code: String(message.code || 'uncoded') });
          } catch { /* Non-JSON frames are not part of this observation. */ }
        });
      }
    };
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
      window.addEventListener(type, e => { if (e.pointerType === 'touch') window.__nativeGestureEvents.push({ type, trusted: e.isTrusted, pointerType: e.pointerType, time: e.timeStamp, x: e.clientX, y: e.clientY, targetBeat: e.target.closest?.('.beat-square')?.dataset.beatIndex ?? null, targetIsBar: e.target.matches?.('.bar-visual') === true }); }, true);
    }
  });
  await page.goto('./');
  await expect(page.locator('#share-btn')).toHaveClass(/(?:^|\s)connected(?:\s|$)/);
  await page.evaluate(async () => {
    (await import(new URL('js/themeController.js', document.baseURI))).default.applyTheme('dark');
    const state = (await import(new URL('js/appState.js', document.baseURI))).default;
    const display = (await import(new URL('js/barDisplayController.js', document.baseURI))).default;
    const original = state.getTracks()[0].barSettings[0];
    state.updateTrack(0, { barSettings: [{ ...original, beats: 8, subdivision: 8, rests: [], velocities: {}, beatSounds: {}, beatSlices: {}, sliceAnchors: {} }] });
    display.renderBarsAndControls(-1);
  });
  await expect(page.locator(`${barSelector} .beat-square`)).toHaveCount(64);
  await expect(page.locator('#all-tracks-wrapper')).toHaveClass(/(?:^|\s)beat-precision-enabled(?:\s|$)/);
  if (modeSelector[mode]) await page.locator(modeSelector[mode]).first().click();
  // Locator clicks use a mouse even in touch contexts; don't leave its hover over a source cell after scrolling.
  await page.mouse.move(1, 1);
  await page.evaluate(async () => {
    await Promise.race([document.fonts.ready, new Promise(resolve => setTimeout(resolve, 2000))]);
    for (const animation of document.getAnimations()) if (Number.isFinite(animation.effect?.getComputedTiming().endTime)) animation.finish();
    document.querySelector('.bar-visual[data-container-index="0"] .beat-square[data-beat-index="35"]').scrollIntoView({ block: 'center', behavior: 'instant' });
  });
  await page.waitForTimeout(80);
}
async function point(page, index) {
  const locator = page.locator(`${barSelector} .beat-square[data-beat-index="${index}"]`);
  await locator.scrollIntoViewIfNeeded();
  return locator.evaluate(el => {
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    return { x, y, index: Number(el.dataset.beatIndex), hit: document.elementFromPoint(x, y)?.closest('.beat-square') === el };
  });
}
async function line(page, axis = 'horizontal') {
  const result = await page.locator(`${barSelector} .beat-square[data-beat-index="35"]`).evaluate((anchor, axis) => {
    const a = anchor.getBoundingClientRect();
    const fixed = axis === 'horizontal' ? a.top + a.height / 2 : a.left + a.width / 2;
    return [...anchor.closest('.bar-visual').querySelectorAll('.beat-square')].map(el => {
      const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
      return { x, y, index: Number(el.dataset.beatIndex), hit: document.elementFromPoint(x, y)?.closest('.beat-square') === el };
    }).filter(p => p.hit && p.x > 0 && p.x < innerWidth && p.y > 0 && p.y < innerHeight && Math.abs((axis === 'horizontal' ? p.y : p.x) - fixed) < 1)
      .sort((a, b) => axis === 'horizontal' ? a.x - b.x : a.y - b.y);
  }, axis);
  expect(result.length).toBeGreaterThanOrEqual(4);
  return result;
}
async function start(cdp, p) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y, id: 1 }] }); }
async function move(cdp, p) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p.x, y: p.y, id: 1 }] }); }
async function end(cdp) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }
async function cancel(cdp) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }); }
async function checkNative(page, requireMovement = true) {
  const events = await page.evaluate(() => window.__nativeGestureEvents);
  await test.info().attach('trusted-native-touch-events', { body: JSON.stringify(events, null, 2), contentType: 'application/json' });
  expect(events.some(e => e.type === 'pointerdown')).toBe(true);
  expect(events.some(e => e.type === 'pointerup')).toBe(true);
  if (requireMovement) expect(events.some(e => e.type === 'pointermove')).toBe(true);
  expect(events.every(e => e.trusted && e.pointerType === 'touch')).toBe(true);
  expect(events.filter(e => e.type === 'pointercancel')).toEqual([]);
}
async function undoRedo(page, before, after) {
  // The mobile rehearsal drawer is collapsed; exercise the real shared history
  // shortcuts rather than waiting for a hidden drawer button to be clickable.
  await page.keyboard.press('Control+z');
  await expect.poll(() => music(page)).toEqual(before);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(() => music(page)).toEqual(after);
}

test.afterEach(async ({ page }) => {
  if (page.isClosed()) return;
  await page.waitForTimeout(250); // Observe the real 100ms state-publication debounce and response.
  const observation = await page.evaluate(() => ({ events: window.__nativeGestureEvents, wireErrors: window.__gestureWireErrors }));
  observation.precisionConsoleErrors = page.__gestureConsoleErrors || [];
  await test.info().attach('native-gesture-observation', { body: JSON.stringify(observation, null, 2), contentType: 'application/json' });
  expect(page.__gesturePageErrors || []).toEqual([]);
  expect(observation.wireErrors).toEqual([]);
});

test('native picker stays latched while crossing the grid to a subdivision option', async ({ page, context }) => {
  await setup(page, 'rest');
  const p = await point(page, 35), before = await music(page), cdp = await context.newCDPSession(page);
  expect(p.hit).toBe(true);
  await start(cdp, p);
  await expect(page.locator('.subdivision-options-container.visible')).not.toHaveCount(0);
  await move(cdp, { x: p.x + 18, y: p.y });
  await move(cdp, { x: p.x - 18, y: p.y });
  await expect(page.locator('[data-beat-precision-lens]')).toHaveCount(0);
  await expect(page.locator('.subdivision-options-container.visible')).not.toHaveCount(0);
  expect(await music(page)).toEqual(before);
  const option = page.locator('.subdivision-options-container.visible .subdivision-option[data-value="4"]');
  const r = await option.boundingBox();
  expect(r).not.toBeNull();
  await move(cdp, { x: r.x + r.width / 2, y: r.y + r.height / 2 });
  await expect(option).toHaveClass(/hovered/);
  expect(await music(page)).toEqual(before);
  await page.screenshot({ path: test.info().outputPath('latched-picker-slide.png') });
  await end(cdp);
  await expect.poll(async () => Number((await music(page)).Tracks[0].barSettings[0].subdivision)).toBe(4);
  await expect(page.locator(`${barSelector} .beat-square`)).toHaveCount(32);
  expect((await music(page)).Tracks[0].barSettings[0].rests).toEqual([]);
  await expect(page.locator('[data-beat-precision-lens]')).toHaveCount(0);
  await checkNative(page);
});

test('native picker cannot become painting or precision after an option-to-grid fast sweep', async ({ page, context }) => {
  await setup(page, 'accent');
  const p = await point(page, 35), before = await music(page), cdp = await context.newCDPSession(page);
  await start(cdp, p);
  await expect(page.locator('.subdivision-options-container.visible')).not.toHaveCount(0);
  const option = page.locator('.subdivision-options-container.visible .subdivision-option[data-value="4"]');
  const r = await option.boundingBox();
  await move(cdp, { x: r.x + r.width / 2, y: r.y + r.height / 2 });
  await expect(option).toHaveClass(/hovered/);
  await move(cdp, p);
  await move(cdp, { x: p.x + 24, y: p.y });
  await end(cdp);
  expect(await music(page)).toEqual(before);
  await expect(page.locator('.subdivision-options-container.visible')).toHaveCount(0);
  await expect(page.locator('[data-beat-precision-lens]')).toHaveCount(0);
  await expect(page.locator('#sound-settings-modal')).toBeHidden();
  await checkNative(page);
});

test('native slow movement before the hold deadline opens precision and commits only its final target', async ({ page, context }) => {
  await setup(page, 'rest');
  const p = await point(page, 35), before = await music(page), cdp = await context.newCDPSession(page);
  await start(cdp, p);
  for (const dx of [8, 16]) { await page.waitForTimeout(35); await move(cdp, { x: p.x + dx, y: p.y }); }
  const motion = await page.evaluate(() => window.__nativeGestureEvents.filter(e => e.type === 'pointerdown' || e.type === 'pointermove'));
  expect(motion.at(-1).time - motion[0].time, 'slow movement must occur before the 380ms hold, not after an automation-delayed long press').toBeLessThan(340);
  await expect(page.locator('[data-beat-precision-lens]')).toBeVisible();
  await expect(page.locator('.subdivision-options-container.visible')).toHaveCount(0);
  expect(await music(page)).toEqual(before);
  const target = await page.locator('.beat-precision-cell[data-current="true"]').getAttribute('aria-label');
  const index = Number(target.match(/beat (\d+)/)[1]) - 1;
  await page.screenshot({ path: test.info().outputPath('slow-native-precision.png') });
  await end(cdp);
  await expect.poll(async () => (await music(page)).Tracks[0].barSettings[0].rests).toEqual([index]);
  await checkNative(page);
});

for (const mode of ['rest', 'accent', 'slice']) test(`native fast ${mode} sweep paints skipped cells once and one Undo reverses the stroke`, async ({ page, context }) => {
  await setup(page, mode);
  const cells = await line(page), before = await music(page), cdp = await context.newCDPSession(page);
  const first = cells[0], last = cells.at(-1), indices = cells.map(p => p.index).sort((a, b) => a - b);
  await start(cdp, first);
  await page.waitForTimeout(20);
  // Deliberately skip all intermediate cells in the delivered move event.
  await move(cdp, last);
  const during = await music(page), bar = during.Tracks[0].barSettings[0];
  if (mode === 'rest') expect([...bar.rests].sort((a, b) => a - b)).toEqual(indices);
  if (mode === 'accent') {
    const original = before.Tracks[0].barSettings[0].velocities[first.index] ?? (first.index === 0 ? 1 : .7);
    const expected = original === .7 ? 1 : original === 1 ? .3 : .7;
    expect(Object.keys(bar.velocities).map(Number).sort((a, b) => a - b)).toEqual(indices);
    for (const index of indices) expect(bar.velocities[index]).toBe(expected);
  }
  if (mode === 'slice') {
    expect(Object.keys(bar.beatSlices).map(Number).sort((a, b) => a - b)).toEqual(indices);
    for (const index of indices) expect(bar.beatSlices[index]).toBe(2);
  }
  await expect(page.locator('[data-beat-precision-lens]')).toHaveCount(0);
  await expect(page.locator('.subdivision-options-container.visible')).toHaveCount(0);
  await move(cdp, first);
  expect(await music(page)).toEqual(during);
  await end(cdp);
  expect(await music(page)).toEqual(during);
  await checkNative(page);
  await undoRedo(page, before, during);
});

test('native fast vertical editing paints the crossed column without scrolling the page', async ({ page, context }) => {
  await setup(page, 'rest');
  const cells = await line(page, 'vertical'), cdp = await context.newCDPSession(page), beforeScroll = await page.evaluate(() => scrollY);
  await start(cdp, cells[0]);
  await page.waitForTimeout(20);
  await move(cdp, cells.at(-1));
  await end(cdp);
  await expect.poll(async () => [...(await music(page)).Tracks[0].barSettings[0].rests].sort((a, b) => a - b)).toEqual(cells.map(p => p.index).sort((a, b) => a - b));
  expect(await page.evaluate(() => scrollY)).toBe(beforeScroll);
  await expect(page.locator('[data-beat-precision-lens]')).toHaveCount(0);
  await checkNative(page);
});

test('native fast Beat Edit opens just the final editor rather than one modal per crossed beat', async ({ page, context }) => {
  await setup(page, 'edit');
  await page.evaluate(async () => {
    const modal = (await import(new URL('js/soundSettingsModal.js', document.baseURI))).default, original = modal.show;
    window.__nativeEditorOpens = 0;
    modal.show = function (...args) { window.__nativeEditorOpens++; return original.apply(this, args); };
  });
  const cells = await line(page), before = await music(page), cdp = await context.newCDPSession(page);
  await start(cdp, cells[0]);
  await page.waitForTimeout(20);
  await move(cdp, cells.at(-1));
  expect(await page.evaluate(() => window.__nativeEditorOpens)).toBe(0);
  await expect(page.locator('[data-beat-precision-lens]')).toHaveCount(0);
  await end(cdp);
  await expect(page.locator('#sound-settings-modal')).toBeVisible();
  expect(await page.evaluate(() => window.__nativeEditorOpens)).toBe(1);
  expect(await page.evaluate(async () => (await import(new URL('js/soundSettingsModal.js', document.baseURI))).default.currentBeatIndex)).toBe(cells.at(-1).index);
  expect(await music(page)).toEqual(before);
  await checkNative(page);
});

test('native scrolling remains available outside the editable beat grid', async ({ page, context }) => {
  await setup(page, 'rest');
  await page.evaluate(() => { document.body.style.minHeight = '4000px'; window.scrollTo(0, 200); });
  await page.waitForTimeout(80);
  const p = { x: 2, y: 600 };
  expect(await page.evaluate(p => !document.elementFromPoint(p.x, p.y)?.closest('.bar-visual'), p)).toBe(true);
  const before = await music(page), startY = await page.evaluate(() => scrollY), cdp = await context.newCDPSession(page);
  await start(cdp, p);
  for (let dy = 20; dy <= 160; dy += 20) await move(cdp, { x: p.x, y: p.y - dy });
  await end(cdp);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(startY);
  expect(await music(page)).toEqual(before);
  await expect(page.locator('[data-beat-precision-lens]')).toHaveCount(0);
});

test('native normal-mode grid swipe still scrolls rather than painting', async ({ page, context }) => {
  await setup(page, 'normal');
  await page.evaluate(() => { document.body.style.minHeight = '4000px'; });
  const p = await point(page, 35), before = await music(page), startY = await page.evaluate(() => scrollY), cdp = await context.newCDPSession(page);
  expect(p.hit).toBe(true);
  await start(cdp, p);
  for (let dy = 12; dy <= 132; dy += 12) await move(cdp, { x: p.x, y: p.y - dy });
  await end(cdp);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(startY);
  expect(await music(page)).toEqual(before);
  await expect(page.locator('[data-beat-precision-lens]')).toHaveCount(0);
  await expect(page.locator('#sound-settings-modal')).toBeHidden();
});

test('DOM released picker closes on external musical mutation', async ({page}) => {
  await setup(page,'rest');await point(page,35);
  const emit=type=>page.locator(`${barSelector} .beat-square[data-beat-index="35"]`).evaluate((cell,type)=>{const r=cell.getBoundingClientRect();cell.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:88,pointerType:'touch',isPrimary:true,button:0,clientX:r.left+r.width/2,clientY:r.top+r.height/2}));},type);
  await emit('pointerdown');await expect(page.locator('.subdivision-options-container.visible')).not.toHaveCount(0);await emit('pointerup');
  await expect(page.locator('.subdivision-options-container.visible')).not.toHaveCount(0);
  await page.evaluate(async()=>(await import(new URL('js/appState.js',document.baseURI))).default.setTempo(133));
  await expect(page.locator('.subdivision-options-container.visible')).toHaveCount(0);
  expect((await music(page)).Tracks[0].barSettings[0].rests).toEqual([]);
});

for (const refusal of ['unavailable','transaction','undo']) for (const action of ['tap','subdivision']) test(`native history refusal ${refusal} blocks assisted ${action}`, async ({page,context}) => {
  await setup(page,'rest');
  const before=await page.evaluate(async refusal=>{
    const state=(await import(new URL('js/appState.js',document.baseURI))).default, history=await import(new URL('js/editHistory.js',document.baseURI));
    const root=document.createElement('div');root.hidden=true;document.body.append(root);
    window.__refusalHistory=history.initializeHistoryControls(root);
    if(refusal==='unavailable') __refusalHistory.destroy();
    if(refusal==='transaction') window.__otherTransaction=history.beginEditTransaction('Other editor');
    if(refusal==='undo') {
      window.__undoTarget=state.getMusicalSnapshot();state.setTempo(111);
      const load=state.loadPresetData, held=new Promise(resolve=>window.__releaseRefusalUndo=resolve);
      state.loadPresetData=async(...args)=>{window.__refusalUndoEntered=true;await held;return load(...args);};
      window.__refusalUndo=__refusalHistory.undo();
      if(!window.__refusalUndoEntered) throw Error('Real Undo did not enter held restoration');
    }
    window.__refusalMutations=[];window.__stopRefusalWatch=state.subscribeMusicalMutations(change=>__refusalMutations.push(change.label));
    return state.getMusicalSnapshot();
  },refusal);
  const p=await point(page,35),cdp=await context.newCDPSession(page);expect(p.hit).toBe(true);await start(cdp,p);
  if(action==='subdivision') {
    const option=page.locator('.subdivision-options-container.visible .subdivision-option[data-value="4"]');await expect(option).toBeVisible();const r=await option.boundingBox();await move(cdp,{x:r.x+r.width/2,y:r.y+r.height/2});await expect(option).toHaveClass(/hovered/);
  }
  await end(cdp);
  expect(await music(page)).toEqual(before);expect(await page.evaluate(()=>__refusalMutations)).toEqual([]);
  if(refusal==='transaction') expect(await page.evaluate(async()=>(await import(new URL('js/editHistory.js',document.baseURI))).cancelEditTransaction(__otherTransaction))).toBe(true);
  if(refusal==='undo') {
    const restored=await page.evaluate(async()=>{__stopRefusalWatch();__releaseRefusalUndo();const accepted=await __refusalUndo;return {accepted,target:__undoTarget};});
    expect(restored.accepted).toBe(true);expect(await music(page)).toEqual(restored.target);
    await page.keyboard.press('Control+Shift+z');await expect.poll(()=>music(page)).toEqual(before);
  }
  await checkNative(page, action !== 'tap');
});

test('DOM rapid subdivision regrowth indexes only live beat squares', async ({page}) => {
  await setup(page,'rest');
  const result=await page.evaluate(async()=>{
    const state=(await import(new URL('js/appState.js',document.baseURI))).default, display=(await import(new URL('js/barDisplayController.js',document.baseURI))).default;
    state.setSelectedTrackIndex(0); state.setSelectedBarIndexInContainer(0);
    let error=null;
    try { for(const division of [4,8]) { state.setSubdivisionForSelectedBar(division); display.updateBar(0,0); } } catch(e) { error=e.message; }
    const bar=document.querySelector('.bar-visual[data-container-index="0"][data-bar-index="0"]');
    return {error, retired:bar.querySelectorAll('.removing-beat-animation').length, ids:[...bar.querySelectorAll('.beat-square:not(.removing-beat-animation)')].map(el=>Number(el.dataset.beatIndex))};
  });
  expect(result.error).toBeNull(); expect(result.retired).toBe(32); expect(result.ids).toEqual(Array.from({length:64},(_,i)=>i));
});

test('DOM decorative retirement cannot cancel an active logical precision gesture', async ({page}) => {
  await setup(page,'rest');
  await page.evaluate(async()=>{
    const state=(await import(new URL('js/appState.js',document.baseURI))).default, display=(await import(new URL('js/barDisplayController.js',document.baseURI))).default;
    state.setSelectedTrackIndex(0);state.setSelectedBarIndexInContainer(0);state.setSubdivisionForSelectedBar(4);display.updateBar(0,0);
    for(const animation of document.getAnimations()) if(animation.effect?.target?.matches('.removing-beat-animation')) animation.pause();
  });
  const before=await music(page);
  await page.evaluate(()=>{
    const bar=document.querySelector('.bar-visual[data-container-index="0"][data-bar-index="0"]'), cell=bar.querySelector('[data-beat-index="16"]'),r=cell.getBoundingClientRect();
    const emit=(type,dx,time)=>{const e=new PointerEvent(type,{bubbles:true,cancelable:true,pointerType:'touch',pointerId:87,isPrimary:true,button:0,clientX:r.left+r.width/2+dx,clientY:r.top+r.height/2});Object.defineProperty(e,'timeStamp',{value:time});cell.dispatchEvent(e);};
    emit('pointerdown',0,1000);emit('pointermove',6,1080);emit('pointermove',12,1160);
    for(const retired of bar.querySelectorAll('.removing-beat-animation')) retired.dispatchEvent(new Event('animationend'));
    emit('pointermove',13,1240);
  });
  await expect(page.locator('[data-beat-precision-lens]')).toBeVisible();expect(await music(page)).toEqual(before);
  await page.evaluate(()=>document.dispatchEvent(new PointerEvent('pointercancel',{bubbles:true,pointerId:87,pointerType:'touch',isPrimary:true})));
});

for (const initial of [1,32]) test(`DOM slice paint preserves current accessible labels from ${initial} slices`, async ({page}) => {
  await setup(page,'slice');
  if (initial > 1) await page.evaluate(async()=>{
    const state=(await import(new URL('js/appState.js',document.baseURI))).default, display=(await import(new URL('js/barDisplayController.js',document.baseURI))).default;
    state.setBeatSlices(0,0,16,32); display.updateBar(0,0);
  });
  const actual=await page.evaluate(()=>{
    for(const [type,index,time] of [['pointerdown',16,1000],['pointermove',19,1040],['pointerup',19,1060]]) {
      const cell=document.querySelector(`.bar-visual[data-container-index="0"][data-bar-index="0"] .beat-square[data-beat-index="${index}"]`),r=cell.getBoundingClientRect();
      const event=new PointerEvent(type,{bubbles:true,cancelable:true,pointerType:'touch',pointerId:86,isPrimary:true,button:0,clientX:r.left+r.width/2,clientY:r.top+r.height/2});
      Object.defineProperty(event,'timeStamp',{value:time});cell.dispatchEvent(event);
    }
    const cell=document.querySelector('.bar-visual[data-container-index="0"][data-bar-index="0"] .beat-square[data-beat-index="16"]');
    return {label:cell.getAttribute('aria-label'),title:cell.getAttribute('title'),slices:cell.dataset.sliceCount};
  });
  expect(actual.label).toBe('slice Track 1 · Bar 1 · Beat 17'+(initial===1?', 2 slices':''));
  if (initial===1) expect(actual.slices).toBe('2'); else { expect(actual.slices).toBeUndefined(); expect(actual.title||'').not.toMatch(/slices/); }
});

test('DOM short stationary pause does not dilute a subsequent fast stroke', async ({ page }) => {
  await setup(page,'rest');
  await page.evaluate(()=>{
    for(const [type,index,time] of [['pointerdown',16,1000],['pointermove',17,1260],['pointermove',19,1280],['pointerup',19,1290]]) {
      const cell=document.querySelector(`.bar-visual[data-container-index="0"][data-bar-index="0"] .beat-square[data-beat-index="${index}"]`),r=cell.getBoundingClientRect();
      const event=new PointerEvent(type,{bubbles:true,cancelable:true,pointerType:'touch',pointerId:85,isPrimary:true,button:0,clientX:r.left+r.width/2,clientY:r.top+r.height/2});
      Object.defineProperty(event,'timeStamp',{value:time});cell.dispatchEvent(event);
    }
  });
  expect((await music(page)).Tracks[0].barSettings[0].rests.slice().sort((a,b)=>a-b)).toEqual([16,17,18,19]);
  await expect(page.locator('[data-beat-precision-lens]')).toHaveCount(0);
});

test('DOM fast Beat Edit includes the final pointerup target', async ({ page }) => {
  await setup(page, 'edit');
  const before = await music(page);
  await page.evaluate(() => {
    for (const [type,index,time] of [['pointerdown',16,1000],['pointermove',18,1050],['pointerup',19,1060]]) {
      const cell = document.querySelector(`.bar-visual[data-container-index="0"][data-bar-index="0"] .beat-square[data-beat-index="${index}"]`), r = cell.getBoundingClientRect();
      const event = new PointerEvent(type,{bubbles:true,cancelable:true,pointerType:'touch',pointerId:84,isPrimary:true,button:0,clientX:r.left+r.width/2,clientY:r.top+r.height/2});
      Object.defineProperty(event,'timeStamp',{value:time}); cell.dispatchEvent(event);
    }
  });
  await expect(page.locator('#sound-settings-modal')).toBeVisible();
  expect(await page.evaluate(async()=>(await import(new URL('js/soundSettingsModal.js',document.baseURI))).default.currentBeatIndex)).toBe(19);
  expect(await music(page)).toEqual(before);
});

test('native padding cannot bypass assisted gesture ownership', async ({ page, context }) => {
  await setup(page, 'rest');
  // Keep the contact well outside neighboring touch targets; a narrow visual
  // gap can be natively retargeted to a clickable beat despite elementFromPoint.
  await page.addStyleTag({ content: '.bar-visual { gap: 4px !important; padding: 64px !important; }' });
  const target = await point(page, 35), before = await music(page);
  const gap = await page.evaluate(() => {
    const bar = document.querySelector('.bar-visual[data-container-index="0"][data-bar-index="0"]');
    const a = bar.querySelector('[data-beat-index="32"]').getBoundingClientRect(), r = bar.getBoundingClientRect();
    const x = r.left + 8, y = a.top + a.height / 2, hit = document.elementFromPoint(x, y);
    return { x, y, blank: hit?.closest('.bar-visual') === bar && !hit.closest('.beat-square') };
  });
  expect(gap.blank).toBe(true);
  const cdp = await context.newCDPSession(page);
  await start(cdp, gap); await move(cdp, target); await end(cdp);
  expect(await page.evaluate(() => window.__nativeGestureEvents.find(e => e.type === 'pointerdown')?.targetIsBar)).toBe(true);
  expect(await music(page)).toEqual(before);
  await checkNative(page);
});

test('DOM moderate movement has a precision lane rather than a speed dead band', async ({ page }) => {
  await setup(page, 'rest');
  const before = await music(page);
  await page.evaluate(() => {
    const cell = index => document.querySelector(`.bar-visual[data-container-index="0"][data-bar-index="0"] .beat-square[data-beat-index="${index}"]`);
    const point = index => { const r = cell(index).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
    let time = 1000, previous = point(16);
    for (const [type, index] of [['pointerdown', 16], ['pointermove', 17], ['pointermove', 18]]) {
      const p = point(index);
      if (type === 'pointermove') time += Math.hypot(p.x - previous.x, p.y - previous.y) / .45;
      const event = new PointerEvent(type, { bubbles: true, cancelable: true, pointerType: 'touch', pointerId: 81, isPrimary: true, button: 0, clientX: p.x, clientY: p.y });
      Object.defineProperty(event, 'timeStamp', { value: time }); cell(index).dispatchEvent(event); previous = p;
    }
  });
  await expect(page.locator('[data-beat-precision-lens]')).toBeVisible();
  expect(await music(page)).toEqual(before);
  await page.evaluate(() => document.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 81, pointerType: 'touch', isPrimary: true })));
  expect(await music(page)).toEqual(before);
});

test('DOM slow subpixel samples activate precision before the hold deadline', async ({ page }) => {
  await setup(page, 'rest');
  const before = await music(page);
  await page.evaluate(() => {
    const cell = document.querySelector('.bar-visual[data-container-index="0"][data-bar-index="0"] .beat-square[data-beat-index="16"]'), r = cell.getBoundingClientRect();
    for (let i = 0; i <= 31; i++) {
      const event = new PointerEvent(i ? 'pointermove' : 'pointerdown', { bubbles: true, cancelable: true, pointerType: 'touch', pointerId: 83, isPrimary: true, button: 0, clientX: r.left + r.width / 2 + i * .5, clientY: r.top + r.height / 2 });
      Object.defineProperty(event, 'timeStamp', { value: 1000 + i * 10 }); cell.dispatchEvent(event);
    }
  });
  await expect(page.locator('[data-beat-precision-lens]')).toBeVisible();
  expect(await music(page)).toEqual(before);
  await page.evaluate(() => document.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 83, pointerType: 'touch', isPrimary: true })));
});

test('DOM unclassified movement cannot become a tap on its original beat', async ({ page }) => {
  await setup(page, 'rest');
  const before = await music(page);
  await page.evaluate(() => {
    const source = document.querySelector('.bar-visual[data-container-index="0"][data-bar-index="0"] .beat-square[data-beat-index="16"]');
    const target = document.querySelector('.bar-visual[data-container-index="0"][data-bar-index="0"] .beat-square[data-beat-index="17"]');
    const a = source.getBoundingClientRect(), b = target.getBoundingClientRect();
    const from = { x: a.left + a.width / 2, y: a.top + a.height / 2 }, to = { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    const elapsed = Math.hypot(to.x - from.x, to.y - from.y) / .45;
    for (const [type, cell, p, time] of [['pointerdown', source, from, 1000], ['pointermove', target, to, 1000 + elapsed], ['pointerup', target, to, 1005 + elapsed]]) {
      const event = new PointerEvent(type, { bubbles: true, cancelable: true, pointerType: 'touch', pointerId: 82, isPrimary: true, button: 0, clientX: p.x, clientY: p.y });
      Object.defineProperty(event, 'timeStamp', { value: time }); cell.dispatchEvent(event);
    }
  });
  expect(await music(page)).toEqual(before);
});

test('DOM fast slice stroke crosses bars with one reversible logical edit', async ({ page }) => {
  await setup(page, 'slice');
  await page.evaluate(async () => {
    const state = (await import(new URL('js/appState.js', document.baseURI))).default;
    const display = (await import(new URL('js/barDisplayController.js', document.baseURI))).default;
    const original = state.getTracks()[0].barSettings[0];
    state.updateTrack(0, { barSettings: [structuredClone(original), structuredClone(original)] });
    display.renderBarsAndControls(-1);
    // Isolate cross-bar path semantics from responsive wrapping. Native touch
    // and unmodified responsive geometry are exercised in the cases above.
    for (const [index, bar] of [...document.querySelectorAll('.bar-visual[data-container-index="0"]')].entries()) {
      for (let parent = bar.parentElement; parent && parent !== document.body; parent = parent.parentElement) parent.style.setProperty('transform', 'none', 'important');
      for (const [name, value] of Object.entries({ position: 'fixed', left: '20px', top: `${200 + index * 200}px`, width: '300px', height: '160px', 'min-height': '0', display: 'grid', 'grid-template-columns': 'repeat(8, 1fr)', 'grid-template-rows': 'repeat(8, 20px)', gap: '0', padding: '0', margin: '0' })) bar.style.setProperty(name, value, 'important');
      for (const cell of bar.querySelectorAll('.beat-square')) {
        for (const [name, value] of Object.entries({ 'min-height': '0', 'min-width': '0', margin: '0' })) cell.style.setProperty(name, value, 'important');
      }
      bar.querySelector('.bar-beat-indicator').style.display = 'none';
    }
    for (const animation of document.getAnimations()) if (Number.isFinite(animation.effect?.getComputedTiming().endTime)) animation.finish();
  });
  await page.waitForTimeout(80);
  const before = await music(page);
  await page.evaluate(() => {
    const emit = (type, bar, index, time) => {
      const cell = document.querySelector(`.bar-visual[data-container-index="0"][data-bar-index="${bar}"] .beat-square[data-beat-index="${index}"]`), r = cell.getBoundingClientRect();
      const event = new PointerEvent(type, { bubbles: true, cancelable: true, pointerType: 'touch', pointerId: 79, isPrimary: true, button: 0, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 });
      Object.defineProperty(event, 'timeStamp', { value: time });
      cell.dispatchEvent(event);
    };
    emit('pointerdown', 0, 51, 1000);
    emit('pointermove', 1, 11, 1040);
    emit('pointerup', 1, 11, 1060);
  });
  const after = await music(page);
  expect(after.Tracks[0].barSettings[0].beatSlices).toEqual({ 51: 2, 59: 2 });
  expect(after.Tracks[0].barSettings[1].beatSlices).toEqual({ 3: 2, 11: 2 });
  await undoRedo(page, before, after);
});

test('native second contact cancels an uncommitted gesture without late painting', async ({ page, context }) => {
  await setup(page, 'rest');
  const p = await point(page, 35), before = await music(page), cdp = await context.newCDPSession(page);
  await start(cdp, p);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y, id: 1 }, { x: p.x + 35, y: p.y + 35, id: 2 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p.x - 25, y: p.y, id: 1 }, { x: p.x + 60, y: p.y + 35, id: 2 }] });
  await cancel(cdp);
  await page.waitForTimeout(450);
  expect(await music(page)).toEqual(before);
  await expect(page.locator('[data-beat-precision-lens]')).toHaveCount(0);
  await expect(page.locator('.subdivision-options-container.visible')).toHaveCount(0);
});
