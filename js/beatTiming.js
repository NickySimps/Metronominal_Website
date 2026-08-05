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
  const slots = [];

  // Existing bar-wide subdivisions retain their established timing. Slice mode
  // adds extra slots only to individual main beats at quarter-note resolution.
  if (subdivision < 1 || Object.keys(slices).length === 0) {
    const total = subdivision < 1
      ? Math.max(1, Math.floor(beats * subdivision))
      : Math.round(beats * subdivision);
    for (let index = 0; index < total; index += 1) {
      const sourceBeat = subdivision >= 1 ? Math.floor(index / subdivision) : index;
      slots.push({ index, mainBeat: index === 0 || (subdivision > 1 && index % subdivision === 0), sourceBeat });
    }
    return slots;
  }

  const baseSlotsPerBeat = Math.max(1, Math.round(subdivision));
  for (let sourceBeat = 0; sourceBeat < beats; sourceBeat += 1) {
    const count = baseSlotsPerBeat * (normalizeSliceCount(slices[sourceBeat]) || 1);
    for (let slice = 0; slice < count; slice += 1) {
      slots.push({
        index: slots.length,
        mainBeat: slice === 0,
        sourceBeat,
        slice,
        sliceCount: count,
      });
    }
  }
  return slots;
}

export function getSlotInfo(bar, slotIndex) {
  return getBeatSlots(bar)[Math.max(0, Number.parseInt(slotIndex, 10) || 0)] || null;
}

export function getTotalSlots(bar) {
  return getBeatSlots(bar).length;
}

export function getSlotDurationSeconds(bar, slotIndex, secondsPerMainBeat) {
  const info = getSlotInfo(bar, slotIndex);
  if (info?.sliceCount > 1) return secondsPerMainBeat / info.sliceCount;
  const subdivision = Number(bar?.subdivision) || 1;
  return subdivision >= 1 ? secondsPerMainBeat / subdivision : secondsPerMainBeat * (1 / subdivision);
}
