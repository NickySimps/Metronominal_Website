/** Map Hz to nearest MIDI note; reject frequencies outside the MIDI domain. */
export function frequencyToMidi(frequencyHz) {
  if (!Number.isFinite(frequencyHz) || frequencyHz <= 0) return null;
  const value = 69 + 12 * Math.log2(frequencyHz / 440);
  if (value < -1e-9 || value > 127 + 1e-9) return null;
  return Math.max(0, Math.min(127, Math.round(value)));
}

/** Timestamped local monophonic segmentation. Times are monotonic seconds,
 * supplied by the audio clock, NOT animation-frame count or wall-clock Date.
 * push({time, voiced, frequencyHz, confidence, rms}) returns completed notes;
 * stop(time) flushes once and permanently closes this instance.
 * Notes: {midi, startTime, endTime, duration}. No PCM or note history is stored.
 * Onsets/offsets are observation boundaries, not sub-frame acoustic estimates.
 * Assign time to the represented PCM window (e.g. its center), consistently;
 * this model cannot undo window latency or infer missing audio boundaries.
 * Fixed policy: 30 ms onset confirmation/minimum duration, 25 ms change hold,
 * so 20ms polling jitter/render-quantum rounding does not require 60ms of
 * stable observations. Single/alternating 20ms outliers still cannot confirm.
 * +/-0.7-semitone hysteresis. A change >=2 semitones may use one mixed
 * observation within +/-0.85 semitones ONLY after two +/-0.2-semitone
 * anchors >=15ms apart, with the latest <=25ms old. This is correlated,
 * bounded uncertainty support, not a shorter hold or independent proof:
 * a transient producing the same evidence can still be accepted as a note.
 * 60 ms silence release, confidence >=0.85, AC RMS >=0.008.
 * Dropouts shorter than release may merge articulations.
 * A >250 ms observation gap ends at the previous observation, never bridges.
 * Unconfirmed final candidates are discarded. stop accepts equal last time;
 * push ignores duplicate/backward/invalid times; invalid pitch means silence.
 * Limits (configurable DOWN only): maxDurationSeconds=300, maxNotes=2048,
 * maxObservations=60000. Caps close the tracker; inspect stopped after push.
 * Duration is enforced on push/stop, not by a timer: capture owners must also
 * stop their microphone/timers. Storage and per-observation work are O(1).
 * This is segmentation, not voice/instrument recognition or real-device proof.
 */
export class VoiceNoteTracker {
  constructor({ maxDurationSeconds = 300, maxNotes = 2048, maxObservations = 60000 } = {}) {
    if (!Number.isFinite(maxDurationSeconds) || maxDurationSeconds <= 0 || maxDurationSeconds > 300 ||
        !Number.isInteger(maxNotes) || maxNotes < 1 || maxNotes > 2048 ||
        !Number.isInteger(maxObservations) || maxObservations < 1 || maxObservations > 60000) {
      throw new RangeError('Limits must be positive and no greater than 300 seconds, 2048 notes, 60000 observations');
    }
    this.maxDurationSeconds = maxDurationSeconds;
    this.maxNotes = maxNotes;
    this.maxObservations = maxObservations;
    this.observationCount = 0;
    this.noteCount = 0;
    this.startTime = null;
    this.lastTime = null;
    this.pending = null;
    this.active = null;
    this.silenceTime = null;
    this.stopped = false;
  }

  push(observation) {
    if (this.stopped || !observation || !Number.isFinite(observation.time) || observation.time < 0 ||
        (this.lastTime !== null && observation.time <= this.lastTime)) return [];
    const time = observation.time;
    this.startTime ??= time;
    const deadline = this.startTime + this.maxDurationSeconds;
    if (time >= deadline - 1e-9) return this.stop(deadline);
    this.observationCount++;
    if (this.observationCount >= this.maxObservations) return this.stop(time);
    const completed = [];
    if (this.lastTime !== null && time - this.lastTime > 0.25) {
      completed.push(...this.#finish(this.silenceTime ?? this.lastTime));
    } else if (this.silenceTime !== null && time - this.silenceTime >= 0.06 - 1e-9) {
      completed.push(...this.#finish(this.silenceTime));
    }
    this.lastTime = time;
    if (this.stopped) return completed;
    const midi = observation.voiced === true && Number.isFinite(observation.confidence) &&
      observation.confidence >= 0.85 && observation.confidence <= 1 &&
      Number.isFinite(observation.rms) && observation.rms >= 0.008 && observation.rms <= 1
      ? frequencyToMidi(observation.frequencyHz) : null;
    if (midi === null) {
      this.pending = null;
      if (this.active && this.silenceTime === null) this.silenceTime = time;
      return completed;
    }
    this.silenceTime = null;
    const continuousMidi = 69 + 12 * Math.log2(observation.frequencyHz / 440);
    if (this.active && Math.abs(continuousMidi - this.active.midi) <= 0.7) {
      this.pending = null;
      return completed;
    }
    // A transition window can drift just outside hysteresis before the hold
    // elapses. Only two precise, separated anchors can support ONE such window;
    // it cannot seed a pitch or confirm adjacent-note vibrato. Keep the normal
    // hold (and isolated/alternating-outlier rejection), not a two-poll shortcut.
    const pending = this.pending;
    const mixedSupport = this.active && pending && pending.anchors >= 2 &&
      pending.lastAnchorTime - pending.firstAnchorTime >= 0.015 - 1e-9 &&
      time - pending.lastAnchorTime <= 0.025 + 1e-9 &&
      time - pending.startTime >= 0.025 - 1e-9 &&
      Math.abs(pending.midi - this.active.midi) >= 2 &&
      Math.abs(continuousMidi - pending.midi) <= 0.85;
    if (!pending || (Math.abs(continuousMidi - pending.midi) > 0.7 && !mixedSupport)) {
      this.pending = { midi, startTime: time, anchors: 0, firstAnchorTime: time, lastAnchorTime: time };
    }
    if (Math.abs(continuousMidi - this.pending.midi) <= 0.2) {
      if (!this.pending.anchors) this.pending.firstAnchorTime = time;
      this.pending.anchors++;
      this.pending.lastAnchorTime = time;
    }
    const hold = this.active ? 0.025 : 0.03;
    if (time - this.pending.startTime < hold - 1e-9) return completed;
    const next = { midi: this.pending.midi, startTime: this.pending.startTime };
    if (this.active) completed.push(...this.#finish(next.startTime));
    if (!this.stopped) this.active = next;
    this.pending = null;
    return completed;
  }

  #finish(time) {
    const note = this.active;
    this.active = null;
    this.pending = null;
    this.silenceTime = null;
    if (!note || time - note.startTime < 0.03 - 1e-9) return [];
    this.noteCount++;
    if (this.noteCount >= this.maxNotes) this.stopped = true;
    return [{ ...note, endTime: time, duration: time - note.startTime }];
  }

  stop(time) {
    if (this.stopped || !Number.isFinite(time) || time < 0 || (this.lastTime !== null && time < this.lastTime)) return [];
    const deadline = this.startTime === null ? time : this.startTime + this.maxDurationSeconds;
    const cutoff = Math.min(time, deadline);
    const endTime = this.silenceTime ?? (this.lastTime !== null && cutoff - this.lastTime > 0.25 ? this.lastTime : cutoff);
    this.stopped = true;
    this.lastTime = time;
    return this.#finish(endTime);
  }
}
