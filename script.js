const tempo = document.querySelector(".tempo");
const tempoText = document.querySelector(".tempo-text");
const decTempoBtn = document.querySelector(".decrease-tempo");
const incTempoBtn = document.querySelector(".increase-tempo");
const tempoSlider = document.querySelector(".slider");
const startStopBtn = document.querySelector(".start-stop-btn");
const decBeatsBtn = document.querySelector(".decrease-measure-length");
const incBeatsBtn = document.querySelector(".increase-measure-length");
const currentBeats = document.querySelector(".beats-per-current-measure");
const decBarsBtn = document.querySelector(".decrease-bar-length");
const incBarsBtn = document.querySelector(".increase-bar-length");
const currentBars = document.querySelector(".bars-length");
const barDisplay = document.querySelector(".bar-display-container");
const newMeasureBar = `<div class="measure-bar"></div>`;
const measureBar = document.querySelector(".measure-bar");
const newMeasureBarSegment = `<div class="measure-bar-segment"></div>`;
const measureBarSegment = document.querySelector(".measure-bar-segment");

let currentTempo = 120;
let selectedBarBeats = 4;
let amountOfBars = 3;

window.onload = init();

function init() {
  console.log("Hello there");
  drawBars();
  drawBeats();
}

//~~~~~~~~~~~~~~~~~~~~~~~~~~~~TEMPO CONTROLLER~~~~~~~~~~~~~~~~~~~~~~~~~
decTempoBtn.addEventListener("click", () => {
  if (currentTempo > 20) {
    currentTempo--;
  }
  updateTempo();
});
incTempoBtn.addEventListener("click", () => {
  if (currentTempo < 300) {
    currentTempo++;
  }
  updateTempo();
});
tempoSlider.addEventListener("input", () => {
  currentTempo = tempoSlider.value;
  updateTempo();
});

startStopBtn.addEventListener("click", () => {
  if (startStopBtn.textContent === "START") {
    startStopBtn.textContent = "STOP";
  } else {
    startStopBtn.textContent = "START";
  }
});
//~~~~~~~~~~~BEATS CONTROLLER~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
decBeatsBtn.addEventListener("click", () => {
  if (selectedBarBeats >= 1) {
    selectedBarBeats--;
    let lastSegment = measureBar.lastElementChild;
    measureBar.removeChild(lastSegment);
  }
  updateBeats();
});

incBeatsBtn.addEventListener("click", () => {
  if (selectedBarBeats < 19) {
    selectedBarBeats++;
   measureBar.innerHTML += newMeasureBarSegment;
  }
  updateBeats();
});

//~~~~~~~~~~~~~~BARS CONTROLLER~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
decBarsBtn.addEventListener("click", () => {
  if (amountOfBars >= 1) {
    amountOfBars--;
    let lastBlock = barDisplay.lastElementChild;
    barDisplay.removeChild(lastBlock);
  }
  updateBars();
});

incBarsBtn.addEventListener("click", () => {
  amountOfBars++;
  barDisplay.innerHTML += newMeasureBar;
  updateBars();
});

/*~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
FUNCTIONS */
function drawBars() {
  for (let i = 0; i < currentBars.textContent; i++) {
    console.log("bars" + i);
    barDisplay.innerHTML += newMeasureBar;
  }
  console.log("bars made");
}
function drawBeats() {
  for (let i = 0; i < currentBeats.textContent; i++) {
    console.log("beats" + i);
    measureBar.innerHTML += newMeasureBarSegment;
  }
}

function updateTempo() {
  tempo.textContent = currentTempo;
  tempoSlider.value = currentTempo;
}

function updateBeats() {
  currentBeats.textContent = selectedBarBeats;
}

function updateBars() {
  currentBars.textContent = amountOfBars;

  /*for (let i = 0; i < amountOfBars; i++) {
    barDisplay.innerHTML += newMeasureBar +i;
  }*/
}
