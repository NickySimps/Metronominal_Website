const { test, expect } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const { createSyncServer } = require('../../MetronomeSignalServer/server');
let signal, web, origin, endpoint;
test.beforeAll(async () => {
  signal = createSyncServer({port:0,logger:{log(){},warn(){}}});
  await new Promise(r=>signal.wss.once('listening',r)); endpoint=`ws://127.0.0.1:${signal.wss.address().port}`;
  const root=path.resolve(__dirname,'..');
  web=http.createServer((req,res)=>{let file=path.join(root,new URL(req.url,'http://localhost').pathname);if(fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html');fs.readFile(file,(e,b)=>{res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':'application/octet-stream');res.statusCode=e?404:200;res.end(e?'':b);});});
  await new Promise(r=>web.listen(0,'127.0.0.1',r));origin=`http://127.0.0.1:${web.address().port}`;
});
test.afterAll(async()=>{await signal?.close();await new Promise(r=>web.close(r));});
async function peer(browser){
  const context=await browser.newContext({serviceWorkers:'block'});
  await context.addInitScript(url=>{
    const W=WebSocket;window.WebSocket=class extends W{constructor(u,...a){super(u==='ws://127.0.0.1:10000'?url:u,...a);window.__wire=this;}};
    window.__starts=[];
    for(const method of ['createBufferSource','createOscillator']){
      const create=AudioContext.prototype[method];AudioContext.prototype[method]=function(...a){const s=create.apply(this,a),start=s.start.bind(s);s.start=(...a)=>{window.__starts.push({after:!!window.__boundary});return start(...a);};return s;};
    }
  },endpoint);
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));return {context,page,errors};
}
async function join(p,url=origin){await p.goto(url);await expect.poll(()=>p.evaluate(async()=>(await import('./js/webrtc.js')).getRehearsalRoomState().joined)).toBe(true);const d=p.locator('#dismiss-connection-modal-btn');if(await d.isVisible())await d.click();await p.locator('#rehearsal-tools-panel > summary').click();await expect.poll(()=>p.evaluate(async()=>(await import('./js/appState.js')).default.getAudioContext()?.state)).toBe('running');}
async function hold(p){await p.evaluate(async()=>{
  const original=OfflineAudioContext.prototype.startRendering;window.__renders=[];
  OfflineAudioContext.prototype.startRendering=function(...a){const native=original.apply(this,a);return new Promise((resolve,reject)=>window.__renders.push(()=>native.then(resolve,reject)));};
  const a=(await import('./js/appState.js')).default,m=(await import('./js/monitoring.js')).default,ctx=a.getAudioContext();await ctx.resume();
  window.__tap=ctx.createAnalyser();window.__tap.fftSize=2048;m.getOutput(ctx).connect(window.__tap);
});}
async function reverse(h){await h.evaluate(async()=>{const a=(await import('./js/appState.js')).default;for(const t of a.getTracks())for(const key of ['mainBeatSound','subdivisionSound'])t[key]={sound:'Synth Kick',settings:{reverse:true,attack:0.01,decay:0.5,release:2}};await(await import('./js/webrtc.js')).sendState(a.getCurrentStateForPreset(true));});}
async function releaseAndMeasure(p){return p.evaluate(async()=>{
  window.__boundary=true;for(const r of window.__renders)r();let peak=0;
  for(let i=0;i<40;i++){const d=new Float32Array(window.__tap.fftSize);window.__tap.getFloatTimeDomainData(d);for(const v of d)peak=Math.max(peak,Math.abs(v));await new Promise(r=>setTimeout(r,30));}
  return {lateStarts:window.__starts.filter(s=>s.after).length,peak};
});}
test('manual Stop rejects a held real native reverse render',async({browser})=>{
  const h=await peer(browser);try{await join(h.page);await hold(h.page);await reverse(h.page);
    await h.page.locator('#start-stop-btn').click();await expect.poll(()=>h.page.evaluate(()=>window.__renders.length)).toBeGreaterThan(0);
    await h.page.evaluate(async()=>{await(await import('./js/metronomeEngine.js')).default.togglePlay(true);});
    const evidence=await releaseAndMeasure(h.page);console.log('native manual Stop',evidence);expect(evidence.lateStarts).toBe(0);expect(evidence.peak).toBeLessThan(0.001);expect(h.errors).toEqual([]);
  }finally{await h.context.close();}
});
for(const boundary of ['room-close','replacement','overflow'])test(`held native reverse render cancelled at authentic ${boundary}`,async({browser})=>{
 const h=await peer(browser),c=await peer(browser);let replacement;
 try{await join(h.page);await join(c.page,h.page.url());const target=boundary==='room-close'?c.page:h.page;await hold(target);await reverse(h.page);
 await expect.poll(()=>c.page.evaluate(async()=>(await import('./js/appState.js')).default.getTracks()[0].mainBeatSound.settings.reverse)).toBe(true);
 await h.page.locator('#start-stop-btn').click();await expect.poll(()=>target.evaluate(()=>window.__renders.length)).toBeGreaterThan(0);
 await target.evaluate(async()=>{const a=(await import('./js/appState.js')).default,original=a.getCurrentStateForPreset.bind(a);let first=true;a.getCurrentStateForPreset=(...args)=>first?(first=false,new Promise(resolve=>window.__releaseRefresh=()=>original(...args).then(resolve))):original(...args);window.__wire.send(JSON.stringify({type:'state-request'}));});
 await expect.poll(()=>target.evaluate(()=>typeof window.__releaseRefresh)).toBe('function');
 if(boundary==='room-close')await h.page.evaluate(()=>window.__wire.send(JSON.stringify({type:'close-room'})));
 if(boundary==='replacement'){const W=require('../../MetronomeSignalServer/node_modules/ws');replacement=new W(endpoint);await new Promise(r=>replacement.once('open',r));const data=await h.page.evaluate(()=>({room:new URL(location.href).searchParams.get('room'),hostCredential:sessionStorage.getItem('host_credential')}));replacement.send(JSON.stringify({type:'join',...data,requestedRole:'host',capabilities:['rehearsal-v1']}));}
 if(boundary==='overflow')await h.page.evaluate(()=>{for(let i=0;i<140;i++)window.__wire.send(JSON.stringify({type:'state-request'}));});
 await expect.poll(()=>target.evaluate(async()=>(await import('./js/webrtc.js')).getRehearsalRoomState().joined)).toBe(false);
 const evidence=await releaseAndMeasure(target);console.log(`native ${boundary}`,evidence);expect(evidence.lateStarts).toBe(0);expect(evidence.peak).toBeLessThan(0.001);
 await target.evaluate(()=>window.__releaseRefresh());expect(h.errors).toEqual([]);expect(c.errors).toEqual([]);
 }finally{replacement?.close();await h.context.close();await c.context.close();}
});

// 0.001 linear amplitude is -60 dBFS. Observe 1.2s at the real Monitoring
// output, well beyond its 2048-frame analyser history (about 46ms at 44.1kHz).
async function peakOutput(p, milliseconds=700){return p.evaluate(async ms=>{let peak=0;const end=performance.now()+ms;while(performance.now()<end){const d=new Float32Array(window.__tap.fftSize);window.__tap.getFloatTimeDomainData(d);for(const v of d)peak=Math.max(peak,Math.abs(v));await new Promise(r=>setTimeout(r,15));}return peak;},milliseconds);}
test('rapid Stop-newPlay rejects old render but a fresh reverse trimmed FX voice is audible',async({browser})=>{
 const h=await peer(browser);try{await join(h.page);await hold(h.page);await reverse(h.page);
 await h.page.locator('#start-stop-btn').click();await expect.poll(()=>h.page.evaluate(()=>window.__renders.length)).toBeGreaterThan(0);
 await h.page.evaluate(async()=>{const a=(await import('./js/appState.js')).default,e=(await import('./js/metronomeEngine.js')).default;await e.togglePlay(true);for(const t of a.getTracks())for(const key of ['mainBeatSound','subdivisionSound'])t[key]={sound:'Synth Kick',settings:{reverse:true,trimStart:0.01,trimEnd:0.5,attack:0.02,decay:0.31,release:0.4,delayMix:0.5,delayTime:0.15,reverbMix:0.3}};await e.scheduleStart(Date.now()+100);window.__boundary=true;const old=window.__renders.splice(0);for(const release of old)release();});
 await expect.poll(()=>h.page.evaluate(()=>window.__renders.length)).toBeGreaterThan(0);
 expect(await h.page.evaluate(()=>window.__starts.filter(s=>s.after).length)).toBe(0);
 await h.page.evaluate(()=>{window.__boundary=false;for(const r of window.__renders.splice(0))r();});
 const peak=await peakOutput(h.page);console.log('fresh reverse trim FX peak',peak);expect(peak).toBeGreaterThan(0.01);
 await h.page.evaluate(async()=>{(await import('./js/metronomeEngine.js')).default.cancelPlayback();});await h.page.waitForTimeout(100);
 expect(await peakOutput(h.page)).toBeLessThan(0.001);expect(h.errors).toEqual([]);
 }finally{await h.context.close();}
});
for(const sound of ['Synth Snare','lifecycle sample'])test(`live ${sound} and FX tails cancel without changing device mix or auditions`,async({browser})=>{
 const h=await peer(browser);try{await join(h.page);await hold(h.page);
 const before=await h.page.evaluate(async sound=>{const a=(await import('./js/appState.js')).default,e=(await import('./js/metronomeEngine.js')).default,ctx=a.getAudioContext();
 const b=ctx.createBuffer(1,ctx.sampleRate,ctx.sampleRate),d=b.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=0.4*Math.sin(i*2*Math.PI*220/ctx.sampleRate);a.setSoundBuffer('lifecycle sample',b);
 for(const t of a.getTracks())for(const key of ['mainBeatSound','subdivisionSound'])t[key]={sound,settings:{attack:0.01,decay:0.2,release:2,delayMix:1,delayTime:0.2,delayFeedback:0.8,reverbMix:1}};
 const m=(await import('./js/monitoring.js')).default;m.setVolume(0.73);m.setTrackVolume(0,0.61);await e.scheduleStart(Date.now()+100);return {volume:a.getVolume(),state:ctx.state,mix:m.getState(),saved:localStorage.getItem('metronominal.monitoring')};},sound);
 expect(await peakOutput(h.page)).toBeGreaterThan(0.01);
 await h.page.evaluate(async()=>{(await import('./js/metronomeEngine.js')).default.cancelPlayback();});await h.page.waitForTimeout(100);
 expect(await peakOutput(h.page)).toBeLessThan(0.001);
 const after=await h.page.evaluate(async()=>{const a=(await import('./js/appState.js')).default;return{volume:a.getVolume(),state:a.getAudioContext().state,mix:(await import('./js/monitoring.js')).default.getState(),saved:localStorage.getItem('metronominal.monitoring')};});expect(after).toEqual(before);
 await h.page.evaluate(async()=>{const a=(await import('./js/appState.js')).default;(await import('./js/audioController.js')).default.playRecording('lifecycle sample',{},0,0.5,a.getAudioContext().currentTime,0.5);});
 expect(await peakOutput(h.page,300)).toBeGreaterThan(0.01);expect(h.errors).toEqual([]);
 }finally{await h.context.close();}
});
test('future count-in is cancelled even when playback is already false',async({browser})=>{
 const h=await peer(browser);try{await join(h.page);await hold(h.page);
 await h.page.evaluate(async()=>{const e=(await import('./js/metronomeEngine.js')).default;await e.scheduleCountIn({startsAt:Date.now()+250,totalBeats:4,beatIntervalMs:200,accentEvery:4});e.cancelPlayback();});
 expect(await peakOutput(h.page,1200)).toBeLessThan(0.001);expect(h.errors).toEqual([]);
 }finally{await h.context.close();}
});

test('same-task offline Stop-newPlay cannot let old Stop cancel the new generation',async({browser})=>{
 const h=await peer(browser);try{await join(h.page);await hold(h.page);await h.page.evaluate(async()=>{
 const a=(await import('./js/appState.js')).default,e=(await import('./js/metronomeEngine.js')).default;(await import('./js/webrtc.js')).disconnect();
 for(const t of a.getTracks())for(const key of ['mainBeatSound','subdivisionSound'])t[key]={sound:'Synth Sine',settings:{attack:0.01,decay:0.2,release:1}};
 await e.togglePlay();const stop=e.togglePlay(),play=e.togglePlay();await Promise.all([stop,play]);
 });expect(await peakOutput(h.page)).toBeGreaterThan(0.01);expect(h.errors).toEqual([]);
 }finally{await h.context.close();}
});

for(const action of ['scheduleCountIn','scheduleStart'])test(`cancel invalidates ${action} held at native context resume`,async({browser})=>{
 const h=await peer(browser);try{await join(h.page);await hold(h.page);
 await h.page.evaluate(async action=>{const a=(await import('./js/appState.js')).default,e=(await import('./js/metronomeEngine.js')).default,ctx=a.getAudioContext();await ctx.suspend();const resume=ctx.resume.bind(ctx);ctx.resume=()=>{const native=resume();return new Promise(resolve=>window.__releaseResume=()=>native.then(resolve));};
 window.__pending=action==='scheduleCountIn'?e.scheduleCountIn({startsAt:Date.now()+400,totalBeats:4,beatIntervalMs:200,accentEvery:4}):e.scheduleStart(Date.now()+400);
 e.cancelPlayback();window.__boundary=true;window.__releaseResume();await window.__pending;ctx.resume=resume;
 },action);
 expect(await h.page.evaluate(()=>window.__starts.filter(s=>s.after).length)).toBe(0);expect(await peakOutput(h.page,1100)).toBeLessThan(0.001);expect(h.errors).toEqual([]);
 }finally{await h.context.close();}
});

test('cancel releases sample retrigger ownership before the next generation',async({browser})=>{
 const h=await peer(browser);try{await join(h.page);await hold(h.page);
 const result=await h.page.evaluate(async()=>{const a=(await import('./js/appState.js')).default,c=(await import('./js/audioController.js')).default,L=(await import('./js/audioPlaybackLifetime.js')).default,ctx=a.getAudioContext();
 const b=ctx.createBuffer(1,ctx.sampleRate,ctx.sampleRate),tone=b.getChannelData(0);for(let i=0;i<tone.length;i++)tone[i]=0.2*Math.sin(i*2*Math.PI*440/ctx.sampleRate);a.setSoundBuffer('sample lifecycle ownership',b);
 const first=new L(),second=new L(),settings={voiceKey:'lifecycle-test',retrigger:false};c.playRecording('sample lifecycle ownership',settings,0,0.4,ctx.currentTime,0.3,null,first);first.cancel();
 // A sustained generated tone survives the real high-pass filter. DC only
 // creates a brief transient and is not a reliable audible-voice fixture.
 const before=window.__starts.length;c.playRecording('sample lifecycle ownership',settings,0,0.8,ctx.currentTime+0.1,0.3,null,second);return window.__starts.length-before;
 });expect(result).toBe(1);expect(await peakOutput(h.page,500)).toBeGreaterThan(0.01);expect(h.errors).toEqual([]);
 }finally{await h.context.close();}
});

test('AppState reset cannot orphan a pending engine render when playing is already false',async({browser})=>{
 const h=await peer(browser);try{await join(h.page);await hold(h.page);await reverse(h.page);await h.page.locator('#start-stop-btn').click();await expect.poll(()=>h.page.evaluate(()=>window.__renders.length)).toBeGreaterThan(0);
 await h.page.evaluate(async()=>{(await import('./js/appState.js')).default.resetPlaybackState();});const evidence=await releaseAndMeasure(h.page);expect(evidence.lateStarts).toBe(0);expect(evidence.peak).toBeLessThan(0.001);expect(h.errors).toEqual([]);
 }finally{await h.context.close();}
});
