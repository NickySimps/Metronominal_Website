'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('service-worker installation revalidates static assets rather than copying fresh old HTTP cache entries', async () => {
  const handlers = new Map(), requests = [], warnings = [];
  let installation;
  class WorkerRequest extends Request {
    constructor(url, options) { super(new URL(url, 'https://metronominal.example/'), options); }
  }
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../sw.js'), 'utf8'), {
    self: { addEventListener: (name, handler) => handlers.set(name, handler), skipWaiting: async () => {} },
    caches: { open: async () => ({ add: async request => { requests.push(request); } }) },
    Request: WorkerRequest,
    console: { log() {}, warn(...args) { warnings.push(args); } },
  });
  handlers.get('install')({ waitUntil(promise) { installation = promise; } });
  await installation;
  assert.ok(requests.length > 0, 'No precache requests were exercised');
  assert.deepEqual(warnings, [], 'Precache request construction failed');
  for (const request of requests) assert.equal(request.cache, 'reload', 'Static precache reused default HTTP cache policy');
});
