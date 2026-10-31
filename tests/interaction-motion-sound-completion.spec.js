'use strict';
const {test,expect}=require('@playwright/test');
async function editorPage(page,sample=true){
 await page.route('**/script.js',r=>r.abort());await page.goto('./');
 await page.evaluate(async sample=>{
  window.editor=(await import('./js/soundSettingsModal.js')).default;window.a=(await import('./js/appState.js')).default;
  (await import('./js/themeController.js')).default.applyTheme('dark');
  (await import('./js/interactionMotion.js')).initializeInteractionMotion(document);
  a.initializeAudioContext();if(!a.getTracks().length)a.addTrack();
  // Generated sine fixture, not a microphone or a physical audibility claim.
  if(sample){const c=a.getAudioContext(),b=c.createBuffer(1,c.sampleRate,c.sampleRate),d=b.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=.4*Math.sin(2*Math.PI*440*i/c.sampleRate);a.addRecording('Generated sine');a.setSoundBuffer('Generated sine',b);a.updateTrack(0,{mainBeatSound:{sound:'Generated sine',settings:{volume:.7,trimStart:0,trimEnd:1,probability:100}}});}
  window.connections=[];const connect=AudioNode.prototype.connect;AudioNode.prototype.connect=function(...args){connections.push({from:this,to:args[0]});return connect.apply(this,args);};
  window.stops=[];const stop=AudioBufferSourceNode.prototype.stop;AudioBufferSourceNode.prototype.stop=function(...args){stops.push(this);return stop.apply(this,args);};
  window.starts=[];const start=AudioBufferSourceNode.prototype.start;AudioBufferSourceNode.prototype.start=function(...args){starts.push({source:this,buffer:this.buffer,args});return start.apply(this,args);};
  window.observed=[];new MutationObserver(rs=>{for(const r of rs)for(const n of r.addedNodes)if(n.nodeType===1&&n.dataset.motionKind)observed.push(n.dataset.motionKind);}).observe(document.querySelector('[data-interaction-motion-root]'),{childList:true,subtree:true});
  editor.init();editor.show(0,'mainBeatSound');
 },sample);await expect(page.locator('#sound-settings-modal')).toBeVisible();await clear(page);
}
test('generated sample trim, volume, probability and local snapping acknowledge real outcomes',async({page})=>{
 await editorPage(page);await page.locator('#grid-snap-btn').click();expect(await page.evaluate(()=>editor.isGridSnapping)).toBe(true);await kinds(page,['toggle']);
 await clear(page);await page.locator('#quantize-btn').click();expect(await page.evaluate(()=>editor.isQuantizing)).toBe(true);await kinds(page,['toggle']);
 for(const [param,kind] of [['trimStart','trim'],['volume','adjust']]){
  const slider=page.locator('#sound-param-'+param);await slider.scrollIntoViewIfNeeded();await clear(page);await slider.focus();await slider.press('ArrowRight');
  const value=await page.evaluate(p=>({draft:editor.currentSoundSettings[p],saved:editor.getCurrentSoundInfo().settings[p]}),param);expect(value.saved).toBeGreaterThan(0);expect(value.draft).toBe(value.saved);await kinds(page,[kind]);
 }
 await clear(page);await page.locator('#sample-probability').focus();await page.locator('#sample-probability').press('ArrowLeft');expect(await page.evaluate(()=>editor.getCurrentSoundInfo().settings.probability)).toBe(99);await kinds(page,['adjust']);
});

test('native WAV upload reports decoded buffer acceptance; invalid bytes refuse without saving',async({page})=>{
 await editorPage(page);await page.evaluate(async()=>{editor.hide();window.rec=(await import('./js/recordingManager.js')).default;rec.init();rec.openModal();});await clear(page);
 // Generated PCM WAV fixture; no captured audio or microphone permission.
 const wav=Buffer.alloc(44+1600);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(1600,40);for(let i=0;i<800;i++)wav.writeInt16LE(Math.round(8000*Math.sin(2*Math.PI*440*i/8000)),44+i*2);
 await page.locator('#upload-sample-input').setInputFiles({name:'Generated upload.wav',mimeType:'audio/wav',buffer:wav});await kinds(page,['upload']);
 expect(await page.evaluate(()=>({listed:a.getRecordings().includes('Generated upload'),native:a.getSoundBuffer('Generated upload') instanceof AudioBuffer,duration:a.getSoundBuffer('Generated upload')?.duration}))).toEqual({listed:true,native:true,duration:.1});
 await clear(page);page.once('dialog',d=>d.dismiss());await page.locator('#upload-sample-input').setInputFiles({name:'Invalid.wav',mimeType:'audio/wav',buffer:Buffer.from('not audio')});await kinds(page,['refuse']);expect(await page.evaluate(()=>a.getRecordings().includes('Invalid'))).toBe(false);
});

test('custom draft naming stays separate from durable save and confirmed delete',async({page})=>{
 await editorPage(page,false);await page.locator('#rename-sound-btn').click();const input=page.locator('#sound-settings-modal .modal-header h2 input');await input.fill('Generated custom preset');await input.press('Enter');await kinds(page,['rename']);expect(await page.evaluate(()=>a.getCustomSoundData('Generated custom preset'))).toBeUndefined();
 await clear(page);await page.locator('#save-sound-btn').click();await kinds(page,['save']);
 expect(await page.evaluate(()=>({model:a.getCustomSoundData('Generated custom preset')?.baseSound,stored:JSON.parse(localStorage.getItem('metronominalState')).customSounds['Generated custom preset']?.baseSound,selected:editor.getCurrentSoundInfo().sound}))).toEqual({model:'Synth Kick',stored:'Synth Kick',selected:'Generated custom preset'});
 await clear(page);await page.locator('#delete-sound-btn').click();expect(await page.evaluate(()=>a.getCustomSoundData('Generated custom preset')?.baseSound)).toBe('Synth Kick');await page.locator('#confirmation-modal-cancel-btn').click();expect(await page.evaluate(()=>a.getCustomSoundData('Generated custom preset')?.baseSound)).toBe('Synth Kick');expect(await page.evaluate(()=>observed)).toEqual([]);
 await page.locator('#delete-sound-btn').click();await page.locator('#confirmation-modal-confirm-btn').click();await expect.poll(()=>page.evaluate(()=>observed.includes('remove'))).toBe(true);expect(await page.evaluate(()=>({model:!!a.getCustomSoundData('Generated custom preset'),stored:!!JSON.parse(localStorage.getItem('metronominalState')).customSounds['Generated custom preset']}))).toEqual({model:false,stored:false});
});

test('closing upload while a genuine File read is held cancels late decode acceptance and feedback',async({page})=>{
 await editorPage(page);await page.evaluate(async()=>{editor.hide();window.rec=(await import('./js/recordingManager.js')).default;rec.init();rec.openModal();const original=File.prototype.arrayBuffer;File.prototype.arrayBuffer=function(...args){return new Promise(resolve=>{window.releaseFile=()=>resolve(original.apply(this,args));});};});await clear(page);
 const wav=Buffer.alloc(46);wav.write('RIFF');wav.writeUInt32LE(38,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(2,40);
 await page.locator('#upload-sample-input').setInputFiles({name:'Late generated.wav',mimeType:'audio/wav',buffer:wav});await expect.poll(()=>page.evaluate(()=>typeof releaseFile)).toBe('function');await page.locator('#manage-recordings-modal .close-button').click();await expect.poll(()=>page.evaluate(()=>observed.includes('close'))).toBe(true);await page.evaluate(()=>{observed=[];releaseFile();});await page.waitForTimeout(400);
 expect(await page.evaluate(()=>({saved:a.getRecordings().includes('Late generated'),feedback:observed}))).toEqual({saved:false,feedback:[]});
});

test('unavailable durable storage never reports custom save success',async({page})=>{
 await editorPage(page,false);await page.evaluate(()=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(key,...args){if(key==='metronominalState')throw new DOMException('Test storage refusal','QuotaExceededError');return original.call(this,key,...args);};editor.displaySoundName='Not durable';});
 await page.locator('#save-sound-btn').click();await kinds(page,['refuse']);expect(await page.evaluate(()=>({model:!!a.getCustomSoundData('Not durable'),stored:!!JSON.parse(localStorage.getItem('metronominalState')||'{}').customSounds?.['Not durable']}))).toEqual({model:true,stored:false});
});

test('obsolete custom confirmations cannot delete after parent closure',async({page})=>{
 await editorPage(page,false);await page.evaluate(()=>{a.addCustomSound('Keep generated','Synth Kick',editor.currentSoundSettings);a.updateTrack(0,{mainBeatSound:{sound:'Keep generated',settings:editor.currentSoundSettings}});editor.show(0,'mainBeatSound');});await page.locator('#delete-sound-btn').click();await page.evaluate(()=>{editor.hide();document.querySelector('#confirmation-modal-confirm-btn').click();});
 expect(await page.evaluate(()=>!!a.getCustomSoundData('Keep generated'))).toBe(true);await expect(page.locator('#confirmation-modal')).toBeHidden();
});

for(const reduced of ['reduce','no-preference'])test('FX accepted Escape closure has bounded confirmation without a no-op or musical change '+reduced,async({page})=>{
 await page.emulateMedia({reducedMotion:reduced});await editorPage(page,false);const before=await page.evaluate(()=>a.getMusicalSnapshot());
 await page.locator('#sound-effects-btn').click();await expect(page.locator('#sound-effects-modal')).toBeVisible();await clear(page);await page.keyboard.press('Escape');await expect(page.locator('#sound-effects-modal')).toBeHidden();await kinds(page,['close']);
 expect(await page.evaluate(()=>a.getMusicalSnapshot())).toEqual(before);await clear(page);await page.evaluate(()=>editor.hideEffectsModal());expect(await page.evaluate(()=>observed)).toEqual([]);
});

async function clear(page){await page.evaluate(()=>{observed=[];});}

function generatedWav(name){const buffer=Buffer.alloc(46);buffer.write('RIFF');buffer.writeUInt32LE(38,4);buffer.write('WAVEfmt ',8);buffer.writeUInt32LE(16,16);buffer.writeUInt16LE(1,20);buffer.writeUInt16LE(1,22);buffer.writeUInt32LE(8000,24);buffer.writeUInt32LE(16000,28);buffer.writeUInt16LE(2,32);buffer.writeUInt16LE(16,34);buffer.write('data',36);buffer.writeUInt32LE(2,40);return {name,mimeType:'audio/wav',buffer};}
for(const boundary of ['roomauthoritychange','syncrolechange']){
 test('same-role '+boundary+' event contract invalidates held genuine upload',async({page})=>{
  await editorPage(page);await page.evaluate(async()=>{editor.hide();window.rec=(await import('./js/recordingManager.js')).default;rec.init();rec.openModal();const read=File.prototype.arrayBuffer;File.prototype.arrayBuffer=function(...args){return new Promise(resolve=>window.releaseAuthorityFile=()=>resolve(read.apply(this,args)));};});await clear(page);
  await page.locator('#upload-sample-input').setInputFiles(generatedWav('Expired authority.wav'));await expect.poll(()=>page.evaluate(()=>typeof releaseAuthorityFile)).toBe('function');
  // Invalidation-event contract only: no fabricated role, grant or server ACK.
  await page.evaluate(boundary=>{document.dispatchEvent(new Event(boundary));document.dispatchEvent(new Event(boundary));releaseAuthorityFile();},boundary);
  await page.waitForTimeout(350);expect(await page.evaluate(()=>({saved:a.getRecordings().includes('Expired authority'),feedback:observed}))).toEqual({saved:false,feedback:[]});
 });
 test('same-role '+boundary+' event contract invalidates custom deletion confirmation',async({page})=>{
  await editorPage(page,false);await page.evaluate(()=>{a.addCustomSound('Authority protected','Synth Kick',editor.currentSoundSettings);a.updateTrack(0,{mainBeatSound:{sound:'Authority protected',settings:editor.currentSoundSettings}});editor.show(0,'mainBeatSound');});await page.locator('#delete-sound-btn').click();
  await page.evaluate(boundary=>{document.dispatchEvent(new Event(boundary));document.dispatchEvent(new Event(boundary));document.querySelector('#confirmation-modal-confirm-btn').click();},boundary);
  expect(await page.evaluate(()=>!!a.getCustomSoundData('Authority protected'))).toBe(true);await expect(page.locator('#confirmation-modal')).toBeHidden();
 });
}
test('native ended always disposes its owned preview after actual track replacement without stale success',async({page})=>{
 await editorPage(page);await page.locator('#sound-preview-btn').click();await kinds(page,['audition']);
 await page.evaluate(()=>{a.addTrack();a.removeTrack(0);});await clear(page);
 await expect.poll(()=>page.evaluate(()=>editor.previewSource===null)).toBe(true);
 expect(await page.evaluate(()=>({analyser:editor.previewAnalyserNode,output:editor.previewOutputNode,feedback:observed}))).toEqual({analyser:null,output:null,feedback:[]});
 await expect(page.locator('#sound-preview-btn')).toHaveAttribute('aria-pressed','false');
});
test('accepted first file is finalized before a held second file is cancelled',async({page})=>{
 await editorPage(page);await page.evaluate(async()=>{editor.hide();window.rec=(await import('./js/recordingManager.js')).default;rec.init();rec.openModal();const read=File.prototype.arrayBuffer;File.prototype.arrayBuffer=function(...args){if(this.name==='Batch B.wav')return new Promise(resolve=>window.releaseBatchB=()=>resolve(read.apply(this,args)));return read.apply(this,args);};});
 await page.locator('#upload-sample-input').setInputFiles([generatedWav('Batch A.wav'),generatedWav('Batch B.wav')]);await expect.poll(()=>page.evaluate(()=>typeof releaseBatchB)).toBe('function');
 expect(await page.evaluate(()=>a.getRecordings().includes('Batch A'))).toBe(true);
 await expect(page.locator('#recordings-list .recording-name-display').filter({hasText:/^Batch A$/})).toHaveCount(1);
 await page.locator('#manage-recordings-modal .close-button').click();await page.evaluate(()=>releaseBatchB());await page.waitForTimeout(300);
 expect(await page.evaluate(()=>a.getRecordings().includes('Batch B'))).toBe(false);
});
async function kinds(page,expected){await expect.poll(()=>page.evaluate(()=>observed)).toEqual(expected);}

test('native generated sample audition acknowledges started, stopped and natural end, never stale end',async({page})=>{
 await editorPage(page);const before=await page.evaluate(()=>a.getMusicalSnapshot());
 await page.locator('#sound-preview-btn').click();await kinds(page,['audition']);
 expect(await page.evaluate(()=>({native:editor.previewSource instanceof AudioBufferSourceNode,identity:starts.at(-1).buffer===a.getSoundBuffer('Generated sine'),args:starts.at(-1).args}))).toEqual({native:true,identity:true,args:[0,0,1]});
 expect(await page.evaluate(async()=>{const monitoring=(await import('./js/monitoring.js')).default;return {analyserOutput:connections.some(e=>e.from===editor.previewAnalyserNode&&e.to===editor.previewOutputNode),personalBus:connections.some(e=>e.from===editor.previewOutputNode&&e.to===monitoring.getTrackOutput(a.getAudioContext(),0)),gain:editor.previewOutputNode.gain.value};})).toEqual({analyserOutput:true,personalBus:true,gain:await page.evaluate(()=>a.getVolume()*a.getTracks()[0].volume)});
 await expect.poll(()=>page.evaluate(()=>{const d=new Float32Array(editor.previewAnalyserNode.fftSize);editor.previewAnalyserNode.getFloatTimeDomainData(d);return Math.max(...d.map(Math.abs));})).toBeGreaterThan(.01);
 await page.evaluate(()=>{window.oldEnd=editor.previewSource.onended;window.stoppedSource=editor.previewSource;});await clear(page);await page.locator('#sound-preview-btn').click();await kinds(page,['stop']);expect(await page.evaluate(()=>editor.previewSource)).toBeNull();expect(await page.evaluate(()=>stops.includes(stoppedSource))).toBe(true);
 await clear(page);await page.locator('#sound-preview-btn').click();await page.evaluate(()=>oldEnd());await kinds(page,['audition']);
 await expect.poll(()=>page.evaluate(()=>editor.previewSource===null)).toBe(true);await kinds(page,['audition','stop']);expect(await page.evaluate(()=>a.getMusicalSnapshot())).toEqual(before);
});

test('held real offline render gives pending then cancellation, no late audition; invalid trim refuses',async({page})=>{
 await editorPage(page,false);await page.evaluate(()=>{const original=OfflineAudioContext.prototype.startRendering;OfflineAudioContext.prototype.startRendering=function(...args){return new Promise(resolve=>{window.releaseRender=()=>resolve(original.apply(this,args));});};});
 await page.locator('#sound-preview-btn').click();await kinds(page,['pending']);await clear(page);await page.locator('#sound-preview-btn').click();await kinds(page,['cancel']);
 await page.evaluate(()=>releaseRender());await page.waitForTimeout(300);await kinds(page,['cancel']);expect(await page.evaluate(()=>({source:editor.previewSource,starts:starts.length}))).toEqual({source:null,starts:0});
 await page.evaluate(()=>{editor.currentSoundSettings.trimStart=1;editor.currentSoundSettings.trimEnd=0;});await clear(page);
 // Use a real sample to avoid holding another offline render.
 await page.evaluate(()=>{const c=a.getAudioContext(),b=c.createBuffer(1,100,c.sampleRate);a.setSoundBuffer('Short generated',b);a.updateTrack(0,{mainBeatSound:{sound:'Short generated',settings:{trimStart:1,trimEnd:0}}});});
 await page.locator('#sound-preview-btn').click();await kinds(page,['refuse']);expect(await page.evaluate(()=>starts.length)).toBe(0);
});
