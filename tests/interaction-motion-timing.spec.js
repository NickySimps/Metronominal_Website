'use strict';
const {test,expect}=require('@playwright/test');
const open=require('./motionTestPage.cjs');
async function ready(page,metadata){await open(page,metadata);await page.locator('#rehearsal-tools-panel > summary').click();await page.evaluate(async()=>{window.p=(await import('/js/practiceTransport.js'));window.a=(await import('/js/appState.js')).default;__motionObserved=[];});}
for(const boundary of ['cancel','restart','room boundary'])test('calibration '+boundary+' owns native cancellation and never confirms the obsolete session',async({page},info)=>{
 await ready(page,info.config.metadata);const button=page.locator('[data-calibrate]');await button.scrollIntoViewIfNeeded();await button.click();await expect.poll(()=>page.evaluate(()=>__motionObserved.includes('pending'))).toBe(true);await page.evaluate(()=>{__motionObserved=[];});
 if(boundary==='restart')await button.click();else await page.evaluate(boundary=>{if(boundary==='room boundary')document.dispatchEvent(new Event('roomauthoritychange'));else p.cancelCalibration();},boundary);
 await expect.poll(()=>page.evaluate(()=>__motionObserved.includes('cancel'))).toBe(true);
 if(boundary==='restart'){await expect.poll(()=>page.evaluate(()=>__motionObserved.includes('pending'))).toBe(true);await expect.poll(()=>page.evaluate(()=>__motionObserved.filter(x=>x==='confirm').length)).toBe(1);}
 else{await page.waitForTimeout(2800);expect(await page.evaluate(()=>__motionObserved.includes('confirm'))).toBe(false);}
 await page.evaluate(()=>{p.cancelCalibration();__motionObserved=[];p.cancelCalibration();});expect(await page.evaluate(()=>__motionObserved)).toEqual([]);
});

test('tap timing refuses absent beats and acknowledges a real scheduled native tap classification',async({page},info)=>{
 await ready(page,info.config.metadata);const tap=page.locator('[data-tap]');await tap.click();await expect.poll(()=>page.evaluate(()=>__motionObserved.includes('refuse'))).toBe(true);
 await page.evaluate(()=>{window.nativePracticeStarts=0;const native=OscillatorNode.prototype.start;OscillatorNode.prototype.start=function(...args){const result=native.apply(this,args);nativePracticeStarts++;return result;};__motionObserved=[];});
 try{
  await page.locator('#start-stop-btn').click();await expect.poll(()=>page.evaluate(()=>a.isPlaying())).toBe(true);await expect.poll(()=>page.evaluate(()=>nativePracticeStarts)).toBeGreaterThan(0);
  await page.evaluate(()=>{__motionObserved=[];});await tap.click();await expect.poll(()=>page.evaluate(()=>p.getTapTimingState().count)).toBe(1);
  const expected=await page.evaluate(()=>({rush:'accent',drag:'ghost',centered:'confirm'})[p.getTapTimingState().tendency]);await expect.poll(()=>page.evaluate(kind=>__motionObserved.includes(kind),expected)).toBe(true);
 }finally{if(await page.evaluate(()=>a.isPlaying())){await page.locator('#start-stop-btn').click();await expect.poll(()=>page.evaluate(()=>a.isPlaying())).toBe(false);}}
});

test('calibration confirms only after four native sources end and four existing flashes present',async({page},info)=>{
 await ready(page,info.config.metadata);const button=page.locator('[data-calibrate]');await button.scrollIntoViewIfNeeded();
 await page.evaluate(()=>{window.calibrationEnds=0;window.calibrationStarts=0;window.calibrationFlashes=0;const native=OscillatorNode.prototype.start;OscillatorNode.prototype.start=function(...args){this.addEventListener('ended',()=>calibrationEnds++);const result=native.apply(this,args);calibrationStarts++;return result;};document.addEventListener('calibrationframe',()=>calibrationFlashes++);__motionObserved=[];});
 try{
  await button.click();await expect.poll(()=>page.evaluate(()=>__motionObserved.includes('pending'))).toBe(true);expect(await page.evaluate(()=>calibrationStarts)).toBe(4);
  await expect.poll(()=>page.evaluate(()=>__motionObserved.includes('confirm'))).toBe(true);expect(await page.evaluate(()=>({ends:calibrationEnds,flashes:calibrationFlashes}))).toEqual({ends:4,flashes:4});
 }finally{await page.evaluate(()=>p.cancelCalibration());}
});

test('local output correction acknowledges actual saved session-only refused and unchanged outcomes',async({page},info)=>{
 await ready(page,info.config.metadata);const input=page.locator('[data-output-offset]');await input.scrollIntoViewIfNeeded();const before=await page.evaluate(()=>a.getMusicalSnapshot());
 await input.fill('17');await input.blur();await expect.poll(()=>page.evaluate(()=>__motionObserved.includes('save'))).toBe(true);expect(await page.evaluate(()=>localStorage.getItem('metronominal.outputCorrectionMs'))).toBe('17');
 await page.evaluate(()=>{__motionObserved=[];});await input.dispatchEvent('change');expect(await page.evaluate(()=>__motionObserved)).toEqual([]);
 await input.fill('501');await input.blur();await expect.poll(()=>page.evaluate(()=>__motionObserved.includes('refuse'))).toBe(true);expect(await page.evaluate(()=>p.getLocalTimingState().outputOffsetMs)).toBe(17);
 await page.evaluate(()=>{const native=Storage.prototype.setItem;Storage.prototype.setItem=function(key,...args){if(key==='metronominal.outputCorrectionMs')throw new DOMException('Generated storage refusal','QuotaExceededError');return native.call(this,key,...args);};__motionObserved=[];});
 await input.fill('23');await input.blur();await expect.poll(()=>page.evaluate(()=>__motionObserved.includes('adjust'))).toBe(true);expect(await page.evaluate(()=>__motionObserved.includes('save'))).toBe(false);expect(await page.evaluate(()=>p.getLocalTimingState().outputOffsetMs)).toBe(23);expect(await page.evaluate(()=>a.getMusicalSnapshot())).toEqual(before);
});
