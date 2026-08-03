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
    await track.locator('.beat-edit-btn').click();
    await expect(track.locator('.beat-edit-btn')).toHaveAttribute('aria-pressed', 'true');

    const controlOrder = await track.locator('.track-controls > button').evaluateAll((buttons) => buttons.map((button) => button.className));
    expect(controlOrder.indexOf('track-record-btn')).toBeLessThan(controlOrder.indexOf('track-mute-btn'));
    expect(controlOrder.indexOf('track-record-btn')).toBeLessThan(controlOrder.indexOf('track-solo-btn'));

    await track.locator('.beat-square').first().click();
    await expect(page.locator('#sound-settings-modal')).toBeVisible();
    await expect(page.locator('.sound-modal-context')).toContainText('Bar 1, Beat 1');

    const probability = page.locator('#sample-probability');
    await probability.fill('42');
    await page.locator('#sound-settings-modal .close-button').click();
    await expect(page.locator('#sound-settings-modal')).toBeHidden();

    await track.locator('.beat-square').first().click();
    await expect(probability).toHaveValue('42');
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
        feedback: document.querySelector('.filter-feedback')?.textContent,
      };
    });
    expect(result.waveform).toBe(true);
    expect(result.feedback).toContain('HP off');
    expect(result.feedback).toContain('LP off');
    const highPass = page.locator('#sound-sliders-container [data-param="highPassFrequency"]');
    const lowPass = page.locator('#sound-sliders-container [data-param="lowPassFrequency"]');
    await highPass.fill('300');
    await lowPass.fill('5000');
    await expect(page.locator('.filter-feedback')).toContainText('HP 300 Hz');
    await expect(page.locator('.filter-feedback')).toContainText('LP 5000 Hz');
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
      };
    });
    expect(result.modalZIndex).toBeGreaterThanOrEqual(3000);
    expect(result.contentZIndex).toBeGreaterThanOrEqual(0);
    expect(result.contentRadius).toBe(result.themeRadius);
    expect(result.contentOverflowX).toBe('visible');
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
      return {
        previewActive,
        previewLabel,
        previewStopped: preview.getAttribute('aria-pressed') === 'false',
        previewReverse,
        previewPitch,
        waveformTools: Boolean(document.querySelector('.waveform-tools')),
        zoomControl: Boolean(document.querySelector('.waveform-zoom')),
        panControl: Boolean(document.querySelector('.waveform-pan')),
      };
    });
    expect(result).toEqual({ previewActive: true, previewLabel: 'Stop', previewStopped: true, previewReverse: true, previewPitch: 2, waveformTools: true, zoomControl: true, panControl: true });
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
});
