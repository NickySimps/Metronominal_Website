'use strict';
const {test,expect}=require('@playwright/test');
async function editorPage(page,sample){
 await page.route('**/script.js',route=>route.abort());await page.goto('./');
 await page.evaluate(async sample=>{
  window.editor=(await import('/js/soundSettingsModal.js')).default;window.a=(await import('/js/appState.js')).default;(await import('/js/themeController.js')).default.applyTheme('dark');(await import('/js/interactionMotion.js')).initializeInteractionMotion(document);a.initializeAudioContext();if(!a.getTracks().length)a.addTrack();
  if(sample){const context=a.getAudioContext(),buffer=context.createBuffer(1,context.sampleRate,context.sampleRate),data=buffer.getChannelData(0);for(let i=0;i<data.length;i++)data[i]=.4*Math.sin(2*Math.PI*440*i/context.sampleRate);a.addRecording('Generated waveform');a.setSoundBuffer('Generated waveform',buffer);a.updateTrack(0,{mainBeatSound:{sound:'Generated waveform',settings:{volume:.7,trimStart:0,trimEnd:1}}});}
  window.observed=[];new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes)if(node.nodeType===1&&node.dataset.motionKind)observed.push(node.dataset.motionKind);}).observe(document.querySelector('[data-interaction-motion-root]'),{childList:true,subtree:true});editor.init();editor.show(0,'mainBeatSound');
 },sample);await expect(page.locator('#sound-settings-modal')).toBeVisible();if(!sample)await expect.poll(()=>page.evaluate(()=>editor.currentSynthWaveformBuffer instanceof AudioBuffer)).toBe(true);
}
for(const sample of [true,false])for(const reduced of ['reduce','no-preference'])test((sample?'recorded':'synth')+' waveform view changes are local accepted outcomes with '+reduced,async({page})=>{
 await page.emulateMedia({reducedMotion:reduced});await editorPage(page,sample);const before=await page.evaluate(()=>a.getMusicalSnapshot());
 for(const [selector,property] of [['.waveform-zoom','waveformZoom'],['.waveform-pan','waveformPan']]){
  const input=page.locator('#sound-sliders-container '+selector);await input.scrollIntoViewIfNeeded();await input.focus();const previous=await page.evaluate(key=>editor[key],property);await page.evaluate(()=>{observed=[];});await input.press('ArrowRight');expect(await page.evaluate(key=>editor[key],property)).toBeGreaterThan(previous);await expect.poll(()=>page.evaluate(()=>observed.includes('adjust'))).toBe(true);expect(await page.evaluate(()=>a.getMusicalSnapshot())).toEqual(before);
  await page.evaluate(()=>{observed=[];});await input.dispatchEvent('input');expect(await page.evaluate(()=>observed.includes('adjust'))).toBe(false);
 }
});
test('switching recorded to synth editor never redraws a stale recorded buffer on trim',async({page})=>{
 const failures=[];page.on('pageerror',error=>failures.push(error.message));await editorPage(page,true);await page.evaluate(()=>{editor.hide();a.updateTrack(0,{mainBeatSound:{sound:'Synth Sine',settings:a.getDefaultSoundSettings('Synth Sine')}});editor.show(0,'mainBeatSound');});await expect.poll(()=>page.evaluate(()=>editor.currentSynthWaveformBuffer instanceof AudioBuffer)).toBe(true);const slider=page.locator('#sound-param-trimStart');await slider.scrollIntoViewIfNeeded();await slider.focus();await slider.press('ArrowRight');expect(await page.evaluate(()=>editor.getCurrentSoundInfo().settings.trimStart)).toBeGreaterThan(0);expect(failures).toEqual([]);
});

test('native recorded-waveform pointer trim redraws the real buffer and acknowledges saved changes',async({page})=>{
 const failures=[];page.on('pageerror',error=>failures.push(error.message));await editorPage(page,true);const canvas=page.locator('#sound-sliders-container .waveform-canvas');await canvas.scrollIntoViewIfNeeded();const box=await canvas.boundingBox();const previous=await page.evaluate(()=>editor.getCurrentSoundInfo().settings.trimStart);await page.evaluate(()=>{observed=[];document.querySelector('#sound-sliders-container .waveform-canvas').addEventListener('pointerdown',event=>{window.wavePointerTrusted=event.isTrusted;});});await page.mouse.move(box.x+box.width*.2,box.y+box.height/2);await page.mouse.down();try{await page.mouse.move(box.x+box.width*.3,box.y+box.height/2);}finally{await page.mouse.up();}
 // Preserve native trim unit/clamping behavior; this repairs drawing, not trim maths.
 expect(await page.evaluate(()=>wavePointerTrusted)).toBe(true);expect(failures).toEqual([]);
 expect(await page.evaluate(()=>editor.getCurrentSoundInfo().settings.trimStart)).toBeGreaterThan(previous);await expect.poll(()=>page.evaluate(()=>observed.includes('trim'))).toBe(true);
 await page.evaluate(()=>{observed=[];});await page.mouse.move(box.x+box.width*.8,box.y+box.height/2);expect(await page.evaluate(()=>observed.includes('trim'))).toBe(false);
});
