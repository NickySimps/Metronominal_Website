const fs = require('node:fs');
const path = require('node:path');

const START_MARKER = '// Melody promotes';
const END_MARKER = '\nlet socket = null;';
const MODULE_PRELUDE = "import AppState from './appState.js';\nimport {validateMelody} from './melodySchema.js';\n";

function publicMelodyFixture() {
  const sourcePath = path.join(__dirname, '..', 'js', 'webrtc.js');
  const source = fs.readFileSync(sourcePath, 'utf8');
  const start = source.indexOf(START_MARKER);
  const end = source.indexOf(END_MARKER);

  if (start < 0 || source.indexOf(START_MARKER, start + START_MARKER.length) !== -1) {
    throw new Error(`Expected exactly one ${JSON.stringify(START_MARKER)} marker in ${sourcePath}`);
  }
  if (end < 0 || source.indexOf(END_MARKER, end + END_MARKER.length) !== -1) {
    throw new Error(`Expected exactly one ${JSON.stringify(END_MARKER)} marker in ${sourcePath}`);
  }
  if (end <= start) {
    throw new Error(`Production public-melody markers are out of order in ${sourcePath}`);
  }

  return MODULE_PRELUDE + source.slice(start, end);
}

module.exports = publicMelodyFixture;
