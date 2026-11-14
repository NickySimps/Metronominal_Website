import { VoicePitchDetector } from './voicePitchDetector.js';
import { VoiceNoteTracker } from './voiceNoteTracker.js';

/** One-shot, foreground-only device-local analysis branch. The outer owner must
 * supply a running AudioContext and its already acquired source; this class
 * never requests a device, resumes/closes the context, stops a track or connects
 * to destination. No worklet/CDN/network/storage or music-state writes.
 *
 * start() returns this; done resolves a detached result. stop() flushes notes;
 * cancel() discards them. Both are synchronous/idempotent. Times are absolute
 * AudioContext seconds, observations at window END times (never wall clock).
 * End timestamps stay monotonic when the analysis window switches size. A timer
 * samples latest windows (not a lossless recording); scheduler gaps may lose
 * notes. Limits are <=300 seconds/2048 notes/60000 observations;
 * power-of-two frames cover >=75ms, up to 8192 samples (8..96kHz only).
 * cadence=20ms (at most 50 polls/second). Stable callbacks receive
 * {midi,startTime} or null, not PCM.
 * onComplete(result) is called once, synchronously after cleanup; done resolves
 * {status:'stopped'|'cancelled'|'failed', reason, startTime, endTime, notes,
 * error:string|null, cleanupErrors:string[]}. Notes use tracker absolute times.
 * Callbacks are synchronous. Consumer exceptions are reported as failures.
 * Setup failures both throw from start() and resolve done with failed status.
 *
 * Hidden/pagehide, context interruption and source mute/end cancel (discard),
 * never auto-resume. Manual/deadline/tracker-limit stops flush completed notes.
 * An analysis-only branch cannot prevent an outer owner routing audio elsewhere.
 * PCM is transient scratch, zeroed after each observation and on all exits.
 * Timers cannot run during a blocked/frozen JS thread: no samples are accepted
 * after the audio deadline, and cleanup occurs at the next available task.
 * Analyser timing is approximate (render quantum/device pipeline latency is
 * not compensated). Shorter-than-frame captures can legitimately yield no notes.
 * Pitches >=180Hz compare the newest quarter-window with the preceding
 * disjoint quarter (~21..23ms each at 44.1/48/96kHz), preferring periodicity.
 * A clean preceding quarter can retain a short-note tail after a delayed poll
 * without fitting a shared subharmonic across a long mixed transition window.
 * Below 180Hz or when the newest quarter is unvoiced, use the full window.
 * At most two detector calls/poll. Window scores are not independent evidence
 * or calibrated probabilities; selected older evidence may delay boundaries.
 * Transitions can smear, short low notes can vanish,
 * and timer delays can miss even an 80ms note. No universal minimum is promised.
 * The detector's box decimation is not a full anti-alias filter; harmonics,
 * high-frequency aliases and mixed/transient windows can produce wrong notes.
 * 192kHz is rejected: the detector's 8192-sample limit cannot retain its full
 * nominal 60..1400Hz range there. Physical devices remain untested.
 */
export class VoiceCaptureSession {
  constructor({ context, source, maxDurationSeconds = 30, maxNotes = 2048,
    maxObservations = 60000, onStableNote = () => {}, onComplete = () => {} } = {}) {
    this.context = context;
    this.source = source;
    this.maxDurationSeconds = maxDurationSeconds;
    this.tracker = new VoiceNoteTracker({ maxDurationSeconds, maxNotes, maxObservations });
    this.detector = new VoicePitchDetector();
    this.onStableNote = onStableNote;
    this.onComplete = onComplete;
    this.state = 'idle';
    this.generation = 0;
    this.notes = [];
    this.listeners = [];
    this.done = new Promise(resolve => { this.resolve = resolve; });
  }

  start() {
    if (this.state !== 'idle') throw new Error('Voice capture sessions are single-use');
    this.state = 'capturing';
    const generation = ++this.generation;
    try {
      if (!this.context || this.source?.context !== this.context || this.context.state !== 'running') throw new Error('A running shared AudioContext and its source are required');
      if (!Number.isFinite(this.context.sampleRate) || this.context.sampleRate < 8000 || this.context.sampleRate > 96000) throw new Error('Unsupported sample rate (8000..96000 Hz required for the full detector range)');
      if (typeof this.context.createAnalyser !== 'function' || typeof globalThis.setInterval !== 'function') throw new Error('Web Audio analyser/timer API unavailable');
      if (globalThis.document?.visibilityState === 'hidden') throw new Error('Foreground document required');
      const listen = (target, event, callback) => {
        if (typeof target?.addEventListener !== 'function') throw new Error('Lifecycle event API unavailable');
        target.addEventListener(event, callback);
        this.listeners.push(() => target.removeEventListener(event, callback));
      };
      const cancel = reason => { if (this.generation === generation) this.finish('cancelled', reason); };
      listen(document, 'visibilitychange', () => { if (document.visibilityState !== 'visible') cancel('hidden'); });
      listen(globalThis, 'pagehide', () => cancel('pagehide'));
      listen(this.context, 'statechange', () => { if (this.context.state !== 'running') cancel('audio-interrupted'); });
      for (const track of this.source.mediaStream?.getAudioTracks() ?? []) {
        if (track.readyState !== 'live' || track.muted) throw new Error('Source audio track is unavailable');
        listen(track, 'ended', () => cancel('source-ended'));
        listen(track, 'mute', () => cancel('source-muted'));
      }
      this.startTime = this.context.currentTime;
      this.deadline = this.startTime + this.maxDurationSeconds;
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 2 ** Math.ceil(Math.log2(this.context.sampleRate * 0.075));
      if (typeof this.analyser.getFloatTimeDomainData !== 'function') throw new Error('Float time-domain analyser API unavailable');
      this.frame = new Float32Array(this.analyser.fftSize);
      this.source.connect(this.analyser);
      this.connected = true;
      this.interval = setInterval(() => { if (this.generation === generation) this.sample(); }, 20);
      this.timeout = setTimeout(() => { if (this.generation === generation) this.finish('stopped', 'duration-limit'); }, this.maxDurationSeconds * 1000);
      return this;
    } catch (error) {
      this.finish('failed', 'setup-error', error);
      throw error;
    }
  }

  sample() {
    if (this.state !== 'capturing') return;
    try {
      if (this.context.state !== 'running') { this.finish('cancelled', 'audio-interrupted'); return; }
      if (document.visibilityState !== 'visible') { this.finish('cancelled', 'hidden'); return; }
      if ((this.source.mediaStream?.getAudioTracks() ?? []).some(track => track.readyState !== 'live' || track.muted)) {
        this.finish('cancelled', 'source-unavailable'); return;
      }
      const now = this.context.currentTime;
      if (now >= this.deadline) { this.finish('stopped', 'duration-limit'); return; }
      if (now - this.startTime < this.frame.length / this.context.sampleRate) return;
      // Audio clocks can repeat across timer callbacks. The tracker would
      // discard this timestamp anyway; do not read/detect the same window twice.
      if (this.tracker.lastTime !== null && now <= this.tracker.lastTime) return;
      const time = now;
      this.analyser.getFloatTimeDomainData(this.frame);
      // Compare two disjoint short windows in the newest half of the frame.
      // A longer mixed window can fit a shared subharmonic of two pitches;
      // always choosing only the newest window instead loses short-note tails
      // after a delayed poll. Keep low/unvoiced full-frame fallback and the
      // unchanged tracker hold, at most TWO detector calls per poll.
      let observation = this.detector.detect(this.frame.subarray(this.frame.length * 3 / 4), this.context.sampleRate);
      if (observation.voiced && observation.frequencyHz >= 180) {
        const recent = observation;
        observation = this.detector.detect(this.frame.subarray(this.frame.length / 2, this.frame.length * 3 / 4), this.context.sampleRate);
        // Either quarter can win: newest at onset, preceding at the tail.
        // Periodicity is NOT probability or independent proof.
        if (!observation.voiced || recent.confidence >= observation.confidence) observation = recent;
      } else if (!observation.voiced || observation.frequencyHz < 180) {
        observation = this.detector.detect(this.frame, this.context.sampleRate);
      }
      this.frame.fill(0);
      this.notes.push(...this.tracker.push({ ...observation, time }));
      const active = this.tracker.active;
      const key = active ? `${active.midi}:${active.startTime}` : null;
      if (key !== (this.stableKey ?? null)) {
        this.stableKey = key;
        this.onStableNote(active ? { ...active } : null);
      }
      if (this.tracker.stopped) this.finish('stopped', 'tracker-limit');
    } catch (error) { this.finish('failed', 'analysis-error', error); }
  }

  stop() { return this.finish('stopped', 'manual'); }
  cancel() { return this.finish('cancelled', 'cancelled'); }

  finish(status, reason, error = null) {
    if (this.result) return this.snapshot();
    this.state = status;
    ++this.generation;
    clearInterval(this.interval);
    clearTimeout(this.timeout);
    const cleanupErrors = [];
    const release = action => {
      try { action(); } catch (cleanupError) { cleanupErrors.push(String(cleanupError.message ?? cleanupError)); }
    };
    for (const remove of this.listeners.splice(0)) release(remove);
    if (this.connected) {
      release(() => {
        try { this.source.disconnect(this.analyser); }
        catch (disconnectError) {
          // Outer ownership may already have disconnected this exact branch.
          if (disconnectError.name !== 'InvalidAccessError') throw disconnectError;
        }
      });
      this.connected = false;
    }
    release(() => this.analyser?.disconnect());
    this.frame?.fill(0);
    this.frame = null;
    this.analyser = null;
    const time = Math.max(this.startTime ?? 0, Math.min(this.context?.currentTime ?? 0, this.deadline ?? 0));
    if (status === 'stopped') this.notes.push(...this.tracker.stop(time));
    else this.notes = [];
    this.result = { status, reason, startTime: this.startTime ?? null, endTime: time,
      notes: this.notes.map(note => ({ ...note })), error: error ? String(error.message ?? error) : null,
      cleanupErrors };
    this.notes = [];
    try { this.onComplete(this.snapshot()); }
    catch (callbackError) {
      this.state = 'failed';
      this.result = { ...this.result, status: 'failed', reason: 'callback-error', error: String(callbackError.message ?? callbackError) };
    }
    this.resolve(this.snapshot());
    return this.snapshot();
  }

  snapshot() {
    return { ...this.result, notes: this.result.notes.map(note => ({ ...note })), cleanupErrors: [...this.result.cleanupErrors] };
  }
}
