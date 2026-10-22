const { test, expect } = require('@playwright/test');

test('theme controls respond while audio is loading and preserve the choice after startup', async ({ page }) => {
  let releaseAudio;
  const audioGate = new Promise(resolve => { releaseAudio = resolve; });
  await page.route('**/*.mp3', async route => {
    await audioGate;
    await route.continue().catch(() => {});
  });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto('./', { waitUntil: 'domcontentloaded' });
    await page.locator('#theme-menu-toggle').click();
    await expect(page.locator('#theme-menu')).toBeVisible({ timeout: 2000 });
    await page.locator('#theme-menu [data-theme="dark"]').click();
    await expect.poll(() => page.evaluate(() => localStorage.getItem('selectedTheme')), { timeout: 2000 }).toBe('dark');
    await expect(page.locator('#theme-menu')).toBeVisible();
    releaseAudio();
    await expect(page.locator('#share-btn')).toHaveClass(/connected/);
    expect(await page.evaluate(async () => {
      const { default: app } = await import(new URL('js/appState.js', document.baseURI));
      return app.getCurrentTheme();
    })).toBe('dark');
    expect(errors).toEqual([]);
  } finally {
    releaseAudio();
  }
});
