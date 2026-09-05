// ---------------------------------------------------------------
// RemoteRig — one rigid transform shared by EVERY projection
// camera, driven from the phone remote and smoothed every frame.
//
// Why rigid? Adjacent walls tile seamlessly only while their
// cameras keep the exact same relative pose. Orbiting / panning /
// dollying the whole constellation as ONE rigid body keeps every
// frustum edge meeting its neighbour exactly — the walls can never
// tear apart, at any angle, at any distance. (Per-camera movement
// is what used to break the picture at the edges.)
//
// Feel: the phone sends stick VELOCITIES (deflection = speed, not
// position). The rig integrates them into target offsets and glides
// the current offsets toward the targets with exponential damping,
// so packet jitter, stick re-centring and limit hits all look like
// one continuous fluid motion — never a step.
//
// Limits are SOFT: as an offset approaches its bound the available
// speed is eased down (a rubber band), so the view decelerates to a
// stop instead of slamming into a hard wall.
// ---------------------------------------------------------------
import * as THREE from 'three'

export interface RigState {
  /** orbit around the pivot (deg) — yaw + pitch */
  yaw: number
  pitch: number
  /** dolly: glide the constellation along its mean view direction (world units) */
  dolly: number
  /** strafe along the mean right axis (world units) */
  strafe: number
  /** lift along world Y (world units) */
  lift: number
}

/** velocity gains — full stick deflection per second */
const GAIN = {
  yaw: 90,       // deg/s
  pitch: 55,     // deg/s
  dolly: 16,     // units/s
  strafe: 14,    // units/s
  lift: 10,      // units/s
}

/** hard bounds (soft-eased just before them) */
const LIMITS = {
  pitch: 62,     // deg
  dolly: [-14, 26],
  strafe: [-16, 16],
  lift: [-7, 9],
}

/** exponential smoothing rate — higher = snappier, lower = dreamier */
const DAMP = 7.5

export class RemoteRig {
  /** smoothed, applied every frame */
  cur: RigState = { yaw: 0, pitch: 0, dolly: 0, strafe: 0, lift: 0 }
  /** integration targets */
  private target: RigState = { yaw: 0, pitch: 0, dolly: 0, strafe: 0, lift: 0 }
  /** stick velocities received from the phone (−1..1) */
  private vel = { mx: 0, my: 0, ox: 0, oy: 0, dz: 0 }
  /** phone camera mode → sticks stay live even without input */
  enabled = false
  /** true while any stick is deflected (screens may show a HINT) */
  active = false

  /** feed one control packet (already validated by RemoteLink) */
  apply(v: { mx?: number; my?: number; ox?: number; oy?: number; dz?: number }) {
    this.vel.mx = clamp1(v.mx ?? 0)
    this.vel.my = clamp1(v.my ?? 0)
    this.vel.ox = clamp1(v.ox ?? 0)
    this.vel.oy = clamp1(v.oy ?? 0)
    this.vel.dz = clamp1(v.dz ?? 0)
    this.active =
      Math.abs(this.vel.mx) > 0.001 || Math.abs(this.vel.my) > 0.001 ||
      Math.abs(this.vel.ox) > 0.001 || Math.abs(this.vel.oy) > 0.001 ||
      Math.abs(this.vel.dz) > 0.001
  }

  /** any stick input currently driving the integration? (watchdog uses this) */
  hasInput(): boolean {
    const v = this.vel
    return Math.abs(v.mx) > 0.001 || Math.abs(v.my) > 0.001 ||
      Math.abs(v.ox) > 0.001 || Math.abs(v.oy) > 0.001 || Math.abs(v.dz) > 0.001
  }

  /**
   * Bleed the last velocity out smoothly (no fresh packets arriving —
   * phone tab throttled/hidden). The view coasts to a gentle stop instead
   * of either drifting forever or freezing mid-gesture.
   */
  decayInput(dt: number) {
    const k = Math.exp(-dt * 10)
    const v = this.vel
    v.mx *= k; v.my *= k; v.ox *= k; v.oy *= k; v.dz *= k
    if (Math.abs(v.mx) < 0.01) v.mx = 0
    if (Math.abs(v.my) < 0.01) v.my = 0
    if (Math.abs(v.ox) < 0.01) v.ox = 0
    if (Math.abs(v.oy) < 0.01) v.oy = 0
    if (Math.abs(v.dz) < 0.01) v.dz = 0
  }

  /** soft rubber-band gain: 1 in the free zone, easing to 0 at the bound */
  private static band(v: number, min: number, max: number, soft: number): number {
    if (v > max - soft) return Math.max(0, (max - v) / soft)
    if (v < min + soft) return Math.max(0, (v - min) / soft)
    return 1
  }

  private static stepAxis(cur: number, tgt: number, dt: number): number {
    return cur + (tgt - cur) * (1 - Math.exp(-DAMP * dt))
  }

  /** integrate stick velocities → targets, then glide current → target */
  update(dt: number) {
    if (!this.enabled) dt = Math.min(dt, 1 / 30)
    const v = this.vel
    const t = this.target

    // orbit — yaw wraps freely, pitch is soft-limited
    t.yaw += v.ox * GAIN.yaw * dt
    const pitchGain = RemoteRig.band(t.pitch, -LIMITS.pitch, LIMITS.pitch, 18)
    t.pitch = clamp(t.pitch + v.oy * GAIN.pitch * pitchGain * dt, -LIMITS.pitch, LIMITS.pitch)

    // dolly / strafe / lift — translations, soft-limited both ends
    const dGain = RemoteRig.band(t.dolly, LIMITS.dolly[0], LIMITS.dolly[1], 5)
    t.dolly = clamp(t.dolly + v.dz * GAIN.dolly * dGain * dt, LIMITS.dolly[0], LIMITS.dolly[1])
    const sGain = RemoteRig.band(t.strafe, LIMITS.strafe[0], LIMITS.strafe[1], 4)
    t.strafe = clamp(t.strafe + v.mx * GAIN.strafe * sGain * dt, LIMITS.strafe[0], LIMITS.strafe[1])
    const lGain = RemoteRig.band(t.lift, LIMITS.lift[0], LIMITS.lift[1], 3)
    t.lift = clamp(t.lift + v.my * GAIN.lift * lGain * dt, LIMITS.lift[0], LIMITS.lift[1])

    // glide the applied pose toward the target — this is what makes the
    // view buttery even when packets arrive in bursts
    const c = this.cur
    c.yaw = RemoteRig.stepAxis(c.yaw, t.yaw, dt)
    c.pitch = RemoteRig.stepAxis(c.pitch, t.pitch, dt)
    c.dolly = RemoteRig.stepAxis(c.dolly, t.dolly, dt)
    c.strafe = RemoteRig.stepAxis(c.strafe, t.strafe, dt)
    c.lift = RemoteRig.stepAxis(c.lift, t.lift, dt)
  }

  /** forget all input and glide home (phone disconnected / mode off) */
  release(hard = false) {
    this.vel = { mx: 0, my: 0, ox: 0, oy: 0, dz: 0 }
    this.active = false
    if (hard) {
      this.target = { yaw: 0, pitch: 0, dolly: 0, strafe: 0, lift: 0 }
    }
  }

  /** reset instantly (new project loaded) */
  reset() {
    this.release(true)
    this.cur = { yaw: 0, pitch: 0, dolly: 0, strafe: 0, lift: 0 }
  }

  // ------------------------------------------------------------ application
  private qYaw = new THREE.Quaternion()
  private qPitch = new THREE.Quaternion()
  private qRot = new THREE.Quaternion()
  private tmp = new THREE.Vector3()
  private fwd = new THREE.Vector3()
  private right = new THREE.Vector3()

  /**
   * ApplyTo the rigid constellation transform onto one camera that has just
   * been posed from its surface data. Called by CameraManager.sync for
   * every surface camera on every frame.
   *
   * Rotation: Q = yaw(world Y) ∘ pitch(local right) around the pivot —
   * positions rotate with it and orientations compose, so the frustum
   * constellation stays congruent to itself (seams hold exactly).
   * Translation: along the constellation's MEAN view direction (dolly)
   * and mean right axis (strafe) plus world Y (lift) — pure translation
   * keeps the formation rigid as well.
   */
  applyTo(cam: THREE.PerspectiveCamera, basePos: THREE.Vector3, baseQuat: THREE.Quaternion, pivot: THREE.Vector3, meanFwd: THREE.Vector3, meanRight: THREE.Vector3) {
    const c = this.cur
    if (Math.abs(c.yaw) < 1e-4 && Math.abs(c.pitch) < 1e-4 &&
        Math.abs(c.dolly) < 1e-4 && Math.abs(c.strafe) < 1e-4 && Math.abs(c.lift) < 1e-4) return

    this.qYaw.setFromAxisAngle(UP, (c.yaw * Math.PI) / 180)
    this.qPitch.setFromAxisAngle(RIGHT, (c.pitch * Math.PI) / 180)
    this.qRot.copy(this.qYaw).multiply(this.qPitch)

    // position: rotate around the pivot, then translate
    this.tmp.copy(basePos).sub(pivot).applyQuaternion(this.qRot).add(pivot)
    this.fwd.copy(meanFwd).applyQuaternion(this.qRot)
    this.right.copy(meanRight).applyQuaternion(this.qRot)
    this.tmp.addScaledVector(this.fwd, c.dolly)
    this.tmp.addScaledVector(this.right, c.strafe)
    this.tmp.y += c.lift
    cam.position.copy(this.tmp)

    // orientation: same rotation composed onto every camera's base
    cam.quaternion.copy(this.qRot).multiply(baseQuat)
  }
}

const UP = new THREE.Vector3(0, 1, 0)
const RIGHT = new THREE.Vector3(1, 0, 0)

function clamp(v: number, a: number, b: number) { return v < a ? a : v > b ? b : v }
function clamp1(v: number) { return clamp(v, -1, 1) }
