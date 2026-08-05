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
  test('every visualizer mode renders every visual effect', async ({ page }) => {
    const matrix = await page.evaluate(async () => {
      const [{ default: Oscilloscope }, { default: AppState }] = await Promise.all([
        import(new URL('js/oscilloscope.js', document.baseURI).href),
        import(new URL('js/appState.js', document.baseURI).href),
      ]);
      const canvas = document.querySelector('#background-oscilloscope');
      const track = AppState.getTracks()[0];
      const originalRaf = window.requestAnimationFrame;
      const originalNodes = AppState.getAnalyserNodes;
      const originalSettings = track.mainBeatSound.settings;
      const analyser = {
        frequencyBinCount: 64,
        getByteFrequencyData(data) { data.fill(180); },
        getByteTimeDomainData(data) {
          for (let index = 0; index < data.length; index += 1) data[index] = 128 + Math.round(Math.sin(index / 4) * 90);
        },
      };
      const modes = [...Oscilloscope.modes];
      const effects = [
        ['delay', { delayMix: 1 }],
        ['distortion', { distortion: 1 }],
        ['reverb', { reverbMix: 1 }],
      ];
      const output = [];
      try {
        window.requestAnimationFrame = () => 0;
        AppState.getAnalyserNodes = () => [analyser];
        Oscilloscope.canvas = canvas;
        Oscilloscope.canvasCtx = canvas.getContext('2d');
        Oscilloscope.isDrawing = true;
        for (const mode of modes) {
          Oscilloscope.setMode(mode);
          track.mainBeatSound.settings = {};
          Oscilloscope.draw();
          const baseline = canvas.toDataURL();
          for (const [effect, settings] of effects) {
            track.mainBeatSound.settings = settings;
            Oscilloscope.draw();
            if (effect === 'delay') Oscilloscope.draw();
            output.push({ mode, effect, changed: canvas.toDataURL() !== baseline });
          }
        }
      } finally {
        window.requestAnimationFrame = originalRaf;
        AppState.getAnalyserNodes = originalNodes;
        track.mainBeatSound.settings = originalSettings;
        Oscilloscope.isDrawing = false;
      }
      return output;
    });
    expect(matrix).toHaveLength(48);
    expect(matrix.filter(({ changed }) => !changed)).toEqual([]);
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
