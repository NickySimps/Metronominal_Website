import AppState from './appState.js';
import TrackController from './tracksController.js';
import AudioController from './audioController.js';

function formatDuration(seconds) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
}

const RecordingManager = {
    init: () => {
        const manageRecordingsBtn = document.getElementById('manage-recordings-btn');
        const modal = document.getElementById('manage-recordings-modal');
        const closeButton = modal.querySelector('.close-button');

        if (manageRecordingsBtn) {
            manageRecordingsBtn.addEventListener('click', () => {
                RecordingManager.openModal();
            });
        }

        if (closeButton) {
            closeButton.addEventListener('click', () => {
                modal.style.display = 'none';
            });
        }

        modal.addEventListener('click', (event) => {
            if (event.target === modal) {
                modal.style.display = 'none';
            }
            if (event.target.classList.contains('delete-recording-btn')) {
                const recordingName = event.target.dataset.recordingName;
                AppState.deleteRecording(recordingName);
                RecordingManager.populateModal();
                TrackController.renderTracks();
            } else if (event.target.classList.contains('play-recording-btn')) {
                const recordingName = event.target.dataset.recordingName;
                AudioController.playRecording(recordingName, {});
            } else if (event.target.classList.contains('rename-recording-btn')) {
                const oldName = event.target.dataset.recordingName;
                const recordingItem = event.target.closest('.recording-item');
                const nameSpan = recordingItem.querySelector('.recording-name-display');

                if (nameSpan) {
                    const input = document.createElement('input');
                    input.type = 'text';
                    input.value = oldName;
                    input.className = 'recording-name-input';
                    input.dataset.oldName = oldName; // Store old name for reference

                    nameSpan.replaceWith(input);
                    input.focus();

                    const handleRename = () => {
                        const newName = input.value.trim();
                        if (newName && newName !== oldName) {
                            AppState.renameRecording(oldName, newName);
                            RecordingManager.populateModal(); // Re-populate to show new name and update data-attributes
                            TrackController.renderTracks(); // Update sound selectors
                        } else {
                            // If no change or empty, revert to original span
                            input.replaceWith(nameSpan);
                        }
                        input.removeEventListener('blur', handleRename);
                        input.removeEventListener('keydown', handleKeydown);
                    };

                    const handleKeydown = (e) => {
                        if (e.key === 'Enter') {
                            input.blur(); // Trigger blur to save
                        } else if (e.key === 'Escape') {
                            input.value = oldName; // Revert value
                            input.blur(); // Trigger blur to revert
                        }
                    };

                    input.addEventListener('blur', handleRename);
                    input.addEventListener('keydown', handleKeydown);
                }
            }
        });
    },

    openModal: () => {
        const modal = document.getElementById('manage-recordings-modal');
        RecordingManager.populateModal();
        modal.style.display = 'block';
    },

    populateModal: () => {
        const recordingsList = document.getElementById('recordings-list');
        const recordings = AppState.getRecordings();

        recordingsList.innerHTML = '';

        if (recordings.length === 0) {
            recordingsList.innerHTML = '<p>No recordings yet.</p>';
            return;
        }

        recordings.forEach(recordingName => {
            const recordingItem = document.createElement('div');
            recordingItem.className = 'recording-item';

            const nameSpan = document.createElement('span');
            nameSpan.textContent = recordingName;
            nameSpan.className = 'recording-name-display';
            recordingItem.appendChild(nameSpan);

            // Get and display duration
            const audioBuffer = AppState.getSoundBuffer(recordingName);
            if (audioBuffer) {
                const durationSpan = document.createElement('span');
                durationSpan.className = 'recording-duration';
                durationSpan.textContent = `(${formatDuration(audioBuffer.duration)})`;
                recordingItem.appendChild(durationSpan);
            }

            // Add Play button
            const playBtn = document.createElement('button');
            playBtn.className = 'play-recording-btn';
            playBtn.textContent = '▶';
            playBtn.dataset.recordingName = recordingName;
            recordingItem.appendChild(playBtn);

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'delete-recording-btn';
            deleteBtn.textContent = '✖';
            deleteBtn.dataset.recordingName = recordingName;
            recordingItem.appendChild(deleteBtn);

            // Add Rename button
            const renameBtn = document.createElement('button');
            renameBtn.className = 'rename-recording-btn';
            renameBtn.textContent = '✎';
            renameBtn.dataset.recordingName = recordingName;
            recordingItem.appendChild(renameBtn);

            recordingsList.appendChild(recordingItem);
        });
    }
};

export default RecordingManager;