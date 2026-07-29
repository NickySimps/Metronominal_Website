const { test, expect } = require('@playwright/test');
const crypto = require('crypto');

async function readState(page) {
  return page.evaluate(async () => {
    const { default: AppState } = await import(new URL('js/appState.js', document.baseURI).href);
    return {
      tempo: AppState.getTempo(),
      volume: AppState.getVolume(),
      countInBars: AppState.getCountInBars(),
      song: AppState.getSong(),
      theme: AppState.getCurrentTheme(),
      isPlaying: AppState.isPlaying(),
      tracks: AppState.getTracks().map(({ analyserNode, ...track }) => track),
    };
  });
}

async function waitForPeer(page) {
  await expect(page.locator('#n-of-connections')).toHaveText(/\(1\)/, { timeout: 30_000 });
}

async function nextBeatWallTime(page) {
  return page.evaluate(async () => {
    const { default: AppState } = await import(new URL('js/appState.js', document.baseURI).href);
    const track = AppState.getTracks()[0];
    return Date.now() + ((track.nextBeatTime - AppState.getAudioContext().currentTime) * 1000);
  });
}

test('a Play click during startup is honored once initialization finishes', async ({ page }) => {
  await page.route(/\.(mp3|wav)$/i, async route => {
    await new Promise(resolve => setTimeout(resolve, 1_500));
    await route.continue();
  });
  await page.goto('./', { waitUntil: 'domcontentloaded' });
  await page.locator('#start-stop-btn').click();
  await expect.poll(async () => (await readState(page)).isPlaying, { timeout: 15_000 }).toBe(true);
  await expect.poll(async () => page.evaluate(async () => {
    const { default: AppState } = await import(new URL('js/appState.js', document.baseURI).href);
    return AppState.getAudioContext()?.state === 'running' && AppState.getTracks()[0]?.nextBeatTime > 0;
  })).toBe(true);
  await expect(page.locator('#start-stop-btn')).toHaveClass(/active/);
});

test('a second host click before the transport echo cancels the pending Play', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#share-btn')).toHaveClass(/connected/);
  await page.locator('#start-stop-btn').click();
  await page.locator('#start-stop-btn').click();
  await page.waitForTimeout(1_000);
  await expect.poll(async () => (await readState(page)).isPlaying).toBe(false);
  await expect(page.locator('#start-stop-btn')).not.toHaveClass(/active|pending/);
});

test('Play begins with a low-latency authoritative start', async ({ page }) => {
  await page.addInitScript(() => {
    window.__scheduledAudioStarts = [];
    for (const method of ['createBufferSource', 'createOscillator']) {
      const originalCreateSource = BaseAudioContext.prototype[method];
      BaseAudioContext.prototype[method] = function(...args) {
        const source = originalCreateSource.apply(this, args);
        const originalStart = source.start;
        source.start = (...startArgs) => {
          window.__scheduledAudioStarts.push({
            scheduledAt: Date.now(),
            audioNow: this.currentTime,
            startAt: startArgs[0] ?? 0
          });
          return originalStart.apply(source, startArgs);
        };
        return source;
      };
    }
  });
  await page.goto('./');
  await expect(page.locator('#share-btn')).toHaveClass(/connected/);
  await page.waitForTimeout(1_200);

  const startedAt = await page.evaluate(() => {
    window.__scheduledAudioStarts = [];
    return Date.now();
  });
  await page.locator('#start-stop-btn').click();
  await expect.poll(() => page.evaluate(() => window.__scheduledAudioStarts.length)).toBeGreaterThan(0);
  const audibleAt = await page.evaluate(() => Math.min(...window.__scheduledAudioStarts.map(audio => (
    audio.scheduledAt + Math.max(0, audio.startAt - audio.audioNow) * 1000
  ))));
  expect(audibleAt - startedAt).toBeLessThan(400);
});

test('host count-in is synchronized and locally scheduled on every peer', async ({ browser }) => {
  const hostContext = await browser.newContext();
  const clientContext = await browser.newContext();
  const host = await hostContext.newPage();
  const client = await clientContext.newPage();
  const publishedCountIns = [];
  const receivedCountIns = [];
  host.on('websocket', socket => socket.on('framesent', event => {
    try {
      const message = JSON.parse(event.payload);
      if (message.type === 'state') publishedCountIns.push(message.payload.countInBars);
    } catch (_error) { /* Ignore non-JSON WebSocket frames. */ }
  }));
  client.on('websocket', socket => socket.on('framereceived', event => {
    try {
      const message = JSON.parse(event.payload);
      if (message.type === 'state') receivedCountIns.push(message.payload.countInBars);
    } catch (_error) { /* Ignore non-JSON WebSocket frames. */ }
  }));
  const observeStarts = () => {
    window.__scheduledAudioStarts = [];
    window.__cancelledCountInSources = 0;
    const originalCreateOscillator = BaseAudioContext.prototype.createOscillator;
    BaseAudioContext.prototype.createOscillator = function(...args) {
      const source = originalCreateOscillator.apply(this, args);
      const originalStart = source.start;
      const originalStop = source.stop;
      source.start = (...startArgs) => {
        window.__scheduledAudioStarts.push({
          scheduledAt: Date.now(),
          audioNow: this.currentTime,
          startAt: startArgs[0] ?? 0,
          frequency: source.frequency.value
        });
        return originalStart.apply(source, startArgs);
      };
      source.stop = (...stopArgs) => {
        if (stopArgs.length === 0) window.__cancelledCountInSources += 1;
        return originalStop.apply(source, stopArgs);
      };
      return source;
    };
  };
  await host.addInitScript(observeStarts);
  await client.addInitScript(observeStarts);

  await host.goto('./');
  await expect(host.locator('#share-btn')).toHaveClass(/connected/);
  await host.locator('#count-in-bars-select').selectOption('1');
  await expect.poll(async () => (await readState(host)).countInBars).toBe(1);
  await expect.poll(() => publishedCountIns.at(-1)).toBe(1);
  const joinUrl = host.url();
  await client.goto(joinUrl);
  await waitForPeer(host);
  await expect.poll(() => receivedCountIns.at(-1)).toBe(1);
  await client.locator('#dismiss-connection-modal-btn').click();
  await expect(client.locator('#count-in-bars-select')).toHaveValue('1');
  await expect(client.locator('#count-in-bars-select')).toBeDisabled();

  await host.evaluate(() => { window.__scheduledAudioStarts = []; });
  await client.evaluate(() => { window.__scheduledAudioStarts = []; });
  await host.locator('#start-stop-btn').click();
  await expect.poll(() => host.evaluate(() => window.__scheduledAudioStarts.length)).toBe(4);
  await expect.poll(() => client.evaluate(() => window.__scheduledAudioStarts.length)).toBe(4);
  const [hostFirst, clientFirst] = await Promise.all([host, client].map(page => page.evaluate(() => {
    const starts = window.__scheduledAudioStarts;
    return Math.min(...starts.map(item => item.scheduledAt + Math.max(0, item.startAt - item.audioNow) * 1000));
  })));
  expect(Math.abs(hostFirst - clientFirst)).toBeLessThan(40);

  await host.locator('#start-stop-btn').click();
  await expect.poll(() => host.evaluate(() => window.__cancelledCountInSources)).toBeGreaterThan(0);
  await expect.poll(() => client.evaluate(() => window.__cancelledCountInSources)).toBeGreaterThan(0);
  await host.waitForTimeout(2_200);
  expect(await host.evaluate(() => window.__scheduledAudioStarts.length)).toBe(4);
  expect(await client.evaluate(() => window.__scheduledAudioStarts.length)).toBe(4);

  await hostContext.close();
  await clientContext.close();
});

test('song mode synchronizes sections and creates a credential-free song link', async ({ browser }) => {
  const hostContext = await browser.newContext();
  const clientContext = await browser.newContext();
  const lateClientContext = await browser.newContext();
  const importContext = await browser.newContext();
  const host = await hostContext.newPage();
  const client = await clientContext.newPage();

  await host.goto('./');
  await expect(host.locator('#share-btn')).toHaveClass(/connected/);
  await expect(host.locator('#song-mode-panel')).toBeHidden();
  await expect(host.locator('.global-app-controls #song-mode-enabled')).toBeVisible();
  await expect(host.locator('#song-mode-enabled')).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => host.evaluate(() => [...document.querySelectorAll('.rest-button, .record-btn')].every(button => {
    const icon = button.querySelector('.control-icon');
    if (!icon) return false;
    const buttonRect = button.getBoundingClientRect();
    const iconRect = icon.getBoundingClientRect();
    const horizontalOffset = Math.abs((buttonRect.left + buttonRect.width / 2) - (iconRect.left + iconRect.width / 2));
    const verticalOffset = Math.abs((buttonRect.top + buttonRect.height / 2) - (iconRect.top + iconRect.height / 2));
    return horizontalOffset <= 1 && verticalOffset <= 1;
  }))).toBe(true);
  await host.locator('#song-mode-enabled').click();
  await expect(host.locator('#song-mode-enabled')).toHaveAttribute('aria-pressed', 'true');
  await expect(host.locator('#song-mode-panel')).toBeVisible();
  await expect.poll(() => host.locator('#song-mode-panel').evaluate(panel => Math.max(
    ...getComputedStyle(panel).animationDuration.split(',').map(value => Number.parseFloat(value) || 0)
  ))).toBeLessThanOrEqual(0.2);
  await host.locator('#song-name-input').fill('Band Rehearsal');
  await host.locator('[data-song-section-name="0"]').fill('Intro');
  await host.locator('[data-song-section-tempo="0"]').fill('180');
  await host.locator('[data-song-section-tempo="0"]').blur();
  await expect(host.locator('#add-song-section-btn')).toBeEnabled();
  await host.locator('#add-song-section-btn').click();
  await expect(host.locator('.bar-visual')).toHaveCount(2);
  await host.locator('[data-song-section-name="1"]').fill('Chorus');
  await expect(host.locator('[data-song-section-start="1"]')).toHaveJSProperty('tagName', 'SELECT');
  await expect(host.locator('[data-song-section-start="1"] option')).toHaveCount(2);
  await host.locator('[data-song-section-tempo="1"]').fill('150');
  await host.locator('[data-song-section-tempo="1"]').blur();

  await expect.poll(async () => (await readState(host)).song).toMatchObject({
    version: 1,
    enabled: true,
    name: 'Band Rehearsal',
    sections: [
      { name: 'Intro', startBar: 0, tempo: 180 },
      { name: 'Chorus', startBar: 1, tempo: 150 }
    ]
  });

  await client.goto(host.url());
  await waitForPeer(host);
  await client.locator('#dismiss-connection-modal-btn').click();
  await expect.poll(async () => (await readState(client)).song).toMatchObject({
    enabled: true,
    name: 'Band Rehearsal',
    sections: [
      { name: 'Intro', startBar: 0, tempo: 180 },
      { name: 'Chorus', startBar: 1, tempo: 150 }
    ]
  });
  await expect(client.locator('#song-name-input')).toBeDisabled();
  await expect(client.locator('#import-song-input')).toBeDisabled();
  const clientImport = await client.evaluate(async () => {
    const { default: SongController } = await import(new URL('js/songController.js', document.baseURI).href);
    const { default: AppState } = await import(new URL('js/appState.js', document.baseURI).href);
    const payload = await SongController.createPayload();
    payload.state.song.name = 'Unauthorized client song';
    let rejected = false;
    try { await SongController.applyPayload(payload); } catch { rejected = true; }
    return { rejected, name: AppState.getSong().name };
  });
  expect(clientImport).toEqual({ rejected: true, name: 'Band Rehearsal' });

  await host.locator('[data-go-song-section="1"]').click();
  await expect(host.locator('#song-now-playing')).toContainText('Chorus');
  await host.locator('#start-stop-btn').click();
  await expect(client.locator('#song-now-playing')).toContainText('Chorus');
  const lateClient = await lateClientContext.newPage();
  await lateClient.goto(host.url());
  await lateClient.locator('#dismiss-connection-modal-btn').click();
  await expect.poll(async () => (await readState(lateClient)).isPlaying).toBe(true);
  await expect(lateClient.locator('#song-now-playing')).toContainText('Chorus');
  await host.locator('#start-stop-btn').click();

  await hostContext.grantPermissions(['clipboard-read', 'clipboard-write']);
  await host.locator('#copy-song-link-btn').click();
  const songUrl = await host.evaluate(() => navigator.clipboard.readText());
  expect(songUrl).toContain('#song=');
  expect(songUrl).not.toContain('room=');
  expect(songUrl.toLowerCase()).not.toMatch(/credential|hostcredential|sessionstorage/);

  const imported = await importContext.newPage();
  await imported.goto(songUrl);
  await expect(imported.locator('#song-name-input')).toHaveValue('Band Rehearsal');
  await expect.poll(async () => (await readState(imported)).song.sections[0].tempo).toBe(180);
  await expect.poll(async () => (await readState(imported)).song.sections[1].name).toBe('Chorus');

  await importContext.close();
  await lateClientContext.close();
  await clientContext.close();
  await hostContext.close();
});

test('song section tempo automation changes the scheduled beat grid', async ({ page }) => {
  await page.addInitScript(() => {
    window.__songOscillatorStarts = [];
    const original = BaseAudioContext.prototype.createOscillator;
    BaseAudioContext.prototype.createOscillator = function(...args) {
      const source = original.apply(this, args);
      const start = source.start;
      source.start = (...startArgs) => {
        window.__songOscillatorStarts.push(startArgs[0] ?? this.currentTime);
        return start.apply(source, startArgs);
      };
      return source;
    };
  });
  await page.goto('./');
  await expect(page.locator('#share-btn')).toHaveClass(/connected/);
  await page.evaluate(async () => {
    const { default: AppState } = await import(new URL('js/appState.js', document.baseURI).href);
    const state = await AppState.getCurrentStateForPreset(true);
    state.tempo = 60;
    state.Tracks[0].barSettings = [
      { beats: 1, subdivision: 16, rests: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] },
      { beats: 1, subdivision: 16, rests: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] }
    ];
    const mutedPeerTrack = structuredClone(state.Tracks[0]);
    mutedPeerTrack.muted = true;
    state.Tracks.push(mutedPeerTrack);
    state.song = {
      version: 1,
      enabled: true,
      name: 'Tempo Map',
      sections: [
        { name: 'Fast', startBar: 0, tempo: 300 },
        { name: 'Slow', startBar: 1, tempo: 150 }
      ]
    };
    await AppState.loadPresetData(state);
    const { sendState } = await import(new URL('js/webrtc.js', document.baseURI).href);
    sendState(AppState.getCurrentStateForPreset(true));
    window.__songOscillatorStarts = [];
  });

  await page.locator('#start-stop-btn').click();
  await expect.poll(() => page.evaluate(() => [...new Set(window.__songOscillatorStarts.map(value => value.toFixed(3)))].length), {
    timeout: 5_000
  }).toBeGreaterThanOrEqual(3);
  const deltas = await page.evaluate(() => {
    const starts = [...new Set(window.__songOscillatorStarts.map(value => Number(value.toFixed(3))))].sort((a, b) => a - b);
    return [starts[1] - starts[0], starts[2] - starts[1]];
  });
  expect(deltas[0]).toBeCloseTo(0.2, 1);
  expect(deltas[1]).toBeCloseTo(0.4, 1);
  const trackAlignment = await page.evaluate(async () => {
    const { default: AppState } = await import(new URL('js/appState.js', document.baseURI).href);
    return AppState.getTracks().map(track => ({ bar: track.currentBar, beat: track.currentBeat, next: track.nextBeatTime }));
  });
  expect(trackAlignment[1].bar).toBe(trackAlignment[0].bar);
  expect(trackAlignment[1].beat).toBe(trackAlignment[0].beat);
  expect(Math.abs(trackAlignment[1].next - trackAlignment[0].next)).toBeLessThan(0.01);
});

test('song, rest, and recording controls keep readable contrast in every theme', async ({ page }) => {
  await page.goto('./');
  await page.locator('#song-mode-enabled').click();
  const contrastByTheme = await page.evaluate(() => {
    const style = document.createElement('style');
    style.textContent = '*, *::before, *::after { transition: none !important; }';
    document.head.appendChild(style);
    const rgb = value => value.match(/[\d.]+/g)?.slice(0, 3).map(Number);
    const luminance = color => color.map(value => value / 255)
      .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
      .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
    const ratio = element => {
      const computed = getComputedStyle(element);
      const foreground = luminance(rgb(computed.color));
      const background = luminance(rgb(computed.backgroundColor));
      return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
    };
    const selectors = [
      '#song-mode-enabled',
      '.rest-button',
      '.record-btn',
      '.song-mode-panel input',
      '.song-mode-actions button',
      '[data-go-song-section]',
      '[data-remove-song-section]',
      '.sticky-btn',
      '.sticky-play-btn'
    ];
    return [...document.querySelectorAll('[data-theme]')].map(button => {
      button.click();
      return [button.dataset.theme, Math.min(...selectors.map(selector => ratio(document.querySelector(selector))))];
    });
  });
  for (const [theme, ratio] of contrastByTheme) expect(ratio, theme).toBeGreaterThanOrEqual(4.5);
});

test('the theme menu question-mark button generates and persists a new random theme on every press', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#random-theme-btn')).toHaveText('?');
  await expect(page.locator('#random-theme-btn')).toHaveAttribute('aria-label', 'Generate a random theme');
  const paletteSignature = () => page.evaluate(() => [
    getComputedStyle(document.documentElement).getPropertyValue('--Background').trim(),
    getComputedStyle(document.documentElement).getPropertyValue('--Main').trim(),
    getComputedStyle(document.documentElement).getPropertyValue('--Alt2').trim(),
    getComputedStyle(document.documentElement).getPropertyValue('--Highlight').trim()
  ].join('|'));
  await page.locator('#random-theme-btn').click();
  const firstPalette = await paletteSignature();
  const minimumHueDistance = await page.evaluate(() => {
    const hue = value => {
      const [red, green, blue] = value.match(/[\da-f]{2}/gi).map(channel => Number.parseInt(channel, 16) / 255);
      const maximum = Math.max(red, green, blue);
      const minimum = Math.min(red, green, blue);
      const difference = maximum - minimum;
      if (difference === 0) return 0;
      const sector = maximum === red ? ((green - blue) / difference) % 6
        : maximum === green ? (blue - red) / difference + 2
        : (red - green) / difference + 4;
      return (sector * 60 + 360) % 360;
    };
    const styles = getComputedStyle(document.documentElement);
    const hues = ['--Main', '--Highlight', '--Accent', '--Alt2'].map(variable => hue(styles.getPropertyValue(variable).trim()));
    return Math.min(...hues.flatMap((value, index) => hues.slice(index + 1).map(other => {
      const difference = Math.abs(value - other);
      return Math.min(difference, 360 - difference);
    })));
  });
  expect(minimumHueDistance).toBeGreaterThanOrEqual(50);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('selectedTheme'))).toBe('random');
  await page.locator('#random-theme-btn').click();
  const secondPalette = await paletteSignature();
  expect(secondPalette).not.toBe(firstPalette);
  await page.reload();
  await expect.poll(paletteSignature).toBe(secondPalette);
});

test('main playback controls collapse into a desktop floating control card when scrolled away', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 500 });
  await page.goto('./');
  await expect(page.locator('#share-btn')).toHaveClass(/connected/);
  const controls = page.locator('#sticky-mobile-controls');
  await page.evaluate(async () => {
    document.body.style.setProperty('min-height', '2200px', 'important');
    await new Promise(resolve => requestAnimationFrame(resolve));
    window.scrollTo(0, document.documentElement.scrollHeight);
    window.dispatchEvent(new Event('scroll'));
  });
  await expect(controls).toHaveClass(/sticky-active/);
  await expect.poll(() => controls.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return style.position === 'fixed'
      && style.display === 'flex'
      && Math.abs(rect.left - 20) <= 2
      && rect.right < window.innerWidth
      && rect.bottom < window.innerHeight
      && rect.width < window.innerWidth * 0.8
      && Number.parseFloat(style.borderRadius) > 0
      && style.borderColor !== 'transparent'
      && style.borderColor !== 'rgba(0, 0, 0, 0)'
      && style.boxShadow !== 'none'
      && Number.parseFloat(style.transitionDuration) < 0.2;
  })).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(controls).not.toHaveClass(/sticky-active/);
  await page.evaluate(() => {
    document.getElementById('start-stop-btn').style.transform = 'translateY(-1200px)';
  });
  await expect(controls).toHaveClass(/sticky-active/);
});

test('song import rejects malformed state and reconstructs accepted data from an allowlist', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#share-btn')).toHaveClass(/connected/);
  const outcome = await page.evaluate(async () => {
    const { default: AppState } = await import(new URL('js/appState.js', document.baseURI).href);
    const { default: SongController } = await import(new URL('js/songController.js', document.baseURI).href);
    const before = AppState.getTempo();
    let rejected = false;
    try {
      await SongController.applyPayload({
        format: 'metronominal-song', version: 1,
        state: { tempo: 999, volume: 1, Tracks: [] }
      });
    } catch { rejected = true; }

    const invalidSoundPayload = await SongController.createPayload();
    invalidSoundPayload.state.Tracks[0].mainBeatSound.sound = { malicious: true };
    let invalidSoundRejected = false;
    try { await SongController.applyPayload(invalidSoundPayload); } catch { invalidSoundRejected = true; }

    const unknownPayload = await SongController.createPayload();
    unknownPayload.state.song.unknownSongField = 'drop me';
    unknownPayload.state.Tracks[0].mainBeatSound.unknownSoundField = 'drop me';
    unknownPayload.state.customSounds = {
      SafeAlias: { baseSound: 'Synth Kick', settings: {}, unknownCustomField: 'drop me' }
    };
    await SongController.applyPayload(unknownPayload);
    const reconstructed = await AppState.getCurrentStateForPreset(true);

    const fractionalPayload = await SongController.createPayload();
    fractionalPayload.state.tempo = 120.5;
    let fractionalRejected = false;
    try { await SongController.applyPayload(fractionalPayload); } catch { fractionalRejected = true; }

    return {
      rejected, invalidSoundRejected, fractionalRejected, before, after: AppState.getTempo(),
      unknownSong: 'unknownSongField' in reconstructed.song,
      unknownSound: 'unknownSoundField' in reconstructed.Tracks[0].mainBeatSound,
      unknownCustom: 'unknownCustomField' in reconstructed.customSounds.SafeAlias
    };
  });
  expect(outcome).toEqual({
    rejected: true, invalidSoundRejected: true, fractionalRejected: true,
    before: 120, after: 120, unknownSong: false, unknownSound: false, unknownCustom: false
  });
});

test('a song edit attempted during playback cannot publish after Stop', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#song-mode-enabled')).toBeEnabled({ timeout: 30_000 });
  await page.locator('#song-mode-enabled').click();
  await page.locator('#start-stop-btn').click();
  await expect.poll(async () => (await readState(page)).isPlaying).toBe(true);
  await page.evaluate(() => {
    const input = document.getElementById('song-name-input');
    input.disabled = false;
    input.value = 'Stale playback edit';
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.locator('#start-stop-btn').click();
  await expect.poll(async () => (await readState(page)).isPlaying).toBe(false);
  await page.locator('[data-song-section-name="0"]').fill('Safe edit');
  await page.locator('[data-song-section-name="0"]').blur();
  await expect.poll(async () => (await readState(page)).song).toMatchObject({
    name: 'Untitled Song', sections: [{ name: 'Safe edit' }]
  });
});

test('song mode rolls back when a connected browser lacks song capability', async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWebSocket = window.WebSocket;
    window.WebSocket = class ObservedWebSocket extends NativeWebSocket {
      constructor(url, protocols) {
        super(url, protocols);
        window.__syncServerUrl = String(url);
      }
    };
  });
  await page.goto('./');
  await expect(page.locator('#song-mode-enabled')).toBeEnabled({ timeout: 30_000 });
  await expect.poll(() => new URL(page.url()).searchParams.get('room')).not.toBeNull();
  await page.evaluate(async () => {
    const room = new URL(location.href).searchParams.get('room');
    let legacy = null;
    for (let attempt = 0; attempt < 3 && !legacy; attempt += 1) {
      const candidate = new WebSocket(window.__syncServerUrl);
      const opened = await new Promise(resolve => {
        candidate.addEventListener('open', () => resolve(true), { once: true });
        candidate.addEventListener('error', () => resolve(false), { once: true });
      });
      if (opened) legacy = candidate;
      else {
        candidate.close();
        await new Promise(resolve => setTimeout(resolve, 250));
      }
    }
    if (!legacy) throw new Error('Could not open legacy compatibility probe');
    window.__legacySongClient = legacy;
    const joined = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Legacy join timed out')), 5000);
      legacy.addEventListener('message', event => {
        const message = JSON.parse(event.data);
        if (message.type === 'error') {
          clearTimeout(timeout);
          reject(new Error(`Legacy join failed: ${message.code}`));
        } else if (message.type === 'joined') {
          clearTimeout(timeout);
          resolve();
        }
      });
    });
    legacy.send(JSON.stringify({ type: 'join', room, requestedRole: 'client' }));
    await joined;
  });
  await page.locator('#song-mode-enabled').click();
  await expect.poll(async () => (await readState(page)).song.enabled).toBe(false);
  await expect(page.locator('#song-mode-enabled')).toHaveAttribute('aria-pressed', 'false');
  await page.evaluate(() => window.__legacySongClient.close());
});

test('removing bars normalizes the host song timeline before synchronization', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#share-btn')).toHaveClass(/connected/);
  await page.locator('#song-mode-enabled').click();
  await page.locator('#add-song-section-btn').click();
  await expect.poll(async () => (await readState(page)).song.sections).toHaveLength(2);
  await page.getByRole('button', { name: 'Decrease bars' }).click();
  const state = await page.evaluate(async () => {
    const { default: AppState } = await import(new URL('js/appState.js', document.baseURI).href);
    return {
      local: AppState.getSong(),
      serialized: (await AppState.getCurrentStateForPreset(true)).song
    };
  });
  expect(state.local.sections).toHaveLength(1);
  expect(state.serialized).toEqual(state.local);
});

test('song sharing excludes private recordings and safely falls back to built-in sounds', async ({ page }) => {
  await page.goto('./');
  const shared = await page.evaluate(async () => {
    const { default: AppState } = await import(new URL('js/appState.js', document.baseURI).href);
    const { default: SongController } = await import(new URL('js/songController.js', document.baseURI).href);
    AppState.addRecording('Private rehearsal take');
    AppState.addCustomSound('Private alias', 'Private rehearsal take', {});
    AppState.getTracks()[0].mainBeatSound.sound = 'Private rehearsal take';
    AppState.getTracks()[0].subdivisionSound.sound = 'Private alias';
    const payload = await SongController.createPayload();
    return {
      main: payload.state.Tracks[0].mainBeatSound.sound,
      subdivision: payload.state.Tracks[0].subdivisionSound.sound,
      customSounds: Object.keys(payload.state.customSounds),
      serialized: JSON.stringify(payload)
    };
  });
  expect(shared.main).toBe('Synth Kick');
  expect(shared.subdivision).toBe('Synth HiHat');
  expect(shared.customSounds).not.toContain('Private alias');
  expect(shared.serialized).not.toContain('Private rehearsal take');
});

test('a client can disconnect from a shared room into a new solo session', async ({ browser }) => {
  const hostContext = await browser.newContext();
  const clientContext = await browser.newContext();
  const host = await hostContext.newPage();
  const client = await clientContext.newPage();

  await host.goto('./');
  await expect(host.locator('#share-btn')).toHaveClass(/connected/, { timeout: 30_000 });
  await host.locator('#share-btn').click();
  const joinUrl = await host.evaluate(() => window.location.href);
  const sharedRoomId = new URL(joinUrl).searchParams.get('room');
  await host.locator('#share-modal .close-button').click();
  await client.goto(joinUrl);
  await waitForPeer(host);
  await client.locator('#dismiss-connection-modal-btn').click();

  await host.locator('#start-stop-btn').click();
  await expect.poll(async () => (await readState(client)).isPlaying).toBe(true);

  const disconnectButton = client.locator('#disconnect-btn');
  await expect(disconnectButton).toBeVisible();
  await expect(disconnectButton).toHaveText('DISCONNECT');
  await expect(disconnectButton).toHaveAttribute('aria-label', 'Disconnect from this room');
  await expect(host.locator('#disconnect-btn')).toHaveAttribute('aria-label', 'Disconnect all clients');
  await disconnectButton.click();

  await expect.poll(() => new URL(client.url()).searchParams.has('room')).toBe(false);
  await expect.poll(() => client.evaluate(() => window.isHost)).toBe(true);
  await expect.poll(() => client.evaluate(() => ({
    roomId: sessionStorage.getItem('host_room_id'),
    credential: sessionStorage.getItem('host_credential'),
    isHost: sessionStorage.getItem('is_host'),
  }))).toMatchObject({
    roomId: expect.not.stringMatching(new RegExp(`^${sharedRoomId}$`)),
    credential: expect.stringMatching(/^[a-f0-9]{64}$/),
    isHost: 'true',
  });
  await expect.poll(async () => (await readState(client)).isPlaying).toBe(false);
  await expect(host.locator('#n-of-connections')).toHaveText('(0)');
  await client.waitForTimeout(1_500);
  await expect(host.locator('#n-of-connections')).toHaveText('(0)');

  await clientContext.close();
  await hostContext.close();
});

test('a stale time-sync response cannot survive room closure', async ({ browser }) => {
  const hostContext = await browser.newContext();
  const clientContext = await browser.newContext();
  await clientContext.addInitScript(() => {
    const NativeWebSocket = window.WebSocket;
    window.WebSocket = class DelayedTimeSyncWebSocket extends NativeWebSocket {
      set onmessage(handler) {
        this.__messageHandler = handler;
        super.onmessage = event => {
          const message = JSON.parse(event.data);
          if (message.type === 'time-sync-response') {
            window.__releaseHeldTimeSync = serverTime => handler(new MessageEvent('message', {
              data: JSON.stringify({ ...message, serverTime })
            }));
            return;
          }
          handler(event);
        };
      }

      get onmessage() {
        return this.__messageHandler;
      }
    };
  });
  const host = await hostContext.newPage();
  const client = await clientContext.newPage();

  await host.goto('./');
  await expect(host.locator('#share-btn')).toHaveClass(/connected/);
  const joinUrl = host.url();
  await client.goto(joinUrl);
  await waitForPeer(host);
  await expect.poll(() => client.evaluate(() => typeof window.__releaseHeldTimeSync)).toBe('function');

  await host.locator('#disconnect-btn').click();
  await expect(client.locator('#share-btn')).not.toHaveClass(/connected/);
  await client.evaluate(() => window.__releaseHeldTimeSync(Date.now() + 60_000));

  await expect.poll(() => client.evaluate(async () => {
    const sync = await import(new URL('js/webrtc.js', document.baseURI).href);
    return sync.getTimeOffset();
  })).toBe(0);
  await expect.poll(() => client.evaluate(async () => {
    const sync = await import(new URL('js/webrtc.js', document.baseURI).href);
    const diagnostics = sync.getSyncDiagnostics();
    return {
      role: diagnostics.role,
      stateRevision: diagnostics.stateRevision,
      transportRevision: diagnostics.transportRevision
    };
  })).toEqual({ role: 'offline', stateRevision: -1, transportRevision: -1 });

  await clientContext.close();
  await hostContext.close();
});

test('diagnostics show authoritative role and connection quality without credentials', async ({ browser }) => {
  const hostContext = await browser.newContext();
  const clientContext = await browser.newContext();
  const host = await hostContext.newPage();
  const client = await clientContext.newPage();

  await host.goto('./');
  await expect(host.locator('#share-btn')).toHaveClass(/connected/);
  await expect(host.locator('.top-controls-area #sync-diagnostics-btn')).toHaveCount(0);
  await expect(host.locator('#share-modal #sync-diagnostics-btn')).toHaveCount(1);
  await expect(host.locator('#sync-diagnostics-btn')).toBeHidden();
  await expect(host.locator('#sync-role')).toHaveText('HOST');
  await expect(host.locator('#sync-quality')).toHaveText(/GOOD|FAIR|POOR/);
  const joinUrl = host.url();
  const hostCredential = await host.evaluate(() => sessionStorage.getItem('host_credential'));

  await client.goto(joinUrl);
  await waitForPeer(host);
  await expect(client.locator('#sync-role')).toHaveText('CLIENT');
  await expect(client.locator('#sync-quality')).toHaveText(/GOOD|FAIR|POOR/);
  await expect(host.locator('#sync-role')).toHaveText('HOST');

  await client.waitForTimeout(1200);
  await client.evaluate(() => {
    window.__realDiagnosticsDateNow = Date.now;
    Date.now = () => window.__realDiagnosticsDateNow() + 20_000;
  });
  await expect(client.locator('#sync-quality')).toHaveText('POOR', { timeout: 2500 });
  await client.evaluate(() => { Date.now = window.__realDiagnosticsDateNow; });

  await client.locator('#dismiss-connection-modal-btn').click();
  await client.locator('#share-btn').click();
  await expect(client.locator('#share-modal')).toBeVisible();
  await client.locator('#sync-diagnostics-btn').click();
  await expect(client.locator('#share-modal')).toBeVisible();
  const diagnostics = client.locator('#sync-diagnostics-panel');
  await expect(diagnostics).toBeVisible();
  await expect(client.locator('#sync-diagnostics-btn')).toHaveAttribute('aria-expanded', 'true');
  await expect.poll(() => client.evaluate(() => {
    const primary = document.getElementById('share-primary-content')?.getBoundingClientRect();
    const panel = document.getElementById('sync-diagnostics-panel')?.getBoundingClientRect();
    const panelStyle = getComputedStyle(document.getElementById('sync-diagnostics-panel'));
    const modalStyle = getComputedStyle(document.querySelector('.share-modal-content'));
    const seconds = value => Math.max(...value.split(',').map(part => Number.parseFloat(part) || 0));
    return Boolean(primary && panel)
      && panel.left >= primary.right - 1
      && seconds(panelStyle.animationDuration) <= 0.2
      && seconds(modalStyle.transitionDuration) <= 0.2;
  })).toBe(true);
  await client.keyboard.press('Escape');
  await expect(diagnostics).toBeHidden();
  await expect(client.locator('#share-modal')).toBeVisible();
  await expect(client.locator('#sync-diagnostics-btn')).toBeFocused();
  await client.locator('#sync-diagnostics-btn').click();
  await expect(diagnostics.locator('[data-diagnostic="role"]')).toHaveText('Client');
  await expect(diagnostics.locator('[data-diagnostic="status"]')).toHaveText('Connected');
  await expect(diagnostics.locator('[data-diagnostic="quality"]')).toHaveText(/Good|Fair|Poor/);
  await expect(diagnostics.locator('[data-diagnostic="rtt"]')).toHaveText(/^\d+(?:\.\d)? ms$/);
  await expect(diagnostics.locator('[data-diagnostic="offset"]')).toHaveText(/^-?\d+(?:\.\d)? ms$/);
  await expect(diagnostics.locator('[data-diagnostic="peers"]')).toHaveText('1');
  await expect(diagnostics.locator('[data-diagnostic="audio"]')).toHaveText(/Running|Suspended/);
  await expect(diagnostics.locator('[data-diagnostic="scheduler"]')).toHaveText('Ready');
  await expect(diagnostics.locator('[data-diagnostic="state-revision"]')).toHaveText(/^\d+$/);
  await expect(diagnostics.locator('[data-diagnostic="transport-revision"]')).toHaveText(/^\d+$/);
  await expect(diagnostics).not.toContainText(hostCredential);
  await expect(diagnostics).not.toContainText(new URL(joinUrl).searchParams.get('room'));
  await client.setViewportSize({ width: 390, height: 720 });
  await expect.poll(() => client.evaluate(() => {
    const primary = document.getElementById('share-primary-content').getBoundingClientRect();
    const panel = document.getElementById('sync-diagnostics-panel').getBoundingClientRect();
    const content = document.querySelector('.share-modal-content').getBoundingClientRect();
    return panel.top >= primary.bottom - 1 && content.width <= window.innerWidth * 0.95;
  })).toBe(true);

  await host.locator('#share-btn').click();
  await host.locator('#sync-diagnostics-btn').click();
  const hostDiagnostics = host.locator('#sync-diagnostics-panel');
  await expect(hostDiagnostics).toBeVisible();
  await expect(hostDiagnostics).not.toContainText(hostCredential);
  await expect(hostDiagnostics).not.toContainText(new URL(joinUrl).searchParams.get('room'));

  await clientContext.close();
  await hostContext.close();
});

test('a QR room join syncs settings and playback position but preserves each peer theme', async ({ browser }) => {
  const hostContext = await browser.newContext();
  const clientContext = await browser.newContext();
  const secondClientContext = await browser.newContext();
  const host = await hostContext.newPage();
  const client = await clientContext.newPage();
  const secondClient = await secondClientContext.newPage();

  const hostErrors = [];
  const clientErrors = [];
  const secondClientErrors = [];
  host.on('pageerror', error => hostErrors.push(error.message));
  client.on('pageerror', error => clientErrors.push(error.message));
  secondClient.on('pageerror', error => secondClientErrors.push(error.message));

  await host.goto('./');
  await expect(host.locator('#n-of-connections')).toHaveText('(0)');
  await expect(host.locator('#n-of-connections')).toHaveAttribute('aria-label', '0 connected peers');
  await expect(host.locator('#share-btn')).not.toHaveClass(/has-peers/);
  await host.locator('[data-theme="dark"]').click();
  await host.locator('.tempo-slider input').fill('173');
  await host.locator('#volume-slider-input').fill('0.42');
  await host.locator('#beat-multiplier-select').selectOption('2');

  await host.locator('#share-btn').click();
  await expect(host.locator('#qrcode')).toHaveAttribute('title', /\?room=/);
  const joinUrl = await host.evaluate(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.get('room')) throw new Error('Share URL has no room parameter');
    return url.href;
  });
  await host.locator('#share-modal .close-button').click();

  await host.locator('#start-stop-btn').click();
  await expect.poll(async () => (await readState(host)).isPlaying).toBe(true);
  await expect.poll(async () => (await readState(host)).tracks[0].currentBeat).not.toBe(0);

  await client.goto(joinUrl);
  await waitForPeer(host);
  await expect(host.locator('#share-btn')).toHaveClass(/has-peers/);
  await expect(host.locator('#share-btn')).toHaveAttribute('aria-label', 'Share room; 1 connected peer');
  await expect(client.locator('#n-of-connections')).toHaveText('(1)');
  await expect(client.locator('#connection-modal')).toBeVisible();
  await client.locator('#dismiss-connection-modal-btn').click();

  await expect.poll(async () => (await readState(client)).tempo).toBe(173);
  await expect.poll(async () => (await readState(client)).volume).toBeCloseTo(0.42, 2);
  await expect.poll(async () => (await readState(client)).tracks[0].barSettings[0].subdivision).toBe(2);
  await expect.poll(async () => (await readState(client)).isPlaying).toBe(true);

  // Opening Share from a joined client must not promote it to an authoritative host.
  expect(await client.evaluate(() => window.isHost)).toBe(false);
  await client.locator('#share-btn').click();
  expect(await client.evaluate(() => window.isHost)).toBe(false);
  await client.locator('#share-modal .close-button').click();

  const hostState = await readState(host);
  const clientState = await readState(client);
  expect(clientState.theme).toBe('default');
  expect(hostState.theme).toBe('dark');
  expect(clientState.tracks[0].currentBar).toBe(hostState.tracks[0].currentBar);
  const beatDistance = Math.abs(clientState.tracks[0].currentBeat - hostState.tracks[0].currentBeat);
  const activeBar = hostState.tracks[0].barSettings[hostState.tracks[0].currentBar];
  const beatPositions = activeBar.beats * activeBar.subdivision;
  expect(Math.min(beatDistance, beatPositions - beatDistance)).toBeLessThanOrEqual(1);

  // Changes made after joining remain host-authoritative and keep the client's theme local.
  await client.locator('[data-theme="synthwave"]').click();
  await host.locator('.tempo-slider input').fill('181');
  await expect.poll(async () => (await readState(client)).tempo).toBe(181);
  await host.evaluate(async () => {
    const { default: AppState } = await import(new URL('js/appState.js', document.baseURI).href);
    const { sendState } = await import(new URL('js/webrtc.js', document.baseURI).href);
    AppState.setSong({ version: 1, enabled: true, name: 'Lifecycle Song', sections: [{ name: 'Main', startBar: 0, tempo: 181 }] });
    sendState(AppState.getCurrentStateForPreset(true));
  });
  await expect.poll(async () => (await readState(client)).song.name).toBe('Lifecycle Song');
  expect((await readState(client)).theme).toBe('synthwave');

  // A second independent browser receives the same room snapshot and presence count.
  await secondClient.goto(joinUrl);
  await expect(host.locator('#n-of-connections')).toHaveText('(2)');
  await expect(client.locator('#n-of-connections')).toHaveText('(2)');
  await expect(secondClient.locator('#n-of-connections')).toHaveText('(2)');
  await secondClient.locator('#dismiss-connection-modal-btn').click();
  await expect.poll(async () => (await readState(secondClient)).tempo).toBe(181);
  await expect.poll(async () => (await readState(secondClient)).song.name).toBe('Lifecycle Song');
  await secondClient.locator('[data-theme="dark"]').click();

  // Client controls cannot overwrite or permanently diverge from authoritative host settings.
  await client.locator('.tempo-slider input').fill('90');
  await expect.poll(async () => (await readState(client)).tempo).toBe(181);
  expect((await readState(host)).tempo).toBe(181);
  expect((await readState(client)).theme).toBe('synthwave');
  expect((await readState(secondClient)).theme).toBe('dark');

  await host.locator('#start-stop-btn').click();
  await expect.poll(async () => (await readState(client)).isPlaying).toBe(false);
  await expect.poll(async () => (await readState(secondClient)).isPlaying).toBe(false);
  await host.locator('#start-stop-btn').click();
  await expect.poll(async () => (await readState(client)).isPlaying).toBe(true);
  await expect.poll(async () => (await readState(secondClient)).isPlaying).toBe(true);

  await expect.poll(async () => {
    const times = await Promise.all([
      nextBeatWallTime(host),
      nextBeatWallTime(client),
      nextBeatWallTime(secondClient),
    ]);
    return Math.max(...times) - Math.min(...times);
  }).toBeLessThan(80);

  // A newer Play revision cancels an already scheduled Stop on every browser.
  await host.evaluate(async () => {
    const sync = await import(new URL('js/webrtc.js', document.baseURI).href);
    sync.broadcastStop();
    await new Promise(resolve => setTimeout(resolve, 100));
    sync.broadcastScheduledPlay();
  });
  await host.waitForTimeout(1_000);
  await expect.poll(async () => (await readState(host)).isPlaying).toBe(true);
  await expect.poll(async () => (await readState(client)).isPlaying).toBe(true);
  await expect.poll(async () => (await readState(secondClient)).isPlaying).toBe(true);

  await secondClientContext.close();
  await expect(host.locator('#n-of-connections')).toHaveText('(1)');
  await expect(client.locator('#n-of-connections')).toHaveText('(1)');

  // Reloading a client reconnects it to the same room and replays authoritative state.
  await client.reload();
  await expect(client.locator('#connection-modal')).toBeVisible();
  await client.locator('#dismiss-connection-modal-btn').click();
  await expect(host.locator('#n-of-connections')).toHaveText('(1)');
  await expect(client.locator('#n-of-connections')).toHaveText('(1)');
  await expect.poll(async () => (await readState(client)).tempo).toBe(181);
  await expect.poll(async () => (await readState(client)).song.name).toBe('Lifecycle Song');
  await expect.poll(async () => (await readState(client)).isPlaying).toBe(true);
  expect((await readState(client)).theme).toBe('synthwave');

  // A host network interruption recreates the credential-bound room and republishes playback.
  await host.evaluate(async () => {
    const { reconnectSynchronization } = await import(new URL('js/webrtc.js', document.baseURI).href);
    reconnectSynchronization();
  });
  await expect(host.locator('#n-of-connections')).toHaveText('(1)', { timeout: 15_000 });
  await expect(client.locator('#n-of-connections')).toHaveText('(1)');
  await expect.poll(async () => (await readState(host)).isPlaying).toBe(true);
  await expect.poll(async () => (await readState(client)).isPlaying).toBe(true);

  // A credential-bearing replacement host consumes server state/transport instead of overwriting it.
  const hostIdentity = await host.evaluate(() => ({
    roomId: sessionStorage.getItem('host_room_id'),
    hostCredential: sessionStorage.getItem('host_credential'),
  }));
  const replacementContext = await browser.newContext();
  await replacementContext.addInitScript(identity => {
    sessionStorage.setItem('host_room_id', identity.roomId);
    sessionStorage.setItem('host_credential', identity.hostCredential);
    sessionStorage.setItem('is_host', 'true');
  }, hostIdentity);
  const replacementHost = await replacementContext.newPage();
  const replacementErrors = [];
  replacementHost.on('pageerror', error => replacementErrors.push(error.message));
  await replacementHost.goto(joinUrl);
  await expect.poll(async () => (await readState(replacementHost)).tempo).toBe(181);
  await expect.poll(async () => (await readState(replacementHost)).song.name).toBe('Lifecycle Song');
  await expect.poll(async () => (await readState(replacementHost)).isPlaying).toBe(true);
  expect(await replacementHost.evaluate(() => window.isHost)).toBe(true);
  expect(await host.evaluate(() => window.isHost)).toBe(false);
  await expect.poll(async () => (await readState(host)).isPlaying).toBe(false);

  // Closing a room revokes the old room before asynchronous replacement-room setup.
  await replacementHost.evaluate(async () => {
    const { disconnectAllPeers } = await import(new URL('js/webrtc.js', document.baseURI).href);
    await disconnectAllPeers();
  });
  await expect.poll(async () => (await readState(replacementHost)).isPlaying).toBe(false);
  await expect.poll(async () => (await readState(client)).isPlaying).toBe(false);
  await expect(replacementHost.locator('#n-of-connections')).toHaveText('(0)');
  await expect.poll(async () => replacementHost.evaluate(
    previousRoom => sessionStorage.getItem('host_room_id') !== previousRoom,
    hostIdentity.roomId,
  )).toBe(true);

  expect(hostErrors).toEqual([]);
  expect(clientErrors).toEqual([]);
  expect(secondClientErrors).toEqual([]);
  expect(replacementErrors).toEqual([]);

  await clientContext.close();
  await replacementContext.close();
  await hostContext.close();
});

test('a client retries until a temporarily unavailable host room returns', async ({ browser }) => {
  const credential = crypto.randomBytes(32).toString('hex');
  const proof = crypto.createHash('sha256').update(credential).digest('hex').slice(0, 32);
  const room = `retry_${proof}`;
  const hostContext = await browser.newContext();
  const clientContext = await browser.newContext();
  await hostContext.addInitScript(({ roomId, hostCredential }) => {
    sessionStorage.setItem('host_room_id', roomId);
    sessionStorage.setItem('host_credential', hostCredential);
    sessionStorage.setItem('is_host', 'true');
  }, { roomId: room, hostCredential: credential });

  const client = await clientContext.newPage();
  const host = await hostContext.newPage();

  await client.goto(`./?room=${room}`);
  await expect(client.locator('#share-btn')).toHaveClass(/failed/);

  await host.goto(`./?room=${room}`);
  await expect(host.locator('#n-of-connections')).toHaveText('(1)', { timeout: 10_000 });
  await expect(client.locator('#n-of-connections')).toHaveText('(1)');
  expect(await host.evaluate(() => window.isHost)).toBe(true);
  expect(await client.evaluate(() => window.isHost)).toBe(false);

  await clientContext.close();
  await hostContext.close();
});
