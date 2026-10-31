'use strict';
const {test,expect}=require('@playwright/test');const openMotion=require('./motionTestPage.cjs');
async function dense(page,mode='rest'){
 await openMotion(page,test.info().config.metadata);
 await page.evaluate(async()=>{
  (await import(new URL('js/themeController.js',document.baseURI))).default.applyTheme('dark');
  window.a=(await import(new URL('js/appState.js',document.baseURI))).default;const d=(await import(new URL('js/barDisplayController.js',document.baseURI))).default;
  const bar=a.getTracks()[0].barSettings[0];a.updateTrack(0,{barSettings:[{...bar,beats:8,subdivision:8,rests:[],velocities:{},beatSlices:{},beatSounds:{}}]});d.renderBarsAndControls();
 });
 await page.locator(mode==='rest'?'.rest-button':mode==='slice'?'.slice-btn':'.accent-button').first().click();
 await page.mouse.move(0,0);await page.locator('.beat-square[data-beat-index="16"]').first().scrollIntoViewIfNeeded();
 await page.evaluate(async()=>{await document.fonts.ready;document.getAnimations().forEach(a=>{if(Number.isFinite(a.effect?.getComputedTiming().endTime))a.finish();});await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));__motionObserved=[];});
}
async function pointers(page,points){await page.evaluate(points=>{
 for(const [type,index,time,dx=0]of points){const b=document.querySelector(`.bar-visual[data-container-index="0"][data-bar-index="0"] .beat-square[data-beat-index="${index}"]`),r=b.getBoundingClientRect(),e=new PointerEvent(type,{bubbles:true,cancelable:true,pointerType:'touch',pointerId:751,isPrimary:true,clientX:r.x+r.width/2+dx,clientY:r.y+r.height/2});Object.defineProperty(e,'timeStamp',{value:time});b.dispatchEvent(e);}
},points);}

test('owned beat hold displays progress and pointercancel removes it without editing music',async({page})=>{
 await dense(page);const before=await page.evaluate(()=>a.getMusicalSnapshot());
 await pointers(page,[['pointerdown',16,1000]]);
 await expect(page.locator('[data-motion-kind="hold"]')).toHaveCount(1);
 await pointers(page,[['pointercancel',16,1010]]);
 await expect(page.locator('[data-motion-kind="hold"]')).toHaveCount(0);
 expect(await page.evaluate(()=>a.getMusicalSnapshot())).toEqual(before);
});

test('slow Precision opening acknowledges the preview without committing its target',async({page})=>{
 await dense(page);const before=await page.evaluate(()=>a.getMusicalSnapshot());
 await pointers(page,[['pointerdown',16,1000],['pointermove',16,1080,6],['pointermove',16,1160,12]]);
 await expect(page.locator('[data-beat-precision-lens]')).toBeVisible();
 await expect.poll(()=>page.evaluate(()=>__motionObserved.includes('open'))).toBe(true);
 expect(await page.evaluate(()=>a.getMusicalSnapshot())).toEqual(before);
 await pointers(page,[['pointercancel',16,1170]]);
});

for(const [mode,kind]of [['rest','rest'],['accent','accent'],['slice','slice']]){
 test(`accepted fast ${mode} stroke has semantic ${kind} feedback and keeps target geometry`,async({page})=>{
  await dense(page,mode);
  const geometry=await page.locator('.beat-square[data-beat-index="19"]').first().boundingBox();
  await pointers(page,[['pointerdown',16,1000],['pointermove',19,1040],['pointerup',19,1050]]);
  const settings=await page.evaluate(()=>a.getTracks()[0].barSettings[0]);
  if(mode==='rest')expect(settings.rests.slice().sort((a,b)=>a-b)).toEqual([16,17,18,19]);
  else if(mode==='slice')for(const i of [16,17,18,19])expect(settings.beatSlices[i]).toBe(2);
  else for(const i of [16,17,18,19])expect(settings.velocities[i]).toBeGreaterThan(.7);
  await expect.poll(()=>page.evaluate(kind=>__motionObserved.includes(kind),kind)).toBe(true);
  expect(await page.locator('.beat-square[data-beat-index="19"]').first().boundingBox()).toEqual(geometry);
 });
}
