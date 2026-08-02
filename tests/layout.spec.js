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
        contentFitsViewport: content.getBoundingClientRect().height <= window.innerHeight,
        contentScrolls: content.scrollHeight >= content.clientHeight,
        canvasHeight: canvas.getBoundingClientRect().height,
        hasPreviewButton: Boolean(modal.querySelector('#sound-preview-btn')),
        hasScopeModeSelect: Boolean(modal.querySelector('#sound-scope-mode-select')),
        hasWaveformTools: Boolean(modal.querySelector('.waveform-tools')),
        hasTrackContext: modal.querySelector('.sound-modal-context')?.textContent.includes('Track 1'),
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
    expect(result.contentFitsViewport).toBe(true);
    expect(result.contentScrolls).toBe(true);
    expect(result.canvasHeight).toBeLessThanOrEqual(100);
    expect(result.hasPreviewButton).toBe(true);
    expect(result.hasScopeModeSelect).toBe(true);
    expect(result.hasTrackContext).toBe(true);
    expect(result.analysersAreSeparate).toBe(true);
    expect(result.secondTrackHasSeparateAnalysers).toBe(true);
    expect(result.thirdTrackHasSeparateAnalysers).toBe(true);
    expect(result.lastTrackHasSeparateAnalysers).toBe(true);
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
      SoundSettingsModal.stopPreview();
      const track = AppState.getTracks()[0];
      track.mainBeatSound.sound = 'Click1.mp3';
      await SoundSettingsModal.show(0, 'mainBeatSound');
      return {
        previewActive,
        previewStopped: preview.getAttribute('aria-pressed') === 'false',
        waveformTools: Boolean(document.querySelector('.waveform-tools')),
        zoomControl: Boolean(document.querySelector('.waveform-zoom')),
        panControl: Boolean(document.querySelector('.waveform-pan')),
      };
    });
    expect(result).toEqual({ previewActive: true, previewStopped: true, waveformTools: true, zoomControl: true, panControl: true });
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

  test('visual regression: mobile theme menu', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto('/');
    await page.locator('#theme-menu-toggle').click();
    await expect(page).toHaveScreenshot('theme-menu-mobile.png', { animations: 'disabled' });
  });
});
