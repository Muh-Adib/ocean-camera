// ---------------------------------------------------------------
// GestureEngine — turns raw hand samples into ocean intents:
//   • continuous current (hand velocity → direction + strength)
//   • swipes L/R/U/D (fast dominant-axis movement)
//   • push / pull (hand scale change = depth proxy)
//   • open palm → attract    • closed fist → caution
// Fast gestures produce strong reactions, slow ones subtle ones.
// ---------------------------------------------------------------
import * as THREE from 'three'
import type { Camera } from 'three'
import type { HandSample } from './HandTracker'
import { InteractionField } from './InteractionField'
import { clamp, damp } from '../utils/math'

interface HistEntry { x: number; y: number; scale: number; t: number }

export interface GestureCallbacks {
  onSwipe?: (dir: 'left' | 'right' | 'up' | 'down', strength: number, point: THREE.Vector3, dirVec: THREE.Vector3) => void
  onPush?: (strength: number, point: THREE.Vector3) => void
  onPull?: (strength: number) => void
  onPalmStart?: (point: THREE.Vector3) => void
  onFistStart?: () => void
}

const SWIPE_SPEED = 0.82          // normalized units / s (tuned: easier to trigger)
const PUSH_RATE = 0.42            // scale units / s (tuned: easier push/pull)
const PALM_ON = 0.54              // open-palm threshold (tuned: easier to hold)
const PALM_OFF = 0.4
const FIST_ON = 0.27              // closed-fist threshold (tuned: more forgiving)
const FIST_OFF = 0.4

export class GestureEngine {
  private hist: HistEntry[] = []
  private smoothX = 0.5
  private smoothY = 0.5
  private vx = 0; private vy = 0
  private palmMode = false
  private fistMode = false
  private palmHold = 0
  private fistHold = 0
  private lastSwipe = 0
  private lastPush = 0
  private lastPull = 0
  private worldPoint = new THREE.Vector3()
  private dirVec = new THREE.Vector3()
  private ray = new THREE.Raycaster()

  constructor(
    private camera: Camera,
    private field: InteractionField,
    private cb: GestureCallbacks = {},
  ) {}

  reset() {
    this.hist = []
    this.vx = 0; this.vy = 0
    this.palmMode = false; this.fistMode = false
    this.palmHold = 0; this.fistHold = 0
  }

  /** feed the latest tracker sample (already smoothed) */
  update(sample: HandSample, dt: number) {
    if (!sample.present) {
      // hand lost → let the field die out naturally
      this.field.setHandActive(false)
      return
    }
    this.field.setHandActive(true)

    const t = sample.t
    this.hist.push({ x: sample.x, y: sample.y, scale: sample.scale, t })
    while (this.hist.length > 2 && t - this.hist[0].t > 260) this.hist.shift()

    // smoothed position for continuous control
    const k = damp(10, Math.max(dt, 0.001))
    this.smoothX += (sample.x - this.smoothX) * k
    this.smoothY += (sample.y - this.smoothY) * k

    // velocity over ~140ms window (normalized units/s)
    const ref = this.hist.find((h) => t - h.t >= 120) ?? this.hist[0]
    const dtms = Math.max(30, t - ref.t)
    const rawVx = (sample.x - ref.x) / (dtms / 1000)
    const rawVy = (sample.y - ref.y) / (dtms / 1000)
    const kv = damp(9, Math.max(dt, 0.001))   // snappier velocity response
    this.vx += (rawVx - this.vx) * kv
    this.vy += (rawVy - this.vy) * kv

    const speed = Math.hypot(this.vx, this.vy)

    // scale rate → push / pull
    const scaleRef = this.hist.find((h) => t - h.t >= 180) ?? this.hist[0]
    const scaleRate = (sample.scale - scaleRef.scale) / (Math.max(60, t - scaleRef.t) / 1000)

    // openness with hysteresis
    if (!this.palmMode && sample.openness > PALM_ON) this.palmHold += dt
    else if (this.palmMode && sample.openness < PALM_OFF) this.palmHold = 0
    if (!this.palmMode && this.palmHold > 0.16) {
      this.palmMode = true
      this.toWorld(this.smoothX, this.smoothY, 13, this.worldPoint)
      this.cb.onPalmStart?.(this.worldPoint.clone())
      this.field.gestureEvent('palm', 0.7)
    }
    if (this.palmMode && sample.openness < PALM_OFF) this.palmMode = false

    if (!this.fistMode && sample.openness < FIST_ON) this.fistHold += dt
    else if (this.fistMode && sample.openness > FIST_OFF) this.fistHold = 0
    if (!this.fistMode && this.fistHold > 0.16) {
      this.fistMode = true
      this.cb.onFistStart?.()
      this.field.gestureEvent('fist', 0.75)
    }
    if (this.fistMode && sample.openness > FIST_OFF) this.fistMode = false

    // ---- map to world & drive the field ----
    const depth = 13
    this.toWorld(this.smoothX, this.smoothY, depth, this.worldPoint)

    const now = performance.now()

    if (this.palmMode) {
      // open palm → attraction beam, strength from steadiness
      this.field.setTarget(this.worldPoint, undefined, 0.55 + sample.openness * 0.3, 'attract')
    } else if (this.fistMode) {
      this.field.setTarget(this.worldPoint, undefined, 0.6, 'repel')
    } else if (scaleRate > PUSH_RATE && now - this.lastPush > 760 && speed < SWIPE_SPEED * 1.4) {
      // push: hand surges toward the camera
      const strength = clamp((scaleRate - PUSH_RATE) / 0.65, 0.35, 1)
      this.lastPush = now
      this.cb.onPush?.(strength, this.worldPoint.clone())
      this.field.gestureEvent('push', strength)
      this.field.setTarget(this.worldPoint, new THREE.Vector3(0, 0, 1), strength, 'push')
    } else if (scaleRate < -PUSH_RATE && now - this.lastPull > 900 && speed < SWIPE_SPEED * 1.4) {
      const strength = clamp((-scaleRate - PUSH_RATE) / 0.65, 0.3, 1)
      this.lastPull = now
      this.cb.onPull?.(strength)
      this.field.gestureEvent('pull', strength)
      this.field.setTarget(this.worldPoint, undefined, strength * 0.4, 'pull')
    } else if (speed > SWIPE_SPEED && now - this.lastSwipe > 520) {
      // swipe: dominant axis
      const ax = Math.abs(this.vx), ay = Math.abs(this.vy)
      if (Math.max(ax, ay) > 1e-3) {
        let dirName: 'left' | 'right' | 'up' | 'down'
        if (ax > ay) dirName = this.vx > 0 ? 'right' : 'left'
        else dirName = this.vy > 0 ? 'down' : 'up'
        const strength = clamp((speed - 0.4) / 1.5, 0.3, 1)
        this.lastSwipe = now
        this.dirVec.set(
          ax > ay ? Math.sign(this.vx) : 0,
          ax > ay ? 0 : Math.sign(this.vy),
          0,
        )
        this.cb.onSwipe?.(dirName, strength, this.worldPoint.clone(), this.dirVec.clone())
        this.field.gestureEvent('swipe', strength)
        this.field.setTarget(this.worldPoint, this.dirVec, strength, 'current')
      }
    } else {
      // continuous gentle current from hand motion
      const cur = clamp(speed / 1.25, 0, 0.65)
      if (speed > 0.08) {
        this.dirVec.set(this.vx, -this.vy, 0).normalize()
        this.field.setTarget(this.worldPoint, this.dirVec, cur, 'current')
      } else {
        this.field.setTarget(this.worldPoint, undefined, 0.06, 'current')
      }
    }
  }

  /** screen (0..1) → world point on a ray at `depth` distance */
  private toWorld(nx: number, ny: number, depth: number, out: THREE.Vector3) {
    const ndcX = nx * 2 - 1
    const ndcY = -(ny * 2 - 1)
    this.ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera)
    out.copy(this.ray.ray.origin).addScaledVector(this.ray.ray.direction, depth)
    // keep the field inside the living space
    out.x = clamp(out.x, -36, 36)
    out.y = clamp(out.y, -10, 13)
    out.z = clamp(out.z, -44, 8)
  }
}
