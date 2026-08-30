// ---------------------------------------------------------------
// Shared math utilities, noise and world constants
// ---------------------------------------------------------------
import * as THREE from 'three'

export const SEABED_Y = -13
export const SURFACE_Y = 20

/** Soft living-space bounds for fish & particles */
export const BOUNDS = {
  minX: -42, maxX: 42,
  minY: -11.5, maxY: 14,
  minZ: -62, maxZ: 6,
}

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const rand = (a: number, b: number) => a + Math.random() * (b - a)
export const randInt = (a: number, b: number) => Math.floor(rand(a, b + 1))
export const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]
/** frame-rate independent exponential smoothing factor */
export const damp = (speed: number, dt: number) => 1 - Math.exp(-speed * dt)

/** Deterministic pseudo-random from seed (mulberry32) */
export function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ------------------------- value noise -------------------------
const PERM = new Uint8Array(512)
{
  const p = new Uint8Array(256)
  const rng = mulberry32(1337)
  for (let i = 0; i < 256; i++) p[i] = i
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const t = p[i]; p[i] = p[j]; p[j] = t
  }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255]
}

function fade(t: number) { return t * t * t * (t * (t * 6 - 15) + 10) }
function grad2(h: number, x: number, y: number) {
  switch (h & 7) {
    case 0: return x + y; case 1: return -x + y; case 2: return x - y; case 3: return -x - y
    case 4: return x; case 5: return -x; case 6: return y; default: return -y
  }
}

/** 2D value-gradient noise, output roughly [-1, 1] */
export function noise2(x: number, y: number): number {
  const X = Math.floor(x) & 255, Y = Math.floor(y) & 255
  const xf = x - Math.floor(x), yf = y - Math.floor(y)
  const u = fade(xf), v = fade(yf)
  const aa = PERM[PERM[X] + Y], ab = PERM[PERM[X] + Y + 1]
  const ba = PERM[PERM[X + 1] + Y], bb = PERM[PERM[X + 1] + Y + 1]
  const x1 = lerp(grad2(aa, xf, yf), grad2(ba, xf - 1, yf), u)
  const x2 = lerp(grad2(ab, xf, yf - 1), grad2(bb, xf - 1, yf - 1), u)
  return lerp(x1, x2, v) * 1.4
}

/** Fractal Brownian Motion */
export function fbm2(x: number, y: number, octaves = 4): number {
  let sum = 0, amp = 0.5, freq = 1
  for (let i = 0; i < octaves; i++) {
    sum += noise2(x * freq, y * freq) * amp
    amp *= 0.5; freq *= 2.03
  }
  return sum
}

// ------------------------- canvas texture helpers -------------------------

/** Soft radial glow sprite used by particles */
export function makeGlowTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)'): THREE.Texture {
  const c = document.createElement('canvas'); c.width = c.height = 64
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, inner)
  grad.addColorStop(0.4, 'rgba(255,255,255,0.45)')
  grad.addColorStop(1, outer)
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** Bubble sprite: bright rim ring */
export function makeBubbleTexture(): THREE.Texture {
  const c = document.createElement('canvas'); c.width = c.height = 64
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(32, 32, 10, 32, 32, 30)
  grad.addColorStop(0, 'rgba(200,235,255,0.05)')
  grad.addColorStop(0.75, 'rgba(190,230,255,0.12)')
  grad.addColorStop(0.92, 'rgba(220,245,255,0.85)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.beginPath(); g.arc(32, 32, 31, 0, Math.PI * 2); g.fill()
  // specular dot
  g.fillStyle = 'rgba(255,255,255,0.8)'
  g.beginPath(); g.arc(24, 22, 4.5, 0, Math.PI * 2); g.fill()
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}
