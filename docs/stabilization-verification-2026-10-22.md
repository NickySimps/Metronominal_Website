# Stabilization release verification — October 22, 2026

## Scope

This release fixes the reproduced audit defects and hardens audio resource caching. It does not represent completion of the larger rehearsal/cooperation upgrade roadmap.

- Render-cache identity includes the synth function, audio context, sample rate and settings; failed renders are retryable.
- LRU limits: 32 rendered synth buffers and 32 reversed buffers per context; 32 distortion curves globally and 8 reverb impulse buffers per context. Immutable DSP data is reused; connected live nodes are not shared between hits.
- Joined clients cannot reset the room locally through the keyboard, buttons or UI API, or load a divergent local preset. Host resets use the shared authoritative transport path, including pending starts.
- Native focused controls keep Space/Enter activation. Browser/OS modifier shortcuts and composing text are excluded from app shortcuts.
- Theme controls initialize before audio loading and preserve selections made during startup. The theme menu stays open across selections.
- Sound/FX controls have associated labels and named native step buttons. Dialogs scroll internally and remain contained on 320px/390px viewports, including Synthwave. Pitch labels can wrap rather than silently truncate.
- Synthwave visualizer options no longer get clipped by the decorative oval; edge hit tests cover every option.
- The editor does not crash when AudioBuffer is unavailable. Reverb visualization has a visible canvas-filter fallback.
- Service-worker cache advances from v184 to v185.

## Verification

- Complete Chromium suite: **145 passed, 0 failed, 0 skipped** in the final run.
- Additional Firefox/WebKit selection: **72 passed, 0 failed, 10 skipped**. The skips are the 7 cache tests and 3 rendering tests on this Windows WebKit build, which does not expose OfflineAudioContext. These are not audio passes.
- Signaling server: **13 passed, 0 failed**; no server/protocol changes are included in this release.
- Real offline samples: all 20 synthesizers rendered finite nonzero audio on Chromium and Firefox. Filtering, distortion, delay, reverb and bypass were exercised; delay/reverb tails were measured. Real Kick/Snare cache separation and exact sample reversal were checked.
- Visualizer matrix: 16 modes × 3 effects (48 combinations), plus an explicit no-canvas-filter fallback regression.
- Isolated real-WebSocket host/client/observer tests cover resets, authority, native keyboard behavior and preset rejection; tests collect uncaught page errors.
- Mobile geometry/ARIA and screenshots were exercised at 320px and 390px. Outdated tests requiring overflowing oval editor surfaces were updated to require bounded internal scrolling.
- Screenshot emoji/font drift was also reproduced against an untouched export of the release baseline before reviewed images were refreshed. The visualizer-menu snapshot additionally records the intentional clipping fix.
- A purported sliced-song import defect was traced to an invalid test object containing name: undefined. The serialized JSON round trip succeeds; the fixture now supplies a valid name. No weakening of import validation was made.
- Tests that mutated the model before asynchronous startup completed now await the connected application state. A separate network-barrier test verifies early theme gestures rather than hiding startup behavior behind readiness waits.

Commands used the repository's Playwright runner with isolated HTTP/signaling setup and the established Chromium audio-service isolation flag. Raw JSON summaries and failure investigation logs are retained under the Hermes scratch directory on the workstation.

## Explicit limits and unfinished roadmap

Physical iPhone/iPad audibility, mute-switch behavior, Bluetooth routing, interruptions and long-session device performance remain unverified. Desktop WebKit is not an iPhone audio test.

Not shipped here: participant sound-check/readiness, personal monitoring UI, host-approved requests/conductor handoff, secure persistent recoverable rooms, undo/redo, sound-editor A/B comparison, adaptive-quality controls, shared cues/notes, setlists/next-song staging, or the confidence grid (its intended meaning still needs confirmation).

The original dirty Metronominal_Website checkout is preserved; this release was prepared in the separate Metronominal_Upgrades worktree from origin/main.

Production verification is performed after publication and reported separately; local test success alone is not a deployment claim.
