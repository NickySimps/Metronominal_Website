
// js/audioSerialization.js

/**
 * Converts an AudioBuffer to a WAV ArrayBuffer.
 * @param {AudioBuffer} audioBuffer - The AudioBuffer to convert.
 * @returns {ArrayBuffer} The WAV file as an ArrayBuffer.
 */
async function audioBufferToWav(audioBuffer) {
    const numOfChan = audioBuffer.numberOfChannels;
    const length = audioBuffer.length * numOfChan;
    const result = new Float32Array(length);
    const channels = [];
    for (let i = 0; i < numOfChan; i++) {
        channels.push(audioBuffer.getChannelData(i));
    }
    let offset = 0;
    for (let i = 0; i < audioBuffer.length; i++) {
        for (let channel = 0; channel < numOfChan; channel++) {
            result[offset++] = channels[channel][i];
        }
    }

    const sampleRate = audioBuffer.sampleRate;
    const bytesPerSample = 2; // 16-bit PCM
    const blockAlign = numOfChan * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = length * bytesPerSample;

    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    let p = 0;

    function writeString(s) {
        for (let i = 0; i < s.length; i++) {
            view.setUint8(p++, s.charCodeAt(i));
        }
    }

    function writeUint32(i) {
        view.setUint32(p, i, true);
        p += 4;
    }

    function writeUint16(i) {
        view.setUint16(p, i, true);
        p += 2;
    }

    writeString('RIFF');
    writeUint32(36 + dataSize);
    writeString('WAVE');
    writeString('fmt ');
    writeUint32(16);
    writeUint16(1); // PCM
    writeUint16(numOfChan);
    writeUint32(sampleRate);
    writeUint32(byteRate);
    writeUint16(blockAlign);
    writeUint16(bytesPerSample * 8);
    writeString('data');
    writeUint32(dataSize);

    for (let i = 0; i < result.length; i++) {
        let s = Math.max(-1, Math.min(1, result[i]));
        s = s < 0 ? s * 0x8000 : s * 0x7FFF;
        view.setInt16(p, s, true);
        p += bytesPerSample;
    }

    return buffer;
}

/**
 * Converts a WAV ArrayBuffer to an AudioBuffer.
 * @param {ArrayBuffer} wavBuffer - The WAV file as an ArrayBuffer.
 * @param {AudioContext} audioContext - The AudioContext to decode the buffer with.
 * @returns {Promise<AudioBuffer>} A Promise that resolves with the decoded AudioBuffer.
 */
async function wavToArrayBuffer(wavBuffer, audioContext) {
    return new Promise((resolve, reject) => {
        audioContext.decodeAudioData(wavBuffer, resolve, reject);
    });
}

export { audioBufferToWav, wavToArrayBuffer };
