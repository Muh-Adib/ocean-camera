// ---------------------------------------------------------------
// CoralSystem v2 — REAL high-detail coral geometry.
// Every family is sculpted for photoreal close-ups at 360°:
//   • staghorn  — multi-trunk tapered branches, axial corallite
//                 rugosity, pale growth tips
//   • table     — undulating lens disc with radial fold ridges,
//                 scalloped rim, polyp rows, under-strut crown
//   • brain     — dense meandering gyri maze with dark grooves
//   • fan       — TRUE 3D gorgonian lattice (branch tree + rungs),
//                 gently cupped, sways with the current
//   • tube      — ribbed polyp tubes with rim lips + dark throats
//   • soft      — plump lobed polyp clusters, bright tips
//   • anemone   — tentacle rings with bend + glowing tips
// All families are merged per-kind into single draw calls and
// answer the gesture force field through the sway shader.
// Poly budget ≈ 1.1M tris on the high tier (scaled by `detail`).
// ---------------------------------------------------------------
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { weldSmooth } from './smoothShading'
import { sharedUniforms } from '../core/sharedUniforms'
import { mulberry32, noise2 } from '../utils/math'
import { injectCaustic } from './causticInject'
import type { Obstacle } from './Rocks'
import type { GrowthSpot } from './LimestoneReef'

type Rng = () => number

// ---------------- vertex painting helpers ----------------
function paint(geo: THREE.BufferGeometry, base: THREE.Color, vary: number, rng: Rng, topLighten = 0.35) {
  geo.computeBoundingBox()
  const bb = geo.boundingBox!
  const h = Math.max(0.001, bb.max.y - bb.min.y)
  const count = geo.attributes.position.count
  const colors = new Float32Array(count * 3)
  const c = new THREE.Color()
  const white = new THREE.Color('#ffffff')
  for (let i = 0; i < count; i++) {
    const y = geo.attributes.position.getY(i)
    const t = (y - bb.min.y) / h
    c.copy(base)
    const v = 1 + (rng() - 0.5) * vary
    c.multiplyScalar(v)
    c.lerp(white, t * topLighten * 0.55)
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return geo
}

function tint(geo: THREE.BufferGeometry, tintCol: THREE.Color) {
  const col = geo.attributes.color as THREE.BufferAttribute
  for (let i = 0; i < col.count; i++) {
    col.setXYZ(i, col.getX(i) * tintCol.r, col.getY(i) * tintCol.g, col.getZ(i) * tintCol.b)
  }
  return geo
}

// ---------------- family detail tiers ----------------
interface Tier { rs: number; hs: number; depth: number; tipSeg: [number, number]; trunks: number }
function tierFor(detail: number): Tier {
  if (detail >= 0.9) return { rs: 10, hs: 4, depth: 4, tipSeg: [10, 7], trunks: 4 }
  if (detail >= 0.6) return { rs: 7, hs: 3, depth: 3, tipSeg: [8, 6], trunks: 3 }
  return { rs: 6, hs: 2, depth: 2, tipSeg: [6, 5], trunks: 2 }
}

// ---------------- coral family generators ----------------

// ★ STAGHORN — branching Acropora with corallite rugosity & pale tips
function makeStaghorn(rng: Rng, detail: number): THREE.BufferGeometry {
  const geoms: THREE.BufferGeometry[] = []
  const palette = ['#b05ac9', '#d45a9a', '#5a9ac9', '#c98a5a', '#e07850', '#7ac9a8', '#c9c95a']
  const base = new THREE.Color(pickF(palette, rng))
  const up = new THREE.Vector3(0, 1, 0)
  const tipCol = new THREE.Color('#ffe9c9')
  const tier = tierFor(detail)

  const grow = (origin: THREE.Vector3, dir: THREE.Vector3, len: number, radius: number, depth: number) => {
    const end = origin.clone().addScaledVector(dir, len)
    const cyl = new THREE.CylinderGeometry(radius * 0.62, radius, len, tier.rs, tier.hs)
    const p = cyl.attributes.position as THREE.BufferAttribute
    const bendAxis = new THREE.Vector3(rng() - 0.5, 0, rng() - 0.5).normalize()
    for (let i = 0; i < p.count; i++) {
      const fy = p.getY(i) / len + 0.5                     // 0 bottom → 1 top
      let x = p.getX(i), z = p.getZ(i)
      // organic bow along a random horizontal axis
      const k = fy * fy * 0.85
      x += bendAxis.x * len * 0.2 * k
      z += bendAxis.z * len * 0.2 * k
      // axial corallite rings + fine noise → real staghorn surface
      const r2 = Math.hypot(x, z)
      if (r2 > 0.0005 && fy > 0.03 && fy < 0.97) {
        const ang = Math.atan2(z, x)
        const bump = 1
          + Math.sin(ang * 9 + fy * 34) * 0.045
          + noise2(x * 30 + depth * 7, z * 30 - fy * 21) * 0.09
        x *= bump; z *= bump
      }
      p.setXYZ(i, x, p.getY(i), z)
    }
    cyl.computeVertexNormals()
    cyl.translate(0, len / 2, 0)
    cyl.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, dir))
    cyl.translate(origin.x, origin.y, origin.z)
    const branchCol = base.clone().offsetHSL((rng() - 0.5) * 0.02, 0, (rng() - 0.5) * 0.09)
    geoms.push(paint(cyl, branchCol, 0.2, rng, 0.14))
    if (depth <= 0) {
      const tip = new THREE.SphereGeometry(radius * 0.9, tier.tipSeg[0], tier.tipSeg[1])
      tip.translate(end.x, end.y, end.z)
      geoms.push(paint(tip, base.clone().lerp(tipCol, 0.62), 0.1, rng, 0))
      return
    }
    // v3: 2 children in the upper levels keeps recursion-4 affordable;
    // the wider 2-3 spread happens only near the tips (corymbose look)
    const children = depth >= 3 ? 2 : rng() < 0.5 ? 3 : 2
    for (let i = 0; i < children; i++) {
      const nd = dir.clone()
      const axis = new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize()
      nd.applyAxisAngle(axis, 0.32 + rng() * 0.5)
      nd.y = Math.abs(nd.y) * 0.6 + 0.3
      nd.normalize()
      grow(end, nd, len * (0.7 + rng() * 0.16), radius * 0.66, depth - 1)
    }
  }

  // several spreading trunks from a wide base — reads as ONE colony
  // v3: corymbose base plate + short nubs so the colony reads as a
  // proper bush from every angle (not a bundle of bare sticks)
  if (detail >= 0.6) {
    const plate = new THREE.SphereGeometry(0.34, detail >= 0.9 ? 16 : 12, detail >= 0.9 ? 9 : 7)
    plate.scale(1.3, 0.26, 1.3)
    {
      const pp = plate.attributes.position as THREE.BufferAttribute
      const v = new THREE.Vector3()
      for (let i = 0; i < pp.count; i++) {
        v.fromBufferAttribute(pp, i)
        const n = noise2(v.x * 7 + 2, (v.y + v.z) * 7)
        pp.setXYZ(i, v.x * (1 + n * 0.12), v.y, v.z * (1 + n * 0.12))
      }
      plate.computeVertexNormals()
    }
    geoms.push(paint(plate, base.clone().multiplyScalar(0.5), 0.2, rng, 0.05))
    const nubs = detail >= 0.9 ? 12 : 7
    for (let i = 0; i < nubs; i++) {
      const a = rng() * Math.PI * 2
      const d = Math.sqrt(rng()) * 0.4
      const nl = 0.08 + rng() * 0.14
      const nub = new THREE.CylinderGeometry(0.013, 0.022, nl, 5, 1)
      nub.translate(0, nl / 2, 0)
      nub.rotateZ(Math.cos(a) * 0.3)
      nub.rotateX(Math.sin(a) * 0.3)
      nub.translate(Math.cos(a) * d, 0.04, Math.sin(a) * d)
      geoms.push(paint(nub, base.clone().lerp(tipCol, 0.22), 0.16, rng, 0.3))
    }
  }

  const trunks = tier.trunks + (rng() < 0.4 ? 1 : 0)
  for (let i = 0; i < trunks; i++) {
    const a = (i / trunks) * Math.PI * 2 + rng() * 0.9
    grow(
      new THREE.Vector3(Math.cos(a) * 0.13, 0, Math.sin(a) * 0.13),
      new THREE.Vector3(Math.cos(a) * 0.22, 1, Math.sin(a) * 0.22).normalize(),
      0.5 + rng() * 0.24,
      0.082 + rng() * 0.028,
      tier.depth,
    )
  }
  return mergeGeometries(geoms, false)!
}

// ★ TABLE — Acropora hyacinthus: lens disc, fold ridges, scalloped
//   rim, polyp rows, under-strut crown, tapered stem
function makeTableCoral(rng: Rng, detail: number): THREE.BufferGeometry {
  const geoms: THREE.BufferGeometry[] = []
  const h = 0.55 + rng() * 0.6
  const lean = (rng() - 0.5) * 0.24

  // stem — slight S-curve
  const stem = new THREE.CylinderGeometry(0.07, 0.15, h, 10, 5)
  {
    const p = stem.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < p.count; i++) {
      const fy = p.getY(i) / h + 0.5
      p.setX(i, p.getX(i) + Math.sin(fy * Math.PI) * lean + (fy - 0.5) * lean * 0.8)
      const bump = 1 + noise2(p.getX(i) * 12, p.getZ(i) * 12 + fy * 7) * 0.08
      p.setZ(i, p.getZ(i) * bump)
    }
    stem.computeVertexNormals()
  }
  geoms.push(paint(stem, new THREE.Color('#94876a'), 0.16, rng, 0.08))

  // under-strut crown fanning out beneath the disc
  const r = 0.95 + rng() * 0.75
  const struts = detail >= 0.6 ? 6 + Math.floor(rng() * 3) : 5
  for (let i = 0; i < struts; i++) {
    const a = (i / struts) * Math.PI * 2 + rng() * 0.5
    const ex = Math.cos(a) * r * (0.45 + rng() * 0.18)
    const ez = Math.sin(a) * r * (0.45 + rng() * 0.18)
    const dirV = new THREE.Vector3(ex, h + 0.1 - (h - 0.05), ez).normalize()
    const len = Math.hypot(ex, h - 0.15, ez)
    const strut = new THREE.CylinderGeometry(0.028, 0.055, len, 7, 2)
    strut.translate(0, len / 2, 0)
    strut.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dirV))
    strut.translate(0, h - 0.05, 0)
    geoms.push(paint(strut, new THREE.Color('#8a7d62'), 0.15, rng, 0.06))
  }

  // the disc — a squashed cylinder sculpted into a table top
  const radial = detail >= 0.9 ? 128 : detail >= 0.6 ? 90 : 48
  const rings = detail >= 0.6 ? 16 : 9
  const thick = 0.2 + r * 0.045                       // v3: thicker living edge
  const disc = new THREE.CylinderGeometry(r * 1.02, r * 0.9, thick, radial, rings)
  const ph = rng() * Math.PI * 2
  const cBase = new THREE.Color(pickF(['#d9b98a', '#caa2a2', '#c9c48a', '#b8c9a2'], rng))
  const cRim = new THREE.Color('#efe3c2')
  {
    const p = disc.attributes.position as THREE.BufferAttribute
    const col = new Float32Array(p.count * 3)
    const c = new THREE.Color()
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i), y = p.getY(i), z = p.getZ(i)
      const a = Math.atan2(z, x)
      const d = Math.hypot(x, z) / r
      const topness = y > 0 ? 1 : 0.25
      // large undulation + radial fold ridges (the classic wavy table)
      y += Math.sin(a * 3 + ph) * 0.075 * d * d
        + Math.sin(a * 7 + 1.3) * 0.028 * d
        + Math.sin(a * 12 + ph * 2) * 0.014 * d
      // rim dips down at the very edge
      if (d > 0.86) y -= (d - 0.86) * 0.55 * (y > 0 ? 1 : 0.4)
      // v3: tuck the underside near the rim → thick rolled edge read
      if (d > 0.9 && y < 0) y *= 1 - (d - 0.9) * 2.1
      // polyp rows on the upper surface
      y += (Math.sin(d * 36 + a * 6) * 0.006 + noise2(x * 9, z * 9) * 0.014) * topness
      // scalloped edge — v3: gentler lobes, cubed falloff (no harsh zigzag)
      const scallop = 1 + Math.sin(a * 18 + ph) * 0.03 * d * d * d
      x *= scallop; z *= scallop
      p.setXYZ(i, x, y, z)
      // growth bands + pale rim
      c.copy(cBase).multiplyScalar(0.86 + 0.14 * Math.sin(a * 13 + d * 5))
      c.lerp(cRim, Math.max(0, d - 0.55) * 1.3)
      // v3: deep polyp valleys between the radial rows
      const valley = Math.sin(d * 36 + a * 6)
      if (valley < -0.35) c.multiplyScalar(1 + (valley + 0.35) * 0.55)
      c.multiplyScalar(1 + noise2(x * 14 + 3, z * 14) * 0.08)
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b
    }
    disc.setAttribute('color', new THREE.BufferAttribute(col, 3))
    disc.computeVertexNormals()
  }
  disc.translate(0, h + 0.04, 0)
  geoms.push(disc)

  // v3: acropora branchlets sprouting from the table top
  if (detail >= 0.6) {
    const nb = detail >= 0.9 ? 10 + Math.floor(rng() * 8) : 6
    for (let i = 0; i < nb; i++) {
      const ba = rng() * Math.PI * 2
      const bd = (0.3 + rng() * 0.52) * r
      const bx = Math.cos(ba) * bd, bz = Math.sin(ba) * bd
      const dd = Math.min(1, Math.hypot(bx, bz) / r)
      const aa = Math.atan2(bz, bx)
      const surfY = h + 0.04
        + Math.sin(aa * 3 + ph) * 0.075 * dd * dd
        + Math.sin(aa * 7 + 1.3) * 0.028 * dd
        + Math.sin(aa * 12 + ph * 2) * 0.014 * dd
      const bl = 0.1 + rng() * 0.16
      const lean = 0.2 + (bd / r) * 0.5 + rng() * 0.1
      const br1 = new THREE.CylinderGeometry(0.013, 0.02, bl, 6, 2)
      br1.translate(0, bl / 2, 0)
      br1.rotateZ(Math.cos(ba) * lean)
      br1.rotateX(Math.sin(ba) * lean)
      br1.translate(bx, surfY + 0.03, bz)
      geoms.push(paint(br1, cBase.clone().lerp(cRim, 0.5), 0.16, rng, 0.3))
      const tip = new THREE.SphereGeometry(0.017, 6, 5)
      tip.translate(
        bx + Math.sin(lean) * Math.cos(ba) * bl,
        surfY + 0.03 + Math.cos(lean) * bl,
        bz + Math.sin(lean) * Math.sin(ba) * bl,
      )
      geoms.push(paint(tip, cRim.clone().lerp(new THREE.Color('#ffffff'), 0.3), 0.12, rng, 0))
    }
  }

  return mergeGeometries(geoms, false)!
}

// ★ BRAIN — dense meandering gyri maze with dark grooves
function makeBrainCoral(rng: Rng, detail: number): THREE.BufferGeometry {
  const seg = detail >= 0.9 ? 64 : detail >= 0.6 ? 48 : 32
  const geo = new THREE.SphereGeometry(0.85, seg, Math.round(seg * 0.66))
  const p = geo.attributes.position as THREE.BufferAttribute
  const col = new Float32Array(p.count * 3)
  const cBase = new THREE.Color(pickF(['#c9a05a', '#9aa75a', '#c78a6a', '#b8a05a'], rng))
  const cValley = cBase.clone().multiplyScalar(0.58)
  const cCrest = cBase.clone().lerp(new THREE.Color('#e8d9a8'), 0.55)
  const c = new THREE.Color()
  const v = new THREE.Vector3()
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i)
    // labyrinth: two meander fields crossing → true brain maze
    const gx = Math.sin(v.x * 13 + 2.8 * Math.sin(v.z * 7 + v.y * 4))
    const gz = Math.sin(v.z * 12 + 2.4 * Math.sin(v.x * 6 - v.y * 3.5))
    const maze = gx * gz                                  // -1..1
    const ridge = Math.pow(Math.abs(maze), 0.45)          // crest mask
    const b = ridge * 0.075 + noise2(v.x * 20, v.y * 20 + v.z * 20) * 0.014
    v.multiplyScalar(1 + b)
    p.setXYZ(i, v.x, v.y * 0.66, v.z * 0.9)
    // groove darkening follows the maze sign
    c.copy(maze > 0 ? cCrest : cValley)
    c.lerp(cCrest, ridge * 0.6 * (maze > 0 ? 1 : 0.25))
    c.multiplyScalar(1 + noise2(v.x * 30 + 5, v.z * 30) * 0.07)
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
  geo.computeVertexNormals()
  return geo
}

// ★ SEA FAN — TRUE 3D gorgonian: branch tree + mesh rungs, cupped
function makeFanCoral(rng: Rng, detail: number): THREE.BufferGeometry {
  const geoms: THREE.BufferGeometry[] = []
  const base = new THREE.Color(pickF(['#a04a6e', '#8a4fb0', '#c46a5a', '#b3455e', '#7a58a8'], rng))
  const up = new THREE.Vector3(0, 1, 0)
  const maxDepth = detail >= 0.9 ? 4 : 3

  // grow in a local frame (XY plane fan, Z = normal); cup applied at the end
  const grow = (origin: THREE.Vector3, dir: THREE.Vector3, len: number, radius: number, depth: number): THREE.Vector3 => {
    const end = origin.clone().addScaledVector(dir, len)
    const cyl = new THREE.CylinderGeometry(radius * 0.6, radius, len, 5, 2)
    cyl.translate(0, len / 2, 0)
    cyl.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, dir))
    cyl.translate(origin.x, origin.y, origin.z)
    geoms.push(paint(cyl, base, 0.22, rng, 0.3))
    if (depth <= 0) {
      const tip = new THREE.SphereGeometry(radius * 1.4, 6, 5)
      tip.translate(end.x, end.y, end.z)
      geoms.push(paint(tip, base.clone().lerp(new THREE.Color('#ffd9e8'), 0.4), 0.1, rng, 0))
      return end
    }
    const spread = 0.34 + rng() * 0.26
    const children = rng() < 0.35 ? 3 : 2
    const ends: THREE.Vector3[] = []
    for (let i = 0; i < children; i++) {
      const nd = dir.clone()
      // rotate mostly IN the fan plane around Z, slight out-of-plane jitter
      const side = children === 2 ? (i === 0 ? -1 : 1) : (i - 1)
      nd.applyAxisAngle(new THREE.Vector3(0, 0, 1), side * spread * (0.7 + rng() * 0.6))
      nd.applyAxisAngle(new THREE.Vector3(1, 0, 0), (rng() - 0.5) * 0.16)
      nd.normalize()
      ends.push(grow(end, nd, len * (0.62 + rng() * 0.16), radius * 0.68, depth - 1))
    }
    // mesh rungs between sibling branches — the gorgonian net
    if (children >= 2 && depth <= maxDepth - 1) {
      const mid1 = origin.clone().lerp(ends[0], 0.45)
      const mid2 = origin.clone().lerp(ends[ends.length - 1], 0.45)
      const rungLen = mid1.distanceTo(mid2)
      if (rungLen > 0.02 && rungLen < len * 1.6) {
        const rung = new THREE.CylinderGeometry(radius * 0.22, radius * 0.22, rungLen, 4, 1)
        rung.translate(0, rungLen / 2, 0)
        const rd = mid2.clone().sub(mid1).normalize()
        rung.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, rd))
        rung.translate(mid1.x, mid1.y, mid1.z)
        geoms.push(paint(rung, base, 0.15, rng, 0.1))
      }
    }
    return end
  }

  // main stem + symmetric primary arms → classic fan silhouette
  const stemLen = 0.5 + rng() * 0.2
  grow(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0), stemLen, 0.05, maxDepth - 1)
  const armAngle = 0.5 + rng() * 0.3
  for (const side of [-1, 1]) {
    const dir = new THREE.Vector3(0, 1, 0).applyAxisAngle(new THREE.Vector3(0, 0, 1), side * armAngle)
    grow(new THREE.Vector3(0, stemLen * 0.85, 0), dir.normalize(), stemLen * 0.9, 0.042, maxDepth - 1)
  }

  const geo = mergeGeometries(geoms, false)!
  // cup the whole fan + face a random direction
  {
    const p = geo.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i)
      p.setZ(i, p.getZ(i) + x * x * 0.32 + Math.abs(y) * y * 0.02)
    }
    geo.computeVertexNormals()
  }
  geo.rotateY(rng() * Math.PI * 2)
  geo.rotateX((rng() - 0.5) * 0.3)
  geo.translate(0, 0.02, 0)
  return geo
}

// ★ TUBE — v3: fluted walls, wavy flared rims, pore noise and a REAL
// dark hollow throat in every osculum (replaces the draft smooth cones)
function makeTubeCoral(rng: Rng, detail: number): THREE.BufferGeometry {
  const geoms: THREE.BufferGeometry[] = []
  const base = new THREE.Color(pickF(['#4fb8a8', '#5a9ac9', '#68c9b0', '#7ab8a0', '#58c9c0'], rng))
  const innerC = base.clone().multiplyScalar(0.18)
  const n = 4 + Math.floor(rng() * (detail >= 0.6 ? 5 : 3))
  const rSeg = detail >= 0.9 ? 18 : detail >= 0.6 ? 14 : 9
  const hSeg = detail >= 0.6 ? 8 : 4

  for (let i = 0; i < n; i++) {
    const r = 0.09 + rng() * 0.08
    const h = 0.42 + rng() * 0.55
    const lean = new THREE.Vector3((rng() - 0.5) * 0.5, 1, (rng() - 0.5) * 0.5).normalize()
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(lean.x * h * 0.45, h * 0.55, lean.z * h * 0.45),
      new THREE.Vector3(lean.x * h * 0.9, h, lean.z * h * 0.9),
    ])
    const tube = new THREE.TubeGeometry(curve, hSeg, r, rSeg, false)
    const p = tube.attributes.position as THREE.BufferAttribute
    const uv = tube.attributes.uv as THREE.BufferAttribute
    const nn = tube.attributes.normal as THREE.BufferAttribute
    const v = new THREE.Vector3(), nv = new THREE.Vector3()

    // vertical flutes + pore bumps (uv.x = along tube, uv.y = around)
    const flutes = 8 + Math.floor(rng() * 5)
    for (let j = 0; j < p.count; j++) {
      const t = uv.getX(j)
      const a = uv.getY(j) * Math.PI * 2
      v.fromBufferAttribute(p, j)
      nv.fromBufferAttribute(nn, j)
      const ends = Math.min(1, t / 0.14) * (1 - Math.max(0, (t - 0.84) / 0.16) * 0.5)
      const k = Math.sin(a * flutes + i * 2.1) * 0.055 * r * ends
        + noise2(a * 3 + i * 4, t * 8) * 0.02 * r
      v.addScaledVector(nv, k)
      p.setXYZ(j, v.x, v.y, v.z)
    }
    tube.computeVertexNormals()

    // colour: flute light + darkening into the throat
    const col = new Float32Array(p.count * 3)
    const c = new THREE.Color()
    for (let j = 0; j < p.count; j++) {
      const t = uv.getX(j)
      const a = uv.getY(j) * Math.PI * 2
      c.copy(base).multiplyScalar(1 + Math.sin(a * flutes + i * 2.1) * 0.1 + (rng() - 0.5) * 0.16)
      const dark = Math.max(0, (t - 0.5) / 0.5)
      c.multiplyScalar(1 - dark * 0.6)
      col[j * 3] = c.r; col[j * 3 + 1] = c.g; col[j * 3 + 2] = c.b
    }
    tube.setAttribute('color', new THREE.BufferAttribute(col, 3))

    // wavy flared rim
    const rimLobes = 7 + Math.floor(rng() * 4)
    const rimPh = rng() * Math.PI * 2
    for (let j = 0; j < p.count; j++) {
      const t = uv.getX(j)
      if (t > 0.86) {
        const a = uv.getY(j) * Math.PI * 2
        const k = (t - 0.86) / 0.14
        p.setY(j, p.getY(j) + Math.sin(a * rimLobes + rimPh) * r * 0.14 * k)
      }
    }
    tube.computeVertexNormals()

    // dark hollow throat visible inside every opening
    const top = curve.getPointAt(1)
    const throat = new THREE.CylinderGeometry(r * 0.8, r * 0.16, r * 1.3, rSeg, 1, true)
    {
      const tp = throat.attributes.position as THREE.BufferAttribute
      const tc = new Float32Array(tp.count * 3)
      for (let j = 0; j < tp.count; j++) {
        tc[j * 3] = innerC.r; tc[j * 3 + 1] = innerC.g; tc[j * 3 + 2] = innerC.b
      }
      throat.setAttribute('color', new THREE.BufferAttribute(tc, 3))
    }
    throat.translate(top.x, top.y - r * 0.6, top.z)

    const a0 = rng() * Math.PI * 2
    const d0 = rng() * 0.16
    tube.translate(Math.cos(a0) * d0, 0, Math.sin(a0) * d0)
    throat.translate(Math.cos(a0) * d0, 0, Math.sin(a0) * d0)
    geoms.push(tube, throat)
  }

  // mossy base skirt
  const skirt = new THREE.SphereGeometry(0.24, detail >= 0.6 ? 12 : 8, detail >= 0.6 ? 8 : 6)
  skirt.scale(1.4, 0.32, 1.4)
  geoms.push(paint(skirt, base.clone().multiplyScalar(0.4), 0.2, rng, 0))
  return mergeGeometries(geoms.map((g) => (g.index ? g.toNonIndexed() : g)), false)!
}

// ★ SOFT — plump lobed polyp clusters, bright flared tips
function makeSoftCoral(rng: Rng, _detail: number): THREE.BufferGeometry {
  const geoms: THREE.BufferGeometry[] = []
  const base = new THREE.Color(pickF(['#d45a9a', '#9a5ad4', '#5ac9d4', '#e07a5a', '#d4c85a'], rng))
  const n = 2 + Math.floor(rng() * 3)
  for (let i = 0; i < n; i++) {
    const blob = new THREE.SphereGeometry(0.22 + rng() * 0.2, 14, 10)
    const p = blob.attributes.position as THREE.BufferAttribute
    for (let j = 0; j < p.count; j++) {
      const y = p.getY(j)
      if (y > 0.1) p.setXYZ(j, p.getX(j) * 1.25, y, p.getZ(j) * 1.25)
      // polyp bumps over the whole lobe
      const b = noise2(p.getX(j) * 22 + i * 9, p.getZ(j) * 22 + y * 18) * 0.06
      p.setXYZ(j, p.getX(j) * (1 + b), p.getY(j) * (1 + b), p.getZ(j) * (1 + b))
    }
    blob.computeVertexNormals()
    const h = 0.12 + rng() * 0.15
    blob.scale(1, 0.75, 1)
    blob.translate((rng() - 0.5) * 0.4, h + 0.14, (rng() - 0.5) * 0.4)
    geoms.push(paint(blob, base, 0.3, rng, 0.6))
  }
  return mergeGeometries(geoms, false)!
}

// ★ ANEMONE — tentacle rings with bend + glowing tip bulbs
function makeAnemone(rng: Rng, detail: number): THREE.BufferGeometry {
  const geoms: THREE.BufferGeometry[] = []
  const tent = new THREE.Color(pickF(['#e88ab0', '#b0e88a', '#e8c48a', '#c48ae8', '#88d4c8'], rng))
  // bulbous column
  const column = new THREE.CylinderGeometry(0.26, 0.34, 0.3, 14, 3)
  {
    const p = column.attributes.position as THREE.BufferAttribute
    for (let j = 0; j < p.count; j++) {
      const fy = p.getY(j) / 0.3 + 0.5
      const bulb = 1 + Math.sin(fy * Math.PI) * 0.18
      p.setX(j, p.getX(j) * bulb)
      p.setZ(j, p.getZ(j) * bulb)
    }
    column.computeVertexNormals()
  }
  column.translate(0, 0.15, 0)
  geoms.push(paint(column, new THREE.Color('#a06a5a'), 0.18, rng, 0.12))

  const rings = [
    { count: detail >= 0.6 ? 26 : 16, rad: 0.09, tilt: 0.1, hMul: 1.15 },
    { count: detail >= 0.6 ? 30 : 20, rad: 0.18, tilt: 0.32, hMul: 0.95 },
    { count: detail >= 0.6 ? 26 : 16, rad: 0.27, tilt: 0.62, hMul: 0.75 },
  ]
  const up = new THREE.Vector3(0, 1, 0)
  for (const ring of rings) {
    for (let i = 0; i < ring.count; i++) {
      const a = (i / ring.count) * Math.PI * 2 + rng() * 0.24
      const ox = Math.cos(a) * ring.rad, oz = Math.sin(a) * ring.rad
      const dir = new THREE.Vector3(Math.cos(a) * ring.tilt, 1, Math.sin(a) * ring.tilt).normalize()
      const h = (0.34 + rng() * 0.22) * ring.hMul
      const bend = new THREE.Vector3(rng() - 0.5, 0, rng() - 0.5).normalize()
      const t = new THREE.CylinderGeometry(0.011, 0.026, h, 6, 3)
      const p = t.attributes.position as THREE.BufferAttribute
      for (let j = 0; j < p.count; j++) {
        const fy = p.getY(j) / h + 0.5
        p.setX(j, p.getX(j) + bend.x * h * 0.3 * fy * fy)
        p.setZ(j, p.getZ(j) + bend.z * h * 0.3 * fy * fy)
      }
      t.computeVertexNormals()
      t.translate(0, h / 2, 0)
      t.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, dir))
      t.translate(ox, 0.26, oz)
      geoms.push(paint(t, tent, 0.22, rng, 0.3))
      const tip = new THREE.SphereGeometry(0.032, 6, 5)
      tip.translate(ox + dir.x * h + bend.x * h * 0.3, 0.26 + dir.y * h, oz + dir.z * h + bend.z * h * 0.3)
      geoms.push(paint(tip, tent.clone().lerp(new THREE.Color('#ffffff'), 0.58), 0.1, rng, 0))
    }
  }
  return mergeGeometries(geoms, false)!
}

// ★ BOULDER — encrusted massive colonies (raised detail)
function makeBoulderCoral(rng: Rng, detail: number): THREE.BufferGeometry {
  const geoms: THREE.BufferGeometry[] = []
  const base = new THREE.Color(pickF(['#8a8a5f', '#9a7f5f', '#7f8a6a'], rng))
  const n = 3 + Math.floor(rng() * 3)
  for (let i = 0; i < n; i++) {
    const blob = new THREE.IcosahedronGeometry(0.28 + rng() * 0.22, detail >= 0.6 ? 2 : 1)
    const p = blob.attributes.position as THREE.BufferAttribute
    const v = new THREE.Vector3()
    for (let j = 0; j < p.count; j++) {
      v.fromBufferAttribute(p, j)
      const n1 = noise2(v.x * 12 + v.z * 10, v.y * 12) * 0.08
        + noise2(v.x * 30, v.z * 30 + v.y * 20) * 0.03
      v.multiplyScalar(1 + n1)
      p.setXYZ(j, v.x, v.y * 0.72, v.z)
    }
    blob.computeVertexNormals()
    blob.translate((rng() - 0.5) * 0.55, (rng()) * 0.16, (rng() - 0.5) * 0.55)
    geoms.push(paint(blob, base, 0.25, rng, 0.3))
  }
  return mergeGeometries(geoms, false)!
}

// ---------------- shader sway injection ----------------
function addSway(mat: THREE.Material, swayAmp: number, wobbleFreq: number, cacheKey: string) {
  mat.onBeforeCompile = (shader) => {
    // Stage 6: caustic light dance on garden corals too — the 360°
    // garden shimmers from every heading, not just the arena wall
    injectCaustic(shader, { scale: 0.45, strength: 0.5 })
    shader.uniforms.uTime = sharedUniforms.uTime
    shader.uniforms.uFieldPos = sharedUniforms.uFieldPos
    shader.uniforms.uFieldDir = sharedUniforms.uFieldDir
    shader.uniforms.uFieldStrength = sharedUniforms.uFieldStrength
    shader.uniforms.uFieldRadius = sharedUniforms.uFieldRadius
    shader.uniforms.uSwayAmp = { value: swayAmp }
    shader.uniforms.uWobbleFreq = { value: wobbleFreq }

    shader.vertexShader = `
      uniform float uTime, uSwayAmp, uWobbleFreq, uFieldStrength, uFieldRadius;
      uniform vec3 uFieldPos, uFieldDir;
    ` + shader.vertexShader

    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
      #include <begin_vertex>
      {
        vec4 wp4 = modelMatrix * vec4(transformed, 1.0);
        float hF = clamp(uv.y, 0.0, 1.0); hF *= hF;
        float sway = sin(uTime * uWobbleFreq + wp4.x * 0.5 + wp4.z * 0.5) * uSwayAmp
                   + sin(uTime * uWobbleFreq * 1.73 + wp4.z * 1.1) * uSwayAmp * 0.4;
        float dField = distance(wp4.xyz, uFieldPos);
        float infl = smoothstep(uFieldRadius * 1.7, 0.0, dField) * uFieldStrength;
        vec2 bend = vec2(sway, 0.0);
        bend += uFieldDir.xz * infl * 0.85;
        bend.x += sin(uTime * 2.3 + wp4.z * 1.3) * infl * 0.35;
        transformed.x += bend.x * hF;
        transformed.z += bend.y * hF;
        transformed.y -= dot(bend, bend) * hF * hF * 0.5;
      }
    `)
  }
  mat.customProgramCacheKey = () => `coral-sway-v2-${cacheKey}`
}

/** caustic-only material wrapper for non-sway coral families */
function injectCausticInto(mat: THREE.Material, key: string) {
  mat.onBeforeCompile = (shader) => { injectCaustic(shader, { scale: 0.45, strength: 0.5 }) }
  mat.customProgramCacheKey = () => `coral-cau-${key}`
}

// ---------------- system ----------------
interface Family {
  kind: string
  make: (rng: Rng, detail: number) => THREE.BufferGeometry
  sway?: [number, number]      // [amp, freq]
  collide?: number             // obstacle radius multiplier
}

const FAMILIES: Record<string, Family> = {
  branch: { kind: 'branch', make: makeStaghorn, collide: 0.55 },
  brain: { kind: 'brain', make: makeBrainCoral, collide: 0.8 },
  table: { kind: 'table', make: makeTableCoral, collide: 0.7 },
  fan: { kind: 'fan', make: makeFanCoral, sway: [0.045, 0.7] },
  tube: { kind: 'tube', make: makeTubeCoral, sway: [0.02, 1.1] },
  boulder: { kind: 'boulder', make: makeBoulderCoral, collide: 0.75 },
  soft: { kind: 'soft', make: makeSoftCoral, sway: [0.06, 0.9] },
  anemone: { kind: 'anemone', make: makeAnemone, sway: [0.03, 1.6] },
}

/** natural swim-through lanes — corals keep clear of these */
const PATHS: [number, number][][] = [
  [[0, 14], [2, -10], [6, -40], [8, -62]],                                  // main lane
  [[-6, -20], [2, -28], [12, -35], [22, -40]],                              // garden loop
  [[-14, -16], [-26, -30], [-40, -46]],                                     // rocky lane
  [[16, -20], [24, -28], [34, -30]],                                        // east lane
]
function distToPaths(x: number, z: number): number {
  let best = Infinity
  for (const path of PATHS) {
    for (let i = 0; i < path.length - 1; i++) {
      const [ax, az] = path[i]
      const [bx, bz] = path[i + 1]
      const abx = bx - ax, abz = bz - az
      const t = Math.max(0, Math.min(1, ((x - ax) * abx + (z - az) * abz) / (abx * abx + abz * abz)))
      const dx = x - (ax + abx * t), dz = z - (az + abz * t)
      best = Math.min(best, Math.hypot(dx, dz))
    }
  }
  return best
}

export class CoralSystem {
  group = new THREE.Group()
  obstacles: Obstacle[] = []
  anemonePositions: THREE.Vector3[] = []
  clusterCenters: THREE.Vector3[] = []
  polyCount = 0

  constructor(
    scene: THREE.Scene,
    private heightAt: (x: number, z: number) => number,
    density = 1,
    opts: { detail?: number; attach?: GrowthSpot[] } = {},
  ) {
    this.build(density, opts.detail ?? 1, opts.attach ?? [])
    scene.add(this.group)
  }

  private build(density: number, detail: number, attach: GrowthSpot[]) {
    const rng = mulberry32(20260828)

    const clusters: { x: number; z: number; r: number; n: number; deep?: boolean; weights?: Partial<Record<string, number>> }[] = [
      // Zone B — coral garden (right side), DENSE & colourful (reference look)
      { x: 13, z: -20, r: 9, n: 16, weights: { branch: 3, fan: 2, table: 2.5, brain: 1.5, tube: 2, soft: 1.5, anemone: 1 } },
      { x: 24, z: -30, r: 8, n: 13, weights: { branch: 2.5, fan: 2, table: 2, brain: 1.5, tube: 1.5, soft: 1 } },
      { x: 8, z: -34, r: 6, n: 10, weights: { branch: 2, fan: 1.5, brain: 1, tube: 2, soft: 1 } },
      { x: 29, z: -13, r: 7, n: 11, weights: { branch: 2, table: 2.5, fan: 1.5, brain: 1, anemone: 1 } },
      { x: 18, z: -46, r: 8, n: 10, weights: { fan: 2, branch: 1.5, table: 2, brain: 1 } },
      // front-of-camera accents
      { x: 5, z: -15, r: 5, n: 8, weights: { branch: 2, soft: 1.5, tube: 1.5, anemone: 1, brain: 1 } },
      { x: -6, z: -18, r: 5, n: 7, weights: { fan: 1.5, tube: 1.5, brain: 1, soft: 1 } },
      // Zone C — rocky reef (left side)
      { x: -18, z: -24, r: 8, n: 9, weights: { boulder: 2, brain: 2, tube: 1.5, fan: 1, soft: 1 } },
      { x: -29, z: -38, r: 8, n: 11, weights: { boulder: 2, brain: 1.5, tube: 2, fan: 1.5 } },
      { x: -10, z: -44, r: 6, n: 8, weights: { tube: 2, fan: 1.5, brain: 1, soft: 1 } },
      // near-field accents
      { x: -13, z: -11, r: 5, n: 5, weights: { anemone: 1.5, brain: 1, soft: 1, tube: 1 } },
      { x: 9, z: -9, r: 4.5, n: 5, weights: { anemone: 2, soft: 1, brain: 1 } },
      // deep sparse silhouettes
      { x: -46, z: -60, r: 11, n: 6, deep: true, weights: { fan: 2, table: 2, branch: 1 } },
      { x: 44, z: -58, r: 11, n: 6, deep: true, weights: { fan: 2, table: 1.5, brain: 1 } },
      { x: 2, z: -66, r: 13, n: 7, deep: true, weights: { fan: 2, table: 2, tube: 1 } },
      // SE sand flats — sparse soft gardens between the bommies
      { x: 38, z: -18, r: 8, n: 7, weights: { soft: 2, anemone: 1.5, tube: 1.5, brain: 1 } },
      { x: 50, z: -30, r: 9, n: 6, weights: { tube: 2, soft: 1.5, fan: 1 } },
      // northern spire foothills
      { x: 12, z: -76, r: 9, n: 6, deep: true, weights: { fan: 2, tube: 1.5, table: 1 } },
      { x: -20, z: -74, r: 9, n: 6, deep: true, weights: { fan: 2, table: 2 } },
      // canyon rim colonies
      { x: -48, z: -40, r: 8, n: 7, weights: { boulder: 2, tube: 1.5, brain: 1, fan: 1 } },
      { x: -58, z: -52, r: 8, n: 6, deep: true, weights: { fan: 2, table: 1.5 } },
      // kelp forest fringe
      { x: -34, z: -56, r: 7, n: 6, weights: { boulder: 2, soft: 1.5, tube: 1 } },
      // far horizons
      { x: 56, z: -64, r: 11, n: 6, deep: true, weights: { fan: 2, table: 1.5 } },
      { x: -30, z: -84, r: 12, n: 6, deep: true, weights: { fan: 2, branch: 1 } },
    ]

    const buckets: Record<string, THREE.BufferGeometry[]> = {}
    for (const key of Object.keys(FAMILIES)) buckets[key] = []

    const tryPlace = (x: number, z: number, kind: string, scale: number, deep: boolean, yOverride?: number) => {
      const fam = FAMILIES[kind]
      const geo = fam.make(rng, detail)
      const rotY = rng() * Math.PI * 2
      const y = yOverride ?? (this.heightAt(x, z) - 0.06)

      const m = new THREE.Matrix4()
        .makeRotationY(rotY)
        .premultiply(new THREE.Matrix4().makeTranslation(x, y, z))
      geo.applyMatrix4(new THREE.Matrix4().makeScale(scale, scale, scale))
      geo.applyMatrix4(m)

      if (deep) tint(geo, new THREE.Color(0.34, 0.42, 0.5))
      buckets[kind].push(geo)
      this.polyCount += countTris(geo)

      if (fam.collide) {
        this.obstacles.push({ x, y: y + scale * 0.5, z, r: scale * fam.collide * 1.3 })
      }
      if (kind === 'anemone' && !deep) {
        this.anemonePositions.push(new THREE.Vector3(x, y + 0.4, z))
      }
    }

    // corals rooted ON the limestone structure (weighted to hero families)
    for (let i = 0; i < attach.length; i++) {
      const spot = attach[i]
      if (rng() < 0.28) continue                              // breathing room
      const roll = rng()
      const kind = roll < 0.34 ? 'branch' : roll < 0.56 ? 'table' : roll < 0.72 ? 'brain' : roll < 0.84 ? 'fan' : roll < 0.93 ? 'tube' : 'soft'
      const scale = rand(0.9, 1.7, rng)
      tryPlace(spot.pos.x, spot.pos.z, kind, scale, false, spot.pos.y - 0.06)
    }

    for (const cl of clusters) {
      // the 360° high-detail ReefArena owns everything within its
      // colosseum + haze margins — draft corals would clutter the
      // clearing and the reef wall, so the legacy system stays out
      // beyond 64 m from the arena centre (0, -20)
      if (Math.hypot(cl.x - 0, cl.z + 20) < 64) continue
      this.clusterCenters.push(new THREE.Vector3(cl.x, this.heightAt(cl.x, cl.z), cl.z))
      const n = Math.max(1, Math.round(cl.n * density))
      for (let i = 0; i < n; i++) {
        const a = rng() * Math.PI * 2
        const d = Math.sqrt(rng()) * cl.r
        const x = cl.x + Math.cos(a) * d
        const z = cl.z + Math.sin(a) * d * 0.85

        // keep the natural pathways open (reference: fish swim lanes)
        if (distToPaths(x, z) < 2.6) continue

        // weighted family pick
        const weights = cl.weights ?? { branch: 1, brain: 1, table: 1, fan: 1, tube: 1, boulder: 1, soft: 1, anemone: 0.4 }
        const entries = Object.entries(weights).map(([k, w]) => [k, w ?? 0] as [string, number])
        const total = entries.reduce((s, [, w]) => s + w, 0)
        let roll = rng() * total
        let kind = entries[0][0]
        for (const [k, w] of entries) { roll -= w; if (roll <= 0) { kind = k; break } }

        const scale = cl.deep ? rand(1.9, 3.0, rng) : rand(1.05, 2.2, rng)
        tryPlace(x, z, kind, scale, !!cl.deep)
      }
    }

    // guarantee at least three anemones near the garden front
    while (this.anemonePositions.length < 3) {
      const spots = [[10, -14], [17, -24], [-11, -13]]
      const [x, z] = spots[this.anemonePositions.length % spots.length]
      const geo = FAMILIES.anemone.make(rng, detail)
      const s = rand(0.9, 1.3, rng)
      geo.applyMatrix4(new THREE.Matrix4().makeScale(s, s, s))
      geo.applyMatrix4(new THREE.Matrix4().makeTranslation(x, this.heightAt(x, z) - 0.06, z))
      buckets.anemone.push(geo)
      this.polyCount += countTris(geo)
      this.anemonePositions.push(new THREE.Vector3(x, this.heightAt(x, z) + 0.4, z))
    }

    // merge per family into one mesh each
    for (const key of Object.keys(buckets)) {
      const list = buckets[key]
      if (!list.length) continue
      const fam = FAMILIES[key]
      const merged = weldSmooth(mergeGeometries(list, false)!)
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.0 })
      if (fam.sway) addSway(mat, fam.sway[0], fam.sway[1], key)
      else injectCausticInto(mat, key)
      const mesh = new THREE.Mesh(merged, mat)
      mesh.castShadow = false
      this.group.add(mesh)
    }
  }
}

function countTris(geo: THREE.BufferGeometry): number {
  return geo.index ? geo.index.count / 3 : (geo.attributes.position?.count ?? 0) / 3
}

// local rand with injected rng
function rand(a: number, b: number, rng: Rng) { return a + rng() * (b - a) }
function pickF<T,>(arr: T[], rng: Rng): T { return arr[Math.floor(rng() * arr.length)] }
