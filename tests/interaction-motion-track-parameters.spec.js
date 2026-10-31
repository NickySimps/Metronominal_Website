'use strict';
const {test,expect}=require('@playwright/test');const openMotion=require('./motionTestPage.cjs');
async function ready(page){await openMotion(page,test.info().config.metadata);await page.evaluate(async()=>{window.a=(await import(new URL('js/appState.js',document.baseURI))).default;__motionObserved=[];});}
for(const [selector,key,value,kind] of [['.track-volume-slider','volume',0.4,'volume'],['.track-pitch-slider','pitchShift',3,'adjust'],['.track-swing-slider','swing',22,'adjust']]){
 test('accepted track '+key+' input has feedback without an unchanged-value false confirmation',async({page})=>{
  await ready(page);await page.locator(selector).first().evaluate((el,value)=>{el.value=String(value);el.dispatchEvent(new Event('input',{bubbles:true}));},value);
  expect(await page.evaluate(key=>a.getTracks()[0][key],key)).toBe(value);await expect.poll(()=>page.evaluate(kind=>__motionObserved.includes(kind),kind)).toBe(true);
  await page.evaluate(()=>{__motionObserved=[];});await page.locator(selector).first().evaluate((el,value)=>{el.value=String(value);el.dispatchEvent(new Event('input',{bubbles:true}));},value);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));expect(await page.evaluate(kind=>__motionObserved.includes(kind),kind)).toBe(false);
 });
}
test('duplicating the selected bar acknowledges its actual new musical bar',async({page})=>{
 await ready(page);const before=await page.evaluate(()=>a.getTracks()[0].barSettings.length);await page.locator('.duplicate-bar-btn').first().click();
 expect(await page.evaluate(()=>a.getTracks()[0].barSettings.length)).toBe(before+1);await expect.poll(()=>page.evaluate(()=>__motionObserved.includes('copy'))).toBe(true);
});
