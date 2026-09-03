// ---------------------------------------------------------------
// InteractionField — the virtual underwater force field.
//
//   HAND → GESTURE ANALYSIS → DIRECTION + VELOCITY
//        → FORCE FIELD → FISH / PARTICLES / SEAWEED / BUBBLES
//        → ORGANIC RESPONSE
//
// Also runs the global ecosystem state machine:
//   CALM → CURIOUS → ACTIVE → SCATTER → RECOVERY → CALM
// State values are GSAP-tweened so transitions are always smooth.
// ---------------------------------------------------------------
import * as THREE from 'three'
import gsap from 'gsap'
import { sharedUniforms } from '../core/sharedUniforms'
import { clamp, damp } from '../utils/math'

export type EcosystemState = 'CALM' | 'CURIOUS' | 'ACTIVE' | 'SCATTER' | 'RECOVERY'
export type FieldMode = 'current' | 'push' | 'pull' | 'attract' | 'repel'

export interface FieldSnapshot {
  active: boolean
  point: THREE.Vector3
  dir: THREE.Vector3
  strength: number
  radius: number
  mode: FieldMode
  caution: number
  curiosity: number
  scatter: number
  // ---- second hand (two-hand / remote control) ----
  active2: boolean
  point2: THREE.Vector3
  dir2: THREE.Vector3
  strength2: number
  mode2: FieldMode
}

export class InteractionField {
  // ---- force field state ----
  active = false
  point = new THREE.Vector3(0, 0, -12)
  dir = new THREE.Vector3(0, 0, -1)
  strength = 0
  radius = 11
  mode: FieldMode = 'current'

  // ---- second hand: a full extra force point so TWO hands (local or
  //      remote phone hands) can drive the ocean at once ----
  active2 = false
  point2 = new THREE.Vector3(0, 0, -12)
  dir2 = new THREE.Vector3(0, 0, -1)
  strength2 = 0
  mode2: FieldMode = 'current'

  // ---- ecosystem state machine ----
  state: EcosystemState = 'CALM'
  energy = 0.12            // global ecosystem energy (light, colours)
  caution = 0
  curiosity = 0
  scatter = 0
  stateLabel = 'CALM'

  // ---- input sources ----
  private handActive = false
  private lastGestureTime = 0
  private pendingMode: FieldMode | null = null
  private pendingStrength = 0
  private lastGestureTime2 = 0
  private pendingMode2: FieldMode | null = null
  private pendingStrength2 = 0

  private listeners = new Set<(s: EcosystemState) => void>()

  onStateChange(fn: (s: EcosystemState) => void) { this.listeners.add(fn) }

  setHandActive(active: boolean) {
    this.handActive = active
    if (!active && !this.pointerActive) this.setTarget(null)
  }

  pointerActive = false

  /** gesture engine / pointer fallback push their intent here */
  setTarget(worldPoint: THREE.Vector3 | null, dir?: THREE.Vector3, strength = 0, mode: FieldMode = 'current') {
    if (worldPoint) {
      this.point.lerp(worldPoint, 0.45)   // smoothed follow (no teleport)
      if (dir) {
        if (dir.lengthSq() > 1e-6) this.dir.lerp(dir.normalize(), 0.35)
      }
      this.pendingStrength = strength
      this.pendingMode = mode
      this.active = true
      this.lastGestureTime = performance.now()
      this.boostEnergy(strength, mode)
    } else {
      this.active = false
    }
  }

  /** the second hand pushes its intent here (independent point/mode) */
  setTarget2(worldPoint: THREE.Vector3 | null, dir?: THREE.Vector3, strength = 0, mode: FieldMode = 'current') {
    if (worldPoint) {
      this.point2.lerp(worldPoint, 0.45)
      if (dir) {
        if (dir.lengthSq() > 1e-6) this.dir2.lerp(dir.normalize(), 0.35)
      }
      this.pendingStrength2 = strength
      this.pendingMode2 = mode
      this.active2 = true
      this.lastGestureTime2 = performance.now()
      this.boostEnergy(strength, mode)
    } else {
      this.active2 = false
    }
  }

  private boostEnergy(strength: number, mode: FieldMode) {
    const gain = mode === 'push' ? 0.5 : mode === 'attract' || mode === 'repel' ? 0.3 : 0.22
    const target = clamp(0.12 + strength * gain + this.recentActivity * 0.3, 0.12, 1)
    if (target > this.energy) {
      gsap.to(this, { energy: target, duration: 0.6, ease: 'power2.out', overwrite: 'auto' })
    }
  }

  private recentActivity = 0

  /** discrete gesture event (swipe/push/palm/fist) — drives state machine */
  gestureEvent(kind: 'swipe' | 'push' | 'pull' | 'palm' | 'fist', strength: number) {
    this.recentActivity = Math.min(1, this.recentActivity + strength * 0.5)
    switch (kind) {
      case 'swipe':
        this.setState(strength > 0.55 ? 'ACTIVE' : this.state === 'CALM' ? 'CURIOUS' : this.state)
        break
      case 'push':
        this.setState('SCATTER')
        gsap.to(this, {
          scatter: clamp(strength, 0.4, 1),
          duration: 0.4, ease: 'power2.out', overwrite: 'auto',
          onComplete: () => gsap.to(this, { scatter: 0, duration: 2.8, ease: 'power2.inOut', delay: 1.2 }),
        })
        break
      case 'pull':
        this.setState('RECOVERY')
        break
      case 'palm':
        this.setState('CURIOUS')
        gsap.to(this, {
          curiosity: clamp(strength, 0.4, 1),
          duration: 0.6, ease: 'power2.out', overwrite: 'auto',
        })
        break
      case 'fist':
        this.setState('ACTIVE')
        gsap.to(this, {
          caution: clamp(strength, 0.4, 1),
          duration: 0.5, ease: 'power2.out', overwrite: 'auto',
          onComplete: () => gsap.to(this, { caution: 0, duration: 2.4, ease: 'power2.inOut', delay: 0.8 }),
        })
        break
    }
  }

  private setState(s: EcosystemState) {
    if (this.state === s) return
    this.state = s
    this.stateLabel = s
    this.listeners.forEach((fn) => fn(s))
  }

  /** ambient current direction for seaweed/particles (slow drift + gesture bias) */
  ambientCurrent = new THREE.Vector2(0.4, 0.1)
  private ambientT = Math.random() * 50

  update(dt: number) {
    const now = performance.now()
    const idle = now - this.lastGestureTime > 2600

    // strength follows input intent, decays when idle
    const targetStrength = this.active && !idle ? this.pendingStrength : 0
    this.strength += (targetStrength - this.strength) * damp(6, dt)
    if (idle && this.strength < 0.01) {
      this.active = false
      if (this.state === 'ACTIVE' || this.state === 'SCATTER' || this.state === 'CURIOUS') {
        this.setState('RECOVERY')
      }
    }

    // mode: sticky explicit modes, otherwise current
    if (!idle && this.pendingMode) this.mode = this.pendingMode
    if (idle && this.mode !== 'current') this.mode = 'current'

    // ---- second hand: same lifecycle, independent clock ----
    const idle2 = now - this.lastGestureTime2 > 2600
    const targetStrength2 = this.active2 && !idle2 ? this.pendingStrength2 : 0
    this.strength2 += (targetStrength2 - this.strength2) * damp(6, dt)
    if (idle2 && this.strength2 < 0.01) this.active2 = false
    if (!idle2 && this.pendingMode2) this.mode2 = this.pendingMode2
    if (idle2 && this.mode2 !== 'current') this.mode2 = 'current'

    // energy decay → recovery → calm
    this.recentActivity = Math.max(0, this.recentActivity - dt * 0.12)
    if (idle) {
      const decay = this.state === 'RECOVERY' ? 0.1 : 0.045
      this.energy = Math.max(0.12, this.energy - this.energy * decay * dt * 10)
      if (this.state === 'RECOVERY' && this.energy < 0.16) this.setState('CALM')
    }

    // ambient current slowly wanders
    this.ambientT += dt
    this.ambientCurrent.set(
      Math.sin(this.ambientT * 0.05) * 0.7 + 0.2,
      Math.cos(this.ambientT * 0.037) * 0.35,
    )

    // publish to shared uniforms (seaweed, coral, particles react)
    sharedUniforms.uFieldPos.value.copy(this.point)
    sharedUniforms.uFieldDir.value.copy(this.dir)
    sharedUniforms.uFieldStrength.value = this.strength
    sharedUniforms.uFieldRadius.value = this.radius
    sharedUniforms.uEnergy.value += (this.energy - sharedUniforms.uEnergy.value) * damp(1.6, dt)
  }

  snapshot(): FieldSnapshot {
    return {
      active: this.active, point: this.point, dir: this.dir,
      strength: this.strength, radius: this.radius, mode: this.mode,
      caution: this.caution, curiosity: this.curiosity, scatter: this.scatter,
      active2: this.active2, point2: this.point2, dir2: this.dir2,
      strength2: this.strength2, mode2: this.mode2,
    }
  }
}
