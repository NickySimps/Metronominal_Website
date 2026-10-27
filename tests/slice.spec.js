const { test, expect } = require('@playwright/test');
const prepareWorkflowTestPage=require('./workflowTestPage.cjs');

test.describe('track slice and action controls', () => {
  test.beforeEach(async ({ page },info) => {
    await prepareWorkflowTestPage(page,info.config.metadata);
    await page.goto('/');
    await page.waitForSelector('.track');
    await expect(page.locator('#share-btn')).toHaveClass(/(?:^|\s)connected(?:\s|$)/);
  });

  test('Slice mode expands only the selected beat and keeps the bar boundary', async ({ page }) => {
    const bar = page.locator('.bar-visual').first();
    const before = await bar.locator('.beat-square').count();
    await page.locator('.slice-btn').click();
    await expect(page.locator('.slice-btn')).toHaveAttribute('aria-pressed', 'true');
    await bar.locator('.beat-square').nth(1).click();
    await expect.poll(() => bar.locator('.beat-square').count()).toBe(before);
    await expect(bar.locator('.slice-count-badge')).toHaveText('2');
    await expect(bar.locator('.beat-square[data-slice-count="2"]')).toHaveAttribute('aria-label', /Beat 2.*2 slices/);
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
    await expect(bar.locator('.beat-square')).toHaveCount(4);
    await page.locator('.slice-btn').click();
    await expect(bar.locator('.beat-square[data-slice-count="2"]')).toHaveAttribute('aria-label', /Beat 2.*2 slices/);
    await page.evaluate(()=>document.dispatchEvent(new CustomEvent('syncrolechange',{detail:{state:'connected',isHost:false}})));
    await expect(bar.locator('.beat-square[data-slice-count="2"]')).toHaveAttribute('aria-label','Beat 2, 2 slices');
  });

  test('Slice mode paints across beats during a real drag', async ({ page }) => {
    const bar = page.locator('.bar-visual').first();
    await page.locator('.slice-btn').click();
    // Immediate multi-beat painting is the explicit legacy opt-out gesture.
    await page.locator('[data-beat-precision-toggle]').first().click();
    const boxes = await bar.locator('.beat-square').evaluateAll(elements => elements.map(element => {
      const rect = element.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }));
    await page.mouse.move(boxes[0].x, boxes[0].y);
    await page.mouse.down();
    for (const box of boxes.slice(1, 3)) {
      await page.mouse.move(box.x, box.y);
    }
    await page.mouse.up();
    await expect.poll(() => page.evaluate(async () => {
      const { default: AppState } = await import(new URL('js/appState.js', document.baseURI).href);
      return AppState.getTracks()[0].barSettings[0].beatSlices;
    })).toEqual({ 0: 2, 1: 2, 2: 2 });
  });

  test('slicing preserves the parent beat count and total bar duration', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const [{ default: AppState }, { getBeatSlots, getSlotDurationSeconds }] = await Promise.all([
        import(new URL('js/appState.js', document.baseURI).href),
        import(new URL('js/beatTiming.js', document.baseURI).href),
      ]);
      AppState.setBeatSlices(0, 0, 0, 2);
      const bar = AppState.getTracks()[0].barSettings[0];
      const slots = getBeatSlots(bar);
      const secondsPerBeat = 0.5;
      const firstParentBeatDuration = slots.slice(0, 2).reduce(
        (sum, slot) => sum + getSlotDurationSeconds(bar, slot.index, secondsPerBeat), 0
      );
      const fullBarDuration = slots.reduce(
        (sum, slot) => sum + getSlotDurationSeconds(bar, slot.index, secondsPerBeat), 0
      );
      return { totalBeats: AppState.getTotalBeats(), slotCount: slots.length, firstParentBeatDuration, fullBarDuration };
    });
    expect(result).toEqual({ totalBeats: 4, slotCount: 5, firstParentBeatDuration: 0.5, fullBarDuration: 2 });
  });


  test('rests follow logical note actions without colliding with overlapping expanded slice indices', async ({ page }) => {
    const initial = await page.evaluate(async () => {
      const a=(await import('/js/appState.js')).default;
      a.updateTrack(0,{barSettings:[{beats:4,subdivision:1,rests:[1],beatSlices:{1:4}}]});
      const {getBeatSlots}=await import('/js/beatTiming.js'),{isRestedSlot}=await import('/js/metronomeEngine.js');
      const bar=a.getTracks()[0].barSettings[0];
      return getBeatSlots(bar).filter(slot=>slot.baseIndex===1).map(slot=>isRestedSlot(bar,slot.index,slot));
    });
    expect(initial).toEqual([true,true,true,true]);
    await page.locator('.rest-button').first().click();
    const beat=index=>page.locator(`.bar-visual[data-container-index="0"][data-bar-index="0"] .beat-square[data-beat-index="${index}"]`);
    // Logical beat4 has key3, which also happens to be an expanded child of beat2.
    // Ordinary grid actions establish the meaning: rest beat4, then un-rest beat2.
    await beat(3).click();await beat(1).click();
    await expect(beat(3)).toHaveClass(/rested/);await expect(beat(1)).not.toHaveClass(/rested/);
    const result=await page.evaluate(async()=>{
      const a=(await import('/js/appState.js')).default,{getBeatSlots}=await import('/js/beatTiming.js'),{isRestedSlot}=await import('/js/metronomeEngine.js');
      const bar=a.getTracks()[0].barSettings[0],slots=getBeatSlots(bar);
      return {rests:bar.rests,sliced:slots.filter(slot=>slot.baseIndex===1).map(slot=>isRestedSlot(bar,slot.index,slot)),fourth:slots.filter(slot=>slot.baseIndex===3).map(slot=>isRestedSlot(bar,slot.index,slot)),first:isRestedSlot(bar,0,slots[0])};
    });
    expect(result).toEqual({rests:[3],sliced:[false,false,false,false],fourth:[true],first:false});
  });
  test('sliced slots retain playback-control settings for main and subdivision sounds', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const [{ default: AppState }, { getBeatSlots }] = await Promise.all([
        import(new URL('js/appState.js', document.baseURI).href),
        import(new URL('js/beatTiming.js', document.baseURI).href),
      ]);
      const track = AppState.getTracks()[0];
      track.mainBeatSound.settings = { ...track.mainBeatSound.settings, allowOverlap: false, retrigger: true, reverse: true };
      track.subdivisionSound.settings = { ...track.subdivisionSound.settings, allowOverlap: true, retrigger: false, reverse: true };
      AppState.setBeatSlices(0, 0, 0, 2);
      const bar = track.barSettings[0];
      return getBeatSlots(bar).slice(0, 2).map(slot => {
        const soundType = slot.mainBeat ? 'mainBeatSound' : 'subdivisionSound';
        const sound = AppState.getBeatSound(0, 0, slot.index, soundType);
        return { soundType, allowOverlap: sound.settings.allowOverlap, retrigger: sound.settings.retrigger, reverse: sound.settings.reverse };
      });
    });
    expect(result).toEqual([
      { soundType: 'mainBeatSound', allowOverlap: false, retrigger: true, reverse: true },
      { soundType: 'mainBeatSound', allowOverlap: false, retrigger: true, reverse: true },
    ]);
  });
  test('badge follows the exact selected sub-beat in a subdivided bar', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const [{ default: AppState }, { default: BarDisplayController }] = await Promise.all([
        import(new URL('js/appState.js', document.baseURI).href),
        import(new URL('js/barDisplayController.js', document.baseURI).href),
      ]);
      AppState.getTracks()[0].barSettings[0].subdivision = 2;
      BarDisplayController.updateBar(0, 0);
      return document.querySelectorAll('.bar-visual .beat-square').length;
    });
    expect(result).toBe(8);
    await page.locator('.slice-btn').click();
    const bar = page.locator('.bar-visual').first();
    await bar.locator('.beat-square').nth(2).click();
    await expect(bar.locator('.beat-square[data-beat-index="2"] .slice-count-badge')).toHaveText('2');
    await expect(bar.locator('.beat-square[data-beat-index="0"] .slice-count-badge')).toHaveCount(0);
    const placement = await bar.evaluate((element) => {
      const badge = element.querySelector('.beat-square[data-beat-index="2"] .slice-count-badge').getBoundingClientRect();
      const indicator = element.querySelector('.bar-beat-indicator').getBoundingClientRect();
      return { badgeLeft: badge.left, indicatorLeft: indicator.left };
    });
    expect(placement.badgeLeft).toBeLessThan(placement.indicatorLeft);
  });
  test('each independently sliced sub-beat gets its own badge and playback target', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const [{ default: AppState }, { default: BarDisplayController }] = await Promise.all([
        import(new URL('js/appState.js', document.baseURI).href),
        import(new URL('js/barDisplayController.js', document.baseURI).href),
      ]);
      const bar = AppState.getTracks()[0].barSettings[0];
      bar.subdivision = 2;
      [0, 1, 2, 3, 4, 5, 6, 7].forEach(index => AppState.setBeatSlices(0, 0, index, 2, index));
      BarDisplayController.updateBar(0, 0);
      return {
        badges: [...document.querySelectorAll('.bar-visual .slice-count-badge')].map(badge => badge.parentElement.dataset.beatIndex),
        slots: [...document.querySelectorAll('.bar-visual .beat-square')].map(square => square.dataset.beatIndex),
      };
    });
    expect(result.badges).toEqual(['0', '1', '2', '3', '4', '5', '6', '7']);
    expect(result.slots).toHaveLength(8);
  });
  test('every slice re-triggers the parent beat visual highlight', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const [{ default: AppState }, { default: BarDisplayController }] = await Promise.all([
        import(new URL('js/appState.js', document.baseURI).href),
        import(new URL('js/barDisplayController.js', document.baseURI).href),
      ]);
      AppState.setBeatSlices(0, 0, 1, 2);
      BarDisplayController.updateBeatHighlight(0, 0, 1, true);
      const first = document.querySelector('.bar-visual .beat-square[data-source-beat="1"]');
      const firstClass = first?.className;
      BarDisplayController.updateBeatHighlight(0, 0, 2, true);
      const second = document.querySelector('.bar-visual .beat-square[data-source-beat="1"]');
      return { sameElement: first === second, firstClass, secondClass: second?.className, visualCount: document.querySelectorAll('.bar-visual .beat-square').length };
    });
    expect(result.sameElement).toBe(true);
    expect(result.firstClass).toContain('highlighted');
    expect(result.secondClass).toContain('highlighted');
    expect(result.visualCount).toBe(4);
  });
  test('slice mode never falls through to Beat Edit after mode changes', async ({ page }) => {
    await page.locator('.beat-edit-btn').click();
    await page.locator('.slice-btn').click();
    await expect(page.locator('body')).not.toHaveClass(/beat-edit-mode/);
    const beat = page.locator('.bar-visual').first().locator('.beat-square').first();
    await beat.click();
    await expect(page.locator('#sound-settings-modal')).toBeHidden();
    await page.locator('.rest-button').click();
    await beat.click();
    await expect(page.locator('#sound-settings-modal')).toBeHidden();
    await page.locator('.accent-button').click();
    await beat.click();
    await expect(page.locator('#sound-settings-modal')).toBeHidden();
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
    await expect(page.locator('[data-track-option]:not([data-track-parent])')).toHaveCount(6);
    await expect(page.locator('.track-action-suboption', { hasText: 'Slices' })).toBeVisible();
    await random.dispatchEvent('pointerup');
  });

  test('Randomize can generate slice metadata', async ({ page }) => {
    await page.evaluate(() => { Math.random = () => 0.1; });
    await page.locator('.random-btn').first().click();
    const slices = await page.evaluate(async () => {
      const { default: AppState } = await import(new URL('js/appState.js', document.baseURI).href);
      return AppState.getTracks()[0].barSettings[0].beatSlices;
    });
    expect(Object.keys(slices || {})).not.toHaveLength(0);
    expect(Object.values(slices).every(count => [2, 3, 4, 6, 8, 16, 32].includes(count))).toBe(true);
  });
  test('resetting the pattern clears slice metadata without changing bar structure', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { default: AppState } = await import(new URL('js/appState.js', document.baseURI).href);
      AppState.setBeatSlices(0, 0, 1, 8);
      AppState.resetTrack(0, { pattern: { slices: true } });
      const bar = AppState.getTracks()[0].barSettings[0];
      return { bars: AppState.getTracks()[0].barSettings.length, beatSlices: bar.beatSlices, beatSliceAnchors: bar.beatSliceAnchors };
    });
    expect(result).toEqual({ bars: 1, beatSlices: {}, beatSliceAnchors: {} });
  });
  test('track reset restores one bar and default main sound', async ({ page }) => {
    await page.evaluate(async () => {
      const { default: AppState } = await import(new URL('js/appState.js', document.baseURI).href);
      AppState.updateTrack(0, {
        mainBeatSound: { sound: 'Synth Snare', settings: {} },
        barSettings: [
          { beats: 4, subdivision: 1, rests: [], velocities: {}, beatSounds: {} },
          { beats: 4, subdivision: 1, rests: [], velocities: {}, beatSounds: {} },
          { beats: 4, subdivision: 1, rests: [], velocities: {}, beatSounds: {} },
        ],
      });
    });
    const reset = page.locator('.track-reset-btn').first();
    await reset.dispatchEvent('pointerdown');
    await page.waitForTimeout(400);
    await expect(page.locator('#track-action-modal')).toBeVisible();
    await reset.dispatchEvent('pointerup');
    await page.locator('[data-track-action-apply]').click();
    const result = await page.evaluate(async () => {
      const { default: AppState } = await import(new URL('js/appState.js', document.baseURI).href);
      const track = AppState.getTracks()[0];
      return { bars: track.barSettings.length, mainSound: track.mainBeatSound.sound };
    });
    expect(result).toEqual({ bars: 1, mainSound: 'Synth Kick' });
  });
  test('track action row and modal remain contained at 320px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.reload();
    // Reload exposes a provisional track before initialization/room restoration
    // replaces it. Measure the initialized row, not that detached node's handle.
    await expect(page.locator('#share-btn')).toHaveClass(/(?:^|\s)connected(?:\s|$)/);
    await expect(page.locator('#rehearsal-tools-status')).not.toContainText('Preparing');
    const row = page.locator('.track-action-row');
    await expect(row).toBeVisible();
    const rowBox = await row.evaluate(element => {
      const { x, width, height } = element.getBoundingClientRect();
      return { x, width, height, current: element.isConnected && element === document.querySelector('.track-action-row') };
    });
    expect(rowBox.current).toBe(true);
    expect(rowBox.width).toBeGreaterThan(0);
    expect(rowBox.height).toBeGreaterThan(0);
    expect(rowBox.x).toBeGreaterThanOrEqual(0);
    expect(rowBox.x + rowBox.width).toBeLessThanOrEqual(320);
    await page.locator('.track-reset-btn').dispatchEvent('pointerdown');
    const modal = page.locator('.track-action-modal-content');
    await expect(modal).toBeVisible();
    const overlayBox = await page.locator('#track-action-modal').boundingBox();
    expect(overlayBox.x).toBeGreaterThanOrEqual(0);
    expect(overlayBox.x + overlayBox.width).toBeLessThanOrEqual(320);
    const modalBox = await modal.evaluate(element => {
      const { x, width, height } = element.getBoundingClientRect();
      return { x, width, height };
    });
    expect(modalBox.width).toBeGreaterThan(0);
    expect(modalBox.height).toBeGreaterThan(0);
    expect(modalBox.x).toBeGreaterThanOrEqual(0);
    expect(modalBox.x + modalBox.width).toBeLessThanOrEqual(320);
    await page.locator('.track-reset-btn').dispatchEvent('pointerup');
  });
});
