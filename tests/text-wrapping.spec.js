const { test, expect } = require('@playwright/test');
const errors=new WeakMap();
test.beforeEach(({page})=>{const messages=[];errors.set(page,messages);page.on('pageerror',e=>messages.push(e.message));});
test.afterEach(({page})=>expect(errors.get(page)).toEqual([]));
async function ready(page, width=320, height=900) {
  // Reproducible generated palettes, without replacing the real theme generator.
  await page.addInitScript(()=>{let seed=62817;Math.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};});
  await page.setViewportSize({width,height});
  await page.goto('./');
  await expect(page.locator('#share-btn')).toHaveClass(/(?:^|\s)connected(?:\s|$)/);
  await expect(page.locator('#rehearsal-tools-status')).not.toContainText('Preparing');
  await page.locator('#rehearsal-tools-panel').evaluate(el=>el.open=true);
  await page.evaluate(()=>document.fonts.ready);
  await page.emulateMedia({reducedMotion:'reduce'});
}
async function textGeometry(page, selector='body') {
  return page.locator(selector).evaluate(root=>{
    const problems=[];
    for(const el of root.querySelectorAll('*')) {
      if(!el.getClientRects().length || el.closest('script,style,select,.sr-only,[aria-hidden="true"],.rehearsal-grid'))continue;
      const style=getComputedStyle(el),r=el.getBoundingClientRect();
      if(style.visibility==='hidden'||style.opacity==='0'||r.width<=1||r.height<=1)continue;
      for(const n of el.childNodes)if(n.nodeType===3&&n.textContent.trim()){
        const range=document.createRange();range.selectNodeContents(n);
        const rects=[...range.getClientRects()].filter(r=>r.width>0&&r.height>0);
        const bad=rects.some(t=>t.left<r.left-1||t.right>r.right+1);
        if(bad)problems.push({tag:el.tagName,id:el.id,class:el.className,text:n.textContent.trim().slice(0,150),width:r.width,height:r.height,scroll:el.scrollWidth,whiteSpace:style.whiteSpace,rects:rects.map(t=>({x:t.x-r.x,y:t.y-r.y,w:t.width,h:t.height}))});
      }
    }
    return {width:innerWidth,scroll:document.documentElement.scrollWidth,problems};
  });
}
async function geometry(page, selector) {
  return page.locator(selector).evaluateAll(elements=>elements.filter(el=>el.getClientRects().length).map(el=>{
    const s=getComputedStyle(el),r=el.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(el);
    const rects=[...range.getClientRects()].filter(t=>t.width>0&&t.height>0);
    const c=document.createElement('canvas').getContext('2d');c.font=`${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
    const text=el.textContent.trim(),spacing=parseFloat(s.letterSpacing)||0,metric=c.measureText(text).width+spacing*text.length;
    return {selector:el.id||el.className,text,width:r.width,height:r.height,left:r.left,right:r.right,
      available:r.width-parseFloat(s.paddingLeft)-parseFloat(s.paddingRight),metric,scroll:el.scrollWidth,
      escaped:rects.filter(t=>t.left<r.left-1||t.right>r.right+1).map(t=>({left:t.left-r.left,right:t.right-r.left,width:t.width})),
      lines:new Set(rects.map(t=>Math.round(t.top))).size};
  }));
}
async function evidence(name,data) {
  await test.info().attach(name,{body:JSON.stringify(data,null,2),contentType:'application/json'});
}
for(const width of [320,360,390,768,1280])for(const stress of [false,true])test(`numeric chips and slider labels remain complete ${width}px spacing=${stress}`,async({page})=>{
  await ready(page,width);
  if(stress)await page.addStyleTag({content:'html{font-size:20px} body{letter-spacing:.12em;word-spacing:.16em}'});
  await page.locator('#personal-monitoring').evaluate(el=>el.open=true);
  const data=await geometry(page,'.volume-value,.track-volume-value,.track-slider-label,.track-pitch-value,.track-swing-value,#personal-monitoring output');
  await evidence('numeric-and-label-geometry',data);
  await page.screenshot({path:test.info().outputPath('numeric-labels.png'),fullPage:true});
  expect(data.filter(d=>d.escaped.length||d.metric>d.available+1)).toEqual([]);
  expect(data.filter(d=>d.text==='100%').every(d=>d.lines===1)).toBe(true);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

async function targets(page,selector) {
  return page.locator(selector).evaluateAll(els=>els.filter(el=>el.getClientRects().length).map(el=>{
    const r=el.getBoundingClientRect();return {text:el.getAttribute('aria-label')||el.textContent.trim(),class:el.className,id:el.id,width:r.width,height:r.height,left:r.left,right:r.right,toolbar:!!el.closest('.top-controls-area')};
  }));
}
async function theme(page,name) {
  await page.locator('#theme-menu-toggle').click();
  await page.locator(`[data-theme="${name}"]`).click();
  await page.evaluate(()=>document.fonts.ready);
}
async function settle(page) {
  // Audit the final layout, not a transient bounce/rotation. Firefox may retain
  // running transition objects offscreen; finish finite effects explicitly.
  await page.evaluate(()=>{for(const a of document.getAnimations())if(Number.isFinite(a.effect.getComputedTiming().endTime))a.finish();});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
}
async function trackOverlap(page) {
  return page.locator('.track').first().evaluate(root=>{
    const selector='.track-controls button,.track-action-row button,.track-volume-controls input,.track-volume-label,.track-volume-value,.sound-label,.sound-selector-trigger,.mode-buttons-col button,.track-bottom-sliders-row input,.track-bottom-sliders-row .track-slider-label,.track-bottom-sliders-row .track-slider-value';
    const items=[...root.querySelectorAll(selector)].filter(el=>el.getClientRects().length).map(el=>({name:el.className||el.id,r:el.getBoundingClientRect()})),overlap=[];
    for(let i=0;i<items.length;i++)for(let j=i+1;j<items.length;j++){
      const a=items[i],b=items[j],w=Math.min(a.r.right,b.r.right)-Math.max(a.r.left,b.r.left),h=Math.min(a.r.bottom,b.r.bottom)-Math.max(a.r.top,b.r.top);
      if(w>1&&h>1)overlap.push({a:a.name,b:b.name,width:w,height:h});
    }
    return overlap;
  });
}
for(const width of [320,360,390,768,1280])for(const stress of [false,true])test(`mounted main actions and long track labels ${width}px spacing=${stress}`,async({page})=>{
  await ready(page,width);
  await theme(page,stress?'random':'dark');
  if(stress)await page.addStyleTag({content:'html{font-size:20px} body{letter-spacing:.12em;word-spacing:.16em}'});
  await page.evaluate(async()=>{
    const app=(await import('/js/appState.js')).default;
    app.updateTrack(0,{name:'W'.repeat(40)});
    (await import('/js/tracksController.js')).default.renderTracks();
  });
  await expect(page.locator('.track-name').first()).toHaveText('W'.repeat(40));
  await settle(page);
  await page.locator('#ab-loop-toggle-btn').click();
  await page.locator('#song-mode-enabled').click();
  await page.locator('#theme-menu-toggle').click();
  await page.locator('.keyboard-shortcuts').evaluate(el=>el.open=true);
  await settle(page);
  const data=await textGeometry(page);
  const actions=await targets(page,'.track button,.track .sound-label,.global-app-controls button,.theme-controls button,#tap-tempo-btn,#share-btn,#beat-precision-controls button,#add-track-btn');
  const overlap=await trackOverlap(page);
  await evidence('main-action-geometry',{data,actions,overlap});
  await page.screenshot({path:test.info().outputPath('main-actions.png'),fullPage:true});
  expect.soft(data.problems).toEqual([]);
  expect.soft(overlap).toEqual([]);
  expect.soft(actions.filter(d=>d.width<43.9||d.height<43.9||(!d.toolbar&&(d.left<0||d.right>width+1)))).toEqual([]);
  expect(data.scroll).toBeLessThanOrEqual(width);
});

for(const width of [320,360,390,768,1280])for(const stress of [false,true])test(`mounted room history and long library text ${width}px spacing=${stress}`,async({page,browser})=>{
  await ready(page,width);
  await theme(page,stress?'random':'hiVis');
  if(stress)await page.addStyleTag({content:'html{font-size:20px} body{letter-spacing:.12em;word-spacing:.16em}'});
  const context=await browser.newContext({serviceWorkers:'block'}),peer=await context.newPage();
  try {
    await page.evaluate(async()=>{const w=await import('/js/webrtc.js');w.setRehearsalReadiness(true,'W'.repeat(40));});
    await peer.goto(page.url());
    await expect.poll(()=>peer.evaluate(async()=>(await import('/js/webrtc.js')).getRehearsalRoomState().joined)).toBe(true);
    await peer.evaluate(async()=>{const w=await import('/js/webrtc.js');w.setRehearsalReadiness(true,'P'.repeat(40));w.requestRehearsalControl();});
    await expect(page.locator('.rehearsal-requests')).toContainText('P'.repeat(40));
    await page.getByText('Setlists',{exact:true}).click();
    await page.getByLabel('Setlist name',{exact:true}).fill('W'.repeat(80));
    await page.getByRole('button',{name:'Create setlist',exact:true}).click();
    // Explicit valid track settings keep this layout fixture independent of legacy optional-field normalization.
    await page.evaluate(async()=>{const app=(await import('/js/appState.js')).default;app.updateTrack(0,{pitchShift:0,swing:0});app.setSong({...app.getSong(),name:'Valid song'});});
    await page.getByRole('button',{name:'Add current song',exact:true}).click();
    await expect(page.getByLabel('Entry name 1',{exact:true})).toBeVisible();
    await page.getByLabel('Entry name 1',{exact:true}).fill('Entry '+ 'W'.repeat(74));
    await page.getByLabel('Entry name 1',{exact:true}).dispatchEvent('change');
    await page.getByText('Cues',{exact:true}).click();
    await page.getByLabel('Cue text',{exact:true}).fill('W'.repeat(140));
    await page.getByRole('button',{name:'Add cue',exact:true}).click();
    await page.getByRole('button',{name:'Send cue 1 now',exact:true}).click();
    await expect(page.locator('[data-cue-display]')).toContainText('W'.repeat(140));
    const data=await textGeometry(page,'#rehearsal-tools-panel');
    const actions=await targets(page,'#rehearsal-tools button');
    const table=await page.locator('.rehearsal-grid').evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth,right:el.getBoundingClientRect().right,headers:[...el.querySelectorAll('th')].map(n=>{const range=document.createRange();range.selectNodeContents(n);return {text:n.textContent,lines:new Set([...range.getClientRects()].map(r=>r.top)).size};})}));
    await evidence('rehearsal-geometry',{data,actions,table});
    await page.screenshot({path:test.info().outputPath('rehearsal-text.png'),fullPage:true});
    expect.soft(data.problems).toEqual([]);
    expect.soft(actions.filter(d=>d.width<43.9||d.height<43.9||(!d.toolbar&&(d.left<0||d.right>width+1)))).toEqual([]);
    expect.soft(table.headers.filter(h=>h.lines!==1)).toEqual([]);
    expect.soft(table.right).toBeLessThanOrEqual(width);
    expect(data.scroll).toBeLessThanOrEqual(width);
    await page.evaluate(async()=>(await import('/js/webrtc.js')).disconnect());
    await expect(page.locator('.rehearsal-room [role=status]')).toContainText(/Reconnect|recover|saved room/i);
    expect((await textGeometry(page,'.rehearsal-room')).problems).toEqual([]);
  }finally{await context.close();}
});

const modalCases=[...[320,360,390,768,1280].flatMap(width=>[false,true].map(stress=>({width,height:900,stress}))),{width:768,height:320,stress:true},{width:320,height:256,stress:true}];
for(const {width,height,stress} of modalCases)test(`Precision and sound editors ${width}x${height} spacing=${stress}`,async({page})=>{
  await ready(page,width,height);
  await theme(page,stress?'random':'synthwave');
  if(stress)await page.addStyleTag({content:'html{font-size:20px} body{letter-spacing:.12em;word-spacing:.16em}'});
  await page.evaluate(async()=>{
    const app=(await import('/js/appState.js')).default;
    app.updateTrack(0,{barSettings:[{...app.getTracks()[0].barSettings[0],beats:8,subdivision:8}]});
    (await import('/js/barDisplayController.js')).default.renderBarsAndControls(-1);
  });
  await page.getByRole('button',{name:'Precision beat selection',exact:true}).click();
  await page.getByRole('button',{name:'Next beat',exact:true}).click();
  await page.getByRole('button',{name:'Previous beat',exact:true}).click();
  const beat=page.locator('.bar-visual .beat-square').nth(19);
  await beat.evaluate(el=>el.scrollIntoView({behavior:'instant',block:'center'}));
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const before=await page.locator('.bar-visual').first().evaluate(el=>({width:el.offsetWidth,height:el.offsetHeight,columns:getComputedStyle(el).gridTemplateColumns}));
  await beat.evaluate(el=>{const r=el.getBoundingClientRect();el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,pointerType:'touch',pointerId:7,isPrimary:true,button:0,clientX:r.x+r.width/2,clientY:r.y+r.height/2}));});
  let lens;
  if(height<=320){
    // A tall dense bar cannot leave a non-occluding lens slot in this viewport.
    await expect(page.locator('#beat-precision-controls [role=status]')).toContainText('Not enough preview space');
    await expect(page.locator('[data-beat-precision-lens]')).toHaveCount(0);
    lens=null;
  }else{
    await expect(page.locator('[data-beat-precision-lens]')).toBeVisible();
    lens=await textGeometry(page,'[data-beat-precision-lens]');
  }
  const precision=await textGeometry(page,'#beat-precision-controls');
  await evidence('precision-text-geometry',{lens,precision});
  if(lens)expect(lens.problems).toEqual([]);expect(precision.problems).toEqual([]);
  expect(await page.locator('.bar-visual').first().evaluate(el=>({width:el.offsetWidth,height:el.offsetHeight,columns:getComputedStyle(el).gridTemplateColumns}))).toEqual(before);
  await beat.evaluate(el=>{const r=el.getBoundingClientRect();el.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,cancelable:true,pointerType:'touch',pointerId:7,isPrimary:true,button:0,clientX:r.x+r.width/2,clientY:r.y+r.height/2}));});
  await page.getByRole('button',{name:'Edit selected beat',exact:true}).click();
  for(const modal of ['#sound-settings-modal','#sound-effects-modal']){
    if(modal.includes('effects'))await page.locator('#sound-effects-btn').click();
    await expect(page.locator(modal)).toBeVisible();
    await settle(page);
    const data=await textGeometry(page,modal),actions=await targets(page,`${modal} button,${modal} [role=button]`);
    const sliders=await targets(page,`${modal} input[type=range]`);
    const box=await page.locator(`${modal} .modal-content`).evaluate(el=>({left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right,width:el.clientWidth,scroll:el.scrollWidth,top:el.getBoundingClientRect().top,bottom:el.getBoundingClientRect().bottom}));
    await evidence(modal.slice(1)+'-geometry',{data,actions,sliders,box});
    await page.screenshot({path:test.info().outputPath(modal.slice(1)+'.png')});
    expect.soft(data.problems).toEqual([]);
    expect.soft(sliders.filter(d=>d.width<43.9)).toEqual([]);
    expect.soft(actions.filter(d=>d.width<43.9||d.height<43.9||(!d.toolbar&&(d.left<0||d.right>width+1)))).toEqual([]);
    expect.soft(box.scroll).toBeLessThanOrEqual(box.width+1);
    expect.soft(box.left).toBeGreaterThanOrEqual(0);expect.soft(box.right).toBeLessThanOrEqual(width);
    expect.soft(box.top).toBeGreaterThanOrEqual(0);expect.soft(box.bottom).toBeLessThanOrEqual(height+1);
  }
});
