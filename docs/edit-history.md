# Edit history integration

## Initialization and publication

```js
import { initializeHistoryControls } from './js/editHistory.js';
// After controllers + Song initialization and the first refresh; before WebRTC.
initializeHistoryControls(historyRoot);
document.addEventListener('historyapplied', () => refreshUIFromState({ animate: false }));
```

The history controller never imports UI controllers or networking and never sends state. A successful replay emits exactly one `historyapplied` document event with `{ direction, label }` (no snapshot/audio payload). The parent refresh owns host publication through its existing safe `sendState` boundary. Link `edit-history.css`.

The returned controller exposes async `undo()` / `redo()` (boolean success), `clear()` and `destroy()`. Reinitialization destroys old listeners and markup.

## Transactions

`beginEditTransaction(label)` returns an opaque token, or `null` if blocked/already in a transaction. `commitEditTransaction(token)` groups setter calls and/or direct object mutations into one entry. `cancelEditTransaction(token)` discards capture, **not** the actual edit. Tokens are invalidated by playback starting, external loads, authority changes, clearing or destruction. Callers must not continue mutating application state with a stale asynchronous transaction; check their own async generation before making the edit.

```js
const token = beginEditTransaction('Change section');
try {
  // Synchronous musical mutations, or a guarded local load:
  await AppState.loadPresetData(validatedState, { history: 'local', guard: isCurrentGeneration });
  commitEditTransaction(token);
} catch (error) {
  cancelEditTransaction(token);
  throw error;
}
```

**Important:** local SongController.applyPayload, preset and cue/setlist loads must pass `{ history: 'local' }` into their AppState load (plus an authority/lifecycle `guard` when work can be delayed). Merely wrapping an unmarked load with begin/commit is intentionally insufficient: every unmarked load is an external/initial synchronization boundary and clears history before applying. Existing callers without this integration retain safe behavior but their imported arrangements are not undoable. Ordinary setters such as `setSong` are captured automatically.

`AppState.subscribeMusicalMutations(listener)` returns an unsubscribe function and reports `{ before, after, label, args }` at explicit setter boundaries. Notifications intentionally include unchanged snapshots because legacy controllers can mutate a nested bar/sound object *before* calling updateTrack. The history controller compares its detached last baseline rather than trusting a shallow setter's already-mutated before snapshot. Use explicit transactions for compound/direct edits with no setter notification.

## Authority and scope

- Host or pre-room solo only, while stopped. Joined clients cannot replay via buttons, shortcuts or controller methods.
- `syncrolechange` changes invalidate history; `roomauthoritychange` explicitly clears it even if the host role does not change. The room integration must dispatch the latter for same-role room replacement/rotation. Unmarked loads also clear history.
- Generation guards are checked before reconstruction and after its await. No late replay publication after authority loss. Default preset loads never become local edit records.
- Fifty entries maximum. Same tempo/volume/track-property/sound-target updates within 650 ms coalesce. A different track property/target, transaction or intervening action breaks a group. A new meaningful edit clears redo.
- Capture tempo, arrangement volume, count-in, musical track/bar/beat/sound parameters, song sections/snapshots and custom synthesis-preset definitions. Never capture live audio nodes/AudioContext/AudioBuffer, buffer maps, recorded sample bytes, transport position, theme, latency, credentials, local monitoring or editor selection/modes.
- Replay calls the existing AppState preset loader to rebuild analysers; live sample buffers/recordings remain local and are not decoded/serialized by history. Restored tracks start with zeroed stopped positions, never an old transport or unsolicited Play.
- Track-local monitoring follows the existing Monitoring identity policy: structural/name changes may reset per-slot listening choices. Device volume/mute and theme are never rolled back.
- Ctrl/Cmd+Z, Shift+Z and Ctrl/Cmd+Y leave input/textarea/select/contenteditable/textbox native undo alone.
- History is session-memory only. It is not a share/preset wire format; all host publication must continue using the existing private-asset-safe serializer, not `getMusicalSnapshot()`.

## Verification

Focused browser suite: `tests/edit-history.spec.js`. It imports real modules directly under a real local HTTP server and decodes repository Click/Crank assets into native AudioBuffers; no CDN or fake signaling protocol. Authority-event and held-reconstruction tests are component seams, **not** a claim of real multi-peer signaling coverage. Parent integration/full realtime coverage is separate.

Portable Node 22 invocation used with the scratch Playwright config:

```
C:/Users/RenderCube/AppData/Local/hermes/cache/scratch/node22-activation/node-v22.23.4-win-x64/node.exe node_modules/@playwright/test/cli.js test --config C:/Users/RenderCube/AppData/Local/hermes/cache/scratch/edit-history.playwright.cjs
```

Scratch config owns port 4287, `reuseExistingServer:false`, blocked service workers and its own output directory; it never uses stale port 4173.

Observed RED cases before their fixes: missing module; external preset load left Undo enabled; shallow legacy bar mutation was not captured; separate track properties merged into one undo; raw-object transaction left the next baseline stale; edits during playback could be overwritten by old stopped history; synthesis preset definition changes were not captured. Focused GREEN runs are recorded in tool output.
