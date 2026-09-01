// ---------------------------------------------------------------
// FishGeometryFactory — procedural, realism-first fish.
// Nose points +Z, tail -Z. Everything is generated math, no assets.
//
// v4 realism pass ("halus & asli"):
//   • organic swept hull: 34 rings × 44 radial vertices with
//     asymmetric cross-sections — dorsal ridge line, rounded belly,
//     lateral compression mid-body (real fish are NOT revolved
//     ellipses). Smooth welded normals, no seam.
//   • fins are built like real fins: radiating fin rays with
//     membrane sag, scalloped trailing edges and ray streak
//     colouring (tail fan 13 rays, dorsal/anal ray grids).
//   • 4-layer eyes: socket shadow, sclera, species iris, pupil,
//     glint.
//   • 512px canvas textures: two-scale-layer skin, iridescent
//     sheen, curved species bands, gill plates, lateral lines,
//     counter-shading. Plus a shared scale BUMP map so scales
//     catch the light as micro-relief.
// Patterns are painted on canvas textures; fins/eyes sample a
// reserved white texel and get their colour from vertex colors.
// Every geometry carries: position, normal, uv, color and is
// merged into ONE buffer per species → one instanced draw call.
// ---------------------------------------------------------------
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { clamp, mulberry32 } from '../utils/math'

export type SpeciesKey =
  | 'tropical' | 'angelfish' | 'butterflyfish' | 'clownfish' | 'tang' | 'pufferfish'
  | 'moorish' | 'squirrel' | 'minnow'

const WHITE_UV = 0.965

function setUniformUV(geo: THREE.BufferGeometry) {
  const uv = geo.attributes.uv as THREE.BufferAttribute
  for (let i = 0; i < uv.count; i++) uv.setXY(i, WHITE_UV, WHITE_UV)
}

function paintColors(geo: THREE.BufferGeometry, color: THREE.Color, tipColor?: THREE.Color) {
  const count = geo.attributes.position.count
  const arr = new Float32Array(count * 3)
  geo.computeBoundingBox()
  const bb = geo.boundingBox!
  const h = Math.max(1e-4, bb.max.z - bb.min.z)
  for (let i = 0; i < count; i++) {
    const z = geo.attributes.position.getZ(i)
    const t = (z - bb.min.z) / h           // 0 tail → 1 head
    const c = tipColor ? color.clone().lerp(tipColor, t) : color
    arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3))
}

/** lighten (f > 0) or darken (f < 0) a hex colour, returned as css string */
function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
  const t = f > 0 ? 255 : 0
  const a = Math.abs(f)
  const mix = (c: number) => Math.round(c + (t - c) * a)
  return `rgb(${mix(r)},${mix(g)},${mix(b)})`
}

// ---------------------------------------------------------------
// Catmull-Rom helpers
// ---------------------------------------------------------------
function cr1(p0: number, p1: number, p2: number, p3: number, f: number): number {
  return p1 + 0.5 * f * (p2 - p0
    + f * (2 * p0 - 5 * p1 + 4 * p2 - p3
    + f * (3 * (p1 - p2) + p3 - p0)))
}

function resampleProfile(profile: number[], n: number): number[] {
  const pts = profile
  const segs = pts.length - 1
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * segs
    const s = Math.min(t, segs - 1e-6)          // always inside the last segment
    const k = Math.floor(s)
    const f = s - k
    const v = cr1(
      pts[Math.max(0, k - 1)], pts[k],
      pts[Math.min(segs, k + 1)], pts[Math.min(segs, k + 2)], f,
    )
    out.push(Math.max(0.004, v))
  }
  return out
}

/** resample a polyline of [a, b] stations to n smooth stations */
function resampleStations(pts: [number, number][], n: number): [number, number][] {
  const as = pts.map((p) => p[0])
  const bs = pts.map((p) => p[1])
  const segs = pts.length - 1
  const out: [number, number][] = []
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * segs
    const s = Math.min(t, segs - 1e-6)          // always inside the last segment
    const k = Math.floor(s)
    const f = s - k
    out.push([
      cr1(as[Math.max(0, k - 1)], as[k], as[Math.min(segs, k + 1)], as[Math.min(segs, k + 2)], f),
      cr1(bs[Math.max(0, k - 1)], bs[k], bs[Math.min(segs, k + 1)], bs[Math.min(segs, k + 2)], f),
    ])
  }
  return out
}

// ------------------------- canvas textures -------------------------
interface TexSpec {
  back: string
  belly: string
  bands?: { v: number; w: number; color: string; soft?: boolean; bow?: number }[]
  spots?: { color: string; n: number; r: number }
  grayscale?: boolean
  flankLines?: { color: string; n: number; alpha: number }   // stripes running head→tail
  bandOutline?: boolean                                      // dark band margins (clownfish)
  vermiculation?: boolean                                    // fine wiggly rows (butterflyfish)
}

function fishTexture(spec: TexSpec): THREE.CanvasTexture {
  const S = 512
  const c = document.createElement('canvas')
  c.width = c.height = S
  const g = c.getContext('2d')!

  // ---- counter-shading: pale belly → silver flanks → dark back ----
  // canvas x: 0 = belly seam, 0.5 = dorsal line, 1 = belly seam
  const grad = g.createLinearGradient(0, 0, S, 0)
  grad.addColorStop(0.0, spec.grayscale ? spec.belly : shade(spec.belly, 0.18))
  grad.addColorStop(0.2, spec.belly)
  grad.addColorStop(0.42, spec.grayscale ? shade(spec.back, 0.35) : shade(spec.back, 0.1))
  grad.addColorStop(0.5, spec.back)
  grad.addColorStop(0.58, spec.grayscale ? shade(spec.back, 0.35) : shade(spec.back, 0.1))
  grad.addColorStop(0.8, spec.belly)
  grad.addColorStop(1.0, spec.grayscale ? spec.belly : shade(spec.belly, 0.18))
  g.fillStyle = grad
  g.fillRect(0, 0, S, S)

  // ---- procedural scales, two layers: coarse plates + fine overlay ----
  const drawScales = (rows: number, cols: number, dark: string, light: string, lw: number) => {
    const rng = mulberry32(11)
    const cw = S / cols, ch = S / rows
    for (let r = 0; r <= rows; r++) {
      const off = (r % 2) * 0.5
      for (let col = 0; col <= cols; col++) {
        const x = (col + off) * cw
        const y = r * ch
        const rad = cw * (0.68 + rng() * 0.16)
        g.strokeStyle = dark
        g.lineWidth = lw
        g.beginPath()
        g.arc(x, y - rad * 0.3, rad, Math.PI * 0.12, Math.PI * 0.88)
        g.stroke()
        g.strokeStyle = light
        g.lineWidth = lw * 0.8
        g.beginPath()
        g.arc(x, y - rad * 0.38, rad * 0.95, Math.PI * 0.18, Math.PI * 0.82)
        g.stroke()
      }
    }
  }
  drawScales(44, 50, 'rgba(8,14,20,0.15)', 'rgba(255,255,255,0.09)', 1.6)
  drawScales(86, 96, 'rgba(8,14,20,0.06)', 'rgba(255,255,255,0.045)', 0.9)

  // ---- iridescent sheen: soft diagonal light bands ----
  for (const [cx, w, a] of [[0.3, 0.16, 0.05], [0.72, 0.1, 0.04], [0.52, 0.3, 0.025]] as const) {
    const sh = g.createLinearGradient((cx - w) * S, 0, (cx + w) * S, S * 0.5)
    sh.addColorStop(0, 'rgba(255,255,255,0)')
    sh.addColorStop(0.5, `rgba(255,255,255,${a})`)
    sh.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = sh
    g.fillRect(0, 0, S, S)
  }

  // ---- gill plates (operculum) on each flank ----
  for (const gx of [0.25, 0.75]) {
    const x = gx * S
    const yTop = 0.16 * S, yBot = 0.43 * S
    const dir = gx < 0.5 ? 1 : -1
    g.strokeStyle = 'rgba(10,16,22,0.36)'
    g.lineWidth = 5.5
    g.lineCap = 'round'
    g.beginPath()
    g.moveTo(x - 9 * dir, yTop)
    g.quadraticCurveTo(x + 15 * dir, (yTop + yBot) / 2, x - 7 * dir, yBot)
    g.stroke()
    g.strokeStyle = 'rgba(10,16,22,0.16)'
    g.lineWidth = 3
    g.beginPath()
    g.moveTo(x - 26 * dir, yTop + 10)
    g.quadraticCurveTo(x - 3 * dir, (yTop + yBot) / 2, x - 21 * dir, yBot - 6)
    g.stroke()
    // faint ridged rays behind the main plate
    g.strokeStyle = 'rgba(255,255,255,0.07)'
    g.lineWidth = 2.2
    for (let k = 1; k <= 3; k++) {
      g.beginPath()
      g.moveTo(x + k * 9 * dir, yTop + 8 + k * 4)
      g.quadraticCurveTo(x + (k * 9 - 12) * dir, (yTop + yBot) / 2, x + k * 8 * dir, yBot - 4 - k * 3)
      g.stroke()
    }
  }

  // ---- lateral lines (faint dashed sensory canals) ----
  g.setLineDash([13, 10])
  g.strokeStyle = 'rgba(238,248,252,0.11)'
  g.lineWidth = 2.6
  for (const lx of [0.25, 0.75]) {
    g.beginPath()
    g.moveTo(lx * S, 0.3 * S)
    g.lineTo(lx * S, 0.9 * S)
    g.stroke()
  }
  g.setLineDash([])

  // ---- mouth shading on the snout ----
  g.fillStyle = 'rgba(8,10,14,0.34)'
  for (const mx of [0.25, 0.75]) {
    g.beginPath()
    g.ellipse(mx * S, 0.012 * S, 14, 6, 0, 0, Math.PI * 2)
    g.fill()
  }

  // ---- flank stripes running head→tail (squirrelfish etc.) ----
  if (spec.flankLines) {
    const fl = spec.flankLines
    g.strokeStyle = fl.color
    g.globalAlpha = fl.alpha
    g.lineWidth = 4.5
    g.lineCap = 'round'
    for (const fx of [0.11, 0.185, 0.26, 0.315, 0.685, 0.74, 0.815, 0.89].slice(0, fl.n * 2)) {
      g.beginPath()
      g.moveTo(fx * S, 0.06 * S)
      g.quadraticCurveTo(fx * S + (fx < 0.5 ? 8 : -8), S / 2, fx * S, 0.97 * S)
      g.stroke()
    }
    g.globalAlpha = 1
  }

  // ---- fine vermiculation rows (butterflyfish) ----
  if (spec.vermiculation) {
    g.strokeStyle = 'rgba(30,34,40,0.24)'
    g.lineWidth = 2
    const rng = mulberry32(31)
    for (let row = 0; row < 16; row++) {
      const y = (0.1 + row * 0.055) * S
      g.beginPath()
      for (let x = 0; x <= S; x += 14) {
        const yy = y + Math.sin(x * 0.09 + row * 2.4 + rng() * 0.4) * 5
        if (x === 0) g.moveTo(x, yy)
        else g.lineTo(x, yy)
      }
      g.stroke()
    }
  }

  if (spec.spots) {
    const srng = mulberry32(99)
    g.fillStyle = spec.spots.color
    for (let i = 0; i < spec.spots.n; i++) {
      const x = 30 + srng() * (S - 60)
      const y = 22 + srng() * (S - 44)
      const r = spec.spots.r * (0.6 + srng() * 0.8) * 2
      // soft-edged spot
      const sg = g.createRadialGradient(x, y, r * 0.2, x, y, r)
      sg.addColorStop(0, spec.spots.color)
      sg.addColorStop(0.75, spec.spots.color)
      sg.addColorStop(1, 'rgba(0,0,0,0)')
      g.fillStyle = sg
      g.beginPath()
      g.arc(x, y, r, 0, Math.PI * 2)
      g.fill()
    }
  }

  // bands: v (0 tail → 1 nose) → canvas y = (1 - v) * S; optional bow + dark margins
  if (spec.bands) {
    for (const b of spec.bands) {
      const y = (1 - b.v) * S
      const bow = b.bow ?? 0
      g.fillStyle = b.color
      if (b.soft) {
        const bg = g.createLinearGradient(0, y - b.w * S, 0, y + b.w * S)
        bg.addColorStop(0, 'rgba(0,0,0,0)')
        bg.addColorStop(0.5, b.color)
        bg.addColorStop(1, 'rgba(0,0,0,0)')
        g.fillStyle = bg
        g.fillRect(0, y - b.w * S, S, b.w * S * 2)
      } else if (bow !== 0) {
        // organically bowed band drawn as a fat stroked curve
        g.strokeStyle = b.color
        g.lineWidth = b.w * S
        g.lineCap = 'butt'
        g.beginPath()
        g.moveTo(0, y)
        g.quadraticCurveTo(S / 2, y + bow * S, S, y)
        g.stroke()
      } else {
        g.fillRect(0, y - b.w * S * 0.5, S, b.w * S)
      }
      if (spec.bandOutline && !b.soft) {
        g.strokeStyle = 'rgba(24,24,30,0.55)'
        g.lineWidth = 3.4
        for (const ey of [y - b.w * S * 0.5, y + b.w * S * 0.5]) {
          g.beginPath()
          if (bow !== 0) { g.moveTo(0, ey); g.quadraticCurveTo(S / 2, ey + bow * S, S, ey) }
          else { g.moveTo(0, ey); g.lineTo(S, ey) }
          g.stroke()
        }
      }
    }
  }

  // dark dorsal top edge + pale keel
  const topG = g.createLinearGradient(0, 0, 0, S)
  topG.addColorStop(0, 'rgba(0,0,0,0.28)')
  topG.addColorStop(0.12, 'rgba(0,0,0,0)')
  topG.addColorStop(0.88, 'rgba(0,0,0,0)')
  topG.addColorStop(1, 'rgba(255,255,255,0.14)')
  g.fillStyle = topG
  g.fillRect(0, 0, S, S)

  // reserved white texel for fins & eyes (bottom-right corner)
  g.fillStyle = '#ffffff'
  g.fillRect(S - 16, S - 16, 16, 16)

  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

/** shared scale bump map — scales read as micro-relief under the key light */
let fishBump: THREE.CanvasTexture | null = null
function fishBumpTexture(): THREE.CanvasTexture {
  if (fishBump) return fishBump
  const S = 512
  const c = document.createElement('canvas')
  c.width = c.height = S
  const g = c.getContext('2d')!
  g.fillStyle = '#808080'
  g.fillRect(0, 0, S, S)
  const rng = mulberry32(23)
  const rows = 44, cols = 50
  const cw = S / cols, ch = S / rows
  for (let r = 0; r <= rows; r++) {
    const off = (r % 2) * 0.5
    for (let col = 0; col <= cols; col++) {
      const x = (col + off) * cw
      const y = r * ch
      const rad = cw * (0.7 + rng() * 0.14)
      g.strokeStyle = 'rgba(255,255,255,0.5)'     // raised scale edge
      g.lineWidth = 2.4
      g.beginPath()
      g.arc(x, y - rad * 0.3, rad, Math.PI * 0.15, Math.PI * 0.85)
      g.stroke()
      g.strokeStyle = 'rgba(30,30,30,0.5)'        // shadowed groove below
      g.lineWidth = 2
      g.beginPath()
      g.arc(x, y - rad * 0.12, rad * 0.98, Math.PI * 0.18, Math.PI * 0.82)
      g.stroke()
    }
  }
  // neutral texel for fins & eyes (they sample WHITE_UV)
  g.fillStyle = '#808080'
  g.fillRect(S - 20, S - 20, 20, 20)
  fishBump = new THREE.CanvasTexture(c)
  return fishBump
}

// ------------------------- parts builders -------------------------
interface BodySpec {
  profile: number[]       // control radii, tail → nose
  w: number; h: number; len: number
}

export interface Hull {
  geo: THREE.BufferGeometry
  radiusAt: (z: number) => number     // vertical radius (profile units)
  widthAt: (z: number) => number      // lateral half-width (profile units, pre-w scale)
  surfaceXAt: (z: number, y: number) => number   // absolute flank surface x at height y
}

/**
 * Organic swept hull — the heart of the v4 realism pass.
 * Cross-sections are asymmetric: a pinched dorsal ridge line, a
 * rounded slightly-flattened belly and lateral compression that
 * peaks mid-body (like laterally-compressed reef fish). 34 rings ×
 * 44 radial verts, indexed with a welded seam → perfectly smooth
 * normals everywhere.
 */
function makeHull(spec: BodySpec): Hull {
  const RINGS = 34, RAD = 44
  const smooth = resampleProfile(spec.profile, RINGS)
  const L = spec.len, H = spec.h, W = spec.w
  const bell = (t: number, c: number, w: number) => Math.exp(-((t - c) * (t - c)) / (2 * w * w))

  const pos: number[] = [], uv: number[] = [], idx: number[] = []

  for (let i = 0; i < RINGS; i++) {
    const t = i / (RINGS - 1)
    const r = smooth[i]
    const z = (-0.5 + t) * L
    const comp = 0.22 * bell(t, 0.55, 0.27)        // lateral compression mid-body
    const pin = 0.4 * bell(t, 0.52, 0.3)           // dorsal ridge narrowing
    const belly = 0.16 * bell(t, 0.34, 0.26)       // keel flattening
    for (let j = 0; j <= RAD; j++) {
      const u = j / RAD
      const a = u * Math.PI * 2                    // 0 = belly seam, 0.5 = dorsal line
      const cy = -Math.cos(a)                      // -1 belly → +1 back
      const sx = Math.sin(a)
      let x = sx * r * (1 - comp)
      let y = cy * r
      if (cy > 0) {
        x *= 1 - pin * Math.pow(cy, 1.6)           // ridge
      } else {
        const k = -cy
        y *= 1 - belly * Math.pow(k, 1.3)
        x *= 1 - belly * 0.22 * k * k
      }
      pos.push(x * W, y * H, z)
      uv.push(u, t)
    }
  }
  for (let i = 0; i < RINGS - 1; i++) {
    for (let j = 0; j < RAD; j++) {
      const a0 = i * (RAD + 1) + j
      const b0 = a0 + 1
      const a1 = (i + 1) * (RAD + 1) + j
      const b1 = a1 + 1
      idx.push(a0, b0, a1, b0, b1, a1)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  geo.setIndex(idx)
  geo.computeVertexNormals()

  // weld the duplicated seam vertices' normals (belly line)
  const n = geo.attributes.normal as THREE.BufferAttribute
  for (let i = 0; i < RINGS; i++) {
    const a = i * (RAD + 1), b = a + RAD
    const nx = n.getX(a) + n.getX(b)
    const ny = n.getY(a) + n.getY(b)
    const nz = n.getZ(a) + n.getZ(b)
    const l = Math.hypot(nx, ny, nz) || 1
    n.setXYZ(a, nx / l, ny / l, nz / l)
    n.setXYZ(b, nx / l, ny / l, nz / l)
  }

  // white base color so the texture shows unmodified
  const count = geo.attributes.position.count
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3).fill(1), 3))

  // smooth lookups along the body (hull-space z → ring parameter).
  // hull rings span z ∈ [-L/2, +L/2], so station s = z/L + 0.5 keeps
  // lookups and placements in ONE coherent coordinate frame.
  const stat = (z: number) => clamp(z / L + 0.5, 0, 1)
  const radiusAt = (z: number) => {
    const f = stat(z) * (smooth.length - 1)
    const i = Math.floor(f)
    const fr = f - i
    return smooth[i] + (smooth[Math.min(i + 1, smooth.length - 1)] - smooth[i]) * fr
  }
  const widthAt = (z: number) => {
    const t = stat(z)
    const comp = 0.22 * bell(t, 0.55, 0.27)
    return radiusAt(z) * (1 - comp)
  }
  // exact flank x at (y, z) — includes the dorsal pinch so features seated
  // with this value truly touch the skin (eyes, fins) instead of floating.
  const surfaceXAt = (z: number, y: number) => {
    const t = stat(z)
    const r = radiusAt(z)
    const comp = 0.22 * bell(t, 0.55, 0.27)
    const pin = 0.4 * bell(t, 0.52, 0.3)
    const yHalf = Math.max(1e-5, r * H)
    const cy = clamp(y / yHalf, -0.96, 0.96)
    const sx = Math.sqrt(Math.max(0, 1 - cy * cy))
    const pinch = cy > 0 ? 1 - pin * Math.pow(cy, 1.6) : 1
    return sx * r * (1 - comp) * W * pinch
  }
  return { geo, radiusAt, widthAt, surfaceXAt }
}

/**
 * Caudal fin as a ray fan — 13 radiating fin rays with a forked
 * profile, scalloped trailing edge, darker ray columns and a
 * membrane that fades toward translucent white at the edge.
 */
function makeTailFan(len: number, spread: number, fork: number, color: THREE.Color): THREE.BufferGeometry {
  const RAYS = 13
  const ROWS = [0, 0.45, 0.78, 1]
  const rng = mulberry32(5)
  const tipC = color.clone().lerp(new THREE.Color('#eaf4f6'), 0.45)
  const rayC = color.clone().multiplyScalar(0.66)

  const pos: number[] = [], cols: number[] = [], uvs: number[] = [], idx: number[] = []
  for (let k = 0; k < RAYS; k++) {
    const phi = (k / (RAYS - 1)) * 2 - 1                       // +1 top lobe → -1 bottom
    let tipLen = len * (1 - fork * Math.pow(1 - Math.abs(phi), 1.6))
    tipLen *= 1 + (rng() - 0.5) * 0.05                          // organic irregularity
    const tipY = phi * spread * (1 - fork * 0.12 * (1 - Math.abs(phi)))
    const tipZ = -tipLen + Math.sin(phi * Math.PI * 2.4) * len * 0.035   // scalloped edge
    for (let r = 0; r < ROWS.length; r++) {
      const f = ROWS[r]
      const y = tipY * f
      const z = 0.05 + (tipZ - 0.05) * f                     // base → scalloped tip
      pos.push(0, y, z)
      const cRow = color.clone().lerp(tipC, f * 0.6)
      const c = f > 0.7 ? cRow : cRow.clone().lerp(rayC, 0.45)
      cols.push(c.r, c.g, c.b)
      uvs.push(WHITE_UV, WHITE_UV)
    }
  }
  for (let k = 0; k < RAYS - 1; k++) {
    for (let r = 0; r < ROWS.length - 1; r++) {
      const a0 = k * ROWS.length + r
      const b0 = a0 + 1
      const a1 = (k + 1) * ROWS.length + r
      const b1 = a1 + 1
      idx.push(a0, b0, a1, b0, b1, a1)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

/**
 * Dorsal / anal fin built from a resampled base curve: 9 fin rays
 * follow the hull surface, membrane sags between rows, trailing
 * edge is scalloped, ray columns darker, tips fade to membrane.
 * dir +1 = along the back, -1 = along the belly.
 */
function makeRayFin(
  base: [number, number][],
  color: THREE.Color,
  radiusAt: (z: number) => number,
  h: number,
  dir: 1 | -1,
  rays = 9,
): THREE.BufferGeometry {
  const st = resampleStations(base, 12)
  const ROWS = [0, 0.5, 1]
  const tipC = color.clone().lerp(new THREE.Color('#eaf4f6'), 0.42)
  const rayC = color.clone().multiplyScalar(0.7)

  const pos: number[] = [], cols: number[] = [], uvs: number[] = [], idx: number[] = []
  for (let k = 0; k < rays; k++) {
    const s = k / (rays - 1)
    const si = s * (st.length - 1)
    const i0 = Math.floor(si)
    const fr = si - i0
    const i1 = Math.min(st.length - 1, i0 + 1)
    const z = st[i0][0] + (st[i1][0] - st[i0][0]) * fr
    const hgt = st[i0][1] + (st[i1][1] - st[i0][1]) * fr
    const baseY = dir * radiusAt(z) * h * 0.86
    const wobble = 1 + Math.sin(k * 2.1 + z * 6) * 0.06          // scalloped edge
    for (let r = 0; r < ROWS.length; r++) {
      const f = ROWS[r]
      const sag = dir * -hgt * 0.05 * Math.sin(f * Math.PI)      // membrane sag
      const y = baseY + dir * hgt * f * wobble + sag
      pos.push(0, y, z)
      const cRow = color.clone().lerp(tipC, f * 0.62)
      const c = f > 0.55 ? cRow : cRow.clone().lerp(rayC, 0.5)
      cols.push(c.r, c.g, c.b)
      uvs.push(WHITE_UV, WHITE_UV)
    }
  }
  for (let k = 0; k < rays - 1; k++) {
    for (let r = 0; r < ROWS.length - 1; r++) {
      const a0 = k * ROWS.length + r
      const b0 = a0 + 1
      const a1 = (k + 1) * ROWS.length + r
      const b1 = a1 + 1
      idx.push(a0, b0, a1, b0, b1, a1)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

/**
 * Pectoral / pelvic fin as a petal-shaped ray fan with a gentle
 * cup (curled backward), darker ray columns, translucent tip.
 * Grows from the origin along +x, then placed with rotations.
 */
function makePectoralFan(size: number, color: THREE.Color, rays = 6): THREE.BufferGeometry {
  const ROWS = [0, 0.4, 0.75, 1]
  const L = size * 1.3
  const tipC = color.clone().lerp(new THREE.Color('#eaf4f6'), 0.5)
  const rayC = color.clone().multiplyScalar(0.72)

  const pos: number[] = [], cols: number[] = [], uvs: number[] = [], idx: number[] = []
  for (let k = 0; k < rays; k++) {
    const psi = ((k / (rays - 1)) * 2 - 1) * 0.55              // fan spread
    const lenK = L * (1 - Math.abs(psi) * 0.4)
    for (let r = 0; r < ROWS.length; r++) {
      const f = ROWS[r]
      const rr = lenK * f
      const x = Math.cos(psi) * rr
      const y = Math.sin(psi) * rr * 1.05 - f * f * L * 0.28   // sweeps down/back
      const z = -f * f * lenK * 0.3 * (1 - Math.abs(psi) * 0.5) // cup backward
      pos.push(x, y, z)
      const cRow = color.clone().lerp(tipC, f * 0.62)
      const c = f > 0.55 ? cRow : cRow.clone().lerp(rayC, 0.5)
      cols.push(c.r, c.g, c.b)
      uvs.push(WHITE_UV, WHITE_UV)
    }
  }
  for (let k = 0; k < rays - 1; k++) {
    for (let r = 0; r < ROWS.length - 1; r++) {
      const a0 = k * ROWS.length + r
      const b0 = a0 + 1
      const a1 = (k + 1) * ROWS.length + r
      const b1 = a1 + 1
      idx.push(a0, b0, a1, b0, b1, a1)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

/** pectoral fin rooted inside the flank at the hull surface */
function placePectoral(side: 1 | -1, size: number, color: THREE.Color, rAt: number, y: number, z: number): THREE.BufferGeometry {
  const g = makePectoralFan(size, color, 6)
  g.rotateY(side * -0.9)
  g.rotateZ(side * 0.5)
  g.translate(side * rAt * 0.74, y, z)
  return g
}

/** paired pelvic fins on the belly, rooted at the hull surface */
function placePelvic(side: 1 | -1, size: number, color: THREE.Color, rAt: number, y: number, z: number): THREE.BufferGeometry {
  const g = makePectoralFan(size, color, 5)
  g.rotateY(side * -0.5)
  g.rotateX(-0.85)                 // sweep downward
  g.translate(side * rAt * 0.4, y, z)
  return g
}

/**
 * 5-layer eye, properly seated IN the head.
 * `sx` = exact flank surface x at the eye point. The eyeball is buried
 * 45% of its radius below the skin so only a low dome + dark socket rim
 * read above the flesh — no more ping-pong ball stuck on the flank.
 * Offsets below are in units of r relative to the sclera centre
 * (outward = ±x, up = +y, forward = +z).
 */
function makeEyeParts(side: 1 | -1, sx: number, y: number, z: number, r: number, iris: string): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = []
  const push = (radius: number, dx: number, dy: number, dz: number, col: string, wSeg: number, hSeg: number) => {
    const g = new THREE.SphereGeometry(radius, wSeg, hSeg)
    setUniformUV(g)
    g.translate(side * (sx + dx * r), y + dy * r, z + dz * r)
    paintColors(g, new THREE.Color(col))
    out.push(g)
  }
  // socket shadow — buried deep, only a dark rim wraps the eyeball base
  push(r * 1.18, -0.78, 0, 0, '#1a2027', 12, 9)
  // sclera — eyeball sphere, centre 45% r under the skin
  push(r * 0.94, 0, 0, 0, '#dfe9ec', 14, 10)
  // iris dome riding forward on the ball
  push(r * 0.60, 0.55, 0.03, 0.10, iris, 12, 9)
  // pupil breaks the iris surface at its centre (was nested/hidden before)
  push(r * 0.34, 0.88, 0.03, 0.12, '#05070a', 10, 8)
  // specular glint, upper-front quadrant
  push(r * 0.16, 0.80, 0.50, 0.50, '#ffffff', 8, 6)
  return out
}

// ------------------------- species table -------------------------
interface SpeciesDef {
  body: BodySpec
  tail: [number, number, number]              // len, spread, fork
  dorsal: [number, number][]
  anal?: [number, number][]
  pectoral: number
  eyeR: number
  eyeIris: string
  finColor: string
  tailColor: string
  tex: TexSpec
  spikes?: boolean
  spikeLen?: number
}

export const SPECIES_DEFS: Record<SpeciesKey, SpeciesDef> = {
  tropical: {
    body: { profile: [0.02, 0.075, 0.14, 0.19, 0.21, 0.17, 0.105, 0.045, 0.012], w: 0.47, h: 1.05, len: 0.55 },
    tail: [0.2, 0.15, 0.7],
    dorsal: [[0.14, 0.05], [0.0, 0.11], [-0.16, 0.04]],
    pectoral: 0.15, eyeR: 0.045, eyeIris: '#2a2014',
    finColor: '#ffffff', tailColor: '#ffffff',
    tex: { back: '#8f8f8f', belly: '#c8c8c8', grayscale: true, bands: [{ v: 0.5, w: 0.1, color: 'rgba(255,255,255,0.55)', soft: true }] },
  },
  angelfish: {
    body: { profile: [0.015, 0.07, 0.14, 0.2, 0.23, 0.19, 0.115, 0.05, 0.015], w: 0.28, h: 1.75, len: 0.5 },
    tail: [0.3, 0.2, 0.25],
    dorsal: [[0.18, 0.1], [0.0, 0.4], [-0.3, 0.34], [-0.58, 0.02]],
    anal: [[0.05, 0.1], [-0.1, 0.36], [-0.42, 0.02]],
    pectoral: 0.13, eyeR: 0.045, eyeIris: '#22323c',
    finColor: '#31414f', tailColor: '#3d5566',
    tex: {
      back: '#e9e2c8', belly: '#f4efd9',
      bands: [
        { v: 0.24, w: 0.09, color: '#242f38', bow: 0.05 },
        { v: 0.58, w: 0.08, color: '#242f38', bow: -0.04 },
        { v: 0.9, w: 0.1, color: '#1c262e', bow: 0.03 },
      ],
    },
  },
  butterflyfish: {
    body: { profile: [0.012, 0.06, 0.12, 0.165, 0.19, 0.155, 0.095, 0.05, 0.03], w: 0.3, h: 1.35, len: 0.48 },
    tail: [0.18, 0.13, 0.15],
    dorsal: [[0.16, 0.06], [-0.05, 0.16], [-0.3, 0.1]],
    anal: [[0.0, 0.1], [-0.25, 0.08]],
    pectoral: 0.12, eyeR: 0.042, eyeIris: '#6a4a1a',
    finColor: '#e8c860', tailColor: '#e8c860',
    tex: {
      back: '#f0cf4e', belly: '#f7e89a',
      vermiculation: true,
      bands: [
        { v: 0.88, w: 0.11, color: '#1c2026', bow: 0.06 },          // eye-band
        { v: 0.2, w: 0.07, color: 'rgba(20,24,28,0.85)', soft: true },  // false-eye spot zone
      ],
      spots: { color: '#1c2026', n: 3, r: 4 },
    },
  },
  clownfish: {
    body: { profile: [0.02, 0.08, 0.145, 0.185, 0.2, 0.16, 0.1, 0.045, 0.02], w: 0.5, h: 1.1, len: 0.42 },
    tail: [0.16, 0.13, 0.1],
    dorsal: [[0.14, 0.05], [-0.02, 0.1], [-0.18, 0.04]],
    pectoral: 0.13, eyeR: 0.048, eyeIris: '#b07a2a',
    finColor: '#ff8c2e', tailColor: '#ff9a44',
    tex: {
      back: '#e8621a', belly: '#ff9440',
      bandOutline: true,
      bands: [
        { v: 0.16, w: 0.1, color: '#f4f8ff', bow: 0.035 },
        { v: 0.52, w: 0.12, color: '#f4f8ff', bow: -0.03 },
        { v: 0.86, w: 0.09, color: '#f4f8ff', bow: 0.025 },
      ],
    },
  },
  tang: {
    body: { profile: [0.02, 0.085, 0.16, 0.2, 0.22, 0.18, 0.11, 0.05, 0.015], w: 0.32, h: 1.5, len: 0.75 },
    tail: [0.22, 0.18, 0.35],
    dorsal: [[0.24, 0.07], [0.0, 0.12], [-0.26, 0.08], [-0.4, 0.04]],
    anal: [[0.05, 0.08], [-0.2, 0.1], [-0.38, 0.03]],
    pectoral: 0.16, eyeR: 0.042, eyeIris: '#1a2a38',
    finColor: '#f2d24a', tailColor: '#f2d24a',
    tex: {
      back: '#2438c8', belly: '#3a55dd',
      bands: [{ v: 0.45, w: 0.16, color: 'rgba(10,12,30,0.75)', soft: true }],
    },
  },
  pufferfish: {
    // globefish — nearly spherical: blunt snout, fat belly, thick
    // peduncle; length ≈ height so the silhouette reads as a ball
    body: { profile: [0.075, 0.2, 0.275, 0.315, 0.335, 0.325, 0.28, 0.2, 0.115], w: 1.04, h: 1.0, len: 0.4 },
    tail: [0.11, 0.09, 0.05],
    dorsal: [[0.02, 0.07], [-0.12, 0.05]],
    anal: [[0.0, 0.06], [-0.12, 0.04]],
    pectoral: 0.11, eyeR: 0.062, eyeIris: '#4a5a68',
    finColor: '#c8b482', tailColor: '#c8b482',
    tex: {
      back: '#c9b384', belly: '#e8dcc0',
      spots: { color: '#4a3f2a', n: 16, r: 3.4 },
    },
    spikes: true,
    spikeLen: 0.11,
  },
  moorish: {
    // Moorish idol — tall compressed body, trailing dorsal filament,
    // bold black bands with a yellow crown
    body: { profile: [0.012, 0.06, 0.125, 0.17, 0.2, 0.16, 0.1, 0.045, 0.018], w: 0.26, h: 1.6, len: 0.52 },
    tail: [0.24, 0.16, 0.3],
    dorsal: [[0.2, 0.12], [0.05, 0.48], [-0.2, 0.42], [-0.4, 0.3], [-0.58, 0.03]],
    anal: [[0.05, 0.1], [-0.1, 0.3], [-0.32, 0.08]],
    pectoral: 0.12, eyeR: 0.042, eyeIris: '#241a12',
    finColor: '#2a2e34', tailColor: '#2a2e34',
    tex: {
      back: '#f2f0e6', belly: '#ffffff',
      bands: [
        { v: 0.9, w: 0.13, color: '#e8b83a', bow: 0.04 },   // yellow crown over the snout
        { v: 0.62, w: 0.15, color: '#20242a', bow: -0.03 }, // broad black band
        { v: 0.3, w: 0.14, color: '#20242a', bow: 0.03 },   // second black band
      ],
    },
  },
  squirrel: {
    // squirrelfish — reddish with silver horizontal stripes, huge nocturnal eye
    body: { profile: [0.02, 0.08, 0.15, 0.19, 0.21, 0.17, 0.1, 0.045, 0.02], w: 0.44, h: 1.2, len: 0.52 },
    tail: [0.2, 0.14, 0.25],
    dorsal: [[0.16, 0.1], [0.04, 0.14], [-0.12, 0.09], [-0.26, 0.04]],
    anal: [[0.0, 0.07], [-0.2, 0.08]],
    pectoral: 0.14, eyeR: 0.068, eyeIris: '#2a2f36',
    finColor: '#e06850', tailColor: '#e06850',
    tex: {
      back: '#c44242', belly: '#efa090',
      flankLines: { color: '#f5efe6', n: 4, alpha: 0.4 },
      bands: [{ v: 0.5, w: 0.06, color: 'rgba(245,240,230,0.55)', soft: true }],
    },
  },
  minnow: {
    // silver baitfish — slim mirror-flanked dart that forms dense bait balls
    body: { profile: [0.012, 0.05, 0.09, 0.115, 0.13, 0.11, 0.07, 0.03, 0.01], w: 0.42, h: 0.95, len: 0.5 },
    tail: [0.22, 0.15, 0.8],                    // deeply forked
    dorsal: [[0.06, 0.07], [-0.06, 0.09], [-0.18, 0.04]],
    anal: [[-0.02, 0.05], [-0.16, 0.06]],
    pectoral: 0.1, eyeR: 0.05, eyeIris: '#39424c',
    finColor: '#9fb4be', tailColor: '#b8ccd4',
    tex: {
      back: '#46586a', belly: '#e6edf2',
      bands: [{ v: 0.5, w: 0.05, color: 'rgba(70,88,106,0.55)', soft: true }],   // faint lateral band
    },
  },
}

// per-species instance tint palettes (multiplied over the texture)
export const SPECIES_TINTS: Record<SpeciesKey, string[][]> = {
  // tropical schools: grayscale texture × saturated tint = vivid morphs
  tropical: [
    ['#ffd24a', '#ffc23a', '#ffe07a'],           // golden
    ['#3ac2ff', '#2ea8e8', '#66d4ff'],           // blue
    ['#ff7a9e', '#ff6a8e', '#ff9ab8'],           // magenta
    ['#5affc8', '#3ae8b0', '#8affd8'],           // seafoam
  ],
  angelfish: [['#ffffff', '#f2ead0']],
  butterflyfish: [['#ffffff', '#fff4c8']],
  clownfish: [['#ffffff', '#ffd8a8']],
  tang: [['#ffffff', '#c8d8ff']],
  pufferfish: [['#ffffff', '#f0e6cc']],
  moorish: [['#ffffff', '#fff0c8']],
  squirrel: [['#ffffff', '#ffc8b8']],
  minnow: [['#f2f7fa', '#d4e2ea']],
}

// ------------------------- assembly -------------------------
export function buildFish(key: SpeciesKey): { geometry: THREE.BufferGeometry; texture: THREE.CanvasTexture } {
  const def = SPECIES_DEFS[key]
  const parts: THREE.BufferGeometry[] = []
  const spikeSet = new Set<THREE.BufferGeometry>()

  const { geo: body, radiusAt, widthAt, surfaceXAt } = makeHull(def.body)
  parts.push(body)

  const finC = new THREE.Color(def.finColor)
  const tailC = new THREE.Color(def.tailColor)
  const bbs = def.body

  // tail — root pushed into the caudal peduncle so the joint never shows
  const tail = makeTailFan(def.tail[0], def.tail[1], def.tail[2], tailC)
  tail.translate(0, 0, -bbs.len * 0.46)
  parts.push(tail)

  // dorsal + anal fins — ray grids seated on the hull surface
  parts.push(makeRayFin(def.dorsal, finC, radiusAt, bbs.h, 1, 9))
  if (def.anal) parts.push(makeRayFin(def.anal, finC, radiusAt, bbs.h, -1, 7))

  // pectorals just behind the gill plate, rooted in the flank
  // z = 0.1·L ≈ station 0.6 — right where the gill texture ends
  const pecC = finC.clone().lerp(new THREE.Color('#ffffff'), 0.25)
  const pecZ = bbs.len * 0.1
  const pecW = widthAt(pecZ) * bbs.w
  parts.push(placePectoral(1, def.pectoral, pecC, pecW, -radiusAt(pecZ) * bbs.h * 0.12, pecZ))
  parts.push(placePectoral(-1, def.pectoral, pecC, pecW, -radiusAt(pecZ) * bbs.h * 0.12, pecZ))

  // pelvics on the belly line, slightly behind and below the pectorals
  const pelZ = bbs.len * 0.08
  parts.push(placePelvic(1, def.pectoral * 0.9, finC, widthAt(pelZ) * bbs.w, -radiusAt(pelZ) * bbs.h * 0.62, pelZ))
  parts.push(placePelvic(-1, def.pectoral * 0.9, finC, widthAt(pelZ) * bbs.w, -radiusAt(pelZ) * bbs.h * 0.62, pelZ))

  // eyes — seated IN the flank at the true skin surface, sized to the head
  // z = 0.28·L ≈ station 0.78 (on the head, ahead of the gill plate)
  const eyeZ = bbs.len * 0.28
  const eyeY = radiusAt(eyeZ) * bbs.h * 0.38            // 38% up the LOCAL head height
  const skinX = surfaceXAt(eyeZ, eyeY)                  // exact skin x at the eye point
  const eyeR = Math.min(def.eyeR, skinX * 0.85)         // never wider than the head there
  parts.push(...makeEyeParts(1, skinX, eyeY, eyeZ, eyeR, def.eyeIris))
  parts.push(...makeEyeParts(-1, skinX, eyeY, eyeZ, eyeR, def.eyeIris))

  // pufferfish spikes — seated at the hull surface and RADIATING
  // outward (axis = local surface normal). Each vertex carries an
  // `aSpike` apex weight (0 base → 1 tip) so the defence shader can
  // anchor the base to the inflating skin while the tip extends.
  if (def.spikes) {
    const rng = mulberry32(7)
    const spikeLen = def.spikeLen ?? 0.07
    for (let i = 0; i < 78; i++) {
      const a = rng() * Math.PI * 2
      const y = (rng() - 0.35) * 0.3
      const t = 0.25 + rng() * 0.45
      const z = (-0.5 + t) * 2 * bbs.len * 0.9
      const yAbs = y * bbs.h + Math.abs(y) * 0.2
      // keep the orbit clear — no spike stabs the eye
      if (Math.hypot(z - eyeZ, yAbs - eyeY) < eyeR * 1.7) continue
      const profR = radiusAt(z)
      // cross-section shrinks toward the ridge/belly — pull the base in with it
      const yHalf = Math.max(1e-4, profR * bbs.h)
      const shrink = Math.sqrt(Math.max(0.15, 1 - (yAbs / yHalf) * (yAbs / yHalf)))
      const px = Math.cos(a) * profR * bbs.w * 0.96 * shrink
      // outward direction = elliptic surface normal at the base point
      const dir = new THREE.Vector3(px / (profR * bbs.w + 1e-5), yAbs / yHalf, 0).normalize()
      const spike = new THREE.ConeGeometry(0.016, spikeLen, 4)
      setUniformUV(spike)
      // apex weight BEFORE any transform: base ring 0 → tip 1
      const sw = new Float32Array(spike.attributes.position.count)
      for (let k = 0; k < sw.length; k++) {
        sw[k] = clamp((spike.attributes.position.getY(k) + spikeLen / 2) / spikeLen, 0, 1)
      }
      spike.setAttribute('aSpike', new THREE.BufferAttribute(sw, 1))
      spike.translate(0, spikeLen * 0.5 - 0.02, 0)      // base buried 0.02 in the skin
      spike.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir))
      spike.translate(px, yAbs, z)
      paintColors(spike, new THREE.Color('#b8a478'))
      spikeSet.add(spike)
      parts.push(spike)
    }
  }

  const merged = mergeGeometries(
    parts.map((p) => {
      const g = p.index ? p.toNonIndexed() : p
      // every part must carry the attribute set — body verts never move
      if (def.spikes && !g.attributes.aSpike) {
        g.setAttribute('aSpike', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count), 1))
      }
      return g
    }),
    false,
  )!
  return { geometry: merged, texture: fishTexture(def.tex) }
}

/** shared material factory per species (scale bump, swim-bend, fin flutter, fresnel rim).
 *  opts.puff → pufferfish defence display: `aPuff` (per-instance 0..1) inflates
 *  the hull radially while spike tips (aSpike weight) extend off the skin. */
export function makeFishMaterial(
  texture: THREE.CanvasTexture, swimAmp: number, swimFreq: number, cacheKey: string,
  opts: { puff?: boolean } = {},
): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    map: texture,
    bumpMap: fishBumpTexture(),
    bumpScale: 0.5,
    vertexColors: true,
    roughness: 0.32,      // wet, slick skin
    metalness: 0.26,      // faint iridescent sheen under the key light
    side: THREE.DoubleSide,
  })
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 }          // patched externally each frame
    shader.uniforms.uSwimAmp = { value: swimAmp }
    shader.uniforms.uSwimFreq = { value: swimFreq }
    shader.uniforms.uRimColor = { value: new THREE.Color('#a8dff2') }
    shader.uniforms.uRimStrength = { value: 0.5 }
    shader.vertexShader = `
      uniform float uTime, uSwimAmp, uSwimFreq;
      attribute float aPhase;
      ${opts.puff ? 'attribute float aPuff;\n      attribute float aSpike;' : ''}
    ` + shader.vertexShader
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
      #include <begin_vertex>
      {
        float tTail = clamp((0.28 - position.z) / 0.85, 0.0, 1.0);
        tTail *= tTail;
        transformed.x += sin(uTime * uSwimFreq + aPhase - position.z * 2.4) * uSwimAmp * tTail;
        transformed.x += sin(uTime * uSwimFreq * 0.5 + aPhase) * uSwimAmp * 0.06;
        // fin membrane flutter — tall fin tips ripple softly out of phase
        float finMask = smoothstep(0.55, 1.4, abs(transformed.y)) * (1.0 - tTail);
        transformed.x += sin(uTime * uSwimFreq * 1.35 + aPhase * 1.7) * uSwimAmp * 0.4 * finMask;
        ${opts.puff ? `// defence display: hull inflates radially, spines ride the skin
        float coreFall = 1.0 - smoothstep(0.14, 0.3, abs(position.z));
        float hullGrow = aPuff * 0.17 * coreFall;
        transformed.xyz += normalize(position + vec3(1e-4)) * (hullGrow + aPuff * aSpike * 0.34);` : ''}
      }
    `)
    shader.fragmentShader = `
      uniform vec3 uRimColor;
      uniform float uRimStrength;
    ` + shader.fragmentShader
    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
      {
        // underwater subsurface-ish rim: soft light wrapping the silhouette
        vec3 vDir = normalize(vViewPosition);
        float fres = pow(clamp(1.0 - abs(dot(normalize(vNormal), vDir)), 0.0, 1.0), 3.0);
        outgoingLight += uRimColor * fres * uRimStrength;
      }
      #include <opaque_fragment>
    `)
  }
  mat.customProgramCacheKey = () => cacheKey + '-v4'
  return mat
}

/** hook the shared clock into a fish material's shader */
export function bindFishTime(mat: THREE.MeshStandardMaterial, getTime: () => number) {
  // onBeforeCompile captured the uniforms object; patch through userData
  const orig = mat.onBeforeCompile
  mat.onBeforeCompile = (shader, renderer) => {
    orig(shader, renderer)
    ;(mat.userData as { shaders?: THREE.WebGLProgramParametersWithUniforms[] }).shaders =
      [...((mat.userData.shaders as THREE.WebGLProgramParametersWithUniforms[]) ?? []), shader]
    mat.userData.getTime = getTime
  }
}

/** call every frame to push time into all compiled fish shaders */
export function updateFishMaterialTime(mat: THREE.MeshStandardMaterial, t: number) {
  const shaders = (mat.userData.shaders as { uniforms: { uTime: { value: number } } }[] | undefined) ?? []
  for (const s of shaders) s.uniforms.uTime.value = t
}
