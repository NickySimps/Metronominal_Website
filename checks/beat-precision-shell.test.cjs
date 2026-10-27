const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
function context() {
  const file = path.join(root, 'js/beatPrecisionMount.js');
  assert.ok(fs.existsSync(file), 'precision bootstrap must exist');
  const c = vm.createContext({console:{warn(){}}});
  vm.runInContext(fs.readFileSync(file,'utf8').replace(/export /g,''),c);
  return c;
}
test('precision mount is awaited, idempotent and safe with old cached markup', async () => {
  const c=context(), mount={textContent:''}, interaction={}; let loads=0,calls=0,release;
  const load=()=>{loads++; return new Promise(resolve=>{release=()=>resolve({initializeBeatPrecision:(r,i)=>{assert.equal(r,mount);assert.equal(i,interaction);calls++;}});});};
  await c.initializeBeatPrecisionMount(null,interaction,load);
  await c.initializeBeatPrecisionMount(mount,null,load);
  assert.equal(loads,0);
  const first=c.initializeBeatPrecisionMount(mount,interaction,load);
  const second=c.initializeBeatPrecisionMount(mount,interaction,load);
  assert.equal(loads,1); assert.equal(calls,0);release();await first;await second;
  assert.equal(calls,1);
});
test('precision initialization failure is visible without throwing into core startup', async () => {
  const c=context(), mount={textContent:''};
  await c.initializeBeatPrecisionMount(mount,{},async()=>{throw new Error('fixture unavailable');});
  assert.match(mount.textContent,/unavailable/i);
  assert.match(mount.textContent,/normal beat controls/i);
});
test('precision selection has a visible track-adjacent mount and offline assets', () => {
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const script=fs.readFileSync(path.join(root,'script.js'),'utf8');
  const sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');
  assert.equal((html.match(/id="beat-precision-controls"/g)||[]).length,1);
  assert.ok(html.indexOf('id="beat-precision-controls"')<html.indexOf('id="all-tracks-wrapper"'));
  assert.ok(html.includes('href="beat-precision.css"'));
  assert.match(script,/await initializeBeatPrecisionMount\(/);
  for(const file of ['beat-precision.css','js/beatPrecision.js','js/beatPrecisionMount.js']) assert.ok(sw.includes(`'./${file}'`),file);
  assert.match(sw,/metronominal-v193/);
});
