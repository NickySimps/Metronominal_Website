const { test, expect } = require('@playwright/test');
const pageErrors = new WeakMap();
test.beforeEach(({page})=>{const errors=[];pageErrors.set(page,errors);page.on('pageerror',e=>errors.push(e.message));});
test.afterEach(({page})=>expect(pageErrors.get(page)).toEqual([]));
async function requireNativeAudio(page,browserName) {
  const available=await page.evaluate(()=>typeof AudioContext==='function');
  test.skip(browserName==='webkit'&&process.platform==='win32'&&!available,'This Windows WebKit build lacks native Web Audio; native scheduling/assets require Chromium, Firefox, or a real supported device.');
  expect(available,'Native Web Audio must be available in supported engines').toBe(true);
}

test('preview uses logical rest ghost and sound keys after earlier slices',async({page})=>{
 await ready(page);await page.evaluate(()=>{
  const song=app.getSong();song.sections[0].tracks[0].barSettings[0]={beats:4,subdivision:1,beatSlices:{1:3},rests:[3],velocities:{2:.3},beatSounds:{2:{mainBeatSound:{sound:'Synth Sine',settings:{frequency:660}}}}};app.setSong(song);timeline.render();
 });
 const slots=page.locator('[data-section="0"] [data-preview-track="0"] [data-preview-bar="0"] [data-preview-slot]');
 const actual=await slots.evaluateAll(nodes=>nodes.map(el=>({slot:Number(el.dataset.previewSlot),rest:el.dataset.rest==='true',velocity:Number(el.dataset.velocity),sound:el.dataset.soundOverride==='true'})));
 expect(actual).toEqual([{slot:0,rest:false,velocity:1,sound:false},{slot:1,rest:false,velocity:1,sound:false},{slot:2,rest:false,velocity:1,sound:false},{slot:3,rest:false,velocity:1,sound:false},{slot:4,rest:false,velocity:.3,sound:true},{slot:5,rest:true,velocity:1,sound:false}]);
});

test('preview exposes real subdivided rests accents and sliced beat identities on every track',async({page})=>{
  await ready(page);
  await page.evaluate(()=>{
    const song=app.getSong(), track=structuredClone(song.sections[0].tracks[0]);
    track.barSettings[0]={beats:4,subdivision:2,rests:[1,2],velocities:{'0':.35,'2':.9},beatSlices:{'2':2},beatSliceAnchors:{'2':2},beatSounds:{'2':{mainBeatSound:{sound:'Synth Sine',settings:{frequency:440}}}}};
    song.sections[0].tracks=[track,{...structuredClone(track),name:'Counterline'}];
    app.setSong(song);timeline.render();
  });
  const bar=page.locator('[data-section="0"] [data-preview-track="0"] [data-preview-bar="0"]');
  await expect(bar).toHaveAttribute('aria-label',/2 rests.*2 accents.*2 slices/);
  const slots=bar.locator('[data-preview-slot]');
  await expect(slots).toHaveCount(9);
  await expect(slots.nth(1)).toHaveAttribute('data-rest','true');
  await expect(slots.nth(2)).toHaveAttribute('data-velocity','0.9');
  await expect(slots.nth(2)).toHaveAttribute('data-slices','2');
  await expect(slots.nth(3)).toHaveAttribute('data-rest','true');
  await expect(slots.nth(3)).toHaveAttribute('data-sound-override','true');
  await expect(page.locator('[data-section="0"] [data-preview-track]')).toHaveCount(2);
});

async function ready(page, { realTransport = false } = {}) {
  // Only the room/transport seams are stubbed here. Rendering, state, history and edits are real.
  await page.route('**/js/webrtc.js', route => route.fulfill({ contentType: 'text/javascript', body: `
    export function getSyncDiagnostics(){ return {role:window.testRole || 'offline'}; }
    export function sendState(){ window.published=(window.published||0)+1; }
    export function isSynchronizationJoined(){return false;}
    export function getTimeOffset(){return 0;}
  ` }));
  if(!realTransport)await page.route('**/js/practiceTransport.js', route => route.fulfill({ contentType: 'text/javascript', body: `
    let pending=null;
    export async function queueSongChange(song,options={}) {if(window.queueFailure)throw new Error('Server rejected draft'); if(window.awaitAuthority)return {status:'awaiting-authority'};window.queued={song:structuredClone(song),options};pending=window.queued;return true;}
    export function getPendingSongChange(){return pending;}
    export function cancelPendingSongChange(){pending=null;window.queued=null;return true;}
  ` }));
  await page.goto('/js/beatTiming.js');
  await page.setContent('<base href="/"><link rel="stylesheet" href="/arrangement-timeline.css"><main id="timeline"></main><aside id="history"></aside>');
  await page.evaluate(async () => {
    const {default: app} = await import('/js/appState.js'); window.app=app;
    app.resetState();
    const bars = Array.from({length:8},(_,i)=>({beats:i+1,subdivision:2,rests:i===0?[1]:[],velocities:{}}));
    app.updateTrack(0,{name:'Canonical',barSettings:bars});
    const base=app.getMusicalSnapshot().Tracks[0];
    const saved=structuredClone(base); saved.name='Saved kick'; saved.barSettings[0].beats=7;
    app.setSong({version:2,enabled:true,name:'Live set',sections:[
      {name:'Intro',startBar:0,tempo:100,repeats:2,tracks:[saved]},
      {name:'Verse',startBar:2,tempo:120,repeats:1},
      {name:'Outro',startBar:5,tempo:90,repeats:3}
    ]});
    const {initializeHistoryControls}=await import('/js/editHistory.js');
    window.historyUI=initializeHistoryControls(document.querySelector('#history'));
    const {initializeArrangementTimeline}=await import('/js/arrangementTimeline.js');
    window.refreshes=0;
    window.timeline=initializeArrangementTimeline(document.querySelector('main'),{refreshUI(){window.refreshes++;}});
  });
}

for (const refusal of ['unavailable', 'transaction active', 'undo pending']) {
  for (const action of ['Go', 'reorder', 'resize', 'tempo', 'repeats']) {
    test(`history refusal (${refusal}) blocks ${action} before mutation or publication`, async ({page}) => {
      await ready(page);
      const before = await page.evaluate(async refusal => {
        const history = await import('/js/editHistory.js');
        if (refusal === 'unavailable') historyUI.destroy();
        if (refusal === 'transaction active') window.heldTransaction = history.beginEditTransaction('Other editor');
        if (refusal === 'undo pending') {
          window.undoTarget = app.getMusicalSnapshot();
          app.setTempo(111);
          const load = app.loadPresetData;
          const held = new Promise(resolve => { window.releaseUndo = resolve; });
          app.loadPresetData = async (...args) => {
            window.undoEntered = true;
            await held;
            return load(...args);
          };
          window.undoResult = historyUI.undo();
          if (!window.undoEntered) throw new Error('Real history Undo did not enter asynchronous restoration');
        }
        window.mutations = [];
        window.stopWatching = app.subscribeMusicalMutations(change => mutations.push(change.label));
        window.schemaEvents = 0;
        document.addEventListener('appstatechange', () => window.schemaEvents++);
        return {music:app.getMusicalSnapshot(), positions:app.getTracks().map(t=>[t.currentBar,t.currentBeat,t.songRepeatIteration])};
      }, refusal);
      if (action === 'Go') await page.getByRole('button',{name:'Go to Intro',exact:true}).click();
      else if (action === 'reorder') await page.getByRole('button',{name:'Move Intro later',exact:true}).click();
      else {
        const [name,value] = {resize:['Intro length in bars','3'],tempo:['Intro BPM','137'],repeats:['Intro repeats','4']}[action];
        const input = page.getByRole('spinbutton',{name,exact:true});
        await input.fill(value); await input.press('Tab');
        await expect(input).toHaveValue(value);
      }
      expect(await page.evaluate(()=>({music:app.getMusicalSnapshot(),positions:app.getTracks().map(t=>[t.currentBar,t.currentBeat,t.songRepeatIteration])}))).toEqual(before);
      expect(await page.evaluate(()=>({mutations,schemaEvents,published:window.published||0,refreshes}))).toEqual({mutations:[],schemaEvents:0,published:0,refreshes:0});
      await expect(page.locator('[data-arrangement-status]')).toContainText(/history.*unavailable|history.*busy/i);
      await expect(page.locator('[data-arrangement-status]')).toContainText(/draft.*retain/i);
      await expect(page.locator('[data-pending]')).toHaveText('No queued arrangement');
      if (refusal === 'transaction active') {
        expect(await page.evaluate(async()=> (await import('/js/editHistory.js')).cancelEditTransaction(heldTransaction))).toBe(true);
      }
      if (refusal === 'undo pending') {
        const restored = await page.evaluate(async()=>{
          stopWatching(); releaseUndo();
          return {accepted:await undoResult,music:app.getMusicalSnapshot(),target:undoTarget};
        });
        expect(restored.accepted).toBe(true);
        expect(restored.music).toEqual(restored.target);
        await expect(page.getByRole('button',{name:'Redo',exact:true})).toBeEnabled();
      }
    });
  }
}

test('keyboard handles retain focus on the moved section for consecutive accessible edits',async({page})=>{
  await ready(page);
  const handle=page.getByRole('button',{name:'Drag Intro to reorder',exact:true});
  await handle.focus();await handle.press('ArrowRight');
  await expect(handle).toBeFocused();
  expect(await page.evaluate(()=>app.getSong().sections.map(s=>s.name))).toEqual(['Verse','Intro','Outro']);
  await handle.press('ArrowLeft');
  await expect(handle).toBeFocused();
  expect(await page.evaluate(()=>app.getSong().sections.map(s=>s.name))).toEqual(['Intro','Verse','Outro']);
});

test('keyboard reorder moves complete musical segments and snapshots in one undoable transaction',async({page})=>{
  await ready(page);
  const before=await page.evaluate(()=>app.getMusicalSnapshot());
  await page.getByRole('button',{name:'Move Intro later',exact:true}).click();
  const after=await page.evaluate(()=>app.getMusicalSnapshot());
  expect(after.song.sections.map(s=>[s.name,s.startBar])).toEqual([['Verse',0],['Intro',3],['Outro',5]]);
  expect(after.Tracks[0].barSettings.map(b=>b.beats)).toEqual([3,4,5,1,2,6,7,8]);
  expect(after.song.sections[1].tracks[0].barSettings.map(b=>b.beats)).toEqual([3,4,5,7,2,6,7,8]);
  expect(await page.evaluate(()=>({published,refreshes}))).toEqual({published:1,refreshes:1});
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  expect(await page.evaluate(()=>app.getMusicalSnapshot())).toEqual(before);
});

test('length and metadata validate strictly and shift following boundaries without deleting bars',async({page})=>{
  await ready(page);
  await page.getByRole('spinbutton',{name:'Intro length in bars',exact:true}).fill('3');
  await page.getByRole('spinbutton',{name:'Intro length in bars',exact:true}).press('Tab');
  expect(await page.evaluate(()=>app.getSong().sections.map(s=>s.startBar))).toEqual([0,3,6]);
  expect(await page.evaluate(()=>app.getTracks()[0].barSettings.map(b=>b.beats))).toEqual([1,2,2,3,4,5,6,7,8]);
  await page.getByRole('spinbutton',{name:'Intro BPM',exact:true}).fill('137');
  await page.getByRole('spinbutton',{name:'Intro BPM',exact:true}).press('Tab');
  await page.getByRole('spinbutton',{name:'Intro repeats',exact:true}).fill('4');
  await page.getByRole('spinbutton',{name:'Intro repeats',exact:true}).press('Tab');
  expect(await page.evaluate(()=>app.getSong().sections[0])).toMatchObject({tempo:137,repeats:4});
  for(const [name,value] of [['Intro BPM','301'],['Intro repeats','1.5'],['Intro length in bars','64']]){
    await page.getByRole('spinbutton',{name,exact:true}).fill(value);
    await page.getByRole('spinbutton',{name,exact:true}).press('Tab');
  }
  expect(await page.evaluate(()=>app.getSong().sections.map(s=>[s.startBar,s.tempo,s.repeats]))).toEqual([[0,137,4],[3,120,1],[6,90,3]]);
  await expect(page.locator('[data-arrangement-status]')).toContainText(/invalid|must|cannot/i);
});

test('live metadata and next-section intent use core queue only, with cancellation and client gating',async({page})=>{
  await ready(page);
  const before=await page.evaluate(()=>app.getSong());
  await page.evaluate(()=>app.togglePlay());
  await expect(page.getByRole('spinbutton',{name:'Intro BPM',exact:true})).toBeDisabled();
  await page.getByRole('checkbox',{name:'Queue live arrangement edits'}).check();
  await page.getByRole('spinbutton',{name:'Intro BPM',exact:true}).fill('144');
  await page.getByRole('spinbutton',{name:'Intro BPM',exact:true}).press('Tab');
  await expect.poll(()=>page.evaluate(()=>queued?.song.sections[0].tempo)).toBe(144);
  expect(await page.evaluate(()=>app.getSong())).toEqual(before);
  await expect(page.locator('[data-pending]')).toContainText('scheduled');
  await page.getByRole('button',{name:'Cancel queued arrangement'}).click();
  expect(await page.evaluate(()=>queued)).toBeNull();
  await page.evaluate(()=>document.dispatchEvent(new CustomEvent('metronominal:section-next')));
  await expect.poll(()=>page.evaluate(()=>queued?.options.sectionIndex)).toBe(1);
  await page.evaluate(()=>{window.testRole='client';document.dispatchEvent(new CustomEvent('syncrolechange',{detail:{state:'connected',isHost:false}}));});
  await expect(page.getByRole('button',{name:'Go to Verse',exact:true})).toBeDisabled();
  await page.evaluate(()=>document.dispatchEvent(new CustomEvent('metronominal:section-next')));
  expect(await page.evaluate(()=>app.getSong())).toEqual(before);
});

test('pointer gestures preview until release and cancel without musical mutation',async({page})=>{
  await ready(page);
  const before=await page.evaluate(()=>app.getMusicalSnapshot());
  const drag=page.getByRole('button',{name:'Drag Intro to reorder'});
  const from=await drag.boundingBox(), to=await page.locator('[data-section="1"]').boundingBox();
  await page.mouse.move(from.x+from.width/2,from.y+from.height/2); await page.mouse.down();
  await page.mouse.move(to.x+to.width-10,from.y+from.height/2,{steps:6});
  expect(await page.evaluate(()=>app.getMusicalSnapshot())).toEqual(before);
  await page.keyboard.press('Escape'); await page.mouse.up();
  expect(await page.evaluate(()=>app.getMusicalSnapshot())).toEqual(before);
  const resize=page.getByRole('button',{name:'Drag Intro length'}), handle=await resize.boundingBox();
  await page.mouse.move(handle.x+20,handle.y+20);await page.mouse.down();
  await page.mouse.move(handle.x+68,handle.y+20,{steps:5});
  expect(await page.evaluate(()=>app.getMusicalSnapshot())).toEqual(before);
  await page.mouse.up();
  expect(await page.evaluate(()=>app.getSong().sections.map(s=>s.startBar))).toEqual([0,3,6]);
  const nextFrom=await drag.boundingBox(), target=await page.locator('[data-section="1"]').boundingBox();
  await page.mouse.move(nextFrom.x+20,nextFrom.y+20);await page.mouse.down();
  await page.mouse.move(target.x+target.width-10,nextFrom.y+20,{steps:6});await page.mouse.up();
  expect(await page.evaluate(()=>app.getSong().sections.map(s=>s.name))).toEqual(['Verse','Intro','Outro']);
});

test('timeline A/B region uses existing inclusive loop state and is host/stopped gated',async({page})=>{
  await ready(page);
  await page.getByRole('button',{name:'Select timeline bar 2',exact:true}).click();
  expect(await page.evaluate(()=>app.getAbLoop().enabled)).toBe(false);
  await page.getByRole('button',{name:'Select timeline bar 5',exact:true}).click();
  expect(await page.evaluate(()=>app.getAbLoop())).toMatchObject({enabled:true,startBar:1,endBar:4});
  await expect(page.locator('[data-loop-status]')).toContainText('A: 2 · B: 5');
  await page.evaluate(()=>app.togglePlay());
  await expect(page.getByRole('button',{name:'Select timeline bar 3',exact:true})).toBeDisabled();
  await page.getByRole('checkbox',{name:'Queue live arrangement edits'}).check();
  await expect(page.getByRole('button',{name:'Select timeline bar 3',exact:true})).toBeDisabled();
});

test('growth moves later riffs and every whole-track snapshot without dropping rests accents or slices',async({page})=>{
  await ready(page);
  const result=await page.evaluate(()=>{
    const s=app.getSong();
    const tracks=structuredClone(s.sections[0].tracks);
    const signature=(rest,velocity,slices)=>({beats:4,subdivision:2,rests:[rest],velocities:{'2':velocity},beatSlices:{'4':slices},beatSliceAnchors:{'4':4}});
    tracks[0].barSettings=Array.from({length:8},(_,i)=>signature(i,i/10,2));
    const verse=structuredClone(tracks);verse[0].barSettings[2]=signature(5,.95,8);
    s.sections[0].tracks=tracks;s.sections[1].tracks=verse;
    app.setSong(s);timeline.render();const saved=app.getSong();return {intro:saved.sections[0].tracks[0].barSettings,verse:saved.sections[1].tracks[0].barSettings};
  });
  await page.getByRole('spinbutton',{name:'Intro length in bars',exact:true}).fill('3');
  await page.getByRole('spinbutton',{name:'Intro length in bars',exact:true}).press('Tab');
  const resized=await page.evaluate(()=>app.getSong());
  expect(resized.sections[1].tracks[0].barSettings[3]).toEqual(result.verse[2]);
  expect(resized.sections[0].tracks[0].barSettings).toHaveLength(9);
  expect(resized.sections[0].tracks[0].barSettings.slice(3)).toEqual(result.intro.slice(2));
  expect(await page.evaluate(()=>app.getTracks()[0].barSettings.map(b=>b.beats))).toEqual([1,2,2,3,4,5,6,7,8]);
  const before=await page.evaluate(()=>app.getMusicalSnapshot());
  await page.getByRole('spinbutton',{name:'Intro length in bars',exact:true}).fill('1');
  await page.getByRole('spinbutton',{name:'Intro length in bars',exact:true}).press('Tab');
  expect(await page.evaluate(()=>app.getMusicalSnapshot())).toEqual(before);
  await expect(page.getByRole('spinbutton',{name:'Intro length in bars',exact:true})).toHaveValue('1');
  await expect(page.locator('[data-arrangement-status]')).toContainText(/remove|shrink/);
});

test('queued reorder carries correctly remapped complete snapshots for actual section application',async({page})=>{
  await ready(page);
  const riffs=await page.evaluate(()=>{
    const song=app.getSong(), a=structuredClone(song.sections[0].tracks), b=structuredClone(a);
    a[0].barSettings[0]={beats:4,subdivision:2,rests:[1],velocities:{'0':.3},beatSlices:{'2':4},beatSliceAnchors:{'2':2}};
    b[0].barSettings[2]={beats:7,subdivision:2,rests:[3,5],velocities:{'0':.9},beatSlices:{'4':8},beatSliceAnchors:{'4':4}};
    song.sections[0].tracks=a;song.sections[1].tracks=b;app.setSong(song);timeline.render();
    const saved=app.getSong();return {a:saved.sections[0].tracks[0].barSettings[0],b:saved.sections[1].tracks[0].barSettings[2]};
  });
  await page.evaluate(()=>app.togglePlay());
  await page.getByRole('checkbox',{name:'Queue live arrangement edits'}).check();
  await page.getByRole('button',{name:'Move Intro later',exact:true}).click();
  const queued=await page.evaluate(()=>window.queued.song);
  expect(queued.sections[0].tracks[0].barSettings[0]).toEqual(riffs.b);
  expect(queued.sections[1].tracks[0].barSettings[3]).toEqual(riffs.a);
  // Controller contract seam only: apply the exact queued payload using real AppState.
  // Scheduler/server boundary acceptance remains the core integration suite's responsibility.
  const played=await page.evaluate(async()=>{
    await app.togglePlay();app.setSong(window.queued.song);app.applySongSectionForBar(0,0);
    const b=structuredClone(app.getTracks()[0].barSettings[0]);
    app.applySongSectionForBar(3,1);return {b,a:app.getTracks()[0].barSettings[3]};
  });
  expect(played).toEqual(riffs);
});

test('rejected live drafts stay editable and awaiting authority never claims scheduled success',async({page})=>{
  await ready(page);await page.evaluate(()=>{window.queueFailure=true;return app.togglePlay();});
  await page.getByRole('checkbox',{name:'Queue live arrangement edits'}).check();
  const input=page.getByRole('spinbutton',{name:'Intro BPM',exact:true});
  await input.fill('145');await input.press('Tab');
  await expect(page.locator('[data-arrangement-status]')).toContainText('Server rejected draft');
  await expect(input).toHaveValue('145');
  expect(await page.evaluate(()=>app.getSong().sections[0].tempo)).toBe(100);
  await page.evaluate(()=>{window.queueFailure=false;window.awaitAuthority=true;});
  await input.fill('146');await input.press('Tab');
  await expect(page.locator('[data-pending]')).toContainText('Awaiting server authority');
  await expect(page.locator('[data-pending]')).not.toContainText('scheduled boundary');
  expect(await page.evaluate(()=>app.getSong().sections[0].tempo)).toBe(100);
});

test('unconfirmed authority proposals can be cancelled without leaving the editor locked',async({page})=>{
  await ready(page);await page.evaluate(()=>{window.awaitAuthority=true;return app.togglePlay();});
  await page.getByRole('checkbox',{name:'Queue live arrangement edits'}).check();
  const tempo=page.getByRole('spinbutton',{name:'Intro BPM',exact:true});await tempo.fill('150');await tempo.press('Tab');
  await expect(page.locator('[data-pending]')).toContainText('Awaiting server authority');
  await page.getByRole('button',{name:'Cancel queued arrangement',exact:true}).click();
  await expect(page.locator('[data-pending]')).not.toContainText('Awaiting server authority');
  await expect(tempo).toBeEnabled();expect(await page.evaluate(()=>app.getSong().sections[0].tempo)).toBe(100);
});

test('position updates retain focused edit controls and describe the next musical transition',async({page})=>{
  await ready(page);
  const input=page.getByRole('spinbutton',{name:'Intro BPM',exact:true});await input.focus();
  await page.evaluate(()=>{app.getTracks()[0].currentBar=1;document.dispatchEvent(new CustomEvent('songpositionchange'));});
  await expect(input).toBeFocused();
  await expect(page.locator('[data-position]')).toContainText('transition after');
});

test('responsive timeline contains its own scroll with three previews and 44px controls',async({page})=>{
  await ready(page);
  await page.evaluate(()=>{app.addTrack();app.addTrack();for(let i=1;i<3;i++)app.updateTrack(i,{name:'Track '+(i+1),barSettings:structuredClone(app.getTracks()[0].barSettings)});timeline.render();});
  for(const viewport of [{width:320,height:640},{width:568,height:320},{width:1100,height:700}]) {
    await page.setViewportSize(viewport);
    const geometry=await page.evaluate(()=>{
      const root=document.querySelector('main'), scroll=root.querySelector('.arrangement-scroll');
      const targets=[...root.querySelectorAll('button,input')].filter(el=>!el.hidden&&!el.closest('[hidden]')).map(el=>({label:el.getAttribute('aria-label')||el.textContent,width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height}));
      return {page:document.documentElement.scrollWidth,width:innerWidth,root:root.getBoundingClientRect().right,scroll:scroll.scrollWidth>scroll.clientWidth,targets,previews:root.querySelectorAll('[data-section="1"] [data-preview-track]').length};
    });
    expect(geometry.page).toBeLessThanOrEqual(geometry.width);
    expect(geometry.root).toBeLessThanOrEqual(geometry.width);
    if(viewport.width<=568)expect(geometry.scroll).toBe(true);expect(geometry.previews).toBe(3);
    expect(geometry.targets.filter(target=>target.width<44||target.height<44)).toEqual([]);
  }
});

test('real solo core queue applies moved riffs only at its scheduled boundary',async({page,browserName})=>{
  await requireNativeAudio(page,browserName);
  await ready(page,{realTransport:true});
  const expected=await page.evaluate(()=>{
    app.initializeAudioContext();
    const song=app.getSong(), snapshots=structuredClone(song.sections[0].tracks);
    snapshots[0].barSettings=snapshots[0].barSettings.map((bar,index)=>({...bar,rests:[index],velocities:{'2':.85},beatSlices:{'4':8},beatSliceAnchors:{'4':4}}));
    song.sections[1].tracks=snapshots;app.setSong(song);timeline.render();
    return app.getSong().sections[1].tracks[0].barSettings;
  });
  const before=await page.evaluate(()=>app.getSong());
  await page.evaluate(()=>app.togglePlay());
  await page.getByRole('checkbox',{name:'Queue live arrangement edits'}).check();
  await page.getByRole('button',{name:'Move Intro later',exact:true}).click();
  const result=await page.evaluate(async()=>{
    const core=await import('/js/practiceTransport.js'),pending=core.getPendingSongChange();
    if(!pending)throw new Error(document.querySelector('[data-arrangement-status]').textContent);
    const original=app.getSong();
    const early=core.applyPendingSongAtBoundary(pending.audioTime-.1);
    const unchanged=JSON.stringify(original)===JSON.stringify(app.getSong());
    const applied=core.applyPendingSongAtBoundary(pending.audioTime);
    return {early,unchanged,applied,original,song:app.getSong(),startBar:pending.startBar,riff:app.getTracks()[0].barSettings[app.getTracks()[0].currentBar]};
  });
  expect(result).toMatchObject({early:false,unchanged:true,applied:true,original:before});
  expect(result.startBar).toBeLessThan(3);
  expect(result.riff).toEqual(expected[[2,3,4,0,1,5,6,7][result.startBar]]);
  expect(result.song.sections.map(s=>s.name)).toEqual(['Verse','Intro','Outro']);
});

test('stopped fallback navigation preserves tracks and applies section tempo even for empty legacy snapshots',async({page})=>{
  await ready(page);
  await page.evaluate(()=>{app.setTempo(77);const song=app.getSong();song.sections[1].tracks=[];app.setSong(song);timeline.render();});
  const bars=await page.evaluate(()=>structuredClone(app.getTracks()[0].barSettings));
  await page.getByRole('button',{name:'Go to Verse',exact:true}).click();
  expect(await page.evaluate(()=>({tempo:app.getTempo(),count:app.getTracks().length,bar:app.getTracks()[0]?.currentBar,bars:app.getTracks()[0]?.barSettings}))).toEqual({tempo:120,count:1,bar:2,bars});
});

test('strict capacity and unequal snapshot guards keep music and entered draft intact',async({page})=>{
  await ready(page);
  await page.evaluate(()=>{const song=app.getSong();song.sections[0].tracks[0].barSettings.pop();app.setSong(song);timeline.render();});
  let before=await page.evaluate(()=>app.getMusicalSnapshot());
  await page.getByRole('button',{name:'Move Intro later',exact:true}).click();
  expect(await page.evaluate(()=>app.getMusicalSnapshot())).toEqual(before);
  await expect(page.locator('[data-arrangement-status]')).toContainText('unequal');
  await page.evaluate(()=>{const bars=Array.from({length:64},()=>structuredClone(app.getTracks()[0].barSettings[0]));app.updateTrack(0,{barSettings:bars});const song=app.getSong();song.sections.forEach(s=>delete s.tracks);app.setSong(song);timeline.render();});
  before=await page.evaluate(()=>app.getMusicalSnapshot());
  const length=page.getByRole('spinbutton',{name:'Intro length in bars',exact:true});await length.fill('3');await length.press('Tab');
  expect(await page.evaluate(()=>app.getMusicalSnapshot())).toEqual(before);
  await expect(length).toHaveValue('3');await expect(page.locator('[data-arrangement-status]')).toContainText('64 bars');
});

test('two-track reorder remaps each complete snapshot and preserves local listening through undo',async({page})=>{
  await ready(page);
  const before=await page.evaluate(async()=>{
    app.addTrack();app.updateTrack(1,{name:'Counterline',barSettings:structuredClone(app.getTracks()[0].barSettings)});
    const song=app.getSong(),tracks=app.getMusicalSnapshot().Tracks;
    for(const [t,track] of tracks.entries())track.barSettings=track.barSettings.map((bar,i)=>({...bar,rests:[i%2],velocities:{'0':.2+t*.3},beatSlices:{'0':2},beatSliceAnchors:{'0':0},beatSounds:{'0':{mainBeatSound:{sound:'Synth Sine',settings:{frequency:330+t*110+i}}}}}));
    song.sections[0].tracks=structuredClone(tracks);song.sections[1].tracks=structuredClone(tracks);song.sections[1].tracks[1].barSettings[2].velocities['0']=.95;
    app.setSong(song);timeline.render();
    const monitoring=(await import('/js/monitoring.js')).default;monitoring.syncTracks(app.getTracks());monitoring.setVolume(.38);monitoring.setTrackMuted(1,true);
    return {music:app.getMusicalSnapshot(),mix:monitoring.getState()};
  });
  await page.getByRole('button',{name:'Move Intro later',exact:true}).click();
  const after=await page.evaluate(()=>app.getSong());
  const order=[2,3,4,0,1,5,6,7];
  for(const [index,original] of [[0,1],[1,0]])for(let track=0;track<2;track++)expect(after.sections[index].tracks[track].barSettings).toEqual(order.map(i=>before.music.song.sections[original].tracks[track].barSettings[i]));
  await page.getByRole('button',{name:'Go to Verse',exact:true}).click();
  expect(await page.evaluate(()=>app.getTracks()[1].barSettings[0].velocities['0'])).toBe(.95);
  expect(await page.evaluate(async()=>(await import('/js/monitoring.js')).default.getState())).toEqual(before.mix);
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  expect(await page.evaluate(()=>app.getMusicalSnapshot())).toEqual(before.music);
});

test('native private recording buffer survives stopped structural edit and undo without entering song snapshots',async({page,browserName})=>{
  await requireNativeAudio(page,browserName);await ready(page);
  await page.evaluate(()=>{
    const ctx=app.initializeAudioContext();window.privateBuffer=ctx.createBuffer(1,128,ctx.sampleRate);
    app.addRecording('My private take');app.setSoundBuffer('My private take',privateBuffer);
    app.updateTrack(0,{mainBeatSound:{sound:'My private take',settings:{volume:.4}}});
    const song=app.getSong();song.sections.forEach(section=>delete section.tracks);app.setSong(song);timeline.render();
  });
  await page.getByRole('button',{name:'Move Intro later',exact:true}).click();
  expect(await page.evaluate(()=>({same:app.getSoundBuffer('My private take')===privateBuffer,sound:app.getTracks()[0].mainBeatSound.sound,snapshots:app.getSong().sections.some(section=>section.tracks)}))).toEqual({same:true,sound:'My private take',snapshots:false});
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  expect(await page.evaluate(()=>app.getSoundBuffer('My private take')===privateBuffer)).toBe(true);
});

test('real core cancels queued section intent on authority loss and semantic client input cannot recreate it',async({page,browserName})=>{
  await requireNativeAudio(page,browserName);
  await ready(page,{realTransport:true});
  await page.evaluate(()=>{app.initializeAudioContext();return app.togglePlay();});
  await page.evaluate(()=>document.dispatchEvent(new CustomEvent('metronominal:section-next')));
  await expect.poll(()=>page.evaluate(async()=>Boolean((await import('/js/practiceTransport.js')).getPendingSongChange()))).toBe(true);
  const song=await page.evaluate(()=>app.getSong());
  await page.evaluate(()=>{window.testRole='client';document.dispatchEvent(new CustomEvent('roomauthoritychange'));document.dispatchEvent(new CustomEvent('metronominal:section-next'));});
  expect(await page.evaluate(async()=>(await import('/js/practiceTransport.js')).getPendingSongChange())).toBeNull();
  expect(await page.evaluate(()=>app.getSong())).toEqual(song);
  await expect(page.getByRole('button',{name:'Go to Verse',exact:true})).toBeDisabled();
});

test('native scheduler plays changed two-track snapshot identities at the queued section boundary',async({page,browserName})=>{
  test.setTimeout(45000);
  await requireNativeAudio(page,browserName);
  const {createSyncServer}=require('../../MetronomeSignalServer/server');
  const signal=createSyncServer({port:10034,logger:{log(){},warn(){}}});
  await new Promise(resolve=>signal.wss.once('listening',resolve));
  try {
    await page.addInitScript(()=>{
      const Original=WebSocket;window.WebSocket=class extends Original{constructor(url,...args){super(url==='ws://127.0.0.1:10000'?'ws://127.0.0.1:10034':url,...args);}};
      window.nativeNotes=[];const create=AudioContext.prototype.createOscillator;
      AudioContext.prototype.createOscillator=function(...args){const source=create.apply(this,args),start=source.start.bind(source),set=source.frequency.setValueAtTime.bind(source.frequency);let scheduledFrequency=null;source.frequency.setValueAtTime=(value,time)=>{scheduledFrequency=value;return set(value,time);};source.start=(time,...rest)=>{window.nativeNotes.push({time,frequency:scheduledFrequency??source.frequency.value,now:this.currentTime});return start(time,...rest);};return source;};
      window.commits=[];document.addEventListener('songchangecommitted',event=>window.commits.push(event.detail));
    });
    await page.goto('/');
    await expect.poll(()=>page.evaluate(async()=>(await import('/js/webrtc.js')).isSynchronizationJoined())).toBe(true);
    const dismiss=page.locator('#dismiss-connection-modal-btn');if(await dismiss.isVisible())await dismiss.click();
    await page.locator('#speed-trainer-btn').click();
    await page.evaluate(async()=>{
      const app=(await import('/js/appState.js')).default;window.app=app;
      await app.getAudioContext().resume();await(await import('/js/webrtc.js')).disconnect();
      app.updateTrack(0,{barSettings:[{beats:1,subdivision:1,rests:[]},{beats:1,subdivision:1,rests:[]}],mainBeatSound:{sound:'Synth Sine',settings:{frequency:330}},subdivisionSound:{sound:'Synth Sine',settings:{frequency:330}}});
      app.addTrack();app.updateTrack(1,{barSettings:structuredClone(app.getTracks()[0].barSettings),mainBeatSound:{sound:'Synth Sine',settings:{frequency:440}}});
      const a=app.getMusicalSnapshot().Tracks,b=structuredClone(a);
      b[0].mainBeatSound={sound:'Synth Sine',settings:{frequency:660}};b[1].mainBeatSound={sound:'Synth Sine',settings:{frequency:880}};
      app.setSong({version:2,name:'Native proof',enabled:true,sections:[{name:'Before',startBar:0,tempo:240,repeats:16,tracks:a},{name:'Changed',startBar:1,tempo:240,repeats:16,tracks:b}]});
      let root=document.querySelector('.arrangement-timeline');
      if(!root){root=document.createElement('section');root.id='native-timeline';document.body.append(root);}
      (await import('/js/arrangementTimeline.js')).initializeArrangementTimeline(root).render();
      app.setTempo(240);await(await import('/js/metronomeEngine.js')).default.scheduleStart(Date.now()+250);
    });
    await expect.poll(()=>page.evaluate(()=>nativeNotes.filter(n=>n.frequency===330).length)).toBeGreaterThan(0);
    const before=await page.evaluate(()=>app.getSong());
    await page.evaluate(()=>document.dispatchEvent(new CustomEvent('metronominal:section-next')));
    const pending=await page.evaluate(async()=>(await import('/js/practiceTransport.js')).getPendingSongChange());
    expect(pending).not.toBeNull();expect(await page.evaluate(()=>app.getSong())).toEqual(before);
    await expect.poll(()=>page.evaluate(()=>commits.length)).toBe(1);
    await expect.poll(()=>page.evaluate(()=>nativeNotes.filter(n=>n.frequency===880).length)).toBeGreaterThan(0);
    const proof=await page.evaluate(()=>({notes:nativeNotes,commit:commits[0],tempo:app.getPlaybackTempo(1),names:app.getTracks().map(t=>t.mainBeatSound.settings.frequency)}));
    expect(proof.names).toEqual([660,880]);expect(proof.tempo).toBe(240);
    for(const frequency of [660,880])expect(proof.notes.some(n=>n.frequency===frequency&&Math.abs(n.time-proof.commit.audioTime)<.03)).toBe(true);
    expect(proof.notes.filter(n=>[330,440].includes(n.frequency)&&n.time>proof.commit.audioTime+.03)).toEqual([]);
    await page.evaluate(async()=>{(await import('/js/metronomeEngine.js')).default.cancelPlayback();});
  } finally {await page.goto('about:blank');await signal.close();}
});

test('shows real saved/fallback rhythm previews and current/next section',async({page})=>{
  await ready(page);
  await expect(page.getByRole('heading',{name:'Section arrangement'})).toBeVisible();
  await expect(page.locator('[data-section="0"]')).toContainText('2 bars');
  await expect(page.locator('[data-preview-track]').first()).toContainText('Saved kick');
  await expect(page.locator('[data-section="0"] [data-preview-bar]').first()).toHaveAttribute('aria-label',/7 beats/);
  await expect(page.locator('[data-section="1"] [data-preview-track]').first()).toContainText('Canonical');
  await expect(page.locator('[data-position]')).toContainText('Current: Intro');
  await expect(page.locator('[data-position]')).toContainText('Next: Verse');
});
