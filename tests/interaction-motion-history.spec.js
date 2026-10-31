'use strict';
const {test,expect}=require('@playwright/test');
async function ready(page){
 await page.goto('./js/beatTiming.js');await page.setContent('<base href="/"><main id="history-root"></main>');
 await page.addStyleTag({url:'/interaction-motion.css'});
 await page.evaluate(async()=>{
  window.a=(await import('/js/appState.js')).default;a.initializeAudioContext();await a.loadAudioBuffers();a.resetState();
  (await import('/js/interactionMotion.js')).initializeInteractionMotion(document);
  window.historyControls=(await import('/js/editHistory.js')).initializeHistoryControls(document.querySelector('main'));
  __motionObserved=[];new MutationObserver(rs=>{for(const r of rs)for(const n of r.addedNodes)if(n.nodeType===1&&n.dataset.motionKind)__motionObserved.push(n.dataset.motionKind);}).observe(document.querySelector('[data-interaction-motion-root]'),{childList:true,subtree:true});
 });
}

for(const reason of ['empty','client','playing','transaction'])test('actual '+reason+' history refusal is visible without a restoration or musical mutation',async({page})=>{
 await ready(page);await page.evaluate(async reason=>{if(reason!=='empty')a.setTempo(171);if(reason==='client')document.dispatchEvent(new CustomEvent('syncrolechange',{detail:{state:'connected',isHost:false}}));if(reason==='playing')await a.togglePlay();if(reason==='transaction')window.__tx=(await import('/js/editHistory.js')).beginEditTransaction('Held edit');__motionObserved=[];},reason);
 const before=await page.evaluate(()=>a.getMusicalSnapshot());expect(await page.evaluate(()=>historyControls.undo())).toBe(false);expect(await page.evaluate(()=>a.getMusicalSnapshot())).toEqual(before);await expect.poll(()=>page.evaluate(()=>__motionObserved.includes('refuse'))).toBe(true);expect(await page.evaluate(()=>__motionObserved.some(k=>k==='undo'||k==='redo'))).toBe(false);
});
test('clearing real history acknowledges cancellation once and not an already empty boundary',async({page})=>{
 await ready(page);await page.evaluate(()=>{a.setTempo(171);__motionObserved=[];document.dispatchEvent(new Event('historyboundary'));});await expect.poll(()=>page.evaluate(()=>__motionObserved.includes('cancel'))).toBe(true);await page.evaluate(()=>{__motionObserved=[];document.dispatchEvent(new Event('historyboundary'));});expect(await page.evaluate(()=>__motionObserved)).toEqual([]);expect(await page.evaluate(()=>a.getTempo())).toBe(171);
});
test('empty history keyboard refusal preserves the existing unconsumed key behavior',async({page})=>{
 await ready(page);await page.evaluate(()=>document.addEventListener('keydown',event=>{if(event.key.toLowerCase()==='z')window.__historyKeyPrevented=event.defaultPrevented;}));await page.keyboard.press('Control+z');await expect.poll(()=>page.evaluate(()=>__motionObserved.includes('refuse'))).toBe(true);expect(await page.evaluate(()=>__historyKeyPrevented)).toBe(false);expect(await page.evaluate(()=>a.getTempo())).toBe(120);
});

test('busy native restoration refuses overlapping work without changing the held musical state',async({page})=>{
 await ready(page);const result=await page.evaluate(async()=>{a.setTempo(171);const original=a.applyMusicalSnapshot.bind(a);let release;const gate=new Promise(resolve=>release=resolve);a.applyMusicalSnapshot=async(...args)=>{await gate;return original(...args);};__motionObserved=[];const pending=historyControls.undo();const before=a.getMusicalSnapshot();let blocked,during,refused;try{blocked=await historyControls.redo();during=a.getMusicalSnapshot();refused=__motionObserved.includes('refuse');}finally{release();}return{blocked,before,during,refused,restored:await pending,tempo:a.getTempo()};});expect(result.blocked).toBe(false);expect(result.during).toEqual(result.before);expect(result.refused).toBe(true);expect(result.restored).toBe(true);expect(result.tempo).toBe(120);
});
test('invalidated restoration does not announce refusal in a newer history lifetime',async({page})=>{
 await ready(page);await page.evaluate(()=>{a.setTempo(171);const original=a.applyMusicalSnapshot.bind(a);let release;const gate=new Promise(resolve=>release=resolve);window.__releaseUndo=release;a.applyMusicalSnapshot=async(...args)=>{await gate;return original(...args);};window.__pendingUndo=historyControls.undo();__motionObserved=[];document.dispatchEvent(new Event('historyboundary'));});await expect.poll(()=>page.evaluate(()=>__motionObserved.includes('cancel'))).toBe(true);await page.evaluate(()=>{__motionObserved=[];__releaseUndo();});expect(await page.evaluate(()=>__pendingUndo)).toBe(false);expect(await page.evaluate(()=>__motionObserved.some(k=>k==='refuse'||k==='undo'))).toBe(false);expect(await page.evaluate(()=>a.getTempo())).toBe(171);
});

test('Undo and Redo feedback follows successful real snapshot restoration',async({page})=>{
 await ready(page);await page.evaluate(()=>a.setTempo(171));
 await page.getByRole('button',{name:'Undo',exact:true}).click();await expect.poll(()=>page.evaluate(()=>a.getTempo())).toBe(120);
 await expect.poll(()=>page.evaluate(()=>__motionObserved.includes('undo'))).toBe(true);
 await page.evaluate(()=>{__motionObserved=[];});await page.getByRole('button',{name:'Redo',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>a.getTempo())).toBe(171);await expect.poll(()=>page.evaluate(()=>__motionObserved.includes('redo'))).toBe(true);
});

test('a held then authority-invalidated Undo never announces a successful restore',async({page})=>{
 await ready(page);
 await page.evaluate(()=>{
  a.setTempo(171);const original=a.applyMusicalSnapshot.bind(a);let release;const held=new Promise(r=>release=r);window.__releaseUndo=release;
  a.applyMusicalSnapshot=async(...args)=>{await held;return original(...args);};__motionObserved=[];window.__pendingUndo=historyControls.undo();
 });
 expect(await page.evaluate(()=>__motionObserved.includes('undo'))).toBe(false);
 await page.evaluate(()=>{document.dispatchEvent(new CustomEvent('syncrolechange',{detail:{state:'connected',isHost:false}}));__releaseUndo();});
 expect(await page.evaluate(()=>__pendingUndo)).toBe(false);
 expect(await page.evaluate(()=>a.getTempo())).toBe(171);expect(await page.evaluate(()=>__motionObserved.includes('undo'))).toBe(false);
});
