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
      await expect(page.locator('#ab-start-bar option')).toHaveCount(64);
      await expect(endInput.locator('option')).toHaveCount(64);
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

  test('keeps the synthwave theme palette above the oval theme control', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    await page.locator('#theme-menu-toggle').click();
    await page.locator('[data-theme="synthwave"]').click();

    const palette = page.locator('#theme-menu');
    await expect(palette).toBeVisible();
    await expect.poll(() => page.evaluate(() => ({
      themeClass: document.body.classList.contains('synthwave-theme'),
      controlsZ: Number.parseInt(getComputedStyle(document.querySelector('.theme-controls')).zIndex, 10),
      paletteZ: Number.parseInt(getComputedStyle(document.querySelector('#theme-menu')).zIndex, 10),
      paletteRadius: getComputedStyle(document.querySelector('#theme-menu'), '::before').borderTopLeftRadius,
    }))).toEqual({
      themeClass: true,
      controlsZ: 1100,
      paletteZ: 1101,
      paletteRadius: '50%',
    });
  });
});
