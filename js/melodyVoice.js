import AudioPlaybackLifetime from './audioPlaybackLifetime.js';

function bounded(name, value, min, max, integer = false) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max ||
        (integer && !Number.isInteger(value))) {
        throw new RangeError(`${name} must be ${integer ? 'an integer' : 'finite'} in [${min}, ${max}]`);
    }
}

/**
 * Independent polyphonic melody adapter, NOT the existing SoundSynth instruments.
 * Creates one native voice synchronously; never decodes, fetches, resumes, replaces
 * a track context, or uses wall-clock timers. The caller prepares samples first.
 *
 * Required: context, destination (same context), real AudioPlaybackLifetime,
 * time (absolute context seconds, now..now+3600), midi (integer 0..127),
 * duration (gate seconds, >0..600). Optional: cents (-1200..1200), velocity
 * (0..1), release (0..60 seconds, default .02), kind ('oscillator'/'sample').
 * Oscillator waveform: sine/default, triangle, square, sawtooth. Sample requires
 * an existing native AudioBuffer AND explicit integer rootMidi (0..127); rate
 * is relative to that root, bounded to 1/256..256. No guessed sample pitch,
 * looping, stretching, instrument emulation or per-voice effects are implied.
 * Samples may naturally end before the gate if their prepared buffer runs out.
 *
 * Gate holds velocity through time+duration, then linearly releases to zero;
 * stop is scheduled at that exact audio time. Voices overlap independently.
 * Inactive lifetimes return null before allocation. Other invalid input throws
 * before allocation. Source/envelope cleanup uses native ended and the existing
 * lifetime; its shared post-FX output route remains until lifetime cancellation.
 * Route any caller-owned FX BEFORE that gate, never downstream of destination.
 * Returns {source, gain, startTime, gateTime, endTime, frequency, playbackRate}.
 */
export function scheduleMelodyVoice({ context, destination, lifetime, time, midi,
    cents = 0, velocity = 1, duration, release = 0.02, waveform = 'sine',
    kind = 'oscillator', buffer, rootMidi }) {
    if (!(lifetime instanceof AudioPlaybackLifetime)) throw new TypeError('A real AudioPlaybackLifetime is required');
    if (!lifetime.active) return null;
    if (!(context instanceof BaseAudioContext) || context.state === 'closed') throw new TypeError('An open native audio context is required');
    if (!(destination instanceof AudioNode) || destination.context !== context) throw new TypeError('destination must belong to context');
    if (kind !== 'oscillator' && kind !== 'sample') throw new TypeError('Unsupported melody voice kind');
    bounded('time', time, context.currentTime, context.currentTime + 3600);
    bounded('midi', midi, 0, 127, true);
    bounded('cents', cents, -1200, 1200);
    bounded('velocity', velocity, 0, 1);
    bounded('duration', duration, Number.MIN_VALUE, 600);
    bounded('release', release, 0, 60);
    const frequency = 440 * 2 ** ((midi - 69 + cents / 100) / 12);
    let playbackRate;
    if (kind === 'sample') {
        if (!(buffer instanceof AudioBuffer)) throw new TypeError('Prepare a native AudioBuffer before scheduling');
        bounded('rootMidi', rootMidi, 0, 127, true);
        playbackRate = 2 ** ((midi - rootMidi + cents / 100) / 12);
        bounded('playbackRate', playbackRate, 1 / 256, 256);
    } else {
        if (!['sine', 'triangle', 'square', 'sawtooth'].includes(waveform)) throw new TypeError('Unsupported oscillator waveform');
        bounded('frequency', frequency, 0, Math.min(20000, context.sampleRate / 2));
    }
    const gateTime = time + duration;
    const endTime = gateTime + release;
    const source = kind === 'sample' ? context.createBufferSource() : context.createOscillator();
    const gain = context.createGain();
    if (kind === 'sample') {
        source.buffer = buffer;
        source.playbackRate.setValueAtTime(playbackRate, time);
    } else {
        source.type = waveform;
        source.frequency.setValueAtTime(frequency, time);
    }
    gain.gain.setValueAtTime(0, 0);
    gain.gain.setValueAtTime(velocity, time);
    gain.gain.setValueAtTime(velocity, gateTime);
    if (release > 0) gain.gain.linearRampToValueAtTime(0, endTime);
    else gain.gain.setValueAtTime(0, endTime);
    source.connect(gain);
    gain.connect(lifetime.output(context, destination));
    if (!lifetime.ownSource(source, () => gain.disconnect())) return null;
    source.start(time);
    source.stop(endTime);
    return { source, gain, startTime: time, gateTime, endTime, frequency, playbackRate };
}
