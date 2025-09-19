// js/recordingVisualizer.js

const RecordingVisualizer = (function() {
    let analyser = null;
    let canvas = null;
    let canvasCtx = null;
    let animationFrameId = null;
    let mainColor = 'lime'; // Default fallback color
    let dataArray = null; // Declare dataArray here

    function draw() {
        if (!analyser || !canvasCtx || !dataArray) return; // Check dataArray

        animationFrameId = requestAnimationFrame(draw);

        analyser.getByteTimeDomainData(dataArray); // Use the pre-allocated dataArray

        canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
        canvasCtx.lineWidth = 2;
        canvasCtx.strokeStyle = mainColor; // Use the stored color
        canvasCtx.beginPath();

        const sliceWidth = canvas.width * 1.0 / dataArray.length; // Use dataArray.length
        let x = 0;

        for (let i = 0; i < dataArray.length; i++) { // Use dataArray.length
            const v = dataArray[i] / 128.0;
            const y = v * canvas.height / 2;

            if (i === 0) {
                canvasCtx.moveTo(x, y);
            } else {
                canvasCtx.lineTo(x, y);
            }

            x += sliceWidth;
        }

        canvasCtx.lineTo(canvas.width, canvas.height / 2);
        canvasCtx.stroke();
    }

    return {
        init: (analyserNode, canvasElement) => {
            analyser = analyserNode;
            canvas = canvasElement;
            canvasCtx = canvas.getContext('2d');

            // Set fftSize and pre-allocate dataArray here
            analyser.fftSize = 2048;
            dataArray = new Uint8Array(analyser.fftSize);

            // Get the computed value of --Main CSS variable
            const computedStyle = getComputedStyle(document.documentElement);
            const cssMainColor = computedStyle.getPropertyValue('--Main').trim();
            if (cssMainColor) {
                mainColor = cssMainColor;
            }
        },
        start: () => {
            if (analyser && canvasCtx) {
                cancelAnimationFrame(animationFrameId); // Stop any previous animation
                draw();
            }
        },
        stop: () => {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
            if (canvasCtx) {
                canvasCtx.clearRect(0, 0, canvas.width, canvas.height); // Clear canvas
            }
        }
    };
})();

export default RecordingVisualizer;