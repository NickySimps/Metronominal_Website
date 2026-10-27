const {test,expect}=require('@playwright/test');
const prepareWorkflowTestPage=require('./workflowTestPage.cjs');
test.beforeEach(async ({page},info)=>prepareWorkflowTestPage(page,info.config.metadata));

test('open performance stage tracks active theme fonts and readable colors',async({page})=>{
 await page.goto('./');await expect(page.locator('#share-btn')).toHaveClass(/(?:^|\s)connected(?:\s|$)/);await expect(page.locator('#performance-view-btn')).toBeEnabled();
 await page.evaluate(async()=>{(await import('/js/themeController.js')).default.applyTheme('dark');document.getAnimations().forEach(a=>{if(Number.isFinite(a.effect?.getComputedTiming().endTime))a.finish();});});
 await page.locator('#performance-view-btn').click();await expect(page.locator('.performance-view')).toBeVisible();
 const failures=[];
 for(const name of ['default','dark','synthwave','helloKitty','random']){
  const result=await page.evaluate(async name=>{
   if(name==='random')document.querySelector('[data-theme="random"]').click();else(await import('/js/themeController.js')).default.applyTheme(name);
   document.getAnimations().forEach(a=>{if(Number.isFinite(a.effect?.getComputedTiming().endTime))a.finish();});
   const stage=document.querySelector('.performance-view'),c=document.createElement('canvas').getContext('2d');c.canvas.width=c.canvas.height=1;
   const rgba=value=>{c.clearRect(0,0,1,1);c.fillStyle=value;c.fillRect(0,0,1,1);return [...c.getImageData(0,0,1,1).data];};
   const lum=rgb=>rgb.slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
   const s=getComputedStyle(stage),f=lum(rgba(s.color)),b=lum(rgba(s.backgroundColor));
   return {bodyFont:getComputedStyle(document.body).fontFamily,stageFont:s.fontFamily,foreground:s.color,background:s.backgroundColor,contrast:(Math.max(f,b)+.05)/(Math.min(f,b)+.05),controls:[...stage.querySelectorAll('button,input,select')].map(el=>getComputedStyle(el).fontFamily)};
  },name);
  if(result.stageFont!==result.bodyFont||result.controls.some(font=>font!==result.bodyFont)||result.contrast<4.5)failures.push({theme:name,...result});
 }
 expect(failures,'Open stage and controls must follow active fonts and readable theme colors').toEqual([]);
 await page.locator('[data-performance-exit]').click();
});

test('workflow controls follow every 2D theme and generated palette with readable enabled surfaces',async({page})=>{
 await page.setViewportSize({width:390,height:1100});await page.goto('./');await expect(page.locator('#share-btn')).toHaveClass(/(?:^|\s)connected(?:\s|$)/);await expect(page.locator('#workflow-tools-status')).not.toContainText('Preparing');await expect(page.locator('#workflow-tools-status')).not.toContainText('Unavailable:');await page.locator('#rehearsal-tools-panel > summary').click();
 const names=await page.locator('[data-theme]').evaluateAll(ns=>[...new Set(ns.map(n=>n.dataset.theme))].filter(n=>n!=='3dRoom'&&n!=='random'));
 const failures=[],audit=[];
 for(const name of [...names,'random','random','random']){
  const result=await page.evaluate(async name=>{
   if(name==='random')document.querySelector('[data-theme="random"]').click();else(await import('/js/themeController.js')).default.applyTheme(name);
   // Inspect settled palette pairs, not mismatched foreground/background transition frames.
   document.getAnimations().forEach(a=>{if(Number.isFinite(a.effect?.getComputedTiming().endTime))a.finish();});
   const c=document.createElement('canvas').getContext('2d');c.canvas.width=c.canvas.height=1;
   const rgba=value=>{c.clearRect(0,0,1,1);c.fillStyle=value;c.fillRect(0,0,1,1);return [...c.getImageData(0,0,1,1).data];};
   const lum=rgb=>rgb.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
   function contrast(el){const chain=[];for(let p=el;p;p=p.parentElement)chain.unshift(p);let bg=[255,255,255];for(const p of chain){const col=rgba(getComputedStyle(p).backgroundColor),a=col[3]/255;bg=bg.map((v,i)=>col[i]*a+v*(1-a));}const f=lum(rgba(getComputedStyle(el).color).slice(0,3)),b=lum(bg);return (Math.max(f,b)+.05)/(Math.min(f,b)+.05);}
   return {font:getComputedStyle(document.body).fontFamily,controls:[...document.querySelectorAll('.workflow-feature button,.workflow-feature input,.workflow-feature select')].filter(el=>!el.disabled).map(el=>({name:el.getAttribute('aria-label')||el.labels?.[0]?.textContent.trim().slice(0,60)||el.textContent.slice(0,60)||el.type,owner:el.closest('.workflow-feature')?.id,font:getComputedStyle(el).fontFamily,foreground:getComputedStyle(el).color,background:getComputedStyle(el).backgroundColor,contrast:contrast(el)}))};
  },name);
  expect(result.controls.length,name).toBeGreaterThan(0);audit.push({theme:name,...result});for(const control of result.controls){if(control.font!==result.font)failures.push({theme:name,...control,issue:'font',expected:result.font});if(control.contrast<4.5)failures.push({theme:name,...control,issue:'contrast',minimum:4.5});}
 }
 await test.info().attach('workflow-theme-audit',{body:Buffer.from(JSON.stringify({audit,failures})),contentType:'application/json'});
 expect(failures,'Every workflow control must use the active font and readable settled colors').toEqual([]);
});
