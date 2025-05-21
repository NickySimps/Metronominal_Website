/**
 * domSelectors.js
 * This module is responsible for selecting and providing access to key DOM elements.
 */

const DOM = {
    // Tempo controls
    tempoDisplay: document.querySelector('.tempo'),
    tempoSlider: document.querySelector('.slider'),
    increaseTempoBtn: document.querySelector('.increase-tempo'),
    tempoTextBox: document.querySelector('.tempo-text-box'), // For animation
    decreaseTempoBtn: document.querySelector('.decrease-tempo'),
    tapTempoBtn: document.querySelector('.tap-tempo-btn'), // Added for Tap Tempo
    startStopBtn: document.querySelector('.start-stop-btn'),
    resetButton: document.querySelector('.reset-btn'), // New Reset Button
    tempoTextElement: document.querySelector('.tempo-text'), // To update descriptive tempo text

    // Bar and Beat specific controls
    barDisplayContainer: document.querySelector('.bar-display-container'),
    beatsPerCurrentMeasureDisplay: document.querySelector('.beats-per-current-measure'),
    increaseMeasureLengthBtn: document.querySelector('.increase-measure-length'),
    decreaseMeasureLengthBtn: document.querySelector('.decrease-measure-length'),
    barsLengthDisplay: document.querySelector('.bars-length'),
    increaseBarLengthBtn: document.querySelector('.increase-bar-length'),
    decreaseBarLengthBtn: document.querySelector('.decrease-bar-length'),
    totalBeatsDisplayElement: document.querySelector('.total-beats-display'), // Added for total beats
    beatMultiplierSelect: document.getElementById('beat-multiplier-select'),

    // Volume Control
    volumeSlider: document.querySelector('.volume-slider'), // Added for Volume
    volumeValueDisplay: document.querySelector('.volume-value'), // Added for Volume display

    // Theme buttons (using querySelectorAll as there are multiple)
    themeButtons: document.querySelectorAll('.theme-controls button'),

    // Preset Controls
    savePresetButton: document.querySelector('.save-preset-btn'),
    loadPresetButton: document.querySelector('.load-preset-btn'),
    presetSlotSelect: document.getElementById('preset-slot-select'),
    presetNameInput: document.getElementById('preset-name-input'),

    // Preset Display Heading
    currentPresetDisplayHeading: document.getElementById('current-preset-display-heading'),

    // Add other elements as needed
};

export default DOM;