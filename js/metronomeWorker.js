// metronomeWorker.js
let timerID = null;
let interval = 25;

self.onmessage = function(e) {
    if (e.data === "start") {
        if (!timerID) {
            timerID = setInterval(function() {
                postMessage("tick");
            }, interval);
        }
    } else if (e.data === "stop") {
        if (timerID) {
            clearInterval(timerID);
            timerID = null;
        }
    } else if (e.data.interval) {
        interval = e.data.interval;
        if (timerID) {
            clearInterval(timerID);
            timerID = setInterval(function() {
                postMessage("tick");
            }, interval);
        }
    }
};
