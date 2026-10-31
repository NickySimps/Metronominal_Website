'use strict';
const {test,expect}=require('@playwright/test');const openMotion=require('./motionTestPage.cjs');
async function ready(page){await openMotion(page,test.info().config.metadata);await page.evaluate(async()=>{window.a=(await import(new URL('js/appState.js',document.baseURI))).default;__motionObserved=[];});}

test('tempo step and slider feedback follows the accepted musical BPM',async({page})=>{
 await ready(page);const tempo=await page.evaluate(()=>a.getTempo());await page.locator('.increase-tempo').click();
 expect(await page.evaluate(()=>a.getTempo())).toBe(tempo+1);await expect.poll(()=>page.evaluate(()=>__motionObserved.includes('tempo'))).toBe(true);
 await page.evaluate(()=>{__motionObserved=[];});await page.locator('.decrease-tempo').click();expect(await page.evaluate(()=>a.getTempo())).toBe(tempo);
 await expect.poll(()=>page.evaluate(()=>__motionObserved.includes('tempo'))).toBe(true);
 await page.evaluate(()=>{__motionObserved=[];});await page.locator('.slider').first().evaluate(el=>{el.value='155';el.dispatchEvent(new Event('input',{bubbles:true}));});
 expect(await page.evaluate(()=>a.getTempo())).toBe(155);await expect.poll(()=>page.evaluate(()=>__motionObserved.includes('tempo'))).toBe(true);
});

test('master volume confirms an actual change without unrelated music changes or animating a no-op input',async({page})=>{
 await ready(page);const music=await page.evaluate(()=>a.getMusicalSnapshot());await page.locator('.volume-slider').evaluate(el=>{el.value='0.35';el.dispatchEvent(new Event('input',{bubbles:true}));});
 expect(await page.evaluate(()=>a.getVolume())).toBe(0.35);await expect.poll(()=>page.evaluate(()=>__motionObserved.includes('volume'))).toBe(true);
 // Legacy master volume is an explicit musical snapshot field, unlike device-local monitoring.
 expect(await page.evaluate(()=>a.getMusicalSnapshot())).toEqual({...music,volume:0.35});
 await page.evaluate(()=>{__motionObserved=[];});await page.locator('.volume-slider').evaluate(el=>{el.value='0.35';el.dispatchEvent(new Event('input',{bubbles:true}));});
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));expect(await page.evaluate(()=>__motionObserved.includes('volume'))).toBe(false);
});
