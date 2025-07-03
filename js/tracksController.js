import DOM from './domSelectors.js';
import AppState from './appState.js';
import BarDisplayController from './barDisplayController.js';

const TrackController = {
    init: () => {
        DOM.addTrackButton.addEventListener('click', TrackController.addTrack); 
        DOM.trackWrapper.addEventListener('click', TrackController.handleTrackClicks);
        TrackController.renderTracks();
    },

    renderTracks: () => {
        const Tracks = AppState.getTracks();
        DOM.trackWrapper.innerHTML = ''; // Clear existing containers

        Tracks.forEach((container, index) => {
            const containerElement = document.createElement('div');
            containerElement.classList.add('track');
            containerElement.dataset.containerIndex = index;

            // Determine color inversion based on index
            const colorInversionClass = `track-color-${index % 7}`; // Cycle through 4 inversions
            containerElement.classList.add(colorInversionClass);

            containerElement.innerHTML = `
                <div class="track-controls">
                    <button class="track-mute-btn">${container.muted ? 'Unmute' : 'Mute'}</button>
                    <button class="track-solo-btn">${container.solo ? 'Unsolo' : 'Solo'}</button>
                    <button class="track-remove-btn">-</button>
                </div>
                <div class="bar-display-container" data-container-index="${index}"></div>
            `;
            DOM.trackWrapper.appendChild(containerElement);
        });

        // Render the actual beat displays inside the containers
        BarDisplayController.renderBarsAndControls();

        // No longer need to attach listeners here, it's handled by event delegation in init()
    },

    handleTrackClicks: (event) => {
        const target = event.target;

        // Handle Mute Button Click
        if (target.matches('.track-mute-btn')) {
            const containerIndex = target.closest('.track').dataset.containerIndex;
            const container = AppState.getTracks()[containerIndex];
            AppState.updateTrack(containerIndex, { muted: !container.muted });
            target.textContent = AppState.getTracks()[containerIndex].muted ? 'Unmute' : 'Mute';
            return;
        }

        // Handle Solo Button Click
        if (target.matches('.track-solo-btn')) {
            const containerIndex = target.closest('.track').dataset.containerIndex;
            const container = AppState.getTracks()[containerIndex];
            AppState.updateTrack(containerIndex, { muted: !container.muted });
            target.textContent = AppState.getTracks()[containerIndex].muted ? 'Unsolo' : 'Solo';
            return;
        }

        // Handle Remove Button Click
        if (target.matches('.track-remove-btn')) {
            const containerIndex = target.closest('.track').dataset.containerIndex;
            AppState.removeTrack(containerIndex);
            TrackController.renderTracks(); // Re-render all containers after removal
            return;
        }

        // Handle Bar Selection Click
        const barVisual = target.closest('.bar-visual');
        if (barVisual) {
            const containerIndex = parseInt(barVisual.dataset.containerIndex, 10);
            const barIndex = parseInt(barVisual.dataset.barIndex, 10);

            AppState.setSelectedTrackIndex(containerIndex);
            AppState.setSelectedBarIndexInContainer(barIndex);

            // Update UI for selection
            DOM.trackWrapper.querySelectorAll('.bar-visual').forEach(b => b.classList.remove('selected'));
            barVisual.classList.add('selected');
            BarDisplayController.renderBarsAndControls(); 
            

            // Notify other components that a bar was selected
            document.dispatchEvent(new CustomEvent('barSelected'));
        }
    },

    addTrack: () => {
        AppState.addTrack();
        TrackController.renderTracks();
    },
};

export default TrackController;