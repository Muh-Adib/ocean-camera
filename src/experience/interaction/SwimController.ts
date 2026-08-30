// ---------------------------------------------------------------
// SwimController — free-swim exploration of the open ocean.
// Drag = look around · WASD/arrows = swim · Space = ascend ·
// C / Shift = descend · F or HUD button = toggle · ESC = surface.
// Movement is inertia-damped so it feels like finning through
// water, with soft bounds at the reef floor and world edge.
// ---------------------------------------------------------------
import * as THREE from 'three'
import { clamp } from '../utils/math'

export interface SwimBounds {
  x: number                 // ±x reach
  minZ: number
  maxZ: number
  maxY: number              // ceiling (just below the surface)
  floorPad: number          // metres above the seabed the swimmer floats
}

export class SwimController {
  active = false
  position = new THREE.Vector3()
  yaw = 0
  pitch = 0
  /** set by the on-screen forward paddle (touch) 0..1 */
  forwardBoost = 0
  onChange?: (active: boolean) => void
  /** injected by main — snapshots the live camera pose when swim starts */
  capturePose?: () => { pos: THREE.Vector3; yaw: number; pitch: number }

  private vel = new THREE.Vector3()
  private keys = new Set<string>()
  private dragging = false
  private lastX = 0
  private lastY = 0
  private enabled = false

  constructor(
    private dom: HTMLElement,
    private floorAt: (x: number, z: number) => number,
    private bounds: SwimBounds,
  ) {}

  enable() {
    if (this.enabled) return
    this.enabled = true
    const opts = { passive: false }
    this.dom.addEventListener('pointerdown', this.onDown)
    window.addEventListener('pointermove', this.onMove, opts)
    window.addEventListener('pointerup', this.onUp, opts)
    window.addEventListener('pointercancel', this.onUp, opts)
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
  }

  disable() {
    if (!this.enabled) return
    this.enabled = false
    this.setActive(false)
    this.dom.removeEventListener('pointerdown', this.onDown)
    window.removeEventListener('pointermove', this.onMove)
    window.removeEventListener('pointerup', this.onUp)
    window.removeEventListener('pointercancel', this.onUp)
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
  }

  /** start swimming from wherever the camera currently is */
  setActive(on: boolean, from?: THREE.Vector3) {
    if (on === this.active) return
    this.active = on
    if (on) {
      const snap = this.capturePose?.()
      this.position.copy(from ?? snap?.pos ?? this.position)
      this.yaw = snap?.yaw ?? this.yaw
      this.pitch = snap?.pitch ?? this.pitch
      this.vel.set(0, 0, 0)
    }
    this.onChange?.(on)
  }

  toggle(from?: THREE.Vector3): boolean {
    this.setActive(!this.active, from)
    return this.active
  }

  /** drive pose — call once per frame while active */
  update(dt: number) {
    if (!this.active) return

    // --- look damping is applied directly in onMove; here: movement ---
    const k = this.keys
    let f = 0, s = 0, u = 0
    if (k.has('KeyW') || k.has('ArrowUp')) f += 1
    if (k.has('KeyS') || k.has('ArrowDown')) f -= 1
    if (k.has('KeyD')) s += 1
    if (k.has('KeyA')) s -= 1
    if (k.has('Space')) u += 1
    if (k.has('KeyC') || k.has('ShiftLeft') || k.has('ShiftRight')) u -= 1
    f += this.forwardBoost

    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw)
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch)
    // forward/back along the gaze, strafe horizontal, plus world-vertical swim
    const fx = -sy * cp, fy = sp, fz = -cy * cp
    const rx = cy, rz = -sy
    const ACC = 30
    this.vel.x += (fx * f + rx * s) * ACC * dt
    this.vel.y += (fy * f + u) * ACC * 0.82 * dt
    this.vel.z += (fz * f + rz * s) * ACC * dt

    // water drag
    const drag = Math.max(0, 1 - dt * 2.6)
    this.vel.multiplyScalar(drag)
    const spd = this.vel.length()
    if (spd > 7.5) this.vel.multiplyScalar(7.5 / spd)

    this.position.addScaledVector(this.vel, dt)

    // --- soft bounds: reef floor, surface ceiling, world edge ---
    this.position.x = clamp(this.position.x, -this.bounds.x, this.bounds.x)
    this.position.z = clamp(this.position.z, this.bounds.minZ, this.bounds.maxZ)
    const floor = this.floorAt(this.position.x, this.position.z) + this.bounds.floorPad
    if (this.position.y < floor) {
      this.position.y = floor
      this.vel.y = Math.max(0, this.vel.y)
    }
    if (this.position.y > this.bounds.maxY) {
      this.position.y = this.bounds.maxY
      this.vel.y = Math.min(0, this.vel.y)
    }
  }

  get forward(): THREE.Vector3 {
    return new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch))
  }

  // ---------------- events ----------------
  private onDown = (e: PointerEvent) => {
    if (!this.active) return
    this.dragging = true
    this.lastX = e.clientX
    this.lastY = e.clientY
  }

  private onMove = (e: PointerEvent) => {
    if (!this.active || !this.dragging) return
    const dx = e.clientX - this.lastX
    const dy = e.clientY - this.lastY
    this.lastX = e.clientX
    this.lastY = e.clientY
    this.yaw -= dx * 0.0031
    this.pitch = clamp(this.pitch - dy * 0.0027, -1.25, 1.25)
  }

  private onUp = () => { this.dragging = false }

  private onKeyDown = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement)?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA') return
    if (e.code === 'KeyF') {
      e.preventDefault()
      this.setActive(!this.active)
      return
    }
    if (!this.active) return
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyC', 'ShiftLeft', 'ShiftRight'].includes(e.code)) {
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault()
      this.keys.add(e.code)
    }
    if (e.code === 'Escape') this.setActive(false)
  }

  private onKeyUp = (e: KeyboardEvent) => { this.keys.delete(e.code) }
}
