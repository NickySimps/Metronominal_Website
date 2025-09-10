export const noteStrings = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export function frequencyToNote(frequency) {
    const a4 = 440;
    const noteNumber = 12 * (Math.log(frequency / a4) / Math.log(2));
    const roundedNoteNumber = Math.round(noteNumber) + 69;
    const octave = Math.floor(roundedNoteNumber / 12) - 1;
    const noteIndex = roundedNoteNumber % 12;
    return noteStrings[noteIndex] + octave;
}

export function noteToFrequency(note) {
    const a4 = 440;

    let noteName;
    let octave;
    if (note.charAt(1) === '#') {
        noteName = note.substring(0, 2);
        octave = parseInt(note.substring(2));
    } else {
        noteName = note.substring(0, 1);
        octave = parseInt(note.substring(1));
    }

    const noteIndex = noteStrings.indexOf(noteName);
    const midiNote = 12 * (octave + 1) + noteIndex;

    return a4 * Math.pow(2, (midiNote - 69) / 12);
}

export function generateNoteFrequencies(minFreq, maxFreq) {
    const frequencies = [];
    let midiNote = 0;
    let freq = 0;

    while (freq < maxFreq) {
        freq = 440 * Math.pow(2, (midiNote - 69) / 12);
        if (freq > minFreq) {
            frequencies.push(freq);
        }
        midiNote++;
    }

    return frequencies;
}