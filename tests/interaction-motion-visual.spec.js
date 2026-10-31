'use strict';
const {test,expect}=require('@playwright/test');const openMotion=require('./motionTestPage.cjs');
test('capture actual motion families in wide and narrow light/dark app themes',async({page})=>{
 await openMotion(page,test.info().config.metadata);
 const surfaces=[];let clockInstalled=false;
 for(const [width,theme] of [[1280,'dark'],[1280,'default'],[390,'dark'],[390,'default']]){
  await page.setViewportSize({width,height:844});
  await page.evaluate(async({width,theme})=>{
   (await import(new URL('js/themeController.js',document.baseURI))).default.applyTheme(theme);
   for(const a of document.getAnimations())if(Number.isFinite(a.effect.getComputedTiming().endTime))a.finish();
   document.querySelector('#motion-visual-gallery')?.remove();const p=document.createElement('section');p.id='motion-visual-gallery';p.className='modal-content';
   p.style.cssText='position:fixed;z-index:100000;left:12px;top:12px;width:calc(100% - 24px);max-width:1100px;box-sizing:border-box;padding:20px;display:grid;gap:18px;grid-template-columns:repeat('+(width<600?2:4)+',minmax(0,1fr));';
   for(const kind of ['save','copy','remove','undo','rest','accent','ghost','slice']){const cell=document.createElement('div');cell.style.cssText='display:grid;gap:8px;text-align:center';const b=document.createElement('button');b.type='button';b.dataset.specimen=kind;b.textContent=kind;b.style.cssText='width:100%;height:64px;margin:0;';const real=getComputedStyle(document.querySelector('.increase-tempo'));b.style.background=real.backgroundColor;b.style.color=real.color;b.style.fontFamily=real.fontFamily;b.style.fontWeight=real.fontWeight;b.style.fontSize='16px';b.style.textShadow=real.textShadow;const caption=document.createElement('span');caption.textContent=kind;cell.append(b,caption);p.append(cell);}document.body.append(p);
  },{width,theme});
  surfaces.push(await page.locator('#motion-visual-gallery').evaluate(p=>getComputedStyle(p).backgroundColor));
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
  if(!clockInstalled){const now=Date.now();await page.clock.install({time:now-1000});await page.clock.pauseAt(now);clockInstalled=true;}else{const now=await page.evaluate(()=>Date.now());await page.clock.pauseAt(now+1000);}
  await page.evaluate(async()=>{
   const m=await import(new URL('js/interactionMotion.js',document.baseURI));window.__motionGalleryBoxes=[...document.querySelectorAll('[data-specimen]')].map(b=>b.getBoundingClientRect().toJSON());
   for(const b of document.querySelectorAll('[data-specimen]'))m.emitInteractionMotion(b,b.dataset.specimen);
   for(const a of document.getAnimations()){a.pause();a.currentTime=80;}
  });
  await expect(page.locator('[data-interaction-motion-root] > [data-motion-kind]')).toHaveCount(8);
  expect(await page.evaluate(()=>[...document.querySelectorAll('[data-specimen]')].every((b,i)=>{const r=b.getBoundingClientRect(),s=__motionGalleryBoxes[i];return r.x===s.x&&r.y===s.y&&r.width===s.width&&r.height===s.height;}))).toBe(true);
  await page.screenshot({path:test.info().outputPath('motion-'+theme+'-'+width+'.png')});
  await page.clock.resume();
 }
 expect(surfaces[0]).not.toBe(surfaces[1]);expect(surfaces[2]).not.toBe(surfaces[3]);
});
