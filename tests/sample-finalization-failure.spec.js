const { test, expect } = require('@playwright/test');
const { recordingModalMarkup } = require('./recordingMenuMarkup.cjs');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), os = require('node:os');
let server, origin;
const wavPath=path.join(os.tmpdir(),'metronominal-generated-finalization.wav');
const rate=48000,frames=rate*4,wav=Buffer.alloc(44+frames*2);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(frames*2,40);for(let i=0;i<frames;i++)wav.writeInt16LE(Math.round(12000*Math.sin(2*Math.PI*440*i/rate)),44+i*2);fs.writeFileSync(wavPath,wav);
test.use({channel:'chrome', launchOptions:{args:['--use-fake-device-for-media-stream','--use-file-for-fake-audio-capture='+wavPath]}, permissions:['microphone']});
test.beforeAll(async()=>{ const root=path.join(__dirname,'..'); server=http.createServer((req,res)=>{ if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><link rel="stylesheet" href="/style.css"><button id="rec">Rec</button>'+recordingModalMarkup().modal);return;} if(req.url==='/js/tracksController.js'){res.setHeader('Content-Type','text/javascript');res.end('export default {renderTracks(){}}');return;} if(!/^\/(js\/[a-zA-Z]+\.js|style\.css|voice-(note-display|take-editor)\.css)$/.test(req.url)){res.writeHead(404);res.end();return;} fs.readFile(path.join(root,req.url),(e,b)=>{res.writeHead(e?404:200,{'Content-Type':req.url.endsWith('.css')?'text/css':'text/javascript'});res.end(b);});}); await new Promise(r=>server.listen(0,'127.0.0.1',r)); origin='http://127.0.0.1:'+server.address().port; });
test.afterAll(async()=>new Promise(r=>server.close(r)));
async function ready(page){ await page.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort()); await page.goto(origin); await page.evaluate(async()=>{window.a=(await import('/js/appState.js')).default; window.audio=(await import('/js/audioController.js')).default; window.isHost=true; a.initializeAudioContext();a.addTrack();a.setTempo(120);a.updateTrack(0,{mainBeatSound:{sound:'Synth Sine',settings:{}},barSettings:Array.from({length:4},()=>({beats:4,subdivision:1,rests:[]}))});audio.initialize();window.streams=[];const acquire=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async c=>{const s=await acquire(c);streams.push(s);return s};document.querySelector('#rec').onclick=()=>void audio.toggleRecording(0);});}
async function released(page){await expect.poll(()=>page.evaluate(()=>streams.every(s=>s.getTracks().every(t=>t.readyState==='ended')))).toBe(true);await expect.poll(()=>page.evaluate(()=>audio.recordingSession)).toBe(null);}
const modal=page=>page.locator('#recording-display-modal');

test('decode failure remains visible and allows a subsequent sample recording', async ({ page }) => {
  await ready(page);
  await page.locator('#rec').click();
  await page.locator('#recording-start-btn').click();
  await expect.poll(() => page.evaluate(() => a.isRecording() && audio.mediaRecorder?.state === 'recording')).toBe(true);
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    window.decodeCalls = 0;
    const context = a.getAudioContext();
    const decode = context.decodeAudioData.bind(context);
    context.decodeAudioData = (...args) => {
      decodeCalls++;
      return decodeCalls === 1 ? Promise.reject(new Error('injected decode failure')) : decode(...args);
    };
  });
  await page.waitForTimeout(200);
  await page.locator('#recording-stop-btn').click();
  await expect(page.locator('#recording-start-btn')).toBeVisible();
  await expect(page.locator('#voice-recording-status')).toContainText('could not be finalized');
  await expect(modal(page)).toBeVisible();
  await expect(page.locator('#recording-start-btn')).toBeEnabled();
  await page.locator('#recording-start-btn').click();
  await expect.poll(() => page.evaluate(() => audio.mediaRecorder?.state === 'recording')).toBe(true);
  await page.waitForTimeout(200);
  await page.locator('#recording-stop-btn').click();
  await expect.poll(() => page.evaluate(() => a.getRecordings().length)).toBe(1);
  await released(page);
});
