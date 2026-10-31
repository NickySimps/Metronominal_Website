'use strict';
const {test,expect}=require('@playwright/test');
async function editorPage(page){
 await page.route('**/script.js',r=>r.abort()); await page.goto('./');
 await page.evaluate(async()=>{
  window.editor=(await import(new URL('js/soundSettingsModal.js',document.baseURI))).default;
  window.a=(await import(new URL('js/appState.js',document.baseURI))).default;
  (await import(new URL('js/themeController.js',document.baseURI))).default.applyTheme('dark');
  (await import(new URL('js/interactionMotion.js',document.baseURI))).initializeInteractionMotion(document);
  a.initializeAudioContext(); if(!a.getTracks().length)a.addTrack();
  window.observed=[];
  new MutationObserver(rs=>{for(const r of rs)for(const n of r.addedNodes)if(n.nodeType===1&&n.dataset.motionKind){const b=n.getBoundingClientRect();observed.push({kind:n.dataset.motionKind,x:b.x,y:b.y,width:b.width,height:b.height,viewport:[innerWidth,innerHeight]});}}).observe(document.querySelector('[data-interaction-motion-root]'),{childList:true,subtree:true});
  editor.init();editor.show(0,'mainBeatSound');
 });
 await expect(page.locator('#sound-settings-modal')).toBeVisible();
 expect(await page.evaluate(()=>observed.filter(e=>e.kind==='adjust'||e.kind==='toggle'||e.kind==='select'))).toEqual([]);
 if(await page.locator('#sound-advanced-toggle').getAttribute('aria-expanded')!=='true')await page.locator('#sound-advanced-toggle').click();
 await clear(page);
}
async function clear(page){await page.evaluate(()=>{observed=[];});}
async function feedback(page,kind){
 await expect.poll(()=>page.evaluate(()=>observed.map(e=>e.kind))).toEqual([kind]);
 const e=await page.evaluate(()=>observed[0]);
 expect(e.width).toBeGreaterThan(0);expect(e.height).toBeGreaterThan(0);
 expect(e.x+e.width).toBeGreaterThan(0);expect(e.y+e.height).toBeGreaterThan(0);
 expect(e.x).toBeLessThan(e.viewport[0]);expect(e.y).toBeLessThan(e.viewport[1]);
 await test.info().attach('viewport-feedback',{body:Buffer.from(JSON.stringify(e)),contentType:'application/json'});
}
async function state(page,param){return page.evaluate(p=>({draft:editor.currentSoundSettings[p],saved:editor.getCurrentSoundInfo().settings[p]}),param);}

test('scope selection acknowledges only local changes, not reselection',async({page})=>{
 await editorPage(page);const before=await page.evaluate(()=>a.getMusicalSnapshot());
 await page.locator('#sound-scope-mode-select').selectOption('spectrum');
 expect(await page.evaluate(()=>editor.scopeMode)).toBe('spectrum');await feedback(page,'select');
 expect(await page.evaluate(()=>a.getMusicalSnapshot())).toEqual(before);
 await clear(page);await page.locator('#sound-scope-mode-select').selectOption('spectrum');expect(await page.evaluate(()=>observed)).toEqual([]);
});

test('Note Snap changes local snap points and gives one toggle without musical edits',async({page})=>{
 await editorPage(page);const before=await page.evaluate(()=>a.getMusicalSnapshot());
 await page.locator('#note-snap-btn').click();
 expect(await page.evaluate(()=>editor.isNoteSnapping)).toBe(true);await expect(page.locator('#note-snap-btn')).toHaveClass(/active/);
 expect(await page.evaluate(()=>editor.sliders.find(s=>s.sliderElement.dataset.param==='startFrequency').snapPoints.length)).toBeGreaterThan(1);
 await feedback(page,'toggle');expect(await page.evaluate(()=>a.getMusicalSnapshot())).toEqual(before);
});

test('FX bypass acknowledges actual saved setting without duplicate reverse hooks',async({page})=>{
 await editorPage(page);await page.locator('#sample-fx-toggle').check();await expect(page.locator('#sample-fx-toggle')).toBeChecked();
 expect(await state(page,'fxBypass')).toEqual({draft:true,saved:true});await feedback(page,'toggle');
 await clear(page);await page.locator('#sample-fx-toggle').dispatchEvent('change');expect(await page.evaluate(()=>observed)).toEqual([]);
});

test('delay quantization toggles real snap points with exactly one feedback',async({page})=>{
 await editorPage(page);await page.locator('#sound-effects-btn').click();await clear(page);
 await page.locator('#delay-quantize-btn').click();await expect(page.locator('#delay-quantize-btn')).toHaveAttribute('aria-pressed','true');
 expect(await page.evaluate(()=>editor.delayQuantizeEnabled)).toBe(true);
 expect(await page.evaluate(()=>editor.sliders.find(s=>s.sliderElement.dataset.param==='delayTime').snapPoints.length)).toBeGreaterThan(1);
 const delay=await state(page,'delayTime');expect(delay.draft).toBe(delay.saved);await feedback(page,'toggle');
});

test('no-op snapped endpoints, disabled and unavailable controls give no false success; reset animations stay independent',async({page})=>{
 await editorPage(page);await page.locator('#note-snap-btn').click();
 const slider=page.locator('#sound-param-startFrequency');await slider.scrollIntoViewIfNeeded();
 await page.evaluate(()=>{const s=editor.sliders.find(s=>s.sliderElement.dataset.param==='startFrequency');s.setValue(s.snapPoints.at(-1));});
 await clear(page);const before=await state(page,'startFrequency');await slider.locator('..').locator('.slider-button-increment').click();
 expect(await state(page,'startFrequency')).toEqual(before);expect(await page.evaluate(()=>observed)).toEqual([]);
 await slider.evaluate(el=>{el.disabled=true;});await slider.dispatchEvent('input');expect(await page.evaluate(()=>observed)).toEqual([]);
 await slider.evaluate(el=>{el.disabled=false;});
 await page.evaluate(()=>{editor.currentTrackIndex=999;});await slider.focus();await slider.press('ArrowLeft');expect(await page.evaluate(()=>observed)).toEqual([]);
 await page.evaluate(()=>{editor.currentTrackIndex=0;});
 await page.locator('#sound-effects-btn').click();await clear(page);await page.locator('#effects-reset-btn').click();
 await expect(page.locator('#effects-reset-btn')).toHaveClass(/resetting/);await page.waitForTimeout(400);expect(await page.evaluate(()=>observed)).toEqual([]);
 await page.locator('#sound-effects-bottom-close').click();await clear(page);await page.locator('#reset-sound-btn').click();
 await expect(page.locator('#reset-sound-btn')).toHaveClass(/resetting/);await page.waitForTimeout(400);
 expect(await page.evaluate(()=>observed.filter(e=>e.kind==='adjust'||e.kind==='toggle'))).toEqual([]);
});

test('narrow reduced-motion parameter feedback remains visible and static',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});
 await page.clock.install({time:new Date('2026-10-29T12:00:00Z')});await editorPage(page);await page.locator('#sound-effects-btn').click();
 const slider=page.locator('#sound-param-distortion');await slider.scrollIntoViewIfNeeded();await page.clock.pauseAt(new Date('2026-10-29T12:00:10Z'));await clear(page);await slider.focus();await slider.press('ArrowRight');
 expect(await state(page,'distortion')).toEqual({draft:0.01,saved:0.01});await feedback(page,'adjust');
 await expect(page.locator('[data-motion-kind="adjust"]')).toHaveCount(1);
 const moving=await page.evaluate(()=>[...document.querySelectorAll('[data-motion-kind="adjust"]')].flatMap(el=>el.getAnimations()).some(a=>a.playState==='running'));
 expect(moving).toBe(false);await page.screenshot({path:test.info().outputPath('narrow-reduced-motion.png')});
});

// A vertical tracer: real range keyboard and real stepper, across each shared control family.
test('accepted ADSR frequency filter pitch and FX edits acknowledge exactly once; programmatic updates stay quiet',async({page})=>{
 await editorPage(page);
 const cases=[['attack',0.001],['decay',0.001],['sustain',0.001],['release',0.001],['startFrequency',1],['endFrequency',1],['pitchEnvelopeTime',0.001],['highPassFrequency',1],['lowPassFrequency',1],['pitchShift',1],['distortion',0.01],['delayMix',0.01],['delayTime',0.001],['delayFeedback',0.01],['reverbMix',0.01],['reverbFeedback',0.01]];
 for(const [param,scale] of cases){
  if(param==='pitchShift')await page.locator('#sound-effects-btn').click();
  const slider=page.locator(`#sound-param-${param}`);await expect(slider).toBeVisible();await slider.scrollIntoViewIfNeeded();
  const before=await state(page,param);const old=Number(await slider.inputValue());const max=Number(await slider.getAttribute('max'));const direction=old>=max?-1:1;
  await clear(page);await slider.focus();await slider.press(direction===1?'ArrowRight':'ArrowLeft');
  const after=await state(page,param);expect(after.saved).not.toBe(before.saved);expect(after.draft).toBe(after.saved);expect(after.saved).toBeCloseTo((old+direction)*scale,6);await feedback(page,'adjust');
  await clear(page);await slider.locator('..').locator(direction===1?'.slider-button-decrement':'.slider-button-increment').click();
  expect((await state(page,param)).saved).toBeCloseTo(old*scale,6);await feedback(page,'adjust');
 }
 await clear(page);await page.evaluate(()=>{const s=editor.sliders.find(s=>s.sliderElement.dataset.param==='distortion');s.setValue(23);});
 expect(await state(page,'distortion')).toEqual({draft:0.23,saved:0.23});expect(await page.evaluate(()=>observed)).toEqual([]);
});
