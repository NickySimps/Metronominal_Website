const { test, expect } = require('@playwright/test');

test.describe('performance upgrades', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.track');
  });

  test('performance drawer exposes existing quick controls and stays contained on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.reload();
    const drawer = page.locator('.performance-drawer');
    await drawer.locator('summary').click();
    const panel = page.locator('.performance-drawer-panel');
    await expect(panel).toBeVisible();
    const box = await panel.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(320);
    await panel.locator('[data-performance-action="diagnostics"]').click();
    await expect(page.locator('#sync-diagnostics-panel')).not.toHaveAttribute('hidden');
  });

  test('visualizer canvas backing resolution is capped at 2x CSS pixels', async ({ page }) => {
    const result = await page.evaluate(() => {
      const canvas = document.querySelector('#background-oscilloscope');
      const rect = canvas.getBoundingClientRect();
      return { width: canvas.width, height: canvas.height, cssWidth: rect.width, cssHeight: rect.height };
    });
    expect(result.width).toBeLessThanOrEqual(Math.ceil(result.cssWidth * 2) + 1);
    expect(result.height).toBeLessThanOrEqual(Math.ceil(result.cssHeight * 2) + 1);
  });
});
