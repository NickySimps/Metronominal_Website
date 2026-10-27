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
}
async function ptr(page,type,index,options={}){await page.locator(`.beat-square[data-beat-index="${index}"]`).first().evaluate((b,{type,options})=>{const r=b.getBoundingClientRect();b.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerType:'touch',pointerId:51,isPrimary:true,button:0,clientX:r.x+r.width/2,clientY:r.y+r.height/2,...options}));},{type,options});}
async function zoom(page,index){await page.waitForTimeout(420);const r=await page.locator(`.beat-square[data-beat-index="${index}"]`).first().boundingBox();await ptr(page,'pointermove',index,{clientX:r.x+r.width/2+12});await ptr(page,'pointermove',index);await expect(page.locator('[data-beat-precision-lens]')).toBeVisible();}
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

for(const mode of ['normal','edit','rest','accent','slice'])test(`${mode} hold previews without mutation and release applies final semantic action exactly once`,async({page})=>{
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
for(const mode of ['rest','accent','slice'])test(`${mode} fast tap commits once on release; prehold movement cancels without painting`,async({page})=>{
  await setup(page,mode);const before=await page.evaluate(()=>a.getMusicalSnapshot());
  // Separate locator round trips can turn a supposed fast swipe into a real
  // 380ms hold under tracing/load. Deliver the intended fast sequence in one task.
  const swipe=await page.evaluate(()=>{
    const started=performance.now();const emit=(type,index)=>{const element=document.querySelector(`.beat-square[data-beat-index="${index}"]`),r=element.getBoundingClientRect();element.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerType:'touch',pointerId:51,isPrimary:true,button:0,clientX:r.x+r.width/2,clientY:r.y+r.height/2}));};
    emit('pointerdown',19);const beforeMove=a.getMusicalSnapshot();emit('pointermove',20);const beforeRelease=a.getMusicalSnapshot();emit('pointerup',20);return{beforeMove,beforeRelease,elapsed:performance.now()-started};
  });
  expect(swipe.elapsed).toBeLessThan(380);expect(swipe.beforeMove).toEqual(before);expect(swipe.beforeRelease).toEqual(before);
  expect(await page.evaluate(()=>a.getMusicalSnapshot())).toEqual(before);
  const tap=await page.evaluate(()=>{
    const element=document.querySelector('.beat-square[data-beat-index="19"]'),r=element.getBoundingClientRect(),started=performance.now();const emit=type=>element.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerType:'touch',pointerId:51,isPrimary:true,button:0,clientX:r.x+r.width/2,clientY:r.y+r.height/2}));
    emit('pointerdown');const beforeRelease=a.getMusicalSnapshot();emit('pointerup');return{beforeRelease,elapsed:performance.now()-started};
  });
  expect(tap.elapsed).toBeLessThan(380);expect(tap.beforeRelease).toEqual(before);
  const bar=await page.evaluate(()=>a.getTracks()[0].barSettings[0]);
  if(mode==='rest')expect(bar.rests).toEqual([19]);
  if(mode==='accent')expect(bar.velocities).toEqual({'19':1});
  if(mode==='slice')expect(bar.beatSlices).toEqual({'19':2});
  expect(await page.evaluate(()=>opens)).toEqual([]);
});
test('normal short tap and held release select the correct bar/beat; dedicated indicator opens subdivision',async({page})=>{
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
  await ptr(page,'pointerdown',19);await ptr(page,'pointermove',20);await ptr(page,'pointerup',20);
  expect(await page.evaluate(()=>a.getTracks()[0].barSettings[0].rests)).toEqual([19,20]);
  expect(await page.evaluate(()=>opens)).toEqual([]);
});
