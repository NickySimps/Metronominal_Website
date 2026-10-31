'use strict';
const { test, expect } = require('@playwright/test');

async function fixture(page) {
  await page.goto('./beat-precision.css');
  await page.setContent('<!doctype html><html><body><button id="target" style="position:absolute;left:40px;top:80px;width:120px;height:44px">Save</button></body></html>');
  await page.evaluate(async () => { window.motion = await import(new URL('js/interactionMotion.js', document.baseURI)); });
  await page.addStyleTag({ url: new URL('interaction-motion.css', page.url()).href });
  await page.evaluate(() => { window.runtime = motion.initializeInteractionMotion(document); });
}

test('decorative motion owns a disposable layer without changing source geometry or input', async ({ page }) => {
  await page.goto('./beat-precision.css');
  await page.setContent('<!doctype html><html><body><button id="target" style="position:absolute;left:40px;top:80px;width:120px;height:44px">Save</button></body></html>');
  const available = await page.evaluate(async () => {
    window.motion = await import(new URL('js/interactionMotion.js', document.baseURI)).catch(() => null);
    return typeof window.motion?.initializeInteractionMotion === 'function' && typeof window.motion?.emitInteractionMotion === 'function';
  });
  expect(available, 'The actual interaction-motion module must supply the mounted runtime').toBe(true);
  await page.addStyleTag({ url: new URL('interaction-motion.css', page.url()).href });
  const observation = await page.evaluate(() => {
    const target = document.querySelector('#target'), before = target.outerHTML, box = target.getBoundingClientRect().toJSON();
    let clicks = 0; target.addEventListener('click', () => clicks++);
    const runtime = motion.initializeInteractionMotion(document), again = motion.initializeInteractionMotion(document);
    const accepted = motion.emitInteractionMotion(target, 'save');
    const root = document.querySelector('[data-interaction-motion-root]');
    const effect = root?.querySelector('[data-motion-kind="save"]');
    const result = { mounted: !!root, idempotent: runtime === again, rootCount: document.querySelectorAll('[data-interaction-motion-root]').length,
      decorative: root?.getAttribute('aria-hidden') === 'true' && root?.inert === true && getComputedStyle(root).pointerEvents === 'none',
      effect: !!effect && accepted !== false, finite: effect ? getComputedStyle(effect).animationIterationCount !== 'infinite' : false,
      sourceUnchanged: target.outerHTML === before, geometryUnchanged: JSON.stringify(target.getBoundingClientRect().toJSON()) === JSON.stringify(box) };
    target.click(); result.clicks = clicks; runtime.destroy(); result.cleaned = !document.querySelector('[data-interaction-motion-root]');
    return result;
  });
  expect(observation).toEqual({mounted:true,idempotent:true,rootCount:1,decorative:true,effect:true,finite:true,sourceUnchanged:true,geometryUnchanged:true,clicks:1,cleaned:true});
});

test('motion never accumulates an unbounded number of effects during a burst', async ({ page }) => {
  await fixture(page);
  const count = await page.evaluate(() => {
    const target = document.querySelector('#target');
    for (let i=0;i<200;i++) motion.emitInteractionMotion(target,'save');
    return document.querySelector('[data-interaction-motion-root]').childElementCount;
  });
  expect(count).toBeGreaterThan(0); expect(count).toBeLessThanOrEqual(8);
  await expect(page.locator('[data-interaction-motion-root] > *')).toHaveCount(0);
});

test('reduced motion supplies a static confirmation and cancels moving effects when changed', async ({ page }) => {
  await page.emulateMedia({ reducedMotion:'reduce' });
  await fixture(page);
  const result = await page.evaluate(() => {
    motion.emitInteractionMotion(document.querySelector('#target'),'save');
    const effect = document.querySelector('[data-motion-kind="save"]');
    return { present:!!effect, animation:getComputedStyle(effect).animationName, source:document.querySelector('#target').textContent };
  });
  expect(result).toEqual({present:true,animation:'none',source:'Save'});
  await page.emulateMedia({ reducedMotion:'no-preference' });
  await page.evaluate(() => motion.emitInteractionMotion(document.querySelector('#target'),'save'));
  await page.emulateMedia({ reducedMotion:'reduce' });
  await expect.poll(() => page.evaluate(() => document.getAnimations().filter(a=>a.playState==='running').length)).toBe(0);
});

test('semantic feedback provides distinct finite visual families without mutating its target', async ({ page }) => {
  await fixture(page);
  const result = await page.evaluate(() => {
    const target=document.querySelector('#target'),html=target.outerHTML;
    const kinds=['save','load','copy','paste','remove','rename','toggle','open','close','cancel','refuse','reset','randomize','connect','disconnect','pending','ready','handoff','cue','learn','record-start','record-stop','sample','upload','download','section','queue','undo','redo','range','loop','rest','accent','ghost','slice','play','stop','tempo','volume','theme','quality','audition','compare','trim','select','adjust','confirm'];
    const effects=kinds.map(kind=>{
      const accepted=motion.emitInteractionMotion(target,kind),effect=document.querySelector('[data-interaction-motion-root]')?.lastElementChild;
      const style=effect?getComputedStyle(effect):null;
      return {kind,accepted,matches:effect?.dataset.motionKind===kind,animation:style?.animationName,duration:parseFloat(style?.animationDuration||'0'),iterations:style?.animationIterationCount};
    });
    return {effects,unchanged:target.outerHTML===html,unknown:motion.emitInteractionMotion(target,'not-a-real-motion')};
  });
  expect(result.unchanged).toBe(true);expect(result.unknown).toBe(false);
  for(const effect of result.effects){expect(effect.accepted,effect.kind).toBe(true);expect(effect.matches,effect.kind).toBe(true);expect(effect.animation,effect.kind).not.toBe('none');expect(effect.duration,effect.kind).toBeGreaterThan(0);expect(effect.duration,effect.kind).toBeLessThanOrEqual(.22);expect(effect.iterations,effect.kind).toBe('1');}
  expect(new Set(result.effects.map(e=>e.animation)).size).toBeGreaterThanOrEqual(8);
  expect(new Set(result.effects.filter(e=>['rest','accent','ghost','slice'].includes(e.kind)).map(e=>e.animation)).size).toBe(4);
});

test('hold progress is cancellable decoration and never chooses an action',async({page})=>{
 await fixture(page);
 expect(await page.evaluate(()=>typeof motion.beginInteractionHold==='function')).toBe(true);
 const result=await page.evaluate(()=>{
  const target=document.querySelector('#target'),html=target.outerHTML;let calls=0;
  const token=motion.beginInteractionHold(target,{duration:380,x:100,y:100,onComplete:()=>calls++});
  const ring=document.querySelector('[data-motion-kind="hold"]');
  const out={token:typeof token?.cancel==='function',ring:!!ring,decorative:ring?getComputedStyle(ring).pointerEvents==='none':false};
  token.cancel();out.cleared=!document.querySelector('[data-motion-kind="hold"]');out.sourceUnchanged=target.outerHTML===html;out.calls=calls;return out;
 });
 expect(result).toEqual({token:true,ring:true,decorative:true,cleared:true,sourceUnchanged:true,calls:0});
 await page.waitForTimeout(450);await expect(page.locator('[data-motion-kind="hold"]')).toHaveCount(0);
});

test('drag ghost follows a contact without moving the source and cancels synchronously',async({page})=>{
 await fixture(page);
 expect(await page.evaluate(()=>typeof motion.beginInteractionDrag==='function')).toBe(true);
 const result=await page.evaluate(()=>{
  const target=document.querySelector('#target'),before=JSON.stringify(target.getBoundingClientRect().toJSON()),html=target.outerHTML;
  const drag=motion.beginInteractionDrag(target,{x:100,y:100});drag.move(180,160);
  const ghost=document.querySelector('[data-motion-kind="drag"]');const out={ghost:!!ghost,moved:!!ghost&&getComputedStyle(ghost).transform!=='none',sameBox:JSON.stringify(target.getBoundingClientRect().toJSON())===before,sameMarkup:target.outerHTML===html};
  drag.cancel();out.cleared=!document.querySelector('[data-motion-kind="drag"]');return out;
 });
 expect(result).toEqual({ghost:true,moved:true,sameBox:true,sameMarkup:true,cleared:true});
});

test('layout reflow animates ordinary cards but refuses to transform beat-grid geometry',async({page})=>{
 await fixture(page);
 expect(await page.evaluate(()=>typeof motion.captureInteractionLayout==='function'&&typeof motion.animateInteractionLayout==='function')).toBe(true);
 const result=await page.evaluate(()=>{
  const card=document.querySelector('#target'),snapshot=motion.captureInteractionLayout([card]);card.style.left='200px';const html=card.outerHTML;
  const count=motion.animateInteractionLayout(snapshot,[card]);
  const out={animated:count>0,native:card.getAnimations().length>0,sameMarkup:card.outerHTML===html};
  runtime.destroy();out.cancelled=card.getAnimations().filter(a=>a.playState==='running').length===0;
  runtime=motion.initializeInteractionMotion(document);card.classList.add('beat-square');const beats=motion.captureInteractionLayout([card]);card.style.left='20px';
  out.beatCount=motion.animateInteractionLayout(beats,[card]);out.beatAnimations=card.getAnimations().length;return out;
 });
 expect(result).toEqual({animated:true,native:true,sameMarkup:true,cancelled:true,beatCount:0,beatAnimations:0});
});

test('native disclosures acknowledge their confirmed open and close states',async({page})=>{
 await fixture(page);
 await page.evaluate(()=>{__motionObserved=[];new MutationObserver(rs=>{for(const r of rs)for(const n of r.addedNodes)if(n.nodeType===1&&n.dataset.motionKind)__motionObserved.push(n.dataset.motionKind);}).observe(document.querySelector('[data-interaction-motion-root]'),{childList:true});document.body.insertAdjacentHTML('beforeend','<details id="disclosure"><summary>Tools</summary><p>Detail</p></details>');});
 await page.locator('#disclosure > summary').click();
 await expect(page.locator('#disclosure')).toHaveAttribute('open','');
 await expect.poll(()=>page.evaluate(()=>__motionObserved.includes('open'))).toBe(true);
 await page.evaluate(()=>{__motionObserved=[];});await page.locator('#disclosure > summary').click();
 await expect(page.locator('#disclosure')).not.toHaveAttribute('open','');
 await expect.poll(()=>page.evaluate(()=>__motionObserved.includes('close'))).toBe(true);
});

test('a disabled control gets refusal feedback without receiving its action',async({page})=>{
 await fixture(page);await page.evaluate(()=>{const b=document.querySelector('#target');b.disabled=true;window.__actions=0;b.addEventListener('click',()=>__actions++);__motionObserved=[];new MutationObserver(rs=>{for(const r of rs)for(const n of r.addedNodes)if(n.nodeType===1&&n.dataset.motionKind)__motionObserved.push(n.dataset.motionKind);}).observe(document.querySelector('[data-interaction-motion-root]'),{childList:true});});
 const box=await page.locator('#target').boundingBox();await page.mouse.click(box.x+box.width/2,box.y+box.height/2);
 expect(await page.evaluate(()=>__actions)).toBe(0);
 await expect.poll(()=>page.evaluate(()=>__motionObserved.includes('refuse'))).toBe(true);
});

test('viewport invalidation clears owned decoration without reviving it later',async({page})=>{
 await fixture(page);const count=await page.evaluate(()=>{motion.beginInteractionHold(document.querySelector('#target'),{duration:380});window.dispatchEvent(new Event('scroll'));return document.querySelector('[data-interaction-motion-root]').childElementCount;});
 expect(count).toBe(0);
 await page.waitForTimeout(450);await expect(page.locator('[data-interaction-motion-root] > *')).toHaveCount(0);
});

test('decoration stays inside native fullscreen and returns to its normal host on exit',async({page})=>{
 await fixture(page);
 await page.evaluate(()=>{const stage=document.createElement('div');stage.id='stage';document.body.append(stage);stage.append(document.querySelector('#target'));document.querySelector('#target').onclick=()=>stage.requestFullscreen();});
 try{
  await page.locator('#target').click();
  await expect.poll(()=>page.evaluate(()=>document.fullscreenElement?.id)).toBe('stage');
  await expect.poll(()=>page.evaluate(()=>document.querySelector('[data-interaction-motion-root]').parentElement===document.fullscreenElement)).toBe(true);
 }finally{await page.evaluate(async()=>{if(document.fullscreenElement)await document.exitFullscreen();});}
 await expect.poll(()=>page.evaluate(()=>document.querySelector('[data-interaction-motion-root]').parentElement===document.body)).toBe(true);
});
