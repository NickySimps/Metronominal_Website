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
  test('distortion visualizer effect keeps rendering instead of throwing', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { default: Oscilloscope } = await import(new URL('js/oscilloscope.js', document.baseURI).href);
      const canvas = document.querySelector('#background-oscilloscope');
      const context = canvas.getContext('2d');
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      Oscilloscope.ensureEffectCanvases(canvas.width, canvas.height);
      Oscilloscope.applyVisualizerEffects({ delay: 0, distortion: 1, reverb: 0 });
      return [...context.getImageData(0, 0, canvas.width, canvas.height).data].some((value) => value !== 0);
    });
    expect(result).toBe(true);
  });
});
