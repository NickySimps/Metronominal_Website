const { test, expect } = require('@playwright/test');
const crypto = require('crypto');

async function readState(page) {
  return page.evaluate(async () => {
    const { default: AppState } = await import(new URL('js/appState.js', document.baseURI).href);
    return {
      tempo: AppState.getTempo(),
      volume: AppState.getVolume(),
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
  expect((await readState(client)).theme).toBe('synthwave');

  // A second independent browser receives the same room snapshot and presence count.
  await secondClient.goto(joinUrl);
  await expect(host.locator('#n-of-connections')).toHaveText('(2)');
  await expect(client.locator('#n-of-connections')).toHaveText('(2)');
  await expect(secondClient.locator('#n-of-connections')).toHaveText('(2)');
  await secondClient.locator('#dismiss-connection-modal-btn').click();
  await expect.poll(async () => (await readState(secondClient)).tempo).toBe(181);
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
