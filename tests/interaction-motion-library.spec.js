'use strict';
const {test,expect}=require('@playwright/test');
const open=require('./motionTestPage.cjs');
const KEY='metronominal.rehearsal.v1', BACKUP=KEY+'.backup';
async function ready(page,info,url){
 if(url){await require('./workflowTestPage.cjs')(page,info.config.metadata);await page.goto(url);await expect(page.locator('#share-btn')).toHaveClass(/(?:^|\s)connected(?:\s|$)/);await expect(page.locator('#workflow-tools-status')).toContainText('Editing previews');await page.evaluate(()=>{window.__motionObserved=[];new MutationObserver(records=>{for(const r of records)for(const n of r.addedNodes)if(n.nodeType===1&&n.hasAttribute('data-motion-kind'))__motionObserved.push(n.dataset.motionKind);}).observe(document.querySelector('[data-interaction-motion-root]'),{childList:true,subtree:true});});}
 else await open(page,info.config.metadata);
 await page.evaluate(async()=>{
  const root=document.createElement('section');root.id='library-motion-fixture';
  Object.assign(root.style,{position:'fixed',inset:'12px',zIndex:10000,background:'#20242c',color:'white',overflow:'auto',padding:'12px'});document.body.append(root);
  window.library=(await import('./js/rehearsalLibrary.js')).initializeRehearsalLibrary(root);
  window.app=(await import('./js/appState.js')).default;window.song=(await import('./js/songController.js')).default;
  window.envelope=async name=>({format:'metronominal-rehearsal',version:1,lists:[{name,songs:[{name:'Song',payload:await song.createPayload()}]}],cues:[]});
 });
 await page.locator('#library-motion-fixture summary').filter({hasText:'Setlists'}).click();
 await reset(page);
 return page.locator('#library-motion-fixture');
}
async function reset(page){await page.evaluate(()=>{__motionObserved=[];});}
async function kinds(page){return page.evaluate(()=>__motionObserved);}
async function saved(page){return page.evaluate(k=>JSON.parse(localStorage.getItem(k)),KEY);}
async function create(root,name){await root.locator('[data-name]').fill(name);await root.locator('[data-create]').click();}
async function outcome(page,action,kind){await reset(page);await action();await expect.poll(()=>kinds(page)).toContain(kind);}
async function file(root,value){await root.locator('[data-import]').setInputFiles({name:'generated-library.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(value))});}
async function downloaded(page,action){const promise=page.waitForEvent('download');await action();const d=await promise,stream=await d.createReadStream();let raw='';for await(const chunk of stream)raw+=chunk.toString();return raw;}
async function cleanup(page){await page.evaluate(async()=>{library?.destroy();(await import('./js/webrtc.js')).disconnect();});}
test('accepted setlist creation decorates only after persisted data and leaves music unchanged',async({page},info)=>{
 const root=await ready(page,info);
 try{
  const before=await page.evaluate(async()=>song.validatePayload(await song.createPayload()).state);
  await create(root,'Friday');
  expect((await saved(page)).lists).toEqual([{name:'Friday',songs:[]}]);
  await expect.poll(()=>kinds(page)).toContain('save');
  expect(await page.evaluate(async()=>song.validatePayload(await song.createPayload()).state)).toEqual(before);
  expect(JSON.stringify(await saved(page))).not.toMatch(/hostCredential|listeningMix|serializedRecordings/);
  await expect(page.locator('[data-interaction-motion-root] [data-motion-kind]')).toHaveCount(0);
 }finally{await cleanup(page);}
});
test('setlist and entry accepted management outcomes preserve local data and real load Undo',async({page},info)=>{
 const root=await ready(page,info);const btn=name=>root.getByRole('button',{name,exact:true});
 try{
  await create(root,'One');await create(root,'Two');
  await outcome(page,()=>root.locator('[data-select]').selectOption('0'),'select');
  expect(await root.locator('[data-rename]').inputValue()).toBe('One');
  await outcome(page,async()=>{await root.locator('[data-rename]').fill('Gig');await root.locator('[data-rename]').blur();},'rename');
  expect((await saved(page)).lists.map(x=>x.name)).toEqual(['Gig','Two']);
  await outcome(page,()=>btn('Move setlist down').click(),'select');
  expect((await saved(page)).lists.map(x=>x.name)).toEqual(['Two','Gig']);
  await outcome(page,()=>btn('Move setlist up').click(),'select');
  for(const name of ['Alpha','Beta']){
   await page.evaluate(name=>app.setSong({...app.getSong(),name}),name);
   await outcome(page,()=>btn('Add current song').click(),'save');
  }
  expect((await saved(page)).lists[0].songs.map(x=>x.name)).toEqual(['Alpha','Beta']);
  await outcome(page,()=>btn('Move entry 2 up').click(),'select');
  expect((await saved(page)).lists[0].songs.map(x=>x.name)).toEqual(['Beta','Alpha']);
  await outcome(page,()=>btn('Move entry 1 down').click(),'select');
  await outcome(page,async()=>{await root.getByLabel('Entry name 1',{exact:true}).fill('Alias');await root.getByLabel('Entry name 1',{exact:true}).blur();},'rename');
  expect((await saved(page)).lists[0].songs[0].name).toBe('Alias');
  await page.evaluate(()=>app.setSong({...app.getSong(),name:'Unsaved'}));
  const before=await page.evaluate(()=>app.getMusicalSnapshot());
  await outcome(page,()=>btn('Load entry 1').click(),'load');
  expect(await page.evaluate(()=>app.getSong().name)).toBe('Alpha');
  expect(await page.evaluate(()=>app.isPlaying())).toBe(false);
  await page.evaluate(()=>document.getElementById('library-motion-fixture').style.display='none');
  await page.locator('#rehearsal-tools-panel > summary').click();
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  expect(await page.evaluate(()=>app.getMusicalSnapshot())).toEqual(before);
  await page.evaluate(()=>document.getElementById('library-motion-fixture').style.display='');
  await outcome(page,()=>btn('Load entry 1').click(),'load');
  await outcome(page,()=>btn('Next song').click(),'load');expect(await page.evaluate(()=>app.getSong().name)).toBe('Beta');
  await outcome(page,()=>btn('Previous song').click(),'load');expect(await page.evaluate(()=>app.getSong().name)).toBe('Alpha');
  await outcome(page,()=>btn('Remove entry 2').click(),'remove');expect((await saved(page)).lists[0].songs).toHaveLength(1);
  await outcome(page,()=>btn('Remove setlist').click(),'remove');expect((await saved(page)).lists.map(x=>x.name)).toEqual(['Two']);
  await reset(page);await root.locator('[data-rename]').dispatchEvent('change');await root.locator('[data-select]').dispatchEvent('change');
  expect(await kinds(page)).toEqual([]);
 }finally{await cleanup(page);}
});
test('validated file preview merge replace cancel restore and actual export downloads report only completed outcomes',async({page},info)=>{
 const root=await ready(page,info);try{
  await create(root,'Original');const base=await saved(page),music=await page.evaluate(()=>app.getMusicalSnapshot());
  const incoming=await page.evaluate(()=>envelope('Incoming'));
  await outcome(page,()=>file(root,incoming),'upload');expect(await saved(page)).toEqual(base);
  await expect(root.locator('[data-preview]')).toBeVisible();
  await outcome(page,()=>root.locator('[data-cancel]').click(),'cancel');expect(await saved(page)).toEqual(base);await expect(root.locator('[data-preview]')).toBeHidden();
  await file(root,incoming);await outcome(page,()=>root.locator('[data-merge]').click(),'save');expect((await saved(page)).lists.map(x=>x.name)).toEqual(['Original','Incoming']);
  const merged=await saved(page);await file(root,await page.evaluate(()=>envelope('Replacement')));
  await outcome(page,()=>root.locator('[data-replace]').click(),'save');expect((await saved(page)).lists.map(x=>x.name)).toEqual(['Replacement']);
  const replacement=await saved(page);
  expect(await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),BACKUP)).toEqual(merged);
  await outcome(page,()=>root.locator('[data-restore]').click(),'upload');expect((await saved(page)).lists[0].name).toBe('Replacement');
  await outcome(page,()=>root.locator('[data-apply-restore]').click(),'save');expect(await saved(page)).toEqual(merged);
  for(const selector of ['[data-export]','[data-export-backup]','[data-export-original]']){
   await reset(page);const raw=await downloaded(page,()=>root.locator(selector).click());await expect.poll(()=>kinds(page)).toContain('download');
   expect(JSON.parse(raw)).toEqual(selector==='[data-export-backup]'?replacement:merged);
   expect(raw).not.toMatch(/hostCredential|listeningMix|serializedRecordings/);
  }
  expect(await page.evaluate(()=>app.getMusicalSnapshot())).toEqual(music);
 }finally{await cleanup(page);}
});
for(const key of [KEY,BACKUP])test(`synthetic Storage failure ${key} refuses without false success or lost bytes`,async({page},info)=>{
 const root=await ready(page,info);try{
  await create(root,'Keep');const before=await page.evaluate(k=>localStorage.getItem(k),KEY);
  await file(root,await page.evaluate(()=>envelope('Rejected')));await reset(page);
  await page.evaluate(key=>{const write=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k===key)throw new DOMException('Synthetic quota fixture','QuotaExceededError');return write.call(this,k,v);};},key);
  await root.locator('[data-replace]').click();await expect.poll(()=>kinds(page)).toContain('refuse');
  expect(await page.evaluate(k=>localStorage.getItem(k),KEY)).toBe(before);expect(await page.evaluate(()=>library.exportText())).toBe(before);
  if(key===KEY)expect(await page.evaluate(k=>localStorage.getItem(k),BACKUP)).toBe(before);
  expect(await kinds(page)).not.toContain('save');expect(await kinds(page)).not.toContain('confirm');
  await expect(root.locator('[data-preview]')).toBeVisible();
 }finally{await cleanup(page);}
});
test('cue management persists locally; held real send is pending until both peers receive authoritative delivery',async({page,browser},info)=>{
 const root=await ready(page,info),context=await browser.newContext({serviceWorkers:'block',viewport:{width:1280,height:900}}),client=await context.newPage();let peerRoot;
 try{
  peerRoot=await ready(client,info,page.url());
  await expect.poll(()=>page.evaluate(async()=>(await import('./js/webrtc.js')).getRehearsalRoomState().participants.length)).toBe(2);
  await root.locator('summary').filter({hasText:'Setlists'}).click();await root.locator('summary').filter({hasText:'Cues'}).click();
  await peerRoot.locator('summary').filter({hasText:'Setlists'}).click();await peerRoot.locator('summary').filter({hasText:'Cues'}).click();
  for(const text of ['Bridge now','Final chorus']){
   await root.locator('[data-cue-text]').fill(text);await outcome(page,()=>root.locator('[data-cue-add]').click(),'save');
  }
  expect((await saved(page)).cues.map(x=>x.text)).toEqual(['Bridge now','Final chorus']);expect(await saved(client)).toBeNull();
  await outcome(page,()=>root.getByRole('button',{name:'Move cue 2 up',exact:true}).click(),'select');
  await outcome(page,()=>root.getByRole('button',{name:'Move cue 1 down',exact:true}).click(),'select');
  await page.evaluate(()=>{
   const send=WebSocket.prototype.send;window.__heldCue=[];
   WebSocket.prototype.send=function(raw,...args){let type;try{type=JSON.parse(raw).type;}catch{}if(type==='rehearsal-cue'){__heldCue.push(()=>send.call(this,raw,...args));return;}return send.call(this,raw,...args);};
   window.__releaseCue=()=>{WebSocket.prototype.send=send;for(const forward of __heldCue.splice(0))forward();};
  });
  await reset(client);await outcome(page,()=>root.getByRole('button',{name:'Send cue 1 now',exact:true}).click(),'pending');
  expect(await kinds(page)).not.toContain('cue');expect(await kinds(client)).not.toContain('cue');
  expect(await page.evaluate(async()=>(await import('./js/webrtc.js')).getRehearsalRoomState().cue)).toBeNull();
  await expect(root.locator('[data-status]')).toContainText('queued');
  await page.evaluate(()=>__releaseCue());
  for(const p of [page,client]){
   await expect.poll(()=>p.evaluate(async()=>(await import('./js/webrtc.js')).getRehearsalRoomState().cue?.text)).toBe('Bridge now');
   await expect.poll(()=>kinds(p)).toContain('cue');
  }
  await expect(peerRoot.locator('[data-cue-display]')).toHaveText('Room cue: Bridge now');
  await reset(page);await reset(client);await page.waitForTimeout(2300);
  expect(await kinds(page)).toEqual([]);expect(await kinds(client)).toEqual([]);
  await expect(peerRoot.locator('[data-cue-add]')).toBeDisabled();
  await outcome(page,()=>root.getByRole('button',{name:'Remove cue 2',exact:true}).click(),'remove');
  expect((await saved(page)).cues.map(x=>x.text)).toEqual(['Bridge now']);
 }finally{if(peerRoot)await cleanup(client);await context.close();await cleanup(page);}
});
