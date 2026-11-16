const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('recording dialog accessible name matches its visible heading', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const dialog = html.match(/<div\b(?=[^>]*\bid="recording-display-modal")([^>]*)>/);
  assert.ok(dialog, 'recording dialog exists');
  const attributes = dialog[1];
  const labelledBy = attributes.match(/\baria-labelledby="([^"]+)"/);
  assert.ok(labelledBy, 'recording dialog is labelled by its visible heading');

  const ids = labelledBy[1].split(/\s+/);
  assert.equal(ids.length, 1, 'dialog uses its dedicated visible heading as the name');
  const heading = new RegExp(`<h[1-6]\\b(?=[^>]*\\bid="${ids[0]}"[^>]*)[^>]*>([\\s\\S]*?)<\\/h[1-6]>`);
  const match = html.match(heading);
  assert.ok(match, 'label reference resolves to a visible heading');
  assert.equal(match[1].replace(/<[^>]*>/g, '').trim(), 'Record a sound');
  assert.doesNotMatch(attributes, /\baria-label=/, 'conflicting aria-label is absent');
});
