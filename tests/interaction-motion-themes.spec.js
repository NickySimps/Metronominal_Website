'use strict';
const {test,expect}=require('@playwright/test');const openMotion=require('./motionTestPage.cjs');
async function ready(page){await openMotion(page,test.info().config.metadata);await page.evaluate(async()=>{window.a=(await import(new URL('js/appState.js',document.baseURI))).default;__motionObserved=[];});}
test('theme palette acknowledges opening and Escape closure without changing music',async({page})=>{
 await ready(page);const before=await page.evaluate(()=>a.getMusicalSnapshot());await page.locator('#theme-menu-toggle').click();
 await expect(page.locator('#theme-menu')).toBeVisible();expect(await page.evaluate(()=>__motionObserved)).toContain('open');
 await page.evaluate(()=>{__motionObserved=[];});await page.keyboard.press('Escape');await expect(page.locator('#theme-menu')).toBeHidden();
 expect(await page.evaluate(()=>__motionObserved)).toContain('close');expect(await page.evaluate(()=>a.getMusicalSnapshot())).toEqual(before);
});
test('named theme selection acknowledges the actual local theme and preserves music',async({page})=>{
 await ready(page);const before=await page.evaluate(()=>a.getMusicalSnapshot());await page.locator('#theme-menu-toggle').click();await page.evaluate(()=>{__motionObserved=[];});
 await page.locator('#theme-menu [data-theme="hiVis"]').click();expect(await page.evaluate(()=>a.getCurrentTheme())).toBe('hiVis');
 expect(await page.evaluate(()=>localStorage.getItem('selectedTheme'))).toBe('hiVis');expect(await page.evaluate(()=>__motionObserved)).toContain('theme');
 expect(await page.evaluate(()=>a.getMusicalSnapshot())).toEqual(before);
});
test('Random theme acknowledges actual palette regeneration rather than initialization',async({page})=>{
 await ready(page);expect(await page.evaluate(()=>__motionObserved.includes('randomize'))).toBe(false);const music=await page.evaluate(()=>a.getMusicalSnapshot());
 await page.locator('#theme-menu-toggle').click();await page.locator('#theme-menu [data-theme="random"]').click();
 expect(await page.evaluate(()=>a.getCurrentTheme())).toBe('random');expect(await page.evaluate(()=>__motionObserved)).toContain('randomize');
 const before=await page.evaluate(()=>['--Main','--Background','--Highlight'].map(k=>document.documentElement.style.getPropertyValue(k)));
 await page.evaluate(()=>{__motionObserved=[];});await page.locator('#theme-menu [data-theme="random"]').click();
 expect(await page.evaluate(()=>['--Main','--Background','--Highlight'].map(k=>document.documentElement.style.getPropertyValue(k)))).not.toEqual(before);
 expect(await page.evaluate(()=>__motionObserved)).toContain('randomize');expect(await page.evaluate(()=>a.getMusicalSnapshot())).toEqual(music);
});
