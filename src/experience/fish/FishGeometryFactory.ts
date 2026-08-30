// ---------------------------------------------------------------
// FishGeometryFactory — procedural, stylized-realistic fish built
// from smooth lathe bodies + parametric fins. Nose points +Z, tail -Z.
//
// v2 realism pass:
//   • 256px canvas textures: procedural scale rows, gill plates,
//     lateral lines, mouth shading, true counter-shading
//   • Catmull-Rom resampled body profiles → organic silhouettes
//   • 3-layer eyes (sclera + pupil + glint) and pelvic fins
//   • wet-look material (low roughness) + underwater fresnel rim
// Patterns are painted on canvas textures; fins/eyes sample a
// reserved white texel and get their colour from vertex colors.
// Every geometry carries: position, normal, uv, color and is
// merged into ONE buffer per species → one instanced draw call.
// ---------------------------------------------------------------
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { mulberry32 } from '../utils/math'

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
// smooth body profiles — Catmull-Rom through the control radii
// ---------------------------------------------------------------
function resampleProfile(profile: number[], n = 14): number[] {
  const pts = profile
  const segs = pts.length - 1
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * segs
    const s = Math.min(segs - 1.0001, t)
    const k = Math.floor(s)
    const f = s - k
    const p0 = pts[Math.max(0, k - 1)]
    const p1 = pts[k]
    const p2 = pts[Math.min(segs, k + 1)]
    const p3 = pts[Math.min(segs, k + 2)]
    const v = p1 + 0.5 * f * (p2 - p0
      + f * (2 * p0 - 5 * p1 + 4 * p2 - p3
      + f * (3 * (p1 - p2) + p3 - p0)))
    out.push(Math.max(0.004, v))
  }
  return out
}

// ------------------------- canvas textures -------------------------
interface TexSpec {
  back: string
  belly: string
  bands?: { v: number; w: number; color: string; soft?: boolean }[]
  spots?: { color: string; n: number; r: number }
  grayscale?: boolean
}

function fishTexture(spec: TexSpec): THREE.CanvasTexture {
  const S = 256
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

  // ---- procedural scales: subtle overlapping crescents ----
  // rows run along the body (canvas y), columns wrap the flank (canvas x)
  const rng = mulberry32(11)
  const rows = 30, cols = 34
  const cw = S / cols, ch = S / rows
  for (let r = 0; r <= rows; r++) {
    const off = (r % 2) * 0.5
    for (let col = 0; col <= cols; col++) {
      const x = (col + off) * cw
      const y = r * ch
      const rad = cw * (0.68 + rng() * 0.16)
      g.strokeStyle = 'rgba(8,14,20,0.13)'
      g.lineWidth = 1.4
      g.beginPath()
      g.arc(x, y - rad * 0.3, rad, Math.PI * 0.12, Math.PI * 0.88)
      g.stroke()
      g.strokeStyle = 'rgba(255,255,255,0.085)'
      g.lineWidth = 1.1
      g.beginPath()
      g.arc(x, y - rad * 0.38, rad * 0.95, Math.PI * 0.18, Math.PI * 0.82)
      g.stroke()
    }
  }

  // ---- gill plates (operculum) on each flank ----
  for (const gx of [0.25, 0.75]) {
    const x = gx * S
    const yTop = 0.16 * S, yBot = 0.43 * S
    const dir = gx < 0.5 ? 1 : -1
    g.strokeStyle = 'rgba(10,16,22,0.34)'
    g.lineWidth = 3.4
    g.beginPath()
    g.moveTo(x - 6 * dir, yTop)
    g.quadraticCurveTo(x + 10 * dir, (yTop + yBot) / 2, x - 5 * dir, yBot)
    g.stroke()
    g.strokeStyle = 'rgba(10,16,22,0.15)'
    g.lineWidth = 2
    g.beginPath()
    g.moveTo(x - 17 * dir, yTop + 7)
    g.quadraticCurveTo(x - 2 * dir, (yTop + yBot) / 2, x - 14 * dir, yBot - 4)
    g.stroke()
  }

  // ---- lateral lines (faint dashed) ----
  g.setLineDash([8, 7])
  g.strokeStyle = 'rgba(238,248,252,0.1)'
  g.lineWidth = 2
  for (const lx of [0.25, 0.75]) {
    g.beginPath()
    g.moveTo(lx * S, 0.3 * S)
    g.lineTo(lx * S, 0.88 * S)
    g.stroke()
  }
  g.setLineDash([])

  // ---- mouth shading on the snout ----
  g.fillStyle = 'rgba(8,10,14,0.32)'
  for (const mx of [0.25, 0.75]) {
    g.beginPath()
    g.ellipse(mx * S, 0.016 * S, 8, 3.6, 0, 0, Math.PI * 2)
    g.fill()
  }

  if (spec.spots) {
    const srng = mulberry32(99)
    g.fillStyle = spec.spots.color
    for (let i = 0; i < spec.spots.n; i++) {
      const x = 30 + srng() * (S - 60)
      const y = 22 + srng() * (S - 44)
      g.beginPath()
      g.arc(x, y, spec.spots.r * (0.6 + srng() * 0.8), 0, Math.PI * 2)
      g.fill()
    }
  }

  // bands: v (0 tail → 1 nose) → canvas y = (1 - v) * S
  if (spec.bands) {
    for (const b of spec.bands) {
      const y = (1 - b.v) * S
      g.fillStyle = b.color
      if (b.soft) {
        const bg = g.createLinearGradient(0, y - b.w * S, 0, y + b.w * S)
        bg.addColorStop(0, 'rgba(0,0,0,0)')
        bg.addColorStop(0.5, b.color)
        bg.addColorStop(1, 'rgba(0,0,0,0)')
        g.fillStyle = bg
        g.fillRect(0, y - b.w * S, S, b.w * S * 2)
      } else {
        g.fillRect(0, y - b.w * S * 0.5, S, b.w * S)
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
  g.fillRect(S - 12, S - 12, 12, 12)

  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

// ------------------------- parts builders -------------------------
interface BodySpec {
  profile: number[]       // control radii, tail → nose
  w: number; h: number; len: number
}

function makeBody(spec: BodySpec): THREE.BufferGeometry {
  const smooth = resampleProfile(spec.profile, 14)
  const pts = smooth.map((r, i) => new THREE.Vector2(Math.max(0.004, r), -0.5 + i / (smooth.length - 1)))
  const geo = new THREE.LatheGeometry(pts, 20)
  geo.rotateX(Math.PI / 2)                      // profile y → world z, nose +z
  geo.scale(spec.w, spec.h, spec.len)
  // white base color so texture shows unmodified
  const count = geo.attributes.position.count
  const arr = new Float32Array(count * 3).fill(1)
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3))
  return geo
}

/** tail fan in the YZ plane, attached at z = attachZ */
function makeTail(len: number, spread: number, fork: number, color: THREE.Color): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  const v = new Float32Array([
    0, 0, 0,          0, spread, -len,        0, fork * spread * 0.45, -len * 1.04,
    0, 0, 0,          0, fork * spread * 0.45, -len * 1.04,   0, -spread, -len,
  ])
  g.setAttribute('position', new THREE.BufferAttribute(v, 3))
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(12).fill(WHITE_UV), 2))
  g.computeVertexNormals()
  paintColors(g, color)
  return g
}

/** dorsal / anal fin strip: pairs of [zOffset, height] along the back */
function makeFinStrip(base: [number, number][], color: THREE.Color, yBase: number): THREE.BufferGeometry {
  const verts: number[] = []
  for (let i = 0; i < base.length - 1; i++) {
    const [z0, h0] = base[i]
    const [z1, h1] = base[i + 1]
    // two triangles per segment
    verts.push(0, yBase, z0, 0, yBase + h0, z0, 0, yBase + h1, z1)
    verts.push(0, yBase, z0, 0, yBase + h1, z1, 0, yBase, z1)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3))
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((verts.length / 3) * 2).fill(WHITE_UV), 2))
  g.computeVertexNormals()
  paintColors(g, color)
  return g
}

function makePectoral(side: 1 | -1, size: number, color: THREE.Color): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(size, size * 0.5)
  setUniformUV(g)
  g.rotateY(side * -0.9)
  g.rotateZ(side * 0.5)
  g.translate(side * 0.06, -0.02, 0.05)
  paintColors(g, color)
  return g
}

/** small paired pelvic fins on the belly, slightly behind the pectorals */
function makePelvic(side: 1 | -1, size: number, color: THREE.Color, y: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(size * 0.8, size * 0.5)
  setUniformUV(g)
  g.rotateX(-1.05)                 // sweep downward
  g.rotateY(side * -0.5)           // angle out & back
  g.translate(side * 0.05, y, 0.13)
  paintColors(g, color)
  return g
}

/** 3-layer eye: sclera + pupil + specular glint (reads as alive) */
function makeEyeParts(side: 1 | -1, x: number, y: number, z: number, r: number): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = []

  const sclera = new THREE.SphereGeometry(r, 10, 8)
  setUniformUV(sclera)
  sclera.translate(side * x, y, z)
  paintColors(sclera, new THREE.Color('#dfe9ec'))
  out.push(sclera)

  const pupil = new THREE.SphereGeometry(r * 0.56, 8, 6)
  setUniformUV(pupil)
  pupil.translate(side * (x + r * 0.5), y + r * 0.06, z + r * 0.14)
  paintColors(pupil, new THREE.Color('#05070a'))
  out.push(pupil)

  const glint = new THREE.SphereGeometry(r * 0.2, 6, 4)
  setUniformUV(glint)
  glint.translate(side * (x + r * 0.74), y + r * 0.46, z + r * 0.52)
  paintColors(glint, new THREE.Color('#ffffff'))
  out.push(glint)

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
  finColor: string
  tailColor: string
  tex: TexSpec
  spikes?: boolean
  spikeLen?: number
  stripes?: boolean
}

export const SPECIES_DEFS: Record<SpeciesKey, SpeciesDef> = {
  tropical: {
    body: { profile: [0.02, 0.09, 0.17, 0.21, 0.16, 0.07, 0.012], w: 0.47, h: 1.05, len: 0.55 },
    tail: [0.2, 0.15, 0.7],
    dorsal: [[0.14, 0.05], [0.0, 0.11], [-0.16, 0.04]],
    pectoral: 0.15, eyeR: 0.045,
    finColor: '#ffffff', tailColor: '#ffffff',
    tex: { back: '#8f8f8f', belly: '#c8c8c8', grayscale: true, bands: [{ v: 0.5, w: 0.1, color: 'rgba(255,255,255,0.55)', soft: true }] },
  },
  angelfish: {
    body: { profile: [0.015, 0.1, 0.2, 0.23, 0.18, 0.06, 0.015], w: 0.28, h: 1.75, len: 0.5 },
    tail: [0.3, 0.2, 0.25],
    dorsal: [[0.18, 0.1], [0.0, 0.4], [-0.3, 0.34], [-0.58, 0.02]],
    anal: [[0.05, 0.1], [-0.1, 0.36], [-0.42, 0.02]],
    pectoral: 0.13, eyeR: 0.045,
    finColor: '#31414f', tailColor: '#3d5566',
    tex: {
      back: '#e9e2c8', belly: '#f4efd9',
      bands: [
        { v: 0.24, w: 0.09, color: '#242f38' },
        { v: 0.58, w: 0.08, color: '#242f38' },
        { v: 0.9, w: 0.1, color: '#1c262e' },
      ],
    },
  },
  butterflyfish: {
    body: { profile: [0.012, 0.08, 0.16, 0.19, 0.15, 0.055, 0.035], w: 0.3, h: 1.35, len: 0.48 },
    tail: [0.18, 0.13, 0.15],
    dorsal: [[0.16, 0.06], [-0.05, 0.16], [-0.3, 0.1]],
    anal: [[0.0, 0.1], [-0.25, 0.08]],
    pectoral: 0.12, eyeR: 0.042,
    finColor: '#e8c860', tailColor: '#e8c860',
    tex: {
      back: '#f0cf4e', belly: '#f7e89a',
      bands: [
        { v: 0.88, w: 0.11, color: '#1c2026' },          // eye-band
        { v: 0.2, w: 0.07, color: 'rgba(20,24,28,0.85)', soft: true },  // false-eye spot zone
      ],
      spots: { color: '#1c2026', n: 3, r: 5 },
    },
  },
  clownfish: {
    body: { profile: [0.02, 0.1, 0.18, 0.2, 0.15, 0.07, 0.02], w: 0.5, h: 1.1, len: 0.42 },
    tail: [0.16, 0.13, 0.1],
    dorsal: [[0.14, 0.05], [-0.02, 0.1], [-0.18, 0.04]],
    pectoral: 0.13, eyeR: 0.048,
    finColor: '#ff8c2e', tailColor: '#ff9a44',
    tex: {
      back: '#e8621a', belly: '#ff9440',
      bands: [
        { v: 0.16, w: 0.1, color: '#f4f8ff' },
        { v: 0.52, w: 0.12, color: '#f4f8ff' },
        { v: 0.86, w: 0.09, color: '#f4f8ff' },
      ],
    },
  },
  tang: {
    body: { profile: [0.02, 0.11, 0.2, 0.22, 0.17, 0.07, 0.015], w: 0.32, h: 1.5, len: 0.75 },
    tail: [0.22, 0.18, 0.35],
    dorsal: [[0.24, 0.07], [0.0, 0.12], [-0.26, 0.08], [-0.4, 0.04]],
    anal: [[0.05, 0.08], [-0.2, 0.1], [-0.38, 0.03]],
    pectoral: 0.16, eyeR: 0.042,
    finColor: '#f2d24a', tailColor: '#f2d24a',
    tex: {
      back: '#2438c8', belly: '#3a55dd',
      bands: [{ v: 0.45, w: 0.16, color: 'rgba(10,12,30,0.75)', soft: true }],
    },
  },
  pufferfish: {
    body: { profile: [0.035, 0.22, 0.3, 0.32, 0.27, 0.13, 0.045], w: 1.0, h: 1.05, len: 0.48 },
    tail: [0.12, 0.1, 0.05],
    dorsal: [[0.02, 0.08], [-0.14, 0.06]],
    anal: [[0.0, 0.07], [-0.14, 0.05]],
    pectoral: 0.12, eyeR: 0.065,
    finColor: '#c8b482', tailColor: '#c8b482',
    tex: {
      back: '#c9b384', belly: '#e8dcc0',
      spots: { color: '#4a3f2a', n: 14, r: 4 },
    },
    spikes: true,
    spikeLen: 0.09,
  },
  moorish: {
    // Moorish idol — tall compressed body, trailing dorsal filament,
    // bold black bands with a yellow crown
    body: { profile: [0.012, 0.09, 0.18, 0.2, 0.14, 0.05, 0.018], w: 0.26, h: 1.6, len: 0.52 },
    tail: [0.24, 0.16, 0.3],
    dorsal: [[0.2, 0.12], [0.05, 0.48], [-0.2, 0.42], [-0.4, 0.3], [-0.58, 0.03]],
    anal: [[0.05, 0.1], [-0.1, 0.3], [-0.32, 0.08]],
    pectoral: 0.12, eyeR: 0.042,
    finColor: '#2a2e34', tailColor: '#2a2e34',
    tex: {
      back: '#f2f0e6', belly: '#ffffff',
      bands: [
        { v: 0.9, w: 0.13, color: '#e8b83a' },   // yellow crown over the snout
        { v: 0.62, w: 0.15, color: '#20242a' },  // broad black band
        { v: 0.3, w: 0.14, color: '#20242a' },   // second black band
      ],
    },
  },
  squirrel: {
    // squirrelfish — reddish with a silver lateral stripe, huge nocturnal eye
    body: { profile: [0.02, 0.1, 0.19, 0.21, 0.16, 0.07, 0.02], w: 0.44, h: 1.2, len: 0.52 },
    tail: [0.2, 0.14, 0.25],
    dorsal: [[0.16, 0.1], [0.04, 0.14], [-0.12, 0.09], [-0.26, 0.04]],
    anal: [[0.0, 0.07], [-0.2, 0.08]],
    pectoral: 0.14, eyeR: 0.068,
    finColor: '#e06850', tailColor: '#e06850',
    tex: {
      back: '#c44242', belly: '#efa090',
      bands: [{ v: 0.5, w: 0.09, color: 'rgba(245,240,230,0.8)', soft: true }],
    },
  },
  minnow: {
    // silver baitfish — slim mirror-flanked dart that forms dense bait balls
    body: { profile: [0.012, 0.06, 0.11, 0.13, 0.1, 0.045, 0.01], w: 0.42, h: 0.95, len: 0.5 },
    tail: [0.22, 0.15, 0.8],                    // deeply forked
    dorsal: [[0.06, 0.07], [-0.06, 0.09], [-0.18, 0.04]],
    anal: [[-0.02, 0.05], [-0.16, 0.06]],
    pectoral: 0.1, eyeR: 0.05,
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

  const body = makeBody(def.body)
  parts.push(body)

  const finC = new THREE.Color(def.finColor)
  const tailC = new THREE.Color(def.tailColor)
  const bbs = def.body

  // tail
  const tail = makeTail(def.tail[0], def.tail[1], def.tail[2], tailC)
  tail.translate(0, 0, -bbs.len * 0.98)
  parts.push(tail)

  // dorsal (+ anal)
  parts.push(makeFinStrip(def.dorsal, finC, bbs.h * bbs.profile[3] * 0.82))
  if (def.anal) parts.push(makeFinStrip(def.anal, finC, -bbs.h * bbs.profile[3] * 0.82))

  // pectorals + pelvics
  const pecC = finC.clone().lerp(new THREE.Color('#ffffff'), 0.25)
  parts.push(makePectoral(1, def.pectoral, pecC))
  parts.push(makePectoral(-1, def.pectoral, pecC))
  const pelvY = -bbs.h * bbs.profile[3] * 0.52 - 0.015
  parts.push(makePelvic(1, def.pectoral * 0.9, finC, pelvY))
  parts.push(makePelvic(-1, def.pectoral * 0.9, finC, pelvY))

  // 3-layer eyes on the head surface
  const eyeX = bbs.profile[4] * bbs.w + 0.02
  const eyeZ = bbs.len * 0.62
  parts.push(...makeEyeParts(1, eyeX, bbs.h * 0.06, eyeZ, def.eyeR))
  parts.push(...makeEyeParts(-1, eyeX, bbs.h * 0.06, eyeZ, def.eyeR))

  // pufferfish spikes
  if (def.spikes) {
    const rng = mulberry32(7)
    const spikeLen = def.spikeLen ?? 0.07
    for (let i = 0; i < 44; i++) {
      const a = rng() * Math.PI * 2
      const y = (rng() - 0.35) * 0.3
      const t = 0.25 + rng() * 0.45
      const profR = bbs.profile[2 + Math.floor(t * 4)] ?? 0.25
      const z = (-0.5 + t) * 2 * bbs.len * 0.9
      const spike = new THREE.ConeGeometry(0.014, spikeLen, 4)
      setUniformUV(spike)
      spike.rotateX(Math.PI / 2)
      spike.rotateY(a)
      spike.translate(Math.cos(a) * profR * bbs.w, y * bbs.h + Math.abs(y) * 0.2, z)
      paintColors(spike, new THREE.Color('#b8a478'))
      parts.push(spike)
    }
  }

  const merged = mergeGeometries(
    parts.map((p) => (p.index ? p.toNonIndexed() : p)),
    false,
  )!
  return { geometry: merged, texture: fishTexture(def.tex) }
}

/** shared material factory per species (swim-bend + underwater fresnel rim) */
export function makeFishMaterial(texture: THREE.CanvasTexture, swimAmp: number, swimFreq: number, cacheKey: string): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    map: texture,
    vertexColors: true,
    roughness: 0.34,      // wet, slick skin
    metalness: 0.24,      // faint iridescent sheen under the key light
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
    ` + shader.vertexShader
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
      #include <begin_vertex>
      {
        float tTail = clamp((0.28 - position.z) / 0.85, 0.0, 1.0);
        tTail *= tTail;
        transformed.x += sin(uTime * uSwimFreq + aPhase - position.z * 2.4) * uSwimAmp * tTail;
        transformed.x += sin(uTime * uSwimFreq * 0.5 + aPhase) * uSwimAmp * 0.06;
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
  mat.customProgramCacheKey = () => cacheKey + '-v2'
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
