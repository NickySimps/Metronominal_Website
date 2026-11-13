const { test, expect } = require('@playwright/test');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { createSyncServer } = require('../../MetronomeSignalServer/server');
const { execFileSync } = require('child_process');
const Module = require('module');
// Execute the actual checked-in pre-melody server, not a fabricated reply.
const oldPath=path.resolve(__dirname,'../../MetronomeSignalServer/server.js');
const oldModule=new Module(oldPath,module);oldModule.filename=oldPath;oldModule.paths=Module._nodeModulePaths(path.dirname(oldPath));
const oldBytes=execFileSync('git',['show','f72cc18:server.js'],{cwd:path.dirname(oldPath),encoding:'utf8'});
if(oldBytes.includes('melody-v1'))throw Error('Old server fixture unexpectedly supports melody');
oldModule._compile(oldBytes,oldPath);
let oldSignal;
let web, signal, base;
let opened=[];
test.beforeEach(()=>{opened=[]});
test.afterEach(()=>{for(const p of opened){expect(p.errors).toEqual([]);expect(p.requests.every(u=>new URL(u).origin===base)).toBe(true)}});
const root = path.resolve(__dirname, '..');
test.beforeAll(async () => {
  oldSignal=oldModule.exports.createSyncServer({port:0,logger:{log(){},warn(){}}});
  await new Promise(r=>oldSignal.wss.once('listening',r));
  signal = createSyncServer({port:0, logger:{log(){}, warn(){}}});
  await new Promise(r => signal.wss.once('listening', r));
  web = http.createServer((q,s) => {
    const f = path.join(root, new URL(q.url,'http://local').pathname);
    s.setHeader('Content-Type','text/javascript');
    fs.readFile(f,(e,b)=>{s.statusCode=e?404:200;s.end(e?'':b);});
  });
  await new Promise(r => web.listen(0,'127.0.0.1',r));
  base = `http://127.0.0.1:${web.address().port}`;
});
test.afterAll(async()=>{await signal.close();await oldSignal.close();await new Promise(r=>web.close(r));});
async function open(browser, endpoint = signal.wss.address().port, room = null) {
  const context = await browser.newContext({serviceWorkers:'block'});
  // Real app-state/song/protocol modules, inert UI/audio seams. No CDN/network.
  const allowed = new Set(['appState','songController','webrtc','melodySchema','audioSerialization','beatTiming','monitoring']);
  const requests=[];
  await context.route('**/*', async route => {
    const u=new URL(route.request().url()); requests.push(u.href);
    if(u.origin!==base) return route.abort();
    const name=path.basename(u.pathname,'.js');
    if(u.pathname.endsWith('.js')&&!allowed.has(name)) return route.fulfill({contentType:'text/javascript',body:name==='interactionMotion'?'export const emitInteractionMotion=()=>false;':name==='practiceTransport'?'export const receiveSongChange=m=>{window.receivedSongs.push(m)};':`export default {supportsMelodyProtocol:()=>window.engineMelodyReady===true,isSchedulerReady:()=>true,cancelPlayback:()=>{window.cancelled++},cancelCountIn(){},scheduleStart:async()=>{window.starts++},scheduleCountIn:async()=>{},handleSyncPulse(){},updateTempoDisplay(){},updateVolumeDisplay(){},renderTracks(){},updateBarControlsForSelectedTrack(){}};`});
    return route.continue();
  });
  await context.addInitScript(port=>{
    window.starts=0;window.cancelled=0;window.receivedSongs=[];window.outbound=[];window.inbound=[];
    const W=WebSocket;
    window.WebSocket=class extends W{constructor(url){super(`ws://127.0.0.1:${port}`);window.wire=this;const send=this.send.bind(this);this.send=raw=>{outbound.push(JSON.parse(raw));send(raw)};this.addEventListener('message',e=>inbound.push(JSON.parse(e.data)));}};
  },endpoint);
  const page=await context.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  opened.push({errors,requests});
  await page.goto(`${base}/js/beatTiming.js${room ? `?room=${encodeURIComponent(room)}` : ""}`);
  await page.setContent('<main></main>');
  await page.evaluate(async()=>{window.app=(await import('/js/appState.js')).default;app.resetState();window.songs=(await import('/js/songController.js')).default;window.sync=await import('/js/webrtc.js');window.notes={version:1,bars:[[{id:'n',midi:60,startTick:0,durationTicks:960,velocity:.8}]]};});
  return {page,context,requests};
}
for (const ready of [false,true]) test(`actual old server refuses outgoing and incoming melody with engine readiness ${ready}`,async({browser})=>{
 const p=await open(browser,oldSignal.wss.address().port);try{
  await p.page.evaluate(ready=>{window.engineMelodyReady=ready;return sync.initializeWebRTC()},ready);
  await expect.poll(()=>p.page.evaluate(()=>sync.isSynchronizationJoined())).toBe(true);
  await expect.poll(()=>p.page.evaluate(()=>sync.getSyncDiagnostics().timeSyncReady)).toBe(true);
  const room=[...oldSignal.rooms.values()].find(r=>r.host?.readyState===1);
  const baseline=await p.page.evaluate(()=>app.getMusicalSnapshot());
  const incoming=await p.page.evaluate(async()=>{const s=await app.getCurrentStateForPreset(true);s.Tracks[0].melody=notes;return s});
  room.host.send(JSON.stringify({type:'state',room:room.id,revision:999,authoritativeRefresh:true,payload:incoming}));
  room.host.send(JSON.stringify({type:'song-change',room:room.id,version:1,song:{...incoming.song,sections:[{...incoming.song.sections[0],tracks:[{...baseline.Tracks[0],melody:{version:1,bars:[[]]}}]}]},sectionIndex:0,startBar:0,effectiveAt:Date.now()+30000}));
  room.host.send(JSON.stringify({type:'transport',room:room.id,playing:true,revision:999,effectiveAt:Date.now()+100,currentBar:0,currentBeat:0}));
  await expect.poll(()=>p.page.evaluate(()=>sync.getRehearsalRoomState().recoveryMessage)).toContain('melody-v1');
  const r=await p.page.evaluate(async()=>{
   const unchanged=app.getMusicalSnapshot();app.updateTrack(0,{melody:notes});outbound=[];
   await sync.sendState(app.getCurrentStateForPreset(true));await new Promise(r=>setTimeout(r,160));
   return {unchanged,outbound,starts,receivedSongs,play:sync.broadcastScheduledPlay(),notes:app.getTracks()[0].melody};
  });
  expect(r.unchanged).toEqual(baseline);expect(r.starts).toBe(0);expect(r.receivedSongs).toEqual([]);
  expect(r.play).toBe(false);expect(r.notes.bars[0]).toHaveLength(1);
  expect(r.outbound.some(m=>['state','song-change-command','transport-command'].includes(m.type))).toBe(false);
 }finally{await p.page.evaluate(()=>sync.disconnect());await p.context.close()}
});
test('updated server rejects late join and host replacement from the unintegrated client without changing authority',async({browser})=>{
 const p=await open(browser);let c;try{
  await p.page.evaluate(()=>{window.engineMelodyReady=true;return sync.initializeWebRTC()});
  await expect.poll(()=>p.page.evaluate(()=>sync.isSynchronizationJoined())).toBe(true);
  await p.page.evaluate(async()=>{app.updateTrack(0,{melody:notes});await sync.sendState(app.getCurrentStateForPreset(true))});
  const room=[...signal.rooms.values()].find(r=>r.host?.readyState===1);
  await expect.poll(()=>Boolean(room.state?.payload?.Tracks[0]?.melody)).toBe(true);
  const originalHost=room.host,originalState=room.state,revision=room.revision;
  c=await open(browser,signal.wss.address().port,room.id);
  await c.page.evaluate(()=>sync.initializeWebRTC());
  await expect.poll(()=>c.page.evaluate(()=>inbound.some(m=>m.code==='incompatible-client'))).toBe(true);
  expect(await c.page.evaluate(()=>sync.isSynchronizationJoined())).toBe(false);
  // Genuine host proof cannot bypass missing playback semantics.
  const credential=await p.page.evaluate(()=>sessionStorage.getItem('host_credential'));
  await c.page.evaluate(({room,credential})=>{wire.send(JSON.stringify({type:'join',room,requestedRole:'host',hostCredential:credential,capabilities:['rehearsal-v1','song-v2']}))},{room:room.id,credential});
  await expect.poll(()=>c.page.evaluate(()=>inbound.filter(m=>m.code==='incompatible-client').length)).toBe(2);
  expect(room.host).toBe(originalHost);expect(room.state).toBe(originalState);expect(room.revision).toBe(revision);
 }finally{if(c){await c.page.evaluate(()=>sync.disconnect());await c.context.close()}await p.page.evaluate(()=>sync.disconnect());await p.context.close()}
});
test('reconnect re-advertises actual readiness and cannot downgrade a retained melody room',async({browser})=>{
 const p=await open(browser);try{
  await p.page.evaluate(()=>{window.engineMelodyReady=true;return sync.initializeWebRTC()});
  await expect.poll(()=>p.page.evaluate(()=>sync.getSyncDiagnostics().timeSyncReady)).toBe(true);
  await p.page.evaluate(async()=>{app.updateTrack(0,{melody:notes});await sync.sendState(app.getCurrentStateForPreset(true))});
  const room=[...signal.rooms.values()].find(r=>r.host?.readyState===1);
  await expect.poll(()=>Boolean(room.state?.payload?.Tracks[0]?.melody)).toBe(true);
  const retained=room.state;
  await p.page.evaluate(()=>{window.engineMelodyReady=false;outbound=[];inbound=[];sync.reconnectSynchronization()});
  await expect.poll(()=>Boolean(room.recoveryTimer)).toBe(true);
  const disconnectedState=room.state;
  expect(disconnectedState.payload).toEqual(retained.payload);
  await expect.poll(()=>p.page.evaluate(()=>inbound.some(m=>m.code==='incompatible-client'))).toBe(true);
  const r=await p.page.evaluate(()=>({joined:sync.isSynchronizationJoined(),join:outbound.find(m=>m.type==='join'),notes:app.getTracks()[0].melody,outbound}));
  expect(r.joined).toBe(false);expect(r.join.capabilities).not.toContain('melody-v1');
  expect(r.notes.bars[0]).toHaveLength(1);expect(room.state).toBe(disconnectedState);
  expect(r.outbound.some(m=>['state','transport-command','song-change-command'].includes(m.type))).toBe(false);
 }finally{await p.page.evaluate(()=>sync.disconnect());await p.context.close()}
});
test('mixed peers reject melody without erasing host notes or changing server authority',async({browser})=>{
 const h=await open(browser);let c;try{
  await h.page.evaluate(()=>{window.engineMelodyReady=true;return sync.initializeWebRTC()});
  await expect.poll(()=>h.page.evaluate(()=>sync.getSyncDiagnostics().timeSyncReady)).toBe(true);
  const room=[...signal.rooms.values()].find(r=>r.host?.readyState===1);
  c=await open(browser,signal.wss.address().port,room.id);await c.page.evaluate(()=>sync.initializeWebRTC());
  await expect.poll(()=>c.page.evaluate(()=>sync.isSynchronizationJoined())).toBe(true);
  const before={host:room.host,state:room.state,revision:room.revision};
  await h.page.evaluate(async()=>{app.updateTrack(0,{melody:notes});await sync.sendState(app.getCurrentStateForPreset(true))});
  await expect.poll(()=>h.page.evaluate(()=>inbound.some(m=>m.code==='incompatible-client'))).toBe(true);
  // The ordered refresh following the rejection is consumed before observation.
  await h.page.evaluate(()=>new Promise(r=>setTimeout(r,100)));
  expect(await h.page.evaluate(()=>app.getTracks()[0].melody?.bars[0]?.length)).toBe(1);
  expect(room.host).toBe(before.host);expect(room.state).toBe(before.state);expect(room.revision).toBe(before.revision);
  expect(await c.page.evaluate(()=>inbound.some(m=>m.type==='state'&&m.payload?.Tracks?.some(t=>t.melody)))).toBe(false);
 }finally{if(c){await c.page.evaluate(()=>sync.disconnect());await c.context.close()}await h.page.evaluate(()=>sync.disconnect());await h.context.close()}
});
test('a queued-only disabled melody still gates playback after engine readiness is lost',async({browser})=>{
 const p=await open(browser);try{
  await p.page.evaluate(()=>{window.engineMelodyReady=true;return sync.initializeWebRTC()});
  await expect.poll(()=>p.page.evaluate(()=>sync.getSyncDiagnostics().timeSyncReady)).toBe(true);
  const room=[...signal.rooms.values()].find(r=>r.host?.readyState===1);
  const song=await p.page.evaluate(()=>({...app.getSong(),enabled:false,sections:[{name:'Queue',startBar:0,tempo:120,repeats:1,tracks:[{...app.getMusicalSnapshot().Tracks[0],melody:notes}]}]}));
  room.host.send(JSON.stringify({type:'song-change',room:room.id,version:1,song,sectionIndex:0,startBar:0,effectiveAt:Date.now()+30000}));
  await expect.poll(()=>p.page.evaluate(()=>receivedSongs.length)).toBe(1);
  const r=await p.page.evaluate(()=>{window.engineMelodyReady=false;outbound=[];return {played:sync.broadcastScheduledPlay(),outbound}});
  expect(r.played).toBe(false);expect(r.outbound.some(m=>m.type==='transport-command')).toBe(false);
 }finally{await p.page.evaluate(()=>sync.disconnect());await p.context.close()}
});
test('queued command envelopes cannot smuggle capture drafts beside a valid melody song',async({browser})=>{
 const p=await open(browser);try{
  await p.page.evaluate(()=>{window.engineMelodyReady=true;return sync.initializeWebRTC()});
  await expect.poll(()=>p.page.evaluate(()=>sync.getSyncDiagnostics().timeSyncReady)).toBe(true);
  const r=await p.page.evaluate(()=>{
   const song={...app.getSong(),sections:[{name:'A',startBar:0,tempo:120,repeats:1,tracks:[{...app.getMusicalSnapshot().Tracks[0],melody:notes}]}]};outbound=[];
   const sent=sync.sendSongChangeCommand({version:1,song,sectionIndex:0,startBar:0,effectiveAt:Date.now()+30000,captureDraft:'PRIVATE_QUEUE_SENTINEL'});
   return {sent,outbound};
  });
  expect(r.sent).toBe(false);expect(JSON.stringify(r.outbound)).not.toContain('PRIVATE_QUEUE_SENTINEL');
 }finally{await p.page.evaluate(()=>sync.disconnect());await p.context.close()}
});
test('ready protocol refuses opaque private envelopes before any socket publication',async({browser})=>{
 const p=await open(browser);try{
  await p.page.evaluate(()=>{window.engineMelodyReady=true;return sync.initializeWebRTC()});
  await expect.poll(()=>p.page.evaluate(()=>sync.getSyncDiagnostics().timeSyncReady)).toBe(true);
  const r=await p.page.evaluate(async()=>{
   app.updateTrack(0,{melody:notes});
   const state=await app.getCurrentStateForPreset(true);
   state.captureDraft={pcm:'PRIVATE_READY_SENTINEL'};outbound=[];
   await sync.sendState(Promise.resolve(state));await new Promise(r=>setTimeout(r,180));
   return {outbound,notes:app.getTracks()[0].melody};
  });
  expect(JSON.stringify(r.outbound)).not.toContain('PRIVATE_READY_SENTINEL');
  expect(r.outbound.some(m=>m.type==='state')).toBe(false);
  expect(r.notes.bars[0]).toHaveLength(1);
 }finally{await p.page.evaluate(()=>sync.disconnect());await p.context.close()}
});
test('unintegrated engine never advertises melody and blocks empty disabled melody publication, queue and play',async({browser})=>{
 const p=await open(browser);try{
  await p.page.evaluate(()=>sync.initializeWebRTC());
  await expect.poll(()=>p.page.evaluate(()=>sync.isSynchronizationJoined())).toBe(true);
  await expect.poll(()=>p.page.evaluate(()=>sync.getSyncDiagnostics().timeSyncReady)).toBe(true);
  const r=await p.page.evaluate(async()=>{
   const advertised=outbound.find(m=>m.type==='join').capabilities;
   const section={...app.getMusicalSnapshot().Tracks[0],melody:{version:1,bars:[[]]}};
   app.setSong({enabled:false,sections:[{name:'A',startBar:0,tempo:120,repeats:1,tracks:[section]}]});
   outbound=[];
   const accepted=await sync.sendState(app.getCurrentStateForPreset(true));
   await new Promise(r=>setTimeout(r,160));
   const queued=sync.sendSongChangeCommand({version:1,song:app.getSong(),sectionIndex:0,startBar:0,effectiveAt:Date.now()+30000});
   const played=sync.broadcastScheduledPlay();
   return {advertised,accepted,queued,played,outbound,notes:app.getSong().sections[0].tracks?.[0]?.melody,message:sync.getRehearsalRoomState().recoveryMessage};
  });
  expect(r.advertised).not.toContain('melody-v1');
  expect(r.outbound.filter(m=>['state','song-change-command','transport-command'].includes(m.type))).toEqual([]);
  expect(r.queued||r.played).toBe(false);
  expect(r.notes).toEqual({version:1,bars:[[]]});
  expect(r.message).toContain('melody-v1');
 }finally{await p.page.evaluate(()=>sync.disconnect());await p.context.close()}
});
test('export never retains capture drafts or unknown metadata anywhere around notes',async({browser})=>{
 const p=await open(browser);try{
  const r=await p.page.evaluate(async()=>{
   app.updateTrack(0,{melody:notes});
   app.getTracks()[0].captureDraft={pcm:'PRIVATE_PCM_SENTINEL'};
   app.getTracks()[0].mainBeatSound.captureDraft='PRIVATE_PCM_SENTINEL';
   app.getTracks()[0].barSettings[0].captureDraft='PRIVATE_PCM_SENTINEL';
   app.getTracks()[0].barSettings[0].beatSounds={0:{mainBeatSound:{sound:'Synth Kick',settings:{captureDraft:'PRIVATE_PCM_SENTINEL'},captureDraft:'PRIVATE_PCM_SENTINEL'}}};
   const payload=await songs.createPayload();
   const bad=structuredClone(payload);bad.state.Tracks[0].melody.version=9;
   let rejected=false;try{songs.validatePayload(bad)}catch{rejected=true}
   const old=structuredClone(payload);old.version=1;
   let oldRejected=false;try{songs.validatePayload(old)}catch{oldRejected=true}
   return {payload,rejected,oldRejected};
  });
  expect(JSON.stringify(r.payload)).not.toContain('PRIVATE_PCM_SENTINEL');
  expect(r.payload.state.Tracks[0].melody.bars[0]).toHaveLength(1);
  expect(r.rejected&&r.oldRejected).toBe(true);
 }finally{await p.context.close()}
});
test('section save preserves notes while excluding recording aliases, beat assets and capture settings',async({browser})=>{
 const p=await open(browser);try{
  const r=await p.page.evaluate(async()=>{
   document.body.innerHTML='<button id="song-mode-enabled" aria-pressed="false"></button><div id="song-mode-panel"><input id="song-name-input"><div id="song-sections-list"></div><button id="add-song-section-btn"></button></div>';
   await songs.initialize(()=>{});
   app.addRecording('SECRET_LOCAL.wav');app.addCustomSound('SECRET_ALIAS','SECRET_LOCAL.wav',{});
   app.updateTrack(0,{melody:notes});
   const track=app.getTracks()[0];track.mainBeatSound.settings.captureDraft='SECRET_PCM';
   track.barSettings[0].beatSounds={0:{mainBeatSound:{sound:'SECRET_ALIAS',settings:{captureDraft:'SECRET_PCM'}}}};
   document.querySelector('[data-song-section-action="update"]').click();
   await new Promise(r=>setTimeout(r,20));
   return {saved:app.getSong().sections[0].tracks[0],payload:await songs.createPayload()};
  });
  expect(r.saved.melody.bars[0]).toHaveLength(1);
  expect(JSON.stringify(r.saved)).not.toContain('SECRET_');
  expect(JSON.stringify(r.payload)).not.toContain('SECRET_');
 }finally{await p.context.close()}
});
test('applying a short melody section expands meter without dropping notes or duplicating note IDs',async({browser})=>{
 const p=await open(browser);try{
  await p.page.evaluate(async()=>{
   const track={...app.getMusicalSnapshot().Tracks[0],melody:notes};
   const bar=app.getTracks()[0].barSettings[0];app.updateTrack(0,{barSettings:[structuredClone(bar),structuredClone(bar)]});
   app.setSong({enabled:false,sections:[{name:'A',startBar:0,tempo:120,repeats:1,tracks:[track]},{name:'B',startBar:1,tempo:120,repeats:1}]});
   document.body.innerHTML='<button id="song-mode-enabled" aria-pressed="false"></button><div id="song-mode-panel"><input id="song-name-input"><div id="song-sections-list"></div><button id="add-song-section-btn"></button></div>';
   await songs.initialize(()=>{});document.querySelector('[data-song-section-action="apply"]').click();
  });
  await expect.poll(()=>p.page.evaluate(()=>app.getTracks()[0].melody?.bars)).toEqual([[{id:'n',midi:60,startTick:0,durationTicks:960,velocity:.8}],[]]);
 }finally{await p.context.close()}
});
test('v1 arrangement cannot silently discard melody-bearing section snapshots',async({browser})=>{
 const p=await open(browser);try{
  const rejected=await p.page.evaluate(async()=>{
   app.updateTrack(0,{melody:notes});
   app.setSong({enabled:false,sections:[{startBar:0,tempo:120,repeats:1,tracks:app.getMusicalSnapshot().Tracks}]});
   const payload=await songs.createPayload();payload.state.song.version=1;
   try{songs.validatePayload(payload);return false}catch{return true}
  });
  expect(rejected).toBe(true);
 }finally{await p.context.close()}
});
test('melody song files are versioned and retain detached notes in root and disabled sections',async({browser})=>{
  const p=await open(browser);try{
    const r=await p.page.evaluate(async()=>{
      app.updateTrack(0,{melody:notes});
      app.setSong({enabled:false,sections:[{startBar:0,tempo:120,repeats:1,tracks:app.getMusicalSnapshot().Tracks}]});
      const payload=await songs.createPayload();
      const validated=songs.validatePayload(payload);
      await songs.applyPayload(payload,{allowBeforeConnection:true});
      return {payload,validated,applied:app.getMusicalSnapshot()};
    });
    expect(r.payload.version).toBe(2);
    expect(r.validated.state.Tracks[0].melody).toEqual(r.payload.state.Tracks[0].melody);
    expect(r.validated.state.song.sections[0].tracks[0].melody).toEqual(r.payload.state.Tracks[0].melody);
    expect(r.applied.Tracks[0].melody).toEqual(r.payload.state.Tracks[0].melody);
    expect(r.applied.song.sections[0].tracks[0].melody).toEqual(r.payload.state.Tracks[0].melody);
  }finally{await p.context.close();}
});
