const {test,expect}=require('@playwright/test');
const motionPage=require('./motionTestPage.cjs');
const errors=new WeakMap();test.beforeEach(({page})=>{const list=[];errors.set(page,list);page.on('pageerror',e=>list.push(e.message));});test.afterEach(({page})=>expect(errors.get(page)).toEqual([]));
async function ready(page,metadata){
 await motionPage(page,metadata);
 await page.evaluate(async()=>{window.app=(await import('/js/appState.js')).default;window.hm=await import('/js/editHistory.js');window.at=await import('/js/arrangementTimeline.js');});
 await page.evaluate(()=>{
  // Replace the mounted controller rather than leaving two global next-section listeners.
  const mounted=document.querySelector('#rehearsal-timeline-root');
  if(mounted)at.initializeArrangementTimeline(mounted).destroy();
  // Actual generated musical fixtures, not API or authority responses.
  const bars=Array.from({length:6},(_,i)=>({beats:i+1,subdivision:1,rests:i===2?[0]:[],velocities:{0:.3+i*.1},beatSlices:{},beatSounds:{}}));
  app.updateTrack(0,{name:'Generated fixture track',barSettings:bars});
  const tracks=app.getMusicalSnapshot().Tracks;
  app.setSong({version:2,enabled:true,name:'Generated arrangement fixture',sections:[{name:'Alpha',startBar:0,tempo:100,repeats:1,tracks:structuredClone(tracks)},{name:'Beta',startBar:2,tempo:120,repeats:1,tracks:structuredClone(tracks)},{name:'Gamma',startBar:4,tempo:90,repeats:1,tracks:structuredClone(tracks)}]});
  const root=document.createElement('section');root.id='motion-arrangement-fixture';document.body.prepend(root);window.timeline=at.initializeArrangementTimeline(root);const historyRoot=document.createElement('aside');root.append(historyRoot);window.historyUI=hm.initializeHistoryControls(historyRoot);
 });
 await page.locator('#motion-arrangement-fixture').scrollIntoViewIfNeeded();
 // The first real gesture also resumes native audio and asynchronously emits
 // 'ready'. Complete it without editing music before observing timeline actions;
 // a startup delay cannot settle work that has not yet been triggered.
 const unlock=page.locator('#motion-arrangement-fixture').getByRole('checkbox',{name:'Queue live arrangement edits'});
 await page.evaluate(()=>{__motionObserved=[];});
 await unlock.focus();await unlock.press('Shift');
 await expect.poll(()=>page.evaluate(async()=>{const interaction=(await import('/js/userInteraction.js')).default;return interaction.audioContextInitialized&&app.getAudioContext()?.state==='running';})).toBe(true);
 await expect.poll(()=>page.evaluate(()=>__motionObserved.includes('ready'))).toBe(true);
 await expect(page.locator('[data-interaction-motion-root] > *')).toHaveCount(0);
 await page.evaluate(()=>{window.__motionObserved=[];window.__layoutCalls=[];const animate=Element.prototype.animate;Element.prototype.animate=function(frames,options){const result=animate.call(this,frames,options);if(this.matches('#motion-arrangement-fixture .arrangement-section')){const r=this.getBoundingClientRect();window.__layoutCalls.push({index:Number(this.dataset.section),frames,options,rect:{x:r.x,y:r.y,width:r.width,height:r.height}});}return result;};});
}
const root='#motion-arrangement-fixture';
const music=page=>page.evaluate(()=>app.getMusicalSnapshot());
async function drag(page){
 const handle=page.locator(root).getByRole('button',{name:'Drag Alpha to reorder',exact:true});
 const from=await handle.boundingBox(),to=await page.locator(root+' [data-section="1"]').boundingBox();
 await page.mouse.move(from.x+from.width/2,from.y+from.height/2);await page.mouse.down();
 return {handle,from,to};
}
test('stopped Go and next-section navigation reveal only successfully applied section music',async({page},info)=>{
 await ready(page,info.config.metadata);const before=await music(page);
 await page.locator(root).getByRole('button',{name:'Go to Beta',exact:true}).click();
 expect(await page.evaluate(()=>app.getTracks().map(t=>[t.currentBar,t.currentBeat]))).toEqual([[2,0]]);
 expect(await page.evaluate(()=>app.getTempo())).toBe(120);
 expect((await music(page)).song).toEqual(before.song);
 await expect.poll(()=>page.evaluate(()=>__motionObserved.includes('section'))).toBe(true);
 await page.waitForTimeout(260);await page.evaluate(()=>{__motionObserved=[];document.dispatchEvent(new CustomEvent('metronominal:section-next'));});
 expect(await page.evaluate(()=>app.getTracks()[0].currentBar)).toBe(4);
 expect(await page.evaluate(()=>app.getTempo())).toBe(90);
 await expect.poll(()=>page.evaluate(()=>__motionObserved.includes('section'))).toBe(true);
 await page.waitForTimeout(260);await page.evaluate(()=>{window.held=hm.beginEditTransaction('Foreign section editor');__motionObserved=[];});
 const blocked=await music(page),position=await page.evaluate(()=>app.getTracks()[0].currentBar);
 await page.locator(root).getByRole('button',{name:'Go to Alpha',exact:true}).click();
 expect(await music(page)).toEqual(blocked);expect(await page.evaluate(()=>app.getTracks()[0].currentBar)).toBe(position);
 expect(await page.evaluate(()=>__motionObserved.includes('section'))).toBe(false);
 await expect(page.locator(root+' [data-arrangement-status]')).toContainText(/history.*busy|history.*unavailable/i);
 await page.evaluate(()=>hm.cancelEditTransaction(held));
});
test('BPM and repeats acknowledge committed deltas, silence no-ops and refuse invalid or history-blocked drafts',async({page},info)=>{
 await ready(page,info.config.metadata);const before=await music(page);
 const bpm=page.locator(root).getByRole('spinbutton',{name:'Alpha BPM',exact:true});
 await bpm.fill('137');await bpm.dispatchEvent('change');
 const expected=structuredClone(before);expected.song.sections[0].tempo=137;
 expect(await music(page)).toEqual(expected);expect(await page.evaluate(()=>__motionObserved)).toEqual(['tempo']);
 await page.evaluate(()=>{__motionObserved=[];});await bpm.dispatchEvent('change');
 expect(await music(page)).toEqual(expected);expect(await page.evaluate(()=>__motionObserved)).toEqual([]);
 const repeats=page.locator(root).getByRole('spinbutton',{name:'Alpha repeats',exact:true});
 await repeats.fill('3');await repeats.dispatchEvent('change');expected.song.sections[0].repeats=3;
 expect(await music(page)).toEqual(expected);expect(await page.evaluate(()=>__motionObserved)).toEqual(['adjust']);
 await page.evaluate(()=>{__motionObserved=[];});await repeats.dispatchEvent('change');expect(await page.evaluate(()=>__motionObserved)).toEqual([]);
 for(const [input,value] of [[bpm,'301'],[repeats,'0'],[bpm,'21.5']]){
  await input.fill(value);await page.evaluate(()=>{__motionObserved=[];});await input.dispatchEvent('change');
  expect(await music(page)).toEqual(expected);await expect(input).toHaveValue(value);expect(await page.evaluate(()=>__motionObserved)).toEqual(['refuse']);
 }
 await page.evaluate(()=>{held=hm.beginEditTransaction('Foreign metadata edit');__motionObserved=[];});
 await repeats.fill('4');await page.evaluate(()=>{__motionObserved=[];});await repeats.dispatchEvent('change');expect(await music(page)).toEqual(expected);await expect(repeats).toHaveValue('4');
 expect(await page.evaluate(()=>__motionObserved)).toEqual(['refuse']);await expect(page.locator(root+' [data-arrangement-status]')).toContainText(/history.*busy|history.*unavailable/i);
 await page.evaluate(()=>hm.cancelEditTransaction(held));
});
test('live-queue toggle acknowledges only device-local preference deltas without changing music',async({page},info)=>{
 await ready(page,info.config.metadata);const before=await music(page);
 const live=page.locator(root).getByRole('checkbox',{name:'Queue live arrangement edits'});
 await live.check();expect(await page.evaluate(()=>__motionObserved)).toEqual(['toggle']);expect(await music(page)).toEqual(before);
 await page.evaluate(()=>{__motionObserved=[];});await live.dispatchEvent('change');expect(await page.evaluate(()=>__motionObserved)).toEqual([]);
 await live.uncheck();expect(await page.evaluate(()=>__motionObserved)).toEqual(['toggle']);expect(await music(page)).toEqual(before);
});
test('failed live metadata queue retains its draft and discard acknowledges only local draft removal',async({page},info)=>{
 await ready(page,info.config.metadata);await expect(page.locator('#sync-quality')).toHaveText(/good/i);
 await page.locator('.start-stop-btn').click();await expect.poll(()=>page.evaluate(()=>app.isPlaying())).toBe(true);
 try{
  await page.locator(root).getByRole('checkbox',{name:'Queue live arrangement edits'}).check();
  const before=(await music(page)).song;
  await page.evaluate(()=>{const send=WebSocket.prototype.send;window.restoreFailedQueue=()=>{WebSocket.prototype.send=send;};WebSocket.prototype.send=function(raw,...args){if(JSON.parse(raw).type==='song-change-command')throw new Error('Injected outbound queue failure');return send.call(this,raw,...args);};__motionObserved=[];});
  const bpm=page.locator(root).getByRole('spinbutton',{name:'Alpha BPM',exact:true});await bpm.fill('141');await bpm.dispatchEvent('change');
  await expect(page.locator(root+' [data-pending]')).toHaveText('Rejected draft retained · not queued');await expect(bpm).toHaveValue('141');
  expect((await music(page)).song).toEqual(before);expect(await page.evaluate(()=>__motionObserved)).toEqual(['refuse']);
  await page.evaluate(()=>{restoreFailedQueue();__motionObserved=[];});
  const discard=page.locator(root).getByRole('button',{name:'Discard rejected draft',exact:true});await discard.click();
  await expect(discard).toBeHidden();await expect(bpm).toHaveValue('100');expect((await music(page)).song).toEqual(before);
  expect(await page.evaluate(()=>__motionObserved)).toEqual(['cancel']);
 }finally{await page.evaluate(()=>window.restoreFailedQueue?.());if(await page.evaluate(()=>app.isPlaying()))await page.locator('.start-stop-btn').click();}
});
test('repeated joined Go never credits a pre-existing pending revision to a new request',async({page},info)=>{
 await ready(page,info.config.metadata);await expect(page.locator('#sync-quality')).toHaveText(/good/i);
 await page.evaluate(async()=>{window.transport=await import('/js/practiceTransport.js');});
 try {
  await page.locator('.start-stop-btn').click();await expect.poll(()=>page.evaluate(()=>app.isPlaying())).toBe(true);
  await page.locator(root).getByRole('button',{name:'Go to Gamma',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>transport.getPendingSongChange()?.revision ?? null)).not.toBeNull();
  const state=await page.evaluate(()=>{const first=transport.getPendingSongChange();const send=WebSocket.prototype.send;window.releaseRepeated=[];WebSocket.prototype.send=function(raw,...args){let message;try{message=JSON.parse(raw);}catch{}if(message?.type==='song-change-command'){releaseRepeated.push(()=>send.call(this,raw,...args));return;}return send.call(this,raw,...args);};window.restoreRepeated=()=>{WebSocket.prototype.send=send;releaseRepeated.splice(0);};__motionObserved=[];document.querySelector('#motion-arrangement-fixture [data-section="2"] .arrangement-actions button:last-child').click();return {revision:first.revision,held:releaseRepeated.length,pending:transport.getPendingSongChange()?.revision};});
  expect(state.held).toBe(1);expect(state.pending).toBe(state.revision);
  await expect.poll(()=>page.evaluate(()=>__motionObserved.includes('pending'))).toBe(true);
  expect(await page.evaluate(()=>__motionObserved.some(kind=>kind==='queue'||kind==='section'))).toBe(false);
 } finally {await page.evaluate(()=>window.restoreRepeated?.());if(await page.evaluate(()=>app.isPlaying())){await page.locator('.start-stop-btn').click();await expect.poll(()=>page.evaluate(()=>app.isPlaying())).toBe(false);}}
});

test('joined cancellation stays pending-only until the real server removes the queue',async({page},info)=>{
 await ready(page,info.config.metadata);await expect(page.locator('#sync-quality')).toHaveText(/good/i);await page.evaluate(async()=>{window.transport=await import('/js/practiceTransport.js');});
 await page.locator('.start-stop-btn').click();await expect.poll(()=>page.evaluate(()=>app.isPlaying())).toBe(true);
 try{
  await page.locator(root).getByRole('button',{name:'Go to Gamma',exact:true}).click();await expect.poll(()=>page.evaluate(()=>Boolean(transport.getPendingSongChange()))).toBe(true);
  const revision=await page.evaluate(()=>transport.getPendingSongChange().revision);
  await page.evaluate(()=>{const send=WebSocket.prototype.send;window.heldCancel=[];WebSocket.prototype.send=function(raw,...args){const message=JSON.parse(raw);if(message.type==='song-change-command'&&message.change===null){heldCancel.push(()=>send.call(this,raw,...args));return;}return send.call(this,raw,...args);};window.releaseCancel=()=>{WebSocket.prototype.send=send;for(const forward of heldCancel.splice(0))forward();};__motionObserved=[];});
  await page.locator(root).getByRole('button',{name:'Cancel queued arrangement',exact:true}).click();
  expect(await page.evaluate(()=>heldCancel.length)).toBe(1);expect(await page.evaluate(()=>transport.getPendingSongChange()?.revision)).toBe(revision);expect(await page.evaluate(()=>__motionObserved)).toEqual(['pending']);
  await page.evaluate(()=>releaseCancel());await expect.poll(()=>page.evaluate(()=>transport.getPendingSongChange())).toBeNull();
  expect(await page.evaluate(()=>__motionObserved)).toEqual(['pending']);
 }finally{await page.evaluate(()=>window.releaseCancel?.());if(await page.evaluate(()=>app.isPlaying())){await page.locator('.start-stop-btn').click();await expect.poll(()=>page.evaluate(()=>app.isPlaying())).toBe(false);}}
});
async function soloPlayback(page){
 await page.evaluate(async()=>{
  window.room=await import('/js/webrtc.js');room.disconnect();window.engine=(await import('/js/metronomeEngine.js')).default;window.transport=await import('/js/practiceTransport.js');
  const song=app.getSong();for(const [i,section] of song.sections.entries()){section.repeats=16;for(const track of section.tracks)track.mainBeatSound={sound:'Synth Sine',settings:{frequency:330+i*110}};}
  app.setSong(song);app.updateTrack(0,{mainBeatSound:{sound:'Synth Sine',settings:{frequency:330}}});timeline.render();
  window.nativeNotes=[];window.commits=[];document.addEventListener('songchangecommitted',event=>commits.push(event.detail));
  const ctx=app.getAudioContext(),create=ctx.createOscillator.bind(ctx);ctx.createOscillator=(...args)=>{const source=create(...args),start=source.start.bind(source),set=source.frequency.setValueAtTime.bind(source.frequency);let frequency=null;source.frequency.setValueAtTime=(value,time)=>{frequency=value;return set(value,time);};source.start=(time,...rest)=>{nativeNotes.push({time,frequency:frequency??source.frequency.value});return start(time,...rest);};return source;};
  await engine.scheduleStart(Date.now()+200);
 });
 await expect.poll(()=>page.evaluate(()=>app.isPlaying()&&nativeNotes.some(n=>n.frequency===330))).toBe(true);
 await page.evaluate(()=>{__motionObserved=[];});
}
test('solo Go credits only the owned queue revision after real worker and native audio boundary commit',async({page},info)=>{
 await ready(page,info.config.metadata);await soloPlayback(page);
 try{
  const before=(await music(page)).song;await page.locator(root).getByRole('button',{name:'Go to Gamma',exact:true}).click();
  const pending=await page.evaluate(()=>transport.getPendingSongChange());expect(pending).not.toBeNull();
  expect(await page.evaluate(()=>__motionObserved)).toContain('queue');expect(await page.evaluate(()=>__motionObserved)).not.toContain('section');
  expect((await music(page)).song).toEqual(before);
  await expect.poll(()=>page.evaluate(()=>commits.length)).toBe(1);await expect.poll(()=>page.evaluate(()=>__motionObserved.includes('section'))).toBe(true);
  await expect.poll(()=>page.evaluate(()=>nativeNotes.some(n=>n.frequency===550))).toBe(true);
  const proof=await page.evaluate(()=>({commit:commits[0],notes:nativeNotes,pending:transport.getPendingSongChange(),tempo:app.getTempo()}));
  expect(proof.commit.revision).toBe(pending.revision);expect(proof.pending).toBeNull();expect(proof.tempo).toBe(90);
  expect(proof.notes.some(n=>n.frequency===550&&Math.abs(n.time-proof.commit.audioTime)<.03)).toBe(true);
  expect(proof.notes.filter(n=>n.frequency===330&&n.time>proof.commit.audioTime+.03)).toEqual([]);
 }finally{await page.evaluate(()=>engine.cancelPlayback());}
});
for(const [label,value,field,kind]of [['BPM','137','tempo','tempo'],['repeats','3','repeats','adjust']])test('solo live '+label+' edit distinguishes no-op, accepted queue and real scheduler application',async({page},info)=>{
 await ready(page,info.config.metadata);await soloPlayback(page);
 try{
  await page.locator(root).getByRole('checkbox',{name:'Queue live arrangement edits'}).check();await page.evaluate(()=>{__motionObserved=[];});
  const input=page.locator(root).getByRole('spinbutton',{name:'Alpha '+label,exact:true}),before=(await music(page)).song;
  await input.dispatchEvent('change');expect(await page.evaluate(()=>transport.getPendingSongChange())).toBeNull();expect(await page.evaluate(()=>__motionObserved)).toEqual([]);
  await input.fill(value);await input.dispatchEvent('change');const pending=await page.evaluate(()=>transport.getPendingSongChange());expect(pending.song.sections[0][field]).toBe(Number(value));
  expect((await music(page)).song).toEqual(before);expect(await page.evaluate(()=>__motionObserved)).toEqual(['queue']);
  await expect.poll(()=>page.evaluate(()=>commits.length)).toBe(1);expect(await page.evaluate(()=>commits[0].revision)).toBe(pending.revision);
  expect((await music(page)).song.sections[0][field]).toBe(Number(value));expect(await page.evaluate(()=>__motionObserved)).toEqual(['queue','section']);
  expect(await page.evaluate(kind=>__motionObserved.includes(kind),kind)).toBe(false);
 }finally{await page.evaluate(()=>engine.cancelPlayback());}
});
test('solo cancellation acknowledges actual queue removal and prevents later scheduler application',async({page},info)=>{
 await ready(page,info.config.metadata);await soloPlayback(page);
 try{
  const before=(await music(page)).song;await page.locator(root).getByRole('button',{name:'Go to Gamma',exact:true}).click();
  const pending=await page.evaluate(()=>transport.getPendingSongChange());expect(pending).not.toBeNull();
  await page.evaluate(()=>{__motionObserved=[];});await page.locator(root).getByRole('button',{name:'Cancel queued arrangement',exact:true}).click();
  expect(await page.evaluate(()=>transport.getPendingSongChange())).toBeNull();expect(await page.evaluate(()=>__motionObserved)).toEqual(['cancel']);
  await expect.poll(()=>page.evaluate(time=>app.getAudioContext().currentTime>time+.2,pending.audioTime)).toBe(true);
  expect(await page.evaluate(()=>commits)).toEqual([]);expect(await page.evaluate(()=>nativeNotes.some(n=>n.frequency===550))).toBe(false);
  expect((await music(page)).song).toEqual(before);expect(await page.evaluate(()=>__motionObserved.includes('section'))).toBe(false);
 }finally{await page.evaluate(()=>engine.cancelPlayback());}
});
test('live Go distinguishes an outbound request, authoritative queue and real scheduler application',async({page},info)=>{
 await ready(page,info.config.metadata);
 await expect(page.locator('#sync-quality')).toHaveText(/good/i);
 await page.evaluate(async()=>{
  window.transport=await import('/js/practiceTransport.js');
  window.commits=[];document.addEventListener('songchangecommitted',event=>commits.push({...event.detail,bar:app.getTracks()[0].currentBar,tempo:app.getTempo()}));
  const send=WebSocket.prototype.send;window.heldSong=[];
  WebSocket.prototype.send=function(raw,...args){let message;try{message=JSON.parse(raw);}catch{}if(message?.type==='song-change-command'){heldSong.push(()=>send.call(this,raw,...args));return;}return send.call(this,raw,...args);};
  window.releaseSong=()=>{WebSocket.prototype.send=send;for(const forward of heldSong.splice(0))forward();};
 });
 try{
  await page.locator('.start-stop-btn').click();await expect.poll(()=>page.evaluate(()=>app.isPlaying())).toBe(true);
  await page.locator(root).scrollIntoViewIfNeeded();await page.evaluate(()=>{__motionObserved=[];});
  const before=await music(page);
  await page.locator(root).getByRole('button',{name:'Go to Gamma',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>heldSong.length)).toBe(1);
  await expect(page.locator(root+' [data-pending]')).toContainText('Awaiting server authority');
  await expect.poll(()=>page.evaluate(()=>__motionObserved.includes('pending'))).toBe(true);
  expect(await page.evaluate(()=>transport.getPendingSongChange())).toBeNull();
  expect((await music(page)).song).toEqual(before.song);
  expect(await page.evaluate(()=>__motionObserved.filter(k=>['queue','section','confirm'].includes(k)))).toEqual([]);
  await page.evaluate(()=>releaseSong());
  await expect.poll(()=>page.evaluate(()=>transport.getPendingSongChange()?.revision ?? null)).not.toBeNull();
  await expect.poll(()=>page.evaluate(()=>commits.length)).toBe(1);
  expect(await page.evaluate(()=>commits[0])).toMatchObject({bar:4,tempo:90});
  expect(await page.evaluate(()=>transport.getPendingSongChange())).toBeNull();
  const kinds=await page.evaluate(()=>__motionObserved);
  // A real server broadcast and scheduler commit are observed above, but the
  // protocol has no request ID to attribute those events to this click.
  expect(kinds).toContain('pending');expect(kinds).not.toContain('queue');expect(kinds).not.toContain('section');
  expect((await music(page)).song).toEqual(before.song);
 }finally{await page.evaluate(()=>releaseSong());if(await page.evaluate(()=>app.isPlaying())){await page.locator('.start-stop-btn').click();await expect.poll(()=>page.evaluate(()=>app.isPlaying())).toBe(false);}}
});
for(const reducedMotion of ['no-preference','reduce'])test('magnetic reorder target feedback follows target changes without moving authoritative hitboxes with '+reducedMotion,async({page},info)=>{
 await page.emulateMedia({reducedMotion});await ready(page,info.config.metadata);const before=await music(page);
 const cards=page.locator(root+' .arrangement-section');
 const geometry=await cards.evaluateAll(nodes=>nodes.map(n=>({rect:n.getBoundingClientRect().toJSON(),style:n.getAttribute('style')})));
 const {from,to}=await drag(page);await page.mouse.move(to.x+to.width/2,from.y+from.height/2);
 expect(await page.evaluate(()=>__motionObserved.filter(k=>k==='select'))).toEqual(['select']);
 const effect=await page.locator('[data-motion-kind="select"]').evaluate(el=>({left:el.style.left,top:el.style.top,width:el.style.width,height:el.style.height,pointer:getComputedStyle(el).pointerEvents,animation:getComputedStyle(el).animationName,durations:el.getAnimations().map(a=>a.effect.getTiming().duration)}));
 const target=await page.locator(root+' [data-section="1"] .arrangement-handle').first().evaluate(el=>{const r=el.getBoundingClientRect(),s=document.createElement('i').style;for(const [key,value]of Object.entries({left:r.x,top:r.y,width:r.width,height:r.height}))s[key]=value+'px';return{left:s.left,top:s.top,width:s.width,height:s.height};});
 expect(effect).toMatchObject({...target,pointer:'none'});for(const duration of effect.durations)expect(duration).toBeLessThanOrEqual(200);if(reducedMotion==='reduce')expect(effect.animation).toBe('none');
 await page.mouse.move(to.x+to.width/2+3,from.y+from.height/2);expect(await page.evaluate(()=>__motionObserved.filter(k=>k==='select'))).toEqual(['select']);
 expect(await cards.evaluateAll(nodes=>nodes.map(n=>({rect:n.getBoundingClientRect().toJSON(),style:n.getAttribute('style')})))).toEqual(geometry);
 expect(await music(page)).toEqual(before);expect(await page.evaluate(()=>__motionObserved.includes('confirm'))).toBe(false);
 await page.keyboard.press('Escape');await page.mouse.up();expect(await music(page)).toEqual(before);await expect(page.locator('[data-motion-kind="drag"]')).toHaveCount(0);await expect(page.locator('[data-motion-kind="select"]')).toHaveCount(0);
});
test('Move ghost follows pointer without moving source hitboxes and commits whole sections only on release',async({page},info)=>{
 await ready(page,info.project.metadata||info.config.metadata);const before=await music(page);
 const {handle,from,to}=await drag(page);
 await expect(page.locator('[data-motion-kind="drag"]')).toHaveCount(1);
 const sourceCard=page.locator(root+' [data-section="0"]');const sourceBefore=await sourceCard.boundingBox();
 await page.mouse.move(to.x+to.width/2,from.y+from.height/2);
 const sourceAfter=await sourceCard.boundingBox();expect(sourceAfter).toEqual(sourceBefore);
 const geometry=await page.locator('[data-motion-kind="drag"]').evaluate(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,pointer:getComputedStyle(el).pointerEvents,hidden:el.closest('[aria-hidden="true"]').getAttribute('aria-hidden'),inert:el.closest('[inert]')!==null,vw:innerWidth,vh:innerHeight};});
 expect(geometry.x).toBeGreaterThan(from.x+30);expect(geometry.x).toBeLessThan(geometry.vw);expect(geometry.y).toBeGreaterThanOrEqual(0);expect(geometry.y).toBeLessThan(geometry.vh);expect(geometry.w).toBeGreaterThan(0);expect(geometry.h).toBeGreaterThan(0);expect(geometry.pointer).toBe('none');expect(geometry.hidden).toBe('true');expect(geometry.inert).toBe(true);
 expect(await music(page)).toEqual(before);await page.mouse.up();
 expect((await music(page)).song.sections.map(s=>s.name)).toEqual(['Beta','Alpha','Gamma']);
 expect((await music(page)).Tracks[0].barSettings).toEqual([2,3,0,1,4,5].map(i=>before.Tracks[0].barSettings[i]));
 for(const [destination,source] of [[0,1],[1,0],[2,2]])expect((await music(page)).song.sections[destination].tracks[0].barSettings).toEqual([2,3,0,1,4,5].map(i=>before.song.sections[source].tracks[0].barSettings[i]));
 await expect.poll(()=>page.evaluate(()=>__motionObserved.includes('confirm'))).toBe(true);
 await expect(page.locator('[data-motion-kind="drag"]')).toHaveCount(0);
 await page.waitForTimeout(260);await expect(page.locator('[data-interaction-motion-root] > *')).toHaveCount(0);
 expect(await page.evaluate(()=>historyUI.undo())).toBe(true);expect(await music(page)).toEqual(before);
});
test('keyboard Later Earlier and Length show accepted outcomes with true permutation reflow',async({page},info)=>{
 await ready(page,info.config.metadata);const before=await music(page);
 const original=await page.locator(root+' .arrangement-section').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y};}));
 const handle=page.locator(root).getByRole('button',{name:'Drag Alpha to reorder',exact:true});await handle.focus();await handle.press('ArrowRight');await expect(handle).toBeFocused();
 expect((await music(page)).song.sections.map(s=>s.name)).toEqual(['Beta','Alpha','Gamma']);
 await expect.poll(()=>page.evaluate(()=>__motionObserved.includes('confirm'))).toBe(true);
 const calls=await page.evaluate(()=>__layoutCalls);expect(calls.length).toBeGreaterThanOrEqual(2);
 for(const [index,old] of [[0,1],[1,0]]){const c=calls.find(c=>c.index===index);expect(c).toBeTruthy();const translation=c.frames[0].transform.match(/translate3d\(([-.\d]+)px, ([-.\d]+)px/);expect(translation).toBeTruthy();expect(Number(translation[1])).toBeCloseTo(original[old].x-original[index].x,0);expect(c.rect.x).toBeCloseTo(original[old].x,0);expect(c.rect.y).toBeCloseTo(original[old].y,0);expect(c.rect.width).toBeGreaterThan(0);expect(c.options.duration).toBeLessThanOrEqual(180);}
 await page.waitForTimeout(260);await page.evaluate(()=>{__motionObserved=[];});
 const earlier=page.locator(root).getByRole('button',{name:'Move Alpha earlier',exact:true});await earlier.focus();await earlier.press('Enter');expect((await music(page)).song.sections.map(s=>s.name)).toEqual(['Alpha','Beta','Gamma']);
 await expect.poll(()=>page.evaluate(()=>__motionObserved.includes('confirm'))).toBe(true);
});
test('keyboard Length growth emits trim only after actual copied bars and is undoable',async({page},info)=>{
 await ready(page,info.config.metadata);const before=await music(page);
 const length=page.locator(root).getByRole('button',{name:'Drag Alpha length',exact:true});await length.focus();await length.press('ArrowRight');await expect(length).toBeFocused();
 expect((await music(page)).Tracks[0].barSettings).toEqual([0,1,1,2,3,4,5].map(i=>before.Tracks[0].barSettings[i]));
 await expect.poll(()=>page.evaluate(()=>__motionObserved.includes('trim'))).toBe(true);
 expect(await page.evaluate(()=>historyUI.undo())).toBe(true);expect(await music(page)).toEqual(before);
});
test('inclusive reversed A B endpoints disable and Escape cancellation have visible truthful feedback',async({page},info)=>{
 await ready(page,info.config.metadata);
 const a=page.locator(root).getByRole('button',{name:'Select timeline bar 5',exact:true});
 const sample=await a.evaluate(el=>{el.click();const e=document.querySelector('[data-motion-kind="loop"]');if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,vh:innerHeight,vw:innerWidth};});
 expect(sample).not.toBeNull();expect(sample.w).toBeGreaterThan(0);expect(sample.x).toBeGreaterThanOrEqual(0);expect(sample.x+sample.w).toBeLessThanOrEqual(sample.vw);expect(sample.y+sample.h).toBeLessThanOrEqual(sample.vh);
 expect(await page.evaluate(()=>app.getAbLoop().enabled)).toBe(false);
 await page.locator(root).getByRole('button',{name:'Select timeline bar 2',exact:true}).click();expect(await page.evaluate(()=>app.getAbLoop())).toMatchObject({enabled:true,startBar:1,endBar:4});
 for(let i=2;i<=5;i++)await expect(page.locator(root).getByRole('button',{name:`Select timeline bar ${i}`,exact:true})).toHaveAttribute('aria-pressed','true');
 await page.waitForTimeout(260);await page.evaluate(()=>{__motionObserved=[];});
 await page.locator(root).getByRole('button',{name:'Disable timeline loop',exact:true}).click();expect(await page.evaluate(()=>app.getAbLoop().enabled)).toBe(false);await expect.poll(()=>page.evaluate(()=>__motionObserved.includes('toggle'))).toBe(true);
 await page.locator(root).getByRole('button',{name:'Select timeline bar 3',exact:true}).click();const before=await music(page);await page.waitForTimeout(260);await page.evaluate(()=>{__motionObserved=[];});await page.keyboard.press('Escape');expect(await music(page)).toEqual(before);await expect.poll(()=>page.evaluate(()=>__motionObserved.includes('cancel'))).toBe(true);
 await page.locator(root).getByRole('button',{name:'Select timeline bar 4',exact:true}).click();expect(await page.evaluate(()=>app.getAbLoop().enabled)).toBe(false);
});
test('drag Escape pointer cancellation no-op and history refusal never show accepted success',async({page},info)=>{
 await ready(page,info.config.metadata);const before=await music(page);
 for(const cancel of ['Escape','pointercancel','lostpointercapture','historyboundary']){
  const {from,to}=await drag(page);await page.mouse.move(to.x+to.width/2,from.y+from.height/2);
  if(cancel==='Escape')await page.keyboard.press('Escape');else if(cancel==='lostpointercapture')await page.locator(root).getByRole('button',{name:'Drag Alpha to reorder',exact:true}).evaluate(el=>el.dispatchEvent(new Event('lostpointercapture')));else await page.evaluate(name=>document.dispatchEvent(new Event(name,{bubbles:true})),cancel);
  await page.mouse.up();expect(await music(page)).toEqual(before);await expect(page.locator('[data-motion-kind="drag"]')).toHaveCount(0);
 }
 await page.evaluate(()=>{__motionObserved=[];});await drag(page);await page.mouse.up();expect(await music(page)).toEqual(before);expect(await page.evaluate(()=>__motionObserved.includes('confirm'))).toBe(false);
 await page.evaluate(()=>{window.held=hm.beginEditTransaction('Actual foreign editor');__motionObserved=[];});
 await page.locator(root).getByRole('button',{name:'Move Alpha later',exact:true}).click();expect(await music(page)).toEqual(before);expect(await page.evaluate(()=>__motionObserved.includes('confirm'))).toBe(false);await expect(page.locator(root+' [data-arrangement-status]')).toContainText(/history.*busy|history.*unavailable/i);await page.evaluate(()=>hm.cancelEditTransaction(held));
});
test('duplicate names reflow by known permutation and length refusals keep exact music and drafts',async({page},info)=>{
 await ready(page,info.config.metadata);
 await page.evaluate(()=>{const song=app.getSong();song.sections.forEach(s=>s.name='Same');app.setSong(song);timeline.render();__layoutCalls=[];__motionObserved=[];});
 const before=await music(page);const positions=await page.locator(root+' .arrangement-section').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().x));
 await page.locator(root+' [data-section="1"]').getByRole('button',{name:'Move Same earlier',exact:true}).click();
 expect((await music(page)).song.sections.map(s=>s.tempo)).toEqual([120,100,90]);
 const calls=await page.evaluate(()=>__layoutCalls);for(const [index,old] of [[0,1],[1,0]]){const c=calls.find(c=>c.index===index);expect(c).toBeTruthy();expect(c.rect.x).toBeCloseTo(positions[old],0);}
 expect(await page.evaluate(()=>historyUI.undo())).toBe(true);expect(await music(page)).toEqual(before);
 await page.waitForTimeout(260);await page.evaluate(()=>{__motionObserved=[];__layoutCalls=[];});
 const input=page.locator(root+' [data-section="0"]').getByRole('spinbutton',{name:'Same length in bars',exact:true});
 for(const value of ['2','1','1.5','64']){await input.fill(value);await input.press('Tab');expect(await music(page)).toEqual(before);await expect(input).toHaveValue(value);}
 expect(await page.evaluate(()=>__motionObserved.some(k=>k==='confirm'||k==='trim'))).toBe(false);expect(await page.evaluate(()=>__layoutCalls)).toEqual([]);
});
test('reduced motion preserves real edits suppresses reflow and all decoration cleans after viewport invalidation',async({page},info)=>{
 await page.emulateMedia({reducedMotion:'reduce'});await ready(page,info.config.metadata);
 const before=await music(page);const {from,to}=await drag(page);await page.mouse.move(to.x+to.width/2,from.y+from.height/2);await page.mouse.up();expect((await music(page)).song.sections.map(s=>s.name)).toEqual(['Beta','Alpha','Gamma']);expect(await page.evaluate(()=>__layoutCalls.length)).toBe(0);
 await page.waitForTimeout(260);await expect(page.locator('[data-interaction-motion-root] > *')).toHaveCount(0);expect(await page.evaluate(()=>historyUI.undo())).toBe(true);expect(await music(page)).toEqual(before);
 await drag(page);await page.evaluate(()=>window.dispatchEvent(new Event('resize')));await expect(page.locator('[data-motion-kind="drag"]')).toHaveCount(0);await page.keyboard.press('Escape');await page.mouse.up();expect(await music(page)).toEqual(before);
 await drag(page);await page.evaluate(()=>timeline.destroy());await expect(page.locator('[data-motion-kind="drag"]')).toHaveCount(0);await page.mouse.up();expect(await music(page)).toEqual(before);
});
