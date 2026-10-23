/** One engine generation owns pending continuations, native voices and post-FX routes.
 * Cancellation is irreversible: a later Play receives a different lifetime.
 * Auditions omit this optional owner and never enter a playback generation.
 */
export default class AudioPlaybackLifetime {
    active = true;
    sources = new Map();
    routes = new Map();
    timers = new Set();

    ownSource(source, onRelease = () => {}) {
        if (!this.active) {
            try { source.stop(); } catch { /* Not started or already ended. */ }
            source.disconnect();
            onRelease();
            return false;
        }
        const release = () => {
            if (!this.sources.delete(source)) return;
            source.disconnect();
            onRelease();
        };
        this.sources.set(source, release);
        source.addEventListener('ended', release, { once: true });
        return true;
    }

    output(context, destination) {
        if (!this.active) return null;
        if (!this.routes.has(destination)) {
            const gate = context.createGain();
            gate.connect(destination);
            this.routes.set(destination, gate);
        }
        return this.routes.get(destination);
    }

    timeout(callback, delay) {
        if (!this.active) return;
        const timer = setTimeout(() => {
            this.timers.delete(timer);
            if (this.active) callback();
        }, delay);
        this.timers.add(timer);
    }

    cancel() {
        if (!this.active) return;
        this.active = false;
        for (const timer of this.timers) clearTimeout(timer);
        this.timers.clear();
        // Gates sit AFTER each voice's FX: queued delay/reverb tails cannot leak.
        for (const gate of this.routes.values()) gate.disconnect();
        this.routes.clear();
        for (const [source, release] of this.sources) {
            try { source.stop(); } catch { /* Already ended. */ }
            release();
        }
        this.sources.clear();
    }
}
