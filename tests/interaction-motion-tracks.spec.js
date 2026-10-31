'use strict';
const {test,expect}=require('@playwright/test');const openMotion=require('./motionTestPage.cjs');
async function ready(page){await openMotion(page,test.info().config.metadata);await page.evaluate(async()=>{window.a=(await import(new URL('js/appState.js',document.baseURI))).default;__motionObserved=[];});}

test('adding and removing a track acknowledge actual structural changes',async({page})=>{
 await ready(page);const before=await page.locator('.track').count();await page.locator('#add-track-btn').click();
 await expect(page.locator('.track')).toHaveCount(before+1);await expect.poll(()=>page.evaluate(()=>__motionObserved.includes('open'))).toBe(true);
 await page.evaluate(()=>{__motionObserved=[];});await page.locator('.track').last().locator('.track-remove-btn').click();
 await expect(page.locator('.track')).toHaveCount(before);await expect.poll(()=>page.evaluate(()=>__motionObserved.includes('remove'))).toBe(true);
});

test('duplicating a track confirms the new real track rather than a generic button press',async({page})=>{
 await ready(page);const before=await page.locator('.track').count();await page.locator('.duplicate-track-btn').first().click();
 await expect(page.locator('.track')).toHaveCount(before+1);expect(await page.evaluate(()=>a.getTracks().length)).toBe(before+1);
 await expect.poll(()=>page.evaluate(()=>__motionObserved.includes('copy'))).toBe(true);
});

test('track mute and solo feedback follows their actual accepted states',async({page})=>{
 await ready(page);await page.locator('.track-mute-btn').first().click();
 await expect(page.locator('.track-mute-btn').first()).toHaveAttribute('aria-pressed','true');expect(await page.evaluate(()=>a.getTracks()[0].muted)).toBe(true);
 await expect.poll(()=>page.evaluate(()=>__motionObserved.includes('toggle'))).toBe(true);
 await page.evaluate(()=>{__motionObserved=[];});await page.locator('.track-solo-btn').first().click();
 await expect(page.locator('.track-solo-btn').first()).toHaveAttribute('aria-pressed','true');expect(await page.evaluate(()=>a.getTracks()[0].solo)).toBe(true);
 await expect.poll(()=>page.evaluate(()=>__motionObserved.includes('toggle'))).toBe(true);
});

test('track rename acknowledges only a committed name and Escape leaves music untouched',async({page})=>{
 await ready(page);await page.locator('.track-name').first().click();await page.locator('.track-name-input').fill('Motion renamed track');await page.locator('.track-name-input').press('Enter');
 await expect(page.locator('.track-name').first()).toHaveText('Motion renamed track');expect(await page.evaluate(()=>a.getTracks()[0].name)).toBe('Motion renamed track');
 await expect.poll(()=>page.evaluate(()=>__motionObserved.includes('rename'))).toBe(true);
 await page.evaluate(()=>{__motionObserved=[];});await page.locator('.track-name').first().click();await page.locator('.track-name-input').fill('Not committed');await page.locator('.track-name-input').press('Escape');
 await expect(page.locator('.track-name').first()).toHaveText('Motion renamed track');expect(await page.evaluate(()=>__motionObserved.includes('rename'))).toBe(false);
 await page.evaluate(()=>{__motionObserved=[];});await page.locator('.track-name').first().click();await page.locator('.track-name-input').press('Enter');
 await expect(page.locator('.track-name').first()).toHaveText('Motion renamed track');expect(await page.evaluate(()=>__motionObserved.includes('rename'))).toBe(false);
});
