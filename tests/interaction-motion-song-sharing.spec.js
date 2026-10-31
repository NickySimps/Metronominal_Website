'use strict';
const {test,expect}=require('@playwright/test');
const open=require('./motionTestPage.cjs');
async function ready(page,metadata){
 // The unversioned CDN currently mixes module 0.187.0 with core 0.186.1.
 // Fetch the genuine matching release; never replace Three with a stub.
 await page.route('https://cdn.jsdelivr.net/npm/three/**',async route=>{const url=route.request().url().replace('/npm/three/','/npm/three@0.187.0/');const response=await route.fetch({url});await route.fulfill({response});});
 await open(page,metadata);
 await page.evaluate(async()=>{window.app=(await import('/js/appState.js')).default;window.songs=(await import('/js/songController.js')).default;app.setSong({...app.getSong(),enabled:true});songs.render();__motionObserved=[];});
}
async function clipboard(page){
 await page.context().grantPermissions(['clipboard-read','clipboard-write','local-network-access']);await page.bringToFront();
 await page.evaluate(async()=>{const write=navigator.clipboard.writeText.bind(navigator.clipboard),saved=await navigator.clipboard.readText();let owned=null;window.restoreSongClipboard=async()=>{if(owned!==null&&await navigator.clipboard.readText()===owned)await write(saved);};navigator.clipboard.writeText=async value=>{await write(value);owned=value;window.songNativeCopied=true;};});
}
for(const outcome of ['resolve','reject'])test('older song clipboard '+outcome+' cannot overwrite newer feedback',async({page},info)=>{
 await ready(page,info.config.metadata);await clipboard(page);
 try{
  await page.evaluate(outcome=>{const native=navigator.clipboard.writeText.bind(navigator.clipboard);let first=true;navigator.clipboard.writeText=async value=>{if(!first)return native(value);first=false;await native(value);window.songCopyHeld=true;await new Promise((resolve,reject)=>{window.finishSongCopy=()=>outcome==='reject'?reject(new Error('private-marker https://private.invalid/#secret')):resolve();});};},outcome);
  await page.locator('#copy-song-link-btn').click();await expect.poll(()=>page.evaluate(()=>window.songCopyHeld===true)).toBe(true);
  await page.locator('#copy-song-link-btn').click();await expect(page.locator('#song-share-status')).toHaveText('Song link copied.');
  await page.evaluate(()=>{document.querySelector('#song-share-status').textContent='Newer feedback';__motionObserved=[];finishSongCopy();});
  await page.waitForTimeout(250);await expect(page.locator('#song-share-status')).toHaveText('Newer feedback');expect(await page.evaluate(()=>__motionObserved.includes('copy')||__motionObserved.includes('refuse'))).toBe(false);
 }finally{await page.evaluate(()=>{window.finishSongCopy?.();return window.restoreSongClipboard?.();});}
});
test('native share cancellation and failure are distinct and never expose native error details',async({page},info)=>{
 await ready(page,info.config.metadata);
 for(const name of ['AbortError','NotAllowedError']){
  await page.evaluate(name=>{navigator.share=()=>Promise.reject(new DOMException('private-marker https://private.invalid/#secret',name));__motionObserved=[];},name);
  await page.locator('#share-song-btn').click();
  await expect.poll(()=>page.evaluate(kind=>__motionObserved.includes(kind),name==='AbortError'?'cancel':'refuse')).toBe(true);
  await expect(page.locator('#song-share-status')).not.toContainText('private-marker');await expect(page.locator('#song-share-status')).not.toContainText('https:');
  expect(await page.evaluate(()=>__motionObserved.includes('handoff')||__motionObserved.includes('copy'))).toBe(false);
 }
});
test('share without native API uses a real completed clipboard write',async({page},info)=>{
 await ready(page,info.config.metadata);await clipboard(page);
 try{await page.evaluate(()=>{navigator.share=undefined;});await page.locator('#share-song-btn').click();await expect.poll(()=>page.evaluate(()=>songNativeCopied&&__motionObserved.includes('copy'))).toBe(true);await expect(page.locator('#song-share-status')).toHaveText('Song link copied.');}finally{await page.evaluate(()=>window.restoreSongClipboard?.());}
});
for(const boundary of ['roomauthoritychange','syncrolechange','playbackstatechange','music'])test('pending song copy cannot acknowledge after '+boundary,async({page},info)=>{
 await ready(page,info.config.metadata);await clipboard(page);
 try{
  await page.evaluate(()=>{const native=navigator.clipboard.writeText.bind(navigator.clipboard);navigator.clipboard.writeText=async value=>{await native(value);window.songCopyHeld=true;await new Promise(resolve=>window.finishSongCopy=resolve);};});
  await page.locator('#copy-song-link-btn').click();await expect.poll(()=>page.evaluate(()=>window.songCopyHeld===true)).toBe(true);
  await page.evaluate(async boundary=>{if(boundary==='music')app.updateTrack(0,{name:'Changed while copying'});else if(boundary==='playbackstatechange'){await app.togglePlay();await app.togglePlay();}else document.dispatchEvent(new Event(boundary));__motionObserved=[];document.querySelector('#song-share-status').textContent='Boundary';finishSongCopy();},boundary);
  await page.waitForTimeout(200);await expect(page.locator('#song-share-status')).toHaveText('Boundary');expect(await page.evaluate(()=>__motionObserved.includes('copy'))).toBe(false);
 }finally{await page.evaluate(()=>{window.finishSongCopy?.();return window.restoreSongClipboard?.();});}
});
test('real song export downloads validated public bytes and acknowledges only download handoff',async({page},info)=>{
 await ready(page,info.config.metadata);
 const before=await page.evaluate(()=>app.getMusicalSnapshot());const pending=page.waitForEvent('download');await page.locator('#export-song-btn').click();const download=await pending;
 expect(download.suggestedFilename()).toMatch(/\.metronominal\.json$/);expect(await download.failure()).toBeNull();
 const payload=JSON.parse(require('node:fs').readFileSync(await download.path(),'utf8'));
 expect(payload.format).toBe('metronominal-song');expect(await page.evaluate(payload=>!!songs.validatePayload(payload),payload)).toBe(true);
 await expect(page.locator('#song-share-status')).toHaveText('Song download started.');await expect.poll(()=>page.evaluate(()=>__motionObserved.includes('download'))).toBe(true);
 expect(await page.evaluate(()=>app.getMusicalSnapshot())).toEqual(before);
});
test('export failure refuses without reflecting native errors or claiming a download',async({page},info)=>{
 await ready(page,info.config.metadata);await page.evaluate(()=>{URL.createObjectURL=()=>{throw new Error('private-marker https://private.invalid/#secret');};});
 await page.locator('#export-song-btn').click();await expect.poll(()=>page.evaluate(()=>__motionObserved.includes('refuse'))).toBe(true);await expect(page.locator('#song-share-status')).toHaveText('Unable to export song. Try again.');expect(await page.evaluate(()=>__motionObserved.includes('download'))).toBe(false);
});
async function songFile(page,name='Imported fixture',tempo=147){return {name:'fixture.metronominal.json',mimeType:'application/json',buffer:Buffer.from(await page.evaluate(async({name,tempo})=>{const payload=await songs.createPayload();payload.state.song.name=name;payload.state.tempo=tempo;return JSON.stringify(payload);},{name,tempo}))};}
test('song file import acknowledges an actual native load receipt and remains undoable',async({page},info)=>{
 await ready(page,info.config.metadata);
 await page.locator('#import-song-input').setInputFiles(await songFile(page));
 await expect(page.locator('#song-share-status')).toHaveText('Song imported.');expect(await page.evaluate(()=>app.getSong().name)).toBe('Imported fixture');expect(await page.evaluate(()=>app.getTempo())).toBe(147);
 await expect.poll(()=>page.evaluate(()=>__motionObserved.includes('load'))).toBe(true);expect(await page.locator('#import-song-input').inputValue()).toBe('');
 await page.locator('#rehearsal-tools-panel > summary').click();await page.getByRole('button',{name:'Undo',exact:true}).click();await expect.poll(()=>page.evaluate(()=>app.getSong().name!=='Imported fixture')).toBe(true);
});
test('refused native import without receipt never claims success',async({page},info)=>{
 await ready(page,info.config.metadata);const file=await songFile(page);const before=await page.evaluate(()=>app.getMusicalSnapshot());
 await page.evaluate(()=>{app.loadPresetData=async()=>undefined;});await page.locator('#import-song-input').setInputFiles(file);
 await expect(page.locator('#song-share-status')).not.toHaveText('Song imported.');await expect.poll(()=>page.evaluate(()=>__motionObserved.includes('refuse'))).toBe(true);
 expect(await page.evaluate(()=>__motionObserved.includes('load'))).toBe(false);expect(await page.evaluate(()=>app.getMusicalSnapshot())).toEqual(before);
});
test('malformed song file refuses without exposing file content',async({page},info)=>{
 await ready(page,info.config.metadata);const before=await page.evaluate(()=>app.getMusicalSnapshot());
 await page.locator('#import-song-input').setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from('private-marker https://private.invalid/#secret')});
 await expect.poll(()=>page.evaluate(()=>__motionObserved.includes('refuse'))).toBe(true);await expect(page.locator('#song-share-status')).toHaveText('Unable to import song. Choose a valid Metronominal song file.');expect(await page.evaluate(()=>app.getMusicalSnapshot())).toEqual(before);
});
for(const outcome of ['resolve','reject'])test('older file read '+outcome+' cannot replace a newer import or clear its input',async({page},info)=>{
 await ready(page,info.config.metadata);const oldFile=await songFile(page,'Old file',131),newFile=await songFile(page,'New file',159);
 await page.evaluate(outcome=>{const text=File.prototype.text;let first=true;File.prototype.text=async function(){if(!first)return text.call(this);first=false;const value=await text.call(this);window.songReadHeld=true;await new Promise((resolve,reject)=>window.finishSongRead=()=>outcome==='reject'?reject(new Error('private-marker https://private.invalid/#secret')):resolve());return value;};},outcome);
 await page.locator('#import-song-input').setInputFiles(oldFile);await expect.poll(()=>page.evaluate(()=>window.songReadHeld===true)).toBe(true);expect(await page.locator('#import-song-input').inputValue()).toBe('');
 await page.locator('#import-song-input').setInputFiles(newFile);await expect.poll(()=>page.evaluate(()=>app.getSong().name)).toBe('New file');await expect(page.locator('#song-share-status')).toHaveText('Song imported.');
 await page.evaluate(()=>{__motionObserved=[];finishSongRead();});await page.waitForTimeout(250);expect(await page.evaluate(()=>app.getSong().name)).toBe('New file');expect(await page.evaluate(()=>app.getTempo())).toBe(159);await expect(page.locator('#song-share-status')).toHaveText('Song imported.');expect(await page.evaluate(()=>__motionObserved.some(kind=>['load','refuse'].includes(kind)))).toBe(false);
});
for(const boundary of ['roomauthoritychange','syncrolechange','playback','music'])for(const outcome of ['resolve','reject'])test('file read '+outcome+' remains silent after '+boundary,async({page},info)=>{
 await ready(page,info.config.metadata);const file=await songFile(page);
 await page.evaluate(outcome=>{const text=File.prototype.text;File.prototype.text=async function(){const value=await text.call(this);window.songReadHeld=true;await new Promise((resolve,reject)=>window.finishSongRead=()=>outcome==='reject'?reject(new Error('private-marker https://private.invalid/#secret')):resolve());return value;};},outcome);
 await page.locator('#import-song-input').setInputFiles(file);await expect.poll(()=>page.evaluate(()=>window.songReadHeld===true)).toBe(true);
 await page.evaluate(async boundary=>{if(boundary==='music')app.updateTrack(0,{name:'Edit after file choice'});else if(boundary==='playback'){await app.togglePlay();await app.togglePlay();}else document.dispatchEvent(new Event(boundary));__motionObserved=[];document.querySelector('#song-share-status').textContent='Boundary';finishSongRead();},boundary);
 await page.waitForTimeout(200);await expect(page.locator('#song-share-status')).toHaveText('Boundary');expect(await page.evaluate(()=>app.getSong().name!=='Imported fixture')).toBe(true);expect(await page.evaluate(()=>__motionObserved.some(kind=>['load','refuse'].includes(kind)))).toBe(false);
});
for(const receipt of ['native','refused'])test('shared-song hash reports only an actual '+receipt+' receipt',async({page},info)=>{
 await ready(page,info.config.metadata);
 await page.evaluate(async receipt=>{const payload=await songs.createPayload();payload.state.song.name='Shared hash fixture';payload.state.tempo=166;const bytes=new TextEncoder().encode(JSON.stringify(payload));let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);history.replaceState(null,'','#song='+btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''));if(receipt==='refused')app.loadPresetData=async()=>undefined;__motionObserved=[];await songs.initialize();},receipt);
 if(receipt==='native'){await expect(page.locator('#song-share-status')).toHaveText('Shared song loaded.');expect(await page.evaluate(()=>app.getSong().name)).toBe('Shared hash fixture');await expect.poll(()=>page.evaluate(()=>__motionObserved.includes('load'))).toBe(true);}
 else {await expect(page.locator('#song-share-status')).not.toHaveText('Shared song loaded.');await expect.poll(()=>page.evaluate(()=>__motionObserved.includes('refuse'))).toBe(true);expect(await page.evaluate(()=>__motionObserved.includes('load'))).toBe(false);}
});
for(const boundary of ['music','replacement'])test('late native import receipt stays silent after '+boundary,async({page},info)=>{
 await ready(page,info.config.metadata);const file=await songFile(page);
 await page.evaluate(()=>{const load=app.loadPresetData.bind(app);let first=true;app.loadPresetData=async(...args)=>{const hold=first;first=false;const result=await load(...args);if(hold){window.nativeImportHeld=true;await new Promise(resolve=>window.finishNativeImport=resolve);}return result;};});
 await page.locator('#import-song-input').setInputFiles(file);await expect.poll(()=>page.evaluate(()=>window.nativeImportHeld===true)).toBe(true);
 await page.evaluate(async boundary=>{if(boundary==='music')app.updateTrack(0,{name:'Newer live edit'});else{const state=await app.getCurrentStateForPreset(true);state.song.name='Newer replacement';await app.loadPresetData(state);}__motionObserved=[];document.querySelector('#song-share-status').textContent='Newer action';finishNativeImport();},boundary);
 await page.waitForTimeout(200);await expect(page.locator('#song-share-status')).toHaveText('Newer action');expect(await page.evaluate(()=>__motionObserved.some(kind=>['load','refuse'].includes(kind)))).toBe(false);
});
test('before-connection import option cannot overwrite an already joined client',async({page},info)=>{
 await ready(page,info.config.metadata);const result=await page.evaluate(async()=>{const payload=await songs.createPayload();payload.state.song.name='Forbidden client load';const before=app.getMusicalSnapshot();document.dispatchEvent(new CustomEvent('syncrolechange',{detail:{state:'connected',isHost:false}}));let rejected=false;try{await songs.applyPayload(payload,{allowBeforeConnection:true});}catch{rejected=true;}return{rejected,unchanged:JSON.stringify(before)===JSON.stringify(app.getMusicalSnapshot())};});expect(result).toEqual({rejected:true,unchanged:true});
});
test('song copy acknowledges only a completed native clipboard write and keeps musical state unchanged',async({page},info)=>{
 await ready(page,info.config.metadata);await clipboard(page);
 try{
  const before=await page.evaluate(()=>app.getMusicalSnapshot());await page.locator('#copy-song-link-btn').click();
  await expect.poll(()=>page.evaluate(()=>window.songNativeCopied===true)).toBe(true);
  await expect(page.locator('#song-share-status')).toHaveText('Song link copied.');
  await expect.poll(()=>page.evaluate(()=>__motionObserved.includes('copy'))).toBe(true);
  expect(await page.evaluate(async()=>{const text=await navigator.clipboard.readText(),url=new URL(text);return url.search===''&&url.hash.startsWith('#song=')&&!text.includes('hostCredential');})).toBe(true);
  expect(await page.evaluate(()=>app.getMusicalSnapshot())).toEqual(before);
 }finally{await page.evaluate(()=>window.restoreSongClipboard?.());}
});
