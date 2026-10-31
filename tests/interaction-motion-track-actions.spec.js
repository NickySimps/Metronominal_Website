'use strict';
const {test,expect}=require('@playwright/test');const openMotion=require('./motionTestPage.cjs');
async function ready(page){await openMotion(page,test.info().config.metadata);await page.evaluate(async()=>{
 window.a=(await import(new URL('js/appState.js',document.baseURI))).default;__motionObserved=[];window.__actionMotionRects=[];
 new MutationObserver(rs=>{for(const r of rs)for(const n of r.addedNodes)if(n.nodeType===1&&n.dataset.motionKind)__actionMotionRects.push({kind:n.dataset.motionKind,width:parseFloat(n.style.width),height:parseFloat(n.style.height)});}).observe(document.querySelector('[data-interaction-motion-root]'),{childList:true});
 });}
async function modified(page){await page.evaluate(()=>a.updateTrack(0,{mainBeatSound:{sound:'Synth Snare',settings:{}},barSettings:Array.from({length:2},()=>({beats:4,subdivision:1,rests:[],velocities:{},beatSounds:{},beatSlices:{},beatSliceAnchors:{}}))}));}
async function down(page,selector){const b=page.locator(selector).first();await b.scrollIntoViewIfNeeded();await b.evaluate(el=>{const r=el.getBoundingClientRect();el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:71,pointerType:'mouse',isPrimary:true,button:0,clientX:r.x+r.width/2,clientY:r.y+r.height/2}));});return b;}
async function modal(page){const b=await down(page,'.track-reset-btn');await expect(page.locator('#track-action-modal')).toBeVisible();await b.dispatchEvent('pointerup',{pointerId:71,pointerType:'mouse'});}

test('repeated direct Reset is silent when the actual musical track is already reset',async({page})=>{
 await ready(page);await page.locator('.track-reset-btn').first().click();const before=await page.evaluate(()=>a.getMusicalSnapshot());await page.evaluate(()=>{__motionObserved=[];});await page.locator('.track-reset-btn').first().click();expect(await page.evaluate(()=>a.getMusicalSnapshot())).toEqual(before);expect(await page.evaluate(()=>__motionObserved.includes('reset'))).toBe(false);
});
for(const action of ['reset','random'])test('all-unchecked '+action+' modal closes without claiming a musical change',async({page})=>{
 await ready(page);await modified(page);const before=await page.evaluate(()=>a.getMusicalSnapshot());const b=await down(page,action==='reset'?'.track-reset-btn':'.random-btn');await expect(page.locator('#track-action-modal')).toBeVisible();await b.dispatchEvent('pointerup',{pointerId:71,pointerType:'mouse'});
 for(const item of await page.locator('#track-action-modal input[type="checkbox"]').all())await item.uncheck();await page.evaluate(()=>{__motionObserved=[];});await page.locator('[data-track-action-apply]').click();await expect(page.locator('#track-action-modal')).toBeHidden();expect(await page.evaluate(()=>a.getMusicalSnapshot())).toEqual(before);expect(await page.evaluate(()=>__motionObserved.some(k=>k==='reset'||k==='randomize'))).toBe(false);expect(await page.evaluate(()=>__motionObserved.includes('close'))).toBe(true);
});

test('quick track Reset confirms the actual restored structure and sound',async({page})=>{
 await ready(page);await modified(page);await page.locator('.track-reset-btn').first().click();
 expect(await page.evaluate(()=>({bars:a.getTracks()[0].barSettings.length,sound:a.getTracks()[0].mainBeatSound.sound}))).toEqual({bars:1,sound:'Synth Kick'});
 expect(await page.evaluate(()=>__motionObserved)).toContain('reset');
});
test('quick Randomize confirms a real generated pattern',async({page})=>{
 await ready(page);await page.evaluate(()=>{Math.random=()=>0.1;});await page.locator('.random-btn').first().click();
 expect(await page.evaluate(()=>Object.keys(a.getTracks()[0].barSettings[0].beatSlices||{}).length)).toBeGreaterThan(0);
 expect(await page.evaluate(()=>__motionObserved)).toContain('randomize');
});
test('synthetic action hold has decoration and pointercancel removes it without editing',async({page})=>{
 await ready(page);const music=await page.evaluate(()=>a.getMusicalSnapshot());const b=await down(page,'.track-reset-btn');
 expect(await page.locator('[data-interaction-motion-root] [data-motion-kind="hold"]').count()).toBe(1);
 await b.dispatchEvent('pointercancel',{pointerId:71,pointerType:'mouse'});expect(await page.locator('[data-interaction-motion-root] [data-motion-kind="hold"]').count()).toBe(0);
 expect(await page.evaluate(()=>a.getMusicalSnapshot())).toEqual(music);
});
test('held Reset acknowledges the dialog itself rather than incidental native details',async({page})=>{
 await ready(page);const music=await page.evaluate(()=>a.getMusicalSnapshot());await modal(page);
 expect(await page.evaluate(()=>__actionMotionRects.some(r=>r.kind==='open'&&r.height>200&&r.width>200))).toBe(true);
 expect(await page.evaluate(()=>a.getMusicalSnapshot())).toEqual(music);
});
test('parameter checkbox feedback and Cancel preserve the actual music',async({page})=>{
 await ready(page);const music=await page.evaluate(()=>a.getMusicalSnapshot());await modal(page);await page.evaluate(()=>{__motionObserved=[];});
 await page.locator('[data-track-option="track"]').uncheck();await expect(page.locator('[data-track-option="track.volume"]')).not.toBeChecked();
 expect(await page.evaluate(()=>__motionObserved)).toContain('toggle');await page.evaluate(()=>{__motionObserved=[];});
 await page.locator('[data-track-action-cancel]').click();await expect(page.locator('#track-action-modal')).toBeHidden();
 expect(await page.evaluate(()=>__motionObserved)).toContain('close');expect(await page.evaluate(()=>a.getMusicalSnapshot())).toEqual(music);
});
test('parameter Apply confirms only the actual reset after the preview',async({page})=>{
 await ready(page);await modified(page);await modal(page);await page.evaluate(()=>{__motionObserved=[];});
 await page.locator('[data-track-action-apply]').click();await expect(page.locator('#track-action-modal')).toBeHidden();
 expect(await page.evaluate(()=>({bars:a.getTracks()[0].barSettings.length,sound:a.getTracks()[0].mainBeatSound.sound}))).toEqual({bars:1,sound:'Synth Kick'});
 expect(await page.evaluate(()=>__motionObserved)).toContain('reset');
});
