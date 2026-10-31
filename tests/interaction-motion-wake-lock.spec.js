'use strict';
const {test,expect}=require('@playwright/test');const open=require('./motionTestPage.cjs');
async function ready(page,metadata){await open(page,metadata);await page.evaluate(async()=>{window.a=(await import('/js/appState.js')).default;});await page.keyboard.press('Shift');await expect.poll(()=>page.evaluate(async()=>(await import('/js/userInteraction.js')).default.audioContextInitialized)).toBe(true);await page.evaluate(()=>{__motionObserved=[];});}
test('stored Keep Awake desire has local selection feedback without claiming native acquisition',async({page},info)=>{
 await ready(page,info.config.metadata);const before=await page.evaluate(()=>a.getMusicalSnapshot());await page.locator('#screen-off-toggle-btn').click();expect(await page.evaluate(()=>a.isWakeLockEnabled())).toBe(true);expect(await page.evaluate(()=>a.isPlaying())).toBe(false);await expect.poll(()=>page.evaluate(()=>__motionObserved.includes('select'))).toBe(true);expect(await page.evaluate(()=>__motionObserved.includes('ready'))).toBe(false);expect(await page.evaluate(()=>a.getMusicalSnapshot())).toEqual(before);
});
for (const lifetime of ['new acquisition', 'disposed feedback', 'current feedback']) test('deferred Wake Lock release refusal belongs only to its '+lifetime, async ({page}, info) => {
 await page.context().grantPermissions(['screen-wake-lock']);
 await ready(page, info.config.metadata);
 await page.locator('#screen-off-toggle-btn').click();
 await page.evaluate(() => {
  window.wakeRequests = [];
  window.wakeReleaseCalls = 0;
  window.wakeNativeReleaseCalls = 0;
  const request = navigator.wakeLock.request.bind(navigator.wakeLock);
  navigator.wakeLock.request = async (...args) => {
   const sentinel = await request(...args);
   const release = sentinel.release.bind(sentinel);
   wakeRequests.push({sentinel, release});
   sentinel.release = () => {
    ++wakeReleaseCalls;
    if (wakeRequests[0].sentinel === sentinel) return new Promise((resolve, reject) => { window.rejectOldWakeRelease = reject; });
    ++wakeNativeReleaseCalls;
    return release();
   };
   return sentinel;
  };
  window.wakeRejectionSeen = false;
  window.addEventListener('unhandledrejection', event => {
   if (event.reason?.message === 'held native release refusal') {
    wakeRejectionSeen = true;
    event.preventDefault();
   }
  });
 });
 try {
  await page.locator('#start-stop-btn').click();
  await expect.poll(() => page.evaluate(() => a.isPlaying() && wakeRequests.length === 1 && __motionObserved.includes('ready'))).toBe(true);
  await page.locator('#start-stop-btn').click();
  await expect.poll(() => page.evaluate(() => !a.isPlaying() && typeof rejectOldWakeRelease === 'function')).toBe(true);
  if (lifetime === 'new acquisition') {
   await page.locator('#start-stop-btn').click();
   await expect.poll(() => page.evaluate(() => a.isPlaying() && wakeRequests.length === 2 && __motionObserved.filter(kind => kind === 'ready').length === 2)).toBe(true);
  } else if (lifetime === 'disposed feedback') {
   await page.evaluate(async () => (await import('/js/playbackController.js')).default.disposeMotionFeedback());
  }
  await page.evaluate(() => { __motionObserved = []; rejectOldWakeRelease(new Error('held native release refusal')); });
  await expect.poll(() => page.evaluate(() => wakeRejectionSeen)).toBe(true);
  expect(await page.evaluate(() => __motionObserved.includes('refuse'))).toBe(lifetime === 'current feedback');
  expect(await page.evaluate(() => ({calls:wakeReleaseCalls,nativeCalls:wakeNativeReleaseCalls,released:wakeRequests.map(({sentinel}) => sentinel.released)}))).toEqual({calls:1,nativeCalls:0,released:lifetime === 'new acquisition' ? [false,false] : [false]});
 } finally {
  await page.evaluate(async () => {
   if (a.isPlaying()) await (await import('/js/metronomeEngine.js')).default.togglePlay();
   for (const {sentinel,release} of wakeRequests) if (!sentinel.released) await release();
  });
 }
});
for(const denied of [false,true])test('native Wake Lock '+(denied?'policy refusal':'observed lifecycle')+' is not optimistic feedback',async({page,baseURL},info)=>{

 if(denied){await page.route(new URL('/',baseURL).href,async route=>{const response=await route.fetch();await route.fulfill({response,headers:{...response.headers(),'permissions-policy':'screen-wake-lock=()'}});});await page.context().grantPermissions(['local-network-access']);}
 await ready(page,info.config.metadata);await page.locator('#screen-off-toggle-btn').click();await page.evaluate(()=>{window.nativeWakeOutcome='pending';window.nativeWakeReleased=false;if(!navigator.wakeLock){nativeWakeOutcome='unsupported';return;}const original=navigator.wakeLock.request.bind(navigator.wakeLock);navigator.wakeLock.request=async(...args)=>{try{const sentinel=await original(...args);window.nativeWakeSentinel=sentinel;nativeWakeOutcome=sentinel.released?'released':'accepted';sentinel.addEventListener('release',()=>{nativeWakeReleased=true;});return sentinel;}catch(error){nativeWakeOutcome='refused';throw error;}};__motionObserved=[];});
 try{await page.locator('#start-stop-btn').click();await expect.poll(()=>page.evaluate(()=>a.isPlaying())).toBe(true);await expect.poll(()=>page.evaluate(()=>nativeWakeOutcome)).not.toBe('pending');const outcome=await page.evaluate(()=>nativeWakeOutcome);await info.attach('native-wake-attempt',{body:Buffer.from(JSON.stringify(await page.evaluate(()=>({outcome:nativeWakeOutcome,playing:a.isPlaying(),desired:a.isWakeLockEnabled(),visibility:document.visibilityState,kinds:__motionObserved})))),contentType:'application/json'});if(denied)expect(outcome).toBe('refused');await expect.poll(()=>page.evaluate(kind=>__motionObserved.includes(kind),outcome==='accepted'?'ready':'refuse')).toBe(true);if(outcome!=='accepted')expect(await page.evaluate(()=>__motionObserved.includes('ready'))).toBe(false);await page.evaluate(()=>{__motionObserved=[];});await page.locator('#start-stop-btn').click();await expect.poll(()=>page.evaluate(()=>a.isPlaying())).toBe(false);if(outcome==='accepted'){await expect.poll(()=>page.evaluate(()=>nativeWakeReleased&&nativeWakeSentinel.released)).toBe(true);await expect.poll(()=>page.evaluate(()=>__motionObserved.includes('cancel'))).toBe(true);}await info.attach('native-wake-outcome',{body:Buffer.from(JSON.stringify({outcome,policyDenied:denied,physicalScreenCertification:false})),contentType:'application/json'});}
 finally{await page.evaluate(async()=>{if(a.isPlaying())await (await import('/js/metronomeEngine.js')).default.togglePlay();if(window.nativeWakeSentinel&&!nativeWakeSentinel.released)await nativeWakeSentinel.release();});}
});
