'use strict';
const {test,expect}=require('@playwright/test');
const openMotion=require('./motionTestPage.cjs');
for(const boundary of ['native replacement','musical edit'])test('Apply observes '+boundary+' during initial preset-read gap without changing native load semantics',async({page},info)=>{
 await openMotion(page,info.config.metadata);
 await page.evaluate(async()=>{
  window.app=(await import('/js/appState.js')).default;window.songUI=(await import('/js/songController.js')).default;
  const tracks=app.getMusicalSnapshot().Tracks;tracks[0].name='Initial-gap saved A';
  app.setSong({version:2,enabled:true,name:'Initial gap',sections:[{name:'A',startBar:0,tempo:110,repeats:1,tracks}]});
  app.updateTrack(0,{name:'Before Apply'});app.setTempo(173);songUI.render();
  const original=app.getCurrentStateForPreset.bind(app);let first=true;
  app.getCurrentStateForPreset=async(...args)=>{const hold=first;first=false;const value=await original(...args);if(hold){window.initialGapHeld=true;await new Promise(r=>window.releaseInitialGap=r);}return value;};
  __motionObserved=[];
  // Install the hold and invoke the actual Apply handler in the same browser task;
  // unrelated queued publishers must not consume this first-call hold.
  document.querySelector('.song-section-row[data-section-index="0"] [data-song-section-action="apply"]').click();
 });
 await expect.poll(()=>page.evaluate(()=>!!window.initialGapHeld)).toBe(true);
 await page.evaluate(async boundary=>{
  if(boundary==='native replacement') {const state=await app.getCurrentStateForPreset(true);state.Tracks[0].name='Foreign gap replacement';state.tempo=181;await app.loadPresetData(state);}
  else app.updateTrack(0,{name:'Foreign gap edit'});
  __motionObserved=[];releaseInitialGap();
 },boundary);
 await expect.poll(()=>page.evaluate(()=>app.getTracks()[0].name)).toBe('Initial-gap saved A');
 expect(await page.evaluate(()=>app.getTempo())).toBe(110);
 await page.waitForTimeout(280);expect(await page.evaluate(()=>__motionObserved.includes('load'))).toBe(false);
});
for(const boundary of ['newer apply','room disconnect','foreign state replacement','foreign track edit','no-op apply then foreign edit'])test('late section Apply completion stays silent after '+boundary,async({page},info)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await openMotion(page,info.config.metadata);
 await page.evaluate(async()=>{
  window.app=(await import('/js/appState.js')).default;window.songUI=(await import('/js/songController.js')).default;window.sync=await import('/js/webrtc.js');
 });
 await page.evaluate(async boundary=>{
  // Generated saved arrangements; actual room ownership and native load path.
  const a=app.getMusicalSnapshot().Tracks,b=structuredClone(a);a[0].name='Generated saved A';b[0].name='Generated saved B';
  app.setSong({version:2,enabled:true,name:'Generated completion fixture',sections:[{name:'A',startBar:0,tempo:110,repeats:1,tracks:a},{name:'B',startBar:0,tempo:150,repeats:1,tracks:b}]});
  app.updateTrack(0,{name:'Unapplied generated live track'});app.setTempo(173);songUI.render();
  const native=app.loadPresetData.bind(app);let first=true;window.__heldSongCompletion=false;
  if(boundary==='no-op apply then foreign edit'){
   // Warm through the actual Apply control so its runtime snapshot expansion,
   // not a hand-built approximation, establishes the canonical no-op state.
   await new Promise(resolve=>{
    document.addEventListener('appstatechange',resolve,{once:true});
    document.querySelector('.song-section-row[data-section-index="0"] [data-song-section-action="apply"]').click();
   });
   window.__beforeNoopApply=app.getMusicalSnapshot();
  }
  app.loadPresetData=async(...args)=>{
   const hold=first;first=false;const result=await native(...args);
   // Forward the real load first, holding only its consumer's completion.
   if(hold){__heldSongCompletion=true;await new Promise(resolve=>{window.__releaseSongCompletion=resolve;});}
   return result;
  };
  window.__motionObserved=[];
 },boundary);
 const apply=i=>page.locator(`.song-section-row[data-section-index="${i}"] [data-song-section-action="apply"]`);
 await apply(0).click();await expect.poll(()=>page.evaluate(()=>__heldSongCompletion)).toBe(true);
 expect(await page.evaluate(()=>app.getTracks()[0].name)).toBe('Generated saved A');
 if(boundary==='no-op apply then foreign edit')expect(await page.evaluate(()=>app.getMusicalSnapshot())).toEqual(await page.evaluate(()=>__beforeNoopApply));
 if(boundary==='newer apply'){
  await apply(1).click();await expect.poll(()=>page.evaluate(()=>app.getTracks()[0].name)).toBe('Generated saved B');
  await expect.poll(()=>page.evaluate(()=>__motionObserved.includes('load'))).toBe(true);
 }else if(boundary==='room disconnect')await page.evaluate(()=>sync.disconnect());
 else if(boundary==='foreign state replacement')await page.evaluate(async()=>{
  const state=await app.getCurrentStateForPreset(true);state.tempo=181;state.Tracks[0].name='Foreign replacement track';
  state.song={version:2,enabled:true,name:'Foreign replacement song',sections:[{name:'Foreign same-index section',startBar:0,tempo:181,repeats:1,tracks:structuredClone(state.Tracks)}]};
  await app.loadPresetData(state);songUI.render();
 });
 else await page.evaluate(()=>{app.updateTrack(0,{name:'Foreign live musical edit'});songUI.render();});
 const before=await page.evaluate(()=>app.getMusicalSnapshot());
 await page.waitForTimeout(240);await page.evaluate(()=>{__motionObserved=[];__releaseSongCompletion();});
 await page.waitForTimeout(280);
 expect(await page.evaluate(()=>app.getMusicalSnapshot())).toEqual(before);
 expect(await page.evaluate(()=>__motionObserved.includes('load'))).toBe(false);
 expect(errors).toEqual([]);
});
