const { test, expect } = require('@playwright/test');

test.describe('visualizer upgrades', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.track');
  });

  test('performance controls are removed from the top controls', async ({ page }) => {
    await expect(page.locator('.performance-drawer, [data-performance-action]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /performance/i })).toHaveCount(0);
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
