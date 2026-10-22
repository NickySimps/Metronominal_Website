# Personal monitoring upgrade — October 22, 2026

This increment follows sound-editor release `56771bb`.

## Delivered behavior

- A collapsed **My sound** panel separates personal listening controls from the host's shared volume, track settings and transport.
- Device listening level and **Mute my sound** affect browser audio only on this device. Their versioned preference persists locally; malformed/unavailable storage falls back safely without disabling the controls.
- Per-track listening levels/mutes are session-local. They survive same-layout authoritative replays, but reset when track names/count change, the room changes, or the page reloads. The current track model has no durable IDs, so the UI explicitly explains this limitation rather than silently transferring a muted slot to a different layout.
- Live synth/sample playback, count-in, recording/sample-manager previews, sound-picker previews and sound-editor A/B auditions route through the local output bus. Track-specific auditions also use the corresponding track listening bus.
- Output changes apply to already-playing/scheduled browser audio with a 5 ms gain-smoothing time constant; they do not start, stop or reschedule the authoritative transport. Host-side mute/solo/shared volume processing remains upstream. MIDI transport is unchanged.
- One live output bus is reused per AudioContext, with one bus per current track slot. Removed slots disconnect; surviving track analysers reconnect after a position shift; closed contexts release their buses. Effect-render caches remain separate and unchanged.
- The panel uses native keyboard-operable disclosure, labelled sliders, explicit mute states, readable theme tokens and narrow-screen stacking. Numeric `100%` values remain on one line at 320px/390px.
- Service-worker cache advances to **v187** and precaches both monitoring modules. No server/protocol/schema change or new dependency is required.

## Verification

- Full Chromium suite: **168 passed, 0 failed, 0 skipped**.
- Firefox/WebKit selection: **109 passed, 0 failed, 19 explicitly skipped** because this Windows WebKit build lacks the native audio APIs those checks require. Skips are not audio passes.
- Signaling server suite: **13 passed, 0 failed**. Server source is unchanged.
- Thirteen focused monitoring checks cover local persistence, live native master/track attenuation, scheduled count-in suppression, audition routing, host/client isolation and transport authority, room rotation, twenty same-layout replays/bus identity, track removal, blocked/malformed preferences, bounded numeric API inputs, defensive state copies, keyboard/mobile geometry and every selectable theme's label/mute-state contrast.
- Native output tests instrument the actual AudioNode connections to the AudioContext destination and read real analyser samples. The ten-second constant sample is explicitly generated test input, filled before assignment for Firefox; output measurements are not fabricated API responses.
- Browser `pageerror` collections are asserted empty, including both peers in the shared-room test. Personal controls emit no shared-state or transport-command messages and leave musical snapshots unchanged.
- Screenshots were visually reviewed at both mobile widths; a wrapped percentage found during review received a failing single-line regression before the CSS correction.
- The first long full-suite command was interrupted by the execution limit and was not counted. A tracked background rerun completed with exit code zero and fresh 168-test results.
- Syntax/whitespace checks pass; dependency audit reports zero vulnerabilities.

Post-publication production results are recorded with the release verification. Physical iPhone speaker/headphone audibility, Bluetooth routing and interruption recovery remain unverified by these desktop checks.

The other roadmap items, including readiness, handoff/control requests, room recovery, undo/redo, adaptive visualization, cues, setlists and the confidence grid, remain pending.
