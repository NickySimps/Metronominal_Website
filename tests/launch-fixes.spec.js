const {test,expect}=require('@playwright/test');
test('Effects owns Escape before the next animation frame and restores focus within its parent',async({page})=>{
  await page.goto('./');
  await expect(page.locator('#share-btn')).toHaveClass(/(?:^|\s)connected(?:\s|$)/);
  await page.locator('.main-sound-label').first().click();
  await expect(page.locator('#sound-settings-modal')).toBeVisible();
  const effects=page.locator('#sound-effects-btn');await effects.focus();
  await page.evaluate(()=>{
    const frame=window.requestAnimationFrame;
    window.__frames=[];window.requestAnimationFrame=callback=>{window.__frames.push(callback);return -window.__frames.length;};
    window.__restoreFrames=()=>{window.requestAnimationFrame=frame;for(const callback of window.__frames.splice(0))frame(callback);};
  });
  try{
    await effects.press('Enter');
    await expect(page.locator('#sound-effects-modal')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#sound-effects-modal')).toBeHidden();
    await expect(page.locator('#sound-settings-modal')).toBeVisible();
    await expect(effects).toBeFocused();
  }finally{await page.evaluate(()=>window.__restoreFrames());}
});
