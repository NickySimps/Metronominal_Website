'use strict';
const {test,expect}=require('@playwright/test');const openMotion=require('./motionTestPage.cjs');
async function ready(page){await openMotion(page,test.info().config.metadata);await expect(page.locator('#sync-quality')).toHaveText(/good/i);await page.evaluate(async()=>{window.a=(await import(new URL('js/appState.js',document.baseURI))).default;__motionObserved=[];});}

test('Play and Stop feedback follows the actual server-driven transport state',async({page})=>{
 await ready(page);expect(await page.evaluate(()=>a.isPlaying())).toBe(false);await page.locator('.start-stop-btn').click();
 await expect.poll(()=>page.evaluate(()=>a.isPlaying())).toBe(true);await expect(page.locator('.start-stop-btn')).toHaveClass(/active/);
 await expect.poll(()=>page.evaluate(()=>__motionObserved.includes('play'))).toBe(true);
 await page.evaluate(()=>{__motionObserved=[];});await page.locator('.start-stop-btn').click();
 await expect.poll(()=>page.evaluate(()=>a.isPlaying())).toBe(false);await expect.poll(()=>page.evaluate(()=>__motionObserved.includes('stop'))).toBe(true);
});

test('a held real toggle command cannot announce Play before it runs',async({page})=>{
 await ready(page);await page.evaluate(async()=>{
  const e=(await import(new URL('js/metronomeEngine.js',document.baseURI))).default,original=e.togglePlay;
  let release;const held=new Promise(r=>release=r);window.__motionReleaseToggle=release;
  e.togglePlay=async(...args)=>{window.__motionToggleReached=true;await held;return original(...args);};
 });
 await page.locator('.start-stop-btn').click();await page.waitForFunction(()=>window.__motionToggleReached);
 expect(await page.evaluate(()=>a.isPlaying())).toBe(false);expect(await page.evaluate(()=>__motionObserved.includes('play'))).toBe(false);
 await page.evaluate(()=>__motionReleaseToggle());await expect.poll(()=>page.evaluate(()=>a.isPlaying())).toBe(true);
 await expect.poll(()=>page.evaluate(()=>__motionObserved.includes('play'))).toBe(true);
});

test('feedback teardown leaves the real playback handler working without new motion',async({page})=>{
 await ready(page);expect(await page.evaluate(async()=>typeof (await import(new URL('js/playbackController.js',document.baseURI))).default.disposeMotionFeedback)).toBe('function');
 await page.evaluate(async()=>{(await import(new URL('js/playbackController.js',document.baseURI))).default.disposeMotionFeedback();__motionObserved=[];});
 await page.locator('.start-stop-btn').click();await expect.poll(()=>page.evaluate(()=>a.isPlaying())).toBe(true);
 expect(await page.evaluate(()=>__motionObserved.includes('play'))).toBe(false);
});
