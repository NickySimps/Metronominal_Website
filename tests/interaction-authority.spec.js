const { test, expect } = require('@playwright/test');

async function ready(page) {
  await page.goto('./');
  await expect(page.locator('#share-btn')).toHaveClass(/connected/);
}

async function state(page) {
  return page.evaluate(async () => {
    const { default: app } = await import(new URL('js/appState.js', document.baseURI));
    return { tempo: app.getTempo(), playing: app.isPlaying(), countIn: app.getCountInBars() };
  });
}

async function bodyKey(page, key) {
  await page.locator('body').evaluate(body => {
    body.tabIndex = -1;
    body.focus();
  });
  await page.keyboard.press(key);
}

async function withPeers(browser, run) {
  const contexts = await Promise.all([0, 1, 2].map(() => browser.newContext({ serviceWorkers: 'block' })));
  try {
    const [host, client, observer] = await Promise.all(contexts.map(context => context.newPage()));
    const errors = [];
    for (const page of [host, client, observer]) page.on('pageerror', error => errors.push(error.message));
    await ready(host);
    await host.locator('.tempo-container .slider').fill('173');
    await host.locator('.tempo-container .slider').dispatchEvent('input');
    await host.locator('.tempo-container .slider').dispatchEvent('change');
    await Promise.all([client, observer].map(async page => {
      await page.goto(host.url());
      await expect.poll(() => page.evaluate(async () => {
        const sync = await import(new URL('js/webrtc.js', document.baseURI));
        return sync.isSynchronizationJoined() && window.isHost === false;
      })).toBe(true);
      await page.locator('#dismiss-connection-modal-btn').click();
      await expect.poll(async () => (await state(page)).tempo).toBe(173);
    }));
    await run({ host, client, observer });
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(contexts.map(context => context.close()));
  }
}

test('joined client cannot reset through the direct UI API', async ({ browser }) => {
  await withPeers(browser, async ({ host, client, observer }) => {
    const before = await state(client);
    await client.evaluate(async () => {
      const { default: ui } = await import(new URL('js/uiController.js', document.baseURI));
      await ui.resetToDefaults();
    });
    expect(await state(client)).toEqual(before);
    expect(await state(host)).toEqual(before);
    expect(await state(observer)).toEqual(before);
  });
});

test('client R and Reset cannot interrupt authoritative playback', async ({ browser }) => {
  await withPeers(browser, async ({ host, client, observer }) => {
    await host.locator('.start-stop-btn').click();
    for (const page of [host, client, observer]) {
      await expect.poll(async () => (await state(page)).playing).toBe(true);
    }
    await bodyKey(client, 'r');
    // A programmatic event must fail closed as well as the disabled control.
    await client.locator('.reset-btn').dispatchEvent('click');
    for (const page of [host, client, observer]) {
      expect(await state(page)).toMatchObject({ playing: true, tempo: 173 });
    }
  });
});

test('joined client cannot load a locally saved preset through the API', async ({ browser }) => {
  await withPeers(browser, async ({ host, client, observer }) => {
    const result = await client.evaluate(async () => {
      const { default: app } = await import(new URL('js/appState.js', document.baseURI));
      const { default: presets } = await import(new URL('js/presetController.js', document.baseURI));
      const data = await app.getCurrentStateForPreset();
      data.tempo = 90;
      localStorage.setItem('metronomePreset_0', JSON.stringify(data));
      return presets.loadPreset(0);
    });
    expect(result).toBeNull();
    for (const page of [host, client, observer]) expect((await state(page)).tempo).toBe(173);
  });
});

for (const action of ['keyboard', 'button']) {
  test(`host ${action} Reset stops every peer and broadcasts defaults`, async ({ browser }) => {
    await withPeers(browser, async ({ host, client, observer }) => {
      await host.locator('.start-stop-btn').click();
      for (const page of [host, client, observer]) {
        await expect.poll(async () => (await state(page)).playing).toBe(true);
      }
      if (action === 'keyboard') await bodyKey(host, 'r');
      else await host.locator('.reset-btn').click();
      for (const page of [host, client, observer]) {
        await expect.poll(async () => state(page)).toMatchObject({ tempo: 120, playing: false });
        expect(await page.evaluate(async () => {
          const { default: engine } = await import(new URL('js/metronomeEngine.js', document.baseURI));
          return engine.isPlaying();
        })).toBe(false);
      }
    });
  });
}

test('modified shortcuts leave browser and OS key combinations alone', async ({ page }) => {
  await ready(page);
  const result = await page.evaluate(() => {
    const combinations = [
      { ctrlKey: true }, { altKey: true }, { metaKey: true },
    ];
    return combinations.flatMap(modifier => [' ', 'r', 'ArrowUp', '+'].map(key => {
      const event = new KeyboardEvent('keydown', { key, ...modifier, bubbles: true, cancelable: true });
      document.body.dispatchEvent(event);
      return event.defaultPrevented;
    }));
  });
  expect(result).toEqual(Array(12).fill(false));
  expect((await state(page)).playing).toBe(false);
});

test('focused native controls keep Space/Enter activation instead of toggling transport', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => {
    const fixture = document.createElement('div');
    fixture.id = 'keyboard-fixture';
    fixture.innerHTML = '<button id="native-button"><span>Action</span></button><a id="native-link" href="#native-destination">Link</a><details><summary id="native-summary">Details</summary>Content</details>';
    document.body.append(fixture);
    window.nativeClicks = 0;
    fixture.addEventListener('click', () => window.nativeClicks++);
  });
  await page.locator('#native-button').focus();
  await page.keyboard.press('Space');
  await expect.poll(() => page.evaluate(() => window.nativeClicks)).toBe(1);
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => window.nativeClicks)).toBe(2);
  await page.locator('#native-link').focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#native-destination$/);
  await page.locator('#native-summary').focus();
  await page.keyboard.press('Space');
  await expect(page.locator('#keyboard-fixture details')).toHaveAttribute('open', '');
  await page.keyboard.press('Enter');
  await expect(page.locator('#keyboard-fixture details')).not.toHaveAttribute('open', '');
  expect((await state(page)).playing).toBe(false);
});
