const {test,expect}=require('@playwright/test');const fs=require('node:fs');const path=require('node:path');const http=require('node:http');
// Presentation-only fixture: real production HTML/CSS; no capture success is fabricated.
let server,origin;const root=path.join(__dirname,'..');
test.beforeAll(async()=>{server=http.createServer((req,res)=>{const name=req.url==='/'?'index.html':req.url.split('?')[0].slice(1);if(name.includes('..')){res.writeHead(403);res.end();return;}const file=path.join(root,name);try{let data=fs.readFileSync(file);if(name==='index.html')data=Buffer.from(data.toString().replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''));res.setHeader('Content-Type',name.endsWith('.css')?'text/css':name.endsWith('.js')?'text/javascript':name.endsWith('.html')?'text/html':'application/octet-stream');res.end(data);}catch{res.writeHead(404);res.end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));origin=`http://127.0.0.1:${server.address().port}`;});
test.afterAll(async()=>{await new Promise(r=>server.close(r));});
for(const width of [320,390,1280])test(`recording controls stay inside their themed ${width}px modal`,async({page})=>{
 await page.setViewportSize({width,height:900});await page.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());await page.goto(origin);
 await expect(page.locator('#recording-mode-controls')).toBeHidden();
 const modal=page.locator('#recording-display-modal');await expect(modal.locator('#recording-mode-voice-btn')).toHaveCount(1);
 await expect(page.locator('select#recording-mode')).toHaveCount(0);await expect(modal.locator('#recording-start-btn')).toHaveText(/start/i);
 await page.evaluate(()=>{const m=document.querySelector('#recording-display-modal');m.hidden=false;m.style.display='flex';});
 await expect(modal.locator('#recording-mode-voice-btn')).toBeVisible();await expect(page.locator('#voice-note-container')).toBeHidden();
 const metrics=await modal.evaluate(el=>{const r=el.getBoundingClientRect();const controls=[...el.querySelectorAll('button,input,select')].filter(b=>b.getBoundingClientRect().width&&b.getBoundingClientRect().height);return{left:r.left,right:r.right,width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1,controls:controls.map(b=>{const r=b.getBoundingClientRect();return{label:b.id,left:r.left,right:r.right,height:r.height,font:getComputedStyle(b).fontFamily,parentFont:getComputedStyle(b.parentElement).fontFamily};})};});
 expect(metrics.left).toBeGreaterThanOrEqual(0);expect(metrics.right).toBeLessThanOrEqual(width+1);expect(metrics.overflow).toBe(false);
 for(const c of metrics.controls){expect(c.left,c.label).toBeGreaterThanOrEqual(0);expect(c.right,c.label).toBeLessThanOrEqual(width+1);expect(c.height,c.label).toBeGreaterThanOrEqual(43);expect(c.font,c.label).toBe(c.parentFont);}
});
