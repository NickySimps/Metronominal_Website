'use strict';
const {test,expect}=require('@playwright/test');const openMotion=require('./motionTestPage.cjs');
async function setup(page){await openMotion(page,test.info().config.metadata);await page.locator('#personal-monitoring > summary').click();await page.evaluate(async()=>{window.a=(await import(new URL('js/appState.js',document.baseURI))).default;window.monitor=(await import(new URL('js/monitoring.js',document.baseURI))).default;__motionObserved=[];});}

test('personal mute confirms the accepted local toggle without changing shared music',async({page})=>{
 await setup(page);const before=await page.evaluate(()=>a.getMusicalSnapshot());
 await page.locator('#monitor-mute').click();await expect(page.locator('#monitor-mute')).toHaveAttribute('aria-pressed','true');
 await expect.poll(()=>page.evaluate(()=>__motionObserved.includes('toggle'))).toBe(true);
 expect(await page.evaluate(()=>monitor.getState().muted)).toBe(true);expect(await page.evaluate(()=>a.getMusicalSnapshot())).toEqual(before);
});

test('personal listening level emits volume feedback after applying the actual level',async({page})=>{
 await setup(page);const before=await page.evaluate(()=>a.getMusicalSnapshot());
 await page.locator('#monitor-volume').evaluate(e=>{e.value='.35';e.dispatchEvent(new Event('input',{bubbles:true}));});
 await expect(page.locator('#monitor-volume-value')).toHaveText('35%');
 await expect.poll(()=>page.evaluate(()=>__motionObserved.includes('volume'))).toBe(true);
 expect(await page.evaluate(()=>monitor.getState().volume)).toBe(.35);expect(await page.evaluate(()=>a.getMusicalSnapshot())).toEqual(before);
});

test('reset listening mix acknowledges restoration while preserving shared track settings',async({page})=>{
 await setup(page);const before=await page.evaluate(()=>a.getMusicalSnapshot());
 await page.locator('#monitor-mute').click();await page.locator('[data-monitor-mute="0"]').click();
 await page.evaluate(()=>{__motionObserved=[];});await page.locator('#monitor-reset').click();
 await expect(page.locator('#monitor-mute')).toHaveAttribute('aria-pressed','false');await expect(page.locator('[data-monitor-mute="0"]')).toHaveAttribute('aria-pressed','false');
 await expect.poll(()=>page.evaluate(()=>__motionObserved.includes('reset'))).toBe(true);
 expect(await page.evaluate(()=>a.getMusicalSnapshot())).toEqual(before);
});
