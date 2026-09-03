// ---------------------------------------------------------------
// GestureEngine — turns raw hand samples into ocean intents.
// TWO hands are tracked side by side (local camera or the phone
// remote): each hand gets its own gesture channel with full
// swipe/push/pull/palm/fist analysis, so a swimming stroke —
// arms moving alternately — drives the ocean with both arms.
//
//   channel 0 → InteractionField.setTarget   (primary point)
//   channel 1 → InteractionField.setTarget2  (second point)
//
// Fast gestures produce strong reactions, slow ones subtle ones.
// ---------------------------------------------------------------
import * as THREE from 'three'
import type { Camera } from 'three'
import type { HandSample } from './HandTracker'
import { InteractionField, type FieldMode } from './InteractionField'
import { clamp, damp } from '../utils/math'

interface HistEntry { x: number; y: number; scale: number; t: number }

export interface GestureCallbacks {
  onSwipe?: (dir: 'left' | 'right' | 'up' | 'down', strength: number, point: THREE.Vector3, dirVec: THREE.Vector3) => void
  onPush?: (strength: number, point: THREE.Vector3) => void
  onPull?: (strength: number) => void
  onPalmStart?: (point: THREE.Vector3) => void
  onFistStart?: () => void
}

export type GestureName = 'idle' | 'current' | 'swipe' | 'push' | 'pull' | 'attract' | 'caution'

export interface GestureStatus {
  name: GestureName
  strength: number       // 0..1 reaction strength of the active gesture
  handPresent: boolean
  hands: number          // how many hands are currently tracked
  openness: number
  scaleRate: number      // push(+)/pull(-) rate
  vx: number             // hand velocity, normalized units/s
  vy: number
}

const SWIPE_SPEED = 0.82          // normalized units / s (tuned: easier to trigger)
const PUSH_RATE = 0.42            // scale units / s (tuned: easier push/pull)
const PALM_ON = 0.54              // open-palm threshold (tuned: easier to hold)
const PALM_OFF = 0.4
const FIST_ON = 0.27              // closed-fist threshold (tuned: more forgiving)
const FIST_OFF = 0.4

/** per-hand gesture state — one instance per tracked hand slot */
class HandChannel {
  hist: HistEntry[] = []
  smoothX = 0.5
  smoothY = 0.5
  vx = 0; vy = 0
  palmMode = false
  fistMode = false
  palmHold = 0
  fistHold = 0
  lastSwipe = 0
  lastPush = 0
  lastPull = 0
  scaleRate = 0
  name: GestureName = 'idle'
  strength = 0
  openness = 0
  wasPresent = false

  reset() {
    this.hist = []
    this.vx = 0; this.vy = 0
    this.palmMode = false; this.fistMode = false
    this.palmHold = 0; this.fistHold = 0
    this.name = 'idle'
    this.strength = 0
    this.wasPresent = false
  }
}

const GESTURE_PRIORITY: GestureName[] = ['push', 'swipe', 'pull', 'attract', 'caution', 'current', 'idle']

export class GestureEngine {
  private ch: [HandChannel, HandChannel] = [new HandChannel(), new HandChannel()]
  private worldPoint = new THREE.Vector3()
  private worldPoint2 = new THREE.Vector3()
  private dirVec = new THREE.Vector3()
  private ray = new THREE.Raycaster()

  /** live snapshot for HUD / gesture visualization panel */
  status: GestureStatus = { name: 'idle', strength: 0, handPresent: false, hands: 0, openness: 0, scaleRate: 0, vx: 0, vy: 0 }

  constructor(
    private camera: Camera,
    private field: InteractionField,
    private cb: GestureCallbacks = {},
  ) {}

  reset() {
    this.ch[0].reset()
    this.ch[1].reset()
    this.field.setTarget(null)
    this.field.setTarget2(null)
    this.field.setHandActive(false)
  }

  /** feed the latest tracker samples (already smoothed; 0–2 hands) */
  update(samples: HandSample[], dt: number) {
    const present = samples.length > 0
    this.field.setHandActive(present)

    for (let i = 0; i < 2; i++) {
      const sample = samples[i]
      if (sample) this.updateChannel(i as 0 | 1, sample, dt)
      else if (this.ch[i].wasPresent) {
        // hand lost → let its field die out naturally
        this.ch[i].reset()
        if (i === 0) this.field.setTarget(null)
        else this.field.setTarget2(null)
      }
    }

    // ---- merged status (primary channel drives the readouts) ----
    const p = this.ch[0]
    const s = this.status
    s.handPresent = present
    s.hands = samples.length
    s.openness = samples[0]?.openness ?? samples[1]?.openness ?? 0
    s.vx = p.vx
    s.vy = p.vy
    s.scaleRate = p.scaleRate
    // the most "active" gesture across both hands wins the readout
    let name: GestureName = 'idle'
    let strength = 0
    for (const g of GESTURE_PRIORITY) {
      const hit = this.ch.find((c) => c.name === g && c.strength > 0.02)
      if (hit) { name = g; strength = hit.strength; break }
    }
    s.name = name
    s.strength = strength
  }

  private updateChannel(ci: 0 | 1, sample: HandSample, dt: number) {
    const c = this.ch[ci]
    const wasPresent = c.wasPresent
    c.wasPresent = true
    c.openness = sample.openness

    const t = sample.t
    c.hist.push({ x: sample.x, y: sample.y, scale: sample.scale, t })
    while (c.hist.length > 2 && t - c.hist[0].t > 260) c.hist.shift()

    // smoothed position for continuous control
    const k = damp(10, Math.max(dt, 0.001))
    if (!wasPresent) { c.smoothX = sample.x; c.smoothY = sample.y }
    c.smoothX += (sample.x - c.smoothX) * k
    c.smoothY += (sample.y - c.smoothY) * k

    // velocity over ~140ms window (normalized units/s)
    const ref = c.hist.find((h) => t - h.t >= 120) ?? c.hist[0]
    const dtms = Math.max(30, t - ref.t)
    const rawVx = (sample.x - ref.x) / (dtms / 1000)
    const rawVy = (sample.y - ref.y) / (dtms / 1000)
    const kv = damp(9, Math.max(dt, 0.001))   // snappier velocity response
    c.vx += (rawVx - c.vx) * kv
    c.vy += (rawVy - c.vy) * kv

    const speed = Math.hypot(c.vx, c.vy)

    // scale rate → push / pull
    const scaleRef = c.hist.find((h) => t - h.t >= 180) ?? c.hist[0]
    c.scaleRate = (sample.scale - scaleRef.scale) / (Math.max(60, t - scaleRef.t) / 1000)
    const scaleRate = c.scaleRate

    // openness with hysteresis
    if (!c.palmMode && sample.openness > PALM_ON) c.palmHold += dt
    else if (c.palmMode && sample.openness < PALM_OFF) c.palmHold = 0
    if (!c.palmMode && c.palmHold > 0.16) {
      c.palmMode = true
      this.toWorld(c.smoothX, c.smoothY, 13, ci === 0 ? this.worldPoint : this.worldPoint2)
      this.cb.onPalmStart?.((ci === 0 ? this.worldPoint : this.worldPoint2).clone())
      this.field.gestureEvent('palm', 0.7)
    }
    if (c.palmMode && sample.openness < PALM_OFF) c.palmMode = false

    if (!c.fistMode && sample.openness < FIST_ON) c.fistHold += dt
    else if (c.fistMode && sample.openness > FIST_OFF) c.fistHold = 0
    if (!c.fistMode && c.fistHold > 0.16) {
      c.fistMode = true
      this.cb.onFistStart?.()
      this.field.gestureEvent('fist', 0.75)
    }
    if (c.fistMode && sample.openness > FIST_OFF) c.fistMode = false

    // ---- map to world & drive the field ----
    const depth = 13
    const wp = ci === 0 ? this.toWorld(c.smoothX, c.smoothY, depth, this.worldPoint) : this.toWorld(c.smoothX, c.smoothY, depth, this.worldPoint2)
    const setField = (dir: THREE.Vector3 | undefined, strength: number, mode: FieldMode) => {
      if (ci === 0) this.field.setTarget(wp, dir, strength, mode)
      else this.field.setTarget2(wp, dir, strength, mode)
    }

    const now = performance.now()

    if (c.palmMode) {
      // open palm → attraction beam, strength from steadiness
      c.name = 'attract'
      c.strength = 0.55 + sample.openness * 0.3
      setField(undefined, c.strength, 'attract')
    } else if (c.fistMode) {
      c.name = 'caution'
      c.strength = 0.6
      setField(undefined, 0.6, 'repel')
    } else if (scaleRate > PUSH_RATE && now - c.lastPush > 760 && speed < SWIPE_SPEED * 1.4) {
      // push: hand surges toward the camera
      const strength = clamp((scaleRate - PUSH_RATE) / 0.65, 0.35, 1)
      c.name = 'push'
      c.strength = strength
      c.lastPush = now
      this.cb.onPush?.(strength, wp.clone())
      this.field.gestureEvent('push', strength)
      setField(new THREE.Vector3(0, 0, 1), strength, 'push')
    } else if (scaleRate < -PUSH_RATE && now - c.lastPull > 900 && speed < SWIPE_SPEED * 1.4) {
      const strength = clamp((-scaleRate - PUSH_RATE) / 0.65, 0.3, 1)
      c.name = 'pull'
      c.strength = strength
      c.lastPull = now
      this.cb.onPull?.(strength)
      this.field.gestureEvent('pull', strength)
      setField(undefined, strength * 0.4, 'pull')
    } else if (speed > SWIPE_SPEED && now - c.lastSwipe > 520) {
      // swipe: dominant axis
      const ax = Math.abs(c.vx), ay = Math.abs(c.vy)
      if (Math.max(ax, ay) > 1e-3) {
        let dirName: 'left' | 'right' | 'up' | 'down'
        if (ax > ay) dirName = c.vx > 0 ? 'right' : 'left'
        else dirName = c.vy > 0 ? 'down' : 'up'
        const strength = clamp((speed - 0.4) / 1.5, 0.3, 1)
        c.name = 'swipe'
        c.strength = strength
        c.lastSwipe = now
        this.dirVec.set(
          ax > ay ? Math.sign(c.vx) : 0,
          ax > ay ? 0 : Math.sign(c.vy),
          0,
        )
        this.cb.onSwipe?.(dirName, strength, wp.clone(), this.dirVec.clone())
        this.field.gestureEvent('swipe', strength)
        setField(this.dirVec.clone(), strength, 'current')
      }
    } else {
      // continuous gentle current from hand motion
      const cur = clamp(speed / 1.25, 0, 0.65)
      c.name = speed > 0.08 ? 'current' : 'idle'
      c.strength = cur
      if (speed > 0.08) {
        this.dirVec.set(c.vx, -c.vy, 0).normalize()
        setField(this.dirVec.clone(), cur, 'current')
      } else {
        setField(undefined, 0.06, 'current')
      }
    }
  }

  /** screen (0..1) → world point on a ray at `depth` distance */
  private toWorld(nx: number, ny: number, depth: number, out: THREE.Vector3): THREE.Vector3 {
    const ndcX = nx * 2 - 1
    const ndcY = -(ny * 2 - 1)
    this.ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera)
    out.copy(this.ray.ray.origin).addScaledVector(this.ray.ray.direction, depth)
    // keep the field inside the living space
    out.x = clamp(out.x, -58, 58)
    out.y = clamp(out.y, -10, 13)
    out.z = clamp(out.z, -78, 12)
    return out
  }
}
