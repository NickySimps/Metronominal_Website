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
let signal,web;
test.beforeAll(async()=>{signal=createSyncServer({port:10036,logger:{log(){},warn(){}}});await new Promise(r=>signal.wss.once('listening',r));const root=path.resolve(__dirname,'..');web=http.createServer((q,s)=>{let f=path.join(root,new URL(q.url,'http://x').pathname);if(fs.existsSync(f)&&fs.statSync(f).isDirectory())f=path.join(f,'index.html');fs.readFile(f,(e,b)=>{s.setHeader('Content-Type',f.endsWith('.js')?'text/javascript':f.endsWith('.html')?'text/html':f.endsWith('.css')?'text/css':'application/octet-stream');s.statusCode=e?404:200;s.end(e?'':b);});});await new Promise(r=>web.listen(4236,'127.0.0.1',r));});
test.afterAll(async()=>{await signal?.close();await new Promise(r=>web.close(r));});
async function open(browser){const context=await browser.newContext({serviceWorkers:'block'});await context.addInitScript(()=>{const W=WebSocket;window.WebSocket=class extends W{constructor(u,...a){super(u==='ws://127.0.0.1:10000'?'ws://127.0.0.1:10036':u,...a);}};window.__starts=[];for(const method of ['createOscillator','createBufferSource']){const prototype=globalThis.AudioContext?.prototype;if(typeof prototype?.[method]!=='function')continue;const create=prototype[method];prototype[method]=function(...args){const source=create.apply(this,args),start=source.start.bind(source);source.start=(time,...rest)=>{window.__starts.push({time,now:this.currentTime,frames:source.buffer?.length??null});return start(time,...rest);};return source;};}});const page=await context.newPage(),errors=[];await prepareWorkflowTestPage(page);page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:4236');await expect.poll(()=>page.evaluate(async()=>(await import('./js/webrtc.js')).isSynchronizationJoined())).toBe(true);const d=page.locator('#dismiss-connection-modal-btn');if(await d.isVisible())await d.click();await page.locator('#speed-trainer-btn').click();await page.evaluate(async()=>{const ctx=(await import('./js/appState.js')).default.getAudioContext();if(ctx)await ctx.resume();});return{context,page,errors};}
test('stopped correction validation persistence privacy and UI do not require native audio',async({browser})=>{
 const p=await open(browser);
 try{
  const r=await p.page.evaluate(async()=>{
   const a=(await import('./js/appState.js')).default,m=await import('./js/practiceTransport.js');
   const before=a.getMusicalSnapshot(),invalid=[];
   for(const value of [NaN,Infinity,-201,501,'15']){try{m.setLocalOutputOffsetMs(value);invalid.push(false);}catch{invalid.push(true);}}
   m.setLocalOutputOffsetMs(-200);const low=m.getLocalTimingState().outputOffsetMs;
   m.setLocalOutputOffsetMs(500);const high=m.getLocalTimingState().outputOffsetMs;
   const section=document.createElement('section');document.body.append(section);m.initializePracticeTools(section);
   const input=section.querySelector('[data-output-offset]');input.value='15';input.dispatchEvent(new Event('change',{bubbles:true}));
   return{invalid,low,high,offset:m.getLocalTimingState().outputOffsetMs,stored:localStorage.getItem('metronominal.outputCorrectionMs'),before,after:a.getMusicalSnapshot(),wire:await a.getCurrentStateForPreset(true),status:section.querySelector('output').textContent};
  });
  expect(r.invalid).toEqual([true,true,true,true,true]);expect(r.low).toBe(-200);expect(r.high).toBe(500);expect(r.offset).toBe(15);expect(r.stored).toBe('15');expect(r.after).toEqual(r.before);
  expect(r.wire).not.toHaveProperty('outputOffsetMs');expect(r.wire).not.toHaveProperty('audioLatencyOffset');expect(r.status).toContain('no acoustic measurement');expect(p.errors).toEqual([]);
 }finally{await p.context.close();}
});
test('correction is local, bounded, stopped-only and native sources have real negative-offset headroom',async({browser})=>{await requireNativeAudio(browser,"correction is local, bounded, stopped-only and native sources have real negative-offset headroom");const p=await open(browser);try{const evidence=await p.page.evaluate(async()=>{const a=(await import('./js/appState.js')).default,m=await import('./js/practiceTransport.js'),e=(await import('./js/metronomeEngine.js')).default;await(await import('./js/webrtc.js')).disconnect();m.setLocalOutputOffsetMs(-200);let invalid=false;try{m.setLocalOutputOffsetMs(NaN);}catch{invalid=true;}window.__starts=[];await e.scheduleStart(Date.now()+60);await new Promise(r=>setTimeout(r,700));let stoppedOnly=false;try{m.setLocalOutputOffsetMs(30);}catch{stoppedOnly=true;}return{invalid,stoppedOnly,starts:window.__starts,serialized:await a.getCurrentStateForPreset(),snapshot:a.getMusicalSnapshot(),offset:m.getLocalTimingState().outputOffsetMs};});expect(evidence.invalid).toBe(true);expect(evidence.stoppedOnly).toBe(true);expect(evidence.offset).toBe(-200);expect(evidence.starts.length).toBeGreaterThan(0);expect(evidence.starts.every(s=>s.time-s.now>0.005)).toBe(true);expect(evidence.serialized.audioLatencyOffset).toBeUndefined();expect(evidence.serialized.outputOffsetMs).toBeUndefined();expect(evidence.snapshot.outputOffsetMs).toBeUndefined();expect(p.errors).toEqual([]);}finally{await p.context.close();}});
test('negative 200 ms correction advances actual native starts relative to the unshifted musical grid',async({browser})=>{await requireNativeAudio(browser,"negative 200 ms correction advances actual native starts relative to the unshifted musical grid");
 const p=await open(browser);
 try{
  const r=await p.page.evaluate(async()=>{
   const a=(await import('./js/appState.js')).default,m=await import('./js/practiceTransport.js'),engine=(await import('./js/metronomeEngine.js')).default;
   await(await import('./js/webrtc.js')).disconnect();m.setLocalOutputOffsetMs(-200);window.__starts=[];
   await engine.scheduleStart(Date.now()+500);const nominal=a.getTracks()[0].nextBeatTime;
   const end=performance.now()+2000;while(!window.__starts.length&&performance.now()<end)await new Promise(r=>setTimeout(r,10));
   const starts=[...window.__starts];engine.cancelPlayback();return{nominal,starts};
  });
  expect(r.starts.length).toBeGreaterThan(0);expect(r.nominal-r.starts[0].time).toBeCloseTo(0.2,5);expect(r.starts[0].time-r.starts[0].now).toBeGreaterThan(0.005);expect(p.errors).toEqual([]);
 }finally{await p.context.close();}
});
test('click flash exercise records native audio timestamps and honest presentation estimates',async({browser})=>{await requireNativeAudio(browser,"click flash exercise records native audio timestamps and honest presentation estimates");const p=await open(browser);try{await p.page.evaluate(async()=>{const m=await import('./js/practiceTransport.js');const root=document.createElement('section');root.id='calibration-test';document.body.append(root);m.initializePracticeTools(root);window.__frames=[];document.addEventListener('calibrationframe',e=>window.__frames.push(e.detail));window.__starts=[];await m.startCalibration(root);});await expect.poll(()=>p.page.evaluate(()=>window.__frames.length),{timeout:6000}).toBe(4);const evidence=await p.page.evaluate(async()=>({frames:window.__frames,starts:window.__starts,state:(await import('./js/practiceTransport.js')).getLocalTimingState()}));expect(evidence.starts.length).toBe(4);for(const frame of evidence.frames){expect(evidence.starts.some(s=>Math.abs(s.time-frame.audioTime)<0.00001)).toBe(true);expect(frame.presentationEstimate).toBe(true);expect(Number.isFinite(frame.presentedAt)).toBe(true);}expect(evidence.state.measurement).toContain('no acoustic measurement');expect(p.errors).toEqual([]);}finally{await p.context.close();}});


test('output sink changes invalidate alignment and cancel pending calibration sources',async({browser})=>{await requireNativeAudio(browser,"output sink changes invalidate alignment and cancel pending calibration sources");const p=await open(browser);try{const r=await p.page.evaluate(async()=>{const m=await import('./js/practiceTransport.js'),a=(await import('./js/appState.js')).default;const root=document.createElement('section');document.body.append(root);m.initializePracticeTools(root);await m.startCalibration(root);a.getAudioContext().dispatchEvent(new Event('sinkchange'));return m.getLocalTimingState();});expect(r.recheckReason).toMatch(/route changed/i);expect(r.measurement).toContain('no acoustic measurement');expect(p.errors).toEqual([]);}finally{await p.context.close();}});
test('held native reverse render gets minimum lead rather than starting in the past',async({browser})=>{await requireNativeAudio(browser,"held native reverse render gets minimum lead rather than starting in the past");const p=await open(browser);try{const r=await p.page.evaluate(async()=>{const a=(await import('./js/appState.js')).default,e=(await import('./js/metronomeEngine.js')).default;await(await import('./js/webrtc.js')).disconnect();const native=OfflineAudioContext.prototype.startRendering;window.__release=[];OfflineAudioContext.prototype.startRendering=function(...args){const rendered=native.apply(this,args);return new Promise((resolve,reject)=>window.__release.push(()=>rendered.then(resolve,reject)));};for(const key of ['mainBeatSound','subdivisionSound'])a.getTracks()[0][key]={sound:'Synth Sine',settings:{reverse:true,attack:0.01,decay:0.1,release:0.2}};window.__starts=[];await e.scheduleStart(Date.now()+150);while(!window.__release.length)await new Promise(r=>setTimeout(r,10));await new Promise(r=>setTimeout(r,350));for(const release of window.__release)release();const end=performance.now()+2000;while(!window.__starts.some(s=>s.frames>1)&&performance.now()<end)await new Promise(r=>setTimeout(r,10));return window.__starts.filter(s=>s.frames>1);});expect(r.length).toBeGreaterThan(0);expect(r.every(s=>s.time-s.now>=0.005)).toBe(true);expect(p.errors).toEqual([]);}finally{await p.context.close();}});

