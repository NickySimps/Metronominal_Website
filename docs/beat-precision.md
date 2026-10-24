# Device-local Precision beat selection

## v191 contextual interface (current)

The bootstrap anchor stays empty/hidden. Compact assistance controls live inside each real track and appear only in the existing **Beat Edit** mode while host/solo and stopped. Assistance defaults on within that mode, with a device-local opt-out toggle; there is no permanent toolbar and no Previous/Next/Edit button strip.

A tap, or a held/slid magnified release, opens the targeted existing sound editor once. Opening the editor does not mutate the song; changes still require editing an actual parameter. Arrow keys move a roving beat target and Enter/Space opens it. A constrained viewport that cannot fit a non-occluding lens offers keyboard targeting. Mode exit, playback, role/authority changes, cancelled/scrolling gestures, stale targets and 3D context changes remove pending assistance. Ordinary Rest/Accent/Slice/subdivision gestures remain untouched outside assistance.

Controls, selected-beat ring and lens use the live theme palette, derived readable foregrounds and theme font. Track rerenders reconcile controls without attaching a global panel. The active root still requires the idempotent initialization and destroy contract shown below.

The following v190 interaction notes are historical; their separate Edit action and always-visible mount no longer describe the UI.

## Integration

```js
import { initializeBeatPrecision } from './js/beatPrecision.js';
const precision = initializeBeatPrecision(
  document.getElementById('beat-precision-controls'),
  document.getElementById('all-tracks-wrapper')
);
// Before removing/replacing these mount roots:
precision?.destroy();
```

Load `beat-precision.css` after the app stylesheet. Mount controls visibly beside/above the track area, not inside a collapsed tools disclosure. Initialize after the initial track UI render and before initial WebRTC role events. The second parameter defaults to `#all-tracks-wrapper`. Missing roots return `null`; repeated initialization of the same controls root returns the same controller; repeated `destroy()` is harmless. The root wrapper can retain identity while its tracks/bars rerender.

Accessible toggle name: **Precision beat selection**; visible text: **Precision**; `aria-pressed` defaults to `false` on every mount. There is deliberately no persistence, storage access, AppState preference schema, room message, audio invocation, synthetic replay, or musical mutation.

## Interaction

- OFF: legacy pointer events, taps, paint modes and subdivision holds remain untouched.
- ON: capture delegation prevents bar pointerdown from starting legacy paint/hold handlers and prevents beat clicks from opening editors. Pointerdown/move defaults are not prevented; scoped CSS restores `pan-y pinch-zoom`, including over legacy rest/accent/slice paint modes.
- Quick tap selects a local outlined beat. Holding for 380 ms opens a fixed preview above or below the entire bar, never over its beats. If neither side has space, a message directs the user to Previous/Next instead of covering the target.
- Slide over the original beat geometry. Selection uses actual per-cell rectangles, so multirow bars retain their actual indices. A 4 px distance-improvement hysteresis resists boundary jitter. Fast movement above 0.6 px/ms uses coarse movement. A 280 ms dwell or 220 ms accumulated slow movement below 0.18 px/ms enters fine movement (quarter gain) and enlarges preview cells from 44 to 60 px.
- Preview cells are also explicit local selection hit areas; releasing on a cell selects its labelled beat. Releasing outside the source bar and preview cells cancels. No release opens an editor or changes music.
- Vertical movement before hold activation, vertical pan/scroll, multi-touch, pointercancel, Escape, blur, visibility changes, role/authority/playback events, loading/history boundaries, detached targets, relevant bar child rerenders or index changes cancel pending selection. Escape returns focus to Precision; scrolling/blur do not steal focus.
- Previous/Next buttons and arrow keys while a Precision control has focus select targets without touching tiny beats. Native Enter/Space on **Edit selected beat** explicitly opens the existing editor. Both its disabled state and handler require stopped playback and solo/host authority. Event name `syncrolechange` supplies `{state,isHost}`; other lifecycle events follow existing app conventions.

## Evidence

`tests/beat-precision.spec.js` starts its own ephemeral localhost HTTP server (no 4188/10000, no production calls), imports real `AppState` and `beatTiming` modules, configures real 32/64-slot track data, and renders component-fixture beat geometry. Only the editor boundary is replaced with a call recorder; legacy fixture handlers record immediate paint/hold delivery. The parent owns actual full-app mounted integration coverage, including actual BarDisplayController legacy gesture proof.

TDD runs observed missing-module, missing-preview, missing-keyboard, paint-mode-pan, secondary-touch leakage, continuous-motion, index-invalidation, missing-hitcell, and native-menu RED failures before their GREEN implementations.

Verified with isolated scratch config and portable Node 22:

- Chromium: **13 passed**, including native CDP touch input scrolling in OFF and ON modes.
- Playwright WebKit: **12 passed**, excluding only the Chromium-CDP native input test via `--grep-invert 'native touch'` (not a WebKit native-scroll claim).
- Frozen browser clock plus explicit pointer timestamps prove coarse 84 px movement advances two slots, the same fine movement advances one, continuous slow movement changes scale, and boundary jitter retains a stable target.
- 320, 390 and 1280 px geometry checks and screenshots verify viewport bounds, no horizontal overflow, unchanged musical snapshot/transport/theme, and non-occluding preview. CSS uses explicit high-contrast paired colors rather than inheriting arbitrary theme text colors; reduced-motion overrides suppress control animations.

Reproduction in this workspace:

```sh
'C:/Users/RenderCube/AppData/Local/hermes/cache/scratch/node22-activation/node-v22.23.4-win-x64/node.exe' node_modules/@playwright/test/cli.js test --config C:/Users/RenderCube/AppData/Local/hermes/cache/scratch/precision-playwright.cjs
```

The scratch config has no managed app/signal servers and writes artifacts under `.../scratch/precision-results`. WebKit used `--browser webkit --grep-invert 'native touch' --output .../scratch/precision-webkit-results`.

## Mounted-app integration

The parent also ran the actual mounted app and actual BarDisplayController/SoundSettingsModal against the real local signaling server: **6 Chromium integration tests passed**. These verify a real 64-slot bar, capture isolation over actual Rest mode, preview/release preserving the complete musical snapshot and personal mix, an explicit real editor opening at track 0/bar 0/beat 19, preserved legacy rest taps and both subdivision menu panels when OFF, read-only participant and playing-host edit gates, and 320/390/1280px control bounds. The first harness assertion was corrected to expect the existing two-panel subdivision selector, not one element. The final parent matrix passed **58/58** with unchanged source/test fingerprints: Chromium 20, Firefox 19, WebKit 19; zero failures or flakes. Chromium alone runs the CDP-native scrolling test; the other engines omit that CDP-specific case rather than claiming native iPhone gesture evidence. Parent observed RED/GREEN for Escape stealing focus from another editor, and scoped Escape to its own gesture/focus while honoring `defaultPrevented`. The mounted app also verifies keyboard Effects → Escape returns focus to its real Effects trigger. Independent focused re-review cleared the Escape fix: 2 existing focused Chromium tests and 15 additional in-memory scenarios across Chromium, Firefox and WebKit passed. That review did not independently rerun the mounted-app matrix or clear the separate audio-engine blocker.

A real viewport-scroll regression was added: scroll the actual dense beat into view before pressing it, then scroll back to Edit. This initially lost the committed target, disabling Edit. Scrolling now cancels the lens/pending gesture but retains a committed valid local target, so the explicit action remains usable. The same 58-test final matrix includes this real scrolled flow and verifies the magnifier's vertical/horizontal viewport bounds. Screenshots were inspected with the magnifier visibly above the 64-slot grid.

## Limits

Desktop Chromium/WebKit automation does not establish physical iPhone feel, Safari touch arbitration after a stationary hold, OS pinch gestures, or audibility. Validate held horizontal gliding and ordinary vertical scroll/pinch on real iPhone hardware before release. The separately known asynchronous audio-render blocker is not touched. No deployment or commit was performed.
