'use strict';
const {test,expect}=require('@playwright/test');
const open=require('./motionTestPage.cjs');
async function setup(page,metadata){
 await open(page,metadata);
 await page.locator('.rest-button').first().click();
 await page.evaluate(async()=>{
  window.a=(await import('/js/appState.js')).default;
  window.h=(await import('/js/editHistory.js')).initializeHistoryControls(document.querySelector('.edit-history').parentElement);
  h.clear(); window.beforePrecision=structuredClone(a.getMusicalSnapshot());
  window.precisionMutations=0; a.subscribeMusicalMutations(()=>precisionMutations++);
  __motionObserved=[];
 });
}
async function unchanged(page){
 expect(await page.evaluate(()=>a.getMusicalSnapshot())).toEqual(await page.evaluate(()=>beforePrecision));
 expect(await page.evaluate(()=>precisionMutations)).toBe(0);
 expect(await page.evaluate(()=>h.undo())).toBe(false);
}
test('precision assistance toggles acknowledge the local setting without music or history edits',async({page},info)=>{
 await setup(page,info.config.metadata);
 const toggle=page.locator('[data-beat-precision-toggle]').first();
 for(const value of ['false','true']){
  await page.evaluate(()=>{__motionObserved=[];});
  if(value==='false')await toggle.click();else await toggle.press('Space');
  await expect(toggle).toHaveAttribute('aria-pressed',value);
  await expect.poll(()=>page.evaluate(()=>__motionObserved.filter(k=>k==='toggle'))).toEqual(['toggle']);
 }
 await unchanged(page);
});
test('keyboard targeting acknowledges changed beats but not a clamped boundary, without editing',async({page},info)=>{
 await setup(page,info.config.metadata);
 const beats=page.locator('.bar-visual[data-container-index="0"][data-bar-index="0"] .beat-square:not(.removing-beat-animation)');
 await beats.first().focus();await page.evaluate(()=>{__motionObserved=[];});
 await page.keyboard.press('ArrowRight');
 await expect(beats.nth(1)).toBeFocused();await expect(beats.nth(1)).toHaveClass(/beat-precision-selected/);
 await expect.poll(()=>page.evaluate(()=>__motionObserved.filter(k=>k==='select'))).toEqual(['select']);
 await page.keyboard.press('ArrowLeft');await expect(beats.first()).toBeFocused();
 await page.evaluate(()=>{__motionObserved=[];});await page.keyboard.press('ArrowLeft');
 expect(await page.evaluate(()=>__motionObserved)).toEqual([]);
 await unchanged(page);
});
test('Escape acknowledges releasing a keyboard target once and preserves existing Escape ownership',async({page},info)=>{
 await setup(page,info.config.metadata);
 const beats=page.locator('.bar-visual[data-container-index="0"][data-bar-index="0"] .beat-square:not(.removing-beat-animation)');
 await beats.first().focus();await page.keyboard.press('ArrowRight');
 await page.evaluate(()=>{__motionObserved=[];const e=new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true});e.preventDefault();document.activeElement.dispatchEvent(e);});
 await expect(beats.nth(1)).toHaveClass(/beat-precision-selected/);
 expect(await page.evaluate(()=>__motionObserved)).toEqual([]);
 await page.keyboard.press('Escape');
 await expect(page.locator('.beat-precision-selected')).toHaveCount(0);
 await expect(page.locator('[data-beat-precision-toggle]').first()).toBeFocused();
 await expect.poll(()=>page.evaluate(()=>__motionObserved.filter(k=>k==='cancel'))).toEqual(['cancel']);
 await page.evaluate(()=>{__motionObserved=[];});await page.keyboard.press('Escape');
 expect(await page.evaluate(()=>__motionObserved)).toEqual([]);
 await unchanged(page);
});
test('range and participant keyboard guards remain silent and non-editing',async({page},info)=>{
 await setup(page,info.config.metadata);
 for(const boundary of ['range','participant']){
  await page.evaluate(boundary=>{
   const root=document.querySelector('#all-tracks-wrapper');
   if(boundary==='range')root.setAttribute('data-range-selection','');
   else {root.removeAttribute('data-range-selection');document.dispatchEvent(new CustomEvent('syncrolechange',{detail:{state:'connected',isHost:false}}));}
   __motionObserved=[];
   const beat=root.querySelector('.beat-square[data-beat-index="0"]');beat.focus();
   // Space deliberately remains the app's global transport shortcut when
   // precision does not own input; do not mistake its Play cue for selection.
   for(const key of ['ArrowRight','Enter'])beat.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}));
  },boundary);
  expect(await page.evaluate(()=>__motionObserved)).toEqual([]);
  await expect(page.locator('.beat-precision-selected')).toHaveCount(0);
 }
 await unchanged(page);
});
for(const key of ['Enter','Space'])test('keyboard '+key+' retains exactly one native beat action and history entry',async({page},info)=>{
 await setup(page,info.config.metadata);
 const beat=page.locator('.bar-visual[data-container-index="0"][data-bar-index="0"] .beat-square[data-beat-index="1"]:not(.removing-beat-animation)');
 await beat.focus();await page.evaluate(()=>{__motionObserved=[];});await page.keyboard.press(key);
 await expect(beat).toHaveClass(/rested/);
 await expect.poll(()=>page.evaluate(()=>__motionObserved.filter(k=>['rest','select'].includes(k)))).toEqual(['rest']);
 expect(await page.evaluate(()=>precisionMutations)).toBe(1);
 expect(await page.evaluate(()=>h.undo())).toBe(true);
 expect(await page.evaluate(()=>a.getMusicalSnapshot())).toEqual(await page.evaluate(()=>beforePrecision));
 expect(await page.evaluate(()=>h.undo())).toBe(false);
});
