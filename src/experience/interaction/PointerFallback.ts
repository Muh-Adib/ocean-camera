// ---------------------------------------------------------------
// PointerFallback — mouse / touch / keyboard control so the ocean
// always responds, with or without camera permission.
//   MOVE/DRAG → current      TAP/CLICK → attract pulse
//   HOLD → push              ARROWS/WASD → current
//   SPACE (hold) → attract   X (hold) → push
// ---------------------------------------------------------------
import * as THREE from 'three'
import gsap from 'gsap'
import { InteractionField } from './InteractionField'
import type { GestureBurst } from '../particles/GestureBurst'
import { clamp, damp } from '../utils/math'

export class PointerFallback {
  private enabled = false
  private active = false          // pointer currently influencing
  private downPos = { x: 0, y: 0 }
  private downTime = 0
  private holding = false
  private holdTimer: ReturnType<typeof setTimeout> | null = null
  private lastTap = 0
  private worldPoint = new THREE.Vector3()
  private dirVec = new THREE.Vector3()
  private keys = new Set<string>()
  private lastMove = 0
  /** true while SwimController owns the camera — suppresses overlapping keys */
  swimMode = false
  private velX = 0; private velY = 0
  private lastX = 0; private lastY = 0
  private ray = new THREE.Raycaster()

  constructor(
    private dom: HTMLElement,
    private camera: THREE.Camera,
    private field: InteractionField,
    private bursts?: GestureBurst,
  ) {}

  enable() {
    if (this.enabled) return
    this.enabled = true
    const opts = { passive: true }
    this.dom.addEventListener('pointermove', this.onMove, opts)
    this.dom.addEventListener('pointerdown', this.onDown)
    window.addEventListener('pointerup', this.onUp, opts)
    window.addEventListener('pointercancel', this.onUp, opts)
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
  }

  disable() {
    this.enabled = false
    this.dom.removeEventListener('pointermove', this.onMove)
    this.dom.removeEventListener('pointerdown', this.onDown)
    window.removeEventListener('pointerup', this.onUp)
    window.removeEventListener('pointercancel', this.onUp)
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
  }

  // ---------------- pointer ----------------
  private onMove = (e: PointerEvent) => {
    if (!this.enabled) return
    const now = performance.now()
    const dt = Math.min(0.1, (now - this.lastMove) / 1000) || 0.016
    this.lastMove = now

    const nx = e.clientX / window.innerWidth
    const ny = e.clientY / window.innerHeight
    const instVx = (nx - this.lastX) / dt
    const instVy = (ny - this.lastY) / dt
    this.lastX = nx; this.lastY = ny
    const k = damp(6, dt)
    this.velX += (instVx - this.velX) * k
    this.velY += (instVy - this.velY) * k

    if (this.holding) return   // hold-push takes priority

    const speed = Math.hypot(this.velX, this.velY)
    this.toWorld(nx, ny, this.worldPoint)
    if (speed > 0.25) {
      this.active = true
      this.dirVec.set(clamp(this.velX / 900, -1, 1), -clamp(this.velY / 900, -1, 1), 0).normalize()
      const strength = clamp(speed / 2600, 0.08, this.downTime ? 0.85 : 0.4)
      this.field.pointerActive = true
      this.field.setTarget(this.worldPoint, this.dirVec, strength, 'current')
      // drag = stronger current
      if (e.buttons > 0 && speed > 500 && Math.random() < 0.25) {
        this.bursts?.trail(this.worldPoint.clone(), this.dirVec.clone(), strength)
      }
    } else if (this.active && speed < 0.15) {
      this.active = false
      this.field.pointerActive = false
      this.field.setTarget(null)
    }
  }

  private onDown = (e: PointerEvent) => {
    if (!this.enabled) return
    this.downPos = { x: e.clientX, y: e.clientY }
    this.downTime = performance.now()
    // in free-swim a press-drag means "look around", not hold-push
    if (this.swimMode) return
    this.holdTimer = setTimeout(() => {
      if (!this.enabled) return
      this.holding = true
      this.toWorld(this.downPos.x / window.innerWidth, this.downPos.y / window.innerHeight, this.worldPoint)
      this.field.pointerActive = true
      this.field.setTarget(this.worldPoint, new THREE.Vector3(0, 0, 1), 0.9, 'push')
      this.field.gestureEvent('push', 0.85)
      this.bursts?.shockwave(this.worldPoint.clone(), 0.85)
    }, 380)
  }

  private onUp = (e: PointerEvent) => {
    if (this.holdTimer) { clearTimeout(this.holdTimer); this.holdTimer = null }
    if (this.holding) {
      this.holding = false
      this.field.setTarget(null)
      return
    }
    if (!this.enabled) return
    const dt = performance.now() - this.downTime
    const moved = Math.hypot(e.clientX - this.downPos.x, e.clientY - this.downPos.y)
    if (dt < 350 && moved < 24) {
      // tap / click → attract pulse
      const now = performance.now()
      if (now - this.lastTap > 400) {
        this.lastTap = now
        this.toWorld(e.clientX / window.innerWidth, e.clientY / window.innerHeight, this.worldPoint)
        this.field.pointerActive = true
        this.field.gestureEvent('palm', 0.65)
        this.field.setTarget(this.worldPoint, undefined, 0.7, 'attract')
        this.bursts?.ring(this.worldPoint.clone())
        gsapPulse(this.field)
        setTimeout(() => { if (!this.holding) this.field.setTarget(null) }, 900)
      }
    }
  }

  // ---------------- keyboard ----------------
  private onKeyDown = (e: KeyboardEvent) => {
    if (e.repeat) return
    const tag = (e.target as HTMLElement)?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA') return
    // in free-swim the movement keys belong to SwimController
    if (this.swimMode && (e.code === 'Space' || e.code.startsWith('KeyW') || e.code.startsWith('KeyA') || e.code.startsWith('KeyS') || e.code.startsWith('KeyD') || e.code.startsWith('Arrow'))) return
    this.keys.add(e.code)
    if (e.code === 'Space') {
      e.preventDefault()
      this.toWorld(this.lastX || 0.5, this.lastY || 0.45, this.worldPoint)
      this.field.pointerActive = true
      this.field.setTarget(this.worldPoint, undefined, 0.7, 'attract')
      this.field.gestureEvent('palm', 0.65)
      this.bursts?.ring(this.worldPoint.clone())
    }
    if (e.code === 'KeyX') {
      this.toWorld(this.lastX || 0.5, this.lastY || 0.45, this.worldPoint)
      this.field.pointerActive = true
      this.field.setTarget(this.worldPoint, new THREE.Vector3(0, 0, 1), 0.9, 'push')
      this.field.gestureEvent('push', 0.85)
      this.bursts?.shockwave(this.worldPoint.clone(), 0.85)
    }
  }

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code)
    if (e.code === 'Space' || e.code === 'KeyX') {
      this.field.setTarget(null)
    }
  }

  /** held arrow/WASD keys produce a steady current — called each frame */
  updateKeyboard(dt: number) {
    if (!this.enabled || this.swimMode) return
    let dx = 0, dy = 0
    if (this.keys.has('ArrowLeft') || this.keys.has('KeyA')) dx -= 1
    if (this.keys.has('ArrowRight') || this.keys.has('KeyD')) dx += 1
    if (this.keys.has('ArrowUp') || this.keys.has('KeyW')) dy += 1
    if (this.keys.has('ArrowDown') || this.keys.has('KeyS')) dy -= 1
    if (dx !== 0 || dy !== 0) {
      this.dirVec.set(dx, dy, 0).normalize()
      this.field.pointerActive = true
      this.toWorld(this.lastX || 0.5, this.lastY || 0.45, this.worldPoint)
      this.field.setTarget(this.worldPoint, this.dirVec, 0.5, 'current')
    }
  }

  private toWorld(nx: number, ny: number, out: THREE.Vector3, depth = 13) {
    this.ray.setFromCamera(new THREE.Vector2(nx * 2 - 1, -(ny * 2 - 1)), this.camera)
    out.copy(this.ray.ray.origin).addScaledVector(this.ray.ray.direction, depth)
    out.x = clamp(out.x, -36, 36)
    out.y = clamp(out.y, -10, 13)
    out.z = clamp(out.z, -44, 8)
  }
}

function gsapPulse(field: InteractionField) {
  gsap.to(field, { curiosity: 0.8, duration: 0.4, ease: 'power2.out', overwrite: 'auto' })
  gsap.to(field, { curiosity: 0, duration: 2, ease: 'power2.inOut', delay: 1 })
}
