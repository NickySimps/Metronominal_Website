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
test.beforeEach(async({page},info)=>prepareWorkflowTestPage(page,info.config.metadata));
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
let web, origin;
test.beforeAll(async () => {
  const root = path.resolve(__dirname, '..');
  web = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://local').pathname;
    const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
    fs.readFile(file, (err, data) => {
      if (err) return res.writeHead(404).end();
      res.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : file.endsWith('.html') ? 'text/html' : file.endsWith('.wav') ? 'audio/wav' : 'text/javascript'); res.end(data);
    });
  });
  await new Promise(r => web.listen(Number(process.env.PERFORMANCE_HTTP_PORT || 4238), '127.0.0.1', r)); origin = `http://127.0.0.1:${web.address().port}`;
});
test.afterAll(async () => { await new Promise(r => web.close(r)); });
async function fixture(page, { midi = 'unsupported', fullscreen = 'denied' } = {}) {
  await page.route('**/js/webrtc.js', route => route.fulfill({ contentType: 'text/javascript', body: `
    export const getSyncDiagnostics=()=>window.room;
    export const isSynchronizationJoined=()=>window.room.role!=='offline';
    export const getRehearsalRoomState=()=>({supported:window.room.supported,cue:window.room.cue});
  ` }));
  await page.route('**/fixture.html', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/performance-view.css"><style>body{margin:0}.main-container{padding:12px}</style><main class="main-container"><div id="mount"></div><input id="editor" value="Keep my edit"><button id="start-stop-btn">Play</button><div id="all-tracks-wrapper"></div></main>` }));
  await page.goto(origin + '/fixture.html');
  await page.evaluate(async ({ midi, fullscreen }) => {
    window.room = { role: 'offline', status: 'disconnected', supported: true, cue: null };
    window.transportClicks = 0; window.nextRequests = 0;
    document.addEventListener('metronominal:section-next', () => nextRequests++);
    if (fullscreen === 'denied') document.documentElement.requestFullscreen = async () => { throw new DOMException('Not allowed', 'NotAllowedError'); };
    if (fullscreen === 'unsupported') document.documentElement.requestFullscreen = undefined;
    if (fullscreen === 'native') {
      let el = null; Object.defineProperty(document, 'fullscreenElement', { get: () => el });
      document.documentElement.requestFullscreen = async () => { window.fullscreenRequests=(window.fullscreenRequests||0)+1;el=document.documentElement;document.dispatchEvent(new Event('fullscreenchange')); };
      document.exitFullscreen = async () => { el=null;document.dispatchEvent(new Event('fullscreenchange')); };
    }
    window.state = (await import('/js/appState.js')).default;
    if (!state.getTracks().length) state.addTrack();
    state.updateTrack(0, { currentBar: 0, currentBeat: 0, barSettings: Array.from({length:4},()=>({ beats:4,subdivision:1,rests:[] })) });
    state.setSong({name:'Live set',enabled:true,sections:[{name:'Verse',startBar:0,tempo:127,repeats:3},{name:'Chorus',startBar:2,tempo:144,repeats:1}]});
    document.querySelector('#start-stop-btn').addEventListener('click', () => {transportClicks++;void state.togglePlay();});
    window.accessRequests = [];
    const port = (id) => Object.assign(new EventTarget(), { id, name: 'Pedal '+id, state:'connected', type:'input' });
    window.inputA=port('a');window.inputB=port('b');window.outputMessages=[];
    window.access=Object.assign(new EventTarget(),{ inputs:new Map([['a',inputA],['b',inputB]]),outputs:new Map([['out',{id:'out',send:data=>outputMessages.push(data)}]]) });
    Object.defineProperty(navigator,'requestMIDIAccess',{configurable:true,value:midi==='unsupported'?undefined:async options=>{accessRequests.push(options);if(midi==='denied')throw new DOMException('Denied','NotAllowedError');return access;}});
    window.emitMidi=(port,data)=>{const event=new Event('midimessage');Object.defineProperty(event,'data',{value:new Uint8Array(data)});port.dispatchEvent(event);};
    window.performanceModule=await import('/js/performanceView.js');
    window.view=performanceModule.initializePerformanceView(document.querySelector('#mount'));
  }, { midi, fullscreen });
}
test('native fullscreen, authoritative actions, modal-safe shortcuts and cleanup', async ({ page }) => {
  await fixture(page, { fullscreen:'native' });
  await page.getByRole('button',{name:'Performance view',exact:true}).click();
  expect(await page.evaluate(()=>fullscreenRequests)).toBe(1);
  await expect(page.locator('[data-performance-status]')).toHaveText('Fullscreen performance view.');
  await page.getByRole('button',{name:'Play',exact:true}).click();
  expect(await page.evaluate(()=>transportClicks)).toBe(1);
  await page.getByRole('button',{name:'Next section',exact:true}).click();
  expect(await page.evaluate(()=>nextRequests)).toBe(1);
  expect(await page.evaluate(()=>state.getTracks()[0].currentBar)).toBe(0);
  await page.evaluate(()=>{document.querySelector('[data-performance-position]').tabIndex=-1;document.querySelector('[data-performance-position]').focus();});
  await page.keyboard.press('n');
  expect(await page.evaluate(()=>nextRequests)).toBe(2);
  // Existing global Space owns the one toggle; performance must not add another.
  await page.evaluate(()=>document.addEventListener('keydown',event=>{if(event.key===' '&&!event.defaultPrevented){transportClicks++;event.preventDefault();}}));
  await page.keyboard.press('Space');
  expect(await page.evaluate(()=>transportClicks)).toBe(2);
  await page.evaluate(()=>{const modal=document.createElement('div');modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.innerHTML='<input>';document.body.append(modal);modal.querySelector('input').focus();window.stageModal=modal;});
  await page.keyboard.press('Escape');
  await expect(page.getByRole('region',{name:'Performance'})).toBeVisible();
  await page.keyboard.press('n');
  expect(await page.evaluate(()=>nextRequests)).toBe(2);
  await page.evaluate(()=>{stageModal.remove();room={role:'client',status:'connected',supported:true};window.isHost=false;document.dispatchEvent(new CustomEvent('roomauthoritychange'));document.dispatchEvent(new CustomEvent('syncrolechange',{detail:{state:'connected',isHost:false}}));});
  await expect(page.locator('[data-performance-play]')).toBeDisabled();
  await expect(page.locator('[data-performance-section-next]')).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('region',{name:'Performance'})).toBeHidden();
  await page.evaluate(()=>view.destroy());
  await expect(page.getByRole('button',{name:'Performance view',exact:true})).toHaveCount(0);
});
test('canonical highlights, real room cues, overview and contrast remain readable at constrained sizes', async ({page})=>{
  await fixture(page,{fullscreen:'unsupported'});
  await page.getByRole('button',{name:'Performance view',exact:true}).click();
  await page.evaluate(()=>{
    document.querySelector('#all-tracks-wrapper').innerHTML='<div class="bar-visual" data-container-index="0" data-bar-index="1"><div class="beat-square highlighted" data-beat-index="2"></div></div>';
    room.cue={text:'Quiet entrance'};document.dispatchEvent(new Event('rehearsalroomchange'));
  });
  await expect(page.locator('[data-performance-position]')).toContainText('Bar 2 · Beat 3');
  await expect(page.locator('[data-performance-cue]')).toHaveText('Quiet entrance');
  await page.getByLabel('Keep track overview').check();
  await expect(page.locator('[data-performance-overview]')).toContainText('Track');
  for (const viewport of [{width:320,height:700},{width:844,height:390}]) {
    await page.setViewportSize(viewport);
    await page.evaluate(()=>{document.documentElement.style.fontSize='24px';document.documentElement.style.setProperty('--Background','#fafafa');view.refresh();});
    const geometry=await page.locator('.performance-view').evaluate(el=>({scroll:el.scrollWidth,width:el.clientWidth,bg:getComputedStyle(el).backgroundColor,fg:getComputedStyle(el).color,targets:[...el.querySelectorAll('button,select')].filter(x=>x.getClientRects().length).map(x=>({w:x.getBoundingClientRect().width,h:x.getBoundingClientRect().height}))}));
    expect(geometry.scroll).toBeLessThanOrEqual(geometry.width+1);
    expect(geometry.targets.every(x=>x.w>=44&&x.h>=44)).toBe(true);
    expect(geometry.fg).toBe('rgb(0, 0, 0)');
    await page.getByRole('button',{name:'Exit performance view'}).scrollIntoViewIfNeeded();
    await expect(page.getByRole('button',{name:'Exit performance view'})).toBeInViewport();
  }
});
test('MIDI selected-device mappings learn note/CC edges, recheck authority and preserve clock output',async({page})=>{
  await fixture(page,{midi:'available'});
  await page.evaluate(async()=>{
    const module=await import('/js/midiController.js');window.midi=module.default;
    window.calls=[];window.allowInput=true;window.statuses=[];
    window.input=module.createMidiInputController({canControl:()=>allowInput,actions:{toggle:()=>calls.push('toggle'),nextSection:()=>calls.push('next')},onStatus:message=>statuses.push(message)});
    await input.connect();input.selectInput('a');input.setMapping('toggle',{type:'note',channel:1,number:60});input.setMapping('nextSection',{type:'cc',channel:1,number:20});input.setEnabled(true);
    emitMidi(inputB,[0x90,60,127]);emitMidi(inputA,[0x91,60,127]);emitMidi(inputA,[0x90,61,127]);
    emitMidi(inputA,[0x90,60,127]);emitMidi(inputA,[0x90,60,127]);emitMidi(inputA,[0x90,60,0]);emitMidi(inputA,[0x80,60,127]);emitMidi(inputA,[0x90,60,100]);
    emitMidi(inputA,[0xb0,20,127]);emitMidi(inputA,[0xb0,20,100]);emitMidi(inputA,[0xb0,20,0]);emitMidi(inputA,[0xb0,20,64]);
  });
  expect(await page.evaluate(()=>calls)).toEqual(['toggle','toggle','next','next']);
  expect(await page.evaluate(()=>accessRequests)).toEqual([{sysex:false}]);
  await page.evaluate(()=>{input.learn('nextSection');emitMidi(inputA,[0x92,62,127]);emitMidi(inputA,[0x92,62,127]);emitMidi(inputA,[0x92,62,0]);emitMidi(inputA,[0x92,62,127]);});
  expect(await page.evaluate(()=>calls)).toEqual(['toggle','toggle','next','next','next']);
  expect(await page.evaluate(()=>input.getState().mappings.nextSection)).toEqual({type:'note',channel:3,number:62});
  await page.evaluate(()=>{allowInput=false;emitMidi(inputA,[0x90,60,0]);emitMidi(inputA,[0x90,60,127]);allowInput=true;document.dispatchEvent(new Event('roomauthoritychange'));emitMidi(inputA,[0x92,62,0]);emitMidi(inputA,[0x92,62,127]);});
  expect(await page.evaluate(()=>calls.length)).toBe(5);
  expect(await page.evaluate(()=>input.getState().enabled)).toBe(false);
  await page.evaluate(()=>{input.setEnabled(true);inputA.state='disconnected';access.dispatchEvent(new Event('statechange'));emitMidi(inputA,[0x90,60,127]);});
  expect(await page.evaluate(()=>calls.length)).toBe(5);
  await page.evaluate(()=>{midi.sendMidiStart();midi.sendMidiClock();midi.sendMidiStop();input.destroy();});
  expect(await page.evaluate(()=>outputMessages)).toEqual([[0xfa],[0xf8],[0xfc]]);
  expect(await page.evaluate(()=>state.getCurrentStateForPreset?JSON.stringify(state.getSong()).includes('mappings'):false)).toBe(false);
});
test('MIDI session replacement cancels learning and detaches enabled input until explicit consent',async({page})=>{
  await fixture(page,{midi:'available'});
  await page.evaluate(async()=>{
    const module=await import('/js/midiController.js');window.calls=[];
    window.input=module.createMidiInputController({canControl:()=>true,actions:{toggle:()=>calls.push('toggle')}});
    await input.connect();input.selectInput('a');input.setMapping('toggle',{type:'note',channel:1,number:60});input.setEnabled(true);input.learn('toggle');
    document.dispatchEvent(new CustomEvent('historyboundary',{detail:{source:'load'}}));
    emitMidi(inputA,[0x90,61,127]);emitMidi(inputA,[0x90,60,127]);
  });
  expect(await page.evaluate(()=>input.getState().enabled)).toBe(false);
  expect(await page.evaluate(()=>input.getState().learning)).toBe(null);
  expect(await page.evaluate(()=>calls)).toEqual([]);
  await page.evaluate(()=>{input.setEnabled(true);emitMidi(inputA,[0x90,60,127]);input.destroy();emitMidi(inputA,[0x90,60,0]);emitMidi(inputA,[0x90,60,127]);});
  expect(await page.evaluate(()=>calls)).toEqual(['toggle']);
});
test('MIDI UI is lazy, selected-device local, requires an audio gesture and never takes client control',async({page})=>{
  await fixture(page,{midi:'available'});
  expect(await page.evaluate(()=>accessRequests)).toEqual([]);
  await page.getByRole('button',{name:'Performance view',exact:true}).click();
  await page.getByText('MIDI footswitch settings',{exact:true}).click();
  await page.getByRole('button',{name:'Connect MIDI',exact:true}).click();
  await page.getByLabel('MIDI input device',{exact:true}).selectOption('a');
  await page.getByLabel('Enable MIDI input',{exact:true}).check();
  await page.getByLabel('Footswitch action',{exact:true}).selectOption('toggle');
  await page.getByRole('button',{name:'Learn footswitch',exact:true}).click();
  await page.evaluate(()=>{emitMidi(inputA,[0x90,60,127]);emitMidi(inputA,[0x90,60,0]);emitMidi(inputA,[0x90,60,127]);});
  expect(await page.evaluate(()=>transportClicks)).toBe(0);
  await expect(page.locator('[data-performance-midi-status]')).toContainText('Play on this device');
  await page.getByRole('button',{name:'Play',exact:true}).click();
  await expect(page.getByRole('button',{name:'Stop',exact:true})).toBeVisible();
  await page.evaluate(()=>{emitMidi(inputA,[0x90,60,0]);emitMidi(inputA,[0x90,60,127]);});
  expect(await page.evaluate(()=>transportClicks)).toBe(2);
  await page.getByLabel('MIDI input device',{exact:true}).selectOption('b');
  await expect(page.locator('[data-performance-midi-mapping]')).toContainText('Not mapped');
  await page.getByLabel('MIDI input device',{exact:true}).selectOption('a');
  await expect(page.locator('[data-performance-midi-mapping]')).toContainText('60');
  await page.evaluate(()=>{room={role:'client',status:'connected',supported:true};window.isHost=false;document.dispatchEvent(new Event('roomauthoritychange'));});
  await expect(page.getByLabel('Enable MIDI input',{exact:true})).not.toBeChecked();
  await expect(page.getByLabel('Enable MIDI input',{exact:true})).toBeDisabled();
  await page.evaluate(()=>{emitMidi(inputA,[0x90,60,0]);emitMidi(inputA,[0x90,60,127]);});
  expect(await page.evaluate(()=>transportClicks)).toBe(2);
  expect(await page.evaluate(()=>window.isHost)).toBe(false);
});
for(const midi of ['denied','unsupported']) test(`MIDI ${midi} reports truthful fallback without blocking initialization`,async({page})=>{
  await fixture(page,{midi});
  await page.getByRole('button',{name:'Performance view',exact:true}).click();
  await page.getByText('MIDI footswitch settings',{exact:true}).click();
  await page.getByRole('button',{name:'Connect MIDI',exact:true}).click();
  await expect(page.locator('[data-performance-midi-status]')).toContainText(midi==='denied'?'permission denied':'unavailable');
  await expect(page.getByRole('button',{name:'Play',exact:true})).toBeEnabled();
});
test('optional external launcher is enabled, bound and restored on disposal',async({page})=>{
  await fixture(page);
  await page.evaluate(()=>{view.destroy();const button=document.createElement('button');button.id='performance-view-btn';button.textContent='Stage launcher';button.disabled=true;document.body.append(button);window.view=performanceModule.initializePerformanceView(document.querySelector('#mount'),{launcher:button});});
  await expect(page.getByRole('button',{name:'Performance view',exact:true})).toHaveCount(0);
  await expect(page.locator('#mount [role="status"]')).toContainText('toolbar');
  await page.getByRole('button',{name:'Stage launcher',exact:true}).click();
  await expect(page.getByRole('region',{name:'Performance'})).toBeVisible();
  await page.getByRole('button',{name:'Exit performance view'}).click();
  await page.evaluate(()=>view.destroy());
  await expect(page.getByRole('button',{name:'Stage launcher',exact:true})).toBeDisabled();
});
test('stage prevents hidden editing shortcuts and maps subdivisions to musical beat numbers',async({page})=>{
  await fixture(page);
  await page.getByRole('button',{name:'Performance view',exact:true}).click();
  await page.evaluate(()=>{window.resetCalls=0;document.addEventListener('keydown',e=>{if(e.key==='r'&&!e.defaultPrevented)resetCalls++;});state.updateTrack(0,{barSettings:[{beats:4,subdivision:2,rests:[]}]});document.querySelector('#all-tracks-wrapper').innerHTML='<div class="bar-visual" data-container-index="0" data-bar-index="0"><span class="beat-square highlighted-sub" data-beat-index="3"></span></div>';document.querySelector('[data-performance-position]').tabIndex=-1;document.querySelector('[data-performance-position]').focus();});
  await page.keyboard.press('r');
  expect(await page.evaluate(()=>resetCalls)).toBe(0);
  await expect(page.locator('[data-performance-position]')).toContainText('Beat 2');
});
test('native browser fullscreen enters and browser exit restores editing',async({page})=>{
  await fixture(page,{fullscreen:'browser'});
  await page.getByRole('button',{name:'Performance view',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>!!document.fullscreenElement)).toBe(true);
  await page.evaluate(()=>document.exitFullscreen());
  await expect(page.getByRole('region',{name:'Performance'})).toBeHidden();
  await expect(page.locator('#editor')).toHaveValue('Keep my edit');
});
test('real application stage layout and editing restoration do not require native audio',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin,{waitUntil:'domcontentloaded'});
 await expect(page.locator('#performance-view-btn')).toBeEnabled();
 await expect(page.locator('#workflow-tools-status')).not.toContainText('Preparing');
 await expect(page.locator('#share-btn')).toHaveClass(/(?:^|\s)connected(?:\s|$)/);
 await page.evaluate(async()=>{const a=(await import('/js/appState.js')).default;a.updateTrack(0,{currentBar:0,currentBeat:0,barSettings:Array.from({length:4},()=>({beats:4,subdivision:1,rests:[]}))});a.setSong({name:'Stage UI verification',enabled:true,sections:[{name:'Stage verse',startBar:0,tempo:120,repeats:2},{name:'Stage chorus',startBar:2,tempo:140,repeats:1}]});});
 for(const viewport of [{width:320,height:700},{width:844,height:390}]){
  await page.setViewportSize(viewport);await page.locator('#performance-view-btn').click();
  await expect(page.getByRole('region',{name:'Performance'})).toBeVisible();
  await expect(page.locator('[data-performance-section]')).toHaveText('Stage verse');await expect(page.locator('[data-performance-next]')).toHaveText('Stage chorus');
  await page.locator('.performance-midi').evaluate(el=>el.open=true);
  const metrics=await page.locator('.performance-view').evaluate(el=>({scroll:el.scrollWidth,width:el.clientWidth,exitBottom:el.querySelector('[data-performance-exit]').getBoundingClientRect().bottom,height:innerHeight}));
  expect(metrics.scroll).toBeLessThanOrEqual(metrics.width+1);expect(metrics.exitBottom).toBeLessThanOrEqual(metrics.height);
  await page.locator('[data-performance-exit]').click();await expect(page.getByRole('region',{name:'Performance'})).toBeHidden();
 }
 await expect(page.locator('#start-stop-btn')).toBeVisible();expect(errors).toEqual([]);
});
test('real application launcher uses authoritative playback and responsive stage UI',async({page,browser})=>{
  await requireNativeAudio(browser,'Authoritative stage playback and scheduled section transition require native audio');
  test.setTimeout(60000);
  const {createSyncServer}=require('../../MetronomeSignalServer/server.js');
  const backend=createSyncServer({port:10038,logger:{log(){},warn(){},error(){}}});
  try {
    const errors=[],serverErrors=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error'&&message.text().includes('Synchronization server error'))serverErrors.push(message.text());});
    await page.addInitScript(()=>{window.__stageWire=[];const Native=window.WebSocket;window.WebSocket=class extends Native{constructor(url,...args){super(String(url).replace(/ws:\/\/(?:127\.0\.0\.1|localhost):10000/,'ws://127.0.0.1:10038'),...args);const record=(direction,data)=>{try{const m=JSON.parse(data);if(m.type==='state'&&direction==='out'){const previous=window.__lastStageState,paths=[];const compare=(a,b,path)=>{if(JSON.stringify(a)===JSON.stringify(b))return;if(a&&b&&typeof a==='object'&&typeof b==='object'){for(const key of new Set([...Object.keys(a),...Object.keys(b)]))compare(a[key],b[key],path+'.'+key);}else paths.push(path);};if(previous)compare(previous,m.payload,'state');window.__lastStageState=m.payload;window.__stageWire.push({direction,type:m.type,tempo:m.payload?.tempo,changed:paths});}if(['song-change-command','song-change','error','transport'].includes(m.type))window.__stageWire.push({direction,type:m.type,revision:m.revision,cancelled:m.cancelled,code:m.code,startBar:m.startBar,sectionIndex:m.sectionIndex,change:m.change?{sectionIndex:m.change.sectionIndex,startBar:m.change.startBar}:null});}catch{}};this.addEventListener('message',event=>record('in',event.data));const nativeSend=this.send.bind(this);this.send=data=>{record('out',data);return nativeSend(data);};}};Object.defineProperty(navigator,'requestMIDIAccess',{configurable:true,value:undefined});});
    await page.goto(origin,{waitUntil:'domcontentloaded'});
    await expect(page.locator('#share-btn')).toHaveClass(/(?:^|\s)connected(?:\s|$)/);
    await expect(page.locator('#performance-view-btn')).toBeEnabled();
    await expect(page.locator('#workflow-tools-status')).not.toContainText('Preparing');
    await page.evaluate(async()=>{
      const state=(await import('/js/appState.js')).default;
      state.updateTrack(0,{currentBar:0,currentBeat:0,barSettings:Array.from({length:4},()=>({beats:4,subdivision:1,rests:[]}))});
      state.setSong({name:'Stage browser verification',enabled:true,sections:[{name:'Stage verse',startBar:0,tempo:300,repeats:16},{name:'Stage chorus',startBar:2,tempo:280,repeats:16}]});
    });
    await page.locator('#performance-view-btn').click();
    await expect(page.getByRole('region',{name:'Performance'})).toBeVisible();
    await expect(page.locator('[data-performance-section]')).toHaveText('Stage verse');
    await expect(page.locator('[data-performance-next]')).toHaveText('Stage chorus');
    await page.locator('[data-performance-play]').click();
    await expect.poll(()=>page.evaluate(async()=>(await import('/js/appState.js')).default.isPlaying())).toBe(true);
    await expect(page.locator('[data-performance-play]')).toHaveText('Stop');
    await page.locator('[data-performance-section-next]').click();
    await expect.poll(()=>page.evaluate(async()=>{
      const state=(await import('/js/appState.js')).default;
      return state.getSongSectionForBar(state.getTracks()[0].currentBar).name;
    }),{timeout:10000}).toBe('Stage chorus').catch(async error=>{
      const detail=await page.evaluate(async()=>{const a=(await import('/js/appState.js')).default,p=await import('/js/practiceTransport.js');return {timelineStatus:document.querySelector('[data-arrangement-status]')?.textContent,pending:p.getPendingSongChange(),playing:a.isPlaying(),tracks:a.getTracks().map(t=>({bar:t.currentBar,beat:t.currentBeat,bars:t.barSettings.length})),sections:a.getSong().sections.map(s=>({name:s.name,startBar:s.startBar,tracks:s.tracks?.length}))};});
      detail.serverErrors=serverErrors;detail.wire=await page.evaluate(()=>window.__stageWire);await test.info().attach('section-transition-state',{body:Buffer.from(JSON.stringify(detail)),contentType:'application/json'});throw error;
    });
    await expect(page.locator('[data-performance-section]')).toHaveText('Stage chorus');
    await expect(page.locator('[data-performance-tempo]')).toHaveText('280');
    await page.locator('[data-performance-play]').click();
    await expect.poll(()=>page.evaluate(async()=>(await import('/js/appState.js')).default.isPlaying())).toBe(false);
    await page.locator('[data-performance-exit]').click();
    await expect.poll(()=>page.evaluate(()=>document.fullscreenElement===null)).toBe(true);
    await expect(page.getByRole('region',{name:'Performance'})).toBeHidden();
    for(const viewport of [{width:320,height:700},{width:844,height:390}]){
      // Resize only outside native fullscreen, then exercise fullscreen at that size.
      await page.setViewportSize(viewport);
      await page.locator('#performance-view-btn').click();
      await expect(page.getByRole('region',{name:'Performance'})).toBeVisible();
      await expect.poll(()=>page.evaluate(()=>!!document.fullscreenElement)).toBe(true);
      await page.locator('.performance-midi').evaluate(el=>el.open=true);
      const metrics=await page.locator('.performance-view').evaluate(el=>({scroll:el.scrollWidth,width:el.clientWidth,exitVisible:el.querySelector('[data-performance-exit]').getBoundingClientRect().bottom<=innerHeight,overflow:[...el.querySelectorAll('*')].filter(x=>x.getClientRects().length&&(x.getBoundingClientRect().right>el.clientWidth||x.scrollWidth>x.clientWidth+1)).map(x=>({tag:x.tagName,class:x.className,text:x.textContent.slice(0,80),width:x.clientWidth,scroll:x.scrollWidth,right:x.getBoundingClientRect().right}))}));
      if(metrics.scroll>metrics.width+1){console.log(JSON.stringify(metrics));console.log(await page.locator('[data-performance-midi-device]').evaluate(x=>({rect:x.getBoundingClientRect().toJSON(),margin:getComputedStyle(x).margin,transform:getComputedStyle(x).transform,box:getComputedStyle(x).boxSizing,css:getComputedStyle(x).cssText})));}
      expect(metrics.scroll).toBeLessThanOrEqual(metrics.width+1);
      expect(metrics.exitVisible).toBe(true);
      await page.screenshot({path:test.info().outputPath(`performance-real-${viewport.width}.png`)});
      await page.locator('[data-performance-exit]').click();
      await expect.poll(()=>page.evaluate(()=>document.fullscreenElement===null)).toBe(true);
      await expect(page.getByRole('region',{name:'Performance'})).toBeHidden();
    }
    await expect(page.locator('#start-stop-btn')).toBeVisible();
    expect(errors).toEqual([]);expect(serverErrors).toEqual([]);
  } finally {await page.goto('about:blank').catch(()=>{});await backend.close();}
});
test('performance exit restores meaningful prior focus or falls back to its launcher',async({page})=>{
 await fixture(page);
 await page.evaluate(async()=>{document.activeElement?.blur();await view.enter();});
 await page.getByRole('button',{name:'Exit performance view'}).click();
 await expect(page.getByRole('button',{name:'Performance view',exact:true})).toBeFocused();
 await page.locator('#editor').focus();await page.evaluate(()=>view.enter());
 await page.getByRole('button',{name:'Exit performance view'}).click();
 await expect(page.locator('#editor')).toBeFocused();
});

test('performance fallback shows canonical song and preserves editing state on exit', async ({ page }) => {
  await fixture(page);
  await page.getByRole('button', {name:'Performance view',exact:true}).click();
  await expect(page.getByRole('region',{name:'Performance'})).toBeVisible();
  await expect(page.locator('[data-performance-status]')).toContainText('Fullscreen');
  await expect(page.locator('[data-performance-tempo]')).toHaveText('127');
  await expect(page.locator('[data-performance-section]')).toHaveText('Verse');
  await expect(page.locator('[data-performance-next]')).toHaveText('Chorus');
  await expect(page.locator('[data-performance-repeats]')).toContainText('2');
  await page.getByRole('button',{name:'Exit performance view'}).click();
  await expect(page.locator('#editor')).toHaveValue('Keep my edit');
  await expect(page.getByRole('button',{name:'Performance view',exact:true})).toBeFocused();
});
