const {test,expect}=require('@playwright/test');
const prepareWorkflowTestPage=require('./workflowTestPage.cjs');
test.beforeEach(async ({page},info)=>prepareWorkflowTestPage(page,info.config.metadata));

async function ready(page){await page.goto('./');await expect(page.locator('#share-btn')).toHaveClass(/(?:^|\s)connected(?:\s|$)/);}
async function editMode(page){await page.locator('.beat-edit-btn').first().click();await expect(page.locator('body')).toHaveClass(/beat-edit-mode/);await expect(page.locator('.track [data-beat-precision-toggle]').first()).toBeVisible();}
async function lens(page){
 const beat=page.locator('.bar-visual .beat-square').first();
 // Each palette audit is a new contact, not another down for an unreleased id.
 await beat.evaluate(el=>el.dispatchEvent(new PointerEvent('pointercancel',{bubbles:true,cancelable:true,pointerType:'touch',pointerId:77,isPrimary:true,button:0})));
 await expect(page.locator('[data-beat-precision-lens]')).toHaveCount(0);
 await page.evaluate(()=>{void document.body.offsetWidth;});
 await expect.poll(()=>page.evaluate(()=>document.fonts.status)).toBe('loaded');
 await beat.scrollIntoViewIfNeeded();
 await page.evaluate(()=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Visible layout frames did not settle')),1500);requestAnimationFrame(()=>requestAnimationFrame(()=>{clearTimeout(timer);resolve();}));}));
 await beat.evaluate(el=>{
  const r=el.getBoundingClientRect(),t=performance.now();
  const down=new PointerEvent('pointerdown',{bubbles:true,cancelable:true,pointerType:'touch',pointerId:77,isPrimary:true,button:0,clientX:r.x+r.width/2,clientY:r.y+r.height/2});
  Object.defineProperty(down,'timeStamp',{value:t});el.dispatchEvent(down);
  for(const [dx,dt] of [[6,80],[12,160],[0,240]]){
   const move=new PointerEvent('pointermove',{bubbles:true,cancelable:true,pointerType:'touch',pointerId:77,isPrimary:true,button:0,clientX:r.x+r.width/2+dx,clientY:r.y+r.height/2});
   Object.defineProperty(move,'timeStamp',{value:t+dt});el.dispatchEvent(move);
  }
 });
 await expect(page.locator('[data-beat-precision-lens]')).toBeVisible();
}
async function metrics(page){return page.evaluate(()=>{
 const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d',{willReadFrequently:true});
 const rgba=color=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data];};
 const lum=rgb=>rgb.slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
 function contrast(el){const chain=[];for(let p=el;p;p=p.parentElement)chain.unshift(p);let bg=[255,255,255];for(const p of chain){const c=rgba(getComputedStyle(p).backgroundColor),a=c[3]/255;bg=bg.map((v,i)=>c[i]*a+v*(1-a));}const fg=rgba(getComputedStyle(el).color),f=lum(fg),b=lum(bg);return (Math.max(f,b)+.05)/(Math.min(f,b)+.05);}
 const group=document.querySelector('.track .beat-precision'),preview=document.querySelector('[data-beat-precision-lens]'),toggle=document.querySelector('.track [data-beat-precision-toggle]');
 const nodes=[toggle,group,...(preview?[preview,...preview.querySelectorAll('button')]:[])].filter(Boolean);
 return {font:getComputedStyle(document.body).fontFamily,previewBG:preview?getComputedStyle(preview).backgroundColor:null,toggleBG:toggle?getComputedStyle(toggle).backgroundColor:null,nodes:nodes.map(el=>({class:el.className,font:getComputedStyle(el).fontFamily,color:getComputedStyle(el).color,background:getComputedStyle(el).backgroundColor,contrast:contrast(el)})),overflow:document.documentElement.scrollWidth>innerWidth,groupInTrack:!!group?.closest('.track')};
 });}
test('contextual controls have no standalone panel or second Edit action',async({page})=>{
 await ready(page);await expect(page.locator('#beat-precision-controls')).toBeHidden();await expect(page.locator('.track [data-beat-precision-toggle]')).toBeHidden();await editMode(page);await expect(page.getByRole('button',{name:'Edit selected beat',exact:true})).toHaveCount(0);await page.locator('.beat-edit-btn').first().click();await expect(page.locator('.track [data-beat-precision-toggle]')).toBeHidden();
});
test('all 2D themes and regenerated palettes recolor and refont the active inline controls and lens',async({page})=>{
 await page.setViewportSize({width:390,height:1400});await ready(page);await editMode(page);await lens(page);
 const names=await page.locator('[data-theme]').evaluateAll(nodes=>[...new Set(nodes.map(n=>n.dataset.theme))].filter(n=>n!=='3dRoom'&&n!=='random'));
 const palettes={};
 for(const name of [...names,...Array.from({length:12},()=> 'random')]){
  await page.evaluate(async name=>{if(name==='random')document.querySelector('[data-theme="random"]').click();else(await import(new URL('js/themeController.js',document.baseURI))).default.applyTheme(name);document.getAnimations().forEach(a=>{if(Number.isFinite(a.effect?.getComputedTiming().endTime))a.finish();});},name);
  await lens(page);const m=await metrics(page);palettes[name]=m;expect(m.groupInTrack,name).toBe(true);expect(m.overflow,name).toBe(false);for(const node of m.nodes){expect(node.font,`${name}: ${node.class} font`).toBe(m.font);expect(node.contrast,`${name}: ${node.class} contrast`).toBeGreaterThanOrEqual(4.5);}
 }
 for(const key of ['previewBG','toggleBG']){expect(palettes.default[key]).not.toBe(palettes.dark[key]);expect(palettes.dark[key]).not.toBe(palettes.synthwave[key]);}
 await page.screenshot({path:test.info().outputPath('precision-contextual-mobile.png'),fullPage:true});
});
test('rehearsal widgets follow the current palette and font instead of independent fixed dark surfaces',async({page})=>{
 await ready(page);await page.locator('#rehearsal-tools-panel > summary').click();
 const names=await page.locator('[data-theme]').evaluateAll(nodes=>[...new Set(nodes.map(n=>n.dataset.theme))].filter(n=>n!=='3dRoom'));
 for(const name of names){
  const m=await page.evaluate(async name=>{
   (await import(new URL('js/themeController.js',document.baseURI))).default.applyTheme(name);
   document.getAnimations().forEach(a=>{if(Number.isFinite(a.effect?.getComputedTiming().endTime))a.finish();});
   const token=name=>{const el=document.createElement('span');el.style.color=`var(${name})`;document.body.append(el);const value=getComputedStyle(el).color;el.remove();return value;};
   const surface=getComputedStyle(document.querySelector('.adaptive-visualization')),select=getComputedStyle(document.querySelector('.adaptive-visualization select')),undo=getComputedStyle(document.querySelector('.edit-history button'));
   return {background:token('--Background'),main:token('--Main'),onBackground:token('--ReadableOnBackground'),onMain:token('--ReadableOnMain'),font:getComputedStyle(document.body).fontFamily,monitorFont:getComputedStyle(document.querySelector('#personal-monitoring')).fontFamily,surfaceBG:surface.backgroundColor,surfaceFG:surface.color,selectBG:select.backgroundColor,selectFG:select.color,selectFont:select.fontFamily,undoBG:undo.backgroundColor,undoFG:undo.color};
  },name);
  expect(m.surfaceBG,name).toBe(m.background);expect(m.surfaceFG,name).toBe(m.onBackground);expect(m.selectBG,name).toBe(m.background);expect(m.selectFG,name).toBe(m.onBackground);expect(m.selectFont,name).toBe(m.font);expect(m.monitorFont,name).toBe(m.font);expect(m.undoBG,name).toBe(m.main);expect(m.undoFG,name).toBe(m.onMain);
 }
});
for(const width of [320,390,1280])test(`track-contained precision fits ${width}px without an idle footprint`,async({page})=>{
 await page.setViewportSize({width,height:1000});await ready(page);await expect(page.locator('#beat-precision-controls')).toBeHidden();await editMode(page);const m=await page.locator('.track [data-beat-precision-toggle]').first().evaluate(el=>{const r=el.getBoundingClientRect(),t=el.closest('.track').getBoundingClientRect();return {left:r.left,right:r.right,width:r.width,height:r.height,trackLeft:t.left,trackRight:t.right,scroll:document.documentElement.scrollWidth,viewport:innerWidth};});expect(m.left).toBeGreaterThanOrEqual(m.trackLeft);expect(m.right).toBeLessThanOrEqual(m.trackRight);expect(m.width).toBeGreaterThanOrEqual(44);expect(m.height).toBeGreaterThanOrEqual(44);expect(m.scroll).toBeLessThanOrEqual(m.viewport);
});
