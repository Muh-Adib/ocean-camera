// ---------------------------------------------------------------
// vibrance — one global colour-punch control for the whole show.
//
// The operator's feedback was plain: "tampilannya kurang vibrance".
// Instead of re-tuning hundreds of material colours by hand, the
// compositor applies a single saturate/contrast grade to the final
// picture: a CSS filter on the WebGL canvas. Every pixel the
// audience sees — the main ocean view, the projection editor and
// every /output composite — picks up exactly the same boost, and
// the change is free (GPU colour-matrix) and reversible (a slider).
//
// The value is a PER-MACHINE display setting (like SCREEN FIT):
// projectors and control screens can disagree about taste without
// fighting over one project file.
// ---------------------------------------------------------------

const KEY = 'ocean-vibrance-v1'
export const VIBRANCE_MIN = 0.6
export const VIBRANCE_MAX = 1.6
export const VIBRANCE_DEFAULT = 1.2

let current = VIBRANCE_DEFAULT

/** read the persisted setting (falls back to the default) */
export function loadVibrance(): number {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const v = Number(raw)
      if (Number.isFinite(v)) current = clampV(v)
    }
  } catch { /* private mode — keep the default */ }
  return current
}

export function getVibrance(): number {
  return current
}

/** clamp helper without importing the math module (keeps this dependency-free) */
function clampV(v: number): number {
  return Math.min(VIBRANCE_MAX, Math.max(VIBRANCE_MIN, v))
}

/**
 * Set + persist + apply. `saturate()` lifts chroma; a touch of extra
 * contrast keeps deep blues from going milky at high settings.
 */
export function setVibrance(v: number, persist = true): number {
  current = clampV(v)
  if (persist) {
    try { localStorage.setItem(KEY, String(current)) } catch { /* private mode */ }
  }
  applyVibranceStyles()
  return current
}

/** CSS filter string for any canvas that shows the show */
export function vibranceFilter(): string {
  if (Math.abs(current - 1) < 0.005) return ''
  const contrast = 1 + (current - 1) * 0.12
  return `saturate(${current.toFixed(3)}) contrast(${contrast.toFixed(3)})`
}

/** push the grade onto every surface that renders the ocean */
export function applyVibranceStyles(): void {
  const filter = vibranceFilter()
  const targets = document.querySelectorAll<HTMLElement>('[data-ocean-gl], .pm-gl-preview')
  targets.forEach((el) => {
    el.style.filter = filter
  })
  for (const fn of listeners) fn(current)
}

const listeners = new Set<(v: number) => void>()

/** UI subscribe — sliders keep their position when another machine state loads */
export function onVibranceChange(fn: (v: number) => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}
