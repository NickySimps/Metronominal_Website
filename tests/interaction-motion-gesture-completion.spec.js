'use strict';
const {test,expect}=require('@playwright/test');
const open=require('./motionTestPage.cjs');
test.describe('trusted paint cursor',()=>{
 test.use({hasTouch:true,viewport:{width:390,height:800}});
 test('assisted accepted subdivision acknowledges its own changed topology',async({page,browserName},info)=>{
  test.skip(browserName!=='chromium','Trusted CDP input fixture');await open(page,info.config.metadata);
  await page.evaluate(async()=>{window.a=(await import('/js/appState.js')).default;const display=(await import('/js/barDisplayController.js')).default;const original=a.getTracks()[0].barSettings[0];a.updateTrack(0,{barSettings:[{...original,beats:8,subdivision:8,rests:[],velocities:{},beatSounds:{},beatSlices:{}}]});display.renderBarsAndControls(-1);});
  await page.locator('.rest-button').first().click();await page.mouse.move(1,1);const beat=page.locator('.bar-visual[data-container-index="0"] .beat-square[data-beat-index="35"]');await beat.scrollIntoViewIfNeeded();const point=await beat.evaluate(el=>{const r=el.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};});
  const cdp=await page.context().newCDPSession(page);let ended=false;await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...point,id:81}]});
  try{await expect(page.locator('.subdivision-options-container.visible')).not.toHaveCount(0);const option=await page.locator('.subdivision-options-container.visible .subdivision-option[data-value="4"]').boundingBox();expect(option).not.toBeNull();await page.evaluate(()=>{__motionObserved=[];});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:option.x+option.width/2,y:option.y+option.height/2,id:81}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});ended=true;await expect.poll(()=>page.evaluate(()=>a.getTracks()[0].barSettings[0].subdivision)).toBe(4);await expect.poll(()=>page.evaluate(()=>__motionObserved.includes('select'))).toBe(true);}
  finally{if(!ended)await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});await cdp.detach();}
 });
 test('fast stroke owns one disposable cursor and remains one actual history transaction',async({page,browserName},info)=>{
  test.skip(browserName!=='chromium','Trusted CDP touch injection is a Chromium-only input fixture');await open(page,info.config.metadata);
  await page.evaluate(async()=>{window.a=(await import('/js/appState.js')).default;window.bars=(await import('/js/barDisplayController.js')).default;(await import('/js/themeController.js')).default.applyTheme('dark');const original=a.getTracks()[0].barSettings[0];a.updateTrack(0,{barSettings:[{...original,beats:8,subdivision:8,rests:[],velocities:{},beatSounds:{},beatSlices:{},beatSliceAnchors:{}}]});bars.renderBarsAndControls(-1);});
  await page.locator('.rest-button').first().click();await page.mouse.move(1,1);await expect(page.locator('#all-tracks-wrapper')).toHaveClass(/beat-precision-enabled/);
  await page.evaluate(async()=>{await document.fonts.ready;for(const animation of document.getAnimations())if(Number.isFinite(animation.effect?.getComputedTiming().endTime))animation.finish();document.querySelector('.bar-visual[data-container-index="0"] .beat-square[data-beat-index="35"]').scrollIntoView({block:'center',behavior:'instant'});window.h=(await import('/js/editHistory.js')).initializeHistoryControls(document.querySelector('.edit-history').parentElement);h.clear();window.beforePaint=structuredClone(a.getTracks()[0].barSettings);});
  const points=await page.locator('.bar-visual[data-container-index="0"] .beat-square[data-beat-index="35"]').evaluate(el=>{const fixed=el.getBoundingClientRect().y+el.getBoundingClientRect().height/2;return [...el.closest('.bar-visual').querySelectorAll('.beat-square')].map(b=>{const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};}).filter(p=>Math.abs(p.y-fixed)<1&&p.x>0&&p.x<innerWidth&&document.elementFromPoint(p.x,p.y)?.closest('.beat-square')).sort((a,b)=>a.x-b.x);});expect(points.length).toBeGreaterThanOrEqual(4);
  const cdp=await page.context().newCDPSession(page);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...points[0],id:91}]});
  try{await page.waitForTimeout(20);await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...points.at(-1),id:91}]});expect(await page.evaluate(()=>a.getTracks()[0].barSettings[0].rests.length)).toBeGreaterThan(1);await expect(page.locator('[data-motion-kind="drag"]')).toHaveCount(1);expect(await page.evaluate(()=>document.querySelector('[data-motion-kind="drag"]').closest('[inert]')!==null)).toBe(true);}
  finally{await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();}
  await expect(page.locator('[data-motion-kind="drag"]')).toHaveCount(0);expect(await page.evaluate(()=>h.undo())).toBe(true);expect(await page.evaluate(()=>a.getTracks()[0].barSettings)).toEqual(await page.evaluate(()=>beforePaint));expect(await page.evaluate(()=>h.undo())).toBe(false);
 });
});

test('subdivision selection never acknowledges an unchanged musical value',async({page},info)=>{
 await open(page,info.config.metadata);await page.evaluate(async()=>{window.a=(await import('/js/appState.js')).default;});
 const bar=page.locator('.bar-visual[data-container-index="0"][data-bar-index="0"]');
 await bar.locator('.bar-beat-indicator').click();await expect(page.locator('.subdivision-options-container.visible').first()).toBeVisible();
 const option=page.locator('.subdivision-options-container.visible .subdivision-option[data-value="4"]');
 // A real intervening setter makes this still-mounted option a musical no-op.
 await page.evaluate(()=>{a.setSubdivisionForSelectedBar(4);window.beforeSubdivisionNoop=a.getMusicalSnapshot();__motionObserved=[];});
 await option.evaluate(el=>el.click());
 await expect(page.locator('.subdivision-options-container.visible')).toHaveCount(0);expect(await page.evaluate(()=>a.getMusicalSnapshot())).toEqual(await page.evaluate(()=>beforeSubdivisionNoop));expect(await page.evaluate(()=>__motionObserved.includes('select'))).toBe(false);
});
for(const native of [false,true])test('accepted changed bar selection has dedicated feedback without musical mutation or no-op success '+(native?'native pointer':'DOM click'),async({page},info)=>{
 await open(page,info.config.metadata);
 await page.evaluate(async()=>{window.a=(await import('/js/appState.js')).default;window.bars=(await import('/js/barDisplayController.js')).default;const list=structuredClone(a.getTracks()[0].barSettings);list.push(structuredClone(list[0]));a.updateTrack(0,{barSettings:list});a.setSelectedTrackIndex(0);a.setSelectedBarIndexInContainer(0);bars.renderBarsAndControls(-1);});
 const before=await page.evaluate(()=>a.getMusicalSnapshot());await page.evaluate(()=>{__motionObserved=[];});
 const select=async()=>{const bar=page.locator('.bar-visual[data-container-index="0"][data-bar-index="1"]');if(native)await bar.locator('.beat-square').first().click();else await bar.evaluate(el=>el.click());};
 await select();
 expect(await page.evaluate(()=>a.getSelectedBarIndexInContainer())).toBe(1);await expect.poll(()=>page.evaluate(()=>__motionObserved.includes('select'))).toBe(true);
 expect(await page.evaluate(()=>a.getMusicalSnapshot())).toEqual(before);
 await page.evaluate(()=>{__motionObserved=[];});await select();expect(await page.evaluate(()=>__motionObserved.includes('select'))).toBe(false);
});
