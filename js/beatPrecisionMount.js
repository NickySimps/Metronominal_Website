import { emitInteractionMotion } from './interactionMotion.js';

const mounted = new WeakMap();

export async function initializeBeatPrecisionMount(root, interactionRoot, load = () => import('./beatPrecision.js')) {
  // Mixed cached markup must not disable the ordinary metronome controls.
  if (!root || !interactionRoot) return;
  if (mounted.has(root)) return mounted.get(root);
  const work = (async () => {
    try {
      const module = await load();
      const controller = await module.initializeBeatPrecision(root, interactionRoot);
      if(controller && interactionRoot.isConnected)emitInteractionMotion(interactionRoot.querySelector?.('[data-beat-precision-toggle]') || root,'ready');
      return controller;
    } catch {
      root.textContent = 'Precision beat selection is unavailable. Normal beat controls still work; reload to retry.';
      console.warn('Precision beat selection unavailable');
      if(root.isConnected)emitInteractionMotion(root,'refuse');
    }
  })();
  mounted.set(root, work);
  return work;
}
