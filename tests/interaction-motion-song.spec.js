const {test,expect}=require('@playwright/test');
const motionPage=require('./motionTestPage.cjs');
const errors=new WeakMap();
test.beforeEach(({page})=>{const list=[];errors.set(page,list);page.on('pageerror',e=>list.push(e.message));});
test.afterEach(({page})=>expect(errors.get(page)).toEqual([]));
async function ready(page,info){
 await motionPage(page,info.config.metadata);
 await page.evaluate(async()=>{window.app=(await import('/js/appState.js')).default;window.songUI=(await import('/js/songController.js')).default;window.sync=await import('/js/webrtc.js');});
 await page.evaluate(()=>{
  // Generated musical data; genuine connected room/host comes from app startup.
  const bars=[{beats:4,subdivision:2,rests:[1],velocities:{0:.4,2:.8},beatSounds:{2:{mainBeatSound:{sound:'Synth Snare',settings:{}}}},beatSlices:{0:2},beatSliceAnchors:{0:0}},{beats:3,subdivision:1,rests:[2],velocities:{1:.6},beatSounds:{},beatSlices:{},beatSliceAnchors:{}},{beats:5,subdivision:1,rests:[3],velocities:{0:.9},beatSounds:{},beatSlices:{},beatSliceAnchors:{}}];
  // Section persistence materializes these documented sound defaults. Seed them
  // explicitly before the baseline; do not strip fields from equality checks.
  const sound=key=>({...app.getTracks()[0][key],settings:{...app.getTracks()[0][key].settings,allowOverlap:true,retrigger:true,reverse:false,highPassFrequency:20,lowPassFrequency:20000,probability:100}});
  app.updateTrack(0,{name:'Generated song drums',barSettings:bars,volume:.7,pitchShift:2,swing:12,mainBeatSound:sound('mainBeatSound'),subdivisionSound:sound('subdivisionSound')});
  app.setSong({version:2,enabled:true,name:'Generated song fixture',sections:[{name:'Alpha',startBar:0,tempo:100,repeats:1},{name:'Beta',startBar:1,tempo:120,repeats:2},{name:'Gamma',startBar:2,tempo:90,repeats:3}]});songUI.render();__motionObserved=[];
 });
 expect(await page.evaluate(()=>({host:window.isHost,role:sync.getSyncDiagnostics().role,playing:app.isPlaying()}))).toEqual({host:true,role:'host',playing:false});
 await expect(page.locator('#song-mode-panel')).toBeVisible();
}
const music=page=>page.evaluate(()=>app.getMusicalSnapshot());
const row=(page,i)=>page.locator(`.song-section-row[data-section-index="${i}"]`);
async function clear(page){await page.waitForTimeout(240);await page.evaluate(()=>{__motionObserved=[];});}
async function observed(page,kind){await expect.poll(()=>page.evaluate(k=>__motionObserved.includes(k),kind)).toBe(true);}
async function field(page,selector,value){const el=page.locator(selector);await el.fill(value);await el.press('Tab');}
async function observeGeometry(page){
 await page.evaluate(()=>{window.__songGeometry=[];new MutationObserver(records=>{for(const r of records)for(const n of r.addedNodes)if(n.nodeType===1&&n.hasAttribute('data-motion-kind')){const b=n.getBoundingClientRect(),s=getComputedStyle(n);__songGeometry.push({kind:n.dataset.motionKind,x:b.x,y:b.y,w:b.width,h:b.height,pointer:s.pointerEvents,animation:s.animationName,duration:s.animationDuration,hidden:n.closest('[aria-hidden=true]')!==null,inert:n.closest('[inert]')!==null,vw:innerWidth,vh:innerHeight});}}).observe(document.querySelector('[data-interaction-motion-root]'),{childList:true});});
}

test('moving a section start decorates its actual post-sort section, including duplicate names',async({page},info)=>{
 await ready(page,info);
 await page.evaluate(()=>{const song=app.getSong();song.sections[1].name='Duplicate';song.sections[2].name='Duplicate';app.setSong(song);songUI.render();window.__startTargets=[];new MutationObserver(rs=>{for(const r of rs)for(const n of r.addedNodes)if(n.nodeType===1&&n.dataset.motionKind==='section'){const x=parseFloat(n.style.left)+parseFloat(n.style.width)/2,y=parseFloat(n.style.top)+parseFloat(n.style.height)/2;const input=document.elementFromPoint(x,y)?.closest('[data-song-section-start]');if(input)__startTargets.push(input.dataset.songSectionStart);}}).observe(document.querySelector('[data-interaction-motion-root]'),{childList:true});});
 await page.locator('[data-song-section-start="2"]').selectOption('1');
 expect((await music(page)).song.sections.map(s=>s.startBar)).toEqual([0,0,1]);
 await expect.poll(()=>page.evaluate(()=>__startTargets)).toEqual(['1']);
});

test('accepted mounted song and section metadata show truthful feedback; unchanged change stays silent',async({page},info)=>{
 await ready(page,info);const before=await music(page);
 await field(page,'#song-name-input','Rehearsal Song');
 expect((await music(page)).song.name).toBe('Rehearsal Song');expect((await music(page)).Tracks).toEqual(before.Tracks);await observed(page,'rename');
 await clear(page);await page.locator('#song-name-input').dispatchEvent('change');expect(await page.evaluate(()=>__motionObserved)).toEqual([]);
 await field(page,'[data-song-section-name="0"]','Intro');expect((await music(page)).song.sections[0].name).toBe('Intro');await observed(page,'rename');
 await clear(page);await field(page,'[data-song-section-tempo="0"]','137');expect((await music(page)).song.sections[0].tempo).toBe(137);await observed(page,'tempo');
 await clear(page);await page.locator('[data-song-section-repeats="0"]').selectOption('4');expect((await music(page)).song.sections[0].repeats).toBe(4);await observed(page,'section');
 await clear(page);await page.locator('[data-song-section-start="1"]').selectOption('3');expect((await music(page)).song.sections[1].startBar).toBe(2);await observed(page,'section');
 expect((await music(page)).Tracks).toEqual(before.Tracks);expect(await page.evaluate(()=>app.isPlaying())).toBe(false);
 await page.screenshot({path:info.outputPath('mounted-song-metadata.png'),fullPage:true});
});
test('Update captures real section music, preserves live music and remains undoable; repeated identical capture is silent',async({page},info)=>{
 await ready(page,info);const before=await music(page);await row(page,0).locator('[data-song-section-action="update"]').click();
 const after=await music(page);expect(after.Tracks).toEqual(before.Tracks);expect(after.song.sections[0].tracks).toEqual(before.Tracks);expect(after.song.sections[0].tempo).toBe(before.tempo);await observed(page,'save');
 await clear(page);await row(page,0).locator('[data-song-section-action="update"]').click();expect(await music(page)).toEqual(after);expect(await page.evaluate(()=>__motionObserved)).toEqual([]);
 await page.locator('#rehearsal-tools-panel > summary').click();await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await music(page)).toEqual(before);
});
test('Apply loads actual saved rests velocity slices and sounds; identical reapply is not an applied success',async({page},info)=>{
 await ready(page,info);await row(page,0).locator('[data-song-section-action="update"]').click();const saved=await music(page);
 await page.evaluate(()=>{app.updateTrack(0,{name:'Changed live track',barSettings:app.getTracks()[0].barSettings.map(b=>({...b,rests:[],velocities:{},beatSounds:{},beatSlices:{},beatSliceAnchors:{}}))});app.setTempo(155);songUI.render();});
 await clear(page);await row(page,0).locator('[data-song-section-action="apply"]').click();
 await expect.poll(()=>page.evaluate(()=>app.getTempo())).toBe(saved.tempo);expect((await music(page)).Tracks).toEqual(saved.Tracks);expect((await music(page)).song).toEqual(saved.song);await observed(page,'load');expect(await page.evaluate(()=>app.isPlaying())).toBe(false);
 await clear(page);await row(page,0).locator('[data-song-section-action="apply"]').click();expect(await music(page)).toEqual(saved);expect(await page.evaluate(()=>__motionObserved)).toEqual([]);
});
test('Copy creates a detached exact snapshot without changing live music and can be undone',async({page},info)=>{
 await ready(page,info);await row(page,0).locator('[data-song-section-action="update"]').click();const before=await music(page);await clear(page);
 await row(page,0).locator('[data-song-section-action="copy"]').click();const after=await music(page);expect(after.Tracks).toEqual(before.Tracks);expect(after.song.sections).toEqual([before.song.sections[0],{...before.song.sections[0],name:'Alpha Copy',startBar:0},...before.song.sections.slice(1)]);await observed(page,'copy');
 await page.locator('#rehearsal-tools-panel > summary').click();await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await music(page)).toEqual(before);
});
for(const equalStarts of [false,true])test(`reorder uses existing ${equalStarts?'equal-start swap':'start-bar exchange'} semantics without changing whole saved snapshots`,async({page},info)=>{
 await ready(page,info);await row(page,0).locator('[data-song-section-action="update"]').click();if(equalStarts)await page.evaluate(()=>{const s=app.getSong();s.sections[1].startBar=0;app.setSong(s);songUI.render();});const before=await music(page);await clear(page);
 await row(page,0).locator('[data-song-section-action="move-down"]').click();const after=await music(page);const expected=structuredClone(before);expected.song.sections[0]={...before.song.sections[1],startBar:0};expected.song.sections[1]={...before.song.sections[0],startBar:before.song.sections[1].startBar};expect(after).toEqual(expected);await observed(page,'section');
 await clear(page);await row(page,1).locator('[data-song-section-action="move-up"]').click();expect(await music(page)).toEqual(before);await observed(page,'section');
});
test('Remove shows a visible surviving target only after actual deletion and preserves other music',async({page},info)=>{
 await ready(page,info);const before=await music(page);await row(page,1).locator('[data-song-section-action="remove"]').click();const expected=structuredClone(before);expected.song.sections.splice(1,1);expect(await music(page)).toEqual(expected);await observed(page,'remove');
 await page.locator('#rehearsal-tools-panel > summary').click();await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await music(page)).toEqual(before);
});
test('selection is a detached preview and Add and mode toggles report only their actual outcome',async({page},info)=>{
 await ready(page,info);const before=await music(page);await row(page,1).locator('.song-section-number').click();expect(await music(page)).toEqual(before);await expect(row(page,1)).toHaveClass(/is-selected/);await observed(page,'select');
 await clear(page);await row(page,1).locator('.song-section-number').click();expect(await music(page)).toEqual(before);expect(await page.evaluate(()=>__motionObserved)).toEqual([]);
 await page.locator('#add-song-section-btn').click();const added=await music(page);expect(added.Tracks).toEqual(before.Tracks);expect(added.song.sections).toHaveLength(4);expect(added.song.sections[1]).toMatchObject({name:'Section 4',startBar:0,repeats:1,tempo:before.tempo});await observed(page,'section');
 await clear(page);await page.locator('#song-mode-enabled').click();await expect(page.locator('#song-mode-panel')).toBeHidden();expect((await music(page)).song.enabled).toBe(false);await observed(page,'toggle');
 await clear(page);await page.locator('#song-mode-enabled').click();await expect(page.locator('#song-mode-panel')).toBeVisible();expect((await music(page)).song.enabled).toBe(true);await observed(page,'toggle');
});

for(const width of [390,1280])for(const reduced of [false,true])test(`completed metadata geometry ${width}px reduced=${reduced}: visible inert finite overlay, unchanged source hitbox and music`,async({page},info)=>{
 await page.setViewportSize({width,height:844});await page.emulateMedia({reducedMotion:reduced?'reduce':'no-preference'});await ready(page,info);await observeGeometry(page);
 const input=page.locator('#song-name-input');await input.scrollIntoViewIfNeeded();await input.focus();await page.waitForTimeout(250);const before=await music(page),rect=await input.boundingBox();
 await input.fill('Visible metadata specimen');await input.blur();await observed(page,'rename');
 const samples=await page.evaluate(()=>__songGeometry.filter(g=>g.kind==='rename'));expect(samples).toHaveLength(1);const g=samples[0];expect(g.w).toBeGreaterThan(0);expect(g.h).toBeGreaterThan(0);expect(g.x).toBeGreaterThanOrEqual(0);expect(g.y).toBeGreaterThanOrEqual(0);expect(g.x+g.w).toBeLessThanOrEqual(g.vw);expect(g.y+g.h).toBeLessThanOrEqual(g.vh);expect(g.pointer).toBe('none');expect(g.hidden).toBe(true);expect(g.inert).toBe(true);if(reduced)expect(g.animation).toBe('none');else{expect(g.animation).toBe('interaction-motion-adjust');expect(parseFloat(g.duration)).toBeLessThanOrEqual(.205);}
 expect(await input.boundingBox()).toEqual(rect);const expected=structuredClone(before);expected.song.name='Visible metadata specimen';expect(await music(page)).toEqual(expected);
 await info.attach('observed-overlay-geometry',{body:JSON.stringify({target:rect,observed:g}),contentType:'application/json'});await page.screenshot({path:info.outputPath('metadata-visible-specimen.png')});await page.waitForTimeout(260);await expect(page.locator('[data-interaction-motion-root] > *')).toHaveCount(0);
});
test('completed metadata real joined client refuses disabled edits without changing musical authority',async({page,browser},info)=>{
 await ready(page,info);await field(page,'#song-name-input','Real authority fixture');const hostMusic=await music(page);const context=await browser.newContext({serviceWorkers:'block'});const client=await context.newPage();const clientErrors=[];client.on('pageerror',e=>clientErrors.push(e.message));
 try{
  await require('./workflowTestPage.cjs')(client,info.config.metadata);await client.goto(page.url());await expect(client.locator('#share-btn')).toHaveClass(/(?:^|\s)connected(?:\s|$)/);await expect(page.locator('#n-of-connections')).toHaveText('(1)');await client.locator('#dismiss-connection-modal-btn').click();
  await client.evaluate(async()=>{window.app=(await import('/js/appState.js')).default;window.sync=await import('/js/webrtc.js');window.__motionObserved=[];new MutationObserver(records=>{for(const r of records)for(const n of r.addedNodes)if(n.nodeType===1&&n.hasAttribute('data-motion-kind'))__motionObserved.push(n.dataset.motionKind);}).observe(document.querySelector('[data-interaction-motion-root]'),{childList:true});});
  await expect.poll(()=>client.evaluate(()=>sync.getSyncDiagnostics().role)).toBe('client');expect(await client.evaluate(()=>window.isHost)).toBe(false);await expect.poll(()=>music(client)).toEqual(hostMusic);
  const input=client.locator('#song-name-input');await expect(input).toBeDisabled();await input.scrollIntoViewIfNeeded();await clear(client);const r=await input.boundingBox();await client.mouse.click(r.x+r.width/2,r.y+r.height/2);await observed(client,'refuse');expect(await music(client)).toEqual(hostMusic);expect(await music(page)).toEqual(hostMusic);expect(await client.evaluate(()=>__motionObserved.some(k=>['rename','confirm','save','load','queue'].includes(k)))).toBe(false);expect(clientErrors).toEqual([]);
 }finally{await context.close();}
});
test('completed metadata sanitized no-ops and disabled empty Apply/last Remove preserve exact music without accepted success',async({page},info)=>{
 await ready(page,info);await field(page,'[data-song-section-tempo="0"]','300');await clear(page);const before=await music(page);
 await field(page,'[data-song-section-tempo="0"]','400');expect(await music(page)).toEqual(before);expect(await page.evaluate(()=>__motionObserved)).toEqual([]);
 await page.evaluate(()=>{const s=app.getSong();s.sections=s.sections.slice(0,1);app.setSong(s);songUI.render();});const single=await music(page);
 for(const action of ['apply','remove']){const button=row(page,0).locator(`[data-song-section-action="${action}"]`);await button.scrollIntoViewIfNeeded();await clear(page);await expect(button).toBeDisabled();const r=await button.boundingBox();await page.mouse.click(r.x+r.width/2,r.y+r.height/2);expect(await music(page)).toEqual(single);await observed(page,'refuse');expect(await page.evaluate(()=>__motionObserved.some(k=>['save','load','remove','confirm','queue'].includes(k)))).toBe(false);}
});
