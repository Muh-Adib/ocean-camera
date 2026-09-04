// ---------------------------------------------------------------
// ChainRig — moves the WHOLE projection camera chain as ONE motion.
//
// The remote (phone QR) or the studio asks for a viewpoint; every
// enabled surface camera follows together, pivoting around the
// CENTER camera — the surface whose output slice sits closest to
// the middle of the projector canvas. Turning the rig is exactly
// like standing at the center camera and turning your head: all
// relative angles between cameras are preserved, so span-locked
// walls stay perfectly connected and the picture never breaks.
//
// The transform is applied at RENDER time (CameraManager reads the
// rig pose) — the saved project data is never mutated, so rigs can
// swing freely without polluting autosaves, sessions or undo.
// ---------------------------------------------------------------
import * as THREE from 'three'
import type { ProjectionSurface } from './ProjectionTypes'

const DEG = Math.PI / 180

/** one remote 'view' command, already JSON-shaped (all fields optional) */
export interface ChainViewPayload {
  /** absolute yaw target, degrees, -135..+135 (the 270° linked sweep) */
  yaw?: number
  /** absolute pitch target, degrees, -30..+30 */
  pitch?: number
  /** dolly the whole chain along the center camera's view, meters, -8..+8 */
  dolly?: number
  /** hands-free sweep — ping-pongs across the full yaw range */
  auto?: boolean
  /** sweep speed while auto (deg/s, 1..30) */
  speed?: number
  /** glide everything back to the saved poses */
  reset?: boolean
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

export class ChainRig {
  /** current (eased) offsets */
  yaw = 0
  pitch = 0
  dolly = 0
  /** targets the offsets glide toward */
  yawT = 0
  pitchT = 0
  dollyT = 0
  /** hands-free sweep */
  auto = false
  autoSpeed = 5
  /** sweep geometry — ±135° yaw = a 270° linked viewpoint range */
  readonly range = 135
  readonly pitchRange = 30
  readonly dollyRange = 8
  /** exponential ease rate (higher = snappier, still continuous) */
  ease = 4.2

  /** name of the center surface (readout/QA) */
  centerName: string | null = null

  /** live pose consumed by CameraManager.sync each frame */
  readonly pose = {
    active: false,
    yaw: 0,
    pitch: 0,
    dolly: 0,
    pivot: new THREE.Vector3(),
    forward: new THREE.Vector3(0, 0, -1),
  }

  private readonly up = new THREE.Vector3(0, 1, 0)

  /** apply a remote/studio view command (idempotent — safe to echo back) */
  applyView(v: ChainViewPayload | undefined | null) {
    if (!v) return
    if (v.reset === true) {
      this.auto = false
      this.yawT = 0
      this.pitchT = 0
      this.dollyT = 0
      return
    }
    if (finite(v.speed)) this.autoSpeed = clamp(v.speed, 1, 30)
    if (typeof v.auto === 'boolean') this.auto = v.auto
    if (this.auto) return   // the sweep owns the targets while auto
    if (finite(v.yaw)) this.yawT = clamp(v.yaw, -this.range, this.range)
    if (finite(v.pitch)) this.pitchT = clamp(v.pitch, -this.pitchRange, this.pitchRange)
    if (finite(v.dolly)) this.dollyT = clamp(v.dolly, -this.dollyRange, this.dollyRange)
  }

  /** glide back to the saved camera poses */
  reset() {
    this.applyView({ reset: true })
  }

  /** any offset engaged (or still gliding home)? */
  get engaged(): boolean {
    return this.auto ||
      Math.abs(this.yaw) > 0.01 || Math.abs(this.pitch) > 0.01 || Math.abs(this.dolly) > 0.01
  }

  /**
   * Per-frame tick: ease the offsets toward their targets, then compute
   * the render-time pose (pivot = center camera, forward = center camera's
   * rotated view direction for the dolly).
   */
  update(dt: number, surfaces: ProjectionSurface[], canvasW: number, canvasH: number) {
    if (this.auto) {
      // ping-pong sweep — reverses at the edges, never a jump
      this.yawT += this.autoSpeed * dt
      if (this.yawT >= this.range) {
        this.yawT = this.range
        this.autoSpeed = -Math.abs(this.autoSpeed)
      } else if (this.yawT <= -this.range) {
        this.yawT = -this.range
        this.autoSpeed = Math.abs(this.autoSpeed)
      }
    }
    const k = 1 - Math.exp(-Math.max(0, dt) * this.ease)
    this.yaw += (this.yawT - this.yaw) * k
    this.pitch += (this.pitchT - this.pitch) * k
    this.dolly += (this.dollyT - this.dolly) * k
    // settle exactly at rest so idle frames do zero work
    if (!this.auto) {
      if (Math.abs(this.yawT - this.yaw) < 0.004) this.yaw = this.yawT
      if (Math.abs(this.pitchT - this.pitch) < 0.004) this.pitch = this.pitchT
      if (Math.abs(this.dollyT - this.dolly) < 0.004) this.dolly = this.dollyT
    }
    this.computePose(surfaces, canvasW, canvasH)
  }

  private computePose(surfaces: ProjectionSurface[], canvasW: number, canvasH: number) {
    // center camera = the enabled surface whose output slice sits closest
    // to the middle of the projector canvas — that camera IS the pivot
    let best: ProjectionSurface | null = null
    let bestD = Infinity
    const w = Math.max(1, canvasW)
    const h = Math.max(1, canvasH)
    for (const s of surfaces) {
      if (!s.enabled) continue
      const dx = (s.output.x + s.output.width / 2) / w - 0.5
      const dy = (s.output.y + s.output.height / 2) / h - 0.5
      const d = dx * dx + dy * dy
      if (d < bestD) { bestD = d; best = s }
    }
    if (!best) {
      this.centerName = null
      this.pose.active = false
      return
    }
    this.centerName = best.name
    this.pose.pivot.set(best.camera.position[0], best.camera.position[1], best.camera.position[2])
    // the chain dollies along the CENTER camera's own (already-rotated) view
    const yawR = (best.camera.yaw + this.yaw) * DEG
    const pitchR = clamp(best.camera.pitch + this.pitch, -89, 89) * DEG
    const cp = Math.cos(pitchR)
    this.pose.forward.set(-Math.sin(yawR) * cp, Math.sin(pitchR), -Math.cos(yawR) * cp)
    this.pose.yaw = this.yaw
    this.pose.pitch = this.pitch
    this.pose.dolly = this.dolly
    this.pose.active = this.engaged
  }

  /** where the center camera sits after the rig motion (pivot + dolly) */
  transformedCenter(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.pose.pivot).addScaledVector(this.pose.forward, this.pose.dolly)
  }

  qaState() {
    const r1 = (v: number) => Math.round(v * 10) / 10
    return {
      engaged: this.engaged,
      auto: this.auto,
      autoSpeed: this.autoSpeed,
      yaw: r1(this.yaw),
      pitch: r1(this.pitch),
      dolly: r1(this.dolly),
      target: { yaw: r1(this.yawT), pitch: r1(this.pitchT), dolly: r1(this.dollyT) },
      range: { yaw: this.range, pitch: this.pitchRange, dolly: this.dollyRange },
      center: this.centerName,
    }
  }
}
