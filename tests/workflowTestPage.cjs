'use strict';
const routedContexts=new WeakSet();
module.exports=async function prepareWorkflowTestPage(page,metadata={}){
 const context=page.context();
 // Windows WebKit's TLS trust store can reject this CDN while strict host TLS
 // succeeds. Fetch real responses through Playwright's verified API client;
 // do not disable certificate checks or substitute scripts/stubs.
 if(process.platform==='win32'&&context.browser()?.browserType().name()==='webkit'&&!routedContexts.has(context)){
  await context.route('https://cdn.jsdelivr.net/npm/three/**',async route=>{const response=await route.fetch();await route.fulfill({response});});
  routedContexts.add(context);
 }
 const endpoint=metadata.precisionNativeSignalURL;
 if(endpoint)await page.addInitScript(endpoint=>{const Native=window.WebSocket;window.WebSocket=class extends Native{constructor(url,protocols){const value=String(url);super(/^(?:wss:\/\/metronomesignalserver\.onrender\.com|ws:\/\/(?:localhost|127\.0\.0\.1):10000)(?:\/|$)/.test(value)?endpoint:url,protocols);}};},endpoint);
};
