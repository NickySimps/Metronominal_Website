'use strict';
const {test,expect}=require('@playwright/test');
async function editorPage(page){
 await page.route('**/script.js',r=>r.abort());await page.goto('./');
 await page.evaluate(async()=>{
  window.editor=(await import(new URL('js/soundSettingsModal.js',document.baseURI))).default;window.a=(await import(new URL('js/appState.js',document.baseURI))).default;
  (await import(new URL('js/themeController.js',document.baseURI))).default.applyTheme('dark');
  (await import(new URL('js/interactionMotion.js',document.baseURI))).initializeInteractionMotion(document);
  a.initializeAudioContext();if(!a.getTracks().length)a.addTrack();
  const opener=document.createElement('button');opener.id='motion-editor-opener';opener.textContent='Open editor';document.body.append(opener);opener.focus();
  __motionObserved=[];new MutationObserver(rs=>{for(const r of rs)for(const n of r.addedNodes)if(n.nodeType===1&&n.dataset.motionKind)__motionObserved.push(n.dataset.motionKind);}).observe(document.querySelector('[data-interaction-motion-root]'),{childList:true,subtree:true});
  editor.init();editor.show(0,'mainBeatSound');
 });
 await expect(page.locator('#sound-settings-modal')).toBeVisible();
}

test('sound editor open and close feedback preserves immediate focus restoration',async({page})=>{
 await editorPage(page);await expect.poll(()=>page.evaluate(()=>__motionObserved.includes('open'))).toBe(true);
 await page.evaluate(()=>{__motionObserved=[];});await page.locator('#sound-settings-bottom-close').click();
 await expect(page.locator('#sound-settings-modal')).toBeHidden();await expect(page.locator('#motion-editor-opener')).toBeFocused();
 await expect.poll(()=>page.evaluate(()=>__motionObserved.includes('close'))).toBe(true);
});

test('A/B comparison feedback does not overwrite the edited or shared sound',async({page})=>{
 await editorPage(page);const before=await page.evaluate(()=>a.getMusicalSnapshot());await page.evaluate(()=>{__motionObserved=[];});
 await page.locator('#sound-preview-original').click();await expect(page.locator('#sound-preview-original')).toHaveAttribute('aria-pressed','true');
 await expect.poll(()=>page.evaluate(()=>__motionObserved.includes('compare'))).toBe(true);
 expect(await page.evaluate(()=>a.getMusicalSnapshot())).toEqual(before);
});

test('advanced disclosure acknowledges its actual state without changing music',async({page})=>{
 await editorPage(page);const before=await page.evaluate(()=>a.getMusicalSnapshot()),expanded=await page.locator('#sound-advanced-toggle').getAttribute('aria-expanded');await page.evaluate(()=>{__motionObserved=[];});
 await page.locator('#sound-advanced-toggle').click();await expect(page.locator('#sound-advanced-toggle')).toHaveAttribute('aria-expanded',expanded==='true'?'false':'true');
 const kind=expanded==='true'?'close':'open';await expect.poll(()=>page.evaluate(kind=>__motionObserved.includes(kind),kind)).toBe(true);
 expect(await page.evaluate(()=>a.getMusicalSnapshot())).toEqual(before);
});

test('accepted reverse control has toggle feedback and keeps its real edited value',async({page})=>{
 await editorPage(page);await page.evaluate(()=>{__motionObserved=[];});await page.locator('#sample-reverse-toggle').check();
 await expect(page.locator('#sample-reverse-toggle')).toBeChecked();
 await expect.poll(()=>page.evaluate(()=>__motionObserved.includes('toggle'))).toBe(true);
 expect(await page.evaluate(()=>({draft:editor.currentSoundSettings.reverse,saved:editor.getCurrentSoundInfo().settings.reverse}))).toEqual({draft:true,saved:true});
});
