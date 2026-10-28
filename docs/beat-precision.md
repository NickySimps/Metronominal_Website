# Device-local Precision beat selection

## v194: three-lane gesture architecture and exclusive picker ownership

This section describes the v194 candidate. Deployment and verification status belongs to the release evidence; published v193 and v192 behaviors are retained below as historical reference.

- **Three distinct gesture lanes from initial contact:**
  1. **Stationary hold (~380 ms) → Subdivision picker:** Holding a beat within 10 px for ~380 ms opens the bar's two-panel subdivision selector without mutating the initial beat. Once visible, the subdivision picker exclusively owns the contact until release or cancellation. Traversing the source grid, panel padding, panel gaps, or sliding from a subdivision option back onto the beat grid can **never** transition into precision magnification or fast painting. Releasing on a hovered subdivision option commits only that subdivision; releasing back on the source grid after visiting an option leaves musical state unchanged.
  2. **Slow deliberate pre-hold movement → Precision lens:** Moving more than 10 px across at least 2 samples over at least 40 ms at `<= 0.6 px/ms` (with eligible fast strokes taking precedence) before the 380 ms hold deadline opens the magnified precision lens directly without opening the subdivision picker first. Movement previews nearby targets (retaining coarse `> 0.6 px/ms` and fine `<= 0.18 px/ms` or 280 ms dwell scaling and 44 px/60 px cell hit targets) and locks the contact into precision so later fast movement navigates the preview rather than starting a surprise paint stroke. Release commits only the final target once through `BarDisplayController.applyBeatAction`.
  3. **Fast pre-hold movement → Direct stroke painting (Rest / Accent / Slice) or final-target Beat Edit:** Moving more than 10 px across at least 24 px over at least 16 ms at `>= 0.6 px/ms` locks into the fast stroke lane. In Rest, Accent, and Slice modes, the stroke begins a single `editHistory` transaction (`beginEditTransaction` / `commitEditTransaction`), unpacks `PointerEvent.getCoalescedEvents()` curved samples, and intersects each delivered segment against actual `.beat-square` CSS rectangles across eligible bars/tracks so skipped cells are painted in entry order without drawing a bounding-box chord across unrelated rows. Each logical cell (`track:bar:beatIndex`) is visited at most once per stroke (including retracing) with consistent initial rest/accent intent. In Beat Edit mode, fast movement tracks the final target and opens at most one sound editor on release without copying sound parameters across crossed beats. Normal mode does not paint.
- **Touch-action and cancellation fences:** `.beat-precision-enabled` preserves `pan-y pinch-zoom` in Normal mode so vertical swipes scroll the page; `.beat-precision-editing` uses `pinch-zoom` in explicit edit modes so vertical editing strokes are not cancelled by native scrolling, while scrolling outside `.bar-visual` remains available. Secondary contacts, `pointercancel`, scroll/resize/blur/visibility changes, playback/role/room/history boundaries, external musical mutations, and unexpected DOM topology changes cancel active gestures fail-closed while preserving already-completed edits.

- Short movements that do not provide enough evidence for either moving lane are cancelled on release rather than becoming an accidental edit of the starting beat. Normal-mode vertical intent yields to native scrolling. Recent delivered movement is considered for fast classification so a brief initial pause does not dilute a subsequent fast sweep.
- Assisted musical taps and subdivision commits, as well as paint strokes, require history ownership; absent history, another editor's transaction or a pending Undo refuses mutation. An unrelated musical change interrupts a stroke into separate chronological Undo entries without retaining raw notification arguments or private/runtime data in transaction tokens.
- Retiring animation nodes are decorative, not logical beats. They are excluded from targets and indexing, and their precise removal records do not invalidate otherwise unchanged logical gestures. Finishing strokes refreshes current accessible labels and teardown releases all owned touch-action classes.
- v194 precaching explicitly reloads static requests, preventing a fresh old HTTP cache entry from being installed into the new version's offline cache. Deployment verification remains separate from this document.

## Published v193: stationary subdivisions, moving precision (historical behavior)

These are the versioned v193 interaction semantics. Deployment and verification status belong to the release evidence, not this document. Historical v192 behavior is archived below.

- Assistance defaults on for a stopped solo user or host in Normal, Beat Edit, Rest, Accent and Slice modes. Its optional toggle remains contextual to the track, without a permanent global toolbar.
- Hold an actual beat still for about 380 ms to open the existing subdivision picker. Moving through its options, panel padding or gaps stays in subdivision selection rather than accidentally painting a beat underneath.
- After the hold, deliberately move more than 10 px across the source grid to switch that contact to the precision lens. Returning from the picker to the grid abandons its uncommitted choice. Once precision owns the contact, pausing refines targeting; it does not reopen subdivisions.
- A stationary hold does not trigger a rest, accent or slice action. After precision activates, release applies only the final target using the existing semantic action handler. Intermediate preview targets never change the music.
- Pre-hold swipes and multitouch retain native pan/pinch behavior. Cancellation, source identity changes, playback and authority boundaries discard pending actions. Explicit range picking owns its taps and makes precision yield.
- The lens uses active theme colors/fonts and viewport-clamped finger-relative placement, including dense tall bars and short landscape screens. Keyboard targeting and modal Escape ownership remain available.

The preserved focused gesture report has 68 passing cases, including native Chromium touch input, with matching before/after source manifests. This is focused evidence, not a completed integrated release gate or proof of physical iPhone behavior. Cross-browser integration and live production verification remain release requirements.

## Published v192 generalized hold-to-magnify (historical behavior)

Hold an actual beat for about 380 ms to show nearby magnified beats in **Normal, Beat Edit, Rest, Accent and Slice** modes. Assistance defaults on while host/solo and stopped. It does not require entering Beat Edit first. The bootstrap anchor stays hidden; the optional per-track toggle appears only in explicit action modes, with no permanent global toolbar.

The floating lens follows the finger/target cell and chooses a viewport-clamped above/below/side/corner location. It may cover distant rows of a tall bar, rather than disappearing when the entire source region cannot leave a free slot. It shows beat numbers and current state markers. Short mobile screens still get a lens, not a keyboard-only fallback. Styling remains tied to the active theme and its readable foregrounds/font.

Slide slowly for fine movement on either axis; release commits only the final target. Normal selects without editing music, Beat Edit opens the existing sound editor once, Rest toggles that beat, Accent cycles its velocity, and Slice cycles its slice count. Previewing does not mutate the initial/intermediate beats. Semantic actions use the same guarded `BarDisplayController.applyBeatAction` path as legacy controls.

Before hold activation, a movement exceeding 10 px cancels the assisted gesture without painting, retaining native pan/pinch. Once a deliberate single-touch hold is active, a narrowly scoped non-passive touchmove handler supports vertical fine positioning without handing it to page scrolling. Secondary touch, pointer cancellation, scroll, authority/playback/session changes or changed semantic topology cancel without committing. Native context menus/callouts are suppressed only on assisted beat surfaces. Keyboard targeting and existing modal Escape ownership remain available.

**Intentional gesture change:** assisted fast taps act on release; pre-hold dragging cancels rather than painting. Switch Precision off in a track action mode to retain legacy immediate tap/drag painting. Subdivision choices remain available from the dedicated existing subdivision indicator/background controls; holding an actual beat now belongs to magnification.

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
