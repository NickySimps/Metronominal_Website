const {test,expect}=require('@playwright/test');
async function ready(page) {
  await page.goto('./');
  await expect(page.locator('#share-btn')).toHaveClass(/(?:^|\s)connected(?:\s|$)/);
  await expect(page.locator('#beat-precision-controls')).toBeHidden();
}
async function dense(page) {
  await page.evaluate(async()=>{
    const a=(await import(new URL('js/appState.js',document.baseURI))).default;
    const display=(await import(new URL('js/barDisplayController.js',document.baseURI))).default;
    const original=a.getTracks()[0].barSettings[0];
    a.updateTrack(0,{barSettings:[{...original,beats:8,subdivision:8,rests:[],velocities:{},beatSounds:{}}]});
    display.renderBarsAndControls(-1);
  });
  await expect(page.locator('.bar-visual[data-container-index="0"][data-bar-index="0"] .beat-square')).toHaveCount(64);
}
const beat = (page,index) => page.locator(`.bar-visual[data-container-index="0"][data-bar-index="0"] .beat-square[data-beat-index="${index}"]`);
async function pointer(page,type,index) {
  await beat(page,index).evaluate((el,type)=>{
    const r=el.getBoundingClientRect();
    el.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerType:'touch',pointerId:7,isPrimary:true,button:0,clientX:r.x+r.width/2,clientY:r.y+r.height/2}));
  },type);
}
async function snapshot(page) {
  return page.evaluate(async()=>{
    const a=(await import(new URL('js/appState.js',document.baseURI))).default;
    const m=(await import(new URL('js/monitoring.js',document.baseURI))).default;
    return {music:await a.getCurrentStateForPreset(true),mix:m.getState(),theme:a.getCurrentTheme(),playing:a.isPlaying()};
  });
}
test('mounted dense-bar assistance follows Beat Edit and release opens the exact editor once without painting',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setViewportSize({width:390,height:1200});await ready(page);await dense(page);
  await page.locator('.rest-button').first().click();
  const toggle=page.getByRole('button',{name:'Precision beat selection',exact:true});
  await expect(toggle).toBeVisible();
  await page.locator('.beat-edit-btn').first().click();
  await expect(toggle).toHaveAttribute('aria-pressed','true');
  await page.evaluate(async()=>{const m=(await import(new URL('js/soundSettingsModal.js',document.baseURI))).default,original=m.show;window.__editorOpens=0;m.show=function(...args){window.__editorOpens++;return original.apply(this,args);};});
  await beat(page,19).scrollIntoViewIfNeeded();
  const before=await snapshot(page);
  await pointer(page,'pointerdown',19);
  await expect(page.locator('[data-beat-precision-lens]')).toBeVisible();
  await expect(page.locator('[data-beat-precision-lens]')).toContainText('Track 1 · Bar 1 · Beat 20');
  await expect(page.locator('.subdivision-options-container.visible')).toHaveCount(0);
  const geometry=await page.evaluate(()=>{
    const lens=document.querySelector('[data-beat-precision-lens]').getBoundingClientRect(),bar=document.querySelector('.beat-square[data-beat-index="19"]').getBoundingClientRect();
    return {contained:lens.left>=0&&lens.right<=innerWidth&&lens.top>=0&&lens.bottom<=innerHeight,nonoverlap:lens.bottom<=bar.top||lens.top>=bar.bottom||lens.right<=bar.left||lens.left>=bar.right};
  });
  expect(geometry).toEqual({contained:true,nonoverlap:true});
  await page.screenshot({path:test.info().outputPath('precision-live-390.png')});
  await pointer(page,'pointerup',19);
  await expect(page.locator('.beat-precision-selected')).toHaveAttribute('data-beat-index','19');
  expect(await snapshot(page)).toEqual(before);
  await expect(page.locator('#sound-settings-modal')).toBeVisible();
  await beat(page,19).dispatchEvent('click',{detail:1});
  expect(await page.evaluate(()=>window.__editorOpens)).toBe(1);
  await expect(page.getByRole('button',{name:'Edit selected beat',exact:true})).toHaveCount(0);
  expect(await page.evaluate(async()=>{
    const m=(await import(new URL('js/soundSettingsModal.js',document.baseURI))).default;
    return {track:m.currentTrackIndex,bar:m.currentBarIndex,beat:m.currentBeatIndex};
  })).toEqual({track:0,bar:0,beat:19});
  const effectsButton=page.locator('#sound-effects-btn');
  await effectsButton.focus();
  await expect(effectsButton).toBeFocused();
  await effectsButton.press('Enter');
  await expect(page.locator('#sound-effects-modal')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#sound-effects-modal')).toBeHidden();
  await expect(page.locator('#sound-settings-modal')).toBeVisible();
  await expect(effectsButton).toBeFocused();
  expect(errors).toEqual([]);
});
test('Precision off preserves actual legacy rest taps and normal holds; indicator remains available',async({page})=>{
  await ready(page);
  await page.locator('.rest-button').first().click();
  await page.locator('[data-beat-precision-toggle]').first().click();
  await pointer(page,'pointerdown',1);await pointer(page,'pointerup',1);
  await expect.poll(()=>page.evaluate(async()=>(await import(new URL('js/appState.js',document.baseURI))).default.getTracks()[0].barSettings[0].rests.includes(1))).toBe(true);
  await page.locator('.rest-button').first().click();
  await pointer(page,'pointerdown',0);
  await expect(page.locator('.subdivision-options-container.visible')).toHaveCount(2);
  await expect(page.locator('.subdivision-options-container.visible').first()).toBeVisible();
  await expect(page.locator('.subdivision-options-container.visible').last()).toBeVisible();
  await pointer(page,'pointerup',0);
  await expect(page.locator('[data-beat-precision-lens]')).toHaveCount(0);
});
test('real participant selection cannot edit and role/playback boundaries clear host selection',async({page,browser})=>{
  await ready(page);await dense(page);
  await page.evaluate(async()=>{
    const a=(await import(new URL('js/appState.js',document.baseURI))).default;
    await(await import(new URL('js/webrtc.js',document.baseURI))).sendState(a.getCurrentStateForPreset(true));
  });
  const context=await browser.newContext({serviceWorkers:'block'}),client=await context.newPage();
  try {
    await client.goto(page.url());
    await expect.poll(()=>client.evaluate(async()=>(await import(new URL('js/webrtc.js',document.baseURI))).getRehearsalRoomState().joined)).toBe(true);
    const dismiss=client.locator('#dismiss-connection-modal-btn');if(await dismiss.isVisible())await dismiss.click();
    await client.evaluate(()=>document.body.classList.add('beat-edit-mode'));
    await expect(client.locator('.track .beat-precision')).toBeHidden();
    await client.locator('.beat-square').first().dispatchEvent('click');
    await expect(client.locator('#sound-settings-modal')).toBeHidden();
    await page.locator('.beat-edit-btn').first().click();
    await page.locator('[data-beat-precision-toggle]').first().focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.beat-precision-selected')).toHaveCount(1);
    await page.locator('#start-stop-btn').click();
    await expect.poll(()=>page.evaluate(async()=>(await import(new URL('js/appState.js',document.baseURI))).default.isPlaying())).toBe(true);
    await expect(page.locator('.beat-precision-selected')).toHaveCount(0);
    await expect(page.locator('.track .beat-precision')).toBeHidden();
    await page.locator('.beat-square').first().dispatchEvent('click');
    await expect(page.locator('#sound-settings-modal')).toBeHidden();
    await page.locator('#start-stop-btn').click();
  } finally {await context.close();}
});
for(const width of [320,390,1280])test(`mounted Precision controls fit ${width}px with ordinary controls available`,async({page})=>{
  await page.setViewportSize({width,height:1100});await ready(page);
  await page.locator('.beat-edit-btn').first().click();
  await expect(page.locator('.track .beat-precision')).toBeVisible();
  const geometry=await page.locator('.track .beat-precision').evaluate(root=>({width:innerWidth,scroll:document.documentElement.scrollWidth,buttons:[...root.querySelectorAll('button')].map(b=>{const r=b.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width,height:r.height};})}));
  expect(geometry.scroll).toBeLessThanOrEqual(geometry.width);
  expect(geometry.buttons.every(b=>b.left>=0&&b.right<=width&&b.width>=44&&b.height>=44)).toBe(true);
  await expect(page.locator('#start-stop-btn')).toBeVisible();
});
