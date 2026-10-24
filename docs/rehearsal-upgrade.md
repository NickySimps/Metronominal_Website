# Rehearsal upgrade v191

## v191 layout and contextual editing

Precision now belongs to each track's existing Beat Edit mode, hides outside stopped host/solo editing, and directly opens the targeted editor after a tap or magnified release. The redundant Edit/Previous/Next strip is removed. Precision, adaptive visualization, Undo/Redo and personal monitoring now follow the current theme's palette/font and readable foreground tokens.

Wide layouts fit at least three existing tracks across, including touch landscape at 640 CSS px and above and desktop widths of 1024 CSS px and above. Narrow cards reflow their own controls using container queries rather than shrinking touch targets. Portrait phones remain stacked; very old browsers without container queries retain the safe older-density fallback.

Verification: 392 unique browser cases exercised across Chromium/Firefox/WebKit. After correcting outdated theme/layout assertions and fixtures, 390 unique cases pass; two native-CDP touch checks are explicitly Chromium-only and skipped on Firefox/WebKit. The initial source-frozen matrix passed 380, failed 10 harness/expectation cases and skipped two; the 34-case corrective run passed completely. Application source/snapshots remained unchanged across both runs. This is not a single aggregate green run. Six bootstrap/cache checks pass. Exact production build/assets and real live UI/audio checks are required separately before release is declared live.

## Historical v190 release evidence

## Current release evidence

Both final launch blockers are repaired: default-track capture now omits absent optional `undefined` fields consistently across repeated validation; Effects dialog focus/return is synchronous, and parent Escape respects the active child dialog rather than closing the wrong editor.

The application-source-frozen matrix exercised **441 cases**: **439 passed** and two test-harness assertions failed (advancing transport counters compared as immutable music; theme controls inspected before application readiness). Corrected those two test files and reran **all 54 cases in the affected files: 54 passed, zero failures/skips/flakes**. Programmatic case reconciliation clears all 441 unique cases, with application JS/CSS/HTML and snapshots unchanged across the runs. This is **two runs, not one aggregate 441-pass run**. Reports: `go-live-full.json`, `go-live-corrective.json`, `go-live-clearance.json`.

The matrix includes **126/126 typography cases** (42 per engine), **18/18 mounted Precision cases**, **45/45 library/default-capture cases**, and **3/3 frame-held nested Effects focus cases**, across Chromium/Firefox/WebKit. Backend **25/25** and bootstrap/cache **6/6** also pass. Preserve the existing native audio evidence below; physical iPhone feel/audibility/Bluetooth routing remain unverified.

Server-first release: `356170f28476892c058ee10684807fe9a27eaf87`; its production nonce-bound `room-scope-v2` handshake was verified before frontend publication. Frontend cache is `metronominal-v190`, including the audio lifetime module. Production acceptance requires the exact successful Pages build and source comparison, real isolated host/client Play/Stop/handoff/reconnect/cues, default capture, Precision/Effects focus, held native-render cancellation plus fresh playback, actual service-worker activation and no page errors. A push or HTTP 200 alone is not release proof.

## Historical v189 candidate notes — superseded, not current blockers


Status: **requested audio/text fixes complete and locally verified; not published**. The user clarified that the requested grid means phone-keyboard-like touch assistance for selecting tiny individual beats in crowded bars, with enlarged/finer targeting during slow movement—not numeric beat/measure counts and not participant diagnostics. Precision beat selection is implemented locally as a separate visible, device-local, opt-in control near the tracks, with 58 three-engine component/integration tests and 6 shell checks passing. Preview/release selects locally; editing remains an explicit guarded action. Normal gestures remain available when precision is off. Real iPhone feel is not yet verified; the engine cancellation fix is now verified as described below. Production deployment/verification has not occurred.

The delayed-render audio defect is fixed at the engine boundary with irreversible `AudioPlaybackLifetime` ownership and synchronous `cancelPlayback()`. Pending offline results are rejected before creating/starting a native source; existing voices and post-FX routes are cancelled without muting device-local monitoring or auditions. The parent reran the original independent adversarial script: room closure, authenticated replacement and queue overflow each produced **zero late native starts, zero uncancelled late sources and peak native output 0**, with no page errors. Repeated authenticated handoffs and legitimate new-authority Play also passed. The focused audio/room/sync suite passed 66 tests. Text wrapping corrections passed a final 30-case three-engine narrow/zoom-equivalent matrix after preserving Record-action width and the full-width Probability slider. The cache now includes the new audio lifetime module. The final frozen-source combined regression completed: **311 passed, zero failures/skips/flakes**, fresh report and unchanged source/test/snapshot manifest. The final parent typography matrix also passed 30/30 across Chromium, Firefox and WebKit; backend tests passed 25/25 and cache/bootstrap checks 6/6. Evidence: `final-fixes-verification.json`, `final-fixes-full.json`, `text-audit-parent-final.json`. These are separate verified runs, not an invented combined total. No deployment has occurred.

## Controls

Open **Rehearsal tools** for the device-local panels:

- **Readiness / confidence:** explicitly report ready, participant name, and measured software state. AudioContext/clock/RTT reports do not establish physical audibility, Bluetooth routing, or device volume. Legacy participants have unknown readiness.
- **Control requests / handoff:** participants request control; only the current authenticated host approves. Handoff is permitted only when authoritative transport is stopped, including completion of a previously scheduled Stop. No automatic host promotion.
- **Recovery:** reconnect, resynchronize, or restore the saved own-room identity. A capable room recovers its authoritative musical snapshot **stopped**; playback requires an explicit new action. Revoked credentials must not silently create replacement authority.
- **Undo / redo:** host or solo, stopped only. Bounded musical history excludes transport, device-local monitoring, theme, credentials, audio buffers and runtime nodes. Native text undo is preserved. Local song and preset loads participate in history; remote state/authority changes invalidate incompatible history.
- **Adaptive visualization:** Auto, Full, Reduced and Off are device-local oscilloscope rendering preferences. They do not change audio scheduling or routing. Auto measures rendering budget, honors reduced motion, and pauses drawing in hidden tabs. This is not a universal throttle for every renderer.
- **Cues:** bounded plain-text cues can be sent by the host; participants display server-authorized received cues. Automatic bar cues are opt-in and follow existing song-position events. Cues are currently associated with song names, so equal names share cues and renaming does not migrate them.
- **Setlists:** bounded, device-local versioned songs; explicit stopped-only loads, previous/next, rename/reorder/remove, import/export. Limits: 20 lists, 50 songs per list, 100 cues, 140 characters per cue, 2 MB library and 256 KB per song. Damaged or blocked storage is reported without erasing it. Imported/exported sound settings are rebuilt from supported musical parameters, not arbitrary nested metadata.

## Compatibility and privacy

The server advertises `rehearsal-v1`; an unadvertised server leaves room controls dormant. Legacy clients retain existing synchronization and are not falsely shown ready. Device-local visualization, theme and personal monitoring do not enter rehearsal payloads. Room credentials are not exposed in roster events, cues, export files or URLs.

## Unresolved release constraints

- Recovery remains in-process with a five-minute stopped-recovery window; it is **not durable recovery**. New scoped room identifiers expire after backend restart. Neither the old nor the rotated host credential may recreate an expired scoped room; a new room/link is required. Legacy rooms retain baseline synchronization but cannot hand off authority. These security changes passed the parent's 25-test backend rerun and are awaiting final independent review.
- Active/recovering-room capacity is separate from bounded closed history. A full tombstone set rotates the admission scope without evicting existing active/recovering rooms. Admission-churn, scope-rollover, restart-expiry and legacy-downgrade regressions pass in that backend run.
- Inbound state work is bound to authority at receipt; replacement immediately revokes joined eligibility. The client receive queue is bounded to 128 entries and overflow closes the connection rather than growing unbounded. The historical frozen v188 candidate passed **236 Chromium tests, with zero failures, skips or flakes**, and source fingerprints were unchanged during that run. This predates Precision selection and does not cover the subsequently reproduced pending-render audio defect; it is not a release clearance.
- The aggregate lifecycle test now asserts stopped recovery, a newer transport revision, preserved musical state, and successful explicit playback restart. It also checks stopped credential replacement, successful new-host restart, and continued old-host revocation. The focused Chromium lifecycle/native-audio run passed (2 tests).
- Real iPhone/Safari audio unlock, physical audibility, Bluetooth routing, interruptions and cross-network timing are not verified by desktop browser tests.

## Verification recorded locally

- Local feature browser regression: 49 passed (history 18, library 14, adaptive 8, existing visualizer 5, integrated mount 4).
- Shell/cache checks: 3 passed.
- Parent rerun of backend tests: 20 passed.
- Parent rerun of real-server room browser tests: 9 passed, isolated browser contexts.
- First aggregate Chromium run on a mutable candidate: 216 passed, 3 failed. Two test-harness defects were corrected and their focused reruns passed: connection-class substring matching and wall-clock animation sleeps. The stopped-recovery lifecycle expectation was subsequently reconciled and its focused run passed; no new full aggregate pass is claimed.
- First Firefox/WebKit feature run: Firefox 49 passed; WebKit 45 passed and 4 failed. Three WebKit failures were absent native Web Audio APIs on this Windows build; native assertions are now separately capability-gated only for that unsupported build. The targeted rerun passed 5 tests with 3 explicit native-audio skips. A real WebKit 320px library overflow was fixed with mobile block-label layout (no overflow hiding). The unchanged complete library suite passed 42/42 across Chromium, Firefox and WebKit; recorded WebKit document width is now 320px at a 320px viewport.
- Clock-skew confidence fix: 3 passed, including real-server browsers with +30s/-30s wall-clock skew and a controlled UI test for unknown, stale and implausibly future reports. Freshness now requires validated synchronized time.
- Independent room re-review verified the capacity/restart-expiry fixes against additional malformed scope/hello and legacy-downgrade probes, and confirmed the confidence time calculation. It still found two R3 release blockers: repeated authentic handoffs can let a queued stale grant restore incorrect client-side host identity, and immediate revocation/queue overflow can leave active playback running behind a held refresh. These two paths received a second focused repair: authority effects execute fully in receipt order, and revocation immediately cancels engine scheduling plus already-submitted sources. The implementer reports 20 room tests and 33 synchronization tests passing, including five new test-first regressions. Fresh parent full/cross-browser runs and independent adversarial re-review are in progress; this is not yet a cleared release. No backend host-authorization bypass was demonstrated by the stale-grant probe; the client-state/audio defects still block release.
- Frozen-candidate Firefox/WebKit local-feature regression completed: Firefox **50 passed**; WebKit **47 passed, 3 explicit unsupported-native-Web-Audio skips**; zero failures or flakes. Separate existing room/confidence checks also passed **36/36** (18 Firefox, 18 WebKit), without failures/skips/flakes. The newly discovered repeated-handoff and active-revocation cases are not covered by that older run; the R3 repair still requires final regression/review.

These counts are separate runs, not one aggregate release pass. No deployment or production verification has occurred for this candidate.
