// ---------------------------------------------------------------
// CameraRig — cinematic drifting camera with gesture response
// ---------------------------------------------------------------
import * as THREE from 'three'
import gsap from 'gsap'
import { clamp, damp, lerp } from '../utils/math'

const HOME = new THREE.Vector3(0, 1.6, 13)
const LOOK_AT = new THREE.Vector3(0, -1.2, -22)
const HOME_PITCH = Math.asin(-2.8 / Math.hypot(2.8, 35))   // gaze of HOME → LOOK_AT

export class CameraRig {
  group: THREE.Group          // holds camera, handles drift
  private driftT = Math.random() * 100
  private offset = new THREE.Vector3()
  private offsetTarget = new THREE.Vector3()
  private lookOffset = new THREE.Vector3()
  private lookTarget = new THREE.Vector3()
  private introDone = false
  private introPlaying = false
  reducedMotion = false

  // --- free-swim state (driven by SwimController) ---
  private swimActive = false
  private swimPos = new THREE.Vector3()
  private swimYaw = 0
  private swimPitch = 0
  private euler = new THREE.Euler(0, 0, 0, 'YXZ')

  constructor(public camera: THREE.PerspectiveCamera) {
    this.group = new THREE.Group()
    this.group.position.copy(HOME)
    this.group.add(camera)
    camera.position.set(0, 0, 0)
    camera.lookAt(LOOK_AT)
  }

  /** Cinematic intro: descend from above the surface into the reef */
  playIntro() {
    const start = new THREE.Vector3(0, 15, 30)
    this.group.position.copy(start)
    this.camera.lookAt(new THREE.Vector3(0, 4, -10))
    const tl = gsap.timeline()
    tl.to(this.group.position, {
      x: HOME.x, y: HOME.y, z: HOME.z,
      duration: 7.5, ease: 'power2.inOut',
    })
    // settle the gaze forward
    tl.to(this.camera.rotation, {
      x: 0, y: 0, duration: 5, ease: 'power2.inOut',
    }, 1.2)
    tl.call(() => { this.introDone = true; this.introPlaying = false })
    this.introPlaying = true
    return tl
  }

  /** Subtle camera reaction to gestures (called by InteractionField) */
  reactToGesture(dir: THREE.Vector3, strength: number) {
    if (this.reducedMotion) return
    gsap.to(this.offsetTarget, {
      x: clamp(dir.x, -1, 1) * 1.15 * strength,
      y: clamp(dir.y, -1, 1) * 0.7 * strength,
      duration: 0.9, ease: 'power2.out', overwrite: 'auto',
    })
    gsap.to(this.lookTarget, {
      x: clamp(dir.x, -1, 1) * 2.2 * strength,
      y: clamp(dir.y, -1, 1) * 1.2 * strength,
      duration: 0.9, ease: 'power2.out', overwrite: 'auto',
    })
  }

  /** gentle push-back when the user pushes the water */
  pushReaction(strength: number) {
    if (this.reducedMotion) return
    gsap.to(this.offsetTarget, {
      z: 0.9 * strength,
      duration: 0.35, ease: 'power2.out', overwrite: 'auto',
      onComplete: () => gsap.to(this.offsetTarget, { z: 0, duration: 2.2, ease: 'power2.out' }),
    })
  }

  // ---------------- free swim ----------------
  /** current world pose + gaze, consumed by SwimController.capturePose */
  snapshotSwim(): { pos: THREE.Vector3; yaw: number; pitch: number } {
    const dir = new THREE.Vector3()
    this.camera.getWorldDirection(dir)
    return {
      pos: this.group.position.clone(),
      yaw: Math.atan2(-dir.x, -dir.z),
      pitch: Math.asin(clamp(dir.y, -1, 1)),
    }
  }

  enterSwim() {
    const s = this.snapshotSwim()
    this.swimPos.copy(s.pos)
    this.swimYaw = s.yaw
    this.swimPitch = s.pitch
    this.swimActive = true
  }

  /** glide serenely back to the home drift, then hand control back */
  exitSwim() {
    if (!this.swimActive) return
    gsap.to(this.swimPos, { x: HOME.x, y: HOME.y, z: HOME.z, duration: 3, ease: 'power2.inOut' })
    gsap.to(this, {
      swimYaw: 0, swimPitch: HOME_PITCH, duration: 2.4, ease: 'power2.inOut',
      onComplete: () => { this.swimActive = false },
    })
  }

  /** SwimController pushes its live pose here every frame */
  pushSwimPose(pos: THREE.Vector3, yaw: number, pitch: number) {
    if (!this.swimActive) return
    this.swimPos.copy(pos)
    this.swimYaw = yaw
    this.swimPitch = pitch
  }

  update(dt: number) {
    this.driftT += dt
    // during the cinematic intro the GSAP tween owns the camera pose
    if (this.introPlaying) return

    if (this.swimActive) {
      // first-person swim: gentle vertical bob + faint roll while gliding
      const bob = Math.sin(this.driftT * 0.9) * 0.07
      const roll = Math.sin(this.driftT * 0.55) * 0.014
      this.group.position.set(this.swimPos.x, this.swimPos.y + bob, this.swimPos.z)
      this.group.position.add(this.offset)
      this.euler.set(this.swimPitch, this.swimYaw, roll)
      this.camera.quaternion.setFromEuler(this.euler)
      return
    }

    // slow breathing drift
    const driftAmp = this.reducedMotion ? 0 : 1
    const bx = Math.sin(this.driftT * 0.11) * 1.1 * driftAmp + Math.sin(this.driftT * 0.043) * 0.6 * driftAmp
    const by = Math.sin(this.driftT * 0.077 + 1.7) * 0.5 * driftAmp
    const bz = Math.sin(this.driftT * 0.052 + 4) * 0.7 * driftAmp

    const k = damp(2.2, dt)
    this.offset.lerp(this.offsetTarget, k)
    this.lookOffset.lerp(this.lookTarget, k)

    this.group.position.set(HOME.x + bx, HOME.y + by, HOME.z + bz)
    this.group.position.add(this.offset)
    if (!this.reducedMotion) {
      this.camera.lookAt(LOOK_AT.x + this.lookOffset.x, LOOK_AT.y + this.lookOffset.y, LOOK_AT.z)
    }
  }
}
