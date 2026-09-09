// ---------------------------------------------------------------
// SpanLink — neighbour-aware SPAN editing for room walls.
//
// The operator's rule: "jika perubahannya untuk bagian yang ter-
// sambung dengan kamera lain tetap menyatu, tidak mengambil view
// bagian lain". Concretely, when one surface's angular span changes:
//   • an edge that is JOINED to a neighbour (within a few degrees,
//     the presets overlap 2°) stays pinned exactly where it was —
//     the seam never tears and the calibrated overlap never creeps;
//   • growth on a free side stops at the next wall's edge instead
//     of stealing its view (no duplicated content on two walls);
//   • surfaces STACKED on the edited wall (floor in front of a wall,
//     ceiling above it — same yaw interval, touching pitch) follow
//     the edit so the wall/floor seam keeps matching, and surfaces
//     in the same horizontal band (a 270°/360° wall ring) follow
//     SPAN V edits together so the band stays one straight strip.
//
// The same helper also powers the REAL-SIZE flow: the operator
// types a wall's physical width/height and viewing distance and the
// camera's angular coverage is derived automatically
// (span = 2·atan(size / 2 / distance)).
// ---------------------------------------------------------------
import type { ProjectionSurface } from './ProjectionTypes'

/** edges closer than this (deg) count as joined — presets overlap 2° */
export const SPAN_JOIN_TOL = 4

const DEG = Math.PI / 180
/** same virtual eye → the surfaces are walls of one room */
const EYE_EPS = 0.05

export type SpanAxis = 'h' | 'v'

export interface LinkedSpanResult {
  /** span actually applied (deg) — may differ from the request when a neighbour blocks */
  span: number
  /** yaw/pitch delta applied to keep pinned edges pinned (deg) */
  centerDelta: number
  pinnedStart: boolean
  pinnedEnd: boolean
  /** true when a (non-joined) neighbour stopped the span from reaching the request */
  blocked: boolean
  /** names of surfaces that followed the edit to keep their seams matched */
  followers: string[]
}

/** shortest signed difference between two angles (deg) */
function norm180(d: number): number {
  let x = d % 360
  if (x > 180) x -= 360
  if (x <= -180) x += 360
  return x
}

function sameEye(a: [number, number, number], b: [number, number, number]): boolean {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < EYE_EPS
}

export function linkedSpanEdit(
  surfaces: ProjectionSurface[],
  target: ProjectionSurface,
  axis: SpanAxis,
  requested: number,
): LinkedSpanResult {
  const cam = target.camera
  const span = cam.span
  const axisMax = axis === 'h' ? 359 : 179
  const curSpan = axis === 'h' ? span.h : span.v
  const center = axis === 'h' ? cam.yaw : cam.pitch
  const res: LinkedSpanResult = {
    span: Math.min(axisMax, Math.max(4, requested)),
    centerDelta: 0,
    pinnedStart: false,
    pinnedEnd: false,
    blocked: false,
    followers: [],
  }

  // everything is compared in a GLOBAL frame unwrapped around the TARGET's
  // center, so walls at any yaw (e.g. the ±90/180 walls of a ring) compare
  // correctly against the edited one
  const half = curSpan / 2
  const myStart = center - half
  const myEnd = center + half
  const centerOf = (o: ProjectionSurface) =>
    axis === 'h' ? center + norm180(o.camera.yaw - center) : o.camera.pitch
  const spanOf = (o: ProjectionSurface) => (axis === 'h' ? o.camera.span.h : o.camera.span.v)

  // ---- classify the other span-locked walls of this room ----
  const cand: { start: number; end: number }[] = []
  const companions: ProjectionSurface[] = []
  for (const o of surfaces) {
    if (o === target || !o.enabled || o.camera.span?.lock !== true) continue
    if (!sameEye(o.camera.position, cam.position)) continue
    const oSpan = spanOf(o)
    const oCenter = centerOf(o)
    const oStart = oCenter - oSpan / 2
    const oEnd = oCenter + oSpan / 2

    if (axis === 'h') {
      // companion = stacked on the same wall slice: equal yaw interval,
      // touching vertically (floor under a wall, ceiling above it)
      const sameInterval = Math.abs(norm180(oCenter - center)) <= SPAN_JOIN_TOL &&
        Math.abs(oSpan - curSpan) <= SPAN_JOIN_TOL
      const pitchGap = Math.abs(o.camera.pitch - cam.pitch)
      const touching = pitchGap <= (o.camera.span.v + span.v) / 2 + SPAN_JOIN_TOL
      if (sameInterval && touching) { companions.push(o); continue }
      // candidate only if it genuinely shares the yaw band (overlapping pitch)
      if (pitchGap >= (o.camera.span.v + span.v) / 2) continue
      if (sameInterval) continue   // stacked slices handled above — never self-pin
    } else {
      // v axis: companion = same horizontal band (equal pitch interval,
      // touching horizontally — the other walls of a ring)
      const sameInterval = Math.abs(oCenter - center) <= SPAN_JOIN_TOL &&
        Math.abs(oSpan - curSpan) <= SPAN_JOIN_TOL
      const yawGap = Math.abs(norm180(o.camera.yaw - cam.yaw))
      const touching = yawGap <= (o.camera.span.h + span.h) / 2 + SPAN_JOIN_TOL
      if (sameInterval && touching) { companions.push(o); continue }
      if (yawGap >= (o.camera.span.h + span.h) / 2) continue
      if (sameInterval) continue
    }
    cand.push({ start: oStart, end: oEnd })
  }

  // ---- pinned / blocking edges ----
  let pinStart: number | null = null
  let pinEnd: number | null = null
  let blockStart = -Infinity   // growth limit for myStart
  let blockEnd = Infinity      // growth limit for myEnd
  for (const iv of cand) {
    if (Math.abs(iv.end - myStart) <= SPAN_JOIN_TOL) pinStart = iv.end
    if (Math.abs(iv.start - myEnd) <= SPAN_JOIN_TOL) pinEnd = iv.start
    if (iv.end < myStart - SPAN_JOIN_TOL) blockStart = Math.max(blockStart, iv.end)
    if (iv.start > myEnd + SPAN_JOIN_TOL) blockEnd = Math.min(blockEnd, iv.start)
  }
  res.pinnedStart = pinStart !== null
  res.pinnedEnd = pinEnd !== null

  // ---- solve: keep joined edges joined, stop before foreign view ----
  let newStart: number
  let newEnd: number
  if (res.pinnedStart && res.pinnedEnd) {
    // joined on both sides — the wall is fully fitted; nothing can move
    return { ...res, span: curSpan, blocked: Math.abs(res.span - curSpan) > 1e-9 }
  } else if (res.pinnedEnd) {
    newEnd = pinEnd as number
    newStart = newEnd - res.span
    if (newStart < blockStart) { newStart = blockStart; newEnd = newStart + res.span; res.blocked = true }
  } else if (res.pinnedStart) {
    newStart = pinStart as number
    newEnd = newStart + res.span
    if (newEnd > blockEnd) { newEnd = blockEnd; newStart = newEnd - res.span; res.blocked = true }
  } else {
    // free both sides: keep the center, grow/shrink symmetrically until a wall
    newStart = myStart
    newEnd = myEnd + (res.span - curSpan)
    if (newEnd > blockEnd) { newEnd = blockEnd; res.blocked = true }
    if (newStart < blockStart) { newStart = blockStart; res.blocked = true }
    res.span = Math.min(axisMax, Math.max(4, newEnd - newStart))
    newEnd = newStart + res.span
  }
  res.span = newEnd - newStart
  res.centerDelta = (newStart + newEnd) / 2 - center

  // ---- apply to the target ----
  if (axis === 'h') {
    cam.yaw += res.centerDelta
    cam.span.h = Math.min(axisMax, Math.max(4, res.span))
  } else {
    cam.pitch = Math.min(95, Math.max(-95, cam.pitch + res.centerDelta))
    cam.span.v = Math.min(axisMax, Math.max(4, res.span))
  }

  // ---- followers move with the edit so their seams stay matched ----
  const dSpan = res.span - curSpan
  for (const f of companions) {
    if (axis === 'h') {
      f.camera.yaw += res.centerDelta
      f.camera.span.h = Math.min(359, Math.max(4, f.camera.span.h + dSpan))
    } else {
      f.camera.pitch = Math.min(95, Math.max(-95, f.camera.pitch + res.centerDelta))
      f.camera.span.v = Math.min(179, Math.max(4, f.camera.span.v + dSpan))
    }
    res.followers.push(f.name)
  }
  return res
}

/** physical wall size (m) + viewing distance (m) → angular span (deg) */
export function realSizeToSpan(w: number, h: number, dist: number): { h: number; v: number } {
  const d = Math.max(0.3, dist)
  const toDeg = (size: number) =>
    Math.min(179, Math.max(4, (2 * Math.atan(Math.max(0.01, size / 2) / d)) / DEG))
  return { h: toDeg(w), v: toDeg(h) }
}
