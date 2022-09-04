const tempo = document.querySelector('.tempo');
const tempoText = document.querySelector('.tempo-text');
const decTempoBtn = document.querySelector('.decrease-tempo');
const incTempoBtn = document.querySelector('.increase-tempo');
const tempoSlider = document.querySelector('.slider');
const startStopBtn = document.querySelector('.start-stop-btn');
const decBeatsBtn = document.querySelector('.decrease-measure-length');
const incBeatsBtn = document.querySelector('.increase-measure-length');
const currentBeats = document.querySelector('.beats-per-current-measure');
const decBarsBtn = document.querySelector('.decrease-bar-length');
const incBarsBtn = document.querySelector('.increase-bar-length');
const currentBars = document.querySelector('.bars-length');

let currentTempo = 120;
let selectedBarBeats = 4;
let amountOfBars = 3;

decTempoBtn.addEventListener('click', () => {
    if (currentTempo > 20) {
        currentTempo--
    }
    updateTempo();
})
incTempoBtn.addEventListener('click', () => {
    if (currentTempo < 300) {
        currentTempo++
    }
    updateTempo();
})
tempoSlider.addEventListener('input', () => {
    currentTempo = tempoSlider.value;
    updateTempo();
})

startStopBtn.addEventListener('click', () => {
    if (startStopBtn.textContent === 'START') {
        startStopBtn.textContent = 'STOP'
    } else {
        startStopBtn.textContent = 'START'
    }
})

decBeatsBtn.addEventListener('click', () => {
    if (selectedBarBeats > 1) {
        selectedBarBeats--
    }
    updateBeats();
})
incBeatsBtn.addEventListener('click', () => {
    if (selectedBarBeats < 19) {
        selectedBarBeats++
    }
    updateBeats();
})
decBarsBtn.addEventListener('click', () => {
    if (amountOfBars > 1) {
        amountOfBars--
    }
    updateBars();
})
incBarsBtn.addEventListener('click', () => {
    amountOfBars++;
    updateBars();
})
/*~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
FUNCTIONS */


function updateTempo() {
    tempo.textContent = currentTempo;
    tempoSlider.value = currentTempo;
}

function updateBeats() {
    currentBeats.textContent = selectedBarBeats;
}

function updateBars() {
    currentBars.textContent = amountOfBars;
}