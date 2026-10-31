import Oscilloscope from './oscilloscope.js';
import { emitInteractionMotion } from './interactionMotion.js';

// A device preference, deliberately not part of AppState or any room/preset payload.
const STORAGE_KEY = 'metronominal.visualizationQuality';
const MODES = ['auto', 'full', 'reduced', 'off'];
const controllers = new WeakMap();

export function initializeAdaptiveVisualization(root) {
  if (!root) return null; // Allow cached markup without the new mount point.
  if (controllers.has(root)) return controllers.get(root);
  const panel = document.createElement('div');
  panel.className = 'adaptive-visualization';
  const label = document.createElement('label');
  label.textContent = 'Visualization quality';
  const select = document.createElement('select');
  select.setAttribute('aria-label', 'Visualization quality');
  MODES.forEach(mode => {
    const option = document.createElement('option');
    option.value = mode; option.textContent = mode[0].toUpperCase() + mode.slice(1);
    select.append(option);
  });
  label.append(select);
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.setAttribute('aria-atomic', 'true');
  panel.append(label, status); root.append(panel);
  let preference = 'auto';
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (MODES.includes(saved)) preference = saved;
  } catch { /* Private browsing/storage denial: keep a session preference. */ }
  select.value = preference;
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let tier = 'full';
  let windowStart = null, samples = 0, intervalTotal = 0, costTotal = 0;
  let slowWindows = 0, healthyWindows = 0;
  const resetMeasurement = () => {
    windowStart = null; samples = 0; intervalTotal = 0; costTotal = 0;
    slowWindows = 0; healthyWindows = 0;
  };
  function apply() {
    let effective = preference === 'auto' ? tier : preference;
    let reason = preference === 'auto' ? (tier === 'reduced' ? 'observed frame budget' : 'observing frame budget') : 'your device preference';
    if (preference === 'auto' && motion.matches) { effective = 'off'; reason = 'system reduced motion'; }
    if (document.hidden) { effective = 'off'; reason = 'tab hidden'; }
    const fps = effective === 'off' ? 0 : effective === 'reduced' ? 20 : 60;
    Oscilloscope.setRenderingPolicy({ fps, effects: effective === 'full', onFrame: observe });
    const text = `${effective[0].toUpperCase() + effective.slice(1)}${fps ? ` · up to ${fps} fps` : ' · drawing paused'} — ${reason}. Audio is unchanged. Device only.`;
    if (status.textContent !== text) status.textContent = text;
  }
  function observe({ timestamp, interval, cost }) {
    if (preference !== 'auto' || motion.matches || document.hidden) return;
    if (windowStart === null) windowStart = timestamp;
    if (interval > 0) { samples++; intervalTotal += interval; costTotal += cost; }
    if (timestamp - windowStart < 1000 || samples < 8) return;
    const average = intervalTotal / samples, renderCost = costTotal / samples;
    slowWindows = average > 28 || renderCost > 14 ? slowWindows + 1 : 0;
    healthyWindows = average < 22 && renderCost < 8 ? healthyWindows + 1 : 0;
    windowStart = timestamp; samples = 0; intervalTotal = 0; costTotal = 0;
    if (tier === 'full' && slowWindows >= 2) { tier = 'reduced'; resetMeasurement(); apply(); }
    else if (tier === 'reduced' && healthyWindows >= 6) { tier = 'full'; resetMeasurement(); apply(); }
  }
  const environmentChanged = () => { resetMeasurement(); apply(); };
  const changed = () => {
    const previous = preference;
    preference = select.value;
    try { localStorage.setItem(STORAGE_KEY, preference); } catch { /* Session only. */ }
    tier = 'full'; resetMeasurement(); apply();
    if (preference !== previous) emitInteractionMotion(select, 'quality');
  };
  select.addEventListener('change', changed);
  motion.addEventListener('change', environmentChanged);
  document.addEventListener('visibilitychange', environmentChanged);
  const controller = {
    getState: () => ({ preference, tier, fps: Oscilloscope.renderingPolicy.fps }),
    destroy() {
      select.removeEventListener('change', changed);
      motion.removeEventListener('change', environmentChanged);
      document.removeEventListener('visibilitychange', environmentChanged);
      Oscilloscope.setRenderingPolicy({ fps: document.hidden ? 0 : 60, effects: true, onFrame: null });
      panel.remove(); controllers.delete(root);
    },
  };
  controllers.set(root, controller);
  apply();
  return controller;
}
