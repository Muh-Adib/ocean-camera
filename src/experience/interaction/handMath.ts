// ---------------------------------------------------------------
// handMath — pure hand-geometry helpers shared by the desktop
// HandTracker and the smartphone remote controller so BOTH ends
// produce byte-identical HandSamples (same mirroring, same
// openness/scale curves). No three.js, no DOM — safe everywhere.
// ---------------------------------------------------------------
import { clamp } from '../utils/math'
import type { HandSample, Landmark } from './HandTracker'

/** palm centre = wrist + finger MCP joints (MediaPipe landmark ids) */
const PALM_IDS = [0, 5, 9, 13, 17]
const TIP_IDS = [8, 12, 16, 20]

/**
 * Turn 21 raw MediaPipe landmarks into the ocean's control sample.
 * x is mirrored (selfie space) exactly like the desktop tracker, so
 * remote hands feel identical to hands in front of the laptop camera.
 */
export function extractHandSample(lm: Landmark[], now: number): HandSample {
  let px = 0, py = 0
  for (const i of PALM_IDS) { px += lm[i].x; py += lm[i].y }
  px /= PALM_IDS.length; py /= PALM_IDS.length

  // hand scale = wrist → middle-MCP distance (push/pull proxy)
  const dx = lm[9].x - lm[0].x
  const dy = lm[9].y - lm[0].y
  const scale = Math.hypot(dx, dy) || 0.001

  // openness = mean fingertip distance from wrist ÷ hand scale
  let sum = 0
  for (const i of TIP_IDS) {
    sum += Math.hypot(lm[i].x - lm[0].x, lm[i].y - lm[0].y)
  }
  const openness = clamp((sum / TIP_IDS.length / scale - 1.35) / 1.25, 0, 1)

  return {
    present: true,
    x: 1 - px,          // mirror for natural selfie-space control
    y: py,
    openness,
    scale,
    t: now,
  }
}

/** mirror landmarks once (x → 1-x) so overlays and networks agree */
export function mirrorLandmarks(lm: Landmark[]): Landmark[] {
  return lm.map((p) => ({ x: 1 - p.x, y: p.y, z: p.z }))
}
