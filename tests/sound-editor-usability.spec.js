const { test, expect } = require('@playwright/test');

// Exercise the real editor/model/audio modules without joining a signaling room.
async function openEditor(page, viewport = { width: 390, height: 844 }) {
  await page.setViewportSize(viewport);
  await page.route('**/script.js', route => route.abort());
  await page.goto('./');
  await page.evaluate(async () => {
    const [{ default: editor }, { default: state }] = await Promise.all([
      import(new URL('js/soundSettingsModal.js', document.baseURI)), import(new URL('js/appState.js', document.baseURI)),
    ]);
    window.editor = editor;
    window.state = state;
    const { default: themes } = await import(new URL('js/themeController.js', document.baseURI));
    themes.applyTheme('synthwave');
    state.initializeAudioContext();
    if (!state.getTracks().length) state.addTrack();
    const opener = document.createElement('button');
    opener.id = 'editor-test-opener';
    opener.textContent = 'Edit test sound';
    document.body.append(opener);
    opener.focus();
    editor.init();
    editor.show(0, 'mainBeatSound');
    await document.fonts.ready;
  });
  await expect(page.locator('#sound-settings-modal')).toBeVisible();
}

test('FX sliders have associated names and keyboard-operable named step controls', async ({ page }) => {
  await openEditor(page);
  await page.locator('#sound-effects-btn').click();
  const names = ['Pitch shift', 'Distortion', 'Delay mix', 'Delay time', 'Delay feedback', 'Reverb mix', 'Reverb length'];
  for (const name of names) {
    await expect(page.getByRole('slider', { name, exact: true })).toHaveCount(1);
    await expect(page.getByRole('button', { name: `Decrease ${name}`, exact: true })).toHaveCount(1);
    await expect(page.getByRole('button', { name: `Increase ${name}`, exact: true })).toHaveCount(1);
  }
  const increment = page.getByRole('button', { name: 'Increase Pitch shift', exact: true });
  await increment.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('slider', { name: 'Pitch shift', exact: true })).toHaveValue('1');
});

for (const viewport of [{ width: 320, height: 700 }, { width: 390, height: 844 }]) {
  test(`Synthwave editors stay bounded, readable and scrollable at ${viewport.width}`, async ({ page }) => {
    await openEditor(page, viewport);
    for (const id of ['sound-settings-modal', 'sound-effects-modal']) {
      if (id === 'sound-effects-modal') await page.locator('#sound-effects-btn').click();
      const geometry = await page.locator(`#${id} .modal-content`).evaluate(element => {
        const rect = element.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right,
          maxHeight: getComputedStyle(element).maxHeight, overflow: getComputedStyle(element).overflowY,
          scrollWidth: element.scrollWidth, clientWidth: element.clientWidth };
      });
      expect(geometry.maxHeight).not.toBe('none');
      expect(geometry.overflow).toBe('auto');
      expect(geometry.top).toBeGreaterThanOrEqual(0);
      expect(geometry.bottom).toBeLessThanOrEqual(viewport.height);
      expect(geometry.left).toBeGreaterThanOrEqual(0);
      expect(geometry.right).toBeLessThanOrEqual(viewport.width);
      expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
      const readability = await page.locator(`#${id} .slider-container`).evaluateAll(elements => elements.map(element => {
        const label = element.querySelector('label');
        const value = element.querySelector(':scope > span');
        return { font: parseFloat(getComputedStyle(label).fontSize), shadow: getComputedStyle(label).textShadow,
          clipped: value.scrollWidth > value.clientWidth + 1 };
      }));
      expect(readability.length).toBeGreaterThan(0);
      for (const item of readability) {
        expect(item.font).toBeLessThanOrEqual(20);
        expect(item.shadow).toBe('none');
        expect(item.clipped).toBe(false);
      }
      await page.locator(`#${id} .modal-content`).evaluate(element => { element.scrollTop = element.scrollHeight; });
      const bottomClose = page.locator(`#${id} button[id$="bottom-close"]`);
      await expect(bottomClose).toBeInViewport();
      await bottomClose.click();
      await expect(page.locator(`#${id}`)).not.toBeVisible();
      if (id === 'sound-settings-modal') await page.evaluate(() => window.editor.show(0, 'mainBeatSound'));
    }
  });
}
