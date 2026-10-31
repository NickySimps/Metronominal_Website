'use strict';
const {test,expect}=require('@playwright/test');
const target='.bar-visual[data-container-index="0"][data-bar-index="0"] .beat-square[data-beat-index="1"]';
async function ready(page){
 await page.route('**/script.js',r=>r.abort());await page.goto('./');
 await page.evaluate(async()=>{
  window.editor=(await import('./js/soundSettingsModal.js')).default;
  window.a=(await import('./js/appState.js')).default;
  (await import('./js/themeController.js')).default.applyTheme('dark');
  (await import('./js/interactionMotion.js')).initializeInteractionMotion(document);
  a.initializeAudioContext();if(!a.getTracks().length)a.addTrack();
  (await import('./js/tracksController.js')).default.renderTracks();
  window.bars=(await import('./js/barDisplayController.js')).default;bars.renderBarsAndControls();
  window.observed=[];new MutationObserver(rs=>{for(const r of rs)for(const n of r.addedNodes)if(n.nodeType===1&&n.dataset.motionKind)observed.push({kind:n.dataset.motionKind,x:parseFloat(n.style.left),y:parseFloat(n.style.top),width:parseFloat(n.style.width),height:parseFloat(n.style.height),moving:n.getAnimations().some(animation=>animation.playState==='running')});}).observe(document.querySelector('[data-interaction-motion-root]'),{childList:true,subtree:true});
  editor.init();
 });
 await page.locator(target).scrollIntoViewIfNeeded();
 await page.evaluate(()=>editor.show(0,'subdivisionSound',{barIndex:0,beatIndex:1}));
 await expect(page.locator('#sound-settings-modal')).toBeVisible();
 await page.evaluate(()=>{observed=[];});
}
test('identical saves, invalid sound and track-level saves never acknowledge a beat',async({page})=>{
 await ready(page);
 await page.evaluate(()=>{
  const info={sound:editor.getCurrentSoundInfo().sound,settings:structuredClone(editor.currentSoundSettings)};
  editor.saveCurrentSoundInfo(info);editor.saveCurrentSoundInfo(structuredClone(info));
  editor.saveCurrentSoundInfo(null);editor.saveCurrentSoundInfo({settings:{probability:40}});
 });
 expect(await beatFeedback(page)).toEqual([]);
 await page.evaluate(()=>{editor.show(0,'subdivisionSound');observed=[];editor.updateSoundSetting('probability',70);});
 expect(await beatFeedback(page)).toEqual([]);
});
for(const boundary of ['roomauthoritychange','syncrolechange','closed','replacement','rerender','invalid-bar','invalid-beat','guest'])test('no edited-cell success after '+boundary,async({page})=>{
 await ready(page);
 await page.evaluate(boundary=>{
  if(boundary==='roomauthoritychange'||boundary==='syncrolechange')document.dispatchEvent(new Event(boundary));
  if(boundary==='closed')editor.hide();
  if(boundary==='replacement')a.updateTrack(0,{barSettings:structuredClone(a.getTracks()[0].barSettings)});
  if(boundary==='rerender'){const beat=document.querySelector('.bar-visual[data-container-index="0"][data-bar-index="0"] .beat-square[data-beat-index="1"]');beat.replaceWith(beat.cloneNode(true));}
  if(boundary==='invalid-bar')editor.currentBarIndex=999;
  if(boundary==='invalid-beat')editor.currentBeatIndex=999;
  if(boundary==='guest'){document.querySelector('#share-btn').classList.add('connected');window.isHost=false;}
  observed=[];
  editor.saveCurrentSoundInfo({sound:'Synth HiHat',settings:{...editor.currentSoundSettings,probability:65}});
 },boundary);
 expect(await beatFeedback(page)).toEqual([]);
});
test('re-saving the unmodified inherited sound stays quiet despite editor defaults',async({page})=>{
 await ready(page);await page.evaluate(()=>editor.saveCurrentSoundInfo(structuredClone(editor.getCurrentSoundInfo())));
 expect(await beatFeedback(page)).toEqual([]);
});
for(const result of [false,true])test('a setter result of '+result+' without an applied change gives no beat success',async({page})=>{
 await ready(page);
 const before=await page.evaluate(()=>a.getMusicalSnapshot());
 await page.evaluate(result=>{const setter=a.setBeatSound;a.setBeatSound=()=>result;try{editor.saveCurrentSoundInfo({sound:'Synth HiHat',settings:{...editor.currentSoundSettings,probability:35}});}finally{a.setBeatSound=setter;}},result);
 expect(await page.evaluate(()=>a.getMusicalSnapshot())).toEqual(before);expect(await beatFeedback(page)).toEqual([]);
});
for(const boundary of ['roomauthoritychange','syncrolechange'])test('authority boundary during accepted setter suppresses stale beat acknowledgement '+boundary,async({page})=>{
 await ready(page);
 await page.evaluate(boundary=>{const setter=a.setBeatSound;a.setBeatSound=(...args)=>{const result=setter(...args);document.dispatchEvent(new Event(boundary));return result;};try{editor.saveCurrentSoundInfo({sound:'Synth HiHat',settings:{...editor.currentSoundSettings,probability:35}});}finally{a.setBeatSound=setter;}},boundary);
 expect(await page.evaluate(()=>a.getTracks()[0].barSettings[0].beatSounds[1].subdivisionSound.settings.probability)).toBe(35);
 expect(await beatFeedback(page)).toEqual([]);
});
test('a main-beat override acknowledges beat zero rather than the previously edited subdivision',async({page})=>{
 await ready(page);
 await page.evaluate(()=>{editor.show(0,'mainBeatSound',{barIndex:0,beatIndex:0});observed=[];});
 await page.locator('#sample-probability').focus();await page.locator('#sample-probability').press('ArrowLeft');
 expect(await page.evaluate(()=>a.getTracks()[0].barSettings[0].beatSounds[0].mainBeatSound.settings.probability)).toBe(99);
 expect(await beatFeedback(page)).toEqual([]);
 const geometry=await page.locator(target.replace('data-beat-index="1"','data-beat-index="0"')).boundingBox();
 expect(geometry.width).toBeGreaterThan(0);expect(geometry.height).toBeGreaterThan(0);
 await expect.poll(()=>page.evaluate(rect=>observed.filter(e=>Math.abs(e.x-rect.x)<1&&Math.abs(e.y-rect.y)<1&&Math.abs(e.width-rect.width)<1&&Math.abs(e.height-rect.height)<1).map(e=>e.kind),geometry)).toEqual(['adjust']);
});
async function beatFeedback(page){return page.evaluate(selector=>{const r=document.querySelector(selector)?.getBoundingClientRect();return observed.filter(e=>r&&Math.abs(e.x-r.x)<1&&Math.abs(e.y-r.y)<1&&Math.abs(e.width-r.width)<1&&Math.abs(e.height-r.height)<1);},target);}
for(const reducedMotion of ['no-preference','reduce'])test('accepted beat sound override acknowledges its exact affected cell '+reducedMotion,async({page})=>{
 await page.emulateMedia({reducedMotion});await ready(page);
 const before=await page.evaluate(()=>a.getTracks()[0].mainBeatSound);
 await page.locator('#sample-probability').focus();await page.locator('#sample-probability').press('ArrowLeft');
 expect(await page.evaluate(()=>a.getTracks()[0].barSettings[0].beatSounds[1].subdivisionSound.settings.probability)).toBe(99);
 expect(await page.evaluate(()=>a.getTracks()[0].mainBeatSound)).toEqual(before);
 await expect.poll(()=>beatFeedback(page)).toEqual([expect.objectContaining({kind:'adjust'})]);
 if(reducedMotion==='reduce')expect((await beatFeedback(page))[0].moving).toBe(false);
 // A second edit uses the already-owned mutable override, not the track fallback.
 await page.evaluate(()=>{observed=[];});await page.locator('#sample-probability').press('ArrowLeft');
 expect(await page.evaluate(()=>a.getTracks()[0].barSettings[0].beatSounds[1].subdivisionSound.settings.probability)).toBe(98);
 await expect.poll(()=>beatFeedback(page)).toEqual([expect.objectContaining({kind:'adjust'})]);
 await expect.poll(()=>page.locator('[data-motion-kind]').count()).toBe(0);
});
