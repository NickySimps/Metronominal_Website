const { test, expect } = require('@playwright/test');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
let web, origin;
test.beforeAll(async () => {
  const root = path.resolve(__dirname, '..');
  web = http.createServer((req, res) => {
    const file = path.resolve(root, '.' + new URL(req.url, 'http://local').pathname);
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (err, data) => { if (err) return res.writeHead(404).end(); res.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : 'text/javascript'); res.end(data); });
  });
  await new Promise(r => web.listen(0, '127.0.0.1', r)); origin = `http://127.0.0.1:${web.address().port}`;
});
test.afterAll(async () => { await new Promise(r => web.close(r)); });
async function fixture(page, count = 64) {
  await page.route('**/js/barDisplayController.js', route => route.fulfill({contentType:'text/javascript',body:`import m from './soundSettingsModal.js';import a from './appState.js';export default {applyBeatAction(b){const bar=b.closest('.bar-visual');if(document.body.classList.contains('beat-edit-mode')&&!a.isRestMode()&&!a.isAccentMode()&&!a.isSliceMode())m.show(Number(bar.dataset.containerIndex),b.classList.contains('main-beat-marker')?'mainBeatSound':'subdivisionSound',{barIndex:Number(bar.dataset.barIndex),beatIndex:Number(b.dataset.beatIndex)});return {mode:'fixture'};}};`}));
  await page.route('**/js/soundSettingsModal.js', route => route.fulfill({contentType:'text/javascript', body:'export default {show(...args){window.edits.push(args)}};'}));
  await page.route('**/fixture.html', route => route.fulfill({contentType:'text/html', body:`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/beat-precision.css"><style>body{margin:12px;min-height:1600px}.bar-visual{display:grid;grid-template-columns:repeat(8,1fr);width:280px;gap:2px;margin-top:200px}.beat-square{height:16px;background:#bbb}</style><div id="controls"></div><main id="all-tracks-wrapper"></main>`}));
  await page.goto(origin + '/fixture.html');
  await page.evaluate(async count => {
    window.edits = []; window.legacy = 0; window.longpress = 0;
    window.state = (await import('/js/appState.js')).default;
    window.module = await import('/js/beatPrecision.js');
    const slotsModule = await import('/js/beatTiming.js');
    if (!state.getTracks().length) state.addTrack();
    const denseBar = {beats:8,subdivision:count/8,rests:[]};
    state.updateTrack(0,{barSettings:[{beats:4,subdivision:1,rests:[]},{beats:4,subdivision:1,rests:[]},denseBar]});
    const slots = slotsModule.getVisualBeatSlots(state.getTracks()[0].barSettings[2]);
    const bar = document.createElement('div'); bar.className = 'bar-visual'; bar.dataset.containerIndex = '0'; bar.dataset.barIndex = '2';
    for(const slot of slots){const beat=document.createElement('div');beat.className='beat-square'+(slot.mainBeat?' main-beat-marker':'');beat.dataset.beatIndex=slot.index;bar.append(beat);}
    const track=document.createElement('section');track.className='track';track.dataset.containerIndex='0';
    track.innerHTML='<div class="mode-buttons-col"><button class="beat-edit-btn">Beat</button></div>';
    track.append(bar);document.querySelector('main').append(track);
    let timer; bar.addEventListener('pointerdown',()=>{legacy++;timer=setTimeout(()=>longpress++,350)});bar.addEventListener('pointerup',()=>clearTimeout(timer));bar.addEventListener('click',()=>legacy++);
    window.controller = module.initializeBeatPrecision(document.querySelector('#controls'));
  }, count);
}
async function activate(page) {
  await page.evaluate(()=>document.body.classList.add('beat-edit-mode'));
  await expect(page.locator('[data-beat-precision-toggle]')).toHaveAttribute('aria-pressed','true');
}
test('contextual assist follows existing Beat Edit mode without a global toolbar', async ({page}) => {
  await fixture(page);
  await expect(page.locator('#controls')).toBeEmpty();
  await expect(page.locator('.track .beat-precision')).toBeHidden();
  await activate(page);
  await expect(page.locator('.track .beat-precision')).toBeVisible();
  await expect(page.getByRole('button',{name:'Edit selected beat'})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Next beat',exact:true})).toHaveCount(0);
  const r=await page.locator('[data-beat-precision-toggle]').boundingBox();expect(r.width).toBeGreaterThanOrEqual(44);expect(r.height).toBeGreaterThanOrEqual(44);
  await page.evaluate(()=>document.body.classList.remove('beat-edit-mode'));
  await expect(page.locator('.track .beat-precision')).toBeHidden();
});
async function pointer(page, type, index, opts = {}) {
  return page.evaluate(({type,index,opts}) => {
    const beat=document.querySelectorAll('.beat-square')[index], r=beat.getBoundingClientRect();
    const e=new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:1,pointerType:'touch',isPrimary:true,clientX:r.x+r.width/2,clientY:r.y+r.height/2,...opts});
    beat.dispatchEvent(e);return e.defaultPrevented;
  },{type,index,opts});
}
test('hold preview maps multirow geometry and slow fine movement; release opens the exact editor without musical mutation', async ({page}) => {
  await fixture(page); await page.clock.install({time:new Date('2025-12-31T23:59:00Z')});await page.clock.pauseAt(new Date('2026-01-01T00:00:00Z'));
  await activate(page);
  const rect = await page.locator('.bar-visual').boundingBox();
  await pointer(page,'pointerdown',19); await page.clock.runFor(400);
  await expect(page.locator('.beat-precision-preview')).toBeVisible();
  await expect(page.locator('.beat-precision-preview')).toContainText('Track 1 · Bar 3 · Beat 20');
  const preview = await page.locator('.beat-precision-preview').boundingBox();
  const targetRect=await page.locator('.beat-square').nth(19).boundingBox();
  expect(preview.y + preview.height <= targetRect.y || preview.y >= targetRect.y + targetRect.height || preview.x+preview.width<=targetRect.x || preview.x>=targetRect.x+targetRect.width).toBeTruthy();
  const cells=await page.locator('.beat-precision-cell').evaluateAll(xs=>xs.map(x=>{const r=x.getBoundingClientRect();return [r.width,r.height]}));
  expect(cells.length).toBeGreaterThan(1);expect(cells.every(([w,h])=>w>=44&&h>=44)).toBe(true);
  await pointer(page,'pointermove',19,{clientX:140,timeStamp:420});
  await page.clock.runFor(400);
  await expect(page.locator('.beat-precision-preview')).toHaveAttribute('data-scale','fine');
  await pointer(page,'pointerup',19);
  await expect(page.locator('.beat-precision-selected')).toHaveAttribute('data-beat-index','19');
  expect(await page.evaluate(()=>edits)).toEqual([[0,'subdivisionSound',{barIndex:2,beatIndex:19}]]);
  expect(await page.evaluate(()=>legacy)).toBe(0);
  await expect(page.locator('.beat-precision-preview')).toHaveCount(0);
});
test('keyboard navigation, authority, playback, rerender, cancellation and cleanup', async ({page}) => {
  await fixture(page,32); await page.clock.install({time:new Date('2025-12-31T23:59:00Z')});await page.clock.pauseAt(new Date('2026-01-01T00:00:00Z'));
  const toggle=page.getByRole('button',{name:'Precision beat selection',exact:true}); await activate(page);
  expect(await page.evaluate(()=>module.initializeBeatPrecision(document.querySelector('#controls'))===controller)).toBe(true);
  expect(await page.evaluate(()=>module.initializeBeatPrecision(null))).toBe(null);
  await toggle.focus(); await page.keyboard.press('ArrowRight');
  await expect(page.locator('.beat-precision-selected')).toHaveAttribute('data-beat-index','0');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.beat-precision-selected')).toHaveAttribute('data-beat-index','1');
  await page.evaluate(()=>document.dispatchEvent(new CustomEvent('syncrolechange',{detail:{state:'connected',isHost:false}})));
  await expect(page.locator('.track .beat-precision')).toBeHidden();
  await expect(page.locator('.beat-precision-selected')).toHaveCount(0);
  await pointer(page,'pointerdown',3); await page.clock.runFor(400); await pointer(page,'pointercancel',3);
  await expect(page.locator('.beat-precision-preview')).toHaveCount(0);
  await pointer(page,'pointerdown',3);await pointer(page,'pointermove',11);await page.clock.runFor(500);await pointer(page,'pointerup',11);
  await expect(page.locator('.beat-precision-selected')).toHaveCount(0);
  expect(await page.evaluate(()=>edits)).toEqual([]);
  await page.evaluate(()=>document.dispatchEvent(new CustomEvent('syncrolechange',{detail:{state:'connected',isHost:true}})));
  for(const name of ['roomauthoritychange','playbackstatechange','historyboundary','appstatechange','blur']) {
    await pointer(page,'pointerdown',3);await page.clock.runFor(400);
    await page.evaluate(name=>(name==='blur'?window:document).dispatchEvent(new Event(name)),name);
    await expect(page.locator('.beat-precision-preview')).toHaveCount(0);
  }
  await pointer(page,'pointerdown',3);await pointer(page,'pointerup',3);
  expect(await page.evaluate(()=>edits.length)).toBe(1);
  await page.evaluate(()=>document.querySelector('.bar-visual').replaceChildren());
  await expect(page.locator('.beat-precision-selected')).toHaveCount(0);
  await toggle.focus(); await page.keyboard.press('Escape'); await expect(toggle).toBeFocused();
  await page.evaluate(()=>{controller.destroy();controller.destroy()});
  await expect(toggle).toHaveCount(0);expect(await page.evaluate(()=>edits.length)).toBe(1);
});
test('precision restores pan/pinch over paint modes; fast/slow exact targeting, multi-touch and outside cancel', async ({page}) => {
  await fixture(page);await page.clock.install({time:new Date('2025-12-31T23:59:00Z')});await page.clock.pauseAt(new Date('2026-01-01T00:00:00Z'));
  await page.addStyleTag({content:'.bar-visual.rest-mode-active{touch-action:none}'});
  await page.evaluate(()=>document.querySelector('.bar-visual').classList.add('rest-mode-active'));
  const toggle=page.getByRole('button',{name:'Precision beat selection',exact:true}); await activate(page);
  expect(await page.locator('.bar-visual').evaluate(el=>getComputedStyle(el).touchAction)).toContain('pan-y');
  expect(await page.locator('.bar-visual').evaluate(el=>getComputedStyle(el).touchAction)).toContain('pinch-zoom');
  // Each event has an explicit timestamp. Same physical delta: fast = two beats, fine = one.
  async function drag(slow) {
    await pointer(page,'pointerdown',18);await page.clock.runFor(slow?700:400);
    const p=await page.locator('.beat-square').nth(18).boundingBox();
    await page.evaluate(({x,y,slow})=>{
      const target=document.querySelectorAll('.beat-square')[18];
      for(const [dx,t] of [[0,1000],[84,slow?1400:1010]]) {
        const e=new PointerEvent('pointermove',{bubbles:true,pointerId:1,isPrimary:true,pointerType:'touch',clientX:x+dx,clientY:y});Object.defineProperty(e,'timeStamp',{value:t});target.dispatchEvent(e);
      }
    },{x:p.x+p.width/2,y:p.y+p.height/2,slow});
    const text=await page.locator('.beat-precision-preview').innerText();
    await pointer(page,'pointerup',20);return text;
  }
  expect(await drag(false)).toContain('Beat 21');
  expect(await drag(true)).toContain('Beat 20');
  await pointer(page,'pointerdown',3);await page.clock.runFor(400);
  await pointer(page,'pointerdown',4,{pointerId:2,isPrimary:false});
  await expect(page.locator('.beat-precision-preview')).toHaveCount(0);
  expect(await page.evaluate(()=>legacy)).toBe(0);
  await pointer(page,'pointerup',3);await expect(page.locator('.beat-precision-selected')).toHaveCount(0);
  await pointer(page,'pointerdown',3);await pointer(page,'pointerup',3,{clientX:-20});
  await expect(page.locator('.beat-precision-selected')).toHaveCount(0);
  await toggle.click();
  expect(await page.locator('.bar-visual').evaluate(el=>getComputedStyle(el).touchAction)).toBe('none');
  await pointer(page,'pointerdown',3);await page.clock.runFor(400);await pointer(page,'pointerup',3);
  expect(await page.evaluate(()=>longpress)).toBe(1);
});
test('continuous slow movement enters fine mode; same-DOM rerender invalidates selection; destroy restores gestures', async ({page}) => {
  await fixture(page);await page.clock.install({time:new Date('2025-12-31T23:59:00Z')});await page.clock.pauseAt(new Date('2026-01-01T00:00:00Z'));
  await activate(page);
  await pointer(page,'pointerdown',18);await page.clock.runFor(400);
  await expect(page.locator('[data-beat-precision-lens]')).toBeVisible();
  const r=await page.locator('.beat-square').nth(18).boundingBox();
  await page.evaluate(({x,y})=>{
    const target=document.querySelectorAll('.beat-square')[18];
    for(let i=0;i<=6;i++) {const e=new PointerEvent('pointermove',{bubbles:true,pointerId:1,isPrimary:true,clientX:x+i*2,clientY:y});Object.defineProperty(e,'timeStamp',{value:1000+i*50});target.dispatchEvent(e);}
  },{x:r.x+r.width/2,y:r.y+r.height/2});
  await expect(page.locator('.beat-precision-preview')).toHaveAttribute('data-scale','fine');
  await pointer(page,'pointerup',18);
  await page.evaluate(()=>document.querySelector('.bar-visual').dataset.containerIndex='1');
  await expect(page.locator('.beat-precision-selected')).toHaveCount(0);
  await page.evaluate(()=>controller.destroy());
  expect(await page.locator('main').evaluate(el=>el.classList.contains('beat-precision-enabled'))).toBe(false);
});
for(const width of [320,390,1280]) test(`bounded legible geometry at ${width}px, no musical/transport/theme changes`,async({page},testInfo)=>{
  await page.setViewportSize({width,height:844});await fixture(page);await page.clock.install({time:new Date('2025-12-31T23:59:00Z')});await page.clock.pauseAt(new Date('2026-01-01T00:00:00Z'));
  const before=await page.evaluate(()=>({music:state.getMusicalSnapshot(),playing:state.isPlaying(),theme:document.documentElement.getAttribute('style')}));
  await activate(page);await pointer(page,'pointerdown',19);await page.clock.runFor(700);
  const geometry=await page.evaluate(()=>{
    const r=document.querySelector('.beat-precision-preview').getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,overflow:document.documentElement.scrollWidth>innerWidth};
  });
  expect(geometry.left).toBeGreaterThanOrEqual(0);expect(geometry.right).toBeLessThanOrEqual(width);expect(geometry.bottom).toBeLessThanOrEqual(844);expect(geometry.overflow).toBe(false);
  expect(await page.evaluate(()=>({music:state.getMusicalSnapshot(),playing:state.isPlaying(),theme:document.documentElement.getAttribute('style')}))).toEqual(before);
  await page.screenshot({path:testInfo.outputPath(`precision-${width}.png`)});
  await pointer(page,'pointerup',19);
});
test('native touch vertical pan before activation is not blocked in precision or ordinary mode', async ({page,browserName})=>{
  test.skip(browserName!=='chromium','Native CDP touch input is Chromium-only; synthetic pointer/cancellation checks still run in all engines.');
  await fixture(page);const cdp=await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true});
  for(const enabled of [false,true]){
    await page.evaluate(()=>window.scrollTo(0,0));
    if(enabled) await activate(page);
    const r=await page.locator('.beat-square').nth(19).boundingBox();const x=r.x+r.width/2,y=r.y+r.height/2;
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});
    for(let dy=10;dy<=100;dy+=10) await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-dy,id:1}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await expect.poll(()=>page.evaluate(()=>scrollY)).toBeGreaterThan(0);
    await expect(page.locator('.beat-precision-preview')).toHaveCount(0);
  }
});
test('edit gate checks live playback and role, not disabled styling alone',async({page})=>{
  await fixture(page);await activate(page);
  await page.evaluate(()=>state.togglePlay());
  await pointer(page,'pointerdown',19);await pointer(page,'pointerup',19);
  await expect(page.locator('.track .beat-precision')).toBeHidden();
  await page.locator('.beat-square').nth(19).dispatchEvent('click');
  expect(await page.evaluate(()=>edits)).toEqual([]);
  await page.evaluate(()=>{state.togglePlay();document.dispatchEvent(new Event('playbackstatechange'));});
  await page.evaluate(()=>document.dispatchEvent(new CustomEvent('syncrolechange',{detail:{state:'connected',isHost:false}})));
  await pointer(page,'pointerdown',19);await pointer(page,'pointerup',19);
  await expect(page.locator('.track .beat-precision')).toBeHidden();
  await page.locator('.beat-square').nth(19).dispatchEvent('click');
  expect(await page.evaluate(()=>edits)).toEqual([]);
  await page.evaluate(()=>document.dispatchEvent(new CustomEvent('syncrolechange',{detail:{state:'connected',isHost:true}})));
  await pointer(page,'pointerdown',19);await pointer(page,'pointerup',19);
  expect(await page.evaluate(()=>edits)).toEqual([[0,'subdivisionSound',{barIndex:2,beatIndex:19}]]);
});
test('magnified 44px target hit areas open the selected beat directly in Beat Edit mode', async({page})=>{
  await fixture(page);await page.clock.install({time:new Date('2025-12-31T23:59:00Z')});await page.clock.pauseAt(new Date('2026-01-01T00:00:00Z'));
  await activate(page);
  await pointer(page,'pointerdown',19);await page.clock.runFor(400);
  const cell=page.locator('.beat-precision-preview').getByRole('button',{name:'Edit beat 21',exact:true});
  await expect(cell).toBeVisible();const r=await cell.boundingBox();expect(r.width).toBeGreaterThanOrEqual(44);expect(r.height).toBeGreaterThanOrEqual(44);
  await cell.dispatchEvent('pointerup',{pointerId:1,isPrimary:true,clientX:r.x+r.width/2,clientY:r.y+r.height/2});
  await expect(page.locator('.beat-precision-selected')).toHaveAttribute('data-beat-index','20');
  expect(await page.evaluate(()=>edits)).toEqual([[0,'subdivisionSound',{barIndex:2,beatIndex:20}]]);
});
test('boundary jitter is stable under controlled timestamps',async({page})=>{
  await fixture(page);await page.clock.install({time:new Date('2025-12-31T23:59:00Z')});await page.clock.pauseAt(new Date('2026-01-01T00:00:00Z'));
  await activate(page);await pointer(page,'pointerdown',18);await page.clock.runFor(400);
  const labels=await page.evaluate(()=>{
    const beat=document.querySelectorAll('.beat-square')[18],r=beat.getBoundingClientRect(),labels=[];
    for(const [i,dx] of [18,21,18,14].entries()){
      const e=new PointerEvent('pointermove',{bubbles:true,pointerId:1,isPrimary:true,clientX:r.x+r.width/2+dx,clientY:r.y+r.height/2});Object.defineProperty(e,'timeStamp',{value:1000+i});beat.dispatchEvent(e);labels.push(document.querySelector('.beat-precision-preview').firstElementChild.textContent);
    } return labels;
  });
  expect(labels).toEqual(['Track 1 · Bar 3 · Beat 19','Track 1 · Bar 3 · Beat 20','Track 1 · Bar 3 · Beat 20','Track 1 · Bar 3 · Beat 19']);
});
test('only enabled bar targeting suppresses native hold menus, without preventing pointer pan defaults',async({page})=>{
  await fixture(page);
  expect(await page.locator('.beat-square').first().evaluate(el=>{const e=new Event('contextmenu',{bubbles:true,cancelable:true});el.dispatchEvent(e);return e.defaultPrevented})).toBe(true);
  await activate(page);
  expect(await pointer(page,'pointerdown',3)).toBe(false);
  expect(await page.locator('.beat-square').first().evaluate(el=>{const e=new Event('contextmenu',{bubbles:true,cancelable:true});el.dispatchEvent(e);return e.defaultPrevented})).toBe(true);
});
test('Escape belongs to an unrelated editor, not merely an enabled Precision mode', async ({page}) => {
  await fixture(page);
  await activate(page);
  await page.evaluate(()=>{
    const input=document.createElement('input');input.setAttribute('aria-label','Other editor field');
    document.body.append(input);input.focus();
    window.otherEscapes=0;input.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();window.otherEscapes++;}});
  });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('textbox',{name:'Other editor field'})).toBeFocused();
  expect(await page.evaluate(()=>window.otherEscapes)).toBe(1);
  await page.evaluate(()=>{
    const input=document.querySelector('[aria-label="Other editor field"]');
    const replacement=input.cloneNode();input.replaceWith(replacement);replacement.focus();
  });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('textbox',{name:'Other editor field'})).toBeFocused();
});

test('normal quick tap selects without opening; assisted Beat Edit tap opens exactly the target without changing the song', async ({page}) => {
  await fixture(page);
  await expect(page.locator('[data-beat-precision-toggle]')).toBeHidden();
  expect(await pointer(page,'pointerdown',19)).toBe(false);await pointer(page,'pointerup',19);
  expect(await page.evaluate(()=>legacy)).toBe(0);
  expect(await page.evaluate(()=>edits)).toEqual([]);
  await activate(page);
  const before=await page.evaluate(()=>state.getMusicalSnapshot());
  expect(await pointer(page,'pointerdown',19)).toBe(false);await pointer(page,'pointerup',19);
  await expect(page.locator('.beat-precision-selected')).toHaveAttribute('data-beat-index','19');
  expect(await page.evaluate(()=>legacy)).toBe(0);
  expect(await page.evaluate(()=>state.getMusicalSnapshot())).toEqual(before);
  await expect(page.getByRole('button',{name:'Edit selected beat'})).toHaveCount(0);
  expect(await page.evaluate(()=>edits)).toEqual([[0,'subdivisionSound',{barIndex:2,beatIndex:19}]]);
});
for (const mode of ['normal','rest','accent','slice']) test(`default ${mode} hold shows magnifier without opening sound editor`,async({page})=>{
  await fixture(page);await page.clock.install();
  await page.evaluate(mode=>{if(mode!=='normal'){state['set'+mode[0].toUpperCase()+mode.slice(1)+'Mode'](true);document.body.classList.add(mode+'-mode');}},mode);
  const before=await page.evaluate(()=>state.getMusicalSnapshot());
  await pointer(page,'pointerdown',19);await page.clock.runFor(400);
  await expect(page.locator('[data-beat-precision-lens]')).toBeVisible();
  expect(await page.evaluate(()=>state.getMusicalSnapshot())).toEqual(before);
  await pointer(page,'pointercancel',19);await pointer(page,'pointerup',19);
  expect(await page.evaluate(()=>edits)).toEqual([]);
});
for (const [width,height] of [[320,256],[390,700],[844,390]]) test(`tall dense region has a visible finger-clear lens in ${width}x${height}`,async({page})=>{
  await page.setViewportSize({width,height});await fixture(page);await page.clock.install();
  await page.addStyleTag({content:'.bar-visual{margin-top:0;height:800px;grid-template-columns:repeat(4,1fr)}.beat-square{height:auto}'});
  await pointer(page,'pointerdown',11);await page.clock.runFor(400);
  await expect(page.locator('[data-beat-precision-lens]')).toBeVisible();
  const geometry=await page.evaluate(()=>{const l=document.querySelector('[data-beat-precision-lens]').getBoundingClientRect(),b=document.querySelectorAll('.beat-square')[11].getBoundingClientRect();return {bounded:l.left>=0&&l.right<=innerWidth&&l.top>=0&&l.bottom<=innerHeight,clear:l.bottom<=b.top||l.top>=b.bottom||l.right<=b.left||l.left>=b.right};});
  expect(geometry).toEqual({bounded:true,clear:true});
});
