/**
 * domSelectors.js
 * This module is responsible for selecting and providing access to key DOM elements.
 * Using getters to ensure elements are selected only when needed and after the DOM is fully loaded.
 */

const DOM = {
    // Tempo controls
    get tempoDisplay() { return document.querySelector('.tempo'); },
    get tempoSlider() { return document.querySelector('.slider'); },
    get increaseTempoBtn() { return document.querySelector('.increase-tempo'); },
    get tempoTextBox() { return document.querySelector('.tempo-text-box'); },
    get decreaseTempoBtn() { return document.querySelector('.decrease-tempo'); },
    get tapTempoBtn() { return document.querySelector('.tap-tempo-btn'); },
    get startStopBtn() { return document.querySelector('.start-stop-btn'); },
    get resetButton() { return document.querySelector('.reset-btn'); },
    get tempoTextElement() { return document.querySelector('.tempo-text'); },

    // Bar and Beat specific controls
    get trackContainer() { return document.querySelector('.track-container'); },
    get beatsPerCurrentMeasureDisplay() { return document.querySelector('.beats-per-current-measure'); },
    get increaseMeasureLengthBtn() { return document.querySelector('.increase-measure-length'); },
    get decreaseMeasureLengthBtn() { return document.querySelector('.decrease-measure-length'); },
    get barsLengthDisplay() { return document.querySelector('.bars-length'); },
    get increaseBarLengthBtn() { return document.querySelector('.increase-bar-length'); },
    get decreaseBarLengthBtn() { return document.querySelector('.decrease-bar-length'); },
    get totalBeatsDisplayElement() { return document.querySelector('.total-beats-display'); },
    get beatMultiplierSelect() { return document.getElementById('beat-multiplier-select'); },
    get measuresContainer() { return document.querySelector('.measures-container'); },
    get metronomeContainer() { return document.querySelector('.metronome-container'); },
    get measuresContainer() { return document.querySelector('.measures-container'); },
    get barsContainer() { return document.querySelector('.bars-container'); },

    // Volume Control
    get volumeSlider() { return document.querySelector('.volume-slider'); },
    get volumeValueDisplay() { return document.querySelector('.volume-value'); },

    // Theme buttons
    get themeButtons() { return document.querySelectorAll('.theme-controls button'); },

    // Preset Controls
    get savePresetButton() { return document.querySelector('.save-preset-btn'); },
    get loadPresetButton() { return document.querySelector('.load-preset-btn'); },
    get presetSlotSelect() { return document.getElementById('preset-slot-select'); },
    get presetNameInput() { return document.getElementById('preset-name-input'); },

    // Sharing/Sync Controls
    get shareBtn() { return document.getElementById('share-btn'); },
    get disconnectBtn() { return document.getElementById('disconnect-btn'); },
    get connectionStatus() { return document.getElementById('connection-status'); },

    // Preset Display Heading
    get currentPresetDisplayHeading() { return document.getElementById('current-preset-display-heading'); },

    // Bar Container Controls
    get addTrackButton() { return document.getElementById('add-track-btn'); },
    get trackWrapper() { return document.getElementById('all-tracks-wrapper'); },

    // Sound Settings Modal
    get soundSettingsModal() { return document.getElementById('sound-settings-modal'); },
};

export default DOM;