// ---------------------------------------------------------------
// SpanChain — wall-ratio auto-fit + edge GLUING between cameras.
//
// WALL RATIO: the operator declares each surface's real proportions
// (1:1, 4:3, 2:3 …). The camera's horizontal span then DERIVES from
// its vertical span and that ratio, and the output slice refits so
// the picture lands on the wall unstretched — the camera width
// adjusts itself to the room instead of the operator hand-tuning
// angles.
//
// GLUE: surfaces whose cameras share one eye point form a wall ring.
// Whenever a member's span / ratio / yaw / pitch changes, every other
// member is re-aimed so neighbouring frustum edges meet EXACTLY —
// the picture stays one continuous panorama with no gaps, no
// duplicated content and no stolen view, no matter how different the
// individual wall ratios are.
// ---------------------------------------------------------------
import { cornersFromRect, type ProjectionSurface } from './ProjectionTypes'
import { gridFromCorners, spanHFromRatio } from './ProjectionMath'

const clampH = (h: number) => Math.min(359, Math.max(4, h))
const r2 = (n: number) => Math.round(n * 100) / 100

/** has this camera declared real-world proportions? */
export function hasRatio(c: ProjectionSurface['camera']): boolean {
  const r = c.span?.ratioW
  const h = c.span?.ratioH
  return typeof r === 'number' && r > 0 && typeof h === 'number' && h > 0
}

/**
 * Derive SPAN H from SPAN V and the declared wall ratio (no-op when
 * no ratio is set). Idempotent — safe to call on every sync.
 */
export function deriveSpanH(c: ProjectionSurface['camera']) {
  if (!c.span?.lock || !hasRatio(c)) return
  const derived = spanHFromRatio(c.span.v, c.span.ratioW! / c.span.ratioH!)
  c.span.h = r2(clampH(derived))
}

/**
 * Refit the OUTPUT slice to the wall ratio: same height, width
 * recomputed, centre kept. The warp grid follows the new rectangle
 * UNLESS the operator hand-shaped it (gridCustom) — hand work is
 * never destroyed.
 */
export function fitSliceToRatio(s: ProjectionSurface, ratio: number) {
  const rect = s.output
  const cx = rect.x + rect.width / 2
  const width = Math.max(32, Math.round(rect.height * Math.max(0.05, ratio)))
  rect.x = Math.round(cx - width / 2)
  rect.width = width
  if (!s.warp.gridCustom) {
    s.warp.corners = cornersFromRect(rect)
    s.warp.grid = gridFromCorners(s.warp.corners, s.warp.gridResolution)
  }
}

/**
 * Re-aim the wall ring around `anchorId` so every shared edge meets
 * exactly. Members keep their OWN horizontal span (their own ratio) —
 * only the aim rotates, so no wall steals another wall's view.
 * The anchor (the surface being edited) never moves.
 *
 * Ring membership: span-locked, enabled, unlocked, same camera eye
 * point, not a ceiling/floor (|pitch| ≥ 89°). All members adopt the
 * anchor's pitch and vertical span — walls of one room are level and
 * share the eye height, which is what keeps the seams continuous
 * VERTICALLY as well.
 *
 * Returns how many surfaces were re-aimed.
 */
export function glueWalls(surfaces: ProjectionSurface[], anchorId: string): number {
  const anchor = surfaces.find((s) => s.id === anchorId)
  if (!anchor || anchor.camera.span?.lock !== true) return 0
  if (Math.abs(anchor.camera.pitch) >= 89) return 0   // ceiling/floor glue differently

  const sameEye = (a: ProjectionSurface['camera'], b: ProjectionSurface['camera']) =>
    Math.abs(a.position[0] - b.position[0]) < 0.01 &&
    Math.abs(a.position[1] - b.position[1]) < 0.01 &&
    Math.abs(a.position[2] - b.position[2]) < 0.01

  const group = surfaces.filter((s) =>
    s.enabled && !s.locked &&
    s.id !== anchorId &&
    s.camera.span?.lock === true &&
    Math.abs(s.camera.pitch) < 89 &&
    sameEye(s.camera, anchor.camera))
  if (!group.length) return 0

  // level + uniform height across the ring (vertical continuity at seams)
  let moved = 0
  for (const s of group) {
    const c = s.camera
    if (Math.abs(c.pitch - anchor.camera.pitch) > 0.01) { c.pitch = anchor.camera.pitch; moved++ }
    if (Math.abs(c.span.v - anchor.camera.span.v) > 0.01) { c.span.v = anchor.camera.span.v; moved++ }
    deriveSpanH(c)          // each wall's width comes from its own ratio
  }
  deriveSpanH(anchor.camera)

  // re-aim: sort by yaw, walk out from the anchor, close every joint
  const ring = [...group, anchor].sort((a, b) => a.camera.yaw - b.camera.yaw)
  const ai = ring.findIndex((s) => s.id === anchorId)
  const half = (s: ProjectionSurface) => clampH(s.camera.span.h) / 2
  for (let i = ai + 1; i < ring.length; i++) {
    const prev = ring[i - 1]
    const want = r2(prev.camera.yaw + half(prev) + half(ring[i]))
    if (Math.abs(ring[i].camera.yaw - want) > 0.005) { ring[i].camera.yaw = want; moved++ }
  }
  for (let i = ai - 1; i >= 0; i--) {
    const next = ring[i + 1]
    const want = r2(next.camera.yaw - half(next) - half(ring[i]))
    if (Math.abs(ring[i].camera.yaw - want) > 0.005) { ring[i].camera.yaw = want; moved++ }
  }
  return moved
}

/**
 * Seam audit for QA: for the ring around `anchorId`, the worst edge
 * mismatch in degrees (0 = every joint closed). Two edges meet when
 * prev.yaw + prev.h/2 === next.yaw − next.h/2.
 */
export function seamAudit(surfaces: ProjectionSurface[], anchorId: string): { worst: number; joints: { a: string; b: string; gap: number }[] } {
  const anchor = surfaces.find((s) => s.id === anchorId)
  if (!anchor) return { worst: 0, joints: [] }
  const sameEye = (a: ProjectionSurface['camera'], b: ProjectionSurface['camera']) =>
    Math.abs(a.position[0] - b.position[0]) < 0.01 &&
    Math.abs(a.position[1] - b.position[1]) < 0.01 &&
    Math.abs(a.position[2] - b.position[2]) < 0.01
  const ring = surfaces.filter((s) =>
    s.enabled && s.camera.span?.lock === true &&
    Math.abs(s.camera.pitch) < 89 && sameEye(s.camera, anchor.camera))
    .sort((a, b) => a.camera.yaw - b.camera.yaw)
  const joints: { a: string; b: string; gap: number }[] = []
  let worst = 0
  for (let i = 0; i + 1 < ring.length; i++) {
    const a = ring[i], b = ring[i + 1]
    const gap = r2((b.camera.yaw - b.camera.span.h / 2) - (a.camera.yaw + a.camera.span.h / 2))
    joints.push({ a: a.name, b: b.name, gap })
    worst = Math.max(worst, Math.abs(gap))
  }
  return { worst: r2(worst), joints }
}
