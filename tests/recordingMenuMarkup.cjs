'use strict';
// Recording-menu fixture markup shared by isolated voice/sample specs.
// Uses the REAL #recording-display-modal bytes from index.html. Until the UI
// worker's shared-contract markup is merged, the contract's proposed controls
// (#recording-mode-controls fieldset with two aria-pressed buttons + hidden
// #recording-mode, and #recording-start-btn) are inserted into the real modal.
// Once index.html carries #recording-start-btn, the real modal is used as-is.
const fs = require('node:fs');
const path = require('node:path');

function extractElement(html, openTag, tagName = 'div') {
  const start = html.indexOf(openTag);
  if (start < 0) throw new Error(`Missing ${openTag} in index.html`);
  const pattern = new RegExp(`<${tagName}\\b|</${tagName}>`, 'g');
  pattern.lastIndex = start;
  let depth = 0, match;
  while ((match = pattern.exec(html))) {
    depth += match[0].startsWith('</') ? -1 : 1;
    if (depth === 0) return html.slice(start, pattern.lastIndex);
  }
  throw new Error(`Unbalanced ${openTag}`);
}

const proposedModeControls = `<fieldset id="recording-mode-controls">
  <legend>Capture mode</legend>
  <button type="button" id="recording-mode-sample-btn" aria-pressed="true">Audio sample</button>
  <button type="button" id="recording-mode-voice-btn" aria-pressed="false">Voice to notes</button>
  <input type="hidden" id="recording-mode" value="sample">
  <p id="recording-mode-help">Sample records audio. Voice detects one sung note at a time without keeping raw audio. Stop playback first.</p>
</fieldset>`;
const proposedStart = '<button type="button" id="recording-start-btn">Start</button>';

function recordingModalMarkup(root = path.join(__dirname, '..')) {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const modal = extractElement(html, '<div id="recording-display-modal"');
  if (modal.includes('id="recording-start-btn"')) return { modal, proposed: false };
  const withMode = modal.replace(/(<h2 id="recording-timer">[\s\S]*?<\/h2>)/, `$1\n${proposedModeControls}`);
  const withStart = withMode.replace('<button id="recording-stop-btn"', `${proposedStart}\n<button id="recording-stop-btn"`);
  if (withStart === modal || !withStart.includes(proposedStart) || !withStart.includes('recording-mode-sample-btn'))
    throw new Error('Could not compose proposed recording menu markup');
  return { modal: withStart, proposed: true };
}

module.exports = { recordingModalMarkup, extractElement };
