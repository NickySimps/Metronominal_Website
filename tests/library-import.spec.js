const { test, expect } = require('@playwright/test');
const KEY = 'metronominal.rehearsal.v1';
const BACKUP = `${KEY}.backup`;
for (const failingKey of [KEY, BACKUP]) test(`failed ${failingKey} write preserves primary and in-memory data`, async ({page}) => {
  await ready(page);
  const before = await page.evaluate(async () => { library.importText(JSON.stringify(await envelope('Before'))); return library.exportText(); });
  await file(page, await page.evaluate(() => envelope('After')));
  await page.evaluate(key => {
    const write = Storage.prototype.setItem;
    Storage.prototype.setItem = function(k,v) { if(k===key) throw new DOMException('Quota test','QuotaExceededError'); return write.call(this,k,v); };
  }, failingKey);
  await page.getByRole('button',{name:'Replace library',exact:true}).click();
  await expect(page.locator('[data-status]')).toContainText('Not saved');
  expect(await page.evaluate(k=>localStorage.getItem(k),KEY)).toBe(before);
  expect(await page.evaluate(()=>library.exportText())).toBe(before);
  if (failingKey===KEY) expect(await page.evaluate(k=>localStorage.getItem(k),BACKUP)).toBe(before);
  else expect(await page.evaluate(k=>localStorage.getItem(k),BACKUP)).not.toBe(before);
  await expect(page.getByRole('button',{name:'Export backup',exact:true})).toBeEnabled();
});

for (const boundary of ['roomauthoritychange','syncrolechange','historyboundary','playbackstatechange']) test(`${boundary} invalidates held file reads and staged actions even without a role change`, async ({page}) => {
  await ready(page);
  await page.evaluate(() => {
    const read = File.prototype.text;
    File.prototype.text = async function() { await new Promise(resolve=>window.releaseRead=resolve); return read.call(this); };
  });
  await file(page,await page.evaluate(()=>envelope('Stale')));
  await page.evaluate(event=>{document.dispatchEvent(new Event(event));releaseRead();},boundary);
  await expect(page.locator('[data-preview]')).toBeHidden();
  expect(await page.evaluate(k=>localStorage.getItem(k),KEY)).toBeNull();
  await page.evaluate(async()=>library.stageImport(JSON.stringify(await envelope('Preview'))));
  await page.evaluate(event=>document.dispatchEvent(new Event(event)),boundary);
  expect(await page.evaluate(()=>library.commitImport('replace'))).toBe(false);
  expect(await page.evaluate(k=>localStorage.getItem(k),KEY)).toBeNull();
});

test('newer preview cancels a held older file read', async ({page})=>{
  await ready(page);
  await page.evaluate(()=>{const read=File.prototype.text; File.prototype.text=async function(){await new Promise(r=>window.releaseRead=r);return read.call(this);};});
  await file(page,await page.evaluate(()=>envelope('Old')));
  await page.evaluate(async()=>{library.stageImport(JSON.stringify(await envelope('New')));releaseRead();});
  await expect(page.locator('[data-preview-names]')).toContainText('New');
  await expect(page.locator('[data-preview-names]')).not.toContainText('Old');
});

test('merge validates final capacity without silently dropping overflow', async({page})=>{
  await ready(page);
  const result=await page.evaluate(async()=>{
    const base=await envelope('Gig');base.lists[0].songs=Array.from({length:50},(_,i)=>({...structuredClone(base.lists[0].songs[0]),name:'Song '+i}));
    library.importText(JSON.stringify(base));const before=library.exportText();
    const incoming=await envelope('Gig');incoming.lists[0].songs[0].name='Overflow';
    const stage=library.stageImport(JSON.stringify(incoming));const commit=library.commitImport('merge');
    return {stage,commit,unchanged:before===library.exportText()};
  });
  expect(result).toEqual({stage:true,commit:false,unchanged:true});
  await expect(page.locator('[data-merge]')).toBeDisabled();
  await expect(page.locator('[data-replace]')).toBeEnabled();
});

test('damaged original can be inspected as raw recovery and restored only after explicit preview',async({page})=>{
  await ready(page,'{damaged');
  await expect(page.locator('[data-status]')).toContainText('not been erased');
  const downloadPromise=page.waitForEvent('download');
  await page.getByRole('button',{name:'Export original storage (raw recovery)',exact:true}).click();
  const download=await downloadPromise;
  const stream=await download.createReadStream();let raw='';for await(const chunk of stream)raw+=chunk.toString();
  expect(raw).toBe('{damaged');
  await file(page,await page.evaluate(()=>envelope('Recovered')));
  expect(await page.evaluate(k=>localStorage.getItem(k),KEY)).toBe('{damaged');
  await page.getByRole('button',{name:'Replace library',exact:true}).click();
  expect(await page.evaluate(k=>localStorage.getItem(k),BACKUP)).toBe('{damaged');
  expect(await page.evaluate(k=>JSON.parse(localStorage.getItem(k)).lists[0].name,KEY)).toBe('Recovered');
  await expect(page.locator('[data-private-warning]')).toContainText('Audio files are not bundled');
});

test('stale failed file read cannot overwrite a newer preview status',async({page})=>{
  await ready(page);
  await page.evaluate(()=>{File.prototype.text=()=>new Promise((resolve,reject)=>window.rejectRead=reject);});
  await file(page,await page.evaluate(()=>envelope('Old')));
  await page.evaluate(async()=>{
    library.stageImport(JSON.stringify(await envelope('New')));
    document.querySelector('[data-status]').textContent='New preview ready';
    rejectRead(new Error('Old read failure'));
  });
  await expect(page.locator('[data-status]')).toHaveText('New preview ready');
});

for(const kind of ['lists','cues','bytes']) test(`post-merge ${kind} limit rejects without truncating`,async({page})=>{
  await ready(page);
  const result=await page.evaluate(async kind=>{
    const base=await envelope('Base');const incoming=await envelope('Incoming');
    if(kind==='lists')base.lists=Array.from({length:20},(_,i)=>({name:'List '+i,songs:[]}));
    if(kind==='cues'){base.cues=Array.from({length:100},(_,i)=>({song:'A',text:'Cue '+i,bar:0}));incoming.cues=[{song:'A',text:'New cue',bar:0}];}
    if(kind==='bytes'){
      const payload=base.lists[0].songs[0].payload;
      payload.state.Tracks=Array.from({length:16},()=>structuredClone(payload.state.Tracks[0]));
      const make=(prefix)=>{
        const value={format:base.format,version:1,cues:[],lists:[]};
        for(let i=0;i<20;i++){
          value.lists.push({name:prefix+i,songs:Array.from({length:10},(_,j)=>({name:'Song '+j,payload:structuredClone(payload)}))});
          if(new TextEncoder().encode(JSON.stringify(value)).length>1100000)return value;
        }
        throw new Error('Fixture did not reach byte bound');
      };
      Object.assign(base,make('A'));Object.assign(incoming,make('B'));
    }
    const saved=library.importText(JSON.stringify(base));const before=library.exportText();
    const staged=library.stageImport(JSON.stringify(incoming));const committed=library.commitImport('merge');
    return {saved,staged,committed,same:before===library.exportText()};
  },kind);
  expect(result).toEqual({saved:true,staged:true,committed:false,same:true});
  await expect(page.locator('[data-merge]')).toBeDisabled();
});

for(const raw of ['', '{broken', 'null']) test(`bad file ${JSON.stringify(raw)} never clears an existing library`,async({page})=>{
  await ready(page);
  const before=await page.evaluate(async()=>{library.importText(JSON.stringify(await envelope('Keep')));return library.exportText();});
  await page.locator('[data-import]').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from(raw)});
  await expect(page.locator('[data-status]')).toContainText('Import rejected');
  expect(await page.evaluate(k=>localStorage.getItem(k),KEY)).toBe(before);
  await expect(page.locator('[data-preview]')).toBeHidden();
});

for(const width of [320,1280])test(`long import preview is bounded with 44px controls at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:800});await ready(page);
  await page.evaluate(async()=>{const data=await envelope('W'.repeat(80));data.lists[0].songs[0].name='W'.repeat(80);library.stageImport(JSON.stringify(data));});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(await page.locator('[data-preview] button').evaluateAll(nodes=>nodes.filter(n=>!n.hidden).every(n=>{const r=n.getBoundingClientRect();return r.height>=44&&r.left>=0&&r.right<=innerWidth;}))).toBe(true);
  await expect(page.locator('[data-preview]')).toHaveCSS('border-top-style','solid');
});

test('cached backup remains previewable when storage reads become unavailable',async({page})=>{
  await ready(page);
  await page.evaluate(async()=>{
    library.importText(JSON.stringify(await envelope('Backup')));
    library.importText(JSON.stringify(await envelope('Current')));
    Storage.prototype.getItem=()=>{throw new Error('read blocked');};
  });
  await page.getByRole('button',{name:'Restore backup',exact:true}).click();
  await expect(page.locator('[data-preview]')).toBeVisible();
  await expect(page.locator('[data-preview-names]')).toContainText('Backup');
  const downloadPromise=page.waitForEvent('download');
  await page.getByRole('button',{name:'Export backup',exact:true}).click();
  const download=await downloadPromise;
  expect(download.suggestedFilename()).toBe('metronominal-rehearsal-backup.json');
  await expect(page.locator('[data-recovery-warning]')).toContainText('private data');
});

async function ready(page, original) {
  await page.route('**/js/webrtc.js', route => route.fulfill({contentType:'text/javascript',body:`export function getSyncDiagnostics(){return {role:window.testRole || 'offline'}} export function sendState(){} `}));
  await page.route('**/js/metronomeEngine.js', route => route.fulfill({contentType:'text/javascript',body:'export default {};'}));
  await page.route('**/library-test.html', route => route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="rehearsal-library.css"><main id="root"></main>'}));
  await page.goto('/library-test.html');
  await page.evaluate(async original => {
    window.app = (await import('/js/appState.js')).default;
    window.song = (await import('/js/songController.js')).default;
    window.isHost = true;
    if (original) localStorage.setItem('metronominal.rehearsal.v1', original);
    window.library = (await import('/js/rehearsalLibrary.js')).initializeRehearsalLibrary(document.querySelector('#root'));
    window.envelope = async name => ({format:'metronominal-rehearsal',version:1,lists:[{name,songs:[{name:'Song',payload:await song.createPayload()}]}],cues:[]});
  }, original);
  await page.getByText('Setlists', {exact:true}).click();
}
async function file(page, value) {
  await page.locator('[data-import]').setInputFiles({name:'library.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(value))});
}
test('semantic merge deduplicates timestamps and position, retaining different music and ordered arrays', async ({page}) => {
  await ready(page);
  const result = await page.evaluate(async () => {
    const initial = await envelope('Gig');
    initial.cues = [{song:'A',text:'Go',bar:0}];
    library.importText(JSON.stringify(initial));
    const incoming = structuredClone(initial);
    const duplicate = incoming.lists[0].songs[0];
    duplicate.payload.exportedAt = 'later';
    duplicate.payload.state.Tracks[0].currentBeat = 2;
    duplicate.payload.state.selectedTrackIndex = 9;
    const changed = structuredClone(duplicate); changed.payload.state.song.sections[0].tempo = 155;
    const ordered = structuredClone(duplicate); ordered.payload.state.Tracks[0].barSettings[0].rests = [0,1];
    const reversed = structuredClone(ordered); reversed.payload.state.Tracks[0].barSettings[0].rests = [1,0];
    const publicSound = structuredClone(duplicate); publicSound.payload.state.customSounds = {Public:{baseSound:'Synth Kick',settings:{volume:.4}}};
    incoming.lists[0].songs.push(changed, ordered, reversed, publicSound);
    const staged = library.stageImport(JSON.stringify(incoming));
    const summary = document.querySelector('[data-preview-summary]').textContent;
    const applied = library.commitImport('merge');
    return {staged,summary,applied,data:JSON.parse(library.exportText())};
  });
  expect(result.staged).toBe(true);
  expect(result.summary).toContain('2 duplicates');
  expect(result.applied).toBe(true);
  expect(result.data.lists[0].songs).toHaveLength(5);
  expect(result.data.cues).toHaveLength(1);
});

test('file import previews names and counts without writing; replace backs up and restore previews before applying', async ({page}) => {
  await ready(page);
  const base = await page.evaluate(async () => { library.importText(JSON.stringify(await envelope('Original'))); return localStorage.getItem('metronominal.rehearsal.v1'); });
  await file(page, await page.evaluate(() => envelope('Imported')));
  expect(await page.evaluate(k => localStorage.getItem(k), KEY)).toBe(base);
  await expect(page.locator('[data-preview]')).toContainText('Imported');
  await expect(page.locator('[data-preview]')).toContainText('1 song');
  await page.getByRole('button',{name:'Replace library',exact:true}).click();
  expect(await page.evaluate(k => localStorage.getItem(k), BACKUP)).toBe(base);
  await page.getByRole('button',{name:'Restore backup',exact:true}).click();
  await expect(page.locator('[data-preview]')).toContainText('Original');
  expect(await page.evaluate(k => JSON.parse(localStorage.getItem(k)).lists[0].name,KEY)).toBe('Imported');
  await page.getByRole('button',{name:'Apply restore',exact:true}).click();
  expect(await page.evaluate(k => JSON.parse(localStorage.getItem(k)).lists[0].name,KEY)).toBe('Original');
});
