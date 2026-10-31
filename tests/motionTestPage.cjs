'use strict';
const {expect}=require('@playwright/test');const prepare=require('./workflowTestPage.cjs');
module.exports=async function motionTestPage(page,metadata){
 await prepare(page,metadata);await page.goto('./');
 await expect(page.locator('#share-btn')).toHaveClass(/(?:^|\s)connected(?:\s|$)/);
 await expect(page.locator('#workflow-tools-status')).toHaveText('Editing previews never change music until applied. Timing correction and library backups stay on this device.');
 await expect(page.locator('[data-interaction-motion-root]')).toHaveCount(1);
 await page.evaluate(()=>{window.__motionObserved=[];new MutationObserver(records=>{for(const r of records)for(const n of r.addedNodes)if(n.nodeType===1&&n.hasAttribute('data-motion-kind'))__motionObserved.push(n.dataset.motionKind);}).observe(document.querySelector('[data-interaction-motion-root]'),{childList:true,subtree:true});});
};
