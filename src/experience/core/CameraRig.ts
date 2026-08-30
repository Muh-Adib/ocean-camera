// ---------------------------------------------------------------
// CameraRig — cinematic drifting camera with gesture response
// ---------------------------------------------------------------
import * as THREE from 'three'
import gsap from 'gsap'
import { clamp, damp, lerp } from '../utils/math'

const HOME = new THREE.Vector3(0, 1.6, 13)
const LOOK_AT = new THREE.Vector3(0, -1.2, -22)

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

  update(dt: number) {
    this.driftT += dt
    // during the cinematic intro the GSAP tween owns the camera pose
    if (this.introPlaying) return

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
