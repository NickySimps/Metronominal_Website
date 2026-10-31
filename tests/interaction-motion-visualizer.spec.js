'use strict';
const {test,expect}=require('@playwright/test');
const openMotion=require('./motionTestPage.cjs');
async function ready(page,metadata){await openMotion(page,metadata);await page.evaluate(async()=>{window.osc=(await import('/js/oscilloscope.js')).default;window.a=(await import('/js/appState.js')).default;});await page.keyboard.press('Shift');await expect.poll(()=>page.evaluate(async()=> (await import('/js/userInteraction.js')).default.audioContextInitialized)).toBe(true);await page.evaluate(()=>{__motionObserved=[];});}
for(const reduced of ['reduce','no-preference'])test('synthetic visualizer hold feedback owns its cleanup and preserves input geometry with '+reduced,async({page},info)=>{
 await page.emulateMedia({reducedMotion:reduced});await ready(page,info.config.metadata);
 const sample=await page.locator('#visualizer-mode-btn').evaluate(button=>{
  const before=button.getBoundingClientRect().toJSON();const mode=osc.mode;
  button.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,button:0,pointerType:'touch',pointerId:77,clientX:before.x+5,clientY:before.y+5}));
  const ring=document.querySelector('[data-motion-kind="hold"]');const after=button.getBoundingClientRect().toJSON();
  const value={exists:!!ring,before,after,pointer:ring&&getComputedStyle(ring).pointerEvents,animation:ring&&getComputedStyle(ring).animationName,inert:!!ring?.parentElement.inert,hidden:ring?.getAttribute('aria-hidden')};
  button.dispatchEvent(new PointerEvent('pointercancel',{bubbles:true,pointerType:'touch',pointerId:77}));
  return {...value,left:document.querySelectorAll('[data-motion-kind="hold"]').length,unchanged:osc.mode===mode};
 });
 expect(sample.exists).toBe(true);expect(sample.before).toEqual(sample.after);expect(sample.pointer).toBe('none');expect(sample.inert).toBe(true);expect(sample.hidden).toBe('true');if(reduced==='reduce')expect(sample.animation).toBe('none');expect(sample.left).toBe(0);expect(sample.unchanged).toBe(true);
 await page.waitForTimeout(550);await expect(page.locator('#visualizer-mode-menu')).toBeHidden();
});

test('decoration preserves legacy moved-hold acceptance and Escape closes its real menu',async({page},info)=>{
 await ready(page,info.config.metadata);const button=page.locator('#visualizer-mode-btn'),menu=page.locator('#visualizer-mode-menu');const box=await button.boundingBox();
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
 // Preserve the original gesture semantics, including its ineffective 18px
 // cancellation origin. Repairing that legacy behavior is a separate change.
 try{await page.mouse.move(box.x+box.width/2+25,box.y+box.height/2);await expect(menu).toBeVisible();await expect(page.locator('[data-motion-kind="hold"]')).toHaveCount(0);}finally{await page.mouse.up();}
 await page.evaluate(()=>{__motionObserved=[];});await page.keyboard.press('Escape');await expect(menu).toBeHidden();await expect(button).toBeFocused();await expect.poll(()=>page.evaluate(()=>__motionObserved.includes('close'))).toBe(true);
});

test('visualizer chooser acknowledges actual open selection and closure with silent programmatic changes',async({page},info)=>{
 await ready(page,info.config.metadata);const button=page.locator('#visualizer-mode-btn'),menu=page.locator('#visualizer-mode-menu');const before=await page.evaluate(()=>a.getMusicalSnapshot());
 await button.click({button:'right'});await expect(menu).toBeVisible();await expect.poll(()=>page.evaluate(()=>__motionObserved.includes('open'))).toBe(true);
 const mode=await page.evaluate(()=>osc.modes.find(mode=>mode!==osc.mode));await page.evaluate(()=>{__motionObserved=[];});await menu.locator(`[data-mode="${mode}"]`).click();
 await expect(menu).toBeHidden();expect(await page.evaluate(()=>osc.mode)).toBe(mode);await expect.poll(()=>page.evaluate(()=>__motionObserved.includes('select'))).toBe(true);
 await button.click({button:'right'});await page.evaluate(()=>{__motionObserved=[];});await page.locator('#theme-menu-toggle').click();await expect(menu).toBeHidden();await expect.poll(()=>page.evaluate(()=>__motionObserved.includes('close'))).toBe(true);
 expect(await page.evaluate(()=>a.getMusicalSnapshot())).toEqual(before);await page.evaluate(()=>{__motionObserved=[];osc.setModeForTheme('dark');});expect(await page.evaluate(()=>__motionObserved)).toEqual([]);
});

test('visualizer cycle acknowledges its actual local mode without changing music or geometry',async({page},info)=>{
 await ready(page,info.config.metadata);const button=page.locator('#visualizer-mode-btn');await button.scrollIntoViewIfNeeded();
 const before=await page.evaluate(()=>({music:a.getMusicalSnapshot(),mode:osc.mode}));await page.evaluate(()=>{__motionObserved=[];});
 await button.click();expect(await page.evaluate(()=>osc.mode)).not.toBe(before.mode);
 await expect.poll(()=>page.evaluate(()=>__motionObserved.includes('select'))).toBe(true);
 expect(await page.evaluate(()=>a.getMusicalSnapshot())).toEqual(before.music);
 await page.evaluate(()=>{__motionObserved=[];osc.setMode(osc.mode);});expect(await page.evaluate(()=>__motionObserved)).toEqual([]);
});
