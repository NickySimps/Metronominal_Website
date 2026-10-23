import { initializeRehearsalRoomControls } from './rehearsalRoomController.js';
import { initializeHistoryControls } from './editHistory.js';
import { initializeRehearsalLibrary } from './rehearsalLibrary.js';
import { initializeAdaptiveVisualization } from './adaptiveVisualization.js';

const initialized = new WeakSet();
export async function initializeRehearsalTools(root) {
  // Old cached HTML can lack the mount; do not interfere with the metronome.
  if (!root || initialized.has(root)) return;
  initialized.add(root);
  const document = root.ownerDocument;
  const status = document.getElementById('rehearsal-tools-status');
  const failed = [];
  for (const [id, label, initialize] of [
    ['room', 'Room readiness and control', initializeRehearsalRoomControls],
    ['history', 'Undo and redo', initializeHistoryControls],
    ['library', 'Cues and setlists', initializeRehearsalLibrary],
    ['visual', 'Adaptive visualization', initializeAdaptiveVisualization],
  ]) {
    const section = document.createElement('div');
    section.id = `rehearsal-${id}-root`;
    section.className = 'rehearsal-feature';
    root.append(section);
    try { await initialize(section); }
    catch {
      failed.push(label);
      section.textContent = `${label} is unavailable. Reload to retry; the metronome remains usable.`;
      console.warn(`Rehearsal feature unavailable: ${id}`);
    }
  }
  if (status) status.textContent = failed.length
    ? `Unavailable: ${failed.join(', ')}. Other rehearsal controls are ready.`
    : 'Room actions respect host authority. Personal listening and visualization preferences stay on this device.';
}
