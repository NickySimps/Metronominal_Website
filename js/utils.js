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

export function semitonesToInterval(semitones) {
    if (semitones === 0) return "Unison";
    const absSemitones = Math.abs(semitones);
    const direction = semitones > 0 ? "Up" : "Down";

    const intervals = {
        1: "Minor 2nd",
        2: "Major 2nd",
        3: "Minor 3rd",
        4: "Major 3rd",
        5: "Perfect 4th",
        6: "Augmented 4th/Diminished 5th",
        7: "Perfect 5th",
        8: "Minor 6th",
        9: "Major 6th",
        10: "Minor 7th",
        11: "Major 7th",
        12: "Octave"
    };

    const octave = Math.floor(absSemitones / 12);
    const remainingSemitones = absSemitones % 12;

    let intervalName = intervals[remainingSemitones] || "";
    if (octave > 0) {
        intervalName = `${octave} Octave${octave > 1 ? "s" : ""} ` + intervalName;
    }

    return `${intervalName} ${direction}`.trim();
}