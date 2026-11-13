import { validateMelody, TICKS_PER_MAIN_BEAT } from './melodySchema.js';
import { scheduleMelodyVoice } from './melodyVoice.js';
import AudioPlaybackLifetime from './audioPlaybackLifetime.js';


const prepared = new WeakSet();
const waves = Object.freeze({ 'Synth Sine': 'sine', 'Synth Triangle': 'triangle', 'Synth Square': 'square', 'Synth Sawtooth': 'sawtooth' });
function finite(value, min, max, name) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new TypeError(`Invalid melody scheduler ${name}`);
    return value;
}
function validAuthority(value, mapped = false) {
    return value && (typeof value.generation === 'string' && value.generation.length > 0 || Number.isSafeInteger(value.generation)) &&
        value.playing === true && (value.practice === 'constant' || mapped && value.practice === 'mapped') && Number.isFinite(value.tempo) && value.tempo >= 1 && value.tempo <= 1000;
}

/**
 * Synchronous preparation only: supply an already decoded native buffer for a
 * recording, with an explicit root. No fetching, decoding or inferred roots.
 * The four existing elementary Synth names map to their actual waveforms, NOT
 * legacy SoundSynth ADSR/effects. Other Synth instruments are unsupported (never
 * replaced by sine). Only volume, pitchShift and release settings are supported;
 * callers must prepare any FX/trim/reverse themselves and supply a clean sound.
 */
export function prepareMelodyInstrument({ sound, buffer, rootMidi } = {}) {
    if (!sound || typeof sound.sound !== 'string' || !sound.sound) throw new TypeError('Melody instrument sound required');
    const settings = sound.settings ?? {};
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new TypeError('Invalid melody instrument settings');
    for (const key of Object.keys(settings)) if (!['volume', 'pitchShift', 'release'].includes(key)) throw new TypeError(`Unsupported melody instrument setting: ${key}`);
    const volume = finite(settings.volume ?? 1, 0, 1, 'volume');
    const cents = finite(settings.pitchShift ?? 0, -12, 12, 'pitchShift') * 100;
    const release = finite(settings.release ?? 0, 0, 60, 'release');
    let result;
    if (Object.hasOwn(waves, sound.sound)) result = { kind: 'oscillator', waveform: waves[sound.sound] };
    else {
        if (sound.sound.startsWith('Synth')) throw new TypeError(`Unsupported melody instrument: ${sound.sound}`);
        if (!(buffer instanceof AudioBuffer)) throw new TypeError('Prepare a native sample AudioBuffer before scheduling');
        if (!Number.isInteger(rootMidi) || rootMidi < 0 || rootMidi > 127) throw new TypeError('Explicit sample rootMidi required');
        result = { kind: 'sample', buffer, rootMidi };
    }
    result = Object.freeze({ ...result, soundName: sound.sound, settingsKey: JSON.stringify(settings), volume, cents, release });
    prepared.add(result);
    return result;
}

/** Engine-only pitched adapter: retain the existing waveform, ADSR and filter
 * rack. MIDI replaces the instrument's reference frequency; pitchShift remains
 * a semitone transposition. Percussive/multioscillator Synths and behavioral
 * settings not implemented here are refused, never substituted. */
export function prepareEngineMelodyInstrument({ sound, buffer, rootMidi, filterInput } = {}) {
    if (!sound || typeof sound.sound !== 'string') throw new TypeError('Melody instrument sound required');
    const settings = sound.settings ?? {};
    const synth = Object.hasOwn(waves, sound.sound);
    const allowed = ['volume', 'pitchShift', 'release', 'highPassFrequency', 'lowPassFrequency', 'fxBypass'];
    if (synth) allowed.push('attack', 'decay', 'sustain', 'frequency');
    const inactive = { reverse: false, retrigger: true, allowOverlap: true, probability: 100,
        distortion: 0, delayMix: 0, reverbMix: 0, trimStart: 0 };
    for (const key of Object.keys(settings)) {
        if (allowed.includes(key)) continue;
        if (Object.hasOwn(inactive, key) && settings[key] === inactive[key]) continue;
        throw new TypeError(`Unsupported melody instrument setting: ${key}`);
    }
    for (const key of ['highPassFrequency', 'lowPassFrequency']) if (Object.hasOwn(settings, key)) finite(settings[key], 20, 24000, key);
    if (Object.hasOwn(settings, 'frequency')) finite(settings.frequency, 1, 24000, 'reference frequency');
    if (Object.hasOwn(settings, 'fxBypass') && typeof settings.fxBypass !== 'boolean') throw new TypeError('Invalid melody fxBypass');
    const triangle = sound.sound === 'Synth Triangle';
    const envelope = synth ? Object.freeze({ attack: finite(settings.attack ?? .01, 0, 60, 'attack'),
        decay: finite(settings.decay ?? (triangle ? .2 : .1), 0, 60, 'decay'),
        sustain: finite(settings.sustain ?? (triangle ? .1 : .5), 0, 1, 'sustain') }) : null;
    const base = prepareMelodyInstrument({ sound: { sound: sound.sound, settings: {
        volume: settings.volume ?? 1, pitchShift: settings.pitchShift ?? 0,
        release: settings.release ?? (synth ? .2 : 0) } }, buffer, rootMidi });
    const result = Object.freeze({ ...base, settingsKey: JSON.stringify(settings), envelope,
        filterInput, filterSettings: Object.freeze({ ...settings }) });
    prepared.add(result);
    return result;
}

/**
 * Standalone single-pass cursor; no timers or transport ownership. Constant
 * tempo is the default; the engine supplies its analytic timeAtTick mapping.
 * Legacy absence returns null. Once melody is present, even empty/invalid/muted,
 * caller MUST NOT fall through to rhythm. Invalid construction throws.
 *
 * Integration contract (used by metronomeEngine): the authoritative
 * scheduler must merge nextEventTime with track slots and pending seams, and call
 * advance with its exclusive native audio horizon AFTER applying earlier seams.
 * originTick/endTick are unwrapped main-beat ticks of this one track traversal;
 * originTime already includes the authoritative local output correction. endTick
 * is a hard, immutable authority lease: note gates AND releases are clipped there.
 * Never promise past a queued song/tempo/practice/stop seam; if no safe lease is
 * known, do not construct. Loops, seeks, corrections, edits and every transport
 * change require cancel + a new cursor/anchor/generation. No guessed continuation.
 *
 * Pass the engine's actual lifetime and its existing track destination. Cancel
 * this cursor synchronously at boundaries; cancelling the shared lifetime also
 * silences its voices. Re-check authority on EVERY advance, including empty
 * horizons; this module cannot observe private engine authority on its own.
 * Nonconstant practice and swing require an explicit timeAtTick mapping and
 * mapped authority; the engine additionally owns audible gates and count-in.
 * Without a mapping, callers must refuse those modes, never label them constant.
 */
export function createMelodyCursor({ track, instrument, context, destination, lifetime, authority,
    originTick, originTime, endTick, timeAtTick } = {}) {
    if (track && !('melody' in track)) return null;
    if (!track) throw new TypeError('Melody track required');
    const selection = Object.getOwnPropertyDescriptor(track, 'melody');
    if (!selection || !selection.enumerable || !Object.hasOwn(selection, 'value')) throw new TypeError('Invalid melody selection property');
    if (!prepared.has(instrument)) throw new TypeError('Prepare melody instrument first');
    if (!(context instanceof BaseAudioContext) || context.state === 'closed' ||
        !(destination instanceof AudioNode) || destination.context !== context ||
        !(lifetime instanceof AudioPlaybackLifetime) || !lifetime.active) throw new TypeError('Active native playback lifetime/context/destination required');
    if (!validAuthority(authority, typeof timeAtTick === 'function')) throw new TypeError('Constant or mapped playing authority required');
    if (track.swing && typeof timeAtTick !== 'function') throw new TypeError('Melody swing requires a mapped transport');
    if (track.mainBeatSound?.sound !== instrument.soundName || JSON.stringify(track.mainBeatSound.settings ?? {}) !== instrument.settingsKey) throw new TypeError('Prepared instrument does not match track');
    const melody = validateMelody(track.melody, track.barSettings, { requireSampleRoot: instrument.kind === 'sample' });
    if (instrument.kind === 'sample' && melody.sampleRootMidi !== instrument.rootMidi) throw new TypeError('Prepared sample root does not match melody');
    const cents = finite(instrument.cents + finite(track.pitchShift ?? 0, -12, 12, 'track pitchShift') * 100, -1200, 1200, 'combined pitchShift');
    const volume = finite(track.volume ?? 1, 0, 1, 'track volume') * instrument.volume;
    const totalTicks = track.barSettings.reduce((sum, bar) => sum + bar.beats * TICKS_PER_MAIN_BEAT, 0);
    if (!Number.isSafeInteger(originTick) || !Number.isSafeInteger(endTick) || originTick < 0 || endTick <= originTick || endTick > totalTicks) throw new TypeError('Invalid melody tick lease');
    finite(originTime, context.currentTime, context.currentTime + 3600, 'originTime');
    const secondsPerTick = 60 / authority.tempo / TICKS_PER_MAIN_BEAT;
    const timeAt = tick => timeAtTick ? finite(timeAtTick(tick), 0, context.currentTime + 3600, 'mapped time') : originTime + (tick - originTick) * secondsPerTick;
    const endTime = timeAt(endTick), events = [];
    let offset = 0;
    melody.bars.forEach((bar, index) => {
        for (const note of bar) {
            const tick = offset + note.startTick;
            if (tick < originTick || tick >= endTick) continue;
            events.push({ ...note, tick, time: timeAt(tick), gate: timeAt(Math.min(endTick, tick + note.durationTicks)) });
        }
        offset += track.barSettings[index].beats * TICKS_PER_MAIN_BEAT;
    });
    // Canonical bars already sort chords by tick, pitch and stable ID.
    for (const event of events) {
        const shifted = event.midi + cents / 100;
        if (instrument.kind === 'oscillator') finite(440 * 2 ** ((shifted - 69) / 12), 0, Math.min(20000, context.sampleRate / 2), 'frequency');
        else finite(2 ** ((shifted - instrument.rootMidi) / 12), 1 / 256, 256, 'sample playbackRate');
        finite(event.gate - event.time, Number.MIN_VALUE, 600, 'duration');
    }
    // No AppState mutation/revision subscription is available to this standalone
    // module. Fence even legacy shallow edits at each scheduler call. The engine
    // integration should additionally cancel synchronously on replacement/edits.
    const fingerprint = () => JSON.stringify([track.melody, track.barSettings.map(bar => bar.beats),
        track.mainBeatSound, track.pitchShift, track.volume, track.swing]);
    const originalTrack = fingerprint();
    const token = { ...authority };
    let index = 0, horizon = -Infinity, status = 'active';
    const owned = new Map();
    // Lazily allocate the cursor-owned branch only after all validation.
    let branch = null, voiceDestination = null;
    function disconnect() {
        for (const destination of new Set([branch, voiceDestination])) {
            const route = lifetime.routes.get(destination);
            if (route) { route.disconnect(); lifetime.routes.delete(destination); }
        }
        branch?.disconnect();
        if (voiceDestination !== branch) voiceDestination?.disconnect();
    }
    function cancel(reason = 'cancelled', atTime = context.currentTime) {
        if (status !== 'active') return;
        status = reason;
        if (atTime > context.currentTime) {
            branch?.gain.cancelScheduledValues(atTime);
            branch?.gain.setValueAtTime(0, atTime);
            for (const [source, voice] of owned) source.stop(Math.min(atTime, voice.endTime));
            if (!owned.size) disconnect();
            return;
        }
        disconnect();
        for (const source of owned.keys()) {
            try { source.stop(); } catch { /* Native source already ended. */ }
            lifetime.sources.get(source)?.();
        }
        owned.clear();
    }
    const result = noteIds => ({ selected: true, rhythmAllowed: false, status, noteIds });
    return Object.freeze({
        get nextEventTime() { return status === 'active' && lifetime.active && index < events.length ? events[index].time : Infinity; },
        get status() { return status; },
        endTime,
        cancel,
        advance({ horizonTime, authority: current, audible = true } = {}) {
            if (status !== 'active') return result([]);
            if (!lifetime.active) { cancel('cancelled'); return result([]); }
            try {
                if (fingerprint() !== originalTrack) { cancel('track-changed'); return result([]); }
            } catch { cancel('track-changed'); return result([]); }
            if (!validAuthority(current, typeof timeAtTick === 'function') || current.practice !== token.practice || current.generation !== token.generation || current.tempo !== token.tempo) { cancel('authority-changed'); return result([]); }
            if (!Number.isFinite(horizonTime) || horizonTime < horizon || typeof audible !== 'boolean') { cancel('invalid-window'); return result([]); }
            horizon = horizonTime;
            if (track.muted || !audible) { cancel('muted'); return result([]); }
            const noteIds = [];
            while (index < events.length && events[index].time < Math.min(horizonTime, endTime)) {
                const event = events[index++];
                // Missed onsets are dropped, never clamped into a catch-up burst.
                if (event.time < context.currentTime || event.velocity === 0 || volume === 0) continue;
                if (!branch) {
                    branch = context.createGain(); branch.connect(destination);
                    branch.gain.setValueAtTime(0, endTime);
                    voiceDestination = instrument.filterInput
                        ? instrument.filterInput(context, lifetime.output(context, branch), { ...instrument.filterSettings }) : branch;
                }
                try {
                    const voice = scheduleMelodyVoice({ ...instrument, context, destination: voiceDestination, lifetime, time: event.time,
                        midi: event.midi, cents, velocity: event.velocity * volume, duration: event.gate - event.time,
                        release: Math.max(0, Math.min(instrument.release, endTime - event.gate)) });
                    if (!voice) { cancel('cancelled'); break; }
                    if (instrument.envelope) {
                        const { attack, decay, sustain } = instrument.envelope;
                        const peak = event.velocity * volume;
                        const attackEnd = Math.min(event.time + attack, event.gate);
                        const decayEnd = Math.min(event.time + attack + decay, event.gate);
                        const levelAt = time => time < event.time + attack && attack > 0
                            ? peak * (time-event.time)/attack
                            : time < event.time+attack+decay && decay > 0
                                ? peak * (1-(1-sustain)*(time-event.time-attack)/decay) : peak*sustain;
                        const gain = voice.gain.gain;
                        gain.cancelScheduledValues(0);
                        gain.setValueAtTime(0, 0);
                        gain.setValueAtTime(attack ? 0 : peak, event.time);
                        gain.linearRampToValueAtTime(attackEnd < event.time+attack ? levelAt(attackEnd) : peak, attackEnd);
                        gain.linearRampToValueAtTime(levelAt(decayEnd), decayEnd);
                        gain.setValueAtTime(levelAt(event.gate), event.gate);
                        if (voice.endTime > event.gate) gain.linearRampToValueAtTime(0, voice.endTime);
                        else gain.setValueAtTime(0, event.gate);
                    }
                    owned.set(voice.source, voice);
                    voice.source.addEventListener('ended', () => {
                        owned.delete(voice.source);
                        if (!owned.size && (status !== 'active' || index === events.length)) disconnect();
                    }, { once: true });
                    noteIds.push(event.id);
                } catch (error) { cancel('invalid-voice'); throw error; }
            }
            return result(noteIds);
        },
    });
}
