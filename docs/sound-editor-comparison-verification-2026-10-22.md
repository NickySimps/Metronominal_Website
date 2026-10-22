# Sound-editor comparison upgrade — October 22, 2026

This increment follows stabilization release 8d159cb.

## Delivered behavior

- **A · Original** auditions a local snapshot taken when the editor opens; **B · Edited** auditions the current edited settings. Switching auditions does not revert edits or publish the selection to the room.
- The original snapshot survives the editor's Reset/rebuild actions during that editing session. Closing releases the snapshot; reopening captures a fresh original. Track/main/subdivision/beat targets have separate snapshot identity.
- Beat-specific auditions now resolve the beat's sound rather than silently using the track's default sound.
- Switching A/B while a preview is active restarts the audition with the selected version. Old ended callbacks and pending offline-render completions cannot stop or start a newer audition.
- Closing, Stop, or a target change cancels pending previews and disconnects the audition source, analyser and output gain. Preview gain includes the current master and track volume at the time the audition starts.
- The **Advanced controls** disclosure can hide additional synth/trim/behavior settings without destroying their values. The choice is device-local and persists across reloads. The existing all-controls view remains the default for compatibility.
- Older cached HTML shells lacking the new buttons still initialize successfully and retain all controls, even if the stored preference is Basic.
- Service-worker cache advances to **v186**. No server/schema change is required.

## Verification before deployment

- Full Chromium suite: **155 passed, 0 failed, 0 skipped**.
- Firefox/WebKit selection: **87 passed, 0 failed, 15 explicitly skipped** because the Windows WebKit build does not expose the native audio APIs required for those tests. These skips are not audio passes.
- Ten new focused tests exercise A/B model preservation, real native sample pitch and analyser output, master/track gain, old ended events, beat overrides, session Reset/reopen semantics, held-render cancellation, client isolation, both 320px/390px Synthwave layouts, cached-shell compatibility, and local disclosure persistence.
- The test sample is an explicitly generated two-second sine fixture; assertions inspect real AudioBufferSourceNode playbackRate, native analyser data and native GainNode values rather than substituting synthetic API results.
- Real-WebSocket host/client tests observe outgoing shared-message types and verify that auditions/preferences leave both peers' musical state unchanged. No host credentials are included in these assertions or reports.
- Mobile screenshots were visually inspected. Keyboard tests explicitly focus controls before native Enter activation; mouse clicks do not necessarily focus buttons in every engine.
- Syntax and whitespace checks pass. Server source is unchanged.

Production checks are run after publication and reported separately. Physical iPhone audibility remains unverified; desktop WebKit does not establish that result.

Other roadmap items remain pending, including participant readiness, personal monitoring controls, cooperative authority requests, persistent rooms, undo/redo, adaptive visualization, shared cues, setlists and the confidence grid.
