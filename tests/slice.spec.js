const { test, expect } = require('@playwright/test');

test.describe('track slice and action controls', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.track');
  });

  test('Slice mode expands only the selected beat and keeps the bar boundary', async ({ page }) => {
    const bar = page.locator('.bar-visual').first();
    const before = await bar.locator('.beat-square').count();
    await page.locator('.slice-btn').click();
    await expect(page.locator('.slice-btn')).toHaveAttribute('aria-pressed', 'true');
    await bar.locator('.beat-square').nth(1).click();
    await expect.poll(() => bar.locator('.beat-square').count()).toBe(before + 1);
    await expect(bar.locator('.slice-count-badge')).toHaveText('2');
    await expect(bar.locator('.beat-square[data-slice-count="2"]')).toHaveAttribute('aria-label', 'Beat 2, 2 slices');
    const badgeStyle = await bar.locator('.slice-count-badge').evaluate(element => ({
      background: getComputedStyle(element).backgroundColor,
      borderRadius: getComputedStyle(element).borderRadius,
    }));
    expect(badgeStyle.background).not.toBe('rgba(0, 0, 0, 0)');
    expect(badgeStyle.borderRadius).not.toBe('0px');
    await expect.poll(() => page.evaluate(async () => {
      const { default: AppState } = await import(new URL('js/appState.js', document.baseURI).href);
      return AppState.getTracks()[0].barSettings[0].beatSlices;
    })).toEqual({ 1: 2 });
    await expect(bar.locator('.beat-square')).toHaveCount(5);
  });

  test('Slice mode is mutually exclusive with Rest, Accent, and Beat Edit', async ({ page }) => {
    await page.locator('.slice-btn').click();
    await expect(page.locator('.rest-button')).not.toHaveClass(/active/);
    await expect(page.locator('.accent-button')).not.toHaveClass(/active/);
    await expect(page.locator('.beat-edit-btn')).not.toHaveClass(/active/);
  });

  test('long pressing Randomize opens all parameter groups without randomizing first', async ({ page }) => {
    const random = page.locator('.random-btn');
    await random.dispatchEvent('pointerdown');
    await page.waitForTimeout(400);
    await expect(page.locator('#track-action-modal')).toBeVisible();
    await expect(page.locator('[data-track-option]')).toHaveCount(6);
    await expect(page.locator('.track-action-option')).toContainText(['Track controls', 'Main sound', 'Subdivision sound', 'Bar structure', 'Beat pattern', 'Beat-specific overrides']);
    await random.dispatchEvent('pointerup');
  });

  test('track action row and modal remain contained at 320px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.reload();
    await page.waitForSelector('.track');
    const row = page.locator('.track-action-row');
    const rowBox = await row.boundingBox();
    expect(rowBox.x).toBeGreaterThanOrEqual(0);
    expect(rowBox.x + rowBox.width).toBeLessThanOrEqual(320);
    await page.locator('.track-reset-btn').dispatchEvent('pointerdown');
    await page.waitForTimeout(400);
    const modalBox = await page.locator('.track-action-modal-content').boundingBox();
    expect(modalBox.x).toBeGreaterThanOrEqual(0);
    expect(modalBox.x + modalBox.width).toBeLessThanOrEqual(320);
  });
});
