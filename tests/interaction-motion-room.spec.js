'use strict';
const {test,expect}=require('@playwright/test');
const prepare=require('./workflowTestPage.cjs');
async function state(page){return page.evaluate(async()=>(await import('./js/webrtc.js')).getRehearsalRoomState());}
async function peer(browser,metadata,url){
 const context=await browser.newContext({serviceWorkers:'block',viewport:{width:1280,height:900}});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 page.on('websocket',socket=>socket.on('framereceived',frame=>{try{const m=JSON.parse(frame.payload);if(m.type==='error')errors.push(`room-protocol:${/^[a-z0-9-]{1,60}$/.test(m.code)?m.code:'unclassified'}`);}catch{}}));
 await prepare(page,metadata);
 await page.addInitScript(()=>{const Native=window.WebSocket;window.WebSocket=class extends Native{constructor(...args){super(...args);window.__roomSocket=this;}};});
 await page.goto(url);
 await expect.poll(async()=>(await state(page)).joined).toBe(true);
 await expect(page.locator('#workflow-tools-status')).toContainText('Editing previews');
 const dismiss=page.locator('#dismiss-connection-modal-btn');if(await dismiss.isVisible())await dismiss.click();
 await page.evaluate(async()=>{
  const {initializeRehearsalRoomControls}=await import('./js/rehearsalRoomController.js');
  const {initializeInteractionMotion}=await import('./js/interactionMotion.js');initializeInteractionMotion(document);
  // Explicit real component fixture: same controller and stylesheet order, visible
  // beside the running application, no transport/audio/authority substitutes.
  const root=document.getElementById('rehearsal-room-root')||document.createElement('section');root.id='room-motion-fixture';
  Object.assign(root.style,{position:'fixed',inset:'16px',zIndex:'10000',background:'#20242c',color:'white',overflow:'auto',padding:'16px'});
  document.body.append(root);window.__roomCleanup=initializeRehearsalRoomControls(root);
  window.__roomMotion=[];
  new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes){
   if(node.nodeType!==1||!node.hasAttribute('data-motion-kind'))continue;
   const r=node.getBoundingClientRect(),style=getComputedStyle(node);
   __roomMotion.push({kind:node.dataset.motionKind,x:r.x,y:r.y,width:r.width,height:r.height,visible:style.display!=='none'&&r.width>0&&r.height>0&&r.right>0&&r.bottom>0&&r.left<innerWidth&&r.top<innerHeight});
   if(window.__freezeKind===node.dataset.motionKind)for(const animation of node.getAnimations()){animation.pause();animation.currentTime=80;}
  }}).observe(document.querySelector('[data-interaction-motion-root]'),{childList:true});
 });
 return {context,page,errors,root:page.locator('#room-motion-fixture')};
}
async function clear(...peers){for(const p of peers)await p.page.evaluate(()=>{window.__roomMotion=[];});}
async function kinds(p){return p.page.evaluate(()=>window.__roomMotion.map(e=>e.kind));}
async function count(p,kind){return (await kinds(p)).filter(k=>k===kind).length;}
async function holdReadiness(p){await p.page.evaluate(()=>{
 const native=WebSocket.prototype.send;window.__heldReady=[];
 WebSocket.prototype.send=function(raw,...args){let type;try{type=JSON.parse(raw).type;}catch{}
  if(type==='readiness'){__heldReady.push(()=>native.call(this,raw,...args));return;}
  return native.call(this,raw,...args);
 };
 window.__releaseReady=async()=>{
  // Forward every real held message, respecting the server's existing 100ms
  // minimum readiness-report interval rather than manufacturing an ACK burst.
  while(__heldReady.length){__heldReady.shift()();await new Promise(resolve=>setTimeout(resolve,120));}
  WebSocket.prototype.send=native;
 };
});}
async function holdCommands(p,type){await p.page.evaluate(type=>{
 const native=WebSocket.prototype.send;const held=[];
 WebSocket.prototype.send=function(raw,...args){let kind;try{kind=JSON.parse(raw).type;}catch{}
  if(kind===type){held.push(()=>native.call(this,raw,...args));return;}
  return native.call(this,raw,...args);
 };
 window.__releaseCommand=()=>{WebSocket.prototype.send=native;for(const send of held.splice(0))send();};
},type);}
async function closePeers(...peers){
 // The closing host is deliberately excluded from the server broadcast. Read
 // the other peer's real closure, then stop every owned client's retry timers.
 try{
  let closed=false;
  for(const p of peers)if(!p.page.isClosed()&&(await state(p.page)).isHost){
   closed=await p.page.evaluate(()=>{if(window.__roomSocket?.readyState!==WebSocket.OPEN)return false;window.__roomSocket.send(JSON.stringify({type:'close-room'}));return true;});
   if(closed){for(const other of peers)if(other!==p&&!other.page.isClosed()&&(await state(other.page)).joined)await expect.poll(async()=>(await state(other.page)).recoveryMessage).toMatch(/closed/i);break;}
  }
 }finally{
  for(const p of peers)if(!p.page.isClosed())await p.page.evaluate(async()=>{window.__roomCleanup?.();(await import('./js/webrtc.js')).disconnect();});
  for(const p of peers)await p.context.close();
 }
}
test('readiness and label feedback wait for the real roster and ignore diagnostic reports',async({browser,baseURL},info)=>{
 const h=await peer(browser,info.config.metadata,baseURL);let c;
 try{
  c=await peer(browser,info.config.metadata,h.page.url());
  await expect.poll(async()=>(await state(h.page)).participants.length).toBe(2);
  await clear(h,c);await holdReadiness(c);
  await c.root.getByLabel('Local peer label (not personal information)').fill('Room percussion');
  await c.root.getByLabel('Local peer label (not personal information)').press('Tab');
  await expect.poll(()=>count(c,'pending')).toBe(1);
  expect(await count(c,'ready')).toBe(0);
  const readyControl=c.root.getByLabel('I am ready'),readyBox=await readyControl.boundingBox();
  await readyControl.check();await expect(readyControl).toBeFocused();
  expect(await readyControl.boundingBox()).toEqual(readyBox);
  await expect.poll(()=>count(c,'pending')).toBe(2);
  expect(await count(c,'ready')).toBe(0);expect(await count(h,'ready')).toBe(0);
  await c.page.evaluate(()=>{window.__freezeKind='ready';return window.__releaseReady();});
  await c.page.waitForFunction(()=>__roomMotion.some(e=>e.kind==='ready'),null,{polling:10});
  await c.page.screenshot({path:info.outputPath('confirmed-ready.png')});
  await expect.poll(async()=>(await state(h.page)).participants.some(p=>p.name==='Room percussion'&&p.ready)).toBe(true);
  await expect.poll(()=>count(c,'ready')).toBeGreaterThan(0);
  await expect.poll(()=>count(h,'ready')).toBeGreaterThan(0);
  const readyEvidence=await c.page.evaluate(()=>__roomMotion.filter(e=>e.kind==='ready'));
  expect(readyEvidence.every(e=>e.visible),JSON.stringify(readyEvidence)).toBe(true);
  await clear(h,c);
  // A real periodic readiness publication carries changing diagnostics but no
  // semantic label/readiness/presence/authority change.
  await c.page.waitForTimeout(2300);
  await expect(c.page.locator('[data-interaction-motion-root] [data-motion-kind]')).toHaveCount(0);
  expect(await kinds(h)).toEqual([]);expect(await kinds(c)).toEqual([]);
  await c.root.getByLabel('Local peer label (not personal information)').fill('<invalid>');
  await c.root.getByLabel('Local peer label (not personal information)').press('Tab');
  await expect.poll(()=>count(c,'refuse')).toBe(1);expect(await count(c,'ready')).toBe(0);
  expect(h.errors).toEqual([]);expect(c.errors).toEqual([]);
 }finally{await closePeers(...[h,c].filter(Boolean));}
});
test('control send is pending until genuine stopped handoff changes authority on both peers',async({browser,baseURL},info)=>{
 const h=await peer(browser,info.config.metadata,baseURL);let c;
 try{
  c=await peer(browser,info.config.metadata,h.page.url());
  await expect.poll(async()=>(await state(h.page)).participants.length).toBe(2);
  await clear(h,c);await holdCommands(c,'control-request');
  await c.root.getByRole('button',{name:'Request control',exact:true}).click();
  await expect.poll(()=>count(c,'pending')).toBe(1);
  expect((await state(c.page)).isHost).toBe(false);expect(await count(c,'handoff')).toBe(0);
  await c.page.evaluate(()=>window.__releaseCommand());
  const id=(await state(c.page)).ownPeerId;
  await expect.poll(async()=>(await state(h.page)).requests.includes(id)).toBe(true);
  expect(await count(h,'handoff')).toBe(0);expect(await count(c,'handoff')).toBe(0);
  await holdCommands(h,'handoff-control');
  await h.root.getByRole('button',{name:'Approve and hand off',exact:true}).click();
  await expect.poll(()=>count(h,'pending')).toBe(1);
  expect((await state(h.page)).isHost).toBe(true);expect(await count(h,'handoff')).toBe(0);
  await h.page.evaluate(()=>{window.__freezeKind='handoff';window.__releaseCommand();});
  await h.page.waitForFunction(()=>__roomMotion.some(e=>e.kind==='handoff'),null,{polling:10});
  await h.page.screenshot({path:info.outputPath('confirmed-handoff.png')});
  for(const p of [h,c])await expect.poll(async()=>{const s=await state(p.page);return s.hostPeerId===id&&s.participants.some(p=>p.peerId===id&&p.role==='host'&&p.connected);}).toBe(true);
  await expect.poll(async()=>(await state(c.page)).isHost).toBe(true);
  await expect.poll(async()=>(await state(h.page)).isHost).toBe(false);
  await expect.poll(()=>count(h,'handoff')).toBe(1);await expect.poll(()=>count(c,'handoff')).toBe(1);
  expect(await h.page.evaluate(()=>__roomMotion.filter(e=>e.kind==='handoff').every(e=>e.visible))).toBe(true);
  expect(await h.page.evaluate(async()=>(await import('./js/webrtc.js')).broadcastScheduledPlay())).toBe(false);
  await c.page.evaluate(async()=>{const a=(await import('./js/appState.js')).default;a.setTempo(193);await(await import('./js/webrtc.js')).sendState(a.getCurrentStateForPreset(true));});
  await expect.poll(()=>h.page.evaluate(async()=>(await import('./js/appState.js')).default.getTempo())).toBe(193);
  await clear(h,c);await c.page.waitForTimeout(2300);
  expect(await kinds(h)).toEqual([]);expect(await kinds(c)).toEqual([]);
  expect(h.errors).toEqual([]);expect(c.errors).toEqual([]);
 }finally{await closePeers(...[h,c].filter(Boolean));}
});
test('presence and reconnect use actual membership; closing-socket control is refused, resync has no claimed ACK',async({browser,baseURL},info)=>{
 const h=await peer(browser,info.config.metadata,baseURL);let c;
 try{
  await clear(h);c=await peer(browser,info.config.metadata,h.page.url());
  await expect.poll(()=>count(h,'connect')).toBe(1);
  await clear(h,c);
  await c.page.evaluate(()=>{window.__roomSocket.close(4001,'Local test reconnect');document.querySelector('#room-motion-fixture button').click();});
  await expect.poll(()=>count(c,'refuse')).toBe(1);
  expect(await count(c,'handoff')).toBe(0);expect(await count(c,'ready')).toBe(0);
  await expect.poll(()=>count(h,'disconnect')).toBe(1);
  await expect.poll(async()=>(await state(c.page)).joined).toBe(true);
  await expect.poll(()=>count(h,'connect')).toBe(1);
  await clear(h,c);
  await c.root.getByRole('button',{name:'Reconnect',exact:true}).click();
  await expect.poll(()=>count(c,'pending')).toBe(1);
  await expect.poll(()=>count(c,'connect')).toBe(1);
  expect((await state(c.page)).joined).toBe(true);expect((await state(c.page)).isHost).toBe(false);
  await clear(h,c);
  await c.root.getByRole('button',{name:'Resync room',exact:true}).click();
  await expect.poll(()=>count(c,'pending')).toBe(1);
  await c.page.waitForTimeout(2300);
  expect((await kinds(c)).filter(k=>['ready','connect','handoff','confirm'].includes(k))).toEqual([]);
  expect(h.errors).toEqual([]);expect(c.errors).toEqual([]);
 }finally{await closePeers(...[h,c].filter(Boolean));}
});
test('restore pending resolves only after the rightful host is confirmed again',async({browser,baseURL},info)=>{
 const h=await peer(browser,info.config.metadata,baseURL);let c;
 try{
  c=await peer(browser,info.config.metadata,h.page.url());
  await expect.poll(async()=>(await state(h.page)).participants.length).toBe(2);
  await h.page.evaluate(async()=>{(await import('./js/webrtc.js')).disconnect();});
  await expect.poll(async()=>(await state(c.page)).hostConnected).toBe(false);
  await clear(h,c);
  await h.root.getByRole('button',{name:'Restore my room',exact:true}).click();
  await expect.poll(()=>count(h,'pending')).toBe(1);
  await expect.poll(async()=>{const s=await state(h.page);return s.joined&&s.isHost&&s.hostConnected&&s.hostPeerId===s.ownPeerId;}).toBe(true);
  await expect.poll(()=>count(h,'connect')).toBe(1);
  await expect.poll(async()=>(await state(c.page)).hostConnected).toBe(true);
  expect((await state(c.page)).isHost).toBe(false);expect((await state(h.page)).playing).toBe(false);
  await clear(h,c);await h.page.waitForTimeout(2300);
  expect(await kinds(h)).toEqual([]);expect(await kinds(c)).toEqual([]);
  // Controller listener teardown cannot create new semantic decoration.
  await h.page.evaluate(()=>{window.__roomCleanup();document.dispatchEvent(new Event('rehearsalroomchange'));});
  expect(await kinds(h)).toEqual([]);expect(h.errors).toEqual([]);expect(c.errors).toEqual([]);
 }finally{await closePeers(...[h,c].filter(Boolean));}
});
