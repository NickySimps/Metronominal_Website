const song = {
  Title: "",
  Tempo: 120,
  incrementTempo: function () {
    if (currentTempo < 300) {
      currentTempo++;
    }
    updateTempo();
  },
  decrementTempo: function () {
    if (currentTempo > 20) {
      currentTempo--;
    }
    updateTempo();
  },
  saveSong: function () {},
  loadSong: function () {},
};

const phrase = {
  multiplier: 0,
  addMeasure: function () {
    barDisplay.innerHTML += newMeasureBar;
    this.beats = selectedBarBeats;
    for (let i = 0; i < this.beats; i++) {
      let lastBlock = barDisplay.lastElementChild;

      lastBlock.innerHTML += newMeasureBarSegment;
    }
  },
  removeMeasure: function () {
    let lastBlock = barDisplay.lastElementChild;
    barDisplay.removeChild(lastBlock);
  },
};
const measure = {
  beats: 0,
  selected: false,
  addBeat: function () {
    if (selectedBarBeats < 19) {
      selectedBarBeats++;
      let lastBlock = document.querySelector('.bar-display-container').lastElementChild;
      beat.makeBeat(); // beat.makeBeat() already appends the new beat segment
      // lastBlock.innerHTML += newMeasureBarSegment; // This line was redundant
    }
    updateBeats();
  },
  removeBeat: function () {
    if (selectedBarBeats > 1) {
      selectedBarBeats--;
      let lastBlock = document.querySelector('.bar-display-container').lastElementChild;
      let lastSegment = lastBlock.lastElementChild;
      lastBlock.removeChild(lastSegment);
    }
    updateBeats();
  },
};
const beat = {
    //sound: click2,
    place: document.querySelector('.bar-display-container'),
    makeBeat: function (){
        let beatBlock = document.createElement('div');
       beatBlock.classList.add('test-beat', 'highlighted', 'measure-bar-segment');
       this.place.lastElementChild.appendChild(beatBlock);
       console.log('beat made!')
    },
    clickSound: function (){
      click1.currentTime = 0;
      click1.play();
    }
}

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
const newMeasureBarSegment = `<div class="measure-bar-segment"></div>`;



const click1 = new Audio("Click1.mp3");
const click2 = new Audio("Click2.mp3");
const crank1 = new Audio("Crank1.mp3");
const crank2 = new Audio("Crank2.mp3");

let currentTempo = 120;
let selectedBarBeats = 5;
let amountOfBars = 3;

window.onload = init();

function init() {
  drawBars();
  drawBeats();
}

//~~~~~~~~~~~~~~~~~~~~~~~~~~~~TEMPO CONTROLLER~~~~~~~~~~~~~~~~~~~~~~~~~

decTempoBtn.addEventListener("click", () => {
  song.decrementTempo();
});
incTempoBtn.addEventListener("click", () => {
  song.incrementTempo();
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
    calculateDrift();
    playClick();
  } else {
    startStopBtn.textContent = "START";
    stopClick();
    clearTimeout(timeout);
    let allBeats = document.querySelectorAll(".measure-bar-segment");
    for (const beat of allBeats) {
      beat.classList.remove("highlighted");
    }
    index = 0;
  }
});

//~~~~~~~~~~~BEATS CONTROLLER~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

decBeatsBtn.addEventListener("click", () => {
  measure.removeBeat();
});

incBeatsBtn.addEventListener("click", () => {
  measure.addBeat();
 // beat.makeBeat();
});

function updateBeats() {
  let lastBlock = barDisplay.lastElementChild;
  currentBeats.textContent = lastBlock.getElementsByTagName("*").length;
  totalUpBeats();
}

function drawBeats() {
  let allMeasureBars = document.querySelectorAll(".measure-bar");
  updateBeats();
  for (const bars of allMeasureBars) {
    for (let i = 0; i < selectedBarBeats; i++) {
      bars.innerHTML += newMeasureBarSegment;
    }
    updateBeats();
  }
}

function totalUpBeats() {
  let tb = barDisplay.getElementsByClassName("measure-bar-segment").length;
  let totalBeatsDisplay = document.querySelector(".total-beats-display");
  totalBeatsDisplay.textContent = "Total Beats: " + tb;
}

//~~~~~~~~~~~~~~BARS CONTROLLER~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

decBarsBtn.addEventListener("click", () => {
  if (amountOfBars > 1) {
    amountOfBars--;
    phrase.removeMeasure();
  }
  updateBars();
  updateBeats();
});

incBarsBtn.addEventListener("click", () => {
  amountOfBars++;
  phrase.addMeasure();
  updateBars();
  updateBeats();
});

function updateBars() {
  currentBars.textContent = amountOfBars;
}

function drawBars() {
  updateBars();
  for (let i = 0; i < currentBars.textContent; i++) {
    barDisplay.innerHTML += newMeasureBar;
  }
}

//~~~~~~~~~~~~~~~~~~~FUNCTIONS ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
let index = 0;
let timeout;
let clicker;

function playClick() {
  clicker = setTimeout(() => {
      let allBeats = document.querySelectorAll(".measure-bar-segment");

      if (allBeats.length === 0) {
        // If there are no beats, we can't play anything.
        // If metronome is supposed to be running, schedule the next attempt.
        if (startStopBtn.textContent === "STOP") {
          playClick();
        }
        return; // Exit this iteration's logic as there are no beats
      }

      // Ensure index is valid (not NaN and within current bounds).
      // This handles cases where beats were removed/added causing index to be
      // out of sync, or if index became NaN.
      if (isNaN(index) || index < 0 || index >= allBeats.length) {
        index = 0; // Reset index to a safe value
      }

      // Remove highlight from the previous beat
      // A simpler and more robust way is to clear all highlights first
      allBeats.forEach(beat => beat.classList.remove("highlighted"));

      // Highlight the current beat
      // At this point, allBeats.length > 0 and index is valid.
      // Add an extra check for allBeats[index] to be absolutely sure.
      if (allBeats[index]) {
          allBeats[index].classList.add("highlighted");
      }

      // Play the click sound
      // Defensive check for selectedBarBeats to prevent modulo by zero and play click1 on the first beat of each measure
      if (selectedBarBeats > 0 && index === 0 ) {
        click1.play();
      } 
      else beat.clickSound();

      // Increment the index, loop back to 0 at the end
      // This is safe now because allBeats.length > 0 is guaranteed here
      index = (index + 1) % allBeats.length;

      // Schedule the next click only if the metronome is still supposed to be running
      if (startStopBtn.textContent === "STOP") {
        playClick();
      }
  }, (60 / tempoSlider.value) * 1000);
}

function stopClick() {
  clearTimeout(clicker);
}

function calculateDrift() {  let drift = Date.now() % 1000;
  console.log(drift);
  return drift;
  }