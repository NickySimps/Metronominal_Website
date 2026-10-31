'use strict';
const {test,expect}=require('@playwright/test');const openMotion=require('./motionTestPage.cjs');
async function ready(page){await openMotion(page,test.info().config.metadata);await page.evaluate(async()=>{window.a=(await import(new URL('js/appState.js',document.baseURI))).default;__motionObserved=[];});}
for(const selector of ['.rest-button','.accent-button','.beat-edit-btn','.slice-btn']){
 test('edit tool '+selector+' acknowledges entering and leaving without changing music',async({page})=>{
  await ready(page);const music=await page.evaluate(()=>a.getMusicalSnapshot());await page.locator(selector).first().click();
  await expect(page.locator(selector).first()).toHaveClass(/active/);expect(await page.evaluate(()=>__motionObserved)).toContain('toggle');
  expect(await page.evaluate(()=>a.getMusicalSnapshot())).toEqual(music);
  await page.evaluate(()=>{__motionObserved=[];});await page.locator(selector).first().click();await expect(page.locator(selector).first()).not.toHaveClass(/active/);
  expect(await page.evaluate(()=>__motionObserved)).toContain('toggle');expect(await page.evaluate(()=>a.getMusicalSnapshot())).toEqual(music);
 });
}
test('sound picker opening and Escape closing have feedback without changing the selected sound',async({page})=>{
 await ready(page);const music=await page.evaluate(()=>a.getMusicalSnapshot());await page.locator('.main-beat-sound-select').first().click();
 await expect(page.locator('#sound-picker-modal')).toBeVisible();expect(await page.evaluate(()=>__motionObserved)).toContain('open');
 await page.evaluate(()=>{__motionObserved=[];});await page.keyboard.press('Escape');await expect(page.locator('#sound-picker-modal')).toBeHidden();
 expect(await page.evaluate(()=>__motionObserved)).toContain('close');expect(await page.evaluate(()=>a.getMusicalSnapshot())).toEqual(music);
});
test('reselecting the identical sound and native default settings closes without select success',async({page})=>{
 await ready(page);await page.locator('.main-beat-sound-select').first().click();await page.locator('.sound-picker-card[data-sound="Synth Sine"] .sound-picker-select').click();const before=await page.evaluate(()=>a.getMusicalSnapshot());await page.locator('.main-beat-sound-select').first().click();await page.evaluate(()=>{__motionObserved=[];});await page.locator('.sound-picker-card[data-sound="Synth Sine"] .sound-picker-select').click();await expect(page.locator('#sound-picker-modal')).toBeHidden();expect(await page.evaluate(()=>a.getMusicalSnapshot())).toEqual(before);expect(await page.evaluate(()=>__motionObserved.includes('select'))).toBe(false);expect(await page.evaluate(()=>__motionObserved.includes('close'))).toBe(true);
});

test('choosing a sound acknowledges the actual saved choice before the picker disappears',async({page})=>{
 await ready(page);await page.locator('.main-beat-sound-select').first().click();await page.evaluate(()=>{__motionObserved=[];});
 await page.locator('.sound-picker-card[data-sound="Synth Sine"] .sound-picker-select').click();await expect(page.locator('#sound-picker-modal')).toBeHidden();
 expect(await page.evaluate(()=>a.getTracks()[0].mainBeatSound.sound)).toBe('Synth Sine');expect(await page.evaluate(()=>__motionObserved)).toContain('select');
});
