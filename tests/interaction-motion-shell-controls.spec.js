'use strict';
const {test,expect}=require('@playwright/test');
const openMotion=require('./motionTestPage.cjs');
async function ready(page){
 await openMotion(page,test.info().config.metadata);
 await page.evaluate(async()=>{window.a=(await import('/js/appState.js')).default;window.scope=(await import('/js/oscilloscope.js')).default;__motionObserved=[];window.shellEffects=[];new MutationObserver(records=>{for(const r of records)for(const n of r.addedNodes)if(n.nodeType===1&&n.dataset.motionKind)shellEffects.push({kind:n.dataset.motionKind,left:parseFloat(n.style.left),top:parseFloat(n.style.top)});}).observe(document.querySelector('[data-interaction-motion-root]'),{childList:true});});
}
async function clear(page){await page.evaluate(()=>{__motionObserved=[];});}
async function observed(page,kind){await expect.poll(()=>page.evaluate(kind=>__motionObserved.includes(kind),kind)).toBe(true);}

test('TAP confirms an actual accepted BPM, not its first tap or an unchanged interval',async({page})=>{
 await ready(page);
 await page.clock.install({time:new Date('2026-10-29T12:00:00Z')});await page.clock.pauseAt(new Date('2026-10-29T12:00:01Z'));
 const music=await page.evaluate(()=>a.getMusicalSnapshot());
 await page.locator('.tap-tempo-btn').click();expect(await page.evaluate(()=>a.getTempo())).toBe(music.tempo);
 expect(await page.evaluate(()=>__motionObserved.includes('tempo'))).toBe(false);
 await page.clock.runFor(400);await page.locator('.tap-tempo-btn').click();
 expect(await page.evaluate(()=>a.getTempo())).toBe(150);await observed(page,'tempo');
 expect(await page.evaluate(()=>a.getMusicalSnapshot())).toEqual({...music,tempo:150});
 await clear(page);await page.clock.runFor(400);await page.locator('.tap-tempo-btn').click();
 expect(await page.evaluate(()=>__motionObserved.includes('tempo'))).toBe(false);
});

test('sticky controls confirm actual musical adjustments and applied Play/Stop, not bounds or refresh',async({page})=>{
 await ready(page);
 await page.evaluate(()=>{document.body.style.setProperty('min-height','4000px','important');window.scrollTo(0,1100);});
 const sticky=page.locator('#sticky-mobile-controls');await expect(sticky).toHaveClass(/sticky-active/);
 await page.waitForTimeout(200);await clear(page);
 const before=await page.evaluate(()=>a.getMusicalSnapshot());
 await page.locator('#sticky-tempo-increase').click();expect(await page.evaluate(()=>a.getTempo())).toBe(before.tempo+1);await observed(page,'tempo');
 await clear(page);await page.locator('#sticky-volume-decrease').click();
 expect(await page.evaluate(()=>a.getMusicalSnapshot())).toEqual({...before,tempo:before.tempo+1,volume:0.95});await observed(page,'volume');
 await clear(page);await page.locator('#sticky-play-pause-btn').click();await expect.poll(()=>page.evaluate(()=>a.isPlaying())).toBe(true);await observed(page,'play');
 expect(await page.locator('#sticky-play-pause-btn').evaluate(el=>{const r=el.getBoundingClientRect();return shellEffects.some(e=>e.kind==='play'&&Math.abs(e.left-r.left)<1&&Math.abs(e.top-r.top)<1);})).toBe(true);
 await clear(page);await page.locator('#sticky-play-pause-btn').click();await expect.poll(()=>page.evaluate(()=>a.isPlaying())).toBe(false);await observed(page,'stop');
 await page.evaluate(async()=>{a.setVolume(1);(await import('/js/volumeController.js')).default.updateVolumeDisplay();});await clear(page);
 await page.locator('#sticky-volume-increase').click();await page.waitForTimeout(250);expect(await page.evaluate(()=>__motionObserved.includes('volume'))).toBe(false);
 await clear(page);await page.evaluate(async()=>{(await import('/js/stickyControls.js')).default.updateDisplay();});await page.waitForTimeout(250);expect(await page.evaluate(()=>__motionObserved)).toEqual([]);
});

test('global Reset acknowledges completed real reset and preserves theme and local quality, not default no-op',async({page})=>{
 await ready(page);
 const defaults=await page.evaluate(()=>a.getMusicalSnapshot());
 await page.locator('.increase-tempo').click();await clear(page);
 await page.locator('.reset-btn').click();await expect.poll(()=>page.evaluate(()=>a.getMusicalSnapshot())).toEqual(defaults);await observed(page,'reset');
 await clear(page);await page.locator('.reset-btn').click();await page.waitForTimeout(250);expect(await page.evaluate(()=>__motionObserved.includes('reset'))).toBe(false);
 const before=await page.evaluate(()=>({theme:a.getCurrentTheme(),quality:localStorage.getItem('metronominal.visualizationQuality')}));
 await page.locator('.increase-tempo').click();await clear(page);await page.locator('body').press('r');await observed(page,'reset');
 expect(await page.evaluate(()=>({music:a.getMusicalSnapshot(),theme:a.getCurrentTheme(),quality:localStorage.getItem('metronominal.visualizationQuality')}))).toEqual({...before,music:defaults});
});

test('audio unlock acknowledges only a genuinely running native context, once',async({page})=>{
 await ready(page);
 const result=await page.evaluate(async()=>{const interaction=(await import('/js/userInteraction.js')).default;await interaction.handleFirstInteraction();return {flag:interaction.audioContextInitialized,state:a.getAudioContext().state};});
 expect(result).toEqual({flag:true,state:'running'});await observed(page,'ready');
 await clear(page);await page.evaluate(async()=>{await (await import('/js/userInteraction.js')).default.handleFirstInteraction();});await page.waitForTimeout(250);expect(await page.evaluate(()=>__motionObserved)).toEqual([]);
});

test('closed native AudioContext refuses unlock without ready or a fabricated audio API',async({page})=>{
 await ready(page);
 const result=await page.evaluate(async()=>{await a.getAudioContext().close();const interaction=(await import('/js/userInteraction.js')).default;await interaction.handleFirstInteraction();return {flag:interaction.audioContextInitialized,state:a.getAudioContext().state};});
 expect(result).toEqual({flag:false,state:'closed'});await observed(page,'refuse');expect(await page.evaluate(()=>__motionObserved.includes('ready'))).toBe(false);
});

test('named theme no-op and closed-menu Escape do not announce another accepted change',async({page})=>{
 await ready(page);const music=await page.evaluate(()=>a.getMusicalSnapshot());
 await page.locator('#theme-menu-toggle').click();await page.locator('#theme-menu [data-theme="hiVis"]').click();await clear(page);
 await page.locator('#theme-menu [data-theme="hiVis"]').click();expect(await page.evaluate(()=>__motionObserved.includes('theme'))).toBe(false);
 await page.keyboard.press('Escape');await observed(page,'close');await clear(page);await page.keyboard.press('Escape');await page.waitForTimeout(250);expect(await page.evaluate(()=>__motionObserved)).toEqual([]);
 expect(await page.evaluate(()=>a.getMusicalSnapshot())).toEqual(music);
});

test('first gesture audio feedback stays on its visible sticky trigger instead of hidden main transport',async({page})=>{
 await ready(page);await page.evaluate(()=>{document.body.style.setProperty('min-height','4000px','important');scrollTo(0,1100);});
 await expect(page.locator('#sticky-mobile-controls')).toHaveClass(/sticky-active/);await page.waitForTimeout(200);
 await page.locator('#sticky-tempo-increase').click();await observed(page,'ready');
 expect(await page.evaluate(()=>shellEffects.filter(e=>e.kind==='ready').every(e=>e.top>=0&&e.top<innerHeight&&e.left>=0&&e.left<innerWidth))).toBe(true);
});

for(const reduced of [false,true])test(`accepted quality decoration is inert, bounded, finite and geometry-neutral at 320px (reduced=${reduced})`,async({page})=>{
 await page.setViewportSize({width:320,height:640});await page.emulateMedia({reducedMotion:reduced?'reduce':'no-preference'});await ready(page);
 await page.locator('details').filter({has:page.locator('#rehearsal-tools')}).locator(':scope > summary').click();
 const select=page.getByRole('combobox',{name:'Visualization quality'});await select.scrollIntoViewIfNeeded();await select.focus();
 const result=await select.evaluate(el=>{
  const before=el.getBoundingClientRect().toJSON(),style=el.getAttribute('style'),music=a.getMusicalSnapshot(),mode=scope.mode;const samples=[];
  for(let i=0;i<15;i++){
   el.value=i%2?'off':'full';el.dispatchEvent(new Event('change',{bubbles:true}));
   const effects=[...document.querySelectorAll('[data-interaction-motion-root] [data-motion-kind]')],effect=effects.at(-1),r=el.getBoundingClientRect(),s=getComputedStyle(effect);
   samples.push({count:effects.length,kind:effect.dataset.motionKind,left:parseFloat(effect.style.left),top:parseFloat(effect.style.top),width:parseFloat(effect.style.width),height:parseFloat(effect.style.height),target:{left:r.left,top:r.top,width:r.width,height:r.height},animation:s.animationName,duration:s.animationDuration,pointer:s.pointerEvents});
  }
  const root=document.querySelector('[data-interaction-motion-root]');return {before,after:el.getBoundingClientRect().toJSON(),style,afterStyle:el.getAttribute('style'),music,afterMusic:a.getMusicalSnapshot(),mode,afterMode:scope.mode,focus:document.activeElement===el,inert:root.inert,aria:root.getAttribute('aria-hidden'),samples};
 });
 expect(result.after).toEqual(result.before);expect(result.afterStyle).toBe(result.style);expect(result.afterMusic).toEqual(result.music);expect(result.afterMode).toBe(result.mode);expect(result.focus).toBe(true);expect(result.inert).toBe(true);expect(result.aria).toBe('true');
 for(const e of result.samples){expect(e.count).toBeLessThanOrEqual(8);expect(e.kind).toBe('quality');expect(e.pointer).toBe('none');for(const k of ['left','top','width','height'])expect(Math.abs(e[k]-e.target[k])).toBeLessThan(.001);expect(e.top).toBeGreaterThanOrEqual(0);expect(e.top+e.height).toBeLessThanOrEqual(640);expect(e.left).toBeGreaterThanOrEqual(0);expect(e.left+e.width).toBeLessThanOrEqual(320);if(reduced)expect(e.animation).toBe('none');else expect(parseFloat(e.duration)).toBeLessThanOrEqual(.2);}
 await test.info().attach('quality-geometry',{body:Buffer.from(JSON.stringify(result)),contentType:'application/json'});
 await expect(page.locator('[data-interaction-motion-root] [data-motion-kind]')).toHaveCount(0);const count=await page.evaluate(()=>__motionObserved.length);await page.waitForTimeout(350);expect(await page.evaluate(()=>__motionObserved.length)).toBe(count);
 await page.screenshot({path:test.info().outputPath('quality-320-settled.png')});
});

test('Keep Awake is only a stored desire while stopped, never fabricated native acceptance',async({page})=>{
 await ready(page);await page.evaluate(async()=>{await (await import('/js/userInteraction.js')).default.handleFirstInteraction();});await clear(page);
 const before=await page.evaluate(()=>a.getMusicalSnapshot());await page.locator('#screen-off-toggle-btn').click();
 expect(await page.evaluate(()=>a.isWakeLockEnabled())).toBe(true);expect(await page.evaluate(()=>a.isPlaying())).toBe(false);
 expect(await page.evaluate(()=>__motionObserved.some(k=>['ready','confirm','toggle'].includes(k)))).toBe(false);
 await page.locator('#screen-off-toggle-btn').click();expect(await page.evaluate(()=>a.isWakeLockEnabled())).toBe(false);expect(await page.evaluate(()=>a.getMusicalSnapshot())).toEqual(before);
 await test.info().attach('wake-lock-capability',{body:Buffer.from(JSON.stringify(await page.evaluate(()=>({secure:isSecureContext,api:'wakeLock' in navigator,nativeAccepted:false,reason:'Stopped preference toggle does not request a sentinel; native lifecycle lives in playbackController outside this batch.'})))),contentType:'application/json'});
});

test('real joined client reset refuses without a reset acknowledgement or music mutation',async({page,browser})=>{
 await ready(page);const context=await browser.newContext({serviceWorkers:'block'});
 try{
  const client=await context.newPage();await require('./workflowTestPage.cjs')(client,test.info().config.metadata);await client.goto(page.url());
  await expect(client.locator('#workflow-tools-status')).toContainText('Editing previews');await expect.poll(()=>client.evaluate(()=>window.isHost)).toBe(false);
  const result=await client.evaluate(async()=>{const a=(await import('/js/appState.js')).default,ui=(await import('/js/uiController.js')).default;const before=a.getMusicalSnapshot(),motion=[];new MutationObserver(rs=>{for(const r of rs)for(const n of r.addedNodes)if(n.nodeType===1&&n.dataset.motionKind)motion.push(n.dataset.motionKind);}).observe(document.querySelector('[data-interaction-motion-root]'),{childList:true});const accepted=await ui.resetToDefaults();await Promise.resolve();return {before,after:a.getMusicalSnapshot(),accepted,motion};});
  expect(result.accepted).toBe(false);expect(result.after).toEqual(result.before);expect(result.motion).not.toContain('reset');
 }finally{await context.close();}
});

test('sticky pending toggle waits for the real engine and server state before acknowledging',async({page})=>{
 await ready(page);await page.evaluate(async()=>{
  document.body.style.setProperty('min-height','4000px','important');scrollTo(0,1100);
  const engine=(await import('/js/metronomeEngine.js')).default,original=engine.togglePlay;let release;const held=new Promise(r=>release=r);window.releaseShellToggle=release;
  engine.togglePlay=async(...args)=>{window.shellToggleReached=true;await held;return original(...args);};
 });
 await expect(page.locator('#sticky-mobile-controls')).toHaveClass(/sticky-active/);await page.locator('#sticky-play-pause-btn').click();await page.waitForFunction(()=>window.shellToggleReached);
 expect(await page.evaluate(()=>a.isPlaying())).toBe(false);expect(await page.evaluate(()=>__motionObserved.includes('play'))).toBe(false);
 await page.evaluate(()=>releaseShellToggle());await expect.poll(()=>page.evaluate(()=>a.isPlaying())).toBe(true);await observed(page,'play');
});

test('Reset does not announce completion while its real Stop is held',async({page})=>{
 await ready(page);const defaults=await page.evaluate(()=>a.getMusicalSnapshot());await page.locator('.increase-tempo').click();await page.locator('#start-stop-btn').click();await expect.poll(()=>page.evaluate(()=>a.isPlaying())).toBe(true);
 await page.evaluate(async()=>{const engine=(await import('/js/metronomeEngine.js')).default,original=engine.togglePlay;let release;const held=new Promise(r=>release=r);window.releaseShellStop=release;engine.togglePlay=async(...args)=>{window.shellStopReached=true;await held;return original(...args);};__motionObserved=[];});
 await page.locator('.reset-btn').click();await page.waitForFunction(()=>window.shellStopReached);
 expect(await page.evaluate(()=>({playing:a.isPlaying(),tempo:a.getTempo(),reset:__motionObserved.includes('reset')}))).toEqual({playing:true,tempo:defaults.tempo+1,reset:false});
 await page.evaluate(()=>releaseShellStop());await expect.poll(()=>page.evaluate(()=>a.isPlaying())).toBe(false);await expect.poll(()=>page.evaluate(()=>a.getMusicalSnapshot())).toEqual(defaults);await observed(page,'reset');
});

test('first keyboard gesture uses visible sticky feedback when the document, not a control, owns focus',async({page})=>{
 await ready(page);await page.evaluate(()=>{document.body.style.setProperty('min-height','4000px','important');scrollTo(0,1100);});
 await expect(page.locator('#sticky-mobile-controls')).toHaveClass(/sticky-active/);await page.waitForTimeout(200);
 await page.locator('body').press('Escape');await observed(page,'ready');
 expect(await page.evaluate(()=>shellEffects.filter(e=>e.kind==='ready').every(e=>e.top>=0&&e.top<innerHeight&&e.left>=0&&e.left<innerWidth))).toBe(true);
});

test('quality acknowledges applied device preference only, preserving musical state and native visual mode',async({page})=>{
 await ready(page);await page.locator('details').filter({has:page.locator('#rehearsal-tools')}).locator(':scope > summary').click();
 const select=page.getByRole('combobox',{name:'Visualization quality'});await select.scrollIntoViewIfNeeded();
 const before=await page.evaluate(()=>({music:a.getMusicalSnapshot(),mode:scope.mode,volume:a.getVolume()}));
 await select.selectOption('off');
 expect(await page.evaluate(()=>({music:a.getMusicalSnapshot(),mode:scope.mode,volume:a.getVolume(),fps:scope.renderingPolicy.fps,saved:localStorage.getItem('metronominal.visualizationQuality')}))).toEqual({...before,fps:0,saved:'off'});
 await observed(page,'quality');
 await clear(page);await select.selectOption('off');
 await page.waitForTimeout(250);expect(await page.evaluate(()=>__motionObserved)).toEqual([]);
 await page.reload();await expect(page.locator('select[aria-label="Visualization quality"]')).toHaveValue('off');
});
