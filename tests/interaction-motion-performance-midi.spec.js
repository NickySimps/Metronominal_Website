'use strict';
const {test,expect}=require('@playwright/test');
const openMotion=require('./motionTestPage.cjs');

test('overview toggles decorate the visible label without changing music or the input geometry',async({page})=>{
 await ready(page);await enter(page);const toggle=page.locator('[data-performance-keep-overview]');
 const before=await page.evaluate(()=>({song:structuredClone(a.getSong()),tracks:a.getTracks().map(t=>({name:t.name,bars:structuredClone(t.barSettings)}))}));
 const rect=await toggle.boundingBox();await page.evaluate(()=>{__motionObserved=[];});
 await toggle.check();await expect(page.locator('[data-performance-overview]')).toBeVisible();await seen(page,'toggle');
 expect(await toggle.boundingBox()).toEqual(rect);await page.evaluate(()=>{__motionObserved=[];});
 await toggle.uncheck();await expect(page.locator('[data-performance-overview]')).toBeHidden();await seen(page,'toggle');
 expect(await page.evaluate(()=>({song:structuredClone(a.getSong()),tracks:a.getTracks().map(t=>({name:t.name,bars:structuredClone(t.barSettings)}))}))).toEqual(before);
 await exit(page);
});
async function ready(page){await openMotion(page,test.info().config.metadata);await expect(page.locator('#sync-quality')).toHaveText(/good/i);await page.evaluate(async()=>{window.a=(await import('/js/appState.js')).default;__motionObserved=[];});}
const seen=(page,kind)=>expect.poll(()=>page.evaluate(kind=>__motionObserved.includes(kind),kind)).toBe(true);
async function enter(page){await page.locator('#performance-view-btn').click();await expect(page.locator('.performance-view')).toBeVisible();await expect.poll(()=>page.evaluate(()=>document.fullscreenElement===document.documentElement)).toBe(true);await expect(page.locator('[data-performance-status]')).toHaveText('Fullscreen performance view.');}
async function exit(page){await page.locator('[data-performance-exit]').click();await expect(page.locator('.performance-view')).toBeHidden();await expect.poll(()=>page.evaluate(()=>document.fullscreenElement===null)).toBe(true);}

test('native fullscreen success decorates the visible stage; actual exit restores editing and finite feedback',async({page})=>{
 await ready(page);await enter(page);await seen(page,'ready');
 await expect(page.locator('.main-container').first()).toHaveJSProperty('inert',true);
 expect(await page.locator('[data-performance-exit]').evaluate(el=>el===document.activeElement)).toBe(true);
 await page.screenshot({path:test.info().outputPath('native-stage.png')});
 await page.evaluate(()=>{__motionObserved=[];});await exit(page);await seen(page,'close');
 await expect(page.locator('#performance-view-btn')).toBeFocused();
 await expect(page.locator('.main-container').first()).toHaveJSProperty('inert',false);
 await expect(page.locator('[data-motion-kind]')).toHaveCount(0);
});

test('stage transport feedback follows engine applied state, not a held request',async({page})=>{
 await ready(page);await enter(page);
 await page.evaluate(async()=>{const engine=(await import('/js/metronomeEngine.js')).default,original=engine.togglePlay;
  let release;const held=new Promise(r=>release=r);window.releaseTransport=release;
  engine.togglePlay=async(...args)=>{window.transportReached=true;await held;return original(...args);};__motionObserved=[];
 });
 await page.locator('[data-performance-play]').click();await page.waitForFunction(()=>window.transportReached);
 expect(await page.evaluate(()=>a.isPlaying())).toBe(false);expect(await page.evaluate(()=>__motionObserved.includes('play'))).toBe(false);
 await page.evaluate(()=>releaseTransport());await expect.poll(()=>page.evaluate(()=>a.isPlaying())).toBe(true);await seen(page,'play');
 await expect(page.locator('[data-performance-play]')).toHaveText('Stop');
 await page.evaluate(()=>{__motionObserved=[];});await page.locator('[data-performance-play]').click();await expect.poll(()=>page.evaluate(()=>a.isPlaying())).toBe(false);await seen(page,'stop');await exit(page);
});

test('native Web MIDI permission grant reports API connection without inventing an input device',async({page})=>{
 await page.context().grantPermissions(['midi','midi-sysex']);await ready(page);expect(await page.evaluate(()=>typeof navigator.requestMIDIAccess)).toBe('function');
 await enter(page);await page.locator('.performance-midi > summary').click();await page.evaluate(()=>{__motionObserved=[];});
 await page.locator('[data-performance-midi-connect]').click();await expect(page.locator('[data-performance-midi-status]')).toContainText('MIDI available');await seen(page,'connect');
 const capability=await page.evaluate(async()=>{const m=(await import('/js/midiController.js')).default;return {nativeAPI:true,permission:(await navigator.permissions.query({name:'midi',sysex:false})).state,inputs:m.getInputs().length,outputs:m.getOutputs().length};});
 await test.info().attach('native-midi-capability-no-hardware-claim',{body:JSON.stringify(capability),contentType:'application/json'});
 if(capability.inputs===0){await expect(page.locator('[data-performance-midi-device] option')).toHaveCount(1);await expect(page.locator('[data-performance-midi-enabled]')).toBeDisabled();}
 expect(await page.evaluate(()=>a.isPlaying())).toBe(false);await exit(page);
});

async function generatedMidi(page){
 // GENERATED SOFTWARE FIXTURE ONLY: not native MIDI or physical hardware.
 await page.addInitScript(()=>{
  const port=id=>Object.assign(new EventTarget(),{id,name:'Generated software fixture '+id,state:'connected',type:'input'});
  window.softwarePorts=[port('software-a'),port('software-b')];
  window.softwareAccess=Object.assign(new EventTarget(),{inputs:new Map(softwarePorts.map(p=>[p.id,p])),outputs:new Map()});
  Object.defineProperty(navigator,'requestMIDIAccess',{configurable:true,value:async options=>{window.softwareRequestOptions=options;return softwareAccess;}});
  window.generatedMessage=(index,data)=>{const event=new Event('midimessage');Object.defineProperty(event,'data',{value:new Uint8Array(data)});softwarePorts[index].dispatchEvent(event);};
 });
 await ready(page);await enter(page);await page.locator('.performance-midi > summary').click();await page.locator('[data-performance-midi-connect]').click();await expect(page.locator('[data-performance-midi-status]')).toContainText('MIDI available');
}
async function resetMotion(page){await page.evaluate(()=>{__motionObserved=[];});}
async function softSeen(page,kind){await expect.soft.poll(()=>page.evaluate(kind=>__motionObserved.includes(kind),kind),{timeout:1000}).toBe(true);}

test('generated software MIDI mapping lifecycle decorates accepted device-local outcomes',async({page})=>{
 await generatedMidi(page);await resetMotion(page);
 await page.locator('[data-performance-midi-device]').selectOption('software-a');await softSeen(page,'select');
 await resetMotion(page);await page.locator('[data-performance-midi-enabled]').check();await softSeen(page,'toggle');
 await resetMotion(page);await page.locator('[data-performance-midi-save]').click();await expect(page.locator('[data-performance-midi-mapping]')).toContainText('60');await softSeen(page,'save');
 await resetMotion(page);await page.locator('[data-performance-midi-learn]').click();await softSeen(page,'pending');
 await page.evaluate(()=>generatedMessage(0,[0xb0,21,127]));await expect(page.locator('[data-performance-midi-mapping]')).toContainText('CC 21');await softSeen(page,'learn');
 expect(await page.evaluate(()=>a.isPlaying())).toBe(false);
 await resetMotion(page);await page.locator('[data-performance-midi-learn]').click();await page.locator('[data-performance-midi-cancel]').click();await softSeen(page,'cancel');
 await resetMotion(page);await page.locator('[data-performance-midi-clear]').click();await expect(page.locator('[data-performance-midi-mapping]')).toHaveText('Not mapped');await softSeen(page,'remove');
 expect(await page.evaluate(()=>softwareRequestOptions)).toEqual({sysex:false});
 expect(await page.evaluate(()=>JSON.stringify(a.getSong()).includes('software-a'))).toBe(false);await exit(page);
});

test('generated software mapping no-op stays silent and storage failure is session-only, not saved',async({page})=>{
 await generatedMidi(page);await page.locator('[data-performance-midi-device]').selectOption('software-a');await page.locator('[data-performance-midi-enabled]').check();
 await page.locator('[data-performance-midi-save]').click();await seen(page,'save');await page.waitForTimeout(240);await resetMotion(page);
 const before=await page.evaluate(()=>a.getMusicalSnapshot()),stored=await page.evaluate(()=>localStorage.getItem('metronominal.midi.input.v1:software-a'));
 await page.locator('[data-performance-midi-save]').click();expect(await page.evaluate(()=>__motionObserved)).toEqual([]);
 await page.evaluate(()=>{const native=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key.startsWith('metronominal.midi.input.v1:'))throw new DOMException('Generated unavailable storage','QuotaExceededError');return native.call(this,key,value);};});
 await page.locator('[data-performance-midi-number]').fill('61');await resetMotion(page);await page.locator('[data-performance-midi-save]').click();
 await expect(page.locator('[data-performance-midi-status]')).toContainText('session only');await seen(page,'adjust');
 expect(await page.evaluate(()=>__motionObserved.includes('save'))).toBe(false);expect(await page.evaluate(()=>localStorage.getItem('metronominal.midi.input.v1:software-a'))).toBe(stored);
 await expect(page.locator('[data-performance-midi-mapping]')).toContainText('61');expect(await page.evaluate(()=>a.getMusicalSnapshot())).toEqual(before);await exit(page);
});

test('generated software device departure arrival and deselection acknowledge only actual membership changes',async({page})=>{
 await generatedMidi(page);await page.locator('[data-performance-midi-device]').selectOption('software-a');await page.locator('[data-performance-midi-enabled]').check();await page.waitForTimeout(240);await resetMotion(page);
 await page.evaluate(()=>{softwarePorts[0].state='disconnected';softwareAccess.dispatchEvent(new Event('statechange'));});
 await expect(page.locator('[data-performance-midi-enabled]')).not.toBeChecked();await seen(page,'disconnect');
 await resetMotion(page);await page.evaluate(()=>softwareAccess.dispatchEvent(new Event('statechange')));expect(await page.evaluate(()=>__motionObserved)).toEqual([]);
 await page.evaluate(()=>{softwarePorts[0].state='connected';softwareAccess.dispatchEvent(new Event('statechange'));});await seen(page,'connect');
 await page.locator('[data-performance-midi-device]').selectOption('software-a');await resetMotion(page);await page.locator('[data-performance-midi-device]').selectOption('');await seen(page,'select');
 expect(await page.evaluate(()=>__motionObserved.includes('refuse'))).toBe(false);await exit(page);
});

test('generated software mapping drafts have local valid/no-op/invalid feedback without saving',async({page})=>{
 await generatedMidi(page);await page.locator('[data-performance-midi-device]').selectOption('software-a');await page.waitForTimeout(240);await resetMotion(page);
 const before=await page.evaluate(()=>a.getMusicalSnapshot());
 await page.locator('[data-performance-midi-action]').selectOption('start');await seen(page,'select');await resetMotion(page);
 await page.locator('[data-performance-midi-type]').selectOption('cc');await seen(page,'select');await resetMotion(page);
 await page.locator('[data-performance-midi-channel]').fill('2');await page.locator('[data-performance-midi-channel]').blur();await seen(page,'adjust');await resetMotion(page);
 await page.locator('[data-performance-midi-channel]').dispatchEvent('change');expect(await page.evaluate(()=>__motionObserved)).toEqual([]);
 await page.locator('[data-performance-midi-number]').fill('128');await page.locator('[data-performance-midi-number]').blur();await seen(page,'refuse');
 expect(await page.evaluate(()=>localStorage.getItem('metronominal.midi.input.v1:software-a'))).toBe(null);expect(await page.evaluate(()=>a.getMusicalSnapshot())).toEqual(before);await exit(page);
});

test('browser-enforced fullscreen refusal decorates truthful expanded fallback without native success',async({page,baseURL})=>{
 await page.route(new URL('/',baseURL).href,async route=>{const response=await route.fetch();await route.fulfill({response,headers:{...response.headers(),'permissions-policy':'fullscreen=()'}});});
 await page.context().grantPermissions(['local-network-access']);
 await ready(page);
 // Establish the independent native audio-unlock outcome before observing this
 // fullscreen-only action. Its legitimate ready cue is not fullscreen success.
 await page.keyboard.press('Shift');
 await expect.poll(()=>page.evaluate(async()=> (await import('/js/userInteraction.js')).default.audioContextInitialized)).toBe(true);
 expect(await page.evaluate(()=>a.getAudioContext().state)).toBe('running');
 await page.evaluate(()=>{__motionObserved=[];});
 await page.locator('#performance-view-btn').click();
 await expect(page.locator('[data-performance-status]')).toContainText('Fullscreen was denied');
 expect(await page.evaluate(()=>document.fullscreenElement)).toBe(null);
 await seen(page,'refuse');expect(await page.evaluate(()=>__motionObserved.includes('ready'))).toBe(false);
 await expect(page.locator('[data-performance-play]')).toBeEnabled();await exit(page);
});
