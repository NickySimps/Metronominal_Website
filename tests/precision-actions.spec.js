const {test,expect}=require('@playwright/test');
const prepareWorkflowTestPage=require('./workflowTestPage.cjs');
async function setup(page,mode){
  await prepareWorkflowTestPage(page,test.info().config.metadata);
  await page.goto('./');await expect(page.locator('#share-btn')).toHaveClass(/(?:^|\s)connected(?:\s|$)/);
  await expect(page.locator('#workflow-tools-status')).toHaveText('Editing previews never change music until applied. Timing correction and library backups stay on this device.');
  await page.evaluate(async(mode)=>{
    window.a=(await import('/js/appState.js')).default;window.d=(await import('/js/barDisplayController.js')).default;
    const m=(await import('/js/soundSettingsModal.js')).default;window.opens=[];m.show=(...args)=>opens.push(args);
    const bar=a.getTracks()[0].barSettings[0];a.updateTrack(0,{barSettings:[{...bar,beats:8,subdivision:8,rests:[],velocities:{},beatSlices:{},beatSounds:{}}]});d.renderBarsAndControls();
    if(mode==='edit') document.body.classList.add('beat-edit-mode');else if(mode!=='normal') {a['set'+mode[0].toUpperCase()+mode.slice(1)+'Mode'](true);document.body.classList.add(mode+'-mode');}
    window.updates=0;const original=a.updateTrack;a.updateTrack=(...args)=>{updates++;return original(...args);};
  },mode);
  await page.locator('.beat-square[data-beat-index="19"]').first().scrollIntoViewIfNeeded();
  await page.evaluate(async()=>{await document.fonts.ready;document.getAnimations().forEach(a=>{if(Number.isFinite(a.effect?.getComputedTiming().endTime))a.finish();});await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
}
async function ptr(page,type,index,options={}){await page.locator(`.beat-square[data-beat-index="${index}"]`).first().evaluate((b,{type,options})=>{const r=b.getBoundingClientRect();b.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerType:'touch',pointerId:51,isPrimary:true,button:0,clientX:r.x+r.width/2,clientY:r.y+r.height/2,...options}));},{type,options});}
async function zoom(page,index){
  // Deliberate movement BEFORE the stationary hold; timestamped CSS pixels/ms.
  await page.locator(`.beat-square[data-beat-index="${index}"]`).first().evaluate(b=>{
    const r=b.getBoundingClientRect(),t=performance.now();
    for(const [dx,dt] of [[6,80],[12,160],[0,240]]){const e=new PointerEvent('pointermove',{bubbles:true,pointerType:'touch',pointerId:51,isPrimary:true,clientX:r.x+r.width/2+dx,clientY:r.y+r.height/2});Object.defineProperty(e,'timeStamp',{value:t+dt});b.dispatchEvent(e);}
  });await expect(page.locator('[data-beat-precision-lens]')).toBeVisible();
}
async function sweep(page,points){await page.evaluate(points=>{
  for(const [type,index,time] of points){const b=document.querySelector(`.beat-square[data-beat-index="${index}"]`),r=b.getBoundingClientRect(),e=new PointerEvent(type,{bubbles:true,cancelable:true,pointerType:'touch',pointerId:51,isPrimary:true,clientX:r.x+r.width/2,clientY:r.y+r.height/2});Object.defineProperty(e,'timeStamp',{value:time});b.dispatchEvent(e);}
},points);}
test('external musical setter fences a live paint stroke without masking its Undo',async({page})=>{
  await setup(page,'rest');const originalVolume=await page.evaluate(()=>a.getTracks()[0].volume);await sweep(page,[['pointerdown',16,1000],['pointermove',19,1040]]);
  await page.evaluate(()=>a.updateTrack(0,{volume:.21}));
  await sweep(page,[['pointermove',23,1080],['pointerup',23,1100]]);
  expect(await page.evaluate(()=>a.getTracks()[0].barSettings[0].rests.slice().sort((a,b)=>a-b))).toEqual([16,17,18,19]);
  expect(await page.evaluate(()=>a.getTracks()[0].volume)).toBe(.21);
  await page.keyboard.press('Control+z');
  await expect.poll(()=>page.evaluate(()=>a.getTracks()[0].volume)).toBe(originalVolume);
  expect(await page.evaluate(()=>a.getTracks()[0].barSettings[0].rests.slice().sort((a,b)=>a-b))).toEqual([16,17,18,19]);
  await page.keyboard.press('Control+z');
  await expect.poll(()=>page.evaluate(()=>a.getTracks()[0].barSettings[0].rests)).toEqual([]);
});
test('unrelated grid topology changed in the release task fences painting',async({page})=>{
  await setup(page,'rest');await sweep(page,[['pointerdown',16,1000],['pointermove',19,1040]]);
  await page.evaluate(()=>{
    const bar=document.querySelector('.bar-visual'),extra=bar.cloneNode(true);extra.dataset.barIndex='9';bar.parentNode.append(extra);
    const b=bar.querySelector('.beat-square[data-beat-index="23"]'),r=b.getBoundingClientRect(),e=new PointerEvent('pointermove',{bubbles:true,pointerId:51,isPrimary:true,pointerType:'touch',clientX:r.x+r.width/2,clientY:r.y+r.height/2});Object.defineProperty(e,'timeStamp',{value:1080});b.dispatchEvent(e);
  });await ptr(page,'pointerup',23);
  expect(await page.evaluate(()=>a.getTracks()[0].barSettings[0].rests.slice().sort((a,b)=>a-b))).toEqual([16,17,18,19]);
});
test('rest paint continues after yielding between pointer samples',async({page})=>{
  await setup(page,'rest');await sweep(page,[['pointerdown',16,1000],['pointermove',19,1040]]);
  await sweep(page,[['pointermove',23,1080],['pointerup',23,1100]]);
  expect(await page.evaluate(()=>a.getTracks()[0].barSettings[0].rests.slice().sort((a,b)=>a-b))).toEqual([16,17,18,19,20,21,22,23]);
});
test('coalesced curved samples paint the delivered path rather than an endpoint chord',async({page})=>{
  await setup(page,'rest');await sweep(page,[['pointerdown',16,1000]]);
  await page.evaluate(()=>{
    const point=(index,time)=>{const b=document.querySelector(`.beat-square[data-beat-index="${index}"]`),r=b.getBoundingClientRect(),e=new PointerEvent('pointermove',{bubbles:true,pointerId:51,isPrimary:true,pointerType:'touch',clientX:r.x+r.width/2,clientY:r.y+r.height/2});Object.defineProperty(e,'timeStamp',{value:time});return e;};
    const event=point(24,1100);Object.defineProperty(event,'getCoalescedEvents',{value:()=>[point(23,1040),point(31,1060),point(24,1100)]});document.querySelector('.beat-square').dispatchEvent(event);
  });await sweep(page,[['pointerup',24,1120]]);
  expect(await page.evaluate(()=>a.getTracks()[0].barSettings[0].rests.slice().sort((a,b)=>a-b))).toEqual(Array.from({length:16},(_,i)=>16+i));
});
test('fast rest sweep fills skipped cells once with constant intent and one Undo',async({page})=>{
  await setup(page,'rest');
  await page.evaluate(()=>{const t=a.getTracks()[0],bar={...t.barSettings[0],rests:[20]};a.updateTrack(0,{barSettings:[bar]});d.updateBar(0,0);});
  const before=await page.evaluate(()=>a.getMusicalSnapshot());
  await page.evaluate(()=>{
    const emit=(type,index,time)=>{const b=document.querySelector(`.beat-square[data-beat-index="${index}"]`),r=b.getBoundingClientRect(),e=new PointerEvent(type,{bubbles:true,cancelable:true,pointerType:'touch',pointerId:51,isPrimary:true,clientX:r.x+r.width/2,clientY:r.y+r.height/2});Object.defineProperty(e,'timeStamp',{value:time});b.dispatchEvent(e);};
    emit('pointerdown',16,1000);emit('pointermove',19,1020);emit('pointermove',23,1040);
  });
  expect(await page.evaluate(()=>a.getTracks()[0].barSettings[0].rests.slice().sort((a,b)=>a-b))).toEqual([16,17,18,19,20,21,22,23]);
  await ptr(page,'pointermove',16);await ptr(page,'pointerup',16);
  await expect(page.locator('[data-beat-precision-lens]')).toHaveCount(0);
  expect(await page.evaluate(()=>a.getTracks()[0].barSettings[0].rests.slice().sort((a,b)=>a-b))).toEqual([16,17,18,19,20,21,22,23]);
  await page.keyboard.press('Control+z');
  await expect.poll(()=>page.evaluate(()=>a.getMusicalSnapshot())).toEqual(before);
});
test('slice paint continues across own badge rerenders and remains one reversible stroke',async({page})=>{
  await setup(page,'slice');const before=await page.evaluate(()=>a.getMusicalSnapshot());
  await page.evaluate(()=>{
    window.sweep=(type,index,time)=>{const b=document.querySelector(`.beat-square[data-beat-index="${index}"]`),r=b.getBoundingClientRect(),e=new PointerEvent(type,{bubbles:true,cancelable:true,pointerType:'touch',pointerId:51,isPrimary:true,clientX:r.x+r.width/2,clientY:r.y+r.height/2});Object.defineProperty(e,'timeStamp',{value:time});b.dispatchEvent(e);};
    sweep('pointerdown',16,1000);sweep('pointermove',19,1040);
  });
  await page.evaluate(()=>sweep('pointermove',23,1080));
  await page.evaluate(()=>{sweep('pointermove',16,1120);sweep('pointerup',16,1140);});
  expect(await page.evaluate(()=>a.getTracks()[0].barSettings[0].beatSlices)).toEqual(Object.fromEntries(Array.from({length:8},(_,i)=>[16+i,2])));
  const after=await page.evaluate(()=>a.getMusicalSnapshot());
  await page.keyboard.press('Control+z');await expect.poll(()=>page.evaluate(()=>a.getMusicalSnapshot())).toEqual(before);
  await page.keyboard.press('Control+Shift+z');await expect.poll(()=>page.evaluate(()=>a.getMusicalSnapshot())).toEqual(after);
});
test('latched subdivision picker survives traversing source beats before selecting on release',async({page})=>{
  await setup(page,'rest');const before=await page.evaluate(()=>a.getMusicalSnapshot());
  await ptr(page,'pointerdown',19);await expect(page.locator('.subdivision-options-container.visible')).not.toHaveCount(0);
  await ptr(page,'pointermove',20);await ptr(page,'pointermove',21);
  await expect(page.locator('[data-beat-precision-lens]')).toHaveCount(0);
  await expect(page.locator('.subdivision-options-container.visible')).not.toHaveCount(0);
  const option=page.locator('.subdivision-option[data-value="4"]'),r=await option.boundingBox();
  await ptr(page,'pointermove',19,{clientX:r.x+r.width/2,clientY:r.y+r.height/2});
  await expect(option).toHaveClass(/hovered/);expect(await page.evaluate(()=>a.getMusicalSnapshot())).toEqual(before);
  await ptr(page,'pointerup',19,{clientX:r.x+r.width/2,clientY:r.y+r.height/2});
  await expect.poll(()=>page.evaluate(()=>Number(a.getTracks()[0].barSettings[0].subdivision))).toBe(4);
  expect(await page.evaluate(()=>a.getTracks()[0].barSettings[0].rests)).toEqual([]);
});
test('released picker rejects a source moved outside its interaction root in the same event turn',async({page})=>{
  await setup(page,'rest');const before=await page.evaluate(()=>a.getMusicalSnapshot());await ptr(page,'pointerdown',19);await expect(page.locator('.subdivision-options-container.visible')).not.toHaveCount(0);await ptr(page,'pointerup',19);
  await page.evaluate(()=>{const source=document.querySelector('.bar-visual'),option=document.querySelector('.subdivision-option[data-value="4"]');document.body.append(source);option.click();});
  expect(await page.evaluate(()=>a.getMusicalSnapshot())).toEqual(before);await expect(page.locator('.subdivision-options-container.visible')).toHaveCount(0);
});

test('stationary picker remains picker through font and theme refreshes',async({page})=>{
  await setup(page,'rest');const before=await page.evaluate(()=>a.getMusicalSnapshot());await ptr(page,'pointerdown',19);await expect(page.locator('.subdivision-options-container.visible')).not.toHaveCount(0);
  await page.evaluate(()=>{document.fonts.dispatchEvent(new Event('loadingdone'));document.documentElement.style.setProperty('--precision-test','1');});
  await expect(page.locator('[data-beat-precision-lens]')).toHaveCount(0);expect(await page.evaluate(()=>a.getMusicalSnapshot())).toEqual(before);await ptr(page,'pointercancel',19);await expect(page.locator('.subdivision-options-container')).toHaveCount(0);
});

for(const mode of ['normal','edit','rest','accent','slice'])test(`${mode} slow pre-hold slide previews without mutation and release applies final semantic action exactly once`,async({page})=>{
  await setup(page,mode);
  const before=await page.evaluate(()=>a.getMusicalSnapshot());
  await ptr(page,'pointerdown',19);
  expect(await page.evaluate(()=>a.getMusicalSnapshot())).toEqual(before);
  await zoom(page,19);
  const cell=page.locator('.beat-precision-cell').filter({hasText:/^21/});
  const r=await cell.boundingBox();
  await ptr(page,'pointermove',19,{clientX:r.x+r.width/2,clientY:r.y+r.height/2});
  expect(await page.evaluate(()=>a.getMusicalSnapshot())).toEqual(before);
  await ptr(page,'pointerup',19,{clientX:r.x+r.width/2,clientY:r.y+r.height/2});
  await page.locator('.beat-square[data-beat-index="20"]').first().dispatchEvent('click',{detail:1});
  const result=await page.evaluate(()=>({bar:a.getTracks()[0].barSettings[0],opens,updates}));
  if(mode==='rest'){expect(result.bar.rests).toEqual([20]);expect(result.updates).toBe(1);}
  else if(mode==='accent'){expect(result.bar.velocities).toEqual({'20':1});expect(result.updates).toBe(1);}
  else if(mode==='slice')expect(result.bar.beatSlices).toEqual({'20':2});
  else expect(await page.evaluate(()=>a.getMusicalSnapshot())).toEqual(before);
  expect(result.opens).toEqual(mode==='edit'?[[0,'subdivisionSound',{barIndex:0,beatIndex:20}]]:[]);
});
for(const reason of ['pointercancel','scroll','secondary','mode','role','playback','reindex','replace','append-immediate'])test(`rest ${reason} cancellation has no mutation or editor`,async({page})=>{
  await setup(page,'rest');const before=await page.evaluate(()=>a.getMusicalSnapshot());
  await ptr(page,'pointerdown',19);await zoom(page,19);
  await page.evaluate(reason=>{
    if(reason==='secondary')document.querySelector('.beat-square').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,isPrimary:false,pointerId:52,pointerType:'touch'}));
    else if(reason==='mode'){a.setRestMode(false);document.body.classList.remove('rest-mode');}
    else if(reason==='role')document.dispatchEvent(new CustomEvent('syncrolechange',{detail:{state:'connected',isHost:false}}));
    else if(reason==='playback')document.dispatchEvent(new Event('playbackstatechange'));
    else if(reason==='reindex')document.querySelector('.bar-visual').dataset.barIndex='1';
    else if(reason==='replace'){const b=document.querySelector('.beat-square');b.replaceWith(b.cloneNode(true));}
    else if(reason==='append-immediate'){const b=document.querySelector('.beat-square[data-beat-index="19"]'),r=b.getBoundingClientRect();b.parentNode.append(b.cloneNode(true));b.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:51,isPrimary:true,pointerType:'touch',clientX:r.x+r.width/2,clientY:r.y+r.height/2}));}
    else document.dispatchEvent(new Event(reason,{bubbles:true}));
  },reason);
  await ptr(page,'pointerup',19);
  expect(await page.evaluate(()=>a.getMusicalSnapshot())).toEqual(before);expect(await page.evaluate(()=>opens)).toEqual([]);
});
for(const mode of ['rest','accent','slice'])test(`${mode} fast tap commits once on release; fast pre-hold stroke paints crossed cells`,async({page})=>{
  await setup(page,mode);const before=await page.evaluate(()=>a.getMusicalSnapshot());
  const tap=await page.evaluate(()=>{
    const element=document.querySelector('.beat-square[data-beat-index="19"]'),r=element.getBoundingClientRect(),started=performance.now();const emit=(type,dt)=>{const e=new PointerEvent(type,{bubbles:true,cancelable:true,pointerType:'touch',pointerId:51,isPrimary:true,button:0,clientX:r.x+r.width/2,clientY:r.y+r.height/2});Object.defineProperty(e,'timeStamp',{value:started+dt});element.dispatchEvent(e);};
    emit('pointerdown',0);const beforeRelease=a.getMusicalSnapshot();emit('pointerup',20);return{beforeRelease,elapsed:performance.now()-started};
  });
  expect(tap.elapsed).toBeLessThan(380);expect(tap.beforeRelease).toEqual(before);
  let bar=await page.evaluate(()=>a.getTracks()[0].barSettings[0]);
  if(mode==='rest')expect(bar.rests).toEqual([19]);
  if(mode==='accent')expect(bar.velocities).toEqual({'19':1});
  if(mode==='slice')expect(bar.beatSlices).toEqual({'19':2});
  await sweep(page,[['pointerdown',21,2000],['pointermove',22,2025],['pointerup',22,2040]]);
  bar=await page.evaluate(()=>a.getTracks()[0].barSettings[0]);
  if(mode==='rest')expect(bar.rests.slice().sort((a,b)=>a-b)).toEqual([19,21,22]);
  if(mode==='accent')expect(bar.velocities).toEqual({'19':1,'21':1,'22':1});
  if(mode==='slice')expect(bar.beatSlices).toEqual({'19':2,'21':2,'22':2});
  expect(await page.evaluate(()=>opens)).toEqual([]);
});
test('normal short tap and slow pre-hold release select the correct bar/beat; dedicated indicator opens subdivision',async({page})=>{
  await setup(page,'normal');const before=await page.evaluate(()=>a.getMusicalSnapshot());
  await ptr(page,'pointerdown',19);await ptr(page,'pointerup',19);
  await expect(page.locator('.beat-precision-selected')).toHaveAttribute('data-beat-index','19');
  await ptr(page,'pointerdown',20);await zoom(page,20);await ptr(page,'pointerup',20);
  await expect(page.locator('.beat-precision-selected')).toHaveAttribute('data-beat-index','20');
  expect(await page.evaluate(()=>a.getMusicalSnapshot())).toEqual(before);expect(await page.evaluate(()=>opens)).toEqual([]);
  expect(await page.evaluate(()=>[a.getSelectedTrackIndex(),a.getSelectedBarIndexInContainer()])).toEqual([0,0]);
  await page.locator('.bar-beat-indicator').first().click();await expect(page.locator('.subdivision-options-container.visible')).toHaveCount(1);
});
test('explicit Precision off retains intentional legacy rest drag painting through shared actions',async({page})=>{
  await setup(page,'rest');await page.locator('[data-beat-precision-toggle]').first().click();
  // Clicking the opt-out scrolls its toolbar into view; restore the source row
  // before exercising the legacy elementFromPoint-based paint handler.
  await page.locator('.beat-square[data-beat-index="20"]').first().scrollIntoViewIfNeeded();
  expect(await page.locator('.beat-square[data-beat-index="20"]').first().evaluate(b=>{const r=b.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('.beat-square')===b;})).toBe(true);
  // One delivery task represents an intentional fast legacy stroke; cross-process
  // locator round trips must not expire the unchanged 350ms long-press timer.
  await sweep(page,[['pointerdown',19,1000],['pointermove',20,1020],['pointerup',20,1040]]);
  expect(await page.evaluate(()=>a.getTracks()[0].barSettings[0].rests)).toEqual([19,20]);
  expect(await page.evaluate(()=>opens)).toEqual([]);
});
