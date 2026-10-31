'use strict';
const {test,expect}=require('@playwright/test');const open=require('./motionTestPage.cjs');
async function appReady(page,metadata){await open(page,metadata);await page.keyboard.press('Shift');await expect.poll(()=>page.evaluate(async()=>(await import('/js/userInteraction.js')).default.audioContextInitialized)).toBe(true);expect(await page.evaluate(async()=>(await import('/js/appState.js')).default.getAudioContext().state)).toBe('running');await page.evaluate(()=>{__motionObserved=[];});}
async function ready(page,metadata){await appReady(page,metadata);await page.locator('#share-btn').click();await expect(page.locator('#share-modal')).toBeVisible();}
async function preserveClipboard(page){await page.context().grantPermissions(['clipboard-read','clipboard-write','local-network-access']);await page.bringToFront();await page.evaluate(async()=>{const originalWrite=navigator.clipboard.writeText.bind(navigator.clipboard),saved=await navigator.clipboard.readText();let copied=null;window.restoreOwnedClipboard=async()=>{if(copied!==null&&await navigator.clipboard.readText()===copied){await originalWrite(saved);if(await navigator.clipboard.readText()!==saved)throw new Error('Owned clipboard restoration failed');}};navigator.clipboard.writeText=async text=>{const result=await originalWrite(text);copied=text;window.nativeCopied=true;return result;};});}
test('unavailable real QR library refuses without opening an empty sharing surface',async({page},info)=>{
 await page.route('**/qrcode.min.js',route=>route.abort());await appReady(page,info.config.metadata);await page.evaluate(()=>{__motionObserved=[];});await page.locator('#share-btn').click();await expect(page.locator('#share-modal')).toBeHidden();await expect.poll(()=>page.evaluate(()=>__motionObserved.includes('refuse'))).toBe(true);expect(await page.evaluate(()=>__motionObserved.includes('open')||__motionObserved.includes('ready'))).toBe(false);
});

test('Sync modal and real QR acknowledge open and close only on actual visibility transitions',async({page},info)=>{
 await appReady(page,info.config.metadata);await page.evaluate(()=>{__motionObserved=[];});await page.locator('#share-btn').click();await expect(page.locator('#share-modal')).toBeVisible();expect(await page.locator('#qrcode').evaluate(root=>root.childElementCount)).toBeGreaterThan(0);await expect.poll(()=>page.evaluate(()=>__motionObserved.includes('open')&&__motionObserved.includes('ready'))).toBe(true);await page.evaluate(()=>{__motionObserved=[];});await page.locator('#share-modal .close-button').click();await expect(page.locator('#share-modal')).toBeHidden();await expect.poll(()=>page.evaluate(()=>__motionObserved.includes('close'))).toBe(true);await page.evaluate(()=>{__motionObserved=[];document.querySelector('#share-modal .close-button').click();});expect(await page.evaluate(()=>__motionObserved.includes('close'))).toBe(false);
});
test('diagnostics actual open and Escape close preserve focused owner with distinct feedback',async({page},info)=>{
 await ready(page,info.config.metadata);await page.evaluate(()=>{__motionObserved=[];});await page.locator('#sync-diagnostics-btn').click();await expect(page.locator('#sync-diagnostics-panel')).toBeVisible();await expect.poll(()=>page.evaluate(()=>__motionObserved.includes('open'))).toBe(true);await page.evaluate(()=>{__motionObserved=[];});await page.keyboard.press('Escape');await expect(page.locator('#sync-diagnostics-panel')).toBeHidden();await expect(page.locator('#share-modal')).toBeVisible();await expect(page.locator('#sync-diagnostics-btn')).toBeFocused();await expect.poll(()=>page.evaluate(()=>__motionObserved.includes('close'))).toBe(true);
});
test('native clipboard write is acknowledged and owned test clipboard data is restored',async({page},info)=>{
 await ready(page,info.config.metadata);await preserveClipboard(page);try{await page.evaluate(()=>{__motionObserved=[];});await page.locator('#copy-link-btn').click();await expect.poll(()=>page.evaluate(()=>window.nativeCopied===true)).toBe(true);expect(await page.evaluate(async()=>await navigator.clipboard.readText()===document.querySelector('#qrcode').title)).toBe(true);await expect.poll(()=>page.evaluate(()=>__motionObserved.includes('copy'))).toBe(true);}finally{await page.evaluate(()=>window.restoreOwnedClipboard?.());}
});
test('held real clipboard completion cannot acknowledge a closed and reopened sharing surface',async({page},info)=>{
 await ready(page,info.config.metadata);await preserveClipboard(page);try{await page.evaluate(()=>{const original=navigator.clipboard.writeText.bind(navigator.clipboard);let release;const held=new Promise(resolve=>release=resolve);window.releaseNativeCopy=release;navigator.clipboard.writeText=async(...args)=>{await original(...args);await held;};const button=document.getElementById('copy-link-btn'),nativeHandler=button.onclick;button.onclick=function(...args){return window.pendingNativeCopyHandler=nativeHandler.apply(this,args);};__motionObserved=[];});await page.locator('#copy-link-btn').click();await expect.poll(()=>page.evaluate(()=>window.nativeCopied===true)).toBe(true);await page.locator('#share-modal .close-button').click();await page.locator('#share-btn').click();await page.evaluate(()=>{__motionObserved=[];releaseNativeCopy();return pendingNativeCopyHandler;});expect(await page.locator('#copy-link-btn').textContent()).not.toBe('Copied!');expect(await page.evaluate(()=>__motionObserved.includes('copy'))).toBe(false);}finally{await page.evaluate(()=>{window.releaseNativeCopy?.();return window.restoreOwnedClipboard?.();});}
});
test('copy label timer survives a newer held native clipboard action',async({page},info)=>{
 await ready(page,info.config.metadata);await preserveClipboard(page);
 try{
  const originalLabel=await page.locator('#copy-link-btn').textContent();
  await page.locator('#copy-link-btn').click();await expect(page.locator('#copy-link-btn')).toHaveText('Copied!');
  await page.evaluate(()=>{const original=navigator.clipboard.writeText.bind(navigator.clipboard);let release;const held=new Promise(resolve=>release=resolve);window.releaseNativeCopy=release;navigator.clipboard.writeText=async text=>{await original(text);window.secondNativeCopy=true;await held;};const button=document.getElementById('copy-link-btn'),handler=button.onclick;button.onclick=function(...args){return window.pendingNativeCopyHandler=handler.apply(this,args);};});
  await page.locator('#copy-link-btn').click();await expect.poll(()=>page.evaluate(()=>window.secondNativeCopy===true)).toBe(true);
  await expect(page.locator('#copy-link-btn')).toHaveText(originalLabel,{timeout:4000});
  await page.evaluate(()=>{releaseNativeCopy();return pendingNativeCopyHandler;});
  await expect(page.locator('#copy-link-btn')).toHaveText('Copied!');
  await expect(page.locator('#copy-link-btn')).toHaveText(originalLabel,{timeout:4000});
 }finally{await page.evaluate(()=>{window.releaseNativeCopy?.();return window.restoreOwnedClipboard?.();});}
});

for(const authorityEvent of ['roomauthoritychange','syncrolechange']){
 test(`${authorityEvent} closes and clears stale sharing before retained handlers reach native APIs`,async({page},info)=>{
  await ready(page,info.config.metadata);await preserveClipboard(page);
  try{
   await page.locator('#sync-diagnostics-btn').click();await expect(page.locator('#sync-diagnostics-panel')).toBeVisible();
   const result=await page.evaluate(async eventName=>{
    const copy=document.getElementById('copy-link-btn'),share=document.getElementById('mobile-share-btn');
    const staleCopy=copy.onclick,staleShare=share.onclick;let shareAttempts=0;
    // A tripwire, never a fabricated successful native handoff.
    navigator.share=()=>{++shareAttempts;return Promise.reject(new DOMException('Unexpected stale share','AbortError'));};
    window.nativeCopied=false;__motionObserved=[];
    document.dispatchEvent(new Event(eventName));
    await staleCopy();await staleShare();
    return {copied:window.nativeCopied,shareAttempts,copyDetached:copy.onclick===null,shareDetached:share.onclick===null,acknowledged:__motionObserved.some(kind=>['copy','handoff','cancel'].includes(kind))};
   },authorityEvent);
   expect(result).toEqual({copied:false,shareAttempts:0,copyDetached:true,shareDetached:true,acknowledged:false});
   await expect(page.locator('#share-modal')).toBeHidden();await expect(page.locator('#sync-diagnostics-panel')).toBeHidden();
   expect(await page.locator('#qrcode').evaluate(root=>root.childElementCount===0&&!root.getAttribute('title'))).toBe(true);
   await page.locator('#share-btn').click();await expect(page.locator('#share-modal')).toBeVisible();
   expect(await page.locator('#qrcode').evaluate(root=>root.childElementCount>0)).toBe(true);
   await page.locator('#copy-link-btn').click();await expect.poll(()=>page.evaluate(()=>window.nativeCopied===true)).toBe(true);
  }finally{await page.evaluate(()=>window.restoreOwnedClipboard?.());}
 });
}

test('browser clipboard policy refusal never claims a copied link',async({page,baseURL},info)=>{
 await page.route(new URL('/',baseURL).href,async route=>{const response=await route.fetch();await route.fulfill({response,headers:{...response.headers(),'permissions-policy':'clipboard-write=()'}});});await page.context().grantPermissions(['local-network-access']);await ready(page,info.config.metadata);await page.evaluate(()=>{__motionObserved=[];});await page.locator('#copy-link-btn').click();await expect.poll(()=>page.evaluate(()=>__motionObserved.includes('refuse'))).toBe(true);expect(await page.evaluate(()=>__motionObserved.includes('copy'))).toBe(false);await expect(page.locator('#copy-link-btn')).not.toHaveText('Copied!');
});
