'use strict';
const {test, expect} = require('@playwright/test');
const openMotion = require('./motionTestPage.cjs');

async function snapshot(page) {
  return page.evaluate(async () => {
    const state = (await import(new URL('js/appState.js', document.baseURI))).default;
    return {
      music: await state.getCurrentStateForPreset(),
      slots: Array.from({length: 16}, (_, i) => localStorage.getItem(`metronomePreset_${i}`)),
      label: document.querySelector('#preset-slot-select').selectedOptions[0].textContent,
    };
  });
}
async function outcomes(page) {
  return page.evaluate(() => __motionObserved.filter(kind => ['rename', 'save'].includes(kind)));
}

test('changed title acknowledges only a local draft, with bounded feedback and explicit Save persistence', async ({page}) => {
  await openMotion(page, test.info().config.metadata);
  const title = page.locator('#preset-name-input');
  const before = await snapshot(page);
  await title.focus();
  const geometry = await title.evaluate(el => ({rect: el.getBoundingClientRect().toJSON(), style: el.getAttribute('style')}));
  await title.fill('Unsaved local title');
  expect(await outcomes(page)).toEqual([]);
  await title.press('Tab');
  expect(await outcomes(page)).toEqual(['rename']);
  expect(await snapshot(page)).toEqual(before);
  expect(await title.evaluate(el => ({rect: el.getBoundingClientRect().toJSON(), style: el.getAttribute('style')}))).toEqual(geometry);
  await expect(page.locator('[data-motion-kind="rename"]')).toHaveCount(0);
  await page.locator('.save-preset-btn').click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('metronomePreset_0') || 'null')?.songName)).toBe('Unsaved local title');
  expect(await outcomes(page)).toEqual(['rename', 'save']);
});

test('unchanged, whitespace-only and repeated title changes are silent', async ({page}) => {
  await openMotion(page, test.info().config.metadata);
  const title = page.locator('#preset-name-input');
  await title.fill('Local baseline');
  await title.press('Tab');
  await page.evaluate(() => { __motionObserved = []; });
  const before = await snapshot(page);
  await title.focus();
  await title.dispatchEvent('change');
  await title.fill('  Local baseline  ');
  await title.press('Tab');
  expect(await outcomes(page)).toEqual([]);
  await title.focus();
  await title.fill('Next local draft');
  await title.dispatchEvent('change');
  await title.dispatchEvent('change');
  await title.press('Tab');
  expect(await outcomes(page)).toEqual(['rename']);
  expect(await snapshot(page)).toEqual(before);
});

test('Escape cancels the current local title draft without rename or persistence', async ({page}) => {
  await openMotion(page, test.info().config.metadata);
  const title = page.locator('#preset-name-input');
  const original = await title.inputValue();
  const before = await snapshot(page);
  await title.fill('Cancelled local title');
  await title.press('Escape');
  await expect(title).toHaveValue(original);
  await title.press('Tab');
  expect(await outcomes(page)).toEqual([]);
  expect(await snapshot(page)).toEqual(before);
});

for (const boundary of ['syncrolechange', 'roomauthoritychange']) {
  test(`${boundary} invalidates pending draft feedback without writing a preset`, async ({page}) => {
    await openMotion(page, test.info().config.metadata);
    const before = await snapshot(page);
    const title = page.locator('#preset-name-input');
    await title.fill('Stale local draft');
    await page.evaluate(event => document.dispatchEvent(new Event(event)), boundary);
    await title.press('Tab');
    expect(await outcomes(page)).toEqual([]);
    expect(await snapshot(page)).toEqual(before);
  });
}

test('disabled and read-only title fields never acknowledge a synthetic edit', async ({page}) => {
  await openMotion(page, test.info().config.metadata);
  const before = await snapshot(page);
  const title = page.locator('#preset-name-input');
  await title.focus();
  await title.evaluate(el => {
    el.value = 'Disabled draft'; el.disabled = true;
    el.dispatchEvent(new Event('change', {bubbles: true}));
    el.disabled = false; el.readOnly = true;
    el.dispatchEvent(new Event('change', {bubbles: true}));
    el.readOnly = false; el.blur();
  });
  expect(await outcomes(page)).toEqual([]);
  expect(await snapshot(page)).toEqual(before);
});
