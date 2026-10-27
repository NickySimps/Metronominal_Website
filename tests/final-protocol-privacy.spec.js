const { test, expect } = require('@playwright/test');

// Probe the actual engine, not app startup: Windows WebKit ships without Web Audio.
// Keep pure UI/protocol tests running and fail unexpected absence on supported engines.
async function requireNativeAudio(browser, reason) {
 const probe=await browser.newPage();
 let missing;
 try { missing=await probe.evaluate(()=>['AudioContext','OfflineAudioContext','AudioBuffer','AnalyserNode'].filter(name=>typeof globalThis[name]!=='function')); }
 finally { await probe.close(); }
 test.skip(process.platform==='win32'&&browser.browserType().name()==='webkit'&&missing.length>0,
  `${reason}; Windows Playwright WebKit lacks native ${missing.join(', ')} (runtime probe; not SDK/TLS).`);
 expect(missing,`${reason}: supported engine must expose real Web Audio`).toEqual([]);
}
const prepareWorkflowTestPage=require('./workflowTestPage.cjs');

const http=require('http'),fs=require('fs'),path=require('path');
const {createSyncServer}=require('../../MetronomeSignalServer/server');
const {execFileSync}=require('child_process');
const legacyEngine=execFileSync('git',['show','c4172f18:js/metronomeEngine.js'],{cwd:path.resolve(__dirname,'..'),encoding:'utf8'});
const legacyRestFunction=legacyEngine.match(/export function isRestedSlot\([^]*?\n}/)[0].replace('export ','');
const legacyCapabilities=JSON.parse(execFileSync('git',['show','c4172f18:js/webrtc.js'],{cwd:path.resolve(__dirname,'..'),encoding:'utf8'}).match(/const SYNC_CAPABILITIES = (\[[^;]+\]);/)[1]);
let signal,web;
test.beforeAll(async()=>{signal=createSyncServer({port:10038,logger:{log(){},warn(){}}});await new Promise(r=>signal.wss.once('listening',r));const root=path.resolve(__dirname,'..');web=http.createServer((q,s)=>{let f=path.join(root,new URL(q.url,'http://x').pathname);if(fs.existsSync(f)&&fs.statSync(f).isDirectory())f=path.join(f,'index.html');fs.readFile(f,(e,b)=>{s.setHeader('Content-Type',f.endsWith('.js')?'text/javascript':f.endsWith('.html')?'text/html':f.endsWith('.css')?'text/css':'application/octet-stream');s.statusCode=e?404:200;s.end(e?'':b);});});await new Promise(r=>web.listen(4238,'127.0.0.1',r));});
test.afterAll(async()=>{await signal?.close();await new Promise(r=>web.close(r));});
async function open(browser,url='http://127.0.0.1:4238',legacyServer=false,peerCaps=null) {const context=await browser.newContext({serviceWorkers:'block'});if(peerCaps)await context.addInitScript(caps=>{window.__joinCapabilities=caps;},peerCaps);await context.addInitScript(()=>{const W=WebSocket;window.WebSocket=class extends W{constructor(u,...a){super(u==='ws://127.0.0.1:10000'?'ws://127.0.0.1:10038':u,...a);window.__wire=this;window.__outbound=[];const send=this.send.bind(this);this.send=data=>{const message=JSON.parse(data);if(message.type==='join'&&window.__joinCapabilities)message.capabilities=window.__joinCapabilities;window.__outbound.push(message);return send(JSON.stringify(message));};window.__wireMessages=[];this.addEventListener('message',e=>{const m=JSON.parse(e.data);if(['song-change','error'].includes(m.type))window.__wireMessages.push(m);});}};window.__starts=[];for(const method of ['createOscillator','createBufferSource']){const prototype=globalThis.AudioContext?.prototype;if(typeof prototype?.[method]!=='function')continue;const create=prototype[method];prototype[method]=function(...args){const source=create.apply(this,args),start=source.start.bind(source);source.start=(time,...rest)=>{window.__starts.push({time,now:this.currentTime});return start(time,...rest);};return source;};}});if(legacyServer)await context.addInitScript(()=>{const d=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(WebSocket.prototype),'onmessage');Object.defineProperty(WebSocket.prototype,'onmessage',{get(){return d.get.call(this);},set(fn){d.set.call(this,e=>{const m=JSON.parse(e.data);if(m.type==='joined')m.capabilities=m.capabilities.filter(c=>c!=='logical-beats-v1');fn(new MessageEvent('message',{data:JSON.stringify(m)}));});}});});const page=await context.newPage();await prepareWorkflowTestPage(page);const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(url);await expect.poll(()=>page.evaluate(async()=>(await import('./js/webrtc.js')).isSynchronizationJoined())).toBe(true);const dismiss=page.locator('#dismiss-connection-modal-btn');if(await dismiss.isVisible())await dismiss.click();await page.locator('#speed-trainer-btn').click();await page.evaluate(async()=>{const ctx=(await import('./js/appState.js')).default.getAudioContext();if(ctx)await ctx.resume();});return{context,page,errors};}

async function privateDraft(page,name){return page.evaluate(async name=>{const a=(await import('./js/appState.js')).default,ctx=a.getAudioContext();const b=ctx.createBuffer(1,1024,ctx.sampleRate);a.addRecording('held-private.wav');a.setSoundBuffer('held-private.wav',b);const track=JSON.parse(JSON.stringify(a.getMusicalSnapshot().Tracks[0]));track.mainBeatSound={sound:'held-private.wav',settings:{}};const song={version:2,enabled:true,name,sections:[{name:'A',startBar:0,tempo:240,repeats:1,tracks:[track]}]};return(await import('./js/practiceTransport.js')).queueSongChange(song,{sectionIndex:0});},name);}
test('SEC-1 stopped real wire sanitizes nested private metadata without requiring native audio',async({browser})=>{
 const h=await open(browser),c=await open(browser,h.page.url());
 try{
  await expect.poll(()=>h.page.evaluate(async()=>(await import('./js/webrtc.js')).getSyncDiagnostics().clockOffset)).not.toBe(null);
  const r=await h.page.evaluate(async()=>{
   const a=(await import('./js/appState.js')).default,r=await import('./js/webrtc.js');
   for(const name of ['imported-client-secret.wav','Recording 1'])a.addRecording(name);
   a.addCustomSound('private indirect','imported-client-secret.wav',{});a.addCustomSound('private transitive','private indirect',{});
   const track=JSON.parse(JSON.stringify(a.getMusicalSnapshot().Tracks[0]));
   track.mainBeatSound={sound:'imported-client-secret.wav',settings:{}};track.subdivisionSound={sound:'private transitive',settings:{}};
   track.barSettings[0].beatSounds={0:{mainBeatSound:{sound:'Recording 1',settings:{}},subdivisionSound:{sound:'private transitive',settings:{}}}};
   const song={version:2,enabled:true,name:'Stopped private wire',sections:[{name:'A',startBar:0,tempo:240,repeats:1,tracks:[track]}]};
   window.__stoppedPrivateSong=song;window.__outbound=[];
   const sent=r.sendSongChangeCommand({version:1,song,sectionIndex:0,startBar:0,effectiveAt:Date.now()+r.getTimeOffset()+2000});
   return{sent,original:JSON.parse(JSON.stringify(song))};
  });
  expect(r.sent).toBe(true);
  await expect.poll(()=>h.page.evaluate(()=>window.__outbound.filter(m=>m.type==='song-change-command').length)).toBe(1);
  const wire=await h.page.evaluate(()=>window.__outbound.find(m=>m.type==='song-change-command'));
  expect(wire.change.song.sections[0].tracks[0].mainBeatSound.sound).toBe('Synth Kick');expect(wire.change.song.sections[0].tracks[0].subdivisionSound.sound).toBe('Synth HiHat');
  for(const secret of ['imported-client-secret.wav','Recording 1','private indirect','private transitive','recordings','serializedRecordings','audioBuffer','soundBuffers'])expect(JSON.stringify(wire)).not.toContain(secret);
  // A stopped room deliberately refuses queued transport; verify that refusal, then
  // exercise the ordinary real state receive boundary without inventing playback.
  await expect.poll(()=>h.page.evaluate(()=>window.__wireMessages.some(m=>m.type==='error'&&m.code==='invalid-song-change'))).toBe(true);
  await h.page.evaluate(async()=>{const a=(await import('./js/appState.js')).default;a.setSong(window.__stoppedPrivateSong);await(await import('./js/webrtc.js')).sendState(a.getCurrentStateForPreset(true));});
  await expect.poll(()=>c.page.evaluate(async()=>(await import('./js/appState.js')).default.getSong().name)).toBe('Stopped private wire');
  const remote=await c.page.evaluate(async()=>(await import('./js/appState.js')).default.getSong());
  for(const secret of ['imported-client-secret.wav','Recording 1','private indirect','private transitive'])expect(JSON.stringify(remote)).not.toContain(secret);
  expect(await h.page.evaluate(()=>window.__stoppedPrivateSong)).toEqual(r.original);
  expect(h.errors).toEqual([]);expect(c.errors).toEqual([]);
 }finally{await h.context.close();await c.context.close();}
});
test('SEC-1 replaced awaiting command restores only its exact private intent',async({browser})=>{await requireNativeAudio(browser,"SEC-1 replaced awaiting command restores only its exact private intent requires native private AudioBuffer and live transport");
 const h=await open(browser);try{
  await h.page.locator('#speed-trainer-modal .close-button').click();await h.page.locator('#start-stop-btn').click();await expect.poll(()=>h.page.evaluate(async()=>(await import('./js/appState.js')).default.isPlaying())).toBe(true);
  const room=[...signal.rooms.values()].find(r=>r.host?.readyState===1),send=room.host.send.bind(room.host),held=[];
  room.host.send=(raw,...args)=>{if(JSON.parse(raw).type==='song-change')held.push(raw);else send(raw,...args);};
  await privateDraft(h.page,'First private intent');await privateDraft(h.page,'Replacement private intent');
  await expect.poll(()=>held.length).toBe(3);
  const commands=await h.page.evaluate(()=>window.__outbound.filter(m=>m.type==='song-change-command').map(m=>m.change));expect(commands[0].commandId).not.toBe(commands[1].commandId);
  for(const raw of held)send(raw);room.host.send=send;
  await expect.poll(()=>h.page.evaluate(async()=>(await import('./js/practiceTransport.js')).getPendingSongChange()?.song.name)).toBe('Replacement private intent');
  const pending=await h.page.evaluate(async()=>(await import('./js/practiceTransport.js')).getPendingSongChange());expect(pending.song.sections[0].tracks[0].mainBeatSound.sound).toBe('held-private.wav');
  expect(h.errors).toEqual([]);
 }finally{await h.context.close();}
});
for(const action of ['cancel','stop','disconnect','rotate'])test(`SEC-1 held private acknowledgement cannot survive ${action}`,async({browser})=>{await requireNativeAudio(browser,`Held private acknowledgement across ${action} requires native AudioBuffer and live transport`);
 const h=await open(browser);try{
  await h.page.locator('#speed-trainer-modal .close-button').click();await h.page.locator('#start-stop-btn').click();await expect.poll(()=>h.page.evaluate(async()=>(await import('./js/appState.js')).default.isPlaying())).toBe(true);
  const room=[...signal.rooms.values()].find(r=>r.host?.readyState===1),send=room.host.send.bind(room.host),held=[];
  room.host.send=(raw,...args)=>{if(JSON.parse(raw).type==='song-change')held.push(raw);else send(raw,...args);};
  await privateDraft(h.page,'Revoked private intent');await expect.poll(()=>held.length).toBe(1);
  await h.page.evaluate(async action=>{const m=await import('./js/practiceTransport.js'),r=await import('./js/webrtc.js');if(action==='cancel')m.cancelPendingSongChange();else if(action==='stop')r.broadcastStop();else if(action==='disconnect')r.disconnect();else r.disconnectAllPeers();},action);
  for(const raw of held)if(room.host?.readyState===1)send(raw);room.host.send=send;
  await h.page.waitForTimeout(100);
  const pending=await h.page.evaluate(async()=>(await import('./js/practiceTransport.js')).getPendingSongChange());expect(JSON.stringify(pending)).not.toContain('held-private.wav');expect(h.errors).toEqual([]);
 }finally{await h.context.close();}
});
test('LOGIC-1 exact v192 rest predicate differs from current engine on sliced logical beat 3',async({browser})=>{
 const p=await open(browser);try{
  const r=await p.page.evaluate(async({legacyRestFunction,legacyCapabilities})=>{const timing=await import('./js/beatTiming.js'),engine=await import('./js/metronomeEngine.js');const old=new Function('getSlotInfo',legacyRestFunction+'; return isRestedSlot;')(timing.getSlotInfo),bar={beats:4,subdivision:1,beatSlices:{1:3},rests:[3]};return{old:Array.from({length:timing.getTotalSlots(bar)},(_,i)=>old(bar,i)),current:Array.from({length:timing.getTotalSlots(bar)},(_,i)=>engine.isRestedSlot(bar,i)),advertised:window.__outbound.find(m=>m.type==='join').capabilities,legacyCapabilities};},{legacyRestFunction,legacyCapabilities});
  expect(r.old).toEqual([false,true,true,true,false,true]);expect(r.current).toEqual([false,false,false,false,false,true]);expect(r.legacyCapabilities).not.toContain('logical-beats-v1');expect(r.advertised).toContain('logical-beats-v1');expect(p.errors).toEqual([]);
 }finally{await p.context.close();}
});
test('LOGIC-1 old-server receive fails closed on affected state and queue over real WebSocket',async({browser})=>{
 const p=await open(browser,undefined,true);try{
  const state=await p.page.evaluate(async()=>{window.__outbound=[];return(await import('./js/appState.js')).default.getCurrentStateForPreset(true);});
  const room=[...signal.rooms.values()].find(r=>r.host?.readyState===1);expect(room).toBeTruthy();
  state.Tracks[0].barSettings=[{beats:4,subdivision:1,beatSlices:{1:3},rests:[3]}];
  room.host.send(JSON.stringify({type:'state',room:room.id,revision:999,authoritativeRefresh:true,payload:state}));
  await expect.poll(()=>p.page.evaluate(async()=>(await import('./js/webrtc.js')).getRehearsalRoomState().recoveryMessage)).toContain('logical-beats-v1');
  const snapshot=state.Tracks.map(({currentBar,currentBeat,nextBeatTime,songRepeatIteration,...t})=>t);
  const song={version:2,enabled:true,name:'Unsafe incoming queue',sections:[{name:'A',startBar:0,tempo:120,repeats:1,tracks:snapshot}]};
  room.host.send(JSON.stringify({type:'song-change',room:room.id,revision:1000,version:1,song,sectionIndex:0,startBar:0,effectiveAt:Date.now()+500}));
  await p.page.waitForTimeout(650);
  const r=await p.page.evaluate(async()=>{const a=(await import('./js/appState.js')).default,m=await import('./js/practiceTransport.js'),r=await import('./js/webrtc.js');r.setRehearsalReadiness(true);return{bar:a.getTracks()[0].barSettings[0],pending:m.getPendingSongChange(),ready:r.getRehearsalRoomState().explicitReady,acks:window.__outbound.filter(m=>m.type==='state-ack'&&m.revision===999)};});
  expect(r.bar.beatSlices||{}).toEqual({});expect(r.pending).toBe(null);expect(r.ready).toBe(false);expect(r.acks).toEqual([]);expect(p.errors).toEqual([]);
 }finally{await p.context.close();}
});
test('LOGIC-1 real two-peer v192 advertisement rolls back affected edits; capable peers receive unchanged logical patterns',async({browser})=>{
 const h=await open(browser),old=await open(browser,h.page.url(),false,legacyCapabilities);let modern;
 try{
  const before=await h.page.evaluate(async()=>(await import('./js/appState.js')).default.getTracks()[0].barSettings.map(b=>({...b,beatSounds:b.beatSounds||{}})));
  await h.page.evaluate(async()=>{const a=(await import('./js/appState.js')).default;a.getTracks()[0].barSettings=[{beats:4,subdivision:1,beatSlices:{1:3},rests:[3]}];await(await import('./js/webrtc.js')).sendState(a.getCurrentStateForPreset(true));});
  await expect.poll(()=>h.page.evaluate(()=>window.__wireMessages.some(m=>m.type==='error'&&m.code==='incompatible-client'))).toBe(true);
  await expect.poll(()=>h.page.evaluate(async()=>(await import('./js/appState.js')).default.getTracks()[0].barSettings)).toEqual(before);
  expect(await old.page.evaluate(async()=>(await import('./js/appState.js')).default.getTracks()[0].barSettings)).toEqual(before);
  await old.context.close();await expect.poll(()=>[...signal.rooms.values()].find(r=>r.host?.readyState===1)?.clients.size).toBe(1);
  modern=await open(browser,h.page.url());
  await h.page.evaluate(async()=>{const a=(await import('./js/appState.js')).default;a.getTracks()[0].barSettings=[{beats:4,subdivision:1,beatSlices:{1:3},rests:[3]}];await(await import('./js/webrtc.js')).sendState(a.getCurrentStateForPreset(true));});
  await expect.poll(()=>modern.page.evaluate(async()=>(await import('./js/appState.js')).default.getTracks()[0].barSettings[0].rests)).toEqual([3]);
  for(const p of [h.page,modern.page]){const bar=await p.evaluate(async()=>(await import('./js/appState.js')).default.getTracks()[0].barSettings[0]);expect(bar.beatSlices).toEqual({1:3});expect(bar.rests).toEqual([3]);expect(bar).not.toHaveProperty('barFormat');}
  expect(h.errors).toEqual([]);expect(old.errors).toEqual([]);expect(modern.errors).toEqual([]);
 }finally{await h.context.close();await old.context.close();await modern?.context.close();}
});
test('LOGIC-1 old-server negotiation blocks affected publication and readiness without rewriting music',async({browser})=>{
 const p=await open(browser,undefined,true);
 try{
  const immediate=await p.page.evaluate(async()=>{const a=(await import('./js/appState.js')).default,r=await import('./js/webrtc.js');window.__outbound=[];a.getTracks()[0].barSettings=[{beats:4,subdivision:1,beatSlices:{1:3},rests:[3]}];await r.sendState(a.getCurrentStateForPreset(true));r.setRehearsalReadiness(true);return r.getRehearsalRoomState().explicitReady;});expect(immediate).toBe(false);
  await expect.poll(()=>p.page.evaluate(async()=>(await import('./js/webrtc.js')).getRehearsalRoomState().recoveryMessage)).toContain('logical-beats-v1');
  const r=await p.page.evaluate(async()=>{const a=(await import('./js/appState.js')).default,r=await import('./js/webrtc.js');return{wire:window.__outbound,bar:a.getTracks()[0].barSettings[0],ready:r.getRehearsalRoomState().explicitReady,queued:r.sendSongChangeCommand({version:1,song:{version:2,enabled:true,name:'Plain queue with affected live tracks',sections:[{name:'A',startBar:0,tempo:120,repeats:1}]},sectionIndex:0,startBar:0,effectiveAt:Date.now()+2000}),play:r.broadcastScheduledPlay()};});
  expect(r.wire.some(m=>m.type==='state')).toBe(false);expect(r.ready).toBe(false);expect(r.queued).toBe(false);expect(r.play).toBe(false);expect(r.bar).toEqual({beats:4,subdivision:1,beatSlices:{1:3},rests:[3]});expect(p.errors).toEqual([]);
  const room=[...signal.rooms.values()].find(r=>r.host?.readyState===1);room.host.send(JSON.stringify({type:'song-change',room:room.id,revision:2000,version:1,song:{version:2,enabled:true,name:'Plain queue cannot unblock affected live Tracks',sections:[{name:'A',startBar:0,tempo:120,repeats:1}]},sectionIndex:0,startBar:0,effectiveAt:Date.now()+2000}));
  await expect.poll(()=>p.page.evaluate(()=>window.__wireMessages.some(m=>m.revision===2000))).toBe(true);
  expect(await p.page.evaluate(async()=>(await import('./js/practiceTransport.js')).getPendingSongChange())).toBe(null);
 }finally{await p.context.close();}
});
test('SEC-1 real queued wire sanitizes every section while host keeps native private assets',async({browser})=>{await requireNativeAudio(browser,"SEC-1 real queued wire sanitizes every section while host keeps native private assets requires native private AudioBuffer and live transport");
 const h=await open(browser),c=await open(browser,h.page.url());
 try{
  await h.page.locator('#speed-trainer-modal .close-button').click();await h.page.locator('#start-stop-btn').click();
  await expect.poll(()=>c.page.evaluate(async()=>(await import('./js/appState.js')).default.isPlaying())).toBe(true);
  await h.page.evaluate(async()=>{
   const a=(await import('./js/appState.js')).default,m=await import('./js/practiceTransport.js'),ctx=a.getAudioContext();
   window.__privateBuffer=ctx.createBuffer(1,2048,ctx.sampleRate);window.__privateBuffer.getChannelData(0).fill(.23);
   window.__privateStarts=[];const create=ctx.createBufferSource.bind(ctx);ctx.createBufferSource=(...args)=>{const source=create(...args),start=source.start.bind(source);source.start=(time,...rest)=>{if(source.buffer===window.__privateBuffer)window.__privateStarts.push(time);return start(time,...rest);};return source;};
   for(const name of ['imported-client-secret.wav','Recording 1']){a.addRecording(name);a.setSoundBuffer(name,window.__privateBuffer);}
   a.addCustomSound('private indirect','imported-client-secret.wav',{});a.addCustomSound('private transitive','private indirect',{});
   const snapshot=JSON.parse(JSON.stringify(a.getMusicalSnapshot().Tracks[0]));
   snapshot.mainBeatSound={sound:'imported-client-secret.wav',settings:{}};snapshot.subdivisionSound={sound:'private transitive',settings:{}};
   snapshot.barSettings[0].beatSounds={0:{mainBeatSound:{sound:'Recording 1',settings:{}},subdivisionSound:{sound:'private transitive',settings:{}}}};
   window.__queuedSong={version:2,enabled:true,name:'Private queued draft',sections:[{name:'A',startBar:0,tempo:240,repeats:1,tracks:[snapshot]}]};
   window.__committed=0;document.addEventListener('songchangecommitted',()=>window.__committed++);
   m.queueSongChange(window.__queuedSong,{sectionIndex:0});
  });
  await expect.poll(()=>h.page.evaluate(()=>window.__outbound.filter(m=>m.type==='song-change-command').length)).toBe(1);
  const wire=await h.page.evaluate(()=>window.__outbound.find(m=>m.type==='song-change-command'));
  expect(wire.change.song.sections[0].tracks[0].mainBeatSound.sound).toBe('Synth Kick');
  expect(wire.change.song.sections[0].tracks[0].subdivisionSound.sound).toBe('Synth HiHat');
  for(const key of ['recordings','serializedRecordings','audioBuffer','soundBuffers'])expect(JSON.stringify(wire)).not.toContain(key);
  for(const secret of ['imported-client-secret.wav','Recording 1','private indirect','private transitive'])expect(JSON.stringify(wire)).not.toContain(secret);
  await expect.poll(()=>h.page.evaluate(()=>window.__committed)).toBe(1);
  const local=await h.page.evaluate(async()=>{const a=(await import('./js/appState.js')).default;return{song:a.getSong(),sound:a.getTracks()[0].mainBeatSound.sound,sameBuffer:a.getSoundBuffer('imported-client-secret.wav')===window.__privateBuffer,original:window.__queuedSong};});
  expect(local.song).toMatchObject(local.original);expect(local.sound).toBe('imported-client-secret.wav');expect(local.sameBuffer).toBe(true);
  await expect.poll(()=>h.page.evaluate(()=>window.__privateStarts.length)).toBeGreaterThan(0);
  await expect.poll(()=>c.page.evaluate(async()=>(await import('./js/appState.js')).default.getSong().name)).toBe('Private queued draft');
  const remote=await c.page.evaluate(async()=>(await import('./js/appState.js')).default.getSong());
  for(const secret of ['imported-client-secret.wav','Recording 1','private indirect','private transitive'])expect(JSON.stringify(remote)).not.toContain(secret);
  const room=[...signal.rooms.values()].find(r=>r.state?.payload.song.name==='Private queued draft');expect(room).toBeTruthy();
  // The peer materializes normal section/sound defaults; preserve every authoritative field.
  expect(remote).toMatchObject(room.state.payload.song);expect(h.errors).toEqual([]);expect(c.errors).toEqual([]);
  expect(await h.page.evaluate(()=>window.__wireMessages.filter(m=>m.type==='error'))).toEqual([]);expect(await c.page.evaluate(()=>window.__wireMessages.filter(m=>m.type==='error'))).toEqual([]);
 }finally{await h.context.close();await c.context.close();}
});
