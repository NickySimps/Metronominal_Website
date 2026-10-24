const { test, expect } = require('@playwright/test');

async function fixture(page, adaptive = true) {
  await page.goto('/js/oscilloscope.js');
  await page.evaluate(async (adaptive) => {
    document.body.innerHTML = '<canvas id="background-oscilloscope" width="300" height="100"></canvas><button id="visualizer-mode-btn"></button><div id="adaptive-root"></div>';
    const style = document.createElement('link');
    style.rel = 'stylesheet'; style.href = '/adaptive-visualization.css'; document.head.append(style);
    window.scope = (await import('/js/oscilloscope.js')).default;
    window.state = (await import('/js/appState.js')).default;
    window.frames = new Map(); window.nextFrame = 0; window.now = 0;
    window.requestAnimationFrame = (fn) => { const id = ++window.nextFrame; frames.set(id, fn); return id; };
    window.cancelAnimationFrame = (id) => frames.delete(id);
    window.step = (delta, count = 1) => {
      for (let i = 0; i < count; i++) {
        now += delta; const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn(now));
      }
    };
    scope.init();
    if (adaptive) {
      window.initializeAdaptiveVisualization = (await import('/js/adaptiveVisualization.js')).initializeAdaptiveVisualization;
      window.controller = initializeAdaptiveVisualization(document.querySelector('#adaptive-root'));
    }
  }, adaptive);
}

test('explicit legacy draw calls still paint each requested mode/effect frame', async ({ page }) => {
  await fixture(page, false);
  expect(await page.evaluate(() => {
    let painted = 0;
    scope.renderFrame = () => painted++;
    scope.isDrawing = true;
    for (let i = 0; i < 5; i++) scope.draw();
    return painted;
  })).toBe(5);
});

test('scheduler caps real drawing, skips costly effects and cancels pending frames', async ({ page }) => {
  await fixture(page);
  const result = await page.evaluate(() => {
    let draws = 0, effects = 0;
    const analyser = { frequencyBinCount: 32, getByteFrequencyData: data => data.fill(120) };
    state.getAnalyserNodes = () => [analyser];
    scope.drawWaveform = () => draws++;
    scope.applyVisualizerEffects = () => effects++;
    scope.setRenderingPolicy({ fps: 20, effects: false });
    scope.start(); step(1000 / 60, 60);
    const capped = { draws, effects, pending: frames.size };
    scope.stop(); const stopped = frames.size;
    scope.start(); scope.setRenderingPolicy({ fps: 0 });
    const paused = frames.size; const before = draws; step(16, 20);
    scope.setRenderingPolicy({ fps: 60 }); step(17, 5);
    return { capped, stopped, paused, before, after: draws, pending: frames.size };
  });
  expect(result.capped.draws).toBeGreaterThanOrEqual(19);
  expect(result.capped.draws).toBeLessThanOrEqual(21);
  expect(result.capped.effects).toBe(0);
  expect(result.capped.pending).toBe(1);
  expect(result.stopped).toBe(0);
  expect(result.paused).toBe(0);
  expect(result.after).toBeGreaterThan(result.before);
  expect(result.pending).toBe(1);
});

test('Auto downgrades only after sustained slow frames and recovers on measured healthy frames', async ({ page }) => {
  await fixture(page);
  const result = await page.evaluate(() => {
    scope.start(); step(40, 26);
    const first = controller.getState().tier;
    step(40, 30); const slow = controller.getState();
    step(1000 / 60, 240); const early = controller.getState().tier;
    step(1000 / 60, 180); const recovered = controller.getState();
    return { first, slow, early, recovered };
  });
  expect(result.first).toBe('full');
  expect(result.slow).toMatchObject({ tier: 'reduced', fps: 20 });
  expect(result.early).toBe('reduced');
  expect(result.recovered).toMatchObject({ tier: 'full', fps: 60 });
});

test('reinitializing the oscilloscope reuses the native menu and handlers', async ({ page }) => {
  await fixture(page);
  await page.evaluate(() => { scope.init(); scope.init(); scope.setMode('waveform'); });
  await expect(page.locator('#visualizer-mode-menu button')).toHaveCount(16);
  await page.locator('#visualizer-mode-btn').click();
  expect(await page.evaluate(() => scope.mode)).toBe('spectrum');
});

test('motion and visibility suspend only drawing, with no per-frame status churn', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await fixture(page);
  await expect(page.getByRole('status')).toContainText('system reduced motion');
  expect(await page.evaluate(() => scope.renderingPolicy.fps)).toBe(0);
  await page.getByRole('combobox').selectOption('full');
  expect(await page.evaluate(() => scope.renderingPolicy.fps)).toBe(60);
  const result = await page.evaluate(() => {
    let changes = 0;
    const observer = new MutationObserver(records => { changes += records.length; });
    observer.observe(document.querySelector('[role=status]'), { childList: true, characterData: true, subtree: true });
    scope.start(); step(17, 100);
    return Promise.resolve().then(() => {
      const stable = changes;
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
      const hidden = { fps: scope.renderingPolicy.fps, pending: frames.size };
      Object.defineProperty(document, 'hidden', { configurable: true, value: false });
      document.dispatchEvent(new Event('visibilitychange'));
      observer.disconnect(); return { stable, hidden, resumed: frames.size };
    });
  });
  expect(result).toEqual({ stable: 0, hidden: { fps: 0, pending: 0 }, resumed: 1 });
});

test('Off leaves native audio running, analyser routing and musical snapshot unchanged', async ({ page, browser, browserName }) => {
  await fixture(page);
  test.skip(browserName === 'webkit' && process.platform === 'win32' && !(await page.evaluate(() => typeof AudioContext === 'function')), 'This Windows WebKit build lacks native Web Audio. Actual signal/routing proof requires a supported browser or real iOS device.');
  const before = await page.evaluate(async () => {
    window.audio = new AudioContext(); await audio.resume();
    window.source = audio.createOscillator(); window.analyser = audio.createAnalyser();
    source.connect(analyser); analyser.connect(audio.destination); source.start();
    state.getAnalyserNodes = () => [analyser];
    window.snapshot = JSON.stringify(state.getTracks());
    scope.start(); step(17, 10);
    return audio.currentTime;
  });
  await page.getByRole('combobox').selectOption('off');
  await page.waitForTimeout(100);
  const result = await page.evaluate(() => {
    const data = new Uint8Array(analyser.frequencyBinCount); analyser.getByteTimeDomainData(data);
    return { running: audio.state, time: audio.currentTime, signal: data.some(v => Math.abs(v - 128) > 4),
      same: snapshot === JSON.stringify(state.getTracks()), routing: state.getAnalyserNodes()[0] === analyser,
      pending: frames.size, preference: localStorage.getItem('metronominal.visualizationQuality') };
  });
  expect(result).toMatchObject({ running: 'running', signal: true, same: true, routing: true, pending: 0, preference: 'off' });
  expect(result.time).toBeGreaterThan(before);
  const peerContext = await browser.newContext();
  const peer = await peerContext.newPage();
  await peer.goto(new URL('/js/oscilloscope.js', page.url()).href);
  await fixture(peer);
  await expect(peer.getByRole('combobox')).toHaveValue('auto');
  await peerContext.close();
  await page.reload();
  await fixture(page);
  await expect(page.getByRole('combobox')).toHaveValue('off');
});

test('controls remain reachable and legible at 320px across theme colors', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await fixture(page);
  const result = await page.evaluate(() => {
    const panel = document.querySelector('.adaptive-visualization');
    const select = panel.querySelector('select');
    const palettes = ['#fff', '#000', '#ff00ff', '#80ffaa', '#092840'];
    return palettes.map(background => {
      document.body.style.background = background;
      document.documentElement.style.setProperty('--Main', background);
      document.documentElement.style.setProperty('--Background', background);
      // The application theme supplies a derived on-surface color. This
      // standalone fixture must supply the same contract, not expect navy.
      const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');canvas.width=canvas.height=1;ctx.fillStyle=background;ctx.fillRect(0,0,1,1);const rgb=[...ctx.getImageData(0,0,1,1).data].slice(0,3);
      const luminance=rgb.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
      const white=1.05/(luminance+.05),black=(luminance+.05)/.05,on=black>=white?'#000':'#fff';
      document.documentElement.style.setProperty('--ReadableOnBackground',on);
      const rect = select.getBoundingClientRect(); const style = getComputedStyle(select);
      return { left: rect.left, right: rect.right, height: rect.height, color: style.color, background: style.backgroundColor,
        expectedBackground:`rgb(${rgb.join(', ')})`,expectedColor:on==='#000'?'rgb(0, 0, 0)':'rgb(255, 255, 255)',contrast:Math.max(white,black),scroll: document.documentElement.scrollWidth };
    });
  });
  for (const value of result) {
    expect(value.left).toBeGreaterThanOrEqual(0); expect(value.right).toBeLessThanOrEqual(320);
    expect(value.height).toBeGreaterThanOrEqual(44); expect(value.scroll).toBeLessThanOrEqual(320);
    expect(value.color).toBe(value.expectedColor); expect(value.background).toBe(value.expectedBackground);expect(value.contrast).toBeGreaterThanOrEqual(4.5);
  }
});

test('local selector defaults to Auto, reuses nodes and never replaces the native visual choice', async ({ page }) => {
  await fixture(page);
  const select = page.getByRole('combobox', { name: 'Visualization quality' });
  await expect(select).toHaveValue('auto');
  await expect(select.locator('option')).toHaveText(['Auto', 'Full', 'Reduced', 'Off']);
  await page.evaluate(() => { scope.setMode('prism'); window.originalSelect = document.querySelector('select'); window.sameController = initializeAdaptiveVisualization(document.querySelector('#adaptive-root')) === controller; });
  await select.selectOption('reduced');
  expect(await page.evaluate(() => ({ same: sameController, node: originalSelect === document.querySelector('select'), mode: scope.mode, fps: scope.renderingPolicy.fps, saved: localStorage.getItem('metronominal.visualizationQuality') }))).toEqual({ same: true, node: true, mode: 'prism', fps: 20, saved: 'reduced' });
  await expect(page.getByRole('status')).toContainText('Reduced');
});
