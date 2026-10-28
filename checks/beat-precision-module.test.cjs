'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('gesture controller has valid ES module syntax', () => {
  const source = path.resolve(__dirname, '../js/beatPrecision.js');
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, [
    '--experimental-vm-modules',
    '-e',
    "const fs=require('node:fs'),vm=require('node:vm');new vm.SourceTextModule(fs.readFileSync(process.argv[1],'utf8'));",
    source,
  ], { encoding: 'utf8', env });
  assert.equal(result.status, 0, result.stderr || result.error?.message || 'ES module parser failed');
});
