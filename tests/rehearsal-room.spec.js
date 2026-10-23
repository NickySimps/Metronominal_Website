const { test, expect } = require('@playwright/test');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { createSyncServer } = require('../../MetronomeSignalServer/server');
let signal, web, origin, signalURL;
test.beforeAll(async () => {
  signal = createSyncServer({ port: 0, logger: {log() {},warn() {}} });
  await new Promise(r=>signal.wss.once('listening',r));
  signalURL = `ws://127.0.0.1:${signal.wss.address().port}`;
  const root=path.resolve(__dirname,'..');
  web=http.createServer((req,res)=> {
    const file=path.resolve(root, `.${decodeURIComponent(new URL(req.url,'http://localhost').pathname)}`);
    if(!file.startsWith(root+path.sep) && file!==root) {res.writeHead(403);res.end();return;}
    const target=fs.existsSync(file)&&fs.statSync(file).isDirectory()?path.join(file,'index.html'):file;
    fs.readFile(target,(err,data)=>{if(err){res.writeHead(404);res.end();return;}
      res.setHeader('Content-Type', target.endsWith('.js')?'text/javascript':target.endsWith('.css')?'text/css':target.endsWith('.html')?'text/html':'application/octet-stream');res.end(data);});
  });
  await new Promise(r=>web.listen(0,'127.0.0.1',r)); origin=`http://127.0.0.1:${web.address().port}`;
});
test.afterAll(async()=>{await signal?.close();await new Promise(r=>web?.close(r));});
async function setup(browser) {
  const context=await browser.newContext({ serviceWorkers:'block' });
  await context.addInitScript(url=>{
    const Native=window.WebSocket;
    window.WebSocket=class extends Native { constructor(endpoint,...args){super(endpoint==='ws://127.0.0.1:10000'?url:endpoint,...args);window.__wire=this;} };
  },signalURL);
  const page=await context.newPage(); const errors=[];page.on('pageerror',e=>errors.push(e.message));
  return {context,page,errors};
}
async function room(page) {return page.evaluate(async()=>{const m=await import('./js/webrtc.js');return m.getRehearsalRoomState?.()||null;});}
async function mount(page) {
  await expect.poll(async()=>(await room(page))?.joined).toBe(true);
  const dismiss=page.locator('#dismiss-connection-modal-btn');
  if(await dismiss.isVisible()) await dismiss.click();
  await page.evaluate(async()=> {
    let root=document.getElementById('rehearsal-room-root');
    if(!root){root=document.createElement('section');root.id='rehearsal-room-root';document.body.append(root);}
    const details=root.closest('details'); if(details)details.open=true;
    const m=await import('./js/rehearsalRoomController.js');m.initializeRehearsalRoomControls(root);
  });
}
test('new clients fall back to a pre-scope server without claiming rehearsal handoff',async({browser})=>{
  const cp=require('child_process'),Module=require('module');
  const source=cp.execFileSync('git',['show','0f82d4d:server.js'],{cwd:path.resolve(__dirname,'../../MetronomeSignalServer'),encoding:'utf8'});
  const legacyModule=new Module(path.resolve(__dirname,'../../MetronomeSignalServer/legacy-test.js'),module);
  legacyModule.filename=legacyModule.id;legacyModule.paths=Module._nodeModulePaths(path.dirname(legacyModule.filename));legacyModule._compile(source,legacyModule.filename);
  const legacy=legacyModule.exports.createSyncServer({port:0,logger:{log(){},warn(){}}});
  await new Promise(r=>legacy.wss.once('listening',r));
  const currentURL=signalURL;signalURL=`ws://127.0.0.1:${legacy.wss.address().port}`;
  const h=await setup(browser),c=await setup(browser);signalURL=currentURL;
  try{
    await h.page.goto(origin);await mount(h.page);await c.page.goto(h.page.url());await mount(c.page);
    expect(new URL(h.page.url()).searchParams.get('room')).not.toMatch(/^v2_/);
    expect((await room(h.page)).supported).toBe(false);
    await h.page.evaluate(async()=>{const a=(await import('./js/appState.js')).default;a.setTempo(159);await(await import('./js/webrtc.js')).sendState(a.getCurrentStateForPreset(true));});
    await expect.poll(()=>c.page.evaluate(async()=>(await import('./js/appState.js')).default.getTempo())).toBe(159);
    expect(h.errors).toEqual([]);expect(c.errors).toEqual([]);
  }finally{await h.context.close();await c.context.close();await legacy.close();}
});
test('restart expires saved v2 host and client without automatic authority resurrection',async({browser})=>{
  const h=await setup(browser),c=await setup(browser);
  try{
    await h.page.goto(origin);await mount(h.page);await c.page.goto(h.page.url());await mount(c.page);
    const oldURL=h.page.url();await signal.close();
    signal=createSyncServer({port:0,logger:{log(){},warn(){}}});await new Promise(r=>signal.wss.once('listening',r));
    const nextURL=`ws://127.0.0.1:${signal.wss.address().port}`;
    // Replace only the test transport override on the next navigation.
    for(const peer of [h,c])await peer.context.addInitScript(url=>{
      const Previous=window.WebSocket;
      window.WebSocket=class extends Previous{constructor(endpoint,...args){super(endpoint.startsWith('ws://127.0.0.1:')?url:endpoint,...args);window.__wire=this;}};
    },nextURL);
    signalURL=nextURL;
    await h.page.goto(oldURL);await c.page.goto(oldURL);
    for(const peer of [h,c]){
      await expect.poll(async()=>(await room(peer.page))?.recoveryMessage).toMatch(/expired.*new.*link/i);
      expect((await room(peer.page)).joined).toBe(false);expect((await room(peer.page)).isHost).toBe(false);
      expect(peer.errors).toEqual([]);
    }
    expect(signal.rooms.size).toBe(0);
  }finally{await h.context.close();await c.context.close();}
});
test('new rooms negotiate scoped identity before admission',async({browser})=>{
  const h=await setup(browser);try{await h.page.goto(origin);await mount(h.page);
    expect(new URL(h.page.url()).searchParams.get('room')).toMatch(/^v2_[a-f0-9]{32}_/);
    expect(h.errors).toEqual([]);
  }finally{await h.context.close();}
});
test('two queued authoritative refreshes cannot survive immediate host replacement',async({browser})=>{
  const h=await setup(browser);let replacement;
  try{
    await h.page.goto(origin);await mount(h.page);
    await h.page.evaluate(async()=>{
      const a=(await import('./js/appState.js')).default,m=await import('./js/webrtc.js');
      a.setTempo(177);await m.sendState(a.getCurrentStateForPreset(true));
    });
    const id=new URL(h.page.url()).searchParams.get('room');
    await expect.poll(()=>signal.rooms.get(id)?.state?.payload.tempo).toBe(177);
    await h.page.evaluate(async()=>{
      const a=(await import('./js/appState.js')).default,original=a.getCurrentStateForPreset.bind(a);
      let calls=0;
      a.getCurrentStateForPreset=(...args)=>{
        if(++calls===1)return new Promise(resolve=>{window.__releaseRefresh=()=>original(...args).then(resolve);});
        return original(...args);
      };
      window.__wire.addEventListener('message',e=>{
        if(JSON.parse(e.data).type==='host-replaced'){
          window.__inactiveAtReceipt=!(window.isHost) && !(window.__joinedSnapshot());
          a.setTempo(222);window.__releaseRefresh();window.__revocationSeen=true;
        }
      });
      const m=await import('./js/webrtc.js');window.__joinedSnapshot=()=>m.getRehearsalRoomState().joined;
      window.__wire.send(JSON.stringify({type:'state-request'}));
      window.__wire.send(JSON.stringify({type:'state-request'}));
    });
    await expect.poll(()=>h.page.evaluate(()=>typeof window.__releaseRefresh)).toBe('function');
    const WS=require('../../MetronomeSignalServer/node_modules/ws');
    replacement=new WS(signalURL);await new Promise(r=>replacement.once('open',r));
    const credential=await h.page.evaluate(()=>sessionStorage.getItem('host_credential'));
    replacement.send(JSON.stringify({type:'join',room:id,requestedRole:'host',hostCredential:credential,capabilities:['rehearsal-v1']}));
    await expect.poll(()=>h.page.evaluate(()=>window.__revocationSeen)).toBe(true);
    await h.page.waitForTimeout(200);
    expect(await h.page.evaluate(async()=>(await import('./js/appState.js')).default.getTempo())).toBe(222);
    expect(await h.page.evaluate(()=>window.__inactiveAtReceipt)).toBe(true);
    expect(h.errors).toEqual([]);
  }finally{replacement?.close();await h.context.close();}
});
test('an overloaded held receive queue closes instead of accumulating unbounded authoritative work',async({browser})=>{
  const h=await setup(browser);
  try{
    await h.page.goto(origin);await mount(h.page);
    const id=new URL(h.page.url()).searchParams.get('room');
    await expect.poll(()=>Boolean(signal.rooms.get(id)?.state)).toBe(true);
    await h.page.evaluate(async()=>{
      const a=(await import('./js/appState.js')).default,original=a.getCurrentStateForPreset.bind(a);let first=true;
      window.__overflowSocket=window.__wire;
      a.getCurrentStateForPreset=(...args)=>{
        if(first){first=false;return new Promise(resolve=>{window.__releaseOverflow=()=>original(...args).then(resolve);});}
        return original(...args);
      };
      for(let i=0;i<140;i++)window.__wire.send(JSON.stringify({type:'state-request'}));
    });
    await expect.poll(()=>h.page.evaluate(()=>window.__overflowSocket.readyState)).toBe(3);
    expect((await room(h.page)).joined).toBe(false);
    await h.page.evaluate(async()=>{(await import('./js/appState.js')).default.setTempo(222);window.__releaseOverflow();});
    await h.page.waitForTimeout(100);
    expect(await h.page.evaluate(async()=>(await import('./js/appState.js')).default.getTempo())).toBe(222);
    expect(h.errors).toEqual([]);
  }finally{await h.context.close();}
});
test('post-handoff state remains applicable behind an older held refresh and roster transition',async({browser})=>{
  const h=await setup(browser),c=await setup(browser);
  try{
    await h.page.goto(origin);await mount(h.page);await c.page.goto(h.page.url());await mount(c.page);
    await h.page.evaluate(async()=>{
      const a=(await import('./js/appState.js')).default,original=a.getCurrentStateForPreset.bind(a);
      let first=true;
      a.getCurrentStateForPreset=(...args)=>{
        if(first){first=false;return new Promise(resolve=>{window.__releaseTransition=()=>original(...args).then(resolve);});}
        return original(...args);
      };
      window.__wire.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.type==='state'&&m.payload?.tempo===194)window.__newHostStateReceived=true;});
      window.__wire.send(JSON.stringify({type:'state-request'}));
    });
    await expect.poll(()=>h.page.evaluate(()=>typeof window.__releaseTransition)).toBe('function');
    const peerId=(await room(c.page)).ownPeerId;
    await c.page.evaluate(async()=>{(await import('./js/webrtc.js')).requestRehearsalControl();});
    const id=new URL(h.page.url()).searchParams.get('room');
    await expect.poll(()=>signal.rooms.get(id).controlRequests.has(peerId)).toBe(true);
    await h.page.evaluate(peerId=>window.__wire.send(JSON.stringify({type:'handoff-control',peerId})),peerId);
    await expect.poll(async()=>(await room(c.page)).isHost).toBe(true);
    await c.page.evaluate(async()=>{const a=(await import('./js/appState.js')).default;a.setTempo(194);await(await import('./js/webrtc.js')).sendState(a.getCurrentStateForPreset(true));});
    await expect.poll(()=>h.page.evaluate(()=>window.__newHostStateReceived)).toBe(true);
    await h.page.evaluate(()=>window.__releaseTransition());
    await expect.poll(()=>h.page.evaluate(async()=>(await import('./js/appState.js')).default.getTempo())).toBe(194);
    expect((await room(h.page)).joined).toBe(true);expect((await room(h.page)).isHost).toBe(false);
    expect(h.errors).toEqual([]);expect(c.errors).toEqual([]);
  }finally{await h.context.close();await c.context.close();}
});
test('receipt ordered repeated authentic handoffs never resurrect a queued revoked grant',async({browser})=>{
  const a=await setup(browser),b=await setup(browser);
  try{
    await a.page.goto(origin);await mount(a.page);await b.page.goto(a.page.url());await mount(b.page);
    const id=new URL(a.page.url()).searchParams.get('room');
    const aid=(await room(a.page)).ownPeerId,bid=(await room(b.page)).ownPeerId;
    await a.page.evaluate(async()=>{
      const s=(await import('./js/appState.js')).default,original=s.getCurrentStateForPreset.bind(s);let first=true;
      s.getCurrentStateForPreset=(...args)=>first?(first=false,new Promise(resolve=>{window.__releaseRepeated=()=>original(...args).then(resolve);})):original(...args);
      window.__transitions=[];window.__wire.addEventListener('message',e=>{const m=JSON.parse(e.data);if(['role-changed','host-granted'].includes(m.type))window.__transitions.push(m.type);});
      window.__wire.send(JSON.stringify({type:'state-request'}));
    });
    await expect.poll(()=>a.page.evaluate(()=>typeof window.__releaseRepeated)).toBe('function');
    const transfer=async(from,to,target)=>{
      await to.page.evaluate(()=>window.__wire.send(JSON.stringify({type:'control-request'})));
      await expect.poll(()=>signal.rooms.get(id).controlRequests.has(target)).toBe(true);
      await from.page.evaluate(peerId=>window.__wire.send(JSON.stringify({type:'handoff-control',peerId})),target);
      await expect.poll(()=>signal.rooms.get(id).host?.peerId).toBe(target);
    };
    await transfer(a,b,bid);await transfer(b,a,aid);await transfer(a,b,bid);
    await expect.poll(()=>a.page.evaluate(()=>window.__transitions.length)).toBe(3);
    await a.page.evaluate(()=>window.__releaseRepeated());await a.page.waitForTimeout(200);
    expect(await a.page.evaluate(async()=>({joined:(await import('./js/webrtc.js')).getRehearsalRoomState().joined,host:window.isHost,credential:!!sessionStorage.getItem('host_credential'),playing:(await import('./js/appState.js')).default.isPlaying()}))).toEqual({joined:true,host:false,credential:false,playing:false});
    expect((await room(b.page)).isHost).toBe(true);expect(a.errors).toEqual([]);expect(b.errors).toEqual([]);
  }finally{await a.context.close();await b.context.close();}
});
test('legitimate grant and its same-authority roster retain transport behind held refresh',async({browser})=>{
  const h=await setup(browser),c=await setup(browser);
  try{
    await h.page.goto(origin);await mount(h.page);await c.page.goto(h.page.url());await mount(c.page);
    await c.page.evaluate(async()=>{
      const a=(await import('./js/appState.js')).default,original=a.getCurrentStateForPreset.bind(a);let first=true;
      a.getCurrentStateForPreset=(...args)=>first?(first=false,new Promise(resolve=>{window.__releaseGrant=()=>original(...args).then(resolve);})):original(...args);
      window.__grantRoster=false;window.__wire.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.type==='rehearsal-room'&&m.hostPeerId===window.__ownPeer)window.__grantRoster=true;});
      window.__ownPeer=(await import('./js/webrtc.js')).getRehearsalRoomState().ownPeerId;
      window.__wire.send(JSON.stringify({type:'state-request'}));
    });
    await expect.poll(()=>c.page.evaluate(()=>typeof window.__releaseGrant)).toBe('function');
    const id=new URL(h.page.url()).searchParams.get('room'),peerId=(await room(c.page)).ownPeerId;
    await c.page.evaluate(()=>window.__wire.send(JSON.stringify({type:'control-request'})));
    await expect.poll(()=>signal.rooms.get(id).controlRequests.has(peerId)).toBe(true);
    await h.page.evaluate(peerId=>window.__wire.send(JSON.stringify({type:'handoff-control',peerId})),peerId);
    await expect.poll(()=>c.page.evaluate(()=>window.__grantRoster)).toBe(true);
    await c.page.evaluate(()=>window.__releaseGrant());
    await expect.poll(()=>c.page.evaluate(async()=>(await import('./js/webrtc.js')).getSyncDiagnostics().transportRevision)).toBe(signal.rooms.get(id).transport.revision);
    expect(await c.page.evaluate(()=>window.isHost&&!!sessionStorage.getItem('host_credential'))).toBe(true);
    await c.page.reload();await mount(c.page);expect((await room(c.page)).isHost).toBe(true);
    expect(h.errors).toEqual([]);expect(c.errors).toEqual([]);
  }finally{await h.context.close();await c.context.close();}
});
for(const boundary of ['overflow','replacement','room-close']) test(`active playback cancels audio immediately at held ${boundary} boundary`,async({browser,browserName})=>{
  const h=await setup(browser),c=await setup(browser);let replacement;
  try{
    test.skip(browserName==='webkit' && process.platform==='win32' && !(await h.page.evaluate(()=>typeof BaseAudioContext==='function' && typeof AudioContext==='function')), 'This Windows WebKit build lacks native Web Audio. Immediate source-cancellation proof requires a supported browser or real iOS device.');
    for(const peer of [h,c])await peer.context.addInitScript(()=>{
      window.__audioStarts=0;window.__audioCancels=0;window.__workerStops=0;window.__longVoiceSchedules=0;
      for(const name of ['createOscillator','createBufferSource']){
        const create=BaseAudioContext.prototype[name];BaseAudioContext.prototype[name]=function(...args){
          const source=create.apply(this,args),start=source.start.bind(source),stop=source.stop.bind(source);
          source.start=(...a)=>{window.__audioStarts++;return start(...a);};
          source.stop=(...a)=>{if(!a.length||a[0]<=this.currentTime)window.__audioCancels++;else if(a[0]-this.currentTime>1)window.__longVoiceSchedules++;return stop(...a);};return source;
        };
      }
      const post=Worker.prototype.postMessage;Worker.prototype.postMessage=function(message,...a){if(message==='stop')window.__workerStops++;return post.call(this,message,...a);};
    });
    await h.page.goto(origin);await mount(h.page);await c.page.goto(h.page.url());await mount(c.page);
    const target=boundary==='room-close'?c:h;
    // Keep a real synth voice alive at revocation, rather than just inspecting a flag.
    await h.page.evaluate(async()=>{const a=(await import('./js/appState.js')).default;const t=a.getTracks()[0];t.mainBeatSound={sound:'Synth Kick',settings:{release:3,decay:2}};await(await import('./js/webrtc.js')).sendState(a.getCurrentStateForPreset(true));});
    await expect.poll(()=>c.page.evaluate(async()=>(await import('./js/appState.js')).default.getTracks()[0].mainBeatSound.settings.release)).toBe(3);
    await h.page.locator('#start-stop-btn').click();
    await expect.poll(()=>target.page.evaluate(async()=>(await import('./js/appState.js')).default.isPlaying())).toBe(true);
    // The silent one-frame audio-unlock buffer is not an engine voice. Wait
    // for the real long kick's native stop schedule before holding refresh.
    await expect.poll(()=>target.page.evaluate(()=>window.__longVoiceSchedules)).toBeGreaterThan(0);
    await target.page.evaluate(async()=>{
      const a=(await import('./js/appState.js')).default,original=a.getCurrentStateForPreset.bind(a);let first=true;
      a.getCurrentStateForPreset=(...args)=>first?(first=false,new Promise(resolve=>{window.__releaseActive=()=>original(...args).then(resolve);})):original(...args);
      window.__heldWire=window.__wire;window.__heldWire.addEventListener('close',e=>window.__closeCode=e.code);
      window.__heldWire.send(JSON.stringify({type:'state-request'}));
    });
    await expect.poll(()=>target.page.evaluate(()=>typeof window.__releaseActive)).toBe('function');
    const before=await target.page.evaluate(()=>({cancels:window.__audioCancels,stops:window.__workerStops}));
    const id=new URL(h.page.url()).searchParams.get('room');
    if(boundary==='overflow')await h.page.evaluate(()=>{for(let i=0;i<140;i++)window.__wire.send(JSON.stringify({type:'state-request'}));});
    if(boundary==='replacement'){
      const WS=require('../../MetronomeSignalServer/node_modules/ws');replacement=new WS(signalURL);await new Promise(r=>replacement.once('open',r));
      const credential=await h.page.evaluate(()=>sessionStorage.getItem('host_credential'));
      replacement.send(JSON.stringify({type:'join',room:id,requestedRole:'host',hostCredential:credential,capabilities:['rehearsal-v1']}));
    }
    if(boundary==='room-close')await h.page.evaluate(()=>window.__wire.send(JSON.stringify({type:'close-room'})));
    await expect.poll(async()=>(await room(target.page)).joined).toBe(false);
    await target.page.waitForTimeout(200);
    expect(await target.page.evaluate(async()=>(await import('./js/appState.js')).default.isPlaying())).toBe(false);
    expect(await target.page.evaluate(()=>window.__workerStops)).toBeGreaterThan(before.stops);
    expect(await target.page.evaluate(()=>window.__audioCancels)).toBeGreaterThan(before.cancels);
    const starts=await target.page.evaluate(()=>window.__audioStarts);await target.page.waitForTimeout(300);
    expect(await target.page.evaluate(()=>window.__audioStarts)).toBe(starts);
    if(boundary==='overflow')expect(await target.page.evaluate(()=>window.__closeCode)).toBe(4008);
    if(boundary==='room-close')expect(signal.rooms.has(id)).toBe(false);
    await target.page.evaluate(()=>window.__releaseActive());await target.page.waitForTimeout(100);
    expect(await target.page.evaluate(async()=>(await import('./js/appState.js')).default.isPlaying())).toBe(false);
    expect(h.errors).toEqual([]);expect(c.errors).toEqual([]);
  }finally{replacement?.close();await h.context.close();await c.context.close();}
});
test('two isolated browsers report explicit readiness and actual software confidence without exposing credentials',async({browser})=>{
  const h=await setup(browser), c=await setup(browser);
  try {
    await h.page.goto(origin); await expect.poll(()=>room(h.page)).not.toBeNull();
    await expect.poll(async()=>(await room(h.page)).supported).toBe(true);
    await c.page.goto(h.page.url()); await mount(h.page); await mount(c.page);
    await expect.poll(async()=>(await room(h.page)).participants.length).toBe(2);
    await c.page.getByLabel('I am ready').check();
    await expect.poll(async()=>(await room(h.page)).participants.filter(p=>p.ready).length).toBe(1);
    await expect(h.page.locator('[data-rehearsal-grid]')).toContainText('Audio');
    await expect(h.page.locator('[data-rehearsal-grid]')).toContainText('Clock');
    const state=await room(h.page); expect(JSON.stringify(state)).not.toMatch(/credential|token|secret/i);
    await h.page.evaluate(async()=>{const m=await import('./js/webrtc.js'); const s=m.getRehearsalRoomState();s.participants.length=0;});
    expect((await room(h.page)).participants.length).toBe(2);
    const identity=(await room(c.page)).ownPeerId;
    await c.page.reload();await mount(c.page);
    expect((await room(c.page)).ownPeerId).toBe(identity);
    expect(h.errors).toEqual([]);expect(c.errors).toEqual([]);
  } finally {await h.context.close();await c.context.close();}
});
test('disconnect recovery restores only the rightful host and authoritative stopped snapshot',async({browser})=>{
  const h=await setup(browser),c=await setup(browser);
  try {
    await h.page.goto(origin);await mount(h.page);
    await c.page.goto(h.page.url());await mount(c.page);
    await h.page.evaluate(async()=>{
      const {default:a}=await import('./js/appState.js');a.setTempo(187);
      const m=await import('./js/webrtc.js');await m.sendState(a.getCurrentStateForPreset(true));
    });
    await expect.poll(()=>c.page.evaluate(async()=>(await import('./js/appState.js')).default.getTempo())).toBe(187);
    await h.page.evaluate(async()=>{(await import('./js/webrtc.js')).disconnect();});
    await expect.poll(async()=>(await room(c.page)).hostConnected).toBe(false);
    await expect.poll(async()=>(await room(c.page)).playing).toBe(false);
    await expect(h.page.getByRole('button',{name:'Restore my room',exact:true})).toBeEnabled();
    await h.page.getByRole('button',{name:'Restore my room',exact:true}).click();
    await expect.poll(async()=>(await room(h.page)).isHost).toBe(true);
    await expect.poll(async()=>(await room(c.page)).hostConnected).toBe(true);
    expect(await h.page.evaluate(async()=>(await import('./js/appState.js')).default.getTempo())).toBe(187);
    expect((await room(h.page)).playing).toBe(false);
    expect(h.errors).toEqual([]);expect(c.errors).toEqual([]);
  }finally{await h.context.close();await c.context.close();}
});
test('a pending async state send cannot publish after host handoff revokes its generation',async({browser})=>{
  const h=await setup(browser),c=await setup(browser);const sent=[];
  h.page.on('websocket',s=>s.on('framesent',e=>{try{sent.push(JSON.parse(e.payload));}catch{}}));
  try{
    await h.page.goto(origin);await mount(h.page);await c.page.goto(h.page.url());await mount(c.page);
    await h.page.evaluate(async()=>{
      const {default:a}=await import('./js/appState.js'),m=await import('./js/webrtc.js');
      const snapshot=await a.getCurrentStateForPreset(true);
      const held=new Promise(resolve=>{window.__releaseState=()=>resolve(snapshot);});
      await m.sendState(held);
    });
    await h.page.waitForTimeout(200);
    await c.page.getByRole('button',{name:'Request control',exact:true}).click();
    await h.page.getByRole('button',{name:'Approve and hand off'}).click();
    await expect.poll(async()=>(await room(c.page)).isHost).toBe(true);
    const before=sent.filter(m=>m.type==='state').length;
    await h.page.evaluate(()=>window.__releaseState());await h.page.waitForTimeout(300);
    expect(sent.filter(m=>m.type==='state').length).toBe(before);
    expect(h.errors).toEqual([]);expect(c.errors).toEqual([]);
  }finally{await h.context.close();await c.context.close();}
});
test('failed host credentials and explicit room closure give honest recovery guidance without fallback authority',async({browser})=>{
  const h=await setup(browser),c=await setup(browser);
  try{
    await h.page.goto(origin);await mount(h.page);await c.page.goto(h.page.url());await mount(c.page);
    await h.page.evaluate(()=>sessionStorage.setItem('host_credential','a'.repeat(64)));
    await h.page.reload();
    await expect.poll(async()=>(await room(h.page))?.recoveryMessage).toMatch(/credential/i);
    expect((await room(h.page)).isHost).toBe(false);
    expect((await room(h.page)).joined).toBe(false);
    expect((await room(c.page)).isHost).toBe(false);
    expect(h.errors).toEqual([]);expect(c.errors).toEqual([]);
  }finally{await h.context.close();await c.context.close();}
});
test('visiting a different room preserves the saved own-room identity for explicit restoration',async({browser})=>{
  const a=await setup(browser),b=await setup(browser);
  try{
    await a.page.goto(origin);await mount(a.page);const ownURL=a.page.url();
    await b.page.goto(origin);await mount(b.page);
    await a.page.goto(b.page.url());await mount(a.page);
    await expect(a.page.getByRole('button',{name:'Restore my room',exact:true})).toBeEnabled();
    await a.page.getByRole('button',{name:'Restore my room',exact:true}).click();
    await expect.poll(async()=>(await room(a.page)).isHost).toBe(true);
    expect(a.page.url()).toBe(ownURL);
    await a.page.reload();await mount(a.page);expect((await room(a.page)).isHost).toBe(true);
    expect(a.errors).toEqual([]);expect(b.errors).toEqual([]);
  }finally{await a.context.close();await b.context.close();}
});
test('disconnect cancels an in-flight own-room rotation before it can overwrite session identity',async({browser})=>{
  const h=await setup(browser);
  try{
    await h.page.goto(origin);await mount(h.page);const url=h.page.url();
    await h.page.evaluate(async()=>{
      const original=crypto.subtle.digest.bind(crypto.subtle);
      crypto.subtle.digest=(...args)=>new Promise(resolve=>{window.__releaseIdentity=()=>original(...args).then(resolve);});
      const m=await import('./js/webrtc.js');
      window.__rotation=m.disconnectAllPeers();
    });
    await expect.poll(()=>h.page.evaluate(()=>typeof window.__releaseIdentity)).toBe('function');
    await h.page.evaluate(async()=>{const m=await import('./js/webrtc.js');m.disconnect();window.__releaseIdentity();await window.__rotation;});
    expect(h.page.url()).toBe(url);
    expect((await room(h.page)).joined).toBe(false);
    expect(h.errors).toEqual([]);
  }finally{await h.context.close();}
});
test('servers without rehearsal advertisement never imply readiness support',async({browser})=>{
  const h=await setup(browser);
  const stripAdvertisement=ws=>{
    const send=ws.send.bind(ws);
    ws.send=(raw,...args)=>{const packet=JSON.parse(String(raw));if(packet.type==='joined')delete packet.capabilities;return send(JSON.stringify(packet),...args);};
  };
  signal.wss.on('connection',stripAdvertisement);
  try{
    await h.page.goto(origin);await mount(h.page);
    expect((await room(h.page)).supported).toBe(false);
    expect((await room(h.page)).participants).toEqual([]);
    await expect(h.page.getByLabel('I am ready')).toBeDisabled();
    await expect(h.page.locator('#rehearsal-room-root')).toContainText('does not support');
    expect(h.errors).toEqual([]);
  }finally{signal.wss.off('connection',stripAdvertisement);await h.context.close();}
});
test('explicit room closure stops retries and gives new-link guidance',async({browser})=>{
  const h=await setup(browser),c=await setup(browser);
  try{
    await h.page.goto(origin);await mount(h.page);await c.page.goto(h.page.url());await mount(c.page);
    await h.page.evaluate(async()=>{await (await import('./js/webrtc.js')).disconnectAllPeers();});
    await expect.poll(async()=>(await room(c.page)).recoveryMessage).toMatch(/closed.*new link/i);
    expect((await room(c.page)).joined).toBe(false);
    expect((await room(c.page)).participants).toEqual([]);
    expect(h.errors).toEqual([]);expect(c.errors).toEqual([]);
  }finally{await h.context.close();await c.context.close();}
});
test('request and explicit stopped handoff revoke the old host; private grant survives reload and cues follow authority',async({browser})=>{
  const h=await setup(browser), c=await setup(browser);
  try {
    await h.page.goto(origin);await mount(h.page);
    await c.page.goto(h.page.url());await mount(c.page);
    await c.page.evaluate(()=>{window.__roomEvents=[];window.__authorityChanges=0;document.addEventListener('roomauthoritychange',()=>window.__authorityChanges++);document.addEventListener('rehearsalroomchange',e=>window.__roomEvents.push(e.detail));});
    await c.page.getByRole('button',{name:'Request control',exact:true}).click();
    await expect(h.page.getByRole('button',{name:'Approve and hand off'})).toBeEnabled();
    await h.page.getByRole('button',{name:'Approve and hand off'}).click();
    await expect.poll(async()=>(await room(c.page)).isHost).toBe(true);
    await expect.poll(async()=>(await room(h.page)).isHost).toBe(false);
    await c.page.evaluate(async()=>{
      const a=(await import('./js/appState.js')).default;a.setTempo(194);
      await(await import('./js/webrtc.js')).sendState(a.getCurrentStateForPreset(true));
    });
    await expect.poll(()=>h.page.evaluate(async()=>(await import('./js/appState.js')).default.getTempo())).toBe(194);
    expect(await c.page.evaluate(()=>window.__authorityChanges)).toBeGreaterThan(0);
    expect(await h.page.evaluate(async()=>{const m=await import('./js/webrtc.js');return m.broadcastScheduledPlay();})).toBe(false);
    expect(await c.page.evaluate(async()=>{const m=await import('./js/webrtc.js');return m.sendRehearsalCue({text:'New host cue',bar:0});})).toBe(true);
    await expect.poll(async()=>(await room(h.page)).cue?.text).toBe('New host cue');
    expect(await c.page.evaluate(()=>JSON.stringify(window.__roomEvents))).not.toMatch(/credential|token|secret/i);
    expect(await h.page.evaluate(()=>sessionStorage.getItem('host_credential'))).toBeNull();
    await c.page.reload(); await mount(c.page);
    await expect.poll(async()=>(await room(c.page)).isHost).toBe(true);
    await expect.poll(async()=>(await room(c.page)).playing).toBe(false);
    expect(h.errors).toEqual([]);expect(c.errors).toEqual([]);
  } finally {await h.context.close();await c.context.close();}
});
