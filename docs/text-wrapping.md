# Mounted text wrapping audit

## Scope and method

The regression suite is `tests/text-wrapping.spec.js`. It opens the actual `index.html` application, waits for the real room connection and rehearsal mounts, uses the production track/theme/Precision/library/room controllers, and connects an actual second participant for readiness and control-request labels. It does not substitute fabricated component markup or audio/network controllers.

Coverage:

- 320, 360, 390, 768 and 1280 CSS-pixel widths, at ordinary sizing and a 20px root font with `.12em` letter spacing and `.16em` word spacing.
- Default, Dark, High Visibility and Synthwave typography, plus reproducibly generated themes using the actual generator.
- A 768×320 constrained landscape and a 320×256 CSS viewport (the layout equivalent of a 1280×1024 viewport at 400% zoom).
- Forty-character unbroken track and peer labels, an 80-character setlist/entry label, and a 140-character unbroken cue.
- Main track actions, bar adjustment actions, sound selector actions, slider labels and percentage chips; expanded A/B/Song controls, shortcuts and theme menu; Precision toggle/navigation/status/magnifier/editor; readiness, peer grid, control requests and disconnected-room recovery copy; history actions/status; populated setlists and sent cues; sound and effects editors.

Assertions use actual `Range` line rectangles, canvas font metrics using the computed font and letter spacing, element/viewport bounds, button hit-area sizes, modal client/scroll widths, document scroll width and unchanged dense-bar grid dimensions while magnifying. Measurements are collected **before** screenshots, so full-page screenshot reflow cannot conceal WebKit's native-select overflow issue. Native input/select value truncation is not reported as a wrapping defect. Intentionally clipped screen-reader-only headings are excluded from visual text checks.

The peer table and top toolbar have intentional native horizontal scrolling. Table headers and numeric RTT cells remain whole; long peer labels can wrap within their own cells. Toolbar actions are checked for complete internal text and hit size, not incorrectly required to be simultaneously onscreen. Neither component is allowed to create document horizontal overflow.

The audit finishes finite UI animations before measuring final layout. It does not replace production CSS to hide failures. A dense 64-beat bar cannot leave room for a non-occluding magnifier in the constrained-height cases: the suite asserts the existing honest `Not enough preview space. Use Previous / Next beat.` fallback and unchanged bar geometry rather than inventing a lens.

## Verified defects and root causes

| Defect | RED evidence | Correction |
| --- | --- | --- |
| Pitch/Swing labels extend outside their chips; values and `100%` are truncated | At 320px the 8%-wide label boxes were 22.67px, while rendered `Pitch:`/`Swing:` occupied 33.91/40.89px. Track `100%` had only 32px of content space for 33.92px text. With large text, monitoring's fixed `5ch` column was 55.19px for a 63.72px value. | Size numeric chips and short slider labels from their actual intrinsic content, keep numeric strings on one line, and let the range input—not the text—shrink. Use `max-content` monitoring output columns. |
| Full track names are inaccessible visually behind ellipsis | The 40-character name occupied 499.28px but was restricted to an 88px chip at 320px. | Give the name a full-width wrapping grid row; retain a separate four-column action row with 44px minimum targets. Break long unbroken names only in that label. |
| Control-request labels escape the room panel | A 40-character peer label occupied 336.06px in a 252.98px paragraph; enlarged typography occupied 594.5px in 262.91px. | Scope emergency wrapping to room paragraphs, including dynamic requests and recovery copy. |
| Peer-grid column headings become vertical letters | `Connection` broke across ten lines; `Clock`/`Audio` across five and `RTT` across three at 320px. | Keep a readable minimum table width inside the existing native horizontal scroller; keep headers and RTT numeric cells whole. Only peer-name cells need emergency word wrapping. |
| Probability label overlaps the `100%` output | In actual Synthwave typography `Probability` measured 228.81px in a 140.81px first-column cell. The screenshot shows the label painted into `100%`. | Put the label across the grid's first row, and the slider plus unbroken numeric output on the second row. Allow an unusually wide themed label to wrap locally. |
| Effects heading/description exceed the narrow editor | Synthwave `Effects` occupied 218.41px in 212px; a description word occupied 228.81px in 212px. | Scope emergency wrapping to the effects heading block. |
| Many action targets are under 44px | Track buttons were 42px tall; sound actions 32/33px; library actions 36px; top toolbar and desktop theme controls 40px; sound/effects stepper buttons 30px wide. | Component-scoped 44px minimums, auto heights and normal action-label wrapping. No beat-grid target resizing. |
| Enlarging steppers can squeeze ADSR ranges to 5–10px | A follow-up RED test measured real attack/decay/sustain/release range widths after establishing 44px button targets. | Make ADSR columns adapt to a useful minimum width and stack them at the mobile breakpoint, instead of retaining fixed four/two-column layouts. |
| Enlarged sound selectors overlap each other | The added pairwise hit-area regression found a 6px overlap between the main/subdivision selector buttons: their wrappers still had fixed 32px heights in 70px columns. | Let all three sound-control columns size intrinsically with a 94px minimum and their selector wrappers have a 44px minimum. |

No global word-breaking, numeric word-breaking, new global overflow hiding, audio JavaScript, networking JavaScript, existing-test weakening, commit or deployment was introduced.

## Sections verified without speculative CSS changes

- Precision controls/status and magnifier text; its native pan/pinch rules, explicit editing and original grid geometry are unchanged. No edit to `beat-precision.css`.
- History buttons and status already wrap correctly and have 44px targets. No edit to `edit-history.css`.
- Rehearsal outer panel/status and visualization-quality copy fit. No edit to `rehearsal-tools.css` or `adaptive-visualization.css`.
- Existing mobile library labels remain `display: block`; native WebKit select behavior is preserved. The only library stylesheet change is the verified target-height minimum.

## Execution and evidence

The isolated scratch runner is `C:/Users/RenderCube/AppData/Local/hermes/cache/scratch/text-audit-run.cjs`. It starts its own HTTP server on port 0 and the actual sibling signaling server via `createSyncServer({port: 0})`, and rewrites only the served local WebSocket URL. It never binds the shared 4188 or 10000 ports and never modifies the production network source. Run with the portable Node 22 executable supplied for this environment. The suite itself also works with an ordinary Playwright base URL pointing at the actual app.

Each run has distinct JSON, logs, screenshots and source-hash manifests in the scratch directory. RED run names: `numeric-red`, `main-red`, `global-red`, `room-red`, `modal-red`, `slider-red`, `overlap-red`. Each focused RED run had two expected failing cases, before its corresponding correction.

Example matching before/after screenshot names, beneath `text-audit-<run>/`:

- `text-wrapping-numeric-chip-e1fdf-omplete-320px-spacing-false-chromium/numeric-labels.png`
- `text-wrapping-mounted-main-62e96--labels-320px-spacing-false-chromium/main-actions.png`
- `text-wrapping-mounted-room-20984-ry-text-320px-spacing-false-chromium/rehearsal-text.png`
- `text-wrapping-Precision-an-3c736-itors-320x900-spacing-false-chromium/sound-settings-modal.png`

## Limits and unrelated findings

This proves CSS layout and interaction geometry in the installed Chromium, Firefox and WebKit engines, not physical-device rendering or audibility. The zoom case is equivalent CSS viewport geometry, not a claim of having changed a physical browser's zoom control. Generated-theme coverage is reproducible sampling, not every possible random palette/font combination.

During fixture construction, the real library's `Add current song` failed for untouched legacy-default tracks: one song validation succeeded, a second validation of the reconstructed payload failed because optional track pitch/swing values were not initialized. This is outside this CSS-only assignment. The text fixture explicitly sets real track `pitchShift: 0` and `swing: 0` through AppState before capturing a song; it does not bypass the real library or validator. The parent should address the unrelated default-state normalization separately.

## Final verification

The parent requested a prompt bounded handoff rather than another full aggregate run. **Final bounded verification: 30 passed, 0 failed, 0 skipped (10 Chromium + 10 Firefox + 10 WebKit), exit 0, unchanged source/test SHA-256 manifest.** This includes 320px main/numeric/room/library cases at ordinary and enlarged spacing, 320×900 sound editors, 768×320 landscape and 320×256 zoom-equivalent cases. Report: `text-audit-bounded-final.json`; manifest: `text-audit-bounded-final-manifest.json`; screenshots: `text-audit-bounded-final/`.

The complete 126-case new-test matrix is **not claimed green**: 96 additional cases have not been rerun on the final intrinsic-height correction. Interrupted development matrix runs are not completion evidence. Parent should run the complete suite during combined final verification. Seven focused RED slices recorded **14 expected failures** before their corresponding corrections. `git diff --check` passed.

The existing Precision/library regression run completed **99 passed, 1 failed** (`text-audit-regression.json`, exit 1, unchanged source manifest). The failure was WebKit's first mounted Precision integration case: Escape closed the parent sound editor before its focus/readiness transition was settled. No existing test was edited or weakened.

A diagnostic replay serving the tracked `HEAD` versions of `style.css` and `track-actions.css`, without reverting working files, reproduced existing readiness failures: **1 passed, 4 failed** over five WebKit repetitions (`text-audit-baseline-focus.json`). One failed at the same parent-editor Escape assertion; three failed waiting for a lens after scrolling. These are consistent with the existing deferred focus and scroll-cancel timing, not evidence that the wrapping corrections introduced the behavior. The parent owns final combined verification and the out-of-scope JavaScript/test-readiness decision.
