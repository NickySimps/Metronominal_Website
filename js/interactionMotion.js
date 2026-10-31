const runtimeByDocument = new WeakMap();

const SAVE_CLEANUP_TIMEOUT_MS = 200;
const DEFAULT_HOLD_DURATION_MS = 380;
const MIN_HOLD_DURATION_MS = 60;
const MAX_HOLD_DURATION_MS = 5000;
const HOLD_CLEANUP_GRACE_MS = 40;
const DRAG_IDLE_TIMEOUT_MS = 4000;
const LAYOUT_DURATION_MS = 165;
const LAYOUT_CLEANUP_TIMEOUT_MS = 190;
const MAX_ACTIVE_EFFECTS = 8;
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
const INTERACTIVE_CANDIDATE_SELECTOR =
  'button, input, select, textarea, [role="button"], [role="switch"]';
const DISABLED_CANDIDATE_QUERY = [
  'button:disabled',
  'input:disabled',
  'select:disabled',
  'textarea:disabled',
  'button[aria-disabled="true"]',
  'input[aria-disabled="true"]',
  'select[aria-disabled="true"]',
  'textarea[aria-disabled="true"]',
  '[role="button"][aria-disabled="true"]',
  '[role="switch"][aria-disabled="true"]'
].join(', ');

const KIND_SPECS = Object.freeze({
  // Stamp family
  save: Object.freeze({ family: 'stamp', glyph: 'check', dx: '0px', dy: '0px', tilt: '0deg' }),
  confirm: Object.freeze({ family: 'stamp', glyph: 'check', dx: '0px', dy: '0px', tilt: '0deg' }),
  ready: Object.freeze({ family: 'stamp', glyph: 'check', dx: '0px', dy: '0px', tilt: '0deg' }),
  learn: Object.freeze({ family: 'stamp', glyph: 'diamond', dx: '0px', dy: '0px', tilt: '0deg' }),

  // Travel family
  copy: Object.freeze({ family: 'travel', glyph: 'sheet', dx: '4px', dy: '-3px', tilt: '0deg' }),
  paste: Object.freeze({ family: 'travel', glyph: 'arrow-down', dx: '0px', dy: '4px', tilt: '0deg' }),
  load: Object.freeze({ family: 'travel', glyph: 'arrow-down', dx: '0px', dy: '4px', tilt: '0deg' }),
  upload: Object.freeze({ family: 'travel', glyph: 'arrow-up', dx: '0px', dy: '-5px', tilt: '0deg' }),
  download: Object.freeze({ family: 'travel', glyph: 'arrow-down', dx: '0px', dy: '5px', tilt: '0deg' }),
  cue: Object.freeze({ family: 'travel', glyph: 'arrow-right', dx: '5px', dy: '0px', tilt: '0deg' }),
  handoff: Object.freeze({ family: 'travel', glyph: 'arrow-right', dx: '6px', dy: '-2px', tilt: '0deg' }),

  // Dissolve family
  remove: Object.freeze({ family: 'dissolve', glyph: 'cross', dx: '0px', dy: '2px', tilt: '0deg' }),
  close: Object.freeze({ family: 'dissolve', glyph: 'cross', dx: '0px', dy: '0px', tilt: '0deg' }),
  cancel: Object.freeze({ family: 'dissolve', glyph: 'slash', dx: '0px', dy: '0px', tilt: '0deg' }),
  disconnect: Object.freeze({ family: 'dissolve', glyph: 'gap', dx: '0px', dy: '2px', tilt: '0deg' }),

  // Rewind family
  undo: Object.freeze({ family: 'rewind', glyph: 'arc-left', dx: '-4px', dy: '0px', tilt: '-3deg' }),
  redo: Object.freeze({ family: 'rewind', glyph: 'arc-right', dx: '4px', dy: '0px', tilt: '3deg' }),
  reset: Object.freeze({ family: 'rewind', glyph: 'arc-left', dx: '0px', dy: '0px', tilt: '-2deg' }),
  randomize: Object.freeze({ family: 'rewind', glyph: 'spark', dx: '0px', dy: '-2px', tilt: '2.5deg' }),

  // Reveal family
  open: Object.freeze({ family: 'reveal', glyph: 'frame', dx: '0px', dy: '0px', tilt: '0deg' }),
  connect: Object.freeze({ family: 'reveal', glyph: 'node', dx: '0px', dy: '0px', tilt: '0deg' }),
  section: Object.freeze({ family: 'reveal', glyph: 'frame', dx: '0px', dy: '0px', tilt: '0deg' }),
  'record-start': Object.freeze({ family: 'reveal', glyph: 'dot', dx: '0px', dy: '0px', tilt: '0deg' }),

  // Nudge family
  refuse: Object.freeze({ family: 'nudge', glyph: 'bar', dx: '4px', dy: '0px', tilt: '0deg' }),

  // Finite waiting family
  pending: Object.freeze({ family: 'waiting', glyph: 'dots', dx: '0px', dy: '0px', tilt: '0deg' }),
  queue: Object.freeze({ family: 'waiting', glyph: 'stack', dx: '2px', dy: '0px', tilt: '0deg' }),

  // Beat cell distinct families
  rest: Object.freeze({ family: 'rest', glyph: 'rest-bar', dx: '0px', dy: '0px', tilt: '0deg' }),
  accent: Object.freeze({ family: 'accent', glyph: 'chevron', dx: '0px', dy: '-3px', tilt: '0deg' }),
  ghost: Object.freeze({ family: 'ghost', glyph: 'soft-ring', dx: '0px', dy: '0px', tilt: '0deg' }),
  slice: Object.freeze({ family: 'slice', glyph: 'subdivide', dx: '0px', dy: '0px', tilt: '0deg' }),

  // Adjust family
  tempo: Object.freeze({ family: 'adjust', glyph: 'tick', dx: '0px', dy: '-2px', tilt: '0deg' }),
  volume: Object.freeze({ family: 'adjust', glyph: 'tick', dx: '0px', dy: '-2px', tilt: '0deg' }),
  theme: Object.freeze({ family: 'adjust', glyph: 'diamond', dx: '0px', dy: '0px', tilt: '0deg' }),
  quality: Object.freeze({ family: 'adjust', glyph: 'diamond', dx: '0px', dy: '0px', tilt: '0deg' }),
  trim: Object.freeze({ family: 'adjust', glyph: 'span', dx: '0px', dy: '0px', tilt: '0deg' }),
  select: Object.freeze({ family: 'adjust', glyph: 'pill', dx: '0px', dy: '0px', tilt: '0deg' }),
  toggle: Object.freeze({ family: 'adjust', glyph: 'pill', dx: '0px', dy: '0px', tilt: '0deg' }),
  rename: Object.freeze({ family: 'adjust', glyph: 'cursor', dx: '2px', dy: '0px', tilt: '0deg' }),
  compare: Object.freeze({ family: 'adjust', glyph: 'span', dx: '0px', dy: '0px', tilt: '0deg' }),
  audition: Object.freeze({ family: 'adjust', glyph: 'play', dx: '2px', dy: '0px', tilt: '0deg' }),
  play: Object.freeze({ family: 'adjust', glyph: 'play', dx: '2px', dy: '0px', tilt: '0deg' }),
  stop: Object.freeze({ family: 'adjust', glyph: 'square', dx: '0px', dy: '0px', tilt: '0deg' }),
  'record-stop': Object.freeze({ family: 'adjust', glyph: 'square', dx: '0px', dy: '0px', tilt: '0deg' }),
  sample: Object.freeze({ family: 'adjust', glyph: 'tick', dx: '0px', dy: '-2px', tilt: '0deg' }),
  range: Object.freeze({ family: 'adjust', glyph: 'span', dx: '0px', dy: '0px', tilt: '0deg' }),
  loop: Object.freeze({ family: 'adjust', glyph: 'loop', dx: '0px', dy: '0px', tilt: '0deg' }),
  adjust: Object.freeze({ family: 'adjust', glyph: 'tick', dx: '0px', dy: '-2px', tilt: '0deg' })
});

function isDocumentReady(doc) {
  return Boolean(
    doc &&
      typeof doc === 'object' &&
      doc.nodeType === 9 &&
      doc.body &&
      typeof doc.createElement === 'function'
  );
}

function getPreferredOverlayHost(doc) {
  const fsEl = doc?.fullscreenElement;
  if (fsEl && typeof fsEl === 'object' && fsEl.nodeType === 1 && fsEl.isConnected) {
    return fsEl;
  }
  return doc?.body || null;
}

function getReadyStateForTarget(target) {
  if (!target || typeof target !== 'object' || target.nodeType !== 1 || !target.isConnected) {
    return null;
  }
  const doc = target.ownerDocument;
  if (!isDocumentReady(doc)) {
    return null;
  }
  const state = runtimeByDocument.get(doc);
  if (!state || state.destroyed || !state.root || !state.root.isConnected) {
    return null;
  }
  return state;
}

function evictOldestIfNeeded(state) {
  while (state.activeEffects.size >= MAX_ACTIVE_EFFECTS) {
    const oldestDispose = state.activeEffects.values().next().value;
    if (typeof oldestDispose !== 'function') {
      state.activeEffects.clear();
      break;
    }
    oldestDispose();
  }
}

function isBeatGridProtected(el) {
  if (!el || typeof el !== 'object' || el.nodeType !== 1) {
    return true;
  }
  if (el.classList?.contains('beat-square') || el.classList?.contains('bar-visual')) {
    return true;
  }
  if (typeof el.closest === 'function' && el.closest('.beat-square, .bar-visual')) {
    return true;
  }
  if (typeof el.querySelector === 'function' && el.querySelector('.beat-square, .bar-visual')) {
    return true;
  }
  return false;
}

function isDisabledInteractiveCandidate(el) {
  if (!el || typeof el !== 'object' || el.nodeType !== 1 || !el.isConnected) {
    return false;
  }
  if (typeof el.matches !== 'function' || !el.matches(INTERACTIVE_CANDIDATE_SELECTOR)) {
    return false;
  }
  if (el.disabled === true) {
    return true;
  }
  try {
    if (el.matches(':disabled')) {
      return true;
    }
  } catch {
    // Ignore selector engine errors
  }
  return el.getAttribute('aria-disabled') === 'true';
}

function findDisabledCandidateFromPointerEvent(event, doc) {
  const directTarget =
    event?.target && typeof event.target === 'object' && event.target.nodeType === 1
      ? event.target
      : null;

  if (directTarget && typeof directTarget.closest === 'function') {
    const candidate = directTarget.closest(INTERACTIVE_CANDIDATE_SELECTOR);
    if (isDisabledInteractiveCandidate(candidate)) {
      return candidate;
    }
  }

  const x = event?.clientX;
  const y = event?.clientY;
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  if (typeof doc.elementsFromPoint === 'function') {
    for (const node of doc.elementsFromPoint(x, y)) {
      if (node && typeof node.closest === 'function') {
        const candidate = node.closest(INTERACTIVE_CANDIDATE_SELECTOR);
        if (isDisabledInteractiveCandidate(candidate)) {
          return candidate;
        }
      }
    }
  }

  const disabledNodes = doc.querySelectorAll(DISABLED_CANDIDATE_QUERY);
  for (const node of disabledNodes) {
    if (!isDisabledInteractiveCandidate(node)) {
      continue;
    }
    const rect = readVisibleTargetRect(node, doc);
    if (
      rect &&
      x >= rect.left &&
      x <= rect.left + rect.width &&
      y >= rect.top &&
      y <= rect.top + rect.height
    ) {
      return node;
    }
  }

  return null;
}

function applyRootAttributesAndStyles(root) {
  root.setAttribute('data-interaction-motion-root', '');
  root.setAttribute('aria-hidden', 'true');
  root.setAttribute('inert', '');
  root.inert = true;
  root.style.position = 'fixed';
  root.style.inset = '0px';
  root.style.width = '0px';
  root.style.height = '0px';
  root.style.overflow = 'visible';
  root.style.pointerEvents = 'none';
  root.style.zIndex = '2147483646';
  root.style.margin = '0px';
  root.style.padding = '0px';
  root.style.border = '0px';
}

function readVisibleTargetRect(target, doc) {
  if (!target || typeof target !== 'object' || target.nodeType !== 1 || !target.isConnected) {
    return null;
  }
  if (target.hidden || (typeof target.closest === 'function' && target.closest('[hidden]'))) {
    return null;
  }

  const view = doc.defaultView || globalThis;
  let computed = null;
  if (view && typeof view.getComputedStyle === 'function') {
    computed = view.getComputedStyle(target);
    if (
      !computed ||
      computed.display === 'none' ||
      computed.visibility === 'hidden' ||
      computed.visibility === 'collapse' ||
      Number.parseFloat(computed.opacity) === 0
    ) {
      return null;
    }
  }

  if (typeof target.getBoundingClientRect !== 'function') {
    return null;
  }
  const rect = target.getBoundingClientRect();
  if (
    !rect ||
    !Number.isFinite(rect.left) ||
    !Number.isFinite(rect.top) ||
    !Number.isFinite(rect.width) ||
    !Number.isFinite(rect.height) ||
    rect.width <= 0 ||
    rect.height <= 0
  ) {
    return null;
  }

  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    borderRadius: computed?.borderRadius || ''
  };
}

function createOverlayEffectDisposer(state, effect, timeoutMs) {
  let cleaned = false;
  let timerId = null;

  const cleanup = () => {
    if (cleaned) {
      return;
    }
    cleaned = true;
    if (timerId !== null) {
      state.clearTimer(timerId);
      timerId = null;
    }
    effect.removeEventListener('animationend', cleanup);
    effect.removeEventListener('animationcancel', cleanup);
    if (typeof effect.getAnimations === 'function') {
      for (const anim of effect.getAnimations()) {
        try {
          anim.cancel();
        } catch {
          // Ignore animation cancel errors
        }
      }
    }
    state.activeEffects.delete(cleanup);
    effect.remove();
  };

  const resetTimeout = (nextMs) => {
    if (cleaned) {
      return;
    }
    if (timerId !== null) {
      state.clearTimer(timerId);
    }
    timerId = state.setTimer(cleanup, nextMs);
  };

  effect.addEventListener('animationend', cleanup, { once: true });
  effect.addEventListener('animationcancel', cleanup, { once: true });
  timerId = state.setTimer(cleanup, timeoutMs);
  state.activeEffects.add(cleanup);

  return {
    cleanup,
    resetTimeout,
    isCleaned: () => cleaned
  };
}

export function initializeInteractionMotion(doc = globalThis.document) {
  try {
    if (!isDocumentReady(doc)) {
      return null;
    }

    const existing = runtimeByDocument.get(doc);
    if (existing && !existing.destroyed) {
      existing.syncRootHost();
      return existing.controller;
    }

    const staleRoots = doc.querySelectorAll('[data-interaction-motion-root]');
    for (const stale of staleRoots) {
      stale.remove();
    }

    const root = doc.createElement('div');
    applyRootAttributesAndStyles(root);
    const initialHost = getPreferredOverlayHost(doc);
    initialHost.appendChild(root);

    const activeEffects = new Set();
    const view = doc.defaultView || globalThis;
    const setTimer = typeof view?.setTimeout === 'function' ? view.setTimeout.bind(view) : setTimeout;
    const clearTimer = typeof view?.clearTimeout === 'function' ? view.clearTimeout.bind(view) : clearTimeout;
    const mediaQuery =
      typeof view?.matchMedia === 'function' ? view.matchMedia(REDUCED_MOTION_QUERY) : null;

    const clearActiveEffects = () => {
      for (const dispose of Array.from(activeEffects)) {
        try {
          dispose();
        } catch {
          // Ignore individual effect disposal errors
        }
      }
      activeEffects.clear();
    };

    const syncRootHost = () => {
      if (state.destroyed) {
        return;
      }
      const host = getPreferredOverlayHost(doc);
      if (host && root.parentElement !== host) {
        host.appendChild(root);
      }
    };

    const onReducedMotionChange = () => {
      clearActiveEffects();
    };

    const onViewportInvalidate = () => {
      clearActiveEffects();
    };

    const onVisibilityChange = () => {
      if (doc.visibilityState === 'hidden' || doc.hidden) {
        clearActiveEffects();
      }
    };

    const onFullscreenChange = () => {
      clearActiveEffects();
      syncRootHost();
    };

    const onDetailsToggle = (event) => {
      if (state.destroyed) {
        return;
      }
      const details = event?.target;
      if (!details || typeof details !== 'object' || details.nodeType !== 1) {
        return;
      }
      if (typeof details.tagName !== 'string' || details.tagName.toUpperCase() !== 'DETAILS') {
        return;
      }
      let summary = null;
      if (details.children) {
        for (const child of details.children) {
          if (typeof child.tagName === 'string' && child.tagName.toUpperCase() === 'SUMMARY') {
            summary = child;
            break;
          }
        }
      }
      const visualTarget = summary && readVisibleTargetRect(summary, doc) ? summary : details;
      const kind = details.open ? 'open' : 'close';
      emitInteractionMotion(visualTarget, kind);
    };

    const onPointerDownCapture = (event) => {
      if (state.destroyed) {
        return;
      }
      if (typeof event?.button === 'number' && event.button > 0) {
        return;
      }
      const candidate = findDisabledCandidateFromPointerEvent(event, doc);
      if (candidate) {
        emitInteractionMotion(candidate, 'refuse');
      }
    };

    if (mediaQuery) {
      if (typeof mediaQuery.addEventListener === 'function') {
        mediaQuery.addEventListener('change', onReducedMotionChange);
      } else if (typeof mediaQuery.addListener === 'function') {
        mediaQuery.addListener(onReducedMotionChange);
      }
    }

    doc.addEventListener('toggle', onDetailsToggle, true);
    doc.addEventListener('pointerdown', onPointerDownCapture, true);
    doc.addEventListener('scroll', onViewportInvalidate, true);
    doc.addEventListener('visibilitychange', onVisibilityChange);
    doc.addEventListener('fullscreenchange', onFullscreenChange);

    if (view && typeof view.addEventListener === 'function') {
      view.addEventListener('scroll', onViewportInvalidate);
      view.addEventListener('resize', onViewportInvalidate);
      view.addEventListener('blur', onViewportInvalidate);
    }

    const state = {
      doc,
      view,
      root,
      activeEffects,
      clearActiveEffects,
      syncRootHost,
      setTimer,
      clearTimer,
      mediaQuery,
      onReducedMotionChange,
       destroyed: false,
      controller: null
    };

    const controller = Object.freeze({
      clear() {
        if (state.destroyed) {
          return;
        }
        state.clearActiveEffects();
      },
      destroy() {
        if (state.destroyed) {
          return;
        }
        state.destroyed = true;
        if (state.mediaQuery) {
          try {
            if (typeof state.mediaQuery.removeEventListener === 'function') {
              state.mediaQuery.removeEventListener('change', state.onReducedMotionChange);
            } else if (typeof state.mediaQuery.removeListener === 'function') {
              state.mediaQuery.removeListener(state.onReducedMotionChange);
            }
          } catch {
            // Ignore listener removal errors
          }
        }
        try {
          doc.removeEventListener('toggle', onDetailsToggle, true);
          doc.removeEventListener('pointerdown', onPointerDownCapture, true);
          doc.removeEventListener('scroll', onViewportInvalidate, true);
          doc.removeEventListener('visibilitychange', onVisibilityChange);
          doc.removeEventListener('fullscreenchange', onFullscreenChange);
        } catch {
          // Ignore document listener removal errors
        }
        if (view && typeof view.removeEventListener === 'function') {
          try {
            view.removeEventListener('scroll', onViewportInvalidate);
            view.removeEventListener('resize', onViewportInvalidate);
            view.removeEventListener('blur', onViewportInvalidate);
          } catch {
            // Ignore window listener removal errors
          }
        }
        state.clearActiveEffects();
        try {
          state.root.remove();
        } catch {
          // Ignore DOM removal errors
        }
        if (runtimeByDocument.get(doc) === state) {
          runtimeByDocument.delete(doc);
        }
      }
    });

    state.controller = controller;
    runtimeByDocument.set(doc, state);
    return controller;
  } catch {
    return null;
  }
}

export function emitInteractionMotion(target, kind, options = {}) {
  try {
    void options;
    if (typeof kind !== 'string' || !Object.prototype.hasOwnProperty.call(KIND_SPECS, kind)) {
      return false;
    }
    const spec = KIND_SPECS[kind];
    const state = getReadyStateForTarget(target);
    if (!state) {
      return false;
    }

    const geometry = readVisibleTargetRect(target, state.doc);
    if (!geometry) {
      return false;
    }

    state.syncRootHost();
    evictOldestIfNeeded(state);

    const effect = state.doc.createElement('div');
    effect.setAttribute('data-motion-kind', kind);
    effect.setAttribute('data-motion-family', spec.family);
    effect.setAttribute('data-motion-glyph', spec.glyph);
    effect.setAttribute('aria-hidden', 'true');
    effect.style.position = 'fixed';
    effect.style.left = `${geometry.left}px`;
    effect.style.top = `${geometry.top}px`;
    effect.style.width = `${geometry.width}px`;
    effect.style.height = `${geometry.height}px`;
    effect.style.pointerEvents = 'none';
    effect.style.setProperty('--motion-dx', spec.dx);
    effect.style.setProperty('--motion-dy', spec.dy);
    effect.style.setProperty('--motion-tilt', spec.tilt);
    if (geometry.borderRadius) {
      effect.style.setProperty('--motion-target-radius', geometry.borderRadius);
    }

    createOverlayEffectDisposer(state, effect, SAVE_CLEANUP_TIMEOUT_MS);
    state.root.appendChild(effect);
    return true;
  } catch {
    return false;
  }
}

export function beginInteractionHold(target, options = {}) {
  try {
    const state = getReadyStateForTarget(target);
    if (!state) {
      return null;
    }

    const geometry = readVisibleTargetRect(target, state.doc);
    if (!geometry) {
      return null;
    }

    const rawDuration = Number(options?.duration);
    const duration = Number.isFinite(rawDuration) && rawDuration > 0
      ? Math.min(Math.max(Math.round(rawDuration), MIN_HOLD_DURATION_MS), MAX_HOLD_DURATION_MS)
      : DEFAULT_HOLD_DURATION_MS;

    const hasPoint = Number.isFinite(options?.x) && Number.isFinite(options?.y);
    const ringSize = Math.min(Math.max(Math.min(geometry.width, geometry.height), 36), 64);
    const left = hasPoint ? options.x - ringSize / 2 : geometry.left;
    const top = hasPoint ? options.y - ringSize / 2 : geometry.top;
    const width = hasPoint ? ringSize : geometry.width;
    const height = hasPoint ? ringSize : geometry.height;

    state.syncRootHost();
    evictOldestIfNeeded(state);

    const ring = state.doc.createElement('div');
    ring.setAttribute('data-motion-kind', 'hold');
    ring.setAttribute('data-motion-family', 'hold');
    ring.setAttribute('data-motion-glyph', 'ring');
    ring.setAttribute('aria-hidden', 'true');
    ring.style.position = 'fixed';
    ring.style.left = `${left}px`;
    ring.style.top = `${top}px`;
    ring.style.width = `${width}px`;
    ring.style.height = `${height}px`;
    ring.style.pointerEvents = 'none';
    ring.style.setProperty('--motion-hold-duration', `${duration}ms`);
    if (hasPoint) {
      ring.style.borderRadius = '999px';
    } else if (geometry.borderRadius) {
      ring.style.setProperty('--motion-target-radius', geometry.borderRadius);
    }

    const { cleanup } = createOverlayEffectDisposer(
      state,
      ring,
      duration + HOLD_CLEANUP_GRACE_MS
    );
    state.root.appendChild(ring);

    return Object.freeze({
      cancel() {
        cleanup();
      },
      finish() {
        cleanup();
      }
    });
  } catch {
    return null;
  }
}

export function beginInteractionDrag(target, options = {}) {
  try {
    const state = getReadyStateForTarget(target);
    if (!state) {
      return null;
    }

    const geometry = readVisibleTargetRect(target, state.doc);
    if (!geometry) {
      return null;
    }

    const startX = Number.isFinite(options?.x) ? options.x : geometry.left + geometry.width / 2;
    const startY = Number.isFinite(options?.y) ? options.y : geometry.top + geometry.height / 2;

    state.syncRootHost();
    evictOldestIfNeeded(state);

    const ghost = state.doc.createElement('div');
    ghost.setAttribute('data-motion-kind', 'drag');
    ghost.setAttribute('data-motion-family', 'drag');
    ghost.setAttribute('data-motion-glyph', 'grip');
    ghost.setAttribute('aria-hidden', 'true');
    ghost.style.position = 'fixed';
    ghost.style.left = `${geometry.left}px`;
    ghost.style.top = `${geometry.top}px`;
    ghost.style.width = `${geometry.width}px`;
    ghost.style.height = `${geometry.height}px`;
    ghost.style.pointerEvents = 'none';
    ghost.style.transform = 'translate3d(0px, 0px, 0px)';
    if (geometry.borderRadius) {
      ghost.style.setProperty('--motion-target-radius', geometry.borderRadius);
    }

    const { cleanup, resetTimeout, isCleaned } = createOverlayEffectDisposer(
      state,
      ghost,
      DRAG_IDLE_TIMEOUT_MS
    );
    state.root.appendChild(ghost);

    return Object.freeze({
      move(x, y) {
        if (isCleaned() || !Number.isFinite(x) || !Number.isFinite(y)) {
          return false;
        }
        const dx = x - startX;
        const dy = y - startY;
        ghost.style.transform = `translate3d(${dx}px, ${dy}px, 0px)`;
        resetTimeout(DRAG_IDLE_TIMEOUT_MS);
        return true;
      },
      cancel() {
        cleanup();
      },
      finish(destination) {
        void destination;
        cleanup();
      }
    });
  } catch {
    return null;
  }
}

export function captureInteractionLayout(elements) {
  const entries = new Map();
  try {
    if (!elements || typeof elements[Symbol.iterator] !== 'function') {
      return Object.freeze({ entries });
    }
    for (const el of elements) {
      if (isBeatGridProtected(el)) {
        continue;
      }
      const state = getReadyStateForTarget(el);
      if (!state) {
        continue;
      }
      const rect = readVisibleTargetRect(el, state.doc);
      if (!rect) {
        continue;
      }
      entries.set(el, {
        doc: state.doc,
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height
      });
    }
  } catch {
    // Ignore capture errors
  }
  return Object.freeze({ entries });
}

export function animateInteractionLayout(snapshot, currentElements) {
  try {
    const entries = snapshot?.entries;
    if (!(entries instanceof Map) || entries.size === 0) {
      return 0;
    }

    const candidates =
      currentElements && typeof currentElements[Symbol.iterator] === 'function'
        ? currentElements
        : entries.keys();

    let animatedCount = 0;

    for (const el of candidates) {
      const prev = entries.get(el);
      if (!prev || isBeatGridProtected(el)) {
        continue;
      }
      const state = getReadyStateForTarget(el);
      if (!state || state.doc !== prev.doc) {
        continue;
      }
      if (state.mediaQuery?.matches) {
        continue;
      }
      const next = readVisibleTargetRect(el, state.doc);
      if (!next) {
        continue;
      }
      const dx = prev.left - next.left;
      const dy = prev.top - next.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
        continue;
      }
      if (typeof el.animate !== 'function') {
        continue;
      }

      evictOldestIfNeeded(state);

      const animation = el.animate(
        [
          { transform: `translate3d(${dx}px, ${dy}px, 0px)` },
          { transform: 'translate3d(0px, 0px, 0px)' }
        ],
        {
          duration: LAYOUT_DURATION_MS,
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
          iterations: 1,
          fill: 'none'
        }
      );

      let cleaned = false;
      let timerId = null;

      const cleanup = () => {
        if (cleaned) {
          return;
        }
        cleaned = true;
        if (timerId !== null) {
          state.clearTimer(timerId);
          timerId = null;
        }
        try {
          animation.onfinish = null;
          animation.oncancel = null;
          animation.cancel();
        } catch {
          // Ignore animation cancel errors
        }
        state.activeEffects.delete(cleanup);
      };

      animation.onfinish = cleanup;
      animation.oncancel = cleanup;
      timerId = state.setTimer(cleanup, LAYOUT_CLEANUP_TIMEOUT_MS);
      state.activeEffects.add(cleanup);
      animatedCount += 1;
    }

    return animatedCount;
  } catch {
    return 0;
  }
}
