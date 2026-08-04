const { test, expect } = require('@playwright/test');

test.describe('mode controls responsive layout', () => {
  for (const viewport of [
    { name: 'mobile', width: 375, height: 800 },
    { name: 'iPhone SE', width: 320, height: 568 },
    { name: 'desktop', width: 1280, height: 800 },
  ]) {
    test(`keeps A/B loop and Song Mode controls visible at ${viewport.name} width`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto('/');

      await page.locator('#theme-menu-toggle').click();
      await page.locator('[data-theme="synthwave"]').click();
      await page.locator('#theme-menu-toggle').click();

      await page.evaluate(async () => {
        const { default: AppState } = await import(new URL('js/appState.js', document.baseURI).href);
        AppState.updateBarArray(8);
        document.dispatchEvent(new CustomEvent('barstructurechanged'));
      });

      const toggle = page.locator('#ab-loop-toggle-btn');
      await toggle.click();

      await page.locator('#ab-start-bar').selectOption('3');
      await page.locator('#ab-end-bar').selectOption('7');
      await expect.poll(() => page.evaluate(async () => {
        const { default: AppState } = await import(new URL('js/appState.js', document.baseURI).href);
        return AppState.getAbLoop();
      })).toMatchObject({ startBar: 2, endBar: 6 });

      const modeGroup = page.locator('.mode-controls-group');
      const abControls = page.locator('.ab-loop-controls');
      const songControls = page.locator('.song-mode-toggle-wrap');
      const songButton = page.locator('#song-mode-enabled');

      const endInput = page.locator('#ab-end-bar');
      await expect(page.locator('#ab-start-bar')).toHaveJSProperty('tagName', 'SELECT');
      await expect(endInput).toHaveJSProperty('tagName', 'SELECT');
      await expect(page.locator('label[for="ab-start-bar"]')).toContainText('Loop from');
      await expect(page.locator('label[for="ab-end-bar"]')).toContainText('Loop to');
      await expect(page.locator('#ab-start-bar option')).toHaveCount(8);
      await expect(endInput.locator('option')).toHaveCount(8);
      const boxes = await Promise.all([
        modeGroup.boundingBox(),
        abControls.boundingBox(),
        songControls.boundingBox(),
        songButton.boundingBox(),
        endInput.boundingBox(),
      ]);
      const [group, ab, song, button, end] = boxes;

      expect(group).not.toBeNull();
      expect(ab).not.toBeNull();
      expect(song).not.toBeNull();
      expect(button).not.toBeNull();
      expect(end).not.toBeNull();

      // Neither control may extend beyond the mode card.
      expect(ab.x).toBeGreaterThanOrEqual(group.x - 0.5);
      expect(end.x + end.width).toBeLessThanOrEqual(ab.x + ab.width + 0.5);
      expect(end.x + end.width).toBeLessThanOrEqual(group.x + group.width + 0.5);
      expect(song.x + song.width).toBeLessThanOrEqual(group.x + group.width + 0.5);
      expect(button.x + button.width).toBeLessThanOrEqual(group.x + group.width + 0.5);

      // The two control regions must not overlap after the loop inputs open.
      const separated =
        ab.x + ab.width <= song.x + 0.5 ||
        song.x + song.width <= ab.x + 0.5 ||
        ab.y + ab.height <= song.y + 0.5 ||
        song.y + song.height <= ab.y + 0.5;
      expect(separated).toBe(true);
    });
  }

  test('Play falls back to local playback before synchronization joins', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(async () => {
      const { disconnect } = await import(new URL('js/webrtc.js', document.baseURI).href);
      disconnect();
      window.isHost = false;
    });
    await page.locator('#start-stop-btn').click();
    await expect.poll(() => page.evaluate(async () => {
      const { default: AppState } = await import(new URL('js/appState.js', document.baseURI).href);
      return AppState.isPlaying();
    })).toBe(true);
  });

  test('keeps closed timing and mode cards on one line and hides shortcuts after touch input', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto('/');
    const touchCapable = await page.evaluate(() => navigator.maxTouchPoints > 0);
    if (touchCapable) await expect(page.locator('.keyboard-shortcuts')).toBeHidden();
    else await expect(page.locator('.keyboard-shortcuts')).toBeVisible();
    const geometry = await page.evaluate(() => {
      const rect = (selector) => document.querySelector(selector).getBoundingClientRect();
      const timing = rect('.timing-controls-group');
      const mode = rect('.mode-controls-group');
      const timingChildren = [...document.querySelectorAll('.timing-controls-group > .control-group')].map((element) => element.getBoundingClientRect());
      const ab = rect('.ab-loop-controls');
      const song = rect('.song-mode-toggle-wrap');
      return {
        timingOneLine: timingChildren.every((child) => child.top >= timing.top - 1 && child.bottom <= timing.bottom + 1),
        modeOneLine: ab.right <= song.x + 1 && ab.bottom <= mode.bottom + 1 && song.bottom <= mode.bottom + 1,
      };
    });
    expect(geometry.timingOneLine).toBe(true);
    expect(geometry.modeOneLine).toBe(true);
    await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch' })));
    await expect(page.locator('.keyboard-shortcuts')).toBeHidden();
  });

  test('keeps Pixel-width timing controls separated and shows compact labels', async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 852 });
    await page.goto('/');
    const geometry = await page.evaluate(() => {
      const group = document.querySelector('.timing-controls-group');
      const children = [...group.querySelectorAll(':scope > .control-group')].map(element => {
        const rect = element.getBoundingClientRect();
        const label = element.querySelector('.control-label');
        return {
          left: rect.left,
          right: rect.right,
          labelContent: getComputedStyle(label, '::after').content,
          labelWidth: label.getBoundingClientRect().width,
          selectWidth: element.querySelector('select')?.getBoundingClientRect().width || 0,
        };
      });
      const groupRect = group.getBoundingClientRect();
      return { children, group: { left: groupRect.left, right: groupRect.right } };
    });
    expect(geometry.children).toHaveLength(3);
    for (const child of geometry.children) {
      expect(child.left).toBeGreaterThanOrEqual(geometry.group.left - 0.5);
      expect(child.right).toBeLessThanOrEqual(geometry.group.right + 0.5);
      expect(child.labelContent).not.toBe('none');
      expect(child.labelContent).not.toBe('""');
      expect(child.labelWidth).toBeGreaterThan(0);
    }
    expect(geometry.children[0].right).toBeLessThanOrEqual(geometry.children[1].left + 0.5);
    expect(geometry.children[1].right).toBeLessThanOrEqual(geometry.children[2].left + 0.5);
    expect(geometry.children[1].selectWidth).toBeGreaterThan(40);
  });

  test('uses compact timing symbols for coarse-pointer phones at wider CSS widths', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 800, height: 800 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    await page.goto('/');
    const result = await page.evaluate(() => {
      const group = document.querySelector('.timing-controls-group');
      const labels = [...group.querySelectorAll('.control-label')];
      const feedback = document.querySelector('#tap-tempo-feedback').getBoundingClientRect();
      return {
        symbols: labels.map(label => getComputedStyle(label, '::after').content),
        feedbackWidth: feedback.width,
        controls: [...group.querySelectorAll(':scope > .control-group')].map(element => element.getBoundingClientRect()),
      };
    });
    expect(result.symbols).toEqual(['"Σ"', '"÷"', '"⏱"']);
    expect(result.feedbackWidth).toBeLessThanOrEqual(1);
    expect(result.controls[0].right).toBeLessThanOrEqual(result.controls[1].left + 1);
    expect(result.controls[1].right).toBeLessThanOrEqual(result.controls[2].left + 1);
    await context.close();
  });

  test('supports validated loop ranges, TAP feedback, and keyboard shortcuts', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    await page.waitForSelector('.tap-tempo-btn');
    await page.evaluate(async () => {
      const { default: AppState } = await import(new URL('js/appState.js', document.baseURI).href);
      AppState.updateBarArray(8);
      document.dispatchEvent(new CustomEvent('barstructurechanged'));
    });
    await page.locator('#ab-start-bar').selectOption('7');
    await expect(page.locator('#ab-end-bar')).toHaveValue('7');
    await page.locator('#ab-end-bar').selectOption('3');
    await expect(page.locator('#ab-start-bar')).toHaveValue('3');

    await page.keyboard.press('l');
    await expect(page.locator('#ab-loop-toggle-btn')).toHaveClass(/active/);
    await page.keyboard.press('s');
    await expect(page.locator('#song-mode-enabled')).toHaveAttribute('aria-pressed', 'true');

    await page.locator('.tap-tempo-btn').click();
    await expect(page.locator('#tap-tempo-feedback')).toContainText('Tap');
    await page.waitForTimeout(500);
    await page.locator('.tap-tempo-btn').click();
    await expect(page.locator('#tap-tempo-feedback')).toContainText('Tempo:');
  });

  test('keeps the mobile theme menu contained and keyboard accessible', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto('/');
    await page.locator('#theme-menu-toggle').click();
    await expect(page.locator('#theme-menu')).toBeVisible();
    await expect(page.locator('#theme-menu')).toHaveAttribute('role', 'menu');
    const radii = await page.evaluate(() => ({
      menu: getComputedStyle(document.querySelector('#theme-menu')).borderRadius,
      toggle: getComputedStyle(document.querySelector('#theme-menu-toggle')).borderRadius,
      theme: getComputedStyle(document.documentElement).getPropertyValue('--BorderRadius').trim(),
    }));
    expect(radii.menu).toBe(radii.theme);
    expect(radii.toggle).toBe(radii.theme);
    await expect(page.locator('#theme-menu [role="menuitem"]')).toHaveCount(12);
    const menu = await page.locator('#theme-menu').boundingBox();
    expect(menu.x).toBeGreaterThanOrEqual(0);
    expect(menu.x + menu.width).toBeLessThanOrEqual(320);
    await expect(page.locator('#theme-menu [role="menuitem"]').first()).toBeFocused();
    await page.locator('[data-theme="synthwave"]').click();
    await expect(page.locator('#theme-menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#theme-menu')).toBeHidden();
    await expect(page.locator('#theme-menu-toggle')).toBeFocused();
  });

  test('Synthwave menus stay above track controls at iPhone SE width', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto('/');
    await page.locator('#theme-menu-toggle').click();
    await page.locator('[data-theme="synthwave"]').click();
    await expect(page.locator('#theme-menu')).toBeVisible();
    const themeGeometry = await page.evaluate(() => {
      const menu = document.querySelector('#theme-menu').getBoundingClientRect();
      const track = document.querySelector('.track').getBoundingClientRect();
      const record = document.querySelector('.track-record-btn').getBoundingClientRect();
      const remove = document.querySelector('.track-remove-btn').getBoundingClientRect();
      return { menu, track, record, remove, display: getComputedStyle(document.querySelector('.track-controls')).display };
    });
    expect(themeGeometry.menu.left).toBeGreaterThanOrEqual(0);
    expect(themeGeometry.menu.right).toBeLessThanOrEqual(320);
    expect(themeGeometry.track.right).toBeLessThanOrEqual(320.5);
    expect(themeGeometry.record.width).toBeGreaterThan(themeGeometry.remove.width);
    expect(themeGeometry.remove.right).toBeLessThanOrEqual(themeGeometry.track.right + 0.5);
    expect(themeGeometry.display).toBe('grid');
    await expect(page).toHaveScreenshot('synthwave-mobile-theme-menu.png', { animations: 'disabled' });

    await page.keyboard.press('Escape');
    await expect(page.locator('#theme-menu')).toBeHidden();
    const visualizerButton = page.locator('#visualizer-mode-btn');
    await page.evaluate(async () => {
      const button = document.querySelector('#visualizer-mode-btn');
      button.dispatchEvent(new PointerEvent('pointerdown', { button: 0, pointerId: 11, pointerType: 'touch', bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 600));
    });
    await expect(page.locator('#visualizer-mode-menu')).toBeVisible();
    const visualizerGeometry = await page.locator('#visualizer-mode-menu').boundingBox();
    expect(visualizerGeometry.x).toBeGreaterThanOrEqual(0);
    expect(visualizerGeometry.x + visualizerGeometry.width).toBeLessThanOrEqual(320);
    await expect(page).toHaveScreenshot('synthwave-mobile-visualizer-menu.png', { animations: 'disabled' });
  });

  test('theme selection assigns a visualizer mode and random theme changes it', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    await page.locator('#theme-menu-toggle').click();
    const readMode = () => page.evaluate(async () => {
      const { default: Oscilloscope } = await import(new URL('js/oscilloscope.js', document.baseURI).href);
      return Oscilloscope.mode;
    });
    await page.locator('[data-theme="synthwave"]').click();
    await expect.poll(readMode).toBe('radial');
    await page.locator('[data-theme="beach"]').click();
    await expect.poll(readMode).toBe('shore');
    await page.locator('[data-theme="pastel"]').click();
    await expect.poll(readMode).toBe('prism');
    await page.locator('#random-theme-btn').click();
    await expect.poll(readMode).toMatch(/waveform|spectrum|lissajous|radial|spiral|orbit|grid|mirror|stars|ringbar|pulse|ripple|shore|prism|aurora|reactor/);
    await expect(page.locator('#theme-menu')).toBeVisible();
  });

  test('keeps the synthwave theme palette above the oval theme control', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    await page.locator('#theme-menu-toggle').click();
    await page.locator('[data-theme="synthwave"]').click();
    await expect(page.locator('#theme-menu')).toBeVisible();
    await expect.poll(() => page.evaluate(() => ({
      themeClass: document.body.classList.contains('synthwave-theme'),
      controlsZ: Number.parseInt(getComputedStyle(document.querySelector('.theme-controls')).zIndex, 10),
      paletteZ: Number.parseInt(getComputedStyle(document.querySelector('#theme-menu')).zIndex, 10),
      paletteRadius: getComputedStyle(document.querySelector('#theme-menu'), '::before').borderTopLeftRadius,
    }))).toEqual({ themeClass: true, controlsZ: 3000, paletteZ: 3001, paletteRadius: '50%' });
  });

  test('places the synthwave desktop TAP button above the top controls', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    await page.evaluate(async () => {
      for (const registration of await navigator.serviceWorker?.getRegistrations?.() || []) {
        await registration.unregister();
      }
      for (const key of await caches?.keys?.() || []) {
        await caches.delete(key);
      }
    });
    await page.reload();
    await page.locator('#theme-menu-toggle').click();
    await page.locator('[data-theme="synthwave"]').click();
    const geometry = await page.evaluate(() => {
      const tapElement = document.querySelector('.tap-tempo-btn');
      const tap = tapElement.getBoundingClientRect();
      const controls = document.querySelector('.top-controls-area').getBoundingClientRect();
      const sync = document.querySelector('#share-btn').getBoundingClientRect();
      return {
        tap: tap.toJSON(),
        controls: controls.toJSON(),
        sync: sync.toJSON(),
        tapParent: tapElement.parentElement.className,
      };
    });
    expect(geometry.tapParent).toBe('top-controls-area');
    expect(Math.abs(geometry.tap.top - geometry.sync.top)).toBeLessThanOrEqual(1);
    expect(geometry.tap.right).toBeLessThanOrEqual(geometry.sync.left);
    expect(geometry.tap.top).toBeGreaterThanOrEqual(0);
    expect(geometry.tap.right).toBeLessThanOrEqual(1280);
  });

  test('long-pressing the visualizer mode button opens and selects all visualizers', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 600 });
    await page.goto('/');
    const button = page.locator('#visualizer-mode-btn');
    await button.hover();
    await page.mouse.down();
    await page.waitForTimeout(600);
    await page.mouse.up();
    await expect(page.locator('#visualizer-mode-menu')).toBeVisible();
    const menuVisual = await page.locator('#visualizer-mode-menu').evaluate((menu) => ({
      rect: menu.getBoundingClientRect().toJSON(),
      background: getComputedStyle(menu).backgroundColor,
      color: getComputedStyle(menu).color,
      optionBackground: getComputedStyle(menu.querySelector('[data-mode="reactor"]')).backgroundColor,
      pageBackground: getComputedStyle(document.body).backgroundColor,
      selectedOutline: getComputedStyle(menu.querySelector('[aria-current="true"]')).outlineWidth,
      selectedShadow: getComputedStyle(menu.querySelector('[aria-current="true"]')).boxShadow,
      zIndex: getComputedStyle(menu).zIndex,
    }));
    expect(menuVisual.rect.width).toBeGreaterThan(0);
    expect(menuVisual.rect.height).toBeGreaterThan(0);
    expect(menuVisual.background).not.toBe('rgba(0, 0, 0, 0)');
    expect(menuVisual.color).not.toBe('rgba(0, 0, 0, 0)');
    expect(menuVisual.optionBackground).toBe(menuVisual.pageBackground);
    expect(menuVisual.selectedOutline).toBe('3px');
    expect(menuVisual.selectedShadow).not.toBe('none');
    expect(Number(menuVisual.zIndex)).toBeGreaterThanOrEqual(1300);
    const menuGeometry = await page.locator('#visualizer-mode-menu').evaluate((menu) => ({
      parentIsBody: menu.parentElement === document.body,
      position: getComputedStyle(menu).position,
      rect: menu.getBoundingClientRect().toJSON(),
      controlsScrollHeight: document.querySelector('.top-controls-area').scrollHeight,
      controlsClientHeight: document.querySelector('.top-controls-area').clientHeight,
    }));
    expect(menuGeometry.parentIsBody).toBe(true);
    expect(menuGeometry.position).toBe('fixed');
    expect(menuGeometry.rect.height).toBeGreaterThan(0);
    expect(menuGeometry.controlsScrollHeight).toBe(menuGeometry.controlsClientHeight);
    await expect(page.locator('#visualizer-mode-menu [role="menuitem"]')).toHaveCount(16);
    await page.locator('#visualizer-mode-menu [data-mode="mirror"]').click();
    await expect(page.locator('#visualizer-mode-menu')).toBeHidden();
    await expect(page.locator('#visualizer-mode-menu [data-mode="mirror"]')).toHaveAttribute('aria-current', 'true');
    await expect.poll(() => page.evaluate(async () => {
      const { default: Oscilloscope } = await import(new URL('js/oscilloscope.js', document.baseURI).href);
      return Oscilloscope.mode;
    })).toBe('mirror');
  });

  test('touch-holding the visualizer mode button opens its menu', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto('/');
    await page.waitForSelector('#visualizer-mode-menu [data-mode="waveform"]', { state: 'attached' });
    await page.evaluate(async () => {
      const button = document.querySelector('#visualizer-mode-btn');
      button.dispatchEvent(new PointerEvent('pointerdown', { button: 0, pointerId: 11, pointerType: 'touch', bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 600));
    });
    await expect(page.locator('#visualizer-mode-menu')).toBeVisible();
    const menuBox = await page.locator('#visualizer-mode-menu').boundingBox();
    expect(menuBox.x).toBeGreaterThanOrEqual(0);
    expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(320);
    await expect(page.locator('#visualizer-mode-menu [role="menuitem"]')).toHaveCount(16);
    await page.evaluate(() => {
      const option = document.querySelector('#visualizer-mode-menu [data-mode="mirror"]');
      option.dispatchEvent(new PointerEvent('pointerenter', { pointerId: 11, pointerType: 'touch', bubbles: false }));
      option.dispatchEvent(new PointerEvent('pointerup', { button: 0, pointerId: 11, pointerType: 'touch', bubbles: true }));
    });
    await expect(page.locator('#visualizer-mode-menu')).toBeHidden();
    await expect.poll(() => page.evaluate(async () => {
      const { default: Oscilloscope } = await import(new URL('js/oscilloscope.js', document.baseURI).href);
      return Oscilloscope.mode;
    })).toBe('mirror');
  });

  test('dragging from the visualizer button selects the exact released mode', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 600 });
    await page.goto('/');
    const buttonBox = await page.locator('#visualizer-mode-btn').boundingBox();
    await page.mouse.move(buttonBox.x + buttonBox.width / 2, buttonBox.y + buttonBox.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(600);
    await expect(page.locator('#visualizer-mode-menu')).toBeVisible();
    const optionBox = await page.locator('#visualizer-mode-menu [data-mode="mirror"]').boundingBox();
    await page.mouse.move(optionBox.x + optionBox.width / 2, optionBox.y + optionBox.height / 2);
    await expect(page.locator('#visualizer-mode-menu')).toBeVisible();
    await page.mouse.up();
    await expect(page.locator('#visualizer-mode-menu')).toBeHidden();
    await expect.poll(() => page.evaluate(async () => {
      const { default: Oscilloscope } = await import(new URL('js/oscilloscope.js', document.baseURI).href);
      return Oscilloscope.mode;
    })).toBe('mirror');
  });

  test('keeps beat and bar labels visible inside the measure controls', async ({ page }) => {
    await page.setViewportSize({ width: 760, height: 300 });
    await page.goto('/');
    const result = await page.evaluate(() => {
      const container = document.querySelector('.measures-container');
      container.classList.add('showing');
      const labels = [...container.querySelectorAll('.measures-text, .bars-text')];
      const containerRect = container.getBoundingClientRect();
      return {
        overflow: getComputedStyle(container).overflow,
        labelsInside: labels.every((label) => label.getBoundingClientRect().bottom <= containerRect.bottom + 1),
      };
    });
    expect(result.overflow).toBe('visible');
    expect(result.labelsInside).toBe(true);
  });

  test('global reset leaves beat and bar adjustment controls hidden', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.measures-container')).toBeVisible();
    await page.locator('.reset-btn').first().click();
    await expect(page.locator('.measures-container').first()).toBeHidden();
    await expect.poll(async () => page.locator('.measures-container').evaluateAll((containers) => containers.every((container) => container.classList.contains('hidden')))).toBe(true);
  });

  test('Song Mode section BPM edits work while running locally', async ({ page }) => {
    await page.goto('/');
    await page.locator('#song-mode-enabled').click();
    await page.locator('[data-song-section-tempo="0"]').fill('175');
    await page.locator('[data-song-section-tempo="0"]').blur();
    await expect(page.locator('[data-song-section-tempo="0"]')).toHaveValue('175');
    await expect(page.locator('#song-now-playing')).toContainText('175 BPM');
  });

  test('clicking a bar beat indicator selects that bar before opening subdivision options', async ({ page }) => {
    await page.goto('/');
    await page.locator('.increase-bar-length').click({ clickCount: 2 });
    const indicators = page.locator('.bar-beat-indicator');
    await expect(indicators).toHaveCount(3);
    await indicators.nth(1).click();
    const selection = await page.evaluate(async () => {
      const { default: AppState } = await import(new URL('js/appState.js', document.baseURI).href);
      return {
        track: AppState.getSelectedTrackIndex(),
        bar: AppState.getSelectedBarIndexInContainer(),
        selectedBars: [...document.querySelectorAll('.bar-visual.selected')].map(bar => bar.dataset.barIndex),
      };
    });
    expect(selection.track).toBe(0);
    expect(selection.bar).toBe(1);
    expect(selection.selectedBars).toEqual(['1']);
    await expect(page.locator('.subdivision-options-container.visible').first()).toBeVisible();
    const option = page.locator('.subdivision-option').first();
    const subdivision = Number(await option.getAttribute('data-value'));
    await option.click();
    await expect.poll(() => page.evaluate(async () => {
      const { default: AppState } = await import(new URL('js/appState.js', document.baseURI).href);
      return AppState.getBarSettings(0)[1].subdivision;
    })).toBe(subdivision);
  });

  test('tapping a track name opens an editable name field and saves the new name', async ({ page }) => {
    await page.goto('/');
    await page.locator('.track-name').first().click();
    const nameInput = page.locator('.track-name-input').first();
    await expect(nameInput).toBeFocused();
    await nameInput.fill('Lead');
    await nameInput.press('Enter');
    await expect(page.locator('.track-name').first()).toHaveText('Lead');
    await expect.poll(() => page.evaluate(async () => {
      const { default: AppState } = await import(new URL('js/appState.js', document.baseURI).href);
      return AppState.getTracks()[0].name;
    })).toBe('Lead');
  });

  test('clicking the background does not change the visualizer', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 600 });
    await page.goto('/');
    await page.evaluate(async () => {
      const { default: Oscilloscope } = await import(new URL('js/oscilloscope.js', document.baseURI).href);
      Oscilloscope.setMode('mirror');
    });
    await page.mouse.click(790, 590);
    await expect.poll(() => page.evaluate(async () => {
      const { default: Oscilloscope } = await import(new URL('js/oscilloscope.js', document.baseURI).href);
      return Oscilloscope.mode;
    })).toBe('mirror');
  });

  test('long-pressing the background does not open the subdivision menu', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 600 });
    await page.goto('/');
    const modeBefore = await page.evaluate(async () => {
      const { default: Oscilloscope } = await import(new URL('js/oscilloscope.js', document.baseURI).href);
      Oscilloscope.setMode('mirror');
      return Oscilloscope.mode;
    });
    const backgroundPoint = await page.evaluate(() => {
      for (let y = 40; y < innerHeight; y += 40) {
        for (let x = 40; x < innerWidth; x += 40) {
          const element = document.elementFromPoint(x, y);
          if (!element.closest('button, a, input, select, textarea, [role="button"], .bar-visual, .beat-square, .theme-controls, .modal')) return { x, y };
        }
      }
      return null;
    });
    expect(backgroundPoint).not.toBeNull();
    await page.mouse.move(backgroundPoint.x, backgroundPoint.y);
    await page.mouse.down();
    await page.waitForTimeout(600);
    await expect(page.locator('.subdivision-options-container.visible')).toHaveCount(0);
    await page.mouse.up();
    return;
    await page.waitForTimeout(120);
    const subdivisionLayout = await page.locator('.subdivision-options-container.visible').evaluateAll((containers) => ({
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
      containers: containers.map((container) => ({
        rect: container.getBoundingClientRect().toJSON(),
        overflowY: getComputedStyle(container).overflowY,
        options: [...container.querySelectorAll('.subdivision-option')].map((option) => option.getBoundingClientRect().toJSON()),
      })),
    }));
    expect(subdivisionLayout.containers[0].rect.bottom).toBeLessThanOrEqual(subdivisionLayout.containers[1].rect.top + 1);
    for (const container of subdivisionLayout.containers) {
      expect(['visible', 'auto']).toContain(container.overflowY);
      for (const option of container.options) {
        expect(option.width).toBeGreaterThanOrEqual(76);
        expect(option.height).toBeGreaterThanOrEqual(44);
        expect(option.left).toBeGreaterThanOrEqual(0);
        expect(option.top).toBeGreaterThanOrEqual(0);
        expect(option.right).toBeLessThanOrEqual(subdivisionLayout.viewportWidth);
        expect(option.bottom).toBeLessThanOrEqual(subdivisionLayout.viewportHeight);
      }
    }
    const dragOption = page.locator('.subdivision-options-container.visible .subdivision-option').first();
    const dragBox = await dragOption.boundingBox();
    await page.mouse.move(dragBox.x + dragBox.width / 2, dragBox.y + dragBox.height / 2);
    await expect(page.locator('.subdivision-options-container.visible')).toHaveCount(2);
    await page.mouse.up();
    await expect(page.locator('.subdivision-options-container.visible')).toHaveCount(0);
    await expect.poll(() => page.evaluate(async () => {
      const { default: Oscilloscope } = await import(new URL('js/oscilloscope.js', document.baseURI).href);
      return Oscilloscope.mode;
    })).toBe(modeBefore);
  });

  test('touch-holding the background does not open the subdivision menu', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto('/');
    const result = await page.evaluate(async () => {
      const target = [...document.querySelectorAll('body *')].find((element) => {
        const rect = element.getBoundingClientRect();
        return element.id !== 'background-oscilloscope'
          && rect.width > 20 && rect.height > 20
          && !element.closest('button, a, input, select, textarea, [role="button"], .bar-visual, .beat-square, .theme-controls, .modal');
      });
      if (!target) return false;
      const rect = target.getBoundingClientRect();
      const point = { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, button: 0, pointerId: 7, pointerType: 'touch', bubbles: true };
      target.dispatchEvent(new PointerEvent('pointerdown', point));
      await new Promise((resolve) => setTimeout(resolve, 600));
      return {
        visible: document.querySelectorAll('.subdivision-options-container.visible').length === 2,
        options: [...document.querySelectorAll('.subdivision-options-container.visible .subdivision-option')].map((option) => option.getBoundingClientRect().toJSON()),
        overflow: [...document.querySelectorAll('.subdivision-options-container.visible')].map((container) => getComputedStyle(container).overflowY),
      };
    });
    expect(result.visible).toBe(false);
    expect(result.overflow.every((value) => ['visible', 'auto'].includes(value))).toBe(true);
    for (const option of result.options) {
      expect(option.width).toBeGreaterThanOrEqual(76);
      expect(option.height).toBeGreaterThanOrEqual(44);
      expect(option.left).toBeGreaterThanOrEqual(0);
      expect(option.top).toBeGreaterThanOrEqual(0);
      expect(option.right).toBeLessThanOrEqual(320);
      expect(option.bottom).toBeLessThanOrEqual(568);
    }
    await page.evaluate(() => document.dispatchEvent(new PointerEvent('pointerup', { button: 0, pointerId: 7, pointerType: 'touch', bubbles: true })));
  });

  test('sound edit modals are viewport-safe and use separate main/sub analysers', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto('/');
    const result = await page.evaluate(async () => {
      const [{ default: SoundSettingsModal }, { default: AppState }] = await Promise.all([
        import(new URL('js/soundSettingsModal.js', document.baseURI).href),
        import(new URL('js/appState.js', document.baseURI).href),
      ]);
      await SoundSettingsModal.show(0, 'mainBeatSound');
      AppState.addTrack();
      AppState.addTrack();
      AppState.addTrack();
      AppState.addTrack();
      AppState.addTrack();
      const modal = document.querySelector('#sound-settings-modal');
      const content = modal.querySelector('.modal-content');
      const canvas = modal.querySelector('.oscilloscope-canvas');
      content.scrollTop = content.scrollHeight;
      const tracks = AppState.getTracks();
      const track = tracks[0];
      const secondTrack = tracks[1];
      const thirdTrack = tracks[2];
      const lastTrack = tracks[tracks.length - 1];
      return {
        modalScrolls: modal.scrollHeight > modal.clientHeight,
        canvasHeight: canvas.getBoundingClientRect().height,
        hasPreviewButton: Boolean(modal.querySelector('#sound-preview-btn')),
        hasScopeModeSelect: Boolean(modal.querySelector('#sound-scope-mode-select')),
        hasWaveformTools: Boolean(modal.querySelector('.waveform-tools')),
        hasPlaybackControls: Boolean(modal.querySelector('.sample-playback-controls')),
        hasSoundBottomClose: Boolean(modal.querySelector('#sound-settings-bottom-close')),
        hasEffectsBottomClose: Boolean(document.querySelector('#sound-effects-bottom-close')),
        contentBottom: content.getBoundingClientRect().bottom,
        modalBottom: modal.getBoundingClientRect().bottom,
        bottomCloseBottom: modal.querySelector('#sound-settings-bottom-close')?.getBoundingClientRect().bottom,
        playbackLabel: modal.querySelector('.sample-playback-controls-title')?.textContent.trim(),
        playbackLabelRole: modal.querySelector('.sample-playback-controls-title')?.getAttribute('role'),
        hasReverseToggle: Boolean(modal.querySelector('#sample-reverse-toggle')),
        probabilityValue: Number(modal.querySelector('#sample-probability').value),
        probabilitySliderCount: modal.querySelectorAll('#sample-probability').length,
        genericProbabilitySliderCount: modal.querySelectorAll('[data-param="probability"]').length,
        highPassSliderCount: modal.querySelectorAll('[data-param="highPassFrequency"]').length,
        lowPassSliderCount: modal.querySelectorAll('[data-param="lowPassFrequency"]').length,
        probabilitySliderWidth: modal.querySelector('#sample-probability').getBoundingClientRect().width,
        probabilityControlWidth: modal.querySelector('.sample-probability-control').getBoundingClientRect().width,
        probabilityLabel: modal.querySelector('#sample-probability-value').textContent,
        probabilityBeforeOscilloscope: modal.querySelector('#sample-probability').compareDocumentPosition(canvas) & Node.DOCUMENT_POSITION_FOLLOWING,
        overlapChecked: modal.querySelector('#sample-overlap-toggle')?.checked,
        retriggerChecked: modal.querySelector('#sample-retrigger-toggle')?.checked,
        reverseChecked: modal.querySelector('#sample-reverse-toggle')?.checked,
        analysersAreSeparate: track.mainAnalyserNode && track.subdivisionAnalyserNode
          && track.mainAnalyserNode !== track.subdivisionAnalyserNode,
        secondTrackHasSeparateAnalysers: secondTrack.mainAnalyserNode && secondTrack.subdivisionAnalyserNode
          && secondTrack.mainAnalyserNode !== secondTrack.subdivisionAnalyserNode
          && secondTrack.mainAnalyserNode !== secondTrack.analyserNode,
        thirdTrackHasSeparateAnalysers: thirdTrack.mainAnalyserNode && thirdTrack.subdivisionAnalyserNode
          && thirdTrack.mainAnalyserNode !== thirdTrack.subdivisionAnalyserNode
          && thirdTrack.mainAnalyserNode !== thirdTrack.analyserNode,
        lastTrackHasSeparateAnalysers: lastTrack.mainAnalyserNode && lastTrack.subdivisionAnalyserNode
          && lastTrack.mainAnalyserNode !== lastTrack.subdivisionAnalyserNode
          && lastTrack.mainAnalyserNode !== lastTrack.analyserNode,
      };
    });
    expect(result.modalScrolls).toBe(true);
    expect(result.canvasHeight).toBeLessThanOrEqual(100);
    expect(result.hasPreviewButton).toBe(true);
    expect(result.hasScopeModeSelect).toBe(true);
    expect(result.hasPlaybackControls).toBe(true);
    expect(result.hasSoundBottomClose).toBe(true);
    expect(result.contentBottom).toBeLessThanOrEqual(result.modalBottom);
    expect(result.bottomCloseBottom).toBeLessThanOrEqual(568);
    expect(result.hasEffectsBottomClose).toBe(true);
    expect(result.hasReverseToggle).toBe(true);
    expect(result.probabilityValue).toBe(100);
    expect(result.probabilitySliderCount).toBe(1);
    expect(result.genericProbabilitySliderCount).toBe(0);
    expect(result.highPassSliderCount).toBe(1);
    expect(result.lowPassSliderCount).toBe(1);
    expect(result.probabilitySliderWidth).toBeGreaterThan(result.probabilityControlWidth - 24);
    expect(result.probabilityLabel).toBe('100%');
    expect(result.probabilityBeforeOscilloscope).toBeTruthy();
    expect(result.overlapChecked).toBe(true);
    expect(result.retriggerChecked).toBe(true);
    expect(result.reverseChecked).toBe(false);
    expect(result.analysersAreSeparate).toBe(true);
    expect(result.secondTrackHasSeparateAnalysers).toBe(true);
    expect(result.thirdTrackHasSeparateAnalysers).toBe(true);
    expect(result.lastTrackHasSeparateAnalysers).toBe(true);
  });

  test('Beat Edit opens a beat-specific sound editor and preserves its settings', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 600 });
    await page.goto('/');

    const track = page.locator('.track').first();
    const editButton = track.locator('.beat-edit-btn');
    await editButton.scrollIntoViewIfNeeded();
    const editBox = await editButton.boundingBox();
    expect(editBox).not.toBeNull();
    const editHit = await page.evaluate(({ x, y }) => {
      const element = document.elementFromPoint(x, y);
      return { tag: element?.tagName, className: element?.className };
    }, { x: editBox.x + editBox.width / 2, y: editBox.y + editBox.height / 2 });
    expect(editHit.className).toContain('beat-edit-btn');
    await page.mouse.click(editBox.x + editBox.width / 2, editBox.y + editBox.height / 2);
    await expect(track.locator('.beat-edit-btn')).toHaveAttribute('aria-pressed', 'true');
    await expect(track.locator('.beat-edit-btn')).toHaveText('Edit');
    await expect(track.locator('.rest-button')).toContainText('Rest');
    const modeButtonStyle = await track.evaluate((element) => ({
      editBackground: getComputedStyle(element.querySelector('.beat-edit-btn')).backgroundColor,
      restBackground: getComputedStyle(element.querySelector('.rest-button')).backgroundColor,
      restText: element.querySelector('.rest-button').textContent.trim(),
      accentText: element.querySelector('.accent-button').textContent.trim(),
      randomText: element.querySelector('.random-btn').textContent.trim(),
    }));
    expect(modeButtonStyle.editBackground).toBe(modeButtonStyle.restBackground);
    expect(modeButtonStyle.restText).toContain('Rest');
    expect(modeButtonStyle.accentText).toContain('Accent');
    expect(modeButtonStyle.randomText).toContain('Rand');
    const editGeometry = await track.locator('.beat-edit-btn').evaluate((button) => {
      const buttonBox = button.getBoundingClientRect();
      const trackBox = button.closest('.track').getBoundingClientRect();
      return { right: buttonBox.right, trackRight: trackBox.right, width: buttonBox.width };
    });
    expect(editGeometry.width).toBeGreaterThan(0);
    expect(editGeometry.right).toBeLessThanOrEqual(editGeometry.trackRight + 1);

    const controlOrder = await track.locator('.track-controls > button').evaluateAll((buttons) => buttons.map((button) => button.className));
    expect(controlOrder.indexOf('track-record-btn')).toBeLessThan(controlOrder.indexOf('track-mute-btn'));
    expect(controlOrder.indexOf('track-record-btn')).toBeLessThan(controlOrder.indexOf('track-solo-btn'));
    const inlineControls = await track.locator('.track-controls').evaluate((controls) => {
      const record = controls.querySelector('.track-record-btn').getBoundingClientRect();
      const mute = controls.querySelector('.track-mute-btn').getBoundingClientRect();
      const style = getComputedStyle(controls);
      return { display: style.display, sameRow: Math.abs(record.top - mute.top) < 1 };
    });
    expect(inlineControls.display).toBe('grid');
    expect(inlineControls.sameRow).toBe(true);

    const beatSquare = track.locator('.beat-square').first();
    await beatSquare.scrollIntoViewIfNeeded();
    const beatBox = await beatSquare.boundingBox();
    expect(beatBox).not.toBeNull();
    const beatHit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.className, { x: beatBox.x + beatBox.width / 2, y: beatBox.y + beatBox.height / 2 });
    expect(String(beatHit)).toContain('beat-square');
    await page.mouse.click(beatBox.x + beatBox.width / 2, beatBox.y + beatBox.height / 2);
    await expect(page.locator('#sound-settings-modal')).toBeVisible();
    await expect(page.locator('.sound-modal-context')).toContainText('Bar 1, Beat 1');

    const probability = page.locator('#sample-probability');
    await probability.fill('42');
    await page.locator('#sound-settings-modal .close-button').click();
    await expect(page.locator('#sound-settings-modal')).toBeHidden();

    await track.locator('.beat-square').first().click();
    await expect(probability).toHaveValue('42');
    await page.locator('#reset-sound-btn').click();
    await expect(probability).toHaveValue('100');
    await expect(track.locator('.beat-square').first()).not.toHaveClass(/beat-edited/);
    const resetBeatState = await page.evaluate(async () => {
      const { default: AppState } = await import(new URL('js/appState.js', document.baseURI).href);
      return AppState.getTracks()[0].barSettings[0].beatSounds || {};
    });
    expect(resetBeatState[0]).toBeUndefined();
  });

  test('fractional and quarter note beat selections open the sound that actually plays', async ({ page }) => {
    await page.goto('/');
    await page.locator('.beat-edit-btn').first().click();
    const result = await page.evaluate(async () => {
      const [{ default: AppState }, { default: BarDisplayController }] = await Promise.all([
        import(new URL('js/appState.js', document.baseURI).href),
        import(new URL('js/barDisplayController.js', document.baseURI).href),
      ]);
      const track = AppState.getTracks()[0];
      track.barSettings[0].subdivision = 1;
      BarDisplayController.renderBarsAndControls();
      const squares = document.querySelectorAll('.bar-visual[data-container-index="0"][data-bar-index="0"] .beat-square');
      const classes = [...squares].map(square => square.className);
      squares[1].click();
      return { classes, context: document.querySelector('.sound-modal-context')?.textContent || '' };
    });
    expect(result.classes[0]).toContain('main-beat-marker');
    expect(result.classes[1]).toContain('subdivision');
    expect(result.context).toContain('Subdivision Sound');
  });
  test('synth editors show a waveform and live filter cutoff feedback', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 600 });
    await page.goto('/');
    const result = await page.evaluate(async () => {
      const [{ default: SoundSettingsModal }, { default: AppState }] = await Promise.all([
        import(new URL('js/soundSettingsModal.js', document.baseURI).href),
        import(new URL('js/appState.js', document.baseURI).href),
      ]);
      AppState.updateTrack(0, { mainBeatSound: { sound: 'Synth Sine', settings: {} } });
      await SoundSettingsModal.show(0, 'mainBeatSound');
      return {
        waveform: Boolean(document.querySelector('.synth-waveform-canvas')),
        filterFeedback: Boolean(document.querySelector('.filter-feedback')),
      };
    });
    expect(result.waveform).toBe(true);
    expect(result.filterFeedback).toBe(false);
    await expect(page.locator('#sound-sliders-container [data-param="trimStart"]')).toBeVisible();
    await expect(page.locator('#sound-sliders-container [data-param="trimEnd"]')).toBeVisible();
    await expect(page.locator('#sound-sliders-container .waveform-zoom')).toBeVisible();
    const initialOverlayPositions = await page.locator('.filter-visualization-overlay').first().evaluate((overlay) => ({
      highPass: overlay.querySelector('.filter-overlay-high-pass-label').getBoundingClientRect().left,
      lowPass: overlay.querySelector('.filter-overlay-low-pass-label').getBoundingClientRect().left,
    }));
    const highPass = page.locator('#sound-sliders-container [data-param="highPassFrequency"]');
    const lowPass = page.locator('#sound-sliders-container [data-param="lowPassFrequency"]');
    await highPass.fill('300');
    await lowPass.fill('5000');
    await expect(page.locator('.filter-visualization-overlay .filter-overlay-high-pass-label').first()).toContainText('HP 300 Hz');
    await expect(page.locator('.filter-visualization-overlay .filter-overlay-low-pass-label').first()).toContainText('LP 5000 Hz');
    const updatedOverlayPositions = await page.locator('.filter-visualization-overlay').first().evaluate((overlay) => ({
      highPass: overlay.querySelector('.filter-overlay-high-pass-label').getBoundingClientRect().left,
      lowPass: overlay.querySelector('.filter-overlay-low-pass-label').getBoundingClientRect().left,
    }));
    expect(updatedOverlayPositions.highPass).not.toBe(initialOverlayPositions.highPass);
    expect(updatedOverlayPositions.lowPass).not.toBe(initialOverlayPositions.lowPass);
    const overlayState = await page.locator('.filter-visualization-overlay').evaluateAll((overlays) => overlays.map((overlay) => ({
      highPass: getComputedStyle(overlay).getPropertyValue('--filter-high-pass-position').trim(),
      lowPass: getComputedStyle(overlay).getPropertyValue('--filter-low-pass-position').trim(),
      highPassActive: overlay.classList.contains('high-pass-active'),
      lowPassActive: overlay.classList.contains('low-pass-active'),
      overlayColor: getComputedStyle(overlay).getPropertyValue('--filter-overlay-color').trim(),
      oscilloscopeColors: ['--Main', '--Accent', '--Highlight'].map((name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()),
    })));
    expect(overlayState).toHaveLength(1);
    expect(overlayState.every((state) => state.highPassActive && state.lowPassActive)).toBe(true);
    expect(overlayState.every((state) => state.highPass !== '0%' && state.lowPass !== '0%')).toBe(true);
    expect(overlayState.every((state) => !state.oscilloscopeColors.includes(state.overlayColor))).toBe(true);
  });

  test('beat visuals distinguish rests, dynamics, and individually edited beats', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 600 });
    await page.goto('/');
    const state = await page.evaluate(async () => {
      const [{ default: AppState }, { default: BarDisplayController }] = await Promise.all([
        import(new URL('js/appState.js', document.baseURI).href),
        import(new URL('js/barDisplayController.js', document.baseURI).href),
      ]);
      const bar = AppState.getTracks()[0].barSettings[0];
      bar.rests = [2];
      bar.velocities = { 0: 1, 1: 0.3, 3: 0.7 };
      bar.beatSounds = { 1: { mainBeatSound: { sound: 'Synth Snare', settings: {} } } };
      BarDisplayController.renderBarsAndControls();
      await new Promise((resolve) => setTimeout(resolve, 400));
      return [...document.querySelectorAll('.track:first-child .beat-square')].slice(0, 4).map((beat) => ({
        classes: beat.className,
        opacity: getComputedStyle(beat).opacity,
        transform: getComputedStyle(beat).transform,
        backgroundImage: getComputedStyle(beat).backgroundImage,
      }));
    });
    expect(state[0].classes).toContain('accent-note');
    expect(state[1].classes).toContain('ghost-note');
    expect(state[1].classes).toContain('beat-edited');
    expect(state[1].backgroundImage).toContain('gradient');
    expect(state[2].classes).toContain('rested');
    expect(state[2].classes).not.toContain('accent-note');
    expect(state[0].transform).not.toBe(state[1].transform);
    expect(state[0].opacity).not.toBe(state[1].opacity);
  });

  test('effects rack builds a live Web Audio chain and exposes its controls', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(async () => {
      const [{ default: AppState }, { createEffectRackInput, createSoundFilterInput, renderSynthAudioBuffer }, { default: SoundSynth }] = await Promise.all([
        import(new URL('js/appState.js', document.baseURI).href),
        import(new URL('js/audioEffects.js', document.baseURI).href),
        import(new URL('js/soundSynth.js', document.baseURI).href),
      ]);
      const audioContext = AppState.getAudioContext();
      const destination = audioContext.createGain();
      const settings = { distortion: 0.4, delayMix: 0.3, delayTime: 0.18, reverbMix: 0.5 };
      const input = createEffectRackInput(audioContext, destination, settings);
      const bypass = createSoundFilterInput(audioContext, destination, { fxBypass: true });
      async function renderEffect(effectSettings) {
        const offline = new OfflineAudioContext(1, 24000, 48000);
        const oscillator = offline.createOscillator();
        oscillator.frequency.value = 440;
        oscillator.connect(createEffectRackInput(offline, offline.destination, effectSettings));
        oscillator.start(0);
        oscillator.stop(0.5);
        const buffer = await offline.startRendering();
        const data = buffer.getChannelData(0);
        let energy = 0;
        for (let index = 4800; index < data.length; index += 1) energy += data[index] ** 2;
        return Math.sqrt(energy / (data.length - 4800));
      }
      const baselineRms = await renderEffect({});
      const delayRms = await renderEffect({ delayMix: 1, delayTime: 0.1 });
      const distortionRms = await renderEffect({ distortion: 1 });
      const reverbRms = await renderEffect({ reverbMix: 1 });
      const synthBase = await renderSynthAudioBuffer(audioContext, SoundSynth.playSine, { pitchShift: 0, volume: 1 });
      const synthPitch = await renderSynthAudioBuffer(audioContext, SoundSynth.playSine, { pitchShift: 12, volume: 1 });
      const baseData = synthBase.getChannelData(0);
      const pitchData = synthPitch.getChannelData(0);
      let pitchDifference = 0;
      for (let index = 0; index < Math.min(1000, baseData.length, pitchData.length); index += 1) pitchDifference += Math.abs(baseData[index] - pitchData[index]);
      return { inputType: input.constructor.name, bypassType: bypass.constructor.name, settings, baselineRms, delayRms, distortionRms, reverbRms, pitchDifference };
    });
    expect(result.inputType).toBe('GainNode');
    expect(result.bypassType).toBe('GainNode');
    expect(result.settings).toEqual({ distortion: 0.4, delayMix: 0.3, delayTime: 0.18, delayFeedback: 0.25, reverbMix: 0.5, reverbFeedback: 0.25, fxBypass: false });
    expect(result.delayRms).not.toBeCloseTo(result.baselineRms, 2);
    expect(result.distortionRms).not.toBeCloseTo(result.baselineRms, 2);
    expect(Math.abs(result.reverbRms - result.baselineRms)).toBeGreaterThan(0.001);
    expect(result.pitchDifference).toBeGreaterThan(0.01);

    const track = page.locator('.track').first();
    await track.locator('.beat-edit-btn').click();
    await track.locator('.beat-square').first().click();
    await expect(page.locator('#sound-effects-modal')).toBeHidden();
    await page.locator('#reset-sound-btn').click();
    await page.locator('#reset-sound-btn').click();
    await expect(page.locator('#sound-sliders-container [data-control-category]')).toHaveCount(4);
    await expect(page.locator('#sound-effects-sliders-container [data-control-category]')).toHaveCount(1);
    await page.locator('#sound-effects-btn').click();
    await expect(page.locator('#sound-effects-modal')).toBeVisible();
    await expect(page.locator('#sound-editor-actions')).toBeVisible();
    await expect(page.locator('#sound-editor-actions #reset-sound-btn')).toBeVisible();
    await expect(page.locator('[data-param="distortion"]')).toBeVisible();
    await expect(page.locator('[data-param="pitchShift"]')).toBeVisible();
    await expect(page.locator('[data-param="delayMix"]')).toBeVisible();
    await expect(page.locator('[data-param="delayTime"]')).toBeVisible();
    await expect(page.locator('[data-param="reverbMix"]')).toBeVisible();
    await expect(page.locator('#sample-fx-toggle')).toBeVisible();
    await expect(page.locator('#sample-fx-toggle')).toHaveAttribute('type', 'checkbox');
    await expect(page.locator('label:has(#sample-fx-toggle)')).toContainText('Bypass FX');
    await expect(page.locator('[data-param="pitchShift"]')).not.toHaveClass(/vertical-slider/);
    await expect(page.locator('[data-param="distortion"]')).not.toHaveClass(/vertical-slider/);
    for (const [param, value, suffix] of [['distortion', '44', '%'], ['delayMix', '23', '%'], ['delayTime', '333', 'ms'], ['reverbMix', '67', '%']]) {
      const input = page.locator(`[data-param="${param}"]`);
      await input.fill(value);
      const expectedText = suffix === 'ms' ? `${value} ms` : `${value}${suffix}`;
      await expect.poll(() => input.evaluate((element) => element.closest('.slider-container')?.querySelector(':scope > span')?.textContent)).toContain(expectedText);
    }
    const delayQuantize = page.locator('#delay-quantize-btn');
    await expect(delayQuantize).toBeVisible();
    await delayQuantize.click();
    await expect(delayQuantize).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-param="delayTime"]')).toHaveAttribute('list');
    await expect.poll(() => page.locator('[data-param="delayTime"]').evaluate((input) => document.getElementById(input.getAttribute('list'))?.options.length || 0)).toBeGreaterThan(0);
    const horizontalGeometry = await page.locator('#sound-effects-modal [data-control-category="effects"] .slider-container').evaluateAll((containers) => containers.map((container) => {
      const wrapper = container.querySelector('.slider-wrapper').getBoundingClientRect();
      const input = container.querySelector('input[type="range"]').getBoundingClientRect();
      const content = container.closest('.sound-effects-content').getBoundingClientRect();
      return { wrapper, input, content };
    }));
    for (const geometry of horizontalGeometry) {
      expect(geometry.input.width).toBeGreaterThan(80);
      expect(geometry.wrapper.right).toBeLessThanOrEqual(geometry.content.right + 0.5);
    }
    await expect(page.locator('#sound-effects-modal .sound-control-category-title')).toHaveCount(1);
    await expect(page.locator('#sound-effects-modal .sound-control-category-title')).toHaveCSS('width', '1px');
    await page.locator('#sound-effects-close').click();
    await expect(page.locator('#sound-effects-modal')).toBeHidden();
    await expect(page.locator('[data-control-category="synth"] h3')).toHaveText('Synth envelope');
    await expect(page.locator('[data-control-category="filters"] h3')).toHaveText('Filters');
    await expect(page.locator('[data-control-category="effects"] h3')).toHaveText('Effects rack');
  });

  test('limits pitch and filter ranges and orders filters before trim controls', async ({ page }) => {
    await page.goto('/');
    await page.locator('.main-sound-label').first().click();
    await expect(page.locator('[data-param="pitchShift"]')).toHaveAttribute('min', '-24');
    await expect(page.locator('[data-param="pitchShift"]')).toHaveAttribute('max', '24');
    await expect(page.locator('[data-param="highPassFrequency"]')).toHaveAttribute('max', '8000');
    await expect(page.locator('[data-param="lowPassFrequency"]')).toHaveAttribute('max', '20000');
    await expect(page.locator('[data-param="trimStart"]')).toBeVisible();
    await expect.poll(() => page.evaluate(() => {
      const container = document.querySelector('#sound-sliders-container');
      const categories = [...container.querySelectorAll(':scope > .sound-control-category')];
      return {
        waveform: container.querySelector(':scope > .filter-visualization-stage, :scope > .waveform-container')?.getBoundingClientRect().bottom,
        filters: categories.findIndex((category) => category.dataset.controlCategory === 'filters'),
        playback: categories.findIndex((category) => category.dataset.controlCategory === 'playback'),
      };
    })).toMatchObject({ filters: 0 });
    await expect.poll(() => page.evaluate(() => {
      const categories = [...document.querySelectorAll('#sound-sliders-container > .sound-control-category')];
      return categories.findIndex((category) => category.dataset.controlCategory === 'filters') < categories.findIndex((category) => category.dataset.controlCategory === 'playback');
    })).toBe(true);
  });

  test('puts Delay Quantize beside Note Snap and switches to note-value labels', async ({ page }) => {
    await page.goto('/');
    await page.locator('.main-sound-label').first().click();
    await expect(page.locator('#delay-quantize-btn')).toBeHidden();
    await expect(page.locator('#quantize-btn')).toBeHidden();
    await expect(page.locator('#grid-snap-btn')).toBeHidden();
    await page.locator('#sound-effects-btn').click();
    const delayQuantize = page.locator('#delay-quantize-btn');
    await expect(delayQuantize).toBeVisible();
    await expect(page.locator('#sound-effects-actions-slot #note-snap-btn')).toHaveCount(0);
    await expect(page.locator('#sound-effects-actions-slot #grid-snap-btn')).toHaveCount(0);
    await expect(page.locator('#sound-effects-actions-slot #quantize-btn')).toHaveCount(0);
    await expect(page.locator('#sound-editor-actions #note-snap-btn')).toHaveCount(1);
    await expect(page.locator('#sound-editor-actions #grid-snap-btn')).toHaveCount(1);
    await expect(page.locator('#sound-editor-actions #quantize-btn')).toHaveCount(1);
    await delayQuantize.click();
    await expect(delayQuantize).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-param="delayTime"]').locator('xpath=ancestor::div[contains(@class,"slider-container")]/span')).toContainText(/note/);
    const delaySlider = page.locator('[data-param="delayTime"]');
    const delayOptions = await delaySlider.locator('xpath=ancestor::div[contains(@class,"slider-container")]').locator('datalist option').evaluateAll((options) => options.map((option) => option.label));
    expect(delayOptions).toEqual(expect.arrayContaining(['1/2 note', '1/4 note', '1/4 dotted note', '1/8 note', '1/8 dotted note', '1/16 note', '1/16 dotted note', '1/32 note', '1/32 dotted note', '1/64 note']));
    const delayIncrement = delaySlider.locator('xpath=ancestor::div[contains(@class,"slider-container")]').locator('.slider-button-increment');
    const beforeIncrement = Number(await delaySlider.inputValue());
    await delayIncrement.click();
    expect(Number(await delaySlider.inputValue())).toBeGreaterThan(beforeIncrement);
    const delayDecrement = delaySlider.locator('xpath=ancestor::div[contains(@class,"slider-container")]').locator('.slider-button-decrement');
    await delayDecrement.click();
    expect(Number(await delaySlider.inputValue())).toBe(beforeIncrement);
  });

  test('synth trim controls clamp without hanging when handles cross', async ({ page }) => {
    await page.goto('/');
    await page.locator('.main-sound-label').first().click();
    const start = page.locator('[data-param="trimStart"]');
    const end = page.locator('[data-param="trimEnd"]');
    await expect(start).toBeVisible();
    await start.fill(await start.getAttribute('max'));
    await expect.poll(() => end.inputValue()).toBe(await start.inputValue());
    await end.fill(await end.getAttribute('min'));
    await expect.poll(() => start.inputValue()).toBe(await end.inputValue());
  });

  test('synth waveform visibly updates its trim boundaries', async ({ page }) => {
    await page.goto('/');
    await page.locator('.main-sound-label').first().click();
    const canvas = page.locator('.synth-waveform-canvas');
    const before = await canvas.evaluate((element) => element.toDataURL());
    const start = page.locator('[data-param="trimStart"]');
    await start.fill(String(Math.round(Number(await start.getAttribute('max')) * 0.35)));
    await expect.poll(() => canvas.evaluate((element) => element.toDataURL())).not.toBe(before);
  });

  test('every generated sound slider updates its adjacent value label', async ({ page }) => {
    await page.goto('/');
    await page.locator('.main-sound-label').first().click();
    const sliders = page.locator('#sound-settings-modal input[type="range"][data-param]');
    const params = await sliders.evaluateAll((inputs) => inputs.map((input) => input.dataset.param));
    expect(params.length).toBeGreaterThan(8);

    for (const param of params) {
      const input = page.locator(`#sound-settings-modal [data-param="${param}"]`);
      const min = Number(await input.getAttribute('min'));
      const max = Number(await input.getAttribute('max'));
      const value = String(Math.round((min + max) / 2));
      await input.fill(value);
      const label = input.locator('xpath=ancestor::div[contains(@class,"slider-container")]/span');
      await expect(label).not.toHaveText('');
      if (param === 'pitchShift') await expect(label).toContainText('semitones');
      else if (param.toLowerCase().includes('frequency')) await expect(label).toContainText('Hz');
      else if (['distortion', 'delayMix', 'reverbMix'].includes(param)) await expect(label).toContainText('%');
      else if (['attack', 'decay', 'sustain', 'release', 'pitchEnvelopeTime', 'trimStart', 'trimEnd', 'delayTime'].includes(param)) await expect(label).toContainText('ms');
    }
  });

  test('effects modal stays readable and contained at iPhone SE width', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto('/');
    await page.locator('.main-sound-label').click();
    await page.locator('#sound-effects-btn').click();
    const geometry = await page.locator('#sound-effects-modal').evaluate((modal) => {
      const content = modal.querySelector('.sound-effects-content').getBoundingClientRect();
      const vertical = [...modal.querySelectorAll('.vertical-slider-container')].map((container) => {
        const label = container.querySelector('label').getBoundingClientRect();
        const wrapper = container.querySelector('.slider-wrapper').getBoundingClientRect();
        const value = container.querySelector(':scope > span').getBoundingClientRect();
        return { label, wrapper, value };
      });
      const horizontal = [...modal.querySelectorAll('[data-param="delayMix"], [data-param="delayTime"], [data-param="reverbMix"]')]
        .map((input) => input.closest('.slider-container').getBoundingClientRect());
      return { content, vertical, horizontal, scrollable: content.height < content.scrollHeight };
    });
    expect(geometry.content.left).toBeGreaterThanOrEqual(0);
    expect(geometry.content.right).toBeLessThanOrEqual(320);
    expect(geometry.content.bottom).toBeLessThanOrEqual(568 + 0.5);
    expect(geometry.content.height <= 568 || geometry.scrollable).toBe(true);
    for (const control of geometry.vertical) {
      expect(control.label.bottom).toBeLessThanOrEqual(control.wrapper.top + 0.5);
      expect(control.wrapper.bottom).toBeLessThanOrEqual(control.value.top + 0.5);
      expect(control.value.right).toBeLessThanOrEqual(geometry.content.right + 0.5);
    }
    for (const row of geometry.horizontal) {
      expect(row.left).toBeGreaterThanOrEqual(geometry.content.left - 0.5);
      expect(row.right).toBeLessThanOrEqual(geometry.content.right + 0.5);
    }
  });

  test('sound modal traps keyboard focus and restores the opener', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 600 });
    await page.goto('/');
    const result = await page.evaluate(async () => {
      const [{ default: SoundSettingsModal }] = await Promise.all([
        import(new URL('js/soundSettingsModal.js', document.baseURI).href),
      ]);
      const opener = document.querySelector('#theme-menu-toggle');
      opener.focus();
      await SoundSettingsModal.show(0, 'mainBeatSound');
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const modal = document.querySelector('#sound-settings-modal');
      const focusedInside = modal.contains(document.activeElement);
      const first = [...modal.querySelectorAll('button, select, input, [tabindex]:not([tabindex="-1"])')]
        .find((element) => !element.disabled && element.offsetParent !== null);
      first.focus();
      modal.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
      SoundSettingsModal.hide();
      await new Promise((resolve) => requestAnimationFrame(resolve));
      return {
        dialog: modal.getAttribute('role'),
        ariaModal: modal.getAttribute('aria-modal'),
        focusedInside,
        restoredFocus: document.activeElement === opener,
      };
    });
    expect(result).toEqual({ dialog: 'dialog', ariaModal: 'true', focusedInside: true, restoredFocus: true });
  });

  test('sound editor stays above themed containers without oval clipping', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(async () => {
      document.querySelector('#theme-menu-toggle')?.click();
      document.querySelector('[data-theme="synthwave"]')?.click();
      const [{ default: SoundSettingsModal }] = await Promise.all([
        import(new URL('js/soundSettingsModal.js', document.baseURI).href),
      ]);
      await SoundSettingsModal.show(0, 'mainBeatSound');
      const modal = document.querySelector('#sound-settings-modal');
      const content = modal.querySelector('.modal-content');
      const modalStyle = getComputedStyle(modal);
      const contentStyle = getComputedStyle(content);
      return {
        modalZIndex: Number(modalStyle.zIndex),
        contentZIndex: Number(contentStyle.zIndex) || 0,
        contentRadius: contentStyle.borderRadius,
        themeRadius: getComputedStyle(document.documentElement).getPropertyValue('--BorderRadius').trim(),
        contentOverflowX: contentStyle.overflowX,
        contentOverflowY: contentStyle.overflowY,
      };
    });
    expect(result.modalZIndex).toBeGreaterThanOrEqual(3000);
    expect(result.contentZIndex).toBeGreaterThanOrEqual(0);
    expect(result.contentRadius).toBe(result.themeRadius);
    expect(result.contentOverflowX).toBe('auto');
    expect(result.contentOverflowY).toBe('auto');
  });

  test('sound preview and recorded waveform controls are available', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(async () => {
      const [{ default: SoundSettingsModal }, { default: AppState }] = await Promise.all([
        import(new URL('js/soundSettingsModal.js', document.baseURI).href),
        import(new URL('js/appState.js', document.baseURI).href),
      ]);
      await SoundSettingsModal.show(0, 'mainBeatSound');
      const preview = document.querySelector('#sound-preview-btn');
      await SoundSettingsModal.togglePreview();
      const previewActive = preview.getAttribute('aria-pressed') === 'true';
      const previewLabel = preview.textContent.trim();
      SoundSettingsModal.stopPreview();
      const track = AppState.getTracks()[0];
      track.mainBeatSound.sound = 'Click1.mp3';
      await SoundSettingsModal.show(0, 'mainBeatSound');
      SoundSettingsModal.updateSoundSetting('pitchShift', 12);
      document.querySelector('#sample-reverse-toggle').click();
      await SoundSettingsModal.togglePreview();
      const previewReverse = SoundSettingsModal.previewSource?.buffer !== AppState.getSoundBuffer('Click1.mp3');
      const previewPitch = SoundSettingsModal.previewSource?.playbackRate?.value;
      SoundSettingsModal.stopPreview();
      const zoom = document.querySelector('.waveform-zoom');
      const pan = document.querySelector('.waveform-pan');
      zoom.value = '2.5';
      pan.value = '0.4';
      zoom.dispatchEvent(new Event('input', { bubbles: true }));
      pan.dispatchEvent(new Event('input', { bubbles: true }));
      return {
        previewActive,
        previewLabel,
        previewStopped: preview.getAttribute('aria-pressed') === 'false',
        previewReverse,
        previewPitch,
        waveformTools: Boolean(document.querySelector('.waveform-tools')),
        zoomControl: Boolean(document.querySelector('.waveform-zoom')),
        panControl: Boolean(document.querySelector('.waveform-pan')),
        zoomLabel: document.querySelector('.waveform-zoom-value')?.textContent,
        panLabel: document.querySelector('.waveform-pan-value')?.textContent,
      };
    });
    expect(result).toEqual({ previewActive: true, previewLabel: 'Stop', previewStopped: true, previewReverse: true, previewPitch: 2, waveformTools: true, zoomControl: true, panControl: true, zoomLabel: '2.5×', panLabel: '40%' });
  });

  test('sample overlap and retrigger settings persist when the modal reopens', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(async () => {
      const [{ default: SoundSettingsModal }, { default: AppState }] = await Promise.all([
        import(new URL('js/soundSettingsModal.js', document.baseURI).href),
        import(new URL('js/appState.js', document.baseURI).href),
      ]);
      await SoundSettingsModal.show(0, 'mainBeatSound');
      const modal = document.querySelector('#sound-settings-modal');
      const overlap = modal.querySelector('#sample-overlap-toggle');
      const retrigger = modal.querySelector('#sample-retrigger-toggle');
      const reverse = modal.querySelector('#sample-reverse-toggle');
      const probability = modal.querySelector('#sample-probability');
      overlap.click();
      retrigger.click();
      reverse.click();
      probability.value = '35';
      probability.dispatchEvent(new Event('input', { bubbles: true }));
      SoundSettingsModal.hide();
      await SoundSettingsModal.show(0, 'mainBeatSound');
      return {
        overlap: modal.querySelector('#sample-overlap-toggle').checked,
        retrigger: modal.querySelector('#sample-retrigger-toggle').checked,
        reverse: modal.querySelector('#sample-reverse-toggle').checked,
        probability: Number(modal.querySelector('#sample-probability').value),
        savedOverlap: AppState.getTracks()[0].mainBeatSound.settings.allowOverlap,
        savedRetrigger: AppState.getTracks()[0].mainBeatSound.settings.retrigger,
        savedReverse: AppState.getTracks()[0].mainBeatSound.settings.reverse,
        savedProbability: AppState.getTracks()[0].mainBeatSound.settings.probability,
      };
    });
    expect(result).toEqual({ overlap: false, retrigger: false, reverse: true, probability: 35, savedOverlap: false, savedRetrigger: false, savedReverse: true, savedProbability: 35 });
  });

  test('Reset restores complete sound settings without appearing in the FX modal', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(async () => {
      const [{ default: SoundSettingsModal }, { default: AppState }] = await Promise.all([
        import(new URL('js/soundSettingsModal.js', document.baseURI).href),
        import(new URL('js/appState.js', document.baseURI).href),
      ]);
      const track = AppState.getTracks()[0];
      track.mainBeatSound.sound = 'Click1.mp3';
      track.mainBeatSound.settings = {
        volume: 0.2,
        pitchShift: 12,
        trimStart: 0.1,
        trimEnd: 0.2,
        probability: 35,
        allowOverlap: false,
        retrigger: false,
        reverse: true,
        highPassFrequency: 4000,
        lowPassFrequency: 9000,
        distortion: 0.6,
        delayMix: 0.5,
        delayTime: 0.2,
        reverbMix: 0.4,
      };
      await SoundSettingsModal.show(0, 'mainBeatSound');
      document.querySelector('#sound-effects-btn').click();
      const fxHasReset = Boolean(document.querySelector('#sound-effects-modal #reset-sound-btn'));
      document.querySelector('#sound-effects-close').click();
      document.querySelector('#reset-sound-btn').click();
      const settings = AppState.getTracks()[0].mainBeatSound.settings;
      return {
        fxHasReset,
        volume: settings.volume,
        pitchShift: settings.pitchShift,
        trimStart: settings.trimStart,
        probability: settings.probability,
        allowOverlap: settings.allowOverlap,
        retrigger: settings.retrigger,
        reverse: settings.reverse,
        highPassFrequency: settings.highPassFrequency,
        lowPassFrequency: settings.lowPassFrequency,
        distortion: settings.distortion,
        delayMix: settings.delayMix,
        reverbMix: settings.reverbMix,
      };
    });
    expect(result.fxHasReset).toBe(false);
    expect(result).toMatchObject({ volume: 1, pitchShift: 0, trimStart: 0, probability: 100, allowOverlap: true, retrigger: true, reverse: false, highPassFrequency: 20, lowPassFrequency: 20000, distortion: 0, delayMix: 0, reverbMix: 0 });
  });


  test('desktop track grid fits four controllers and beats never overlap', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    for (let i = 0; i < 7; i += 1) await page.getByRole('button', { name: 'Add track' }).click();
    const result = await page.evaluate(async () => {
      await new Promise(requestAnimationFrame);
      const tracks = [...document.querySelectorAll('#all-tracks-wrapper .track')];
      const columns = new Set(tracks.map(track => Math.round(track.getBoundingClientRect().left)));
      const rows = new Set(tracks.map(track => Math.round(track.getBoundingClientRect().top)));
      const controlHeights = tracks.map(track => track.querySelector('.track-controls').getBoundingClientRect().height);
      const volumeHeights = tracks.map(track => track.querySelector('.track-volume-controls').getBoundingClientRect().height);
      const squares = [...document.querySelectorAll('.bar-visual[data-bar-index="0"] .beat-square')].map(square => square.getBoundingClientRect());
      const overlaps = squares.some((a, i) => squares.slice(i + 1).some(b => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom));
      return { trackCount: tracks.length, columns: columns.size, rows: rows.size, widths: tracks.map(track => track.getBoundingClientRect().width), controlHeights, volumeHeights, overlaps };
    });
    expect(result.trackCount).toBe(8);
    expect(result.columns).toBe(4);
    expect(result.rows).toBe(2);
    expect(new Set(result.controlHeights.map(height => Math.round(height))).size).toBe(1);
    expect(new Set(result.volumeHeights.map(height => Math.round(height))).size).toBe(1);
    expect(result.volumeHeights[0]).toBeLessThanOrEqual(30);
    expect(Math.min(...result.widths)).toBeGreaterThan(250);
    expect(result.overlaps).toBe(false);
  });

  test('bars and beats stay centered and contained at desktop and mobile widths', async ({ page }) => {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 320, height: 568 }]) {
      await page.setViewportSize(viewport);
      await page.goto('/');
      const result = await page.evaluate(() => {
        const tracks = [...document.querySelectorAll('#all-tracks-wrapper .track')];
        const bars = tracks.flatMap(track => [...track.querySelectorAll('.bar-visual')].map(bar => ({
          track: track.getBoundingClientRect(),
          bar: bar.getBoundingClientRect(),
          beats: [...bar.querySelectorAll('.beat-square')].map(beat => beat.getBoundingClientRect()),
        })));
        const contained = bars.every(({ track, bar, beats }) =>
          bar.left >= track.left - 0.5 && bar.right <= track.right + 0.5 &&
          Math.abs((bar.left + bar.width / 2) - (track.left + track.width / 2)) <= 0.5 &&
          beats.every(beat => beat.left >= bar.left - 0.5 && beat.right <= bar.right + 0.5 && beat.top >= bar.top - 0.5 && beat.bottom <= bar.bottom + 0.5)
        );
        return { contained, barCount: bars.length };
      });
      expect(result.barCount).toBeGreaterThan(0);
      expect(result.contained).toBe(true);
    }
  });

  test('triplet and other non-four subdivisions use contained flex bars', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto('/');
    const result = await page.evaluate(async () => {
      const [{ default: AppState }, { default: BarDisplayController }] = await Promise.all([
        import(new URL('js/appState.js', document.baseURI).href),
        import(new URL('js/barDisplayController.js', document.baseURI).href),
      ]);
      const bar = AppState.getTracks()[0].barSettings[0];
      const values = [3, 5, 6, 7];
      const checks = [];
      for (const subdivision of values) {
        bar.subdivision = subdivision;
        BarDisplayController.updateBar(0, 0);
        await new Promise(requestAnimationFrame);
        const element = document.querySelector('.bar-visual[data-bar-index="0"]');
        const barRect = element.getBoundingClientRect();
        const trackRect = element.closest('.track').getBoundingClientRect();
        checks.push({ subdivision, display: getComputedStyle(element).display, flex: element.classList.contains('flex-subdivision'), contained: barRect.left >= trackRect.left - .5 && barRect.right <= trackRect.right + .5 });
      }
      return checks;
    });
    for (const check of result) {
      expect(check.display).toBe('flex');
      expect(check.flex).toBe(true);
      expect(check.contained).toBe(true);
    }
  });

  test('desktop Song Mode track changes use a blurred right-to-left whip transition', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(() => {
      const wrapper = document.querySelector('#all-tracks-wrapper');
      wrapper.innerHTML = '<div class="track"></div>';
      document.dispatchEvent(new CustomEvent('songtracksectionchange', { detail: { sectionIndex: 1, trackCount: 2 } }));
      const outgoing = wrapper.className;
      return new Promise(resolve => setTimeout(() => resolve({
        outgoing,
        incoming: wrapper.className,
        animation: getComputedStyle(wrapper).animationName,
      }), 100));
    });
    expect(result.outgoing).toContain('song-whip-out');
    expect(result.incoming).toContain('song-whip-in');
    expect(result.animation).toBe('song-track-whip-in');
  });
  test('FX reset restores effect controls without changing sound-editor settings', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(async () => {
      const [{ default: SoundSettingsModal }, { default: AppState }] = await Promise.all([
        import(new URL('js/soundSettingsModal.js', document.baseURI).href),
        import(new URL('js/appState.js', document.baseURI).href),
      ]);
      const track = AppState.getTracks()[0];
      track.mainBeatSound.sound = 'Synth Sine';
      track.mainBeatSound.settings = {
        ...(AppState.getDefaultSoundSettings('Synth Sine') || {}),
        pitchShift: 7,
        distortion: 0.4,
        delayMix: 0.6,
        delayTime: 0.2,
        delayFeedback: 0.7,
        reverbMix: 0.5,
        reverbFeedback: 0.9,
      };
      await SoundSettingsModal.show(0, 'mainBeatSound');
      document.querySelector('#sound-effects-btn').click();
      const controls = {
        delayFeedback: Boolean(document.querySelector('#sound-effects-modal [data-param="delayFeedback"]')),
        reverbFeedback: Boolean(document.querySelector('#sound-effects-modal [data-param="reverbFeedback"]')),
        reset: Boolean(document.querySelector('#effects-reset-btn')),
      };
      document.querySelector('#effects-reset-btn').click();
      const settings = AppState.getTracks()[0].mainBeatSound.settings;
      return { controls, pitchShift: settings.pitchShift, distortion: settings.distortion, delayMix: settings.delayMix, delayFeedback: settings.delayFeedback, reverbMix: settings.reverbMix, reverbFeedback: settings.reverbFeedback };
    });
    expect(result.controls).toEqual({ delayFeedback: true, reverbFeedback: true, reset: true });
    expect(result.pitchShift).toBe(7);
    expect(result.distortion).toBe(0);
    expect(result.delayMix).toBe(0);
    expect(result.delayFeedback).toBe(0.25);
    expect(result.reverbMix).toBe(0);
    expect(result.reverbFeedback).toBe(0.25);
  });

  test('desktop Song Mode whips even when the section keeps the same track count', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(() => {
      const wrapper = document.querySelector('#all-tracks-wrapper');
      wrapper.innerHTML = '<div class="track"></div>';
      document.dispatchEvent(new CustomEvent('songtracksectionchange', { detail: { sectionIndex: 1, trackCount: 1 } }));
      return { outgoing: wrapper.className, animation: getComputedStyle(wrapper).animationName };
    });
    expect(result.outgoing).toContain('song-whip-out');
    expect(result.animation).toBe('song-track-whip-out');
  });
  test('reverse transforms synthesized preview envelopes', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(async () => {
      const [{ default: SoundSettingsModal }, { default: SoundSynth }, { default: AppState }, { renderSynthAudioBuffer }] = await Promise.all([
        import(new URL('js/soundSettingsModal.js', document.baseURI).href),
        import(new URL('js/soundSynth.js', document.baseURI).href),
        import(new URL('js/appState.js', document.baseURI).href),
        import(new URL('js/audioEffects.js', document.baseURI).href),
      ]);
      const track = AppState.getTracks()[0];
      track.mainBeatSound.sound = 'Synth Kick';
      track.mainBeatSound.settings = {
        reverse: true,
        attack: 0.01,
        release: 0.2,
        startFrequency: 200,
        endFrequency: 50,
        volume: 1,
      };
      const rendered = await renderSynthAudioBuffer(AppState.getAudioContext(), SoundSynth.playKick, track.mainBeatSound.settings);
      await SoundSettingsModal.show(0, 'mainBeatSound');
      await SoundSettingsModal.togglePreview();
      const reversed = SoundSettingsModal.previewSource?.buffer !== rendered;
      SoundSettingsModal.stopPreview();
      return { reversed, hasAudio: Boolean(SoundSettingsModal.previewSource?.buffer || rendered) };
    });
    expect(result).toEqual({ reversed: true, hasAudio: true });
  });

  test('probability gate honors boundaries and deterministic random rolls', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(async () => {
      const { default: MetronomeEngine } = await import(new URL('js/metronomeEngine.js', document.baseURI).href);
      return {
        zero: MetronomeEngine.shouldPlayProbability(0, 0),
        full: MetronomeEngine.shouldPlayProbability(100, 0.999),
        accepted: MetronomeEngine.shouldPlayProbability(35, 0.34),
        rejected: MetronomeEngine.shouldPlayProbability(35, 0.35),
      };
    });
    expect(result).toEqual({ zero: false, full: true, accepted: true, rejected: false });
  });


  test('audio injected into one track scope stays out of other analysers', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(async () => {
      const [{ default: AppState }] = await Promise.all([
        import(new URL('js/appState.js', document.baseURI).href),
      ]);
      AppState.addTrack();
      AppState.createTrackAnalysers();
      const tracks = AppState.getTracks();
      const context = AppState.getAudioContext();
      if (context.state === 'suspended') await context.resume();
      const readEnergy = (analyser) => {
        const data = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(data);
        return data.reduce((sum, value) => sum + value, 0);
      };
      const beforeMain = readEnergy(tracks[0].mainAnalyserNode);
      const beforeSubdivision = readEnergy(tracks[0].subdivisionAnalyserNode);
      const beforeOther = readEnergy(tracks[1].mainAnalyserNode);
      const oscillator = context.createOscillator();
      oscillator.frequency.value = 440;
      oscillator.connect(tracks[0].mainAnalyserNode);
      oscillator.start();
      await new Promise((resolve) => setTimeout(resolve, 80));
      const afterMain = readEnergy(tracks[0].mainAnalyserNode);
      const afterSubdivision = readEnergy(tracks[0].subdivisionAnalyserNode);
      const afterOther = readEnergy(tracks[1].mainAnalyserNode);
      oscillator.stop();
      oscillator.disconnect();
      return {
        selectedMainIncreased: afterMain > beforeMain,
        selectedSubdivisionQuiet: afterSubdivision <= beforeSubdivision,
        otherTrackQuiet: afterOther <= beforeOther,
      };
    });
    expect(result).toEqual({ selectedMainIncreased: true, selectedSubdivisionQuiet: true, otherTrackQuiet: true });
  });

  test('recording playback honors overlap and retrigger settings', async ({ page }) => {
    await page.goto('/');
    await page.locator('.main-beat-sound-select').click();
    await page.locator('.sound-picker-card[data-sound="Click1.mp3"] .sound-picker-select').click();
    const result = await page.evaluate(async () => {
      const [{ default: AudioController }, { default: AppState }] = await Promise.all([
        import(new URL('js/audioController.js', document.baseURI).href),
        import(new URL('js/appState.js', document.baseURI).href),
      ]);
      const context = AppState.getAudioContext();
      const buffer = AppState.getSoundBuffer('Click1.mp3');
      if (!context || !buffer) return { supported: false };
      const destination = AppState.getTracks()[0].mainAnalyserNode;
      const key = 'test-overlap-retrigger';
      AudioController.playRecording('Click1.mp3', { allowOverlap: false, retrigger: false, voiceKey: key }, 0, .05, context.currentTime, 1, destination);
      const first = AudioController.activeRecordingSources.get(key);
      AudioController.playRecording('Click1.mp3', { allowOverlap: false, retrigger: false, voiceKey: key }, 0, .05, context.currentTime, 1, destination);
      const ignored = AudioController.activeRecordingSources.get(key) === first;
      AudioController.playRecording('Click1.mp3', { allowOverlap: false, retrigger: true, voiceKey: key }, 0, .05, context.currentTime, 1, destination);
      const restarted = AudioController.activeRecordingSources.get(key) !== first;
      const reverseKey = 'test-reverse';
      AudioController.playRecording('Click1.mp3', { reverse: true, voiceKey: reverseKey }, 0, .05, context.currentTime, 1, destination);
      const reverseSource = AudioController.activeRecordingSources.get(reverseKey);
      return { supported: true, ignored, restarted, reversePlayback: reverseSource?.buffer !== buffer };
    });
    expect(result).toEqual({ supported: true, ignored: true, restarted: true, reversePlayback: true });
  });

  test('shorebreak uses active theme colors', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(async () => {
      const { default: Oscilloscope } = await import(new URL('js/oscilloscope.js', document.baseURI).href);
      document.documentElement.style.setProperty('--Main', '#123456');
      document.documentElement.style.setProperty('--Accent', '#abcdef');
      document.documentElement.style.setProperty('--Highlight', '#654321');
      const fills = [];
      const gradients = [];
      const ctx = {
        canvas: { width: 320, height: 160 },
        createLinearGradient: () => { const gradient = { stops: [], addColorStop(position, color) { this.stops.push({ position, color }); } }; gradients.push(gradient); return gradient; },
        beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, fill() {}, fillRect() {}, stroke() {},
        set fillStyle(value) { fills.push(value); }, get fillStyle() { return fills[fills.length - 1]; },
      };
      const analyser = { frequencyBinCount: 8, getByteFrequencyData(data) { data.fill(100); } };
      Oscilloscope.bandEnergy = { low: .2, mid: .2, high: .2 };
      Oscilloscope.drawShore(ctx, analyser, '#ffffff');
      return { usesThemeMain: fills.some((fill) => String(fill).includes('18, 52, 86')), usesThemeGradient: gradients[0]?.stops.some((stop) => stop.color.includes('171, 205, 239')) };
    });
    expect(result).toEqual({ usesThemeMain: true, usesThemeGradient: true });
  });

  test('recorded sound editor controls remain styled and contained on iPhone SE', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto('/');
    await page.locator('.main-beat-sound-select').click();
    await page.locator('.sound-picker-card[data-sound="Click1.mp3"] .sound-picker-select').click();
    await page.locator('.main-sound-label').click();
    await expect(page.locator('.waveform-tools')).toBeVisible();
    const layout = await page.evaluate(() => {
      const modal = document.querySelector('#sound-settings-modal');
      const tools = modal.querySelector('.waveform-tools');
      const labels = [...tools.querySelectorAll('label')];
      const ranges = [...tools.querySelectorAll('input[type="range"]')];
      const filterRanges = [...modal.querySelectorAll('[data-param="highPassFrequency"], [data-param="lowPassFrequency"]')];
      const filterLabels = [...modal.querySelectorAll('.filter-slider-container label')];
      const sliderWrappers = [...modal.querySelectorAll('#sound-sliders-container .slider-wrapper')].map((element) => element.getBoundingClientRect().width);
      const header = modal.querySelector('.modal-header');
      const stacked = [
        modal.querySelector('.sample-playback-controls'),
        modal.querySelector('.oscilloscope-canvas'),
        modal.querySelector('.waveform-canvas'),
        tools,
      ].map((element) => element?.getBoundingClientRect()).filter((rect) => rect && rect.height > 0);
      const viewportWidth = document.documentElement.clientWidth;
      return {
        pageOverflow: document.documentElement.scrollWidth - viewportWidth,
        toolsWidth: tools.getBoundingClientRect().width,
        contentWidth: modal.querySelector('.modal-content').getBoundingClientRect().width,
        labelsInside: labels.every((label) => label.getBoundingClientRect().right <= tools.getBoundingClientRect().right + 1),
        rangesUsable: ranges.every((range) => range.getBoundingClientRect().width >= 80),
        filtersInside: filterRanges.every((range) => range.getBoundingClientRect().right <= modal.querySelector('.modal-content').getBoundingClientRect().right + 1),
        filterLabelsInside: filterLabels.every((label) => label.getBoundingClientRect().right <= modal.querySelector('.modal-content').getBoundingClientRect().right + 1),
        sliderWidthsMatch: sliderWrappers.every((width) => Math.abs(width - sliderWrappers[0]) < 0.5),
        headerInside: header.getBoundingClientRect().right <= viewportWidth + 1,
        stackedWithoutOverlap: stacked.every((rect, index) => index === 0 || rect.top >= stacked[index - 1].bottom - 1),
      };
    });
    expect(layout.pageOverflow).toBeLessThanOrEqual(1);
    expect(layout.toolsWidth).toBeLessThanOrEqual(layout.contentWidth);
    expect(layout.labelsInside).toBe(true);
    expect(layout.rangesUsable).toBe(true);
    expect(layout.filtersInside).toBe(true);
    expect(layout.filterLabelsInside).toBe(true);
    expect(layout.sliderWidthsMatch).toBe(true);
    expect(layout.headerInside).toBe(true);
    expect(layout.stackedWithoutOverlap).toBe(true);
  });

  test('sound picker groups sources, previews options, and closes after selection', async ({ page }) => {
    await page.goto('/');
    await page.locator('.main-beat-sound-select').click();
    await expect(page.locator('#sound-picker-modal')).toBeVisible();
    await expect(page.locator('.sound-picker-group-synth')).toBeVisible();
    await expect(page.locator('.sound-picker-group-uploaded')).toBeVisible();
    await expect(page.locator('.sound-picker-preview')).toHaveCount(24);
    await expect(page.locator('.sound-picker-card.selected')).toHaveCount(1);
    const radii = await page.evaluate(() => ({
      picker: getComputedStyle(document.querySelector('.sound-picker-content')).borderRadius,
      theme: getComputedStyle(document.documentElement).getPropertyValue('--BorderRadius').trim(),
    }));
    expect(radii.picker).toBe(radii.theme);
    const verticalContainment = await page.evaluate(() => {
      const content = document.querySelector('.sound-picker-content').getBoundingClientRect();
      const options = document.querySelector('.sound-picker-options');
      const optionsRect = options.getBoundingClientRect();
      return {
        insideContent: optionsRect.top >= content.top - 1 && optionsRect.bottom <= content.bottom + 1,
        hasInternalScroll: options.scrollHeight >= options.clientHeight,
      };
    });
    expect(verticalContainment.insideContent).toBe(true);
    expect(verticalContainment.hasInternalScroll).toBe(true);
    await expect(page.locator('#sound-picker-bottom-close')).toBeVisible();
    await page.locator('#sound-picker-bottom-close').click();
    await expect(page.locator('#sound-picker-modal')).toBeHidden();
    await page.locator('.main-beat-sound-select').click();
    await expect(page.locator('#sound-picker-modal')).toBeVisible();
    await page.locator('.sound-picker-card[data-sound="Synth Snare"] .sound-picker-preview').click();
    await page.locator('.sound-picker-card[data-sound="Synth Snare"] .sound-picker-select').click();
    await expect(page.locator('#sound-picker-modal')).toBeHidden();
    await expect(page.locator('.main-beat-sound-select')).toHaveAttribute('data-sound', 'Synth Snare');
  });

  test('manage recordings modal stays centered and contained on desktop and mobile', async ({ page }) => {
    for (const viewport of [{ width: 1280, height: 720 }, { width: 320, height: 568 }]) {
      await page.setViewportSize(viewport);
      await page.goto('/');
      await page.locator('#manage-recordings-btn').click();
      await expect(page.locator('#manage-recordings-modal')).toBeVisible();
      const layout = await page.evaluate(() => {
        const modal = document.querySelector('#manage-recordings-modal');
        const content = modal.querySelector('.manage-recordings-content').getBoundingClientRect();
        const buttons = [...modal.querySelectorAll('button')].map((button) => button.getBoundingClientRect());
        const viewportWidth = document.documentElement.clientWidth;
        return {
          pageOverflow: document.documentElement.scrollWidth - viewportWidth,
          contentInside: content.left >= -1 && content.right <= viewportWidth + 1,
          buttonsInside: buttons.every((rect) => rect.left >= content.left - 1 && rect.right <= content.right + 1),
          themedRadius: getComputedStyle(modal.querySelector('.manage-recordings-content')).borderRadius === getComputedStyle(document.documentElement).getPropertyValue('--BorderRadius').trim(),
        };
      });
      expect(layout.pageOverflow).toBeLessThanOrEqual(1);
      expect(layout.contentInside).toBe(true);
      expect(layout.buttonsInside).toBe(true);
      expect(layout.themedRadius).toBe(true);
      await page.locator('#manage-recordings-modal .close-button').click();
    }
  });

  test('sound picker and saved recording rows contain their content on narrow mobile screens', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto('/');
    await page.locator('#theme-menu-toggle').click();
    await page.locator('[data-theme="synthwave"]').click();
    await page.locator('.main-beat-sound-select').click();
    const pickerLayout = await page.evaluate(() => {
      const modal = document.querySelector('.sound-picker-content').getBoundingClientRect();
      const grid = document.querySelector('.sound-picker-grid');
      const cards = [...document.querySelectorAll('.sound-picker-card')].map((card) => {
        const cardRect = card.getBoundingClientRect();
        const select = card.querySelector('.sound-picker-select');
        const selectRect = select.getBoundingClientRect();
        return {
          card: cardRect,
          select: selectRect,
          textFits: select.scrollWidth <= select.clientWidth && select.scrollHeight >= select.clientHeight,
        };
      });
      return {
        pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
        cardsInside: cards.every(({ card, select }) => card.left >= modal.left - 1 && card.right <= modal.right + 1 && select.left >= card.left - 1 && select.right <= card.right + 1),
        textFits: cards.every(({ textFits }) => textFits),
      };
    });
    expect(pickerLayout.pageOverflow).toBeLessThanOrEqual(1);
    expect(pickerLayout.columns).toBe(2);
    expect(pickerLayout.cardsInside).toBe(true);
    expect(pickerLayout.textFits).toBe(true);
    await page.locator('#sound-picker-close').click();
    await page.evaluate(async () => {
      const { default: AppState } = await import(new URL('js/appState.js', document.baseURI).href);
      AppState.addRecording('A very long uploaded sample name for mobile layout testing');
    });
    await page.locator('#manage-recordings-btn').click();
    const recordingLayout = await page.evaluate(() => {
      const modal = document.querySelector('.manage-recordings-content').getBoundingClientRect();
      const rows = [...document.querySelectorAll('.recording-item')].map((row) => row.getBoundingClientRect());
      return {
        pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        rowsInside: rows.every((rect) => rect.left >= modal.left - 1 && rect.right <= modal.right + 1),
      };
    });
    expect(recordingLayout.pageOverflow).toBeLessThanOrEqual(1);
    expect(recordingLayout.rowsInside).toBe(true);
  });

  test('visual regression: mobile theme menu', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto('/');
    await page.locator('#theme-menu-toggle').click();
    await expect(page).toHaveScreenshot('theme-menu-mobile.png', { animations: 'disabled' });
  });

  test('beat edit rerenders ASDR and filter feedback and keeps element volume below probability', async ({ page }) => {
  await page.goto('/');
  const track = page.locator('.track').first();
  await track.locator('.beat-edit-btn').click();
  await track.locator('.beat-square').first().click();
  await expect(page.locator('#sound-settings-modal')).toBeVisible();
  const waveformBefore = await page.locator('.synth-waveform-canvas').evaluate((canvas) => canvas.toDataURL());
  await page.locator('[data-param="attack"]').fill('1800');
  await expect.poll(() => page.locator('.synth-waveform-canvas').evaluate((canvas) => canvas.toDataURL())).not.toBe(waveformBefore);
  const overlay = page.locator('.sound-visualization-category .filter-visualization-overlay');
  const beforePosition = await overlay.evaluate((element) => getComputedStyle(element).getPropertyValue('--filter-high-pass-position'));
  await page.locator('[data-param="highPassFrequency"]').fill('4000');
  await expect.poll(() => overlay.evaluate((element) => getComputedStyle(element).getPropertyValue('--filter-high-pass-position'))).not.toBe(beforePosition);
  const behaviorControls = page.locator('.sound-behavior-category .slider-container');
  await expect(behaviorControls).toHaveCount(1);
  await expect(behaviorControls.locator('label')).toContainText('Volume');
  const probabilityBox = await page.locator('#sample-probability').boundingBox();
  const volumeBox = await behaviorControls.locator('input[type="range"]').boundingBox();
  expect(volumeBox.y).toBeGreaterThan(probabilityBox.y);
  await page.locator('#sound-settings-modal .close-button').click();
  await track.locator('.rest-button').click();
  await track.locator('.beat-square').first().click();
  await expect(page.locator('.sound-behavior-category .slider-container')).toHaveCount(1);
  await expect(page.locator('.sound-behavior-category [data-param="volume"]')).toHaveCount(1);
  });
});
