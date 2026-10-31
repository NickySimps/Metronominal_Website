'use strict';
const {test,expect}=require('@playwright/test');
const prepare=require('./workflowTestPage.cjs');
const openMotion=require('./motionTestPage.cjs');

test('the mounted application initializes its inert motion layer without test-only bootstrapping',async({page})=>{
  await prepare(page,test.info().config.metadata);await page.goto('./');
  await expect(page.locator('#share-btn')).toHaveClass(/(?:^|\s)connected(?:\s|$)/);
  await expect(page.locator('#workflow-tools-status')).toHaveText('Editing previews never change music until applied. Timing correction and library backups stay on this device.');
  await expect(page.locator('[data-interaction-motion-root]')).toHaveCount(1);
  expect(await page.locator('[data-interaction-motion-root]').evaluate(e=>e.inert&&e.getAttribute('aria-hidden')==='true'&&getComputedStyle(e).pointerEvents==='none')).toBe(true);
  await expect(page.locator('link[href="interaction-motion.css"]')).toHaveCount(1);
});

test('preset save stamps only after storage succeeds and never stamps a rejected save',async({page})=>{
  await prepare(page,test.info().config.metadata);
  await page.goto('./');
  await expect(page.locator('#share-btn')).toHaveClass(/(?:^|\s)connected(?:\s|$)/);
  await expect(page.locator('#workflow-tools-status')).toHaveText('Editing previews never change music until applied. Timing correction and library backups stay on this device.');
  await page.addStyleTag({url:new URL('interaction-motion.css',page.url()).href});
  await page.evaluate(async()=>{
    const m=await import(new URL('js/interactionMotion.js',document.baseURI));m.initializeInteractionMotion(document);
    window.__motionObserved=[];
    new MutationObserver(records=>{for(const r of records)for(const n of r.addedNodes)if(n.nodeType===1&&n.hasAttribute('data-motion-kind'))__motionObserved.push(n.dataset.motionKind);}).observe(document.body,{childList:true,subtree:true});
  });
  await page.locator('#preset-name-input').fill('Motion save fixture');
  await page.locator('.save-preset-btn').click();
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('metronomePreset_0')||'null')?.songName)).toBe('Motion save fixture');
  await expect.poll(()=>page.evaluate(()=>__motionObserved.filter(k=>k==='save').length)).toBe(1);
  const saved=await page.evaluate(()=>localStorage.getItem('metronomePreset_0'));
  await page.evaluate(()=>{
    __motionObserved=[];const original=Storage.prototype.setItem;
    Storage.prototype.setItem=function(key,value){if(String(key).startsWith('metronomePreset_'))throw new DOMException('Controlled preset write refusal','QuotaExceededError');return original.call(this,key,value);};
  });
  await page.locator('#preset-name-input').fill('Rejected motion fixture');
  await page.locator('.save-preset-btn').click();
  expect(await page.evaluate(()=>localStorage.getItem('metronomePreset_0'))).toBe(saved);
  expect(await page.evaluate(()=>__motionObserved.filter(k=>k==='save'))).toEqual([]);
});

test('preset load feedback requires a successfully loaded slot rather than a selection attempt',async({page})=>{
 await openMotion(page,test.info().config.metadata);
 await page.evaluate(async()=>{const p=(await import(new URL('js/presetController.js',document.baseURI))).default;await p.saveCurrentPreset(1,'Motion loaded fixture');__motionObserved=[];});
 await page.locator('#preset-slot-select').selectOption('1');
 await expect(page.locator('#preset-name-input')).toHaveValue('Motion loaded fixture');
 await expect.poll(()=>page.evaluate(()=>__motionObserved.filter(k=>k==='load').length)).toBe(1);
 await page.evaluate(()=>{__motionObserved=[];});
 await page.locator('#preset-slot-select').selectOption('2');
 expect(await page.locator('#preset-name-input').inputValue()).toBe('Motion loaded fixture');
 expect(await page.evaluate(()=>__motionObserved.filter(k=>k==='load'))).toEqual([]);
});

test('preset clear preserves its label on storage refusal and animates only real deletion',async({page})=>{
 await openMotion(page,test.info().config.metadata);
 await page.locator('#preset-name-input').fill('Motion clear fixture');await page.locator('.save-preset-btn').click();
 await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('metronomePreset_0')||'null')?.songName)).toBe('Motion clear fixture');
 await page.evaluate(()=>{__motionObserved=[];window.__restoreRemove=Storage.prototype.removeItem;Storage.prototype.removeItem=function(key){if(String(key).startsWith('metronomePreset_'))throw new DOMException('Controlled clear refusal','QuotaExceededError');return __restoreRemove.call(this,key);};});
 await page.locator('.clear-preset-btn').click();
 await expect(page.locator('#preset-name-input')).toHaveValue('Motion clear fixture');
 expect(await page.evaluate(()=>__motionObserved.filter(k=>k==='remove'))).toEqual([]);
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('metronomePreset_0')).songName)).toBe('Motion clear fixture');
 await page.evaluate(()=>{Storage.prototype.removeItem=__restoreRemove;__motionObserved=[];});
 await page.locator('.clear-preset-btn').click();
 await expect.poll(()=>page.evaluate(()=>localStorage.getItem('metronomePreset_0'))).toBe(null);
 await expect.poll(()=>page.evaluate(()=>__motionObserved.filter(k=>k==='remove').length)).toBe(1);
});
