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
    saveSong: function () {
    },
    loadSong: function () {
    },
};

const phrase = {
    multiplier: 0,
    addMeasure: function () {
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
const measure = {
    beats: 4,
    selected: false,
    addBeat: function () {
        if (selectedBarBeats < 19) {
            selectedBarBeats++;
            let lastBlock = barDisplay.lastElementChild;
            lastBlock.innerHTML += newMeasureBarSegment;
        }
        updateBeats();
    },
    removeBeat: function () {
        if (selectedBarBeats > 1) {
            selectedBarBeats--;
            let lastBlock = barDisplay.lastElementChild;
            let lastSegment = lastBlock.lastElementChild;
            lastBlock.removeChild(lastSegment);
        }
        updateBeats();
    },
};

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


const beat = {
    highlighted: false,
};

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
    }
});

//~~~~~~~~~~~BEATS CONTROLLER~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

decBeatsBtn.addEventListener("click", () => {
    measure.removeBeat();
});

incBeatsBtn.addEventListener("click", () => {
    measure.addBeat();
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
        for(let i = 0; i < selectedBarBeats; i++) {
            bars.innerHTML += newMeasureBarSegment;
        }        updateBeats();
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

function calculateDrift() {
    const startTime = Date.now();
    timeout =setTimeout(() => {
        let elapsedTime = Date.now() - startTime;
        console.log(`Drift: ${elapsedTime-1000}`);
        calculateDrift();
    },1000);
}

function playClick() {
    setTimeout(() => {
      let allBeats = document.querySelectorAll(".measure-bar-segment");
      if (allBeats.length == 1) {
        allBeats[index].classList.toggle("highlighted");
        click1.currentTime = 0;
        click1.play();
      } else {
        for (const beat of allBeats) {
          if (index >= 1) {
            allBeats[index].classList.toggle("highlighted");
            click2.currentTime = 0;
            click2.play();
          } else {
            allBeats[index].classList.toggle("highlighted");
            click1.currentTime = 0;
            click1.play();
            /*allBeats[index].previousElementSibling.classList.toggle(
              "highlighted"
            );*/
          }
        }
  
        console.log(index);
        ++index;
        if (index == allBeats.length) {
          index = 0;
        }
      }
  
      playClick();
    }, (60 / tempoSlider.value) * 1000);
    /*setTimeout(() => {
        click2.currentTime = 0;
        click2.play();
        playClick();
      }, (60 / tempoSlider.value) * 1000);*/
  }
