'use strict';
const {test,expect}=require('@playwright/test');const openMotion=require('./motionTestPage.cjs');
async function captureBeatTargets(page){await page.evaluate(()=>{window.__historyBeatTargets=[];new MutationObserver(rs=>{for(const r of rs)for(const n of r.addedNodes)if(n.nodeType===1&&['undo','redo'].includes(n.dataset.motionKind)){const x=parseFloat(n.style.left)+parseFloat(n.style.width)/2,y=parseFloat(n.style.top)+parseFloat(n.style.height)/2;const beat=document.elementFromPoint(x,y)?.closest('.beat-square'),bar=beat?.closest('.bar-visual');if(beat&&bar)__historyBeatTargets.push({kind:n.dataset.motionKind,track:bar.dataset.containerIndex,bar:bar.dataset.barIndex,beat:beat.dataset.beatIndex});}}).observe(document.querySelector('[data-interaction-motion-root]'),{childList:true});});}
test('keyboard Undo remains visibly acknowledged when its toolbar is collapsed',async({page})=>{
 await openMotion(page,test.info().config.metadata);await page.evaluate(async()=>{window.a=(await import(new URL('js/appState.js',document.baseURI))).default;});
 const before=await page.evaluate(()=>a.getTempo());await page.locator('.increase-tempo').click();expect(await page.evaluate(()=>a.getTempo())).toBe(before+1);
 await page.evaluate(()=>{document.querySelector('#rehearsal-tools-panel').open=false;__motionObserved=[];window.__motionUndoRects=[];new MutationObserver(rs=>{for(const r of rs)for(const n of r.addedNodes)if(n.nodeType===1&&n.dataset.motionKind==='undo')__motionUndoRects.push({left:parseFloat(n.style.left),top:parseFloat(n.style.top),width:parseFloat(n.style.width),height:parseFloat(n.style.height),vw:innerWidth,vh:innerHeight});}).observe(document.querySelector('[data-interaction-motion-root]'),{childList:true});});
 await expect(page.getByRole('button',{name:'Undo',exact:true,includeHidden:true})).not.toBeVisible();
 await page.locator('.increase-tempo').focus();await page.keyboard.press('Control+z');
 await expect.poll(()=>page.evaluate(()=>a.getTempo())).toBe(before);await expect.poll(()=>page.evaluate(()=>__motionObserved.includes('undo'))).toBe(true);
 expect(await page.evaluate(()=>__motionUndoRects.some(r=>r.width>0&&r.height>0&&r.left<r.vw&&r.top<r.vh&&r.left+r.width>0&&r.top+r.height>0))).toBe(true);
});

test('Undo and Redo mark the actual restored beat instead of only a distant toolbar',async({page})=>{
 await openMotion(page,test.info().config.metadata);await page.locator('.rest-button').first().click();
 const cell=page.locator('.bar-visual[data-container-index="0"][data-bar-index="0"] .beat-square[data-beat-index="1"]:not(.removing-beat-animation)');
 await cell.click();await expect(cell).toHaveClass(/rested/);await cell.focus();
 await page.evaluate(()=>{
  window.__beatAnimationWrites=[];const descriptor=Object.getOwnPropertyDescriptor(Animation.prototype,'currentTime');Object.defineProperty(Animation.prototype,'currentTime',{...descriptor,set(value){if(this.effect?.target?.matches('.beat-square'))__beatAnimationWrites.push(value);return descriptor.set.call(this,value);}});
  window.__historyBeatTargets=[];new MutationObserver(rs=>{for(const r of rs)for(const n of r.addedNodes)if(n.nodeType===1&&['undo','redo'].includes(n.dataset.motionKind)){
   const x=parseFloat(n.style.left)+parseFloat(n.style.width)/2,y=parseFloat(n.style.top)+parseFloat(n.style.height)/2;
   const beat=document.elementFromPoint(x,y)?.closest('.beat-square');const bar=beat?.closest('.bar-visual');
   if(beat&&bar)__historyBeatTargets.push({kind:n.dataset.motionKind,track:bar.dataset.containerIndex,bar:bar.dataset.barIndex,beat:beat.dataset.beatIndex});
  }}).observe(document.querySelector('[data-interaction-motion-root]'),{childList:true});
 });
 await page.keyboard.press('Control+z');await expect(cell).not.toHaveClass(/rested/);
 expect(await page.evaluate(()=>__beatAnimationWrites)).toEqual([]);
 await expect.poll(()=>page.evaluate(()=>__historyBeatTargets),{timeout:1000}).toContainEqual({kind:'undo',track:'0',bar:'0',beat:'1'});
 await cell.focus();await page.keyboard.press('Control+Shift+z');await expect(cell).toHaveClass(/rested/);
 await expect.poll(()=>page.evaluate(()=>__historyBeatTargets),{timeout:1000}).toContainEqual({kind:'redo',track:'0',bar:'0',beat:'1'});
 expect(await page.evaluate(()=>__beatAnimationWrites)).toEqual([]);
});
for(const [name,key,value] of [['velocity','velocities',1],['slice count','beatSlices',4],['sound','beatSounds','Synth Snare']]){
 test('history highlights the actual beat for '+name+' restoration',async({page})=>{
  await openMotion(page,test.info().config.metadata);await page.evaluate(async()=>{window.a=(await import(new URL('js/appState.js',document.baseURI))).default;window.tc=(await import(new URL('js/tracksController.js',document.baseURI))).default;});
  const before=await page.evaluate(key=>{const v=a.getTracks()[0].barSettings[0][key]?.[1];return key==='beatSounds'?v?.sound:v;},key);
  await page.evaluate(({key,value})=>{const bars=[...a.getTracks()[0].barSettings];bars[0]={...bars[0],[key]:{...(bars[0][key]||{}),1:key==='beatSounds'?{sound:value,settings:{}}:value}};a.updateTrack(0,{barSettings:bars});tc.renderTracks();},{key,value});
  expect(await page.evaluate(key=>{const v=a.getTracks()[0].barSettings[0][key]?.[1];return key==='beatSounds'?v?.sound:v;},key)).toBe(value);
  const cell=page.locator('.bar-visual[data-container-index="0"][data-bar-index="0"] .beat-square[data-beat-index="1"]:not(.removing-beat-animation)');await cell.focus();await captureBeatTargets(page);
  await page.keyboard.press('Control+z');await expect.poll(()=>page.evaluate(key=>{const v=a.getTracks()[0].barSettings[0][key]?.[1];return key==='beatSounds'?v?.sound:v;},key)).toBe(before);
  await expect.poll(()=>page.evaluate(()=>__historyBeatTargets),{timeout:1000}).toContainEqual({kind:'undo',track:'0',bar:'0',beat:'1'});
 });
}

for(const cancel of [null,'clear','destroy','authority']){
 test('pending native beat readiness '+(cancel?'is cancelled by '+cancel:'does not delay accepted Undo and then decorates the real beat'),async({page})=>{
  await openMotion(page,test.info().config.metadata);await page.locator('.rest-button').first().click();
  const cell=page.locator('.bar-visual[data-container-index="0"][data-bar-index="0"] .beat-square[data-beat-index="1"]:not(.removing-beat-animation)');
  await page.evaluate(async()=>{const {initializeHistoryControls}=await import('/js/editHistory.js');window.__historyOwner=initializeHistoryControls(document.querySelector('.edit-history').parentElement);});
  await cell.click();await expect(cell).toHaveClass(/rested/);await captureBeatTargets(page);
  await page.evaluate(()=>{
   window.__heldBeatReady=0;let release;const gate=new Promise(r=>{release=r;});window.__releaseBeatReady=release;
   const native=Object.getOwnPropertyDescriptor(Animation.prototype,'ready');Object.defineProperty(Animation.prototype,'ready',{...native,get(){const ready=native.get.call(this);if(!this.effect?.target?.matches('.beat-square'))return ready;__heldBeatReady++;return ready.then(()=>gate).then(()=>this);}});
  });
  // Observe and cancel in the same browser continuation as accepted restoration:
  // cross-process assertions can otherwise consume the real 240ms visual deadline.
  const result=await page.evaluate(async cancel=>{
   const accepted=await __historyOwner.undo(),held=__heldBeatReady,before=structuredClone(__historyBeatTargets);
   if(cancel==='authority')document.dispatchEvent(new Event('roomauthoritychange'));else if(cancel)__historyOwner[cancel]();
   __releaseBeatReady();return {accepted,held,before};
  },cancel);
  expect(result.accepted).toBe(true);expect(result.held).toBeGreaterThan(0);expect(result.before).toEqual([]);
  await expect(cell).not.toHaveClass(/rested/);
  if(cancel){await page.waitForTimeout(260);expect(await page.evaluate(()=>__historyBeatTargets)).toEqual([]);}
  else await expect.poll(()=>page.evaluate(()=>__historyBeatTargets),{timeout:1000}).toContainEqual({kind:'undo',track:'0',bar:'0',beat:'1'});
 });
}

test('late readiness of an older Undo cannot cancel feedback belonging to a newer Undo',async({page})=>{
 await openMotion(page,test.info().config.metadata);await page.locator('.rest-button').first().click();
 await page.evaluate(async()=>{window.__historyOwner=(await import('/js/editHistory.js')).initializeHistoryControls(document.querySelector('.edit-history').parentElement);});
 const cells=page.locator('.bar-visual[data-container-index="0"][data-bar-index="0"] .beat-square:not(.removing-beat-animation)');
 await cells.nth(1).click();await cells.nth(2).click();await captureBeatTargets(page);
 const accepted=await page.evaluate(async()=>{
  const native=Object.getOwnPropertyDescriptor(Animation.prototype,'ready'),gates=[],releases=[];for(let i=0;i<2;i++)gates.push(new Promise(r=>releases.push(r)));
  window.__releaseOlderUndo=()=>releases[0]();window.__releaseNewerUndo=()=>releases[1]();window.__undoReadyRound=0;window.__undoReadyCounts=[0,0];
  Object.defineProperty(Animation.prototype,'ready',{...native,get(){const result=native.get.call(this);if(!this.effect?.target?.matches('.beat-square'))return result;const round=__undoReadyRound;__undoReadyCounts[round]++;return Promise.allSettled([result]).then(([settled])=>gates[round].then(()=>{if(settled.status==='rejected')throw settled.reason;return this;}));}});
  const first=await __historyOwner.undo();__undoReadyRound=1;const second=await __historyOwner.undo();return [first,second];
 });
 expect(accepted).toEqual([true,true]);expect(await page.evaluate(()=>__undoReadyCounts.every(n=>n>0))).toBe(true);
 await page.evaluate(()=>__releaseOlderUndo());await page.waitForTimeout(30);expect(await page.evaluate(()=>__historyBeatTargets)).toEqual([]);
 await page.evaluate(()=>__releaseNewerUndo());
 await expect.poll(()=>page.evaluate(()=>__historyBeatTargets),{timeout:1000}).toContainEqual({kind:'undo',track:'0',bar:'0',beat:'1'});
});
