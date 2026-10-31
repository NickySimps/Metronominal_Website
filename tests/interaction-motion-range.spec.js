const {test,expect}=require('@playwright/test');
const motionPage=require('./motionTestPage.cjs');
const root='#rehearsal-range-root';
const errors=new WeakMap();
test.beforeEach(({page})=>{const list=[];errors.set(page,list);page.on('pageerror',e=>list.push(e.message));});
test.afterEach(({page})=>expect(errors.get(page)).toEqual([]));
async function ready(page,metadata){
 await motionPage(page,metadata);
 const dismiss=page.locator('#dismiss-connection-modal-btn');if(await dismiss.isVisible())await dismiss.click();
 await page.locator('#rehearsal-tools-panel > summary').click();
 await page.evaluate(async()=>{window.app=(await import('/js/appState.js')).default;window.hm=await import('/js/editHistory.js');window.range=(await import('/js/rangeEditor.js')).initializeRangeEditor(document.querySelector('#rehearsal-range-root'));});
 await page.locator(root).scrollIntoViewIfNeeded();
 await reset(page);
}
async function reset(page){await page.waitForTimeout(260);await page.evaluate(()=>{__motionObserved=[];});}
const music=page=>page.evaluate(()=>app.getMusicalSnapshot());
const action=(page,name)=>page.locator(root+` [data-action="${name}"]`);
async function observed(page,kind){await expect.poll(()=>page.evaluate(kind=>__motionObserved.includes(kind),kind)).toBe(true);}
async function geometryClick(locator,selector){
 await locator.scrollIntoViewIfNeeded();
 return locator.evaluate((el,selector)=>{
  const before=el.getBoundingClientRect();const transform=getComputedStyle(el).transform;el.click();
  const after=el.getBoundingClientRect(),motion=document.querySelector(selector);if(!motion)return null;
  const r=motion.getBoundingClientRect();return {before:{x:before.x,y:before.y,w:before.width,h:before.height},after:{x:after.x,y:after.y,w:after.width,h:after.height},transform,afterTransform:getComputedStyle(el).transform,x:r.x,y:r.y,w:r.width,h:r.height,vw:innerWidth,vh:innerHeight,pointer:getComputedStyle(motion).pointerEvents,hidden:!!motion.closest('[aria-hidden="true"]'),inert:!!motion.closest('[inert]'),animations:motion.getAnimations().map(a=>a.effect.getComputedTiming().endTime)};
 },selector);
}
function visible(sample){expect(sample).not.toBeNull();expect(sample.w).toBeGreaterThan(0);expect(sample.h).toBeGreaterThan(0);expect(sample.x).toBeGreaterThanOrEqual(0);expect(sample.y).toBeGreaterThanOrEqual(0);expect(sample.x+sample.w).toBeLessThanOrEqual(sample.vw);expect(sample.y+sample.h).toBeLessThanOrEqual(sample.vh);expect(sample.pointer).toBe('none');expect(sample.hidden).toBe(true);expect(sample.inert).toBe(true);for(const duration of sample.animations){expect(Number.isFinite(duration)).toBe(true);expect(duration).toBeLessThanOrEqual(200);}}
test('range configuration and actual endpoints decorate without moving original beats or changing music',async({page},info)=>{
 await ready(page,info.config.metadata);const before=await music(page);
 await page.locator(root+' [data-field="endBeat"]').fill('3');await observed(page,'range');
 await reset(page);visible(await geometryClick(action(page,'pick'),'[data-motion-kind="open"]'));
 await expect(action(page,'pick')).toHaveAttribute('aria-pressed','true');
 const beat=index=>page.locator(`.bar-visual[data-container-index="0"][data-bar-index="0"] .beat-square[data-beat-index="${index}"]`);
 for(const index of [3,1]){await reset(page);const sample=await geometryClick(beat(index),'[data-motion-kind="range"]');visible(sample);expect(sample.after).toEqual(sample.before);expect(sample.afterTransform).toBe(sample.transform);expect(await music(page)).toEqual(before);}
 await expect(page.locator(root+' [data-field="startBeat"]')).toHaveValue('2');await expect(page.locator(root+' [data-field="endBeat"]')).toHaveValue('4');await expect(action(page,'pick')).toHaveAttribute('aria-pressed','false');
 await reset(page);await action(page,'pick').click();await reset(page);visible(await geometryClick(action(page,'stop-pick'),'[data-motion-kind="cancel"]'));
 expect(await music(page)).toEqual(before);
 await page.waitForTimeout(300);await expect(page.locator('[data-interaction-motion-root] > *')).toHaveCount(0);
 await page.screenshot({path:info.outputPath('range-pick-clean.png')});
});

test('completed keyboard range sweeps the whole logical selection without legacy painting',async({page},info)=>{
 await ready(page,info.config.metadata);const before=await music(page);
 await action(page,'pick').click();
 await page.locator('.bar-visual[data-container-index="0"][data-bar-index="0"] .beat-square[data-beat-index="3"]').scrollIntoViewIfNeeded();
 const sample=await page.evaluate(()=>{
  const beats=[...document.querySelectorAll('.bar-visual[data-container-index="0"][data-bar-index="0"] .beat-square')];
  const original=beats.map(el=>({rect:el.getBoundingClientRect().toJSON(),transform:getComputedStyle(el).transform}));
  beats[3].dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
  beats[1].dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true,cancelable:true}));
  const effect=[...document.querySelectorAll('[data-range-motion="selection"]')].at(-1);
  return {selected:beats.flatMap((el,i)=>el.hasAttribute('data-range-source')?[i]:[]),original,after:beats.map(el=>({rect:el.getBoundingClientRect().toJSON(),transform:getComputedStyle(el).transform})),effect:effect&&{left:parseFloat(effect.style.left),width:parseFloat(effect.style.width),frames:effect.getAnimations().flatMap(a=>a.effect.getKeyframes()),pointer:getComputedStyle(effect).pointerEvents,inert:!!effect.closest('[inert]'),hidden:!!effect.closest('[aria-hidden="true"]')},start:beats[1].getBoundingClientRect().left,end:beats[3].getBoundingClientRect().right};
 });
 expect(sample.selected).toEqual([1,2,3]);expect(sample.after).toEqual(sample.original);expect(await music(page)).toEqual(before);
 expect(sample.effect).not.toBeNull();expect(sample.effect.left).toBeCloseTo(sample.start,3);expect(sample.effect.width).toBeCloseTo(sample.end-sample.start,3);
 expect(sample.effect.frames.some(f=>f.clipPath==='inset(0px 100% 0px 0px)')).toBe(true);expect(sample.effect.pointer).toBe('none');expect(sample.effect.inert).toBe(true);expect(sample.effect.hidden).toBe(true);
 await expect(action(page,'pick')).toHaveAttribute('aria-pressed','false');await page.waitForTimeout(300);await expect(page.locator('[data-interaction-motion-root] > *')).toHaveCount(0);
});

async function fixture(page){
 const controller=await page.evaluateHandle(()=>import('/js/tracksController.js').then(m=>m.default));
 try{await page.evaluate(controller=>{
  app.addTrack();
  app.updateTrack(0,{barSettings:[{beats:3,subdivision:1,rests:[1],velocities:{0:.2,1:.6,2:1},beatSlices:{1:2},beatSliceAnchors:{1:1},beatSounds:{1:{mainBeatSound:{sound:'Synth Kick',settings:{volume:.4,highPassFrequency:20,lowPassFrequency:20000,fxBypass:false,distortion:0,delayMix:0,delayTime:0,delayFeedback:.25,reverbMix:0,reverbFeedback:.25}}}}},{beats:2,subdivision:1,rests:[1]}]});
  app.updateTrack(1,{name:'Generated destination',swing:21,barSettings:[{beats:4,subdivision:1,rests:[3],velocities:{3:.25}},{beats:5,subdivision:1,rests:[4]}]});controller.renderTracks();
  window.historyUI=hm.initializeHistoryControls(document.querySelector('#rehearsal-range-root'));historyUI.clear();
 },controller);}finally{await controller.dispose();}
}
test('copied logical data and detached paste preview decorate before one accepted undoable Apply',async({page},info)=>{
 await ready(page,info.config.metadata);await fixture(page);const before=await music(page);
 await page.locator(root+' [data-field="endBeat"]').fill('3');await reset(page);
 visible(await geometryClick(action(page,'copy'),'[data-motion-kind="copy"]'));expect(await music(page)).toEqual(before);
 await page.locator(root+' [data-field="destinationTrack"]').fill('2');await page.locator(root+' [data-field="operation"]').selectOption('paste');await reset(page);
 visible(await geometryClick(action(page,'preview'),'[data-motion-kind="open"]'));await expect(page.locator(root+' [data-range-preview]')).toContainText('3 beats');expect(await music(page)).toEqual(before);
 await reset(page);visible(await geometryClick(action(page,'apply'),'[data-motion-kind="confirm"]'));
 const after=await music(page),bar=after.Tracks[1].barSettings[0];expect(bar.rests).toEqual([1,3]);expect(bar.velocities).toEqual({0:.2,1:.6,2:1,3:.25});expect(bar.beatSlices).toEqual({1:2});expect(bar.beatSliceAnchors).toEqual({1:1});expect(bar.beatSounds[1]).toEqual(before.Tracks[0].barSettings[0].beatSounds[1]);expect(after.Tracks[0]).toEqual(before.Tracks[0]);expect(after.Tracks[1].barSettings[1]).toEqual(before.Tracks[1].barSettings[1]);expect(after.Tracks[1].swing).toBe(21);
 expect(await page.evaluate(()=>historyUI.undo())).toBe(true);expect(await music(page)).toEqual(before);
 await page.locator(root+' [data-field="operation"]').selectOption('fill-rests');await action(page,'preview').click();await reset(page);
 visible(await geometryClick(action(page,'cancel'),'[data-motion-kind="cancel"]'));expect(await music(page)).toEqual(before);await expect(action(page,'apply')).toBeDisabled();
 await action(page,'preview').click();await action(page,'cancel').scrollIntoViewIfNeeded();await reset(page);await page.keyboard.press('Escape');await observed(page,'cancel');expect(await music(page)).toEqual(before);
 await page.waitForTimeout(300);await expect(page.locator('[data-interaction-motion-root] > *')).toHaveCount(0);
});
test('clipboard preview and accepted result travel on inert bounded overlays only',async({page},info)=>{
 await ready(page,info.config.metadata);await fixture(page);const before=await music(page);
 await page.locator(root+' [data-field="endBeat"]').fill('3');
 async function travel(name,phase){
  await action(page,name).scrollIntoViewIfNeeded();await reset(page);
  const sample=await action(page,name).evaluate((el,phase)=>{
   const before=el.getBoundingClientRect().toJSON(),transform=getComputedStyle(el).transform;el.click();
   const effect=document.querySelector(`[data-range-motion="${phase}"]`);
   const bounds=effect&&effect.getAnimations().flatMap(a=>a.effect.getKeyframes()).filter(f=>f.transform).map(f=>{const m=new DOMMatrix(f.transform),x=parseFloat(effect.style.left)+m.m41,y=parseFloat(effect.style.top)+m.m42;return {distance:Math.hypot(m.m41,m.m42),left:x,top:y,right:x+parseFloat(effect.style.width),bottom:y+parseFloat(effect.style.height)};});
   return {before,after:el.getBoundingClientRect().toJSON(),transform,afterTransform:getComputedStyle(el).transform,viewport:{width:document.documentElement.clientWidth,height:document.documentElement.clientHeight},bounds,effect:effect&&{frames:effect.getAnimations().flatMap(a=>a.effect.getKeyframes()),durations:effect.getAnimations().map(a=>a.effect.getComputedTiming().endTime),pointer:getComputedStyle(effect).pointerEvents,inert:!!effect.closest('[inert]'),hidden:!!effect.closest('[aria-hidden="true"]')}};
  },phase);
  expect(sample.after).toEqual(sample.before);expect(sample.afterTransform).toBe(sample.transform);expect(sample.effect).not.toBeNull();
  expect(sample.effect.pointer).toBe('none');expect(sample.effect.inert).toBe(true);expect(sample.effect.hidden).toBe(true);
  const transforms=sample.effect.frames.filter(f=>f.transform).map(f=>f.transform);expect(transforms.length).toBeGreaterThanOrEqual(2);expect(transforms[0]).not.toBe(transforms.at(-1));
  for(const b of sample.bounds){expect(b.distance).toBeLessThanOrEqual(48.001);expect(b.left).toBeGreaterThanOrEqual(0);expect(b.top).toBeGreaterThanOrEqual(0);expect(b.right).toBeLessThanOrEqual(sample.viewport.width);expect(b.bottom).toBeLessThanOrEqual(sample.viewport.height);}
  for(const duration of sample.effect.durations){expect(duration).toBeGreaterThan(0);expect(duration).toBeLessThanOrEqual(200);}
 }
 await travel('copy','clipboard');expect(await music(page)).toEqual(before);
 await page.locator(root+' [data-field="destinationTrack"]').fill('2');await page.locator(root+' [data-field="operation"]').selectOption('paste');
 await travel('preview','preview');expect(await music(page)).toEqual(before);await expect(action(page,'apply')).toBeEnabled();
 await travel('apply','result');expect((await music(page)).Tracks[1].barSettings[0].rests).toEqual([1,3]);
 expect(await page.evaluate(()=>historyUI.undo())).toBe(true);expect(await music(page)).toEqual(before);
 await page.waitForTimeout(300);await expect(page.locator('[data-interaction-motion-root] > *')).toHaveCount(0);
});

test('invalid preview busy history no-op and synchronous stale DOM refuse without accepted feedback',async({page},info)=>{
 await ready(page,info.config.metadata);await page.evaluate(()=>app.updateTrack(0,{barSettings:[{beats:4,subdivision:1,rests:[],velocities:{},beatSounds:{}}]}));const before=await music(page);
 await page.locator(root+' [data-field="endBeat"]').fill('999');await reset(page);
 visible(await geometryClick(action(page,'preview'),'[data-motion-kind="refuse"]'));await expect(action(page,'apply')).toBeDisabled();expect(await music(page)).toEqual(before);expect(await page.evaluate(()=>__motionObserved.includes('open')||__motionObserved.includes('confirm'))).toBe(false);
 await reset(page);visible(await geometryClick(action(page,'copy'),'[data-motion-kind="refuse"]'));expect(await music(page)).toEqual(before);
 await page.locator(root+' [data-field="endBeat"]').fill('1');await action(page,'preview').click();await reset(page);
 await page.evaluate(()=>{window.heldRangeHistory=hm.beginEditTransaction('Real foreign range test transaction');});expect(await page.evaluate(()=>!!heldRangeHistory)).toBe(true);
 visible(await geometryClick(action(page,'apply'),'[data-motion-kind="refuse"]'));expect(await music(page)).toEqual(before);expect(await page.evaluate(()=>__motionObserved.includes('confirm'))).toBe(false);await expect(page.locator(root+' [data-range-status]')).toContainText('History unavailable or busy');await page.evaluate(()=>hm.cancelEditTransaction(heldRangeHistory));
 await action(page,'preview').click();await action(page,'apply').scrollIntoViewIfNeeded();await reset(page);
 const stale=await page.evaluate(()=>{const beat=document.querySelector('.bar-visual[data-container-index="0"][data-bar-index="0"] .beat-square[data-beat-index="0"]');beat.replaceWith(beat.cloneNode(true));const result=range.apply();return {result,refuse:!!document.querySelector('[data-motion-kind="refuse"]')};});expect(stale).toEqual({result:false,refuse:true});expect(await music(page)).toEqual(before);expect(await page.evaluate(()=>__motionObserved.includes('confirm'))).toBe(false);
 await page.locator(root+' [data-field="operation"]').selectOption('clear-rests');await action(page,'preview').click();await reset(page);await action(page,'apply').click();expect(await music(page)).toEqual(before);expect(await page.evaluate(()=>__motionObserved.includes('confirm'))).toBe(false);
});
test('a genuine connected non-host receives refusal not preview or accepted outcome',async({page,browser},info)=>{
 await ready(page,info.config.metadata);const context=await browser.newContext({serviceWorkers:'block'}),peer=await context.newPage();const peerErrors=[];peer.on('pageerror',e=>peerErrors.push(e.message));
 try{
  await require('./workflowTestPage.cjs')(peer,info.config.metadata);await peer.goto(page.url());await expect(peer.locator('#share-btn')).toHaveClass(/connected/);await expect(peer.locator('#workflow-tools-status')).toContainText('Editing previews never change music until applied.');await expect.poll(()=>peer.evaluate(()=>window.isHost)).toBe(false);
  const dismiss=peer.locator('#dismiss-connection-modal-btn');if(await dismiss.isVisible())await dismiss.click();await peer.locator('#rehearsal-tools-panel > summary').click();
  await peer.evaluate(async()=>{window.app=(await import('/js/appState.js')).default;window.range=(await import('/js/rangeEditor.js')).initializeRangeEditor(document.querySelector('#rehearsal-range-root'));window.__motionObserved=[];new MutationObserver(records=>{for(const r of records)for(const n of r.addedNodes)if(n.nodeType===1&&n.hasAttribute('data-motion-kind'))__motionObserved.push(n.dataset.motionKind);}).observe(document.querySelector('[data-interaction-motion-root]'),{childList:true});});
  const before=await music(peer);await action(peer,'preview').scrollIntoViewIfNeeded();await reset(peer);expect(await peer.evaluate(()=>range.preview())).toBe(false);await observed(peer,'refuse');expect(await music(peer)).toEqual(before);expect(await peer.evaluate(()=>__motionObserved.some(k=>k==='open'||k==='confirm'))).toBe(false);await expect(action(peer,'apply')).toBeDisabled();
  await reset(peer);await action(peer,'apply').scrollIntoViewIfNeeded();expect(await peer.evaluate(()=>range.apply())).toBe(false);await observed(peer,'refuse');expect(await music(peer)).toEqual(before);expect(peerErrors).toEqual([]);
 }finally{await context.close();}
});
test('touch pan and cancellation stay native while completed taps select once without painting',async({page},info)=>{
 await ready(page,info.config.metadata);const before=await music(page);await action(page,'pick').click();
 await page.locator('.bar-visual[data-container-index="0"][data-bar-index="0"] .beat-square[data-beat-index="3"]').scrollIntoViewIfNeeded();
 const sample=await page.evaluate(()=>{
  const beats=[...document.querySelectorAll('.bar-visual[data-container-index="0"][data-bar-index="0"] .beat-square')];
  const event=(node,type,x=20,y=20)=>{const e=new PointerEvent(type,{pointerType:'touch',pointerId:7,isPrimary:true,clientX:x,clientY:y,bubbles:true,cancelable:true});node.dispatchEvent(e);return e.defaultPrevented;};
  const native=[event(beats[0],'pointerdown'),event(beats[0],'pointermove',50),event(beats[0],'pointerup',50)];
  const afterPan=document.querySelector('#rehearsal-range-root [data-field="startBeat"]').value;
  native.push(event(beats[0],'pointerdown'),event(beats[0],'pointercancel'),event(beats[0],'pointerup'));
  const afterCancel=document.querySelector('#rehearsal-range-root [data-field="startBeat"]').value;
  event(beats[3],'pointerdown');event(beats[3],'pointerup');beats[3].click();
  const first=document.querySelector('#rehearsal-range-root [data-field="startBeat"]').value;
  event(beats[1],'pointerdown');event(beats[1],'pointerup');beats[1].click();
  return {native,afterPan,afterCancel,first,start:document.querySelector('#rehearsal-range-root [data-field="startBeat"]').value,end:document.querySelector('#rehearsal-range-root [data-field="endBeat"]').value,selected:beats.flatMap((el,i)=>el.hasAttribute('data-range-source')?[i]:[])};
 });
 expect(sample).toEqual({native:[false,false,false,false,false,false],afterPan:'1',afterCancel:'1',first:'4',start:'2',end:'4',selected:[1,2,3]});
 expect(await music(page)).toEqual(before);await expect(action(page,'pick')).toHaveAttribute('aria-pressed','false');
});

test('reduced-motion feedback is static visible bounded at portrait and landscape and cleans up',async({page},info)=>{
 await page.emulateMedia({reducedMotion:'reduce'});await ready(page,info.config.metadata);const before=await music(page);
 for(const viewport of [{width:320,height:700},{width:844,height:390}]){
  await page.setViewportSize(viewport);await reset(page);const sample=await geometryClick(action(page,'copy'),'[data-motion-kind="copy"]');visible(sample);expect(sample.animations).toEqual([]);
  const bounded=await action(page,'copy').evaluate(el=>{for(let i=0;i<20;i++)el.click();const nodes=[...document.querySelectorAll('[data-interaction-motion-root] > *')];return {count:nodes.length,animations:nodes.flatMap(n=>n.getAnimations({subtree:true})).length};});expect(bounded.count).toBeGreaterThan(0);expect(bounded.count).toBeLessThanOrEqual(8);expect(bounded.animations).toBe(0);expect(await music(page)).toEqual(before);
  await page.screenshot({path:info.outputPath(`range-static-${viewport.width}.png`)});await page.waitForTimeout(300);await expect(page.locator('[data-interaction-motion-root] > *')).toHaveCount(0);
 }
});
test('reduced-motion selection preview and result remain static with real paste and undo',async({page},info)=>{
 await page.emulateMedia({reducedMotion:'reduce'});await ready(page,info.config.metadata);await fixture(page);const before=await music(page);
 await action(page,'pick').evaluate(el=>el.click());
 const beat=page.locator('.bar-visual[data-container-index="0"][data-bar-index="0"] .beat-square[data-beat-index="2"]');await beat.scrollIntoViewIfNeeded();
 visible(await geometryClick(beat,'[data-range-motion="selection"]'));
 expect(await page.locator('[data-range-motion="selection"]').evaluate(el=>el.getAnimations({subtree:true}).length)).toBe(0);
 await action(page,'stop-pick').click();await page.locator(root+' [data-field="startBeat"]').fill('1');
 await action(page,'copy').click();await page.locator(root+' [data-field="destinationTrack"]').fill('2');await page.locator(root+' [data-field="operation"]').selectOption('paste');await reset(page);
 const preview=await geometryClick(action(page,'preview'),'[data-range-motion="preview"]');visible(preview);expect(preview.animations).toEqual([]);expect(await music(page)).toEqual(before);
 await reset(page);const result=await geometryClick(action(page,'apply'),'[data-range-motion="result"]');visible(result);expect(result.animations).toEqual([]);
 expect((await music(page)).Tracks[1].barSettings[0].rests).toEqual([1,3]);expect(await page.evaluate(()=>historyUI.undo())).toBe(true);expect(await music(page)).toEqual(before);
 await page.waitForTimeout(300);await expect(page.locator('[data-interaction-motion-root] > *')).toHaveCount(0);
});

test('destroy removes listeners and prevents stale API success or resurrected decoration',async({page},info)=>{
 await ready(page,info.config.metadata);const before=await music(page);await action(page,'preview').click();await reset(page);
 const result=await page.evaluate(()=>{const copy=document.querySelector('#rehearsal-range-root [data-action="copy"]');range.destroy();copy.click();return {apply:range.apply(),preview:range.preview()};});expect(result).toEqual({apply:false,preview:false});expect(await music(page)).toEqual(before);await expect(page.locator(root+' .range-editor')).toHaveCount(0);expect(await page.evaluate(()=>__motionObserved)).toEqual([]);await page.waitForTimeout(300);await expect(page.locator('[data-interaction-motion-root] > *')).toHaveCount(0);
});
test('a throwing real refresh hook returns failure without falsely confirming success',async({page},info)=>{
 await ready(page,info.config.metadata);
 await page.evaluate(async()=>{const {initializeRangeEditor}=await import('/js/rangeEditor.js');const host=document.createElement('section');host.id='range-refresh-failure-fixture';document.body.prepend(host);window.refreshFailureRange=initializeRangeEditor(host,{refreshUI(){throw new Error('Generated refresh callback failure');}});});
 const fixture=page.locator('#range-refresh-failure-fixture');await fixture.locator('[data-field="endBeat"]').fill('2');await fixture.locator('[data-action="preview"]').click();await fixture.locator('[data-action="apply"]').scrollIntoViewIfNeeded();await reset(page);
 const result=await page.evaluate(()=>refreshFailureRange.apply());expect(result).toBe(false);await expect(fixture.locator('[data-range-status]')).toHaveText('Range committed; follow-up failed: Generated refresh callback failure');
 // The original module already committed before the hook threw. Do not fake a
 // rollback or change its musical semantics merely to hide contradictory feedback.
 expect(await page.evaluate(()=>app.getTracks()[0].barSettings[0].rests)).toEqual([0,1]);
 expect(await page.evaluate(()=>__motionObserved.some(k=>['confirm','refuse'].includes(k)))).toBe(false);await observed(page,'adjust');
});
