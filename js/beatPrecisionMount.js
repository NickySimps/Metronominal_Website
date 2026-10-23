const mounted = new WeakMap();

export async function initializeBeatPrecisionMount(root, interactionRoot, load = () => import('./beatPrecision.js')) {
  // Mixed cached markup must not disable the ordinary metronome controls.
  if (!root || !interactionRoot) return;
  if (mounted.has(root)) return mounted.get(root);
  const work = (async () => {
    try {
      const module = await load();
      return await module.initializeBeatPrecision(root, interactionRoot);
    } catch {
      root.textContent = 'Precision beat selection is unavailable. Normal beat controls still work; reload to retry.';
      console.warn('Precision beat selection unavailable');
    }
  })();
  mounted.set(root, work);
  return work;
}
