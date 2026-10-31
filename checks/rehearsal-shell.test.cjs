const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
test('feature initialization is isolated, awaited, idempotent and fails visibly', async () => {
  const calls = [];
  const status = { textContent: '' };
  const document = { getElementById: () => status, createElement: () => ({ append() {}, textContent: '', className: '', id: '' }) };
  const mount = { ownerDocument: document, append() {} };
  const context = vm.createContext({ document, console: { warn() {} },
    initializeRehearsalRoomControls: async () => { calls.push('room'); },
    initializeHistoryControls: () => { calls.push('history'); throw new Error('fixture unavailable'); },
    initializeRehearsalLibrary: () => { calls.push('library'); },
    initializeAdaptiveVisualization: () => { calls.push('visual'); }
  });
  const file = path.join(root, 'js/rehearsalTools.js');
  assert.ok(fs.existsSync(file), 'feature initialization entrypoint must exist');
  vm.runInContext(fs.readFileSync(file, 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/export /g, ''), context);
  await context.initializeRehearsalTools(mount);
  await context.initializeRehearsalTools(mount);
  assert.deepEqual(calls, ['room', 'history', 'library', 'visual']);
  assert.match(status.textContent, /unavailable/i);
});
test('every locally imported application module is present in the offline cache list', () => {
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const visited = new Set();
  const walk = file => {
    if (visited.has(file)) return;
    visited.add(file);
    assert.ok(fs.existsSync(file), `Imported module missing: ${path.relative(root, file)}`);
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/\bfrom\s+["'](\.[^"']+\.js)["']/g)) walk(path.resolve(path.dirname(file), match[1]));
  };
  walk(path.join(root, 'script.js'));
  // Workflow features load dynamically; include their static dependency closures too.
  for (const entry of ['rangeEditor','arrangementTimeline','practiceTransport','performanceView']) walk(path.join(root, `js/${entry}.js`));
  for (const file of visited) {
    const relative = path.relative(root, file).replaceAll('\\', '/');
    assert.ok(sw.includes(`'./${relative}'`), `${relative} missing from service worker precache`);
  }
});

test('rehearsal controls have one accessible mount and precached feature entrypoints', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const script = fs.readFileSync(path.join(root, 'script.js'), 'utf8');
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  assert.equal((html.match(/id="rehearsal-tools"/g) || []).length, 1);
  assert.match(html, /<summary[^>]*>Rehearsal tools<\/summary>/);
  assert.match(script, /await initializeRehearsalTools\(/);
  for (const file of ['rehearsal-tools.css','rehearsal-room.css','edit-history.css','rehearsal-library.css','adaptive-visualization.css']) {
    assert.ok(html.includes(`href="${file}"`), file);
    assert.ok(sw.includes(`'./${file}'`), `${file} cache`);
  }
  for (const file of ['rehearsalTools','rehearsalRoomController','editHistory','rehearsalLibrary','adaptiveVisualization']) {
    assert.ok(sw.includes(`'./js/${file}.js'`), `${file} cache`);
  }
  assert.match(sw, /metronominal-v195/);
});
