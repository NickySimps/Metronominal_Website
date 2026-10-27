const { test, expect } = require('@playwright/test');
const errors = new WeakMap();
test.beforeEach(({ page }) => { const messages = []; errors.set(page, messages); page.on('pageerror', error => messages.push(error.message)); });
test.afterEach(({ page }) => expect(errors.get(page)).toEqual([]));

async function ready(page, legacy = false) {
  await page.route('**/js/webrtc.js', route => route.fulfill({ contentType: 'text/javascript', body: `
    export function getSyncDiagnostics(){return {role:window.testRole || 'offline'}}
    export function sendState(){}
    ${legacy ? '' : `export function getRehearsalRoomState(){return window.testRoom || {supported:true,cue:null,participants:[],requests:[]}}
    export function sendRehearsalCue(cue){window.sentCues.push(cue); return true;}`}
  ` }));
  await page.route('**/js/metronomeEngine.js', route => route.fulfill({ contentType: 'text/javascript', body: 'export default {};' }));
  await page.route('**/rehearsal-test.html', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="rehearsal-library.css"><main id="root"></main>' }));
  await page.goto('/rehearsal-test.html');
  return page.evaluate(async () => {
    window.sentCues = []; window.isHost = true;
    window.app = (await import('/js/appState.js')).default;
    window.song = (await import('/js/songController.js')).default;
    try {
      const { initializeRehearsalLibrary } = await import('/js/rehearsalLibrary.js');
      window.library = initializeRehearsalLibrary(document.querySelector('#root'));
      return true;
    } catch (error) { window.initError = error.message; return false; }
  });
}
async function setRole(page, role) {
  await page.evaluate(next => { window.testRole = next; window.isHost = next === 'host'; document.dispatchEvent(new CustomEvent('syncrolechange', { detail: { state: 'connected', isHost: window.isHost } })); }, role);
}

test('cues are device-local, host-only sends and authoritative received plain text', async ({ page }) => {
  expect(await ready(page)).toBe(true);
  await page.getByText('Cues', { exact: true }).click();
  await page.getByLabel('Cue text', { exact: true }).fill('Bridge <b>now</b>');
  await page.getByRole('button', { name: 'Add cue', exact: true }).click();
  await page.getByRole('button', { name: 'Send cue 1 now', exact: true }).click();
  await expect(page.locator('[data-cue-display]')).toHaveText('Local cue (not room): Bridge <b>now</b>');
  expect(await page.evaluate(() => sentCues.length)).toBe(0);
  await setRole(page, 'host');
  await page.getByRole('button', { name: 'Send cue 1 now', exact: true }).click();
  expect(await page.evaluate(() => sentCues)).toEqual([{ text: 'Bridge <b>now</b>', bar: null }]);
  await setRole(page, 'client');
  await expect(page.getByRole('button', { name: 'Add cue', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Send cue 1 now', exact: true })).toBeDisabled();
  await page.evaluate(() => {
    window.testRoom = { supported: true, cue: { text: '<img src=x onerror=alert(1)>', bar: 0 } };
    document.dispatchEvent(new CustomEvent('rehearsalroomchange', { detail: { cue: { text: 'UNTRUSTED' } } }));
  });
  await expect(page.locator('[data-cue-display]')).toHaveText('Room cue · bar 1: <img src=x onerror=alert(1)>');
  expect(await page.locator('[data-cue-display] img').count()).toBe(0);
  expect(await page.evaluate(() => sentCues.length)).toBe(1);
});

test('old protocol module remains compatible without room cue exports', async ({ page }) => {
  expect(await ready(page, true)).toBe(true);
  await page.getByText('Cues', { exact: true }).click();
  await expect(page.locator('[data-cue-display]')).toContainText('No room cue');
});
async function open(page) {
  expect(await ready(page)).toBe(true);
  await page.getByText('Setlists', { exact: true }).click();
}

test('reorders and renames lists and entries, previous/next never loads during playback', async ({ page }) => {
  await open(page);
  await page.getByLabel('Setlist name', { exact: true }).fill('Gig');
  await page.getByRole('button', { name: 'Create setlist', exact: true }).click();
  await page.evaluate(() => app.setSong({ ...app.getSong(), name: 'One' }));
  await page.getByRole('button', { name: 'Add current song', exact: true }).click();
  await page.evaluate(() => app.setSong({ ...app.getSong(), name: 'Two' }));
  await page.getByRole('button', { name: 'Add current song', exact: true }).click();
  await page.getByRole('button', { name: 'Move entry 2 up', exact: true }).click();
  await expect(page.getByLabel('Entry name 1', { exact: true })).toHaveValue('Two');
  await page.getByLabel('Rename setlist', { exact: true }).fill('Evening');
  await page.getByLabel('Rename setlist', { exact: true }).dispatchEvent('change');
  await expect(page.getByLabel('Saved setlist', { exact: true })).toContainText('Evening');
  await page.getByRole('button', { name: 'Load entry 1', exact: true }).click();
  await page.getByRole('button', { name: 'Next song', exact: true }).click();
  expect(await page.evaluate(() => app.getSong().name)).toBe('One');
  await page.getByRole('button', { name: 'Previous song', exact: true }).click();
  expect(await page.evaluate(() => app.getSong().name)).toBe('Two');
  await page.evaluate(() => { app.isPlaying = () => true; document.dispatchEvent(new Event('playbackstatechange')); });
  await expect(page.getByRole('button', { name: 'Next song', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => library.load(1))).toBe(false);
  expect(await page.evaluate(() => app.getSong().name)).toBe('Two');
});

test('rename blur preserves the exact adjacent entry Load pointer action', async ({page}) => {
  await open(page);
  await page.getByLabel('Setlist name',{exact:true}).fill('Pointer');
  await page.getByRole('button',{name:'Create setlist',exact:true}).click();
  await page.evaluate(()=>app.setSong({...app.getSong(),name:'Captured'}));
  await page.getByRole('button',{name:'Add current song',exact:true}).click();
  await page.evaluate(()=>app.setSong({...app.getSong(),name:'Unsaved'}));
  await page.getByLabel('Entry name 1',{exact:true}).fill('Renamed entry');
  await page.getByRole('button',{name:'Load entry 1',exact:true}).click();
  expect(await page.evaluate(()=>app.getSong().name)).toBe('Captured');
  await expect(page.getByLabel('Entry name 1',{exact:true})).toHaveValue('Renamed entry');
  await page.getByLabel('Rename setlist',{exact:true}).fill('Renamed list');
  await page.getByRole('button',{name:'Load entry 1',exact:true}).click();
  await expect(page.getByLabel('Saved setlist',{exact:true})).toContainText('Renamed list');
});

test('bounded imports reject invalid data atomically and exports use the song validator', async ({ page }) => {
  await open(page);
  const result = await page.evaluate(async () => {
    const payload = await song.createPayload();
    const base = { format: 'metronominal-rehearsal', version: 1, lists: [{name:'Imported', songs:[{name:'A',payload}]}], cues:[] };
    const valid = library.importText(JSON.stringify(base));
    const before = localStorage.getItem('metronominal.rehearsal.v1');
    const cases = ['{bad', 'x'.repeat(2097153)];
    for (const mutate of [x => x.lists = Array(21).fill(x.lists[0]), x => x.lists[0].songs = Array(51).fill(x.lists[0].songs[0]), x => x.lists[0].songs[0].payload.state.song.sections[0].tempo = -1, x => x.cues = [{song:'A',text:'x'.repeat(141),bar:0}], x => x.lists[0].songs[0].payload.state.hostCredential = 'SECRET']) {
      const input = structuredClone(base); mutate(input); cases.push(JSON.stringify(input));
    }
    const rejected = cases.map(input => library.importText(input));
    return {valid,rejected,unchanged:before === localStorage.getItem('metronominal.rehearsal.v1'),exported:JSON.parse(library.exportText())};
  });
  expect(result.valid).toBe(true);
  expect(result.rejected).toEqual(Array(7).fill(false));
  expect(result.unchanged).toBe(true);
  expect(result.exported.lists[0].songs[0].payload.state.song.version).toBe(2);
});

test('private recording references including beat overrides never enter captured library', async ({ page }) => {
  await open(page);
  const payload = await page.evaluate(async () => {
    app.addRecording('Private take');
    app.addCustomSound('Private derived', 'Private take', {});
    app.getTracks()[0].mainBeatSound = { sound:'Private take',settings:{} };
    app.getTracks()[0].barSettings[0].beatSounds = {0:{subdivisionSound:{sound:'Private derived',settings:{}}}};
    return await song.createPayload();
  });
  expect(JSON.stringify(payload)).not.toMatch(/Private take|Private derived/);
});

test('storage damage or denial is honest and never erases the original', async ({ page }) => {
  await open(page);
  await page.evaluate(() => localStorage.setItem('metronominal.rehearsal.v1', '{broken-original'));
  expect(await ready(page)).toBe(true);
  await expect(page.locator('[data-status]')).toContainText('has not been erased');
  expect(await page.evaluate(() => localStorage.getItem('metronominal.rehearsal.v1'))).toBe('{broken-original');
  await page.getByText('Setlists', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Create setlist', exact: true })).toBeDisabled();
  await page.evaluate(() => { localStorage.removeItem('metronominal.rehearsal.v1'); });
  expect(await ready(page)).toBe(true);
  await page.getByText('Setlists', { exact: true }).click();
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new Error('blocked'); }; });
  await page.getByLabel('Setlist name', { exact: true }).fill('No save');
  await page.getByRole('button', { name: 'Create setlist', exact: true }).click();
  await expect(page.locator('[data-status]')).toContainText('Not saved: blocked');
  expect(await page.evaluate(() => localStorage.getItem('metronominal.rehearsal.v1'))).toBe(null);
});

for (const boundary of ['role', 'room']) test(`${boundary} changes invalidate delayed song captures and loads`, async ({ page }) => {
  await open(page);
  await page.getByLabel('Setlist name', { exact: true }).fill('Race');
  await page.getByRole('button', { name: 'Create setlist', exact: true }).click();
  await page.getByRole('button', { name: 'Add current song', exact: true }).click();
  await page.evaluate(() => {
    const create = song.createPayload;
    song.createPayload = async () => { await new Promise(resolve => window.releaseCapture = resolve); return create(); };
  });
  await page.getByRole('button', { name: 'Add current song', exact: true }).click();
  if (boundary === 'role') await setRole(page, 'client');
  else await page.evaluate(() => document.dispatchEvent(new CustomEvent('roomauthoritychange')));
  await page.evaluate(() => releaseCapture());
  await expect(page.locator('[data-entries] li')).toHaveCount(1);
  await setRole(page, 'host');
  await page.evaluate(() => {
    const apply = song.applyPayload;
    song.applyPayload = async (...args) => { await new Promise(resolve => window.releaseLoad = resolve); return apply(...args); };
    app.setSong({ ...app.getSong(), name: 'Must remain' });
    window.pendingLoad = library.load(0);
  });
  await page.evaluate(() => { document.querySelector('[data-auto]').checked = true; });
  if (boundary === 'role') { await setRole(page, 'client'); await setRole(page, 'host'); }
  else await page.evaluate(() => document.dispatchEvent(new CustomEvent('roomauthoritychange')));
  expect(await page.locator('[data-auto]').isChecked()).toBe(false);
  await page.evaluate(() => releaseLoad());
  expect(await page.evaluate(() => pendingLoad)).toBe(false);
  expect(await page.evaluate(() => app.getSong().name)).toBe('Must remain');
});

for (const width of [320, 1280]) test(`accessible compact controls fit ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 800 });
  await open(page);
  await page.getByLabel('Setlist name', { exact: true }).fill('L'.repeat(80));
  await page.getByRole('button', { name: 'Create setlist', exact: true }).click();
  await page.getByRole('button', { name: 'Add current song', exact: true }).click();
  await page.getByText('Cues', { exact: true }).click();
  await page.getByLabel('Cue text', { exact: true }).fill('W'.repeat(140));
  await page.getByRole('button', { name: 'Add cue', exact: true }).click();
  expect(await page.evaluate(() => [...document.querySelectorAll('.rehearsal-library input,.rehearsal-library select,.rehearsal-library button,.rehearsal-library li')].filter(node => node.getClientRects().length).every(node => {
    const r = node.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.width > 0;
  }))).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('auto cues follow each host bar event including consecutive repeated bars, clients never emit', async ({ page }) => {
  expect(await ready(page)).toBe(true);
  await page.getByText('Cues', { exact: true }).click();
  await page.getByLabel('Cue text', { exact: true }).fill('Repeat this bar');
  await page.getByRole('button', { name: 'Add cue', exact: true }).click();
  await setRole(page, 'host');
  await page.getByLabel('Send bar cues automatically', { exact: true }).check();
  await page.evaluate(() => {
    app.isPlaying = () => true;
    for (let i = 0; i < 3; i++) document.dispatchEvent(new CustomEvent('songpositionchange', { detail: { bar: 0 } }));
  });
  expect(await page.evaluate(() => sentCues)).toEqual(Array(3).fill({text:'Repeat this bar',bar:0}));
  await setRole(page, 'client');
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('songpositionchange', { detail: { bar: 0 } })));
  expect(await page.evaluate(() => sentCues.length)).toBe(3);
});

test('imported and captured sound settings exclude private nested metadata', async ({ page }) => {
  await open(page);
  const result = await page.evaluate(async () => {
    const payload = await song.createPayload();
    const poison = settings => Object.assign(settings, { volume: 0.42, reverse: true, personal: { password: 'PASSWORD_SENTINEL', privateAudio: 'PRIVATE_AUDIO_SENTINEL', listeningMix: { volume: 0.23 } } });
    poison(payload.state.Tracks[0].mainBeatSound.settings);
    payload.state.Tracks[0].barSettings[0].beatSounds = { 0: { subdivisionSound: { sound: 'Synth HiHat', settings: poison({}) } } };
    const envelope = { format:'metronominal-rehearsal',version:1,lists:[{name:'Safe',songs:[{name:'A',payload}]}],cues:[] };
    const accepted = library.importText(JSON.stringify(envelope));
    const exported = library.exportText();
    poison(app.getTracks()[0].mainBeatSound.settings);
    const captured = JSON.stringify(await song.createPayload());
    return { accepted, status: document.querySelector('[data-status]').textContent, exported, captured, volume: JSON.parse(exported).lists[0]?.songs[0]?.payload.state.Tracks[0].mainBeatSound.settings.volume };
  });
  expect(result.accepted, result.status).toBe(true);
  expect(result.volume).toBe(0.42);
  expect(result.exported + result.captured).not.toMatch(/PASSWORD_SENTINEL|PRIVATE_AUDIO_SENTINEL|listeningMix|personal|password/);
});

test('import normalization excludes private local references and personal metadata', async ({ page }) => {
  await open(page);
  const result = await page.evaluate(async () => {
    const payload = await song.createPayload();
    payload.listeningMix = { secret: 'PERSONAL' };
    payload.state.listeningMix = { secret: 'PERSONAL' };
    const base = {format:'metronominal-rehearsal',version:1,lists:[{name:'Safe',songs:[{name:'A',payload}]}],cues:[]};
    const accepted = library.importText(JSON.stringify(base));
    const exported = library.exportText();
    app.addRecording('My secret sample');
    delete payload.state.listeningMix;
    payload.state.Tracks[0].mainBeatSound.sound = 'My secret sample';
    const privateAccepted = library.importText(JSON.stringify(base));
    return {accepted,exported,privateAccepted};
  });
  expect(result.accepted).toBe(true);
  expect(result.exported).not.toMatch(/listeningMix|PERSONAL/);
  expect(result.privateAccepted).toBe(false);
});

test('untouched default tracks can be captured and payload normalization is idempotent', async ({ page }) => {
  await open(page);
  const normalized = await page.evaluate(async () => {
    const payload = await song.createPayload();
    delete payload.state.Tracks[0].pitchShift;
    delete payload.state.Tracks[0].swing;
    const once = song.validatePayload(payload);
    const twice = song.validatePayload(once);
    return {once, twice};
  });
  expect(normalized.twice).toEqual(normalized.once);
  await page.getByLabel('Setlist name', {exact:true}).fill('Defaults');
  await page.getByRole('button', {name:'Create setlist',exact:true}).click();
  await page.getByRole('button', {name:'Add current song',exact:true}).click();
  await expect(page.getByLabel('Entry name 1', {exact:true})).toBeVisible();
});

test('captures full safe songs, explicitly loads and persists local setlists', async ({ page }) => {
  await open(page);
  const expectedState = await page.evaluate(async () => {
    const track = app.getTracks()[0];
    track.name = 'Backbeat'; track.pitchShift = 3; track.swing = 12; track.volume = .7;
    track.barSettings[0].velocities = {0:.4};
    track.barSettings[0].beatSlices = {0:2};
    track.barSettings[0].beatSliceAnchors = {0:0};
    const snapshot = structuredClone(track);
    delete snapshot.currentBar; delete snapshot.currentBeat;
    const sectionTrack = Object.fromEntries(['name','barSettings','muted','solo','volume','pitchShift','swing','mainBeatSound','subdivisionSound'].map(key => [key,snapshot[key]]));
    app.setSong({version:2,enabled:true,name:'First song',sections:[{name:'Verse',startBar:0,tempo:123,repeats:3,tracks:[sectionTrack]}]});
    const monitoring = (await import('/js/monitoring.js')).default;
    monitoring.setVolume(.21); monitoring.setMuted(true);
    return song.validatePayload(await song.createPayload()).state;
  });
  await page.getByLabel('Setlist name', { exact: true }).fill('Friday');
  await page.getByRole('button', { name: 'Create setlist', exact: true }).click();
  await page.evaluate(() => app.setSong({ ...app.getSong(), name: 'First song' }));
  await page.getByRole('button', { name: 'Add current song', exact: true }).click();
  await expect(page.getByLabel('Entry name 1', { exact: true })).toHaveValue('First song');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('metronominal.rehearsal.v1')));
  expect(saved.lists[0].songs[0].payload.format).toBe('metronominal-song');
  expect(JSON.stringify(saved)).not.toMatch(/selectedTheme|listeningLevel|serializedRecordings|hostCredential/);
  await page.evaluate(() => app.setSong({ ...app.getSong(), name: 'Unsaved' }));
  await page.getByRole('button', { name: 'Load entry 1', exact: true }).click();
  await expect.poll(() => page.evaluate(() => app.getSong().name)).toBe('First song');
  expect(await page.evaluate(async () => song.validatePayload(await song.createPayload()).state)).toEqual(expectedState);
  expect(await ready(page)).toBe(true);
  await page.getByText('Setlists', { exact: true }).click();
  await expect(page.getByLabel('Entry name 1', { exact: true })).toHaveValue('First song');
});
