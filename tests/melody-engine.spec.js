const { test, expect } = require('@playwright/test');
test.use({ channel: 'chrome', serviceWorkers: 'block' });
async function ready(page, room = null) {
  await page.goto('/js/beatTiming.js' + (room ? `?room=${encodeURIComponent(room)}` : ''));
  await page.setContent('<base href="/"><script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.187.0/build/three.module.js","three/examples/jsm/":"https://cdn.jsdelivr.net/npm/three@0.187.0/examples/jsm/"}}</script><main><div id="all-tracks-wrapper"></div></main>');
  await page.evaluate(async () => {
    window.app = (await import('/js/appState.js')).default;
    window.engine = (await import('/js/metronomeEngine.js')).default;
    window.transport = await import('/js/practiceTransport.js');
    app.resetState();
    app.initializeAudioContext();
    await app.getAudioContext().resume();
    window.notes = [], window.sources = [], window.errors = [];
    document.addEventListener('melodyplaybackerror', e => errors.push(e.detail));
    const ctx = app.getAudioContext(), create = ctx.createOscillator.bind(ctx);
    ctx.createOscillator = () => {
      const source = create(), start = source.start.bind(source), stop = source.stop.bind(source), set = source.frequency.setValueAtTime.bind(source.frequency);
      const record = { stops: [], frequencies: [] }; sources.push(source);
      source.frequency.setValueAtTime = (value, time) => { record.frequencies.push([value, time]); return set(value, time); };
      source.start = time => { record.time = time; record.type = source.type; notes.push(record); return start(time); };
      source.stop = time => { record.stops.push(time ?? ctx.currentTime); return stop(time); };
      return source;
    };
    window.n = (id, startTick, midi = 69, durationTicks = 240) => ({id, startTick, midi, durationTicks, velocity: .4});
    window.configure = (bars, melody, sound = 'Synth Sine', settings = {}) => {
      app.setTempo(120);
      app.updateTrack(0, { barSettings: bars, mainBeatSound: {sound, settings}, subdivisionSound: {sound: 'Synth Square',settings:{frequency: 100}}, ...(melody === null ? {} : {melody:{version:1,bars:melody}}) });
    };
  });
  await expect.poll(() => page.evaluate(() => engine.isSchedulerReady())).toBe(true);
}
test.afterEach(async ({page}) => { await page.evaluate(() => window.engine?.cancelPlayback()); });

test('engine explicitly exposes only its integrated melody protocol to the real room capability gate', async ({page}) => {
  await ready(page);
  expect(await page.evaluate(async()=>{
    const room=await import('/js/webrtc.js');
    return {supported:engine.supportsMelodyProtocol?.('melody-v1'),unknown:engine.supportsMelodyProtocol?.('melody-v2'),room:room.isMelodyProtocolReady()};
  })).toEqual({supported:true,unknown:false,room:true});
});

test('native synth keeps configured ADSR, waveform, velocity and gate duration instead of refusing settings', async ({page}) => {
  await ready(page);
  await page.evaluate(async () => {
    window.envelopes = [];
    const ctx=app.getAudioContext(), create=ctx.createGain.bind(ctx);
    ctx.createGain=()=>{const gain=create(), values=[];envelopes.push(values);
      for(const method of ['setValueAtTime','linearRampToValueAtTime']){const fn=gain.gain[method].bind(gain.gain);gain.gain[method]=(v,t)=>{values.push([method,v,t]);return fn(v,t);};}return gain;};
    configure([{beats:4,subdivision:1,rests:[]}],[[n('long',120,69,960)]], 'Synth Triangle', {attack:.03,decay:.04,sustain:.25,release:.06,volume:.5,pitchShift:0,frequency:1200});
    await engine.scheduleStart(Date.now()+300);
  });
  await expect.poll(() => page.evaluate(() => ({count:notes.length,errors}))).toEqual({count:1,errors:[]});
  const r=await page.evaluate(()=>({note:notes[0],envelopes}));
  expect(r.note.type).toBe('triangle'); expect(r.note.frequencies[0][0]).toBe(440);
  const start=r.note.time;
  expect(r.note.stops[0]).toBeCloseTo(start+.5+.06,5);
  expect(r.envelopes.some(e=>e.some(([m,v,t])=>m==='linearRampToValueAtTime'&&Math.abs(v-.2)<1e-8&&Math.abs(t-start-.03)<1e-7)&&e.some(([m,v,t])=>m==='linearRampToValueAtTime'&&Math.abs(v-.05)<1e-8&&Math.abs(t-start-.07)<1e-7))).toBe(true);
});

test('scheduled restart/seek cancels the old native generation before new notes', async ({page}) => {
  await ready(page);
  await page.evaluate(async()=>{configure([{beats:4,subdivision:1,rests:[]}],[[n('held',0,69,3000),n('later',1920,81)]]);await engine.scheduleStart(Date.now()+250);});
  await expect.poll(()=>page.evaluate(()=>notes.length)).toBe(1);
  const r=await page.evaluate(async()=>{const now=app.getAudioContext().currentTime;await engine.scheduleStart(Date.now()+300,0,2);return {now,oldStops:notes[0].stops};});
  expect(r.oldStops.some(t=>t<=r.now+.02)).toBe(true);
  await expect.poll(()=>page.evaluate(()=>notes.length)).toBe(2);
  expect(await page.evaluate(()=>notes[1].frequencies[0][0])).toBe(880);
});

test('pending authoritative seam clips held native notes and replaces off-grid future notes at the exact corrected boundary', async ({page}) => {
  await ready(page);
  await page.evaluate(async()=>{
    configure([{beats:4,subdivision:1,rests:[]}],[[n('held',0,69,3500),n('old-future',2880,72)]]);
    transport.setLocalOutputOffsetMs(70);window.commits=[];document.addEventListener('songchangecommitted',e=>commits.push(e.detail));
    await engine.scheduleStart(Date.now()+250);
  });
  await expect.poll(()=>page.evaluate(()=>notes.length)).toBe(1);
  const seam=await page.evaluate(()=>{
    const tracks=app.getMusicalSnapshot().Tracks;tracks[0].melody.bars=[[n('replacement',0,81,960)]];
    const song={version:2,enabled:true,name:'seam',sections:[{name:'New',startBar:0,tempo:120,repeats:1,tracks}]};
    if(!transport.receiveSongChange({version:1,revision:1,song,sectionIndex:0,startBar:0,effectiveAt:Date.now()+450}))throw Error('Fixture refused');
    return transport.getPendingSongChange().audioTime+.07;
  });
  await expect.poll(()=>page.evaluate(()=>commits.length)).toBe(1);
  await expect.poll(()=>page.evaluate(()=>notes.some(n=>n.frequencies[0][0]===880))).toBe(true);
  const r=await page.evaluate(()=>({notes,errors}));expect(r.errors).toEqual([]);
  expect(r.notes[0].stops.some(t=>Math.abs(t-seam)<.00001)).toBe(true);
  expect(r.notes.find(n=>n.frequencies[0][0]===880).time).toBeCloseTo(seam,5);
  expect(r.notes.filter(n=>n.frequencies[0][0]===523.2511306011972&&n.time>=seam)).toEqual([]);
});

test('practice ramp maps off-grid native onsets and gates through the authoritative analytic clock', async ({page}) => {
  await ready(page);
  const expected=await page.evaluate(async()=>{
    configure([{beats:4,subdivision:1,rests:[]}],[[n('ramp',480,81,960)]]);
    app.setPracticeConfig({...app.getPracticeConfig(),enabled:true,mode:'ramp',startBpm:120,targetBpm:240,warmupBars:0,rampBars:1,targetBars:1,recoveryBars:1,audibleBars:1,silentBars:0});
    await engine.scheduleStart(Date.now()+350);const anchor=app.getTracks()[0].nextBeatTime,c=app.getPracticeConfig();
    return {time:anchor+transport.practiceSecondsAtBeat(c,.5,4),gate:anchor+transport.practiceSecondsAtBeat(c,1.5,4)};
  });
  await expect.poll(()=>page.evaluate(()=>({count:notes.length,errors}))).toEqual({count:1,errors:[]});
  const note=await page.evaluate(()=>notes[0]);expect(note.time).toBeCloseTo(expected.time,5);expect(note.stops[0]).toBeCloseTo(expected.gate+.2,5);
});

test('practice gaps skip silent native notes and resume on the same analytic clock',async({page})=>{
  await ready(page);
  const anchor=await page.evaluate(async()=>{configure([{beats:1,subdivision:1,rests:[]}],[[n('gap-note',120,81,720)]]);app.setPracticeConfig({...app.getPracticeConfig(),enabled:true,mode:'step',startBpm:240,targetBpm:240,audibleBars:1,silentBars:1});await engine.scheduleStart(Date.now()+300);return app.getTracks()[0].nextBeatTime;});
  await expect.poll(()=>page.evaluate(()=>notes.length)).toBeGreaterThanOrEqual(3);
  const r=await page.evaluate(()=>({notes:notes.slice(0,3),errors}));expect(r.errors).toEqual([]);
  for(const[i,t]of [.03125,.53125,1.03125].entries())expect(r.notes[i].time).toBeCloseTo(anchor+t,5);
});

test('live tempo reanchors unscheduled off-grid notes to the existing scaled authoritative grid', async ({page}) => {
  await ready(page);
  await page.evaluate(async()=>{configure([{beats:4,subdivision:1,rests:[]}],[[n('first',0),n('next',480,81),n('later',1440,72)]]);await engine.scheduleStart(Date.now()+300);});
  await expect.poll(()=>page.evaluate(()=>notes.length)).toBe(1);
  const expected=await page.evaluate(()=>{app.setTempo(240);return app.getTracks()[0].nextBeatTime-.125;});
  await expect.poll(()=>page.evaluate(()=>notes.some(n=>n.frequencies[0][0]===880))).toBe(true);
  expect(await page.evaluate(()=>notes.find(n=>n.frequencies[0][0]===880).time)).toBeCloseTo(expected,5);
});

test('live instrument edit reanchors an intervening off-grid note before the next rhythm slot',async({page})=>{
  await ready(page);await page.evaluate(async()=>{configure([{beats:4,subdivision:1,rests:[]}],[[n('held',0,69,3000),n('intervening',480,81)]]);await engine.scheduleStart(Date.now()+350);});
  await expect.poll(()=>page.evaluate(()=>notes.length)).toBe(1);
  const r=await page.evaluate(()=>{const now=app.getAudioContext().currentTime,expected=app.getTracks()[0].nextBeatTime-.25;app.updateTrack(0,{mainBeatSound:{sound:'Synth Square',settings:{}}});return{now,expected,stops:notes[0].stops};});
  expect(r.stops.some(t=>t<=r.now+.01)).toBe(true);
  await expect.poll(()=>page.evaluate(()=>notes.some(n=>n.frequencies[0][0]===880))).toBe(true);
  const next=await page.evaluate(()=>notes.find(n=>n.frequencies[0][0]===880));expect(next.type).toBe('square');expect(next.time).toBeCloseTo(r.expected,5);
});

test('swing maps intermediate native onsets continuously between the existing swung grid anchors',async({page})=>{
  await ready(page);
  const anchor=await page.evaluate(async()=>{configure([{beats:4,subdivision:2,rests:[]}],[[n('before',240),n('anchor',480,81),n('after',720,72)]]);app.updateTrack(0,{swing:50});await engine.scheduleStart(Date.now()+300);return app.getTracks()[0].nextBeatTime;});
  await expect.poll(()=>page.evaluate(()=>({count:notes.length,errors}))).toEqual({count:3,errors:[]});
  const times=await page.evaluate(()=>notes.map(n=>n.time));for(const[i,t]of [.15625,.3125,.40625].entries())expect(times[i]).toBeCloseTo(anchor+t,5);
});

for (const mode of ['empty', 'legacy', 'unsupported', 'accessor']) test(`${mode} selection is explicit and never leaks a second rhythm path`, async ({page}) => {
  await ready(page);
  await page.evaluate(async mode=>{
    configure([{beats:1,subdivision:2,rests:[]}],mode==='legacy'?null:mode==='empty'?[[]]:[[n('one',0)]],mode==='unsupported'?'Synth Kick':'Synth Sine');
    if(mode==='swing')app.getTracks()[0].swing=30;
    window.reads=0;
    if(mode==='accessor')Object.defineProperty(app.getTracks()[0],'melody',{enumerable:true,configurable:true,get(){reads++;return {version:1,bars:[[n('one',0)]]};}});
    await engine.scheduleStart(Date.now()+200);
  },mode);
  if(['unsupported','swing','accessor'].includes(mode)){
    await expect.poll(()=>page.evaluate(()=>({playing:app.isPlaying(),count:errors.length}))).toEqual({playing:false,count:1});
    expect(await page.evaluate(()=>notes.length)).toBe(0);
    if(mode==='accessor')expect(await page.evaluate(()=>reads)).toBe(0);
  }else if(mode==='legacy'){
    await expect.poll(()=>page.evaluate(()=>notes.length)).toBeGreaterThanOrEqual(2);
    expect(await page.evaluate(()=>notes.slice(0,2).map(n=>n.frequencies[0][0]))).toEqual([440,100]);
  }else{
    await page.waitForTimeout(700);expect(await page.evaluate(()=>({notes:notes.length,errors,playing:app.isPlaying()}))).toEqual({notes:0,errors:[],playing:true});
  }
});

test('native rooted sample uses the loaded buffer at its exact transposed playback rate', async ({page}) => {
  await ready(page);
  await page.evaluate(async()=>{
    const ctx=app.getAudioContext(), buffer=ctx.createBuffer(1,ctx.sampleRate*4,ctx.sampleRate), data=buffer.getChannelData(0);
    for(let i=0;i<data.length;i++)data[i]=Math.sin(2*Math.PI*220*i/ctx.sampleRate);
    app.setSoundBuffer('Generated rooted sample',buffer);window.sampleNotes=[];
    const create=ctx.createBufferSource.bind(ctx);ctx.createBufferSource=()=>{const source=create(),start=source.start.bind(source),set=source.playbackRate.setValueAtTime.bind(source.playbackRate);let rate;
      source.playbackRate.setValueAtTime=(value,time)=>{rate=value;return set(value,time);};source.start=(time,...rest)=>{sampleNotes.push({identity:source.buffer===buffer,time,rate});return start(time,...rest);};return source;};
    app.updateTrack(0,{barSettings:[{beats:4,subdivision:1,rests:[]}],mainBeatSound:{sound:'Generated rooted sample',settings:{}},melody:{version:1,sampleRootMidi:57,bars:[[n('sample',120,69,960)]]}});
    app.setTempo(120);await engine.scheduleStart(Date.now()+250);window.anchor=app.getTracks()[0].nextBeatTime;
  });
  await expect.poll(()=>page.evaluate(()=>sampleNotes.length)).toBe(1);
  const r=await page.evaluate(()=>({sample:sampleNotes[0],anchor,errors}));expect(r.errors).toEqual([]);expect(r.sample.identity).toBe(true);expect(r.sample.rate).toBe(2);expect(r.sample.time).toBeCloseTo(r.anchor+.0625,5);
});

test('live native analyser measures the scheduled MIDI pitch, not merely an AudioParam claim', async ({page}) => {
  await ready(page);
  await page.evaluate(async()=>{
    configure([{beats:4,subdivision:1,rests:[]}],[[n('sustain',0,81,3000)]]);
    const ctx=app.getAudioContext();window.probe=ctx.createAnalyser();probe.fftSize=8192;
    app.getTracks()[0].mainAnalyserNode.connect(probe);
    await engine.scheduleStart(Date.now()+250);
  });
  await expect.poll(()=>page.evaluate(()=>notes.length)).toBe(1);
  await expect.poll(()=>page.evaluate(()=>app.getAudioContext().currentTime-notes[0].time)).toBeGreaterThan(.3);
  const r=await page.evaluate(()=>{
    const data=new Float32Array(probe.fftSize);probe.getFloatTimeDomainData(data);const crossings=[];let peak=0;
    for(let i=1;i<data.length;i++){peak=Math.max(peak,Math.abs(data[i]));if(data[i-1]<=0&&data[i]>0)crossings.push(i-data[i]/(data[i]-data[i-1]));}
    return {peak,hz:(crossings.length-1)*app.getAudioContext().sampleRate/(crossings.at(-1)-crossings[0])};
  });
  expect(r.peak).toBeGreaterThan(.01);expect(r.hz).toBeCloseTo(880,1);
});

for(const action of ['mute','stop','practice'])test(`${action} cancels held native notes synchronously without affecting the shared context`,async({page})=>{
  await ready(page);
  await page.evaluate(async()=>{configure([{beats:4,subdivision:1,rests:[]}],[[n('held',0,69,3500)]]);await engine.scheduleStart(Date.now()+250);});
  await expect.poll(()=>page.evaluate(()=>notes.length)).toBe(1);
  const r=await page.evaluate(action=>{const ctx=app.getAudioContext(),now=ctx.currentTime;if(action==='mute')app.updateTrack(0,{muted:true});else if(action==='practice')app.setPracticeConfig({...app.getPracticeConfig(),enabled:true});else engine.cancelPlayback();return {state:ctx.state,stops:notes[0].stops,now};},action);
  expect(r.state).toBe('running');expect(r.stops.some(t=>t<=r.now+.01)).toBe(true);
});

test('section repeats preserve late old-bar notes, then switch native waveform and tempo at the next section',async({page})=>{
  await ready(page);
  const anchor=await page.evaluate(async()=>{
    configure([{beats:1,subdivision:1,rests:[]},{beats:1,subdivision:1,rests:[]}],[[n('old',900,69,60)],[n('unused',120,69)]]);
    const first=app.getMusicalSnapshot().Tracks,second=structuredClone(first);second[0].mainBeatSound={sound:'Synth Square',settings:{}};second[0].melody.bars[1]=[n('new',120,72)];
    app.setSong({version:2,enabled:true,name:'repeat-seam',sections:[{name:'A',startBar:0,tempo:240,repeats:2,tracks:first},{name:'B',startBar:1,tempo:120,repeats:1,tracks:second}]});
    app.applySongSectionForBar(0);await engine.scheduleStart(Date.now()+300);return app.getTracks()[0].nextBeatTime;
  });
  await expect.poll(()=>page.evaluate(()=>notes.length)).toBeGreaterThanOrEqual(3);
  const r=await page.evaluate(()=>({notes:notes.slice(0,3),errors}));expect(r.errors).toEqual([]);
  expect(r.notes.map(n=>n.frequencies[0][0])).toEqual([440,440,523.2511306011972]);expect(r.notes.map(n=>n.type)).toEqual(['sine','sine','square']);
  for(const[i,time]of [.234375,.484375,.5625].entries())expect(r.notes[i].time).toBeCloseTo(anchor+time,5);
});

test('ambiguous truncated fractional meter fails visibly before a wrong-duration note can play',async({page})=>{
  await ready(page);await page.evaluate(async()=>{configure([{beats:3,subdivision:.5,rests:[]}],[[n('unsafe',0,69,2880)]]);await engine.scheduleStart(Date.now()+250);});
  await expect.poll(()=>page.evaluate(()=>({playing:app.isPlaying(),errors:errors.length}))).toEqual({playing:false,errors:1});
  expect(await page.evaluate(()=>notes.length)).toBe(0);
});

test('sync-pulse nudge reanchors future native note events with the authoritative grid',async({page})=>{
  await ready(page);await page.evaluate(async()=>{configure([{beats:4,subdivision:1,rests:[]}],[[n('first',0),n('next',480,81)]]);await engine.scheduleStart(Date.now()+300);});
  await expect.poll(()=>page.evaluate(()=>notes.length)).toBe(1);
  const expected=await page.evaluate(()=>{const t=app.getTracks()[0],ctx=app.getAudioContext();engine.handleSyncPulse(Date.now()+(t.nextBeatTime-ctx.currentTime+.12)*1000,t.currentBar,t.currentBeat,t.songRepeatIteration||0);return t.nextBeatTime-.25;});
  await expect.poll(()=>page.evaluate(()=>notes.some(n=>n.frequencies[0][0]===880))).toBe(true);
  expect(await page.evaluate(()=>notes.find(n=>n.frequencies[0][0]===880).time)).toBeCloseTo(expected,5);
});

test('a delayed pulse for an already scheduled matching melody slot cannot rewind the lookahead cursor',async({page})=>{
  await ready(page);await page.evaluate(async()=>{configure([{beats:4,subdivision:1,rests:[]}],[[n('held',0,69,3500),n('next',480,81)]]);await engine.scheduleStart(Date.now()+350);});
  await expect.poll(()=>page.evaluate(()=>notes.length)).toBe(1);
  const evidence=await page.evaluate(()=>{
    const track=app.getTracks()[0],before={bar:track.currentBar,beat:track.currentBeat,time:track.nextBeatTime},stops=notes[0].stops.slice();
    engine.handleSyncPulse(Date.now()+(notes[0].time-app.getAudioContext().currentTime)*1000,0,0,0);
    return {before,after:{bar:track.currentBar,beat:track.currentBeat,time:track.nextBeatTime},stops,afterStops:notes[0].stops};
  });
  expect(evidence.after).toEqual(evidence.before);expect(evidence.afterStops).toEqual(evidence.stops);
  await expect.poll(()=>page.evaluate(()=>notes.length)).toBe(2);
  expect(await page.evaluate(()=>notes.map(n=>n.frequencies[0][0]))).toEqual([440,880]);
});

test('structural sync snap stops held old native notes before accepting the new score position',async({page})=>{
  await ready(page);await page.evaluate(async()=>{configure([{beats:4,subdivision:1,rests:[]},{beats:4,subdivision:1,rests:[]}],[[n('held',0,69,3500)],[n('new-position',0,81)]]);await engine.scheduleStart(Date.now()+1500);});
  await expect.poll(()=>page.evaluate(()=>notes.length)).toBe(1);
  const r=await page.evaluate(()=>{const now=app.getAudioContext().currentTime,track=app.getTracks()[0],targetBar=track.currentBar===0?1:0;engine.handleSyncPulse(Date.now()+300,targetBar,0,0);return {now,stops:notes[0].stops,targetBar};});
  expect(r.stops.some(t=>t<=r.now+.01)).toBe(true);
  await expect.poll(()=>page.evaluate(()=>notes.some(n=>n.frequencies[0][0]===880))).toBe(true);
});

test('loaded worker and native note scheduling continue with the browser network offline',async({page,context})=>{
  await ready(page);await context.setOffline(true);
  try{
    await page.evaluate(async()=>{configure([{beats:4,subdivision:1,rests:[]}],[[n('offline',120,81)]]);await engine.scheduleStart(Date.now()+250);});
    await expect.poll(()=>page.evaluate(()=>notes.length)).toBe(1);
    expect(await page.evaluate(()=>({hz:notes[0].frequencies[0][0],errors}))).toEqual({hz:880,errors:[]});
  }finally{await context.setOffline(false);}
});

test('negative local correction is applied exactly once to native off-grid onset',async({page})=>{
  await ready(page);
  const anchor=await page.evaluate(async()=>{configure([{beats:4,subdivision:1,rests:[]}],[[n('early',120,81)]]);transport.setLocalOutputOffsetMs(-120);await engine.scheduleStart(Date.now()+400);return app.getTracks()[0].nextBeatTime;});
  await expect.poll(()=>page.evaluate(()=>notes.length)).toBe(1);
  expect(await page.evaluate(()=>notes[0].time)).toBeCloseTo(anchor-.12+.0625,5);
});

test('two actual peers play and replace native melody only from server authority, then stop held sources', async ({browser}) => {
  const {createSyncServer}=require('../../MetronomeSignalServer/server');
  const signal=createSyncServer({port:0,logger:{log(){},warn(){}}});
  await new Promise(resolve=>signal.wss.once('listening',resolve));
  const peers=[];
  async function peer(roomId=null,offset=0){
    const context=await browser.newContext({serviceWorkers:'block'});peers.push({context});
    await context.addInitScript(port=>{
      const Native=WebSocket;window.inbound=[];window.outbound=[];
      window.WebSocket=class extends Native{constructor(url,...args){super(`ws://127.0.0.1:${port}`,...args);
        const send=this.send.bind(this);this.send=raw=>{outbound.push(JSON.parse(raw));return send(raw);};
        this.addEventListener('message',e=>inbound.push(JSON.parse(e.data)));}};
    },signal.wss.address().port);
    const page=await context.newPage(),pageErrors=[];page.on('pageerror',e=>pageErrors.push(e.message));
    Object.assign(peers.at(-1),{page,pageErrors});
    await ready(page,roomId);
    // Observe applied state directly; this module fixture has no full app UI.
    await page.evaluate(async offset=>{window.room=await import('/js/webrtc.js');transport.setLocalOutputOffsetMs(offset);await room.initializeWebRTC();room.onReceiveState(()=>{});},offset);
    await expect.poll(()=>page.evaluate(()=>room.isSynchronizationJoined()&&room.getSyncDiagnostics().timeSyncReady)).toBe(true);
    return page;
  }
  try{
    const host=await peer();
    await host.evaluate(async()=>{configure([{beats:4,subdivision:1,rests:[]}],[[n('held',0,69,3500),n('off-grid',480,72)]]);await room.sendState(app.getCurrentStateForPreset(true));});
    const authority=[...signal.rooms.values()][0];
    await expect.poll(()=>authority.state?.payload?.Tracks?.[0]?.melody?.bars[0]?.length).toBe(2);
    const client=await peer(authority.id,70);
    await expect.poll(()=>client.evaluate(()=>app.getTracks()[0].melody?.bars[0]?.length)).toBe(2);
    for(const page of [host,client]){
      expect(await page.evaluate(()=>({capable:room.supportsRoomCapability('melody-v1'),join:outbound.find(m=>m.type==='join').capabilities.includes('melody-v1')}))).toEqual({capable:true,join:true});
      await page.evaluate(()=>{room.enablePlayback();room.setRehearsalReadiness(true,'Native melody');});
    }
    expect(await client.evaluate(()=>room.broadcastScheduledPlay())).toBe(false);
    expect(await host.evaluate(()=>({sent:room.broadcastScheduledPlay(),playing:app.isPlaying(),sources:notes.length}))).toEqual({sent:true,playing:false,sources:0});
    for(const page of [host,client]){
      await expect.poll(()=>page.evaluate(()=>notes.some(n=>n.frequencies[0][0]===523.2511306011972&&!n.stops.some(t=>t<n.time)))).toBe(true);
      const evidence=await page.evaluate(()=>({voices:notes.filter(n=>!n.stops.some(t=>t<n.time)),errors,transport:inbound.find(m=>m.type==='transport'&&m.playing),revision:room.getSyncDiagnostics().transportRevision}));
      expect(evidence.voices.some(n=>n.frequencies[0][0]===523.2511306011972)).toBe(true);
      expect(evidence.errors).toEqual([]);expect(evidence.transport).toBeTruthy();expect(evidence.revision).toBe(evidence.transport.revision);
      expect(evidence.voices.slice(0,2).map(n=>n.frequencies[0][0])).toEqual([440,523.2511306011972]);
      expect(evidence.voices[1].time-evidence.voices[0].time).toBeCloseTo(.25,5);
    }
    const effectiveAt=Date.now()+850;
    expect(await host.evaluate(effectiveAt=>{
      const tracks=app.getMusicalSnapshot().Tracks;tracks[0].mainBeatSound={sound:'Synth Square',settings:{}};tracks[0].melody.bars=[[n('replacement',0,81,3000)]];
      return room.sendSongChangeCommand({version:1,song:{version:2,enabled:true,name:'Authoritative native seam',sections:[{name:'New',startBar:0,tempo:120,repeats:1,tracks}]},sectionIndex:0,startBar:0,effectiveAt});
    },effectiveAt)).toBe(true);
    for(const page of [host,client]){
      await expect.poll(()=>page.evaluate(()=>transport.getPendingSongChange()?.effectiveAt)).toBe(effectiveAt);
      await page.evaluate(()=>{window.seam=transport.getPendingSongChange().audioTime+transport.getLocalOutputOffsetSeconds();});
    }
    await expect.poll(()=>authority.pendingSongChange?.effectiveAt).toBe(effectiveAt);
    for(const page of [host,client]){
      await expect.poll(()=>page.evaluate(()=>notes.some(n=>n.frequencies[0][0]===880))).toBe(true);
      const evidence=await page.evaluate(()=>({voices:notes.filter(n=>!n.stops.some(t=>t<n.time)),seam,errors}));expect(evidence.errors).toEqual([]);
      const held=evidence.voices.find(n=>n.frequencies[0][0]===440&&n.time<evidence.seam);
      expect(held?.stops.some(t=>Math.abs(t-evidence.seam)<.00001)).toBe(true);
      const fresh=evidence.voices.find(n=>n.frequencies[0][0]===880);expect(fresh.type).toBe('square');expect(fresh.time).toBeCloseTo(evidence.seam,5);
      expect(evidence.voices.filter(n=>n.frequencies[0][0]!==880&&n.time>=evidence.seam)).toEqual([]);
    }
    expect(await host.evaluate(()=>room.broadcastStop())).toBe(true);
    for(const page of [host,client]){
      await expect.poll(()=>page.evaluate(()=>app.isPlaying())).toBe(false);
      expect(await page.evaluate(()=>{const now=app.getAudioContext().currentTime;return notes.find(n=>n.frequencies[0][0]===880).stops.some(t=>t<=now+.01);})).toBe(true);
    }
    expect(authority.transport.playing).toBe(false);
    for(const p of peers)expect(p.pageErrors).toEqual([]);
  }finally{
    for(const p of peers){if(p.page)await p.page.evaluate(()=>{window.engine?.cancelPlayback();window.room?.disconnect();});await p.context.close();}
    await signal.close();
  }
});

test('real worker schedules off-grid native pitches once, not rhythm, with correction applied once', async ({page}) => {
  await ready(page);
  const anchor = await page.evaluate(async () => {
    configure([{beats:4,subdivision:1,rests:[]}], [[n('a',120,69),n('b',480,81),n('c',1440,72)]]);
    transport.setLocalOutputOffsetMs(80);
    await engine.scheduleStart(Date.now()+300);
    return app.getTracks()[0].nextBeatTime;
  });
  await expect.poll(() => page.evaluate(() => notes.length)).toBeGreaterThanOrEqual(3);
  const result = await page.evaluate(() => ({notes:notes.slice(0,3),errors}));
  expect(result.errors).toEqual([]);
  expect(result.notes.map(n => n.frequencies[0][0])).toEqual([440,880,523.2511306011972]);
  for (const [i, tick] of [120,480,1440].entries()) expect(result.notes[i].time).toBeCloseTo(anchor + .08 + tick / 960 * .5, 5);
});
