const SLICE_COUNTS = [2, 3, 4, 6, 8];

export function getSliceCounts() {
  return [...SLICE_COUNTS];
}

export function normalizeSliceCount(value) {
  const count = Number.parseInt(value, 10);
  return SLICE_COUNTS.includes(count) ? count : 1;
}

export function getBeatSlots(bar) {
  const beats = Math.max(1, Number.parseInt(bar?.beats, 10) || 4);
  const subdivision = Number(bar?.subdivision) || 1;
  const slices = bar?.beatSlices && typeof bar.beatSlices === "object" ? bar.beatSlices : {};
  const total = subdivision < 1
    ? Math.max(1, Math.floor(beats * subdivision))
    : Math.round(beats * subdivision);
  const baseSlots = [];

  for (let index = 0; index < total; index += 1) {
    const sourceBeat = subdivision >= 1 ? Math.floor(index / subdivision) : index;
    baseSlots.push({
      index,
      baseIndex: index,
      mainBeat: subdivision === 1 || index === 0 || (subdivision > 1 && index % subdivision === 0),
      sourceBeat,
    });
  }

  const hasSlices = Object.keys(slices).length > 0;
  if (!hasSlices) return baseSlots;

  const slots = [];
  baseSlots.forEach((baseSlot) => {
    const sliceCount = normalizeSliceCount(slices[baseSlot.index]);
    const count = sliceCount > 1 ? sliceCount : 1;
    for (let slice = 0; slice < count; slice += 1) {
      slots.push({
        ...baseSlot,
        index: slots.length,
        slice,
        sliceCount: count > 1 ? count : undefined,
      });
    }
  });
  return slots;
}

export function getVisualBeatSlots(bar) {
  const slots = getBeatSlots({ ...bar, beatSlices: undefined });
  return Number(bar?.subdivision) === 1
    ? slots.map((slot) => ({ ...slot, mainBeat: true }))
    : slots;
}

export function getSlotInfo(bar, slotIndex) {
  return getBeatSlots(bar)[Math.max(0, Number.parseInt(slotIndex, 10) || 0)] || null;
}

export function getTotalSlots(bar) {
  return getBeatSlots(bar).length;
}

export function getSlotDurationSeconds(bar, slotIndex, secondsPerMainBeat) {
  const info = getSlotInfo(bar, slotIndex);
  const subdivision = Number(bar?.subdivision) || 1;
  if (info?.sliceCount > 1) {
    const baseDuration = subdivision >= 1 ? secondsPerMainBeat / subdivision : secondsPerMainBeat * (1 / subdivision);
    return baseDuration / info.sliceCount;
  }
  return subdivision >= 1 ? secondsPerMainBeat / subdivision : secondsPerMainBeat * (1 / subdivision);
}
