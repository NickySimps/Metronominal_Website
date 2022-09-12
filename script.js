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
const totalBeatsDisplay = document.querySelector(".total-beats-display");
const newMeasureBar = `<div class="measure-bar"></div>`;
const newMeasureBarSegment = `<div class="measure-bar-segment"></div>`;
const measureBarSegment = document.querySelector(".measure-bar-segment");

const measure = {
  beats: 4,
  selected: false,
  makeMeasure: function () {
    barDisplay.innerHTML += newMeasureBar;
    this.beats = selectedBarBeats;
    for (i = 0; i < this.beats; i++) {
      let lastBlock = barDisplay.lastElementChild;
      lastBlock.innerHTML += newMeasureBarSegment;
    }
  },
  removeMeasure: function () {
    let lastBlock = barDisplay.lastElementChild;
    barDisplay.removeChild(lastBlock);
  },
};

const click1 = new Audio("Click1.mp3");
const click2 = new Audio("Click2.mp3");
const crank1 = new Audio("Crank1.mp3");
const crank2 = new Audio("Crank2.mp3");

let currentTempo = 120;
let selectedBarBeats = 1;
let amountOfBars = 1;

window.onload = init();

function init() {
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

function updateTempo() {
  tempo.textContent = currentTempo;
  tempoSlider.value = currentTempo;
  if (currentTempo < 60) {
    tempoText.textContent = "very slow";
  } else if (currentTempo > 60 && currentTempo < 90) {
    tempoText.textContent = "slow";
  } else if (currentTempo > 90 && currentTempo < 120) {
    tempoText.textContent = "moderate";
  } else if (currentTempo > 120 && currentTempo < 160) {
    tempoText.textContent = "kinda fast";
  } else if (currentTempo > 160 && currentTempo < 200) {
    tempoText.textContent = "fast";
  } else if (currentTempo > 200 && currentTempo < 230) {
    tempoText.textContent = "very fast";
  } else if (currentTempo > 230 && currentTempo < 260) {
    tempoText.textContent = "extremely fast";
  } else if (currentTempo > 260) {
    tempoText.textContent = "woah nelly";
  }
}

//~~~~~~~~~~START-STOP BUTTON~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

startStopBtn.addEventListener("click", () => {
  if (startStopBtn.textContent === "START") {
    startStopBtn.textContent = "STOP";
  } else {
    startStopBtn.textContent = "START";
  }
  playClick();
});

//~~~~~~~~~~~BEATS CONTROLLER~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

decBeatsBtn.addEventListener("click", () => {
  if (selectedBarBeats > 1) {
    selectedBarBeats--;
    let lastBlock = barDisplay.lastElementChild;
    let lastSegment = lastBlock.lastElementChild;
    lastBlock.removeChild(lastSegment);
  }
  updateBeats();
});

incBeatsBtn.addEventListener("click", () => {
  if (selectedBarBeats < 19) {
    selectedBarBeats++;
    let lastBlock = barDisplay.lastElementChild;
    lastBlock.innerHTML += newMeasureBarSegment;
  }
  updateBeats();
});
function updateBeats() {
  let lastBlock = barDisplay.lastElementChild;
  currentBeats.textContent = lastBlock.getElementsByTagName("*").length;
  totalUpBeats();
}

//~~~~~~~~~~~~~~BARS CONTROLLER~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

decBarsBtn.addEventListener("click", () => {
  if (amountOfBars > 1) {
    amountOfBars--;
    measure.removeMeasure();
  }
  updateBars();
  updateBeats();
});

incBarsBtn.addEventListener("click", () => {
  amountOfBars++;
  measure.makeMeasure();
  updateBars();
  updateBeats();
});

function updateBars() {
  currentBars.textContent = amountOfBars;
}

//~~~~~~~~~~~~~~~~~~~FUNCTIONS ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

function drawBars() {
  updateBars();
  for (let i = 0; i < currentBars.textContent; i++) {
    barDisplay.innerHTML += newMeasureBar;
  }
}
function drawBeats() {
  let measureBar = document.querySelector(".measure-bar");
  

  updateBeats();
  for (let i = 0; i < selectedBarBeats; i++) {
    measureBar.innerHTML += newMeasureBarSegment;
    updateBeats();

  }
}
function totalUpBeats() {
  let tb = barDisplay.getElementsByClassName("measure-bar-segment").length;
  let totalBeatsDisplay = document.querySelector(".total-beats-display");
  totalBeatsDisplay.textContent = "Total Beats: " + tb;
}

function playClick() {
  setTimeout(() => {
    click1.play();
  }, (60 / tempoSlider.value) * 500);
  setTimeout(() => {
    click2.play();
    playClick();
  }, (60 / tempoSlider.value) * 1000);
}
