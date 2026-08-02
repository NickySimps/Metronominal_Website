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
    await page.locator('#random-theme-btn').click();
    await expect.poll(readMode).toMatch(/waveform|spectrum|lissajous|radial|spiral|orbit|grid|mirror|stars|ringbar|pulse/);
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
    }))).toEqual({ themeClass: true, controlsZ: 1100, paletteZ: 1101, paletteRadius: '50%' });
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
      const modal = document.querySelector('#sound-settings-modal');
      const content = modal.querySelector('.modal-content');
      const canvas = modal.querySelector('.oscilloscope-canvas');
      const track = AppState.getTracks()[0];
      return {
        contentFitsViewport: content.getBoundingClientRect().height <= window.innerHeight,
        contentScrolls: content.scrollHeight >= content.clientHeight,
        canvasHeight: canvas.getBoundingClientRect().height,
        analysersAreSeparate: track.mainAnalyserNode && track.subdivisionAnalyserNode
          && track.mainAnalyserNode !== track.subdivisionAnalyserNode,
      };
    });
    expect(result.contentFitsViewport).toBe(true);
    expect(result.contentScrolls).toBe(true);
    expect(result.canvasHeight).toBeLessThanOrEqual(100);
    expect(result.analysersAreSeparate).toBe(true);
  });

  test('visual regression: mobile theme menu', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto('/');
    await page.locator('#theme-menu-toggle').click();
    await expect(page).toHaveScreenshot('theme-menu-mobile.png', { animations: 'disabled' });
  });
});
