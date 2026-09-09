// ---------------------------------------------------------------
// CoralSystem — 10 procedural coral families (branch/staghorn,
// brain, table, fan, tube, boulder, soft, anemone, barrel sponge,
// tube-sponge cluster) rebuilt to proper high-poly quality:
//  • staghorn: 4-level dichotomous growth, tapered ringed segments,
//    pointed axial tips
//  • brain: 3 k-vertex labyrinth, domain-warped ridges, dark valleys
//  • table: 56-segment disc with radial ridges, rim waves, root legs
//  • fan: dense venation alpha map, wavy cupped membrane, woody stem
//  • tube: double-walled polyp tubes with rims and crowns
//  • sponges: ribbed lathe barrels with real inner cavities
// Shader-driven current sway kept for soft families; wet-look
// clearcoat on solids. Registers obstacle colliders and anemone
// homes for clownfish; exports sponge mouths for bubble emitters.
// ---------------------------------------------------------------
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { sharedUniforms } from '../core/sharedUniforms'
import { mulberry32 } from '../utils/math'
import { insideReefFootprint } from './ReefSites'
import type { Obstacle } from './Rocks'

type Rng = () => number

// ---------------- vertex painting helpers ----------------
function paint(geo: THREE.BufferGeometry, base: THREE.Color, vary: number, rng: Rng, topLighten = 0.35) {
  geo.computeBoundingBox()
  const bb = geo.boundingBox!
  const h = Math.max(0.001, bb.max.y - bb.min.y)
  const count = geo.attributes.position.count
  const colors = new Float32Array(count * 3)
  const c = new THREE.Color()
  const white = new THREE.Color('#fff6da')
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

// ---------------- shared fan venation texture ----------------
let fanTexture: THREE.Texture | null = null
function getFanTexture(): THREE.Texture {
  if (fanTexture) return fanTexture
  const c = document.createElement('canvas')
  c.width = c.height = 256
  const g = c.getContext('2d')!
  g.fillStyle = '#000'
  g.fillRect(0, 0, 256, 256)
  g.strokeStyle = '#fff'
  g.lineCap = 'round'

  const cx = 128, cy = 246
  // dense primary rays across a wide fan
  const branch = (x: number, y: number, angle: number, len: number, w: number, depth: number) => {
    const x2 = x + Math.sin(angle) * len
    const y2 = y - Math.cos(angle) * len
    g.lineWidth = w
    g.beginPath(); g.moveTo(x, y); g.lineTo(x2, y2); g.stroke()
    if (depth <= 0) return
    const n = 2
    for (let i = 0; i < n; i++) {
      branch(x2, y2, angle + (i === 0 ? -1 : 1) * (0.14 + Math.random() * 0.26), len * (0.58 + Math.random() * 0.2), Math.max(1.4, w * 0.64), depth - 1)
    }
    if (Math.random() < 0.45) branch(x2, y2, angle + (Math.random() - 0.5) * 0.18, len * 0.52, Math.max(1.2, w * 0.5), depth - 1)
  }
  for (let i = -4; i <= 4; i++) branch(cx, cy, i * 0.165, 58 + Math.random() * 12, 4.6, 5)

  // cross-veins: soft arcs linking neighbouring rays (gorgonian lattice)
  g.strokeStyle = 'rgba(255,255,255,0.34)'
  for (let ring = 0; ring < 7; ring++) {
    const r = 52 + ring * 27 + Math.random() * 8
    g.lineWidth = 1.4
    g.beginPath()
    for (let a = -1.05; a <= 1.05; a += 0.035) {
      const wob = 1 + Math.sin(a * 9 + ring * 2.4) * 0.035
      const px = cx + Math.sin(a) * r * wob
      const py = cy - Math.cos(a) * r * wob
      if (a <= -1.049) g.moveTo(px, py); else g.lineTo(px, py)
    }
    g.stroke()
  }

  // solid white corner (u,v < 0.05) so stems pass the alphaTest untouched
  g.fillStyle = '#fff'
  g.fillRect(0, 0, 14, 14)

  fanTexture = new THREE.CanvasTexture(c)
  return fanTexture
}

/** white UV corner reserved for solid parts (fan stems) that must ignore the venation alpha */
const FAN_STEM_UV = 0.02

// ---------------- coral family generators ----------------
function makeBranchCoral(rng: Rng): THREE.BufferGeometry {
  const geoms: THREE.BufferGeometry[] = []
  const palette = ['#ff5f9e', '#d24fd4', '#ff8a3d', '#ffd24f', '#ff5f5f', '#ff7bb0']
  const base = new THREE.Color(pickF(palette, rng))
  const up = new THREE.Vector3(0, 1, 0)

  const grow = (origin: THREE.Vector3, dir: THREE.Vector3, len: number, radius: number, depth: number) => {
    const end = origin.clone().addScaledVector(dir, len)
    // tapered, ringed segment — 9 radial × 4 height for smooth bends
    const cyl = new THREE.CylinderGeometry(radius * 0.62, radius, len, 9, 4)
    {
      const p = cyl.attributes.position as THREE.BufferAttribute
      const bend = new THREE.Vector3(rng() - 0.5, 0, rng() - 0.5).multiplyScalar(len * 0.22)
      const rings = 2 + Math.floor(rng() * 3)
      const rf = 0.03 + rng() * 0.03
      for (let i = 0; i < p.count; i++) {
        const fy = (p.getY(i) / len + 0.5)
        const k = fy * fy * 0.8 + fy * 0.2
        // growth rings: subtle radius ripple along the segment
        const ringK = 1 + Math.sin(fy * Math.PI * rings) * rf
        const px = p.getX(i), pz = p.getZ(i)
        const pr = Math.hypot(px, pz) || 0.0001
        p.setXYZ(i, px / pr * pr * ringK + bend.x * k, p.getY(i), pz / pr * pr * ringK + bend.z * k)
      }
    }
    cyl.translate(0, len / 2, 0)
    cyl.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, dir))
    cyl.translate(origin.x, origin.y, origin.z)
    geoms.push(paint(cyl, base, 0.25, rng, 0.1))
    if (depth <= 0) {
      // pointed axial tip (staghorn corallite)
      const tip = new THREE.ConeGeometry(radius * 0.62, radius * 2.6, 9, 2)
      tip.translate(0, radius * 1.3, 0)
      tip.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, dir))
      tip.translate(end.x, end.y, end.z)
      geoms.push(paint(tip, base.clone().lerp(new THREE.Color('#fff2b0'), 0.55), 0.15, rng, 0))
      return
    }
    const children = 2 + (rng() < 0.42 ? 1 : 0)
    for (let i = 0; i < children; i++) {
      const nd = dir.clone()
      const axis = new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize()
      nd.applyAxisAngle(axis, 0.3 + rng() * 0.48)
      nd.y = Math.abs(nd.y) * 0.65 + 0.3
      nd.normalize()
      grow(end, nd, len * (0.62 + rng() * 0.18), radius * 0.7, depth - 1)
    }
  }
  grow(new THREE.Vector3(0, 0, 0), new THREE.Vector3(rng() * 0.3 - 0.15, 1, rng() * 0.3 - 0.15).normalize(), 0.55 + rng() * 0.3, 0.1, 4)
  return mergeGeometries(geoms, false)!
}

function makeBrainCoral(rng: Rng): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(0.85, 48, 32)
  const p = geo.attributes.position as THREE.BufferAttribute
  const v = new THREE.Vector3()
  const ridge = new Float32Array(p.count)
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i)
    const nx = v.x / 0.85, ny = v.y / 0.85, nz = v.z / 0.85
    // domain-warped meander lattice → convoluted labyrinth
    const wx = nx * 5.2 + Math.sin(nz * 3.4) * 1.35
    const wz = nz * 4.6 + Math.cos(nx * 3.1) * 1.4
    const maze = Math.sin(wx * 2.4) * Math.sin(wz * 2.4)
    const maze2 = Math.sin(wx * 5.1 + nz * 1.7) * 0.5
    const micro = Math.sin(nx * 21) * Math.sin(nz * 19 + ny * 9) * 0.14
    const b = maze * 0.09 + maze2 * 0.045 + micro * 0.02
    ridge[i] = maze + maze2 * 0.5
    v.multiplyScalar(1 + b)
    p.setXYZ(i, v.x, v.y * 0.68, v.z * 0.88)
  }
  geo.computeVertexNormals()
  const base = new THREE.Color(pickF(['#c98f3d', '#96aa45', '#c7744a', '#ab8f42'], rng))
  paint(geo, base, 0.2, rng, 0.25)
  // valleys dark, crests pale — reads as living polyp rows
  const col = geo.attributes.color as THREE.BufferAttribute
  for (let i = 0; i < col.count; i++) {
    const k = THREE.MathUtils.clamp(ridge[i] * 0.5 + 0.5, 0, 1)
    const m = 0.72 + k * 0.42
    col.setXYZ(i, col.getX(i) * m, col.getY(i) * m * 0.99, col.getZ(i) * m * 0.94)
  }
  return geo
}

function makeTableCoral(rng: Rng): THREE.BufferGeometry {
  const geoms: THREE.BufferGeometry[] = []
  const h = 0.5 + rng() * 0.5
  const stem = new THREE.CylinderGeometry(0.075, 0.13, h, 10, 3)
  stem.translate(0, h / 2, 0)
  geoms.push(paint(stem, new THREE.Color('#b8a888'), 0.15, rng, 0.1))
  // root legs splaying into the substrate
  const legs = 3 + Math.floor(rng() * 2)
  for (let i = 0; i < legs; i++) {
    const a = (i / legs) * Math.PI * 2 + rng() * 0.6
    const leg = new THREE.CylinderGeometry(0.028, 0.052, 0.3, 7, 1)
    leg.translate(0, 0.15, 0)
    leg.rotateZ(0.55 + rng() * 0.25)
    leg.rotateY(a)
    leg.translate(Math.cos(a) * 0.08, 0.02, Math.sin(a) * 0.08)
    geoms.push(paint(leg, new THREE.Color('#a89878'), 0.18, rng, 0.05))
  }
  // substructure skirt under the disc
  const skirt = new THREE.ConeGeometry(0.36, 0.26, 12, 1, true)
  skirt.rotateX(Math.PI)
  skirt.translate(0, h - 0.1, 0)
  geoms.push(paint(skirt, new THREE.Color('#a89878'), 0.18, rng, 0.1))

  const r = 0.8 + rng() * 0.7
  const RINGS = 56
  const disc = new THREE.CylinderGeometry(r, r * 0.9, 0.12, RINGS, 2)
  // wavy rim + radial ridges on top + gentle dome
  const p = disc.attributes.position as THREE.BufferAttribute
  const ridge = new Float32Array(p.count)
  const ph1 = rng() * Math.PI * 2
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i)
    const a = Math.atan2(z, x)
    const d = Math.hypot(x, z) / r
    const rid = Math.sin(a * 16 + ph1) * 0.045 * d + Math.sin(a * 31 + 1.7) * 0.014 * d
    ridge[i] = rid
    p.setY(i, p.getY(i) + rid + Math.sin(a * 5 + ph1 * 2) * 0.05 * d * d + (1 - d * d) * 0.05)
  }
  disc.computeVertexNormals()
  disc.translate(0, h, 0)
  const base = new THREE.Color(pickF(['#d6974e', '#c97d7d', '#b5ad5c', '#c9a06e'], rng))
  geoms.push(paint(disc, base, 0.18, rng, 0.18))
  // groove shading between radial ridges
  const col = disc.attributes.color as THREE.BufferAttribute
  for (let i = 0; i < col.count; i++) {
    const k = THREE.MathUtils.clamp(ridge[i] / 0.059 + 0.5, 0, 1)
    const m = 0.78 + k * 0.34
    col.setXYZ(i, col.getX(i) * m, col.getY(i) * m, col.getZ(i) * m)
  }
  return mergeGeometries(geoms, false)!
}

function makeFanCoral(rng: Rng): THREE.BufferGeometry {
  const geoms: THREE.BufferGeometry[] = []
  // woody stem + holdfast — UVs pinned to the solid white corner of the
  // venation alpha map so the stem is never eaten by the alphaTest
  const stem = new THREE.CylinderGeometry(0.03, 0.055, 0.34, 8, 2)
  stem.translate(0, 0.17, 0)
  {
    const uv = stem.attributes.uv as THREE.BufferAttribute
    for (let i = 0; i < uv.count; i++) uv.setXY(i, FAN_STEM_UV, FAN_STEM_UV)
  }
  geoms.push(paint(stem, new THREE.Color('#6a4a3a'), 0.2, rng, 0.05))
  // membrane: wavy, cupped, wider at top — silhouette from the venation alpha map
  const geo = new THREE.PlaneGeometry(1.6, 1.95, 20, 26)
  geo.translate(0, 0.85 + 0.34, 0)
  const p = geo.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i)
    const t = y / 2.3
    const taper = 0.25 + Math.sin(Math.min(1, t) * Math.PI * 0.82) * 0.9
    p.setX(i, x * taper + Math.sin(y * 5.2 + x * 2.1) * 0.05)
    p.setZ(i, Math.pow(t, 2) * 0.3 - Math.abs(x) * 0.12 + Math.sin(x * 4.5 + y * 3.1) * 0.035)
  }
  geo.computeVertexNormals()
  const base = new THREE.Color(pickF(['#c94f6e', '#9a4fc9', '#7b6ae0', '#d46a9a'], rng))
  paint(geo, base, 0.2, rng, 0.45)
  geoms.push(geo)
  return mergeGeometries(geoms, false)!
}

function makeTubeCoral(rng: Rng): THREE.BufferGeometry {
  const geoms: THREE.BufferGeometry[] = []
  const base = new THREE.Color(pickF(['#3ec9b8', '#4f9ae8', '#5fe0c0'], rng))
  const n = 6 + Math.floor(rng() * 4)
  for (let i = 0; i < n; i++) {
    const r = 0.09 + rng() * 0.07
    const h = 0.4 + rng() * 0.5
    const a = rng() * Math.PI * 2
    const d = rng() * 0.18
    const ox = Math.cos(a) * d, oz = Math.sin(a) * d
    // outer wall
    const tube = new THREE.CylinderGeometry(r * 0.8, r, h, 10, 3, true)
    tube.translate(ox, h / 2, oz)
    tube.rotateY(rng() * Math.PI)
    paint(tube, base, 0.3, rng, 0.0)
    // darkened rim toward the opening — hollow polyp tube
    {
      const p = tube.attributes.position as THREE.BufferAttribute
      const col = tube.attributes.color as THREE.BufferAttribute
      for (let j = 0; j < p.count; j++) {
        const fy = p.getY(j) / h + 0.5
        if (fy > 0.55) {
          const k = (fy - 0.55) / 0.45
          col.setXYZ(j, col.getX(j) * (1 - k * 0.62), col.getY(j) * (1 - k * 0.58), col.getZ(j) * (1 - k * 0.5))
        }
      }
    }
    geoms.push(tube)
    // inner wall (visible through the mouth, DoubleSide material)
    const inner = new THREE.CylinderGeometry(r * 0.58, r * 0.72, h * 0.6, 9, 2, true)
    inner.translate(ox, h * 0.3, oz)
    paint(inner, base.clone().multiplyScalar(0.5), 0.2, rng, 0)
    geoms.push(inner)
    // rim ring at the mouth
    const rim = new THREE.TorusGeometry(r * 0.82, r * 0.14, 7, 12)
    rim.rotateX(Math.PI / 2)
    rim.translate(ox, h, oz)
    geoms.push(paint(rim, base.clone().lerp(new THREE.Color('#fff6da'), 0.25), 0.2, rng, 0))
    // retractable polyp crown
    const polyps = 5 + Math.floor(rng() * 3)
    for (let k = 0; k < polyps; k++) {
      const pa = rng() * Math.PI * 2
      const pr = r * (0.2 + rng() * 0.4)
      const pol = new THREE.ConeGeometry(r * 0.16, r * 0.85, 6, 1)
      pol.translate(ox + Math.cos(pa) * pr, h + r * 0.32, oz + Math.sin(pa) * pr)
      geoms.push(paint(pol, base.clone().lerp(new THREE.Color('#fff6da'), 0.45), 0.2, rng, 0))
    }
  }
  return mergeGeometries(geoms, false)!
}

function makeBoulderCoral(rng: Rng): THREE.BufferGeometry {
  const geoms: THREE.BufferGeometry[] = []
  const base = new THREE.Color(pickF(['#9a9a6f', '#a88f6f', '#8f9a78'], rng))
  const n = 3 + Math.floor(rng() * 3)
  for (let i = 0; i < n; i++) {
    const blob = new THREE.IcosahedronGeometry(0.28 + rng() * 0.22, 2)
    const p = blob.attributes.position as THREE.BufferAttribute
    const v = new THREE.Vector3()
    for (let j = 0; j < p.count; j++) {
      v.fromBufferAttribute(p, j)
      // lobed mass + knobby polyp relief
      const bump = Math.sin(v.x * 12 + v.z * 10) * 0.08
        + Math.sin(v.x * 26 + v.y * 21 + v.z * 18) * 0.035
      v.multiplyScalar(1 + bump)
      p.setXYZ(j, v.x, v.y * 0.72, v.z)
    }
    blob.computeVertexNormals()
    blob.translate((rng() - 0.5) * 0.55, (rng()) * 0.16, (rng() - 0.5) * 0.55)
    geoms.push(paint(blob, base, 0.25, rng, 0.3))
  }
  return mergeGeometries(geoms, false)!
}

function makeSoftCoral(rng: Rng): THREE.BufferGeometry {
  const geoms: THREE.BufferGeometry[] = []
  const base = new THREE.Color(pickF(['#e86aae', '#a86ae0', '#6ae0e8', '#f08a6a'], rng))
  const n = 2 + Math.floor(rng() * 3)
  for (let i = 0; i < n; i++) {
    const stalk = new THREE.CylinderGeometry(0.05, 0.08, 0.16, 8, 1)
    stalk.translate((rng() - 0.5) * 0.4, 0.08, (rng() - 0.5) * 0.4)
    geoms.push(paint(stalk, base.clone().multiplyScalar(0.6), 0.2, rng, 0))
    const blob = new THREE.SphereGeometry(0.22 + rng() * 0.2, 16, 12)
    const p = blob.attributes.position as THREE.BufferAttribute
    const v = new THREE.Vector3()
    for (let j = 0; j < p.count; j++) {
      v.fromBufferAttribute(p, j)
      // plump lobes + polyp dimples
      const k = Math.sin(v.x * 18) * Math.sin(v.z * 16) * 0.06
        + Math.sin(v.y * 22 + v.x * 12) * 0.03
      v.multiplyScalar(1 + k)
      if (v.y > 0.1) p.setXYZ(j, v.x * 1.25, v.y, v.z * 1.25)  // flared top
      else p.setXYZ(j, v.x, v.y, v.z)
    }
    blob.computeVertexNormals()
    const h = 0.12 + rng() * 0.15
    blob.scale(1, 0.75, 1)
    blob.translate((rng() - 0.5) * 0.4, h + 0.14, (rng() - 0.5) * 0.4)
    geoms.push(paint(blob, base, 0.3, rng, 0.55))
  }
  return mergeGeometries(geoms, false)!
}

function makeAnemone(rng: Rng): THREE.BufferGeometry {
  const geoms: THREE.BufferGeometry[] = []
  const tent = new THREE.Color(pickF(['#f29ab8', '#c0f29a', '#f2d49a', '#d49af2'], rng))
  const disc = new THREE.CylinderGeometry(0.3, 0.36, 0.14, 14, 2)
  disc.translate(0, 0.07, 0)
  geoms.push(paint(disc, new THREE.Color('#a06a5a'), 0.15, rng, 0.1))
  const column = new THREE.CylinderGeometry(0.24, 0.3, 0.16, 12, 2)
  column.translate(0, 0.06, 0)
  geoms.push(paint(column, new THREE.Color('#8a5a4c'), 0.15, rng, 0.05))
  const n = 46 + Math.floor(rng() * 14)
  const up = new THREE.Vector3(0, 1, 0)
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng() * 0.24
    const tilt = 0.2 + rng() * 0.34
    const dir = new THREE.Vector3(Math.cos(a) * tilt, 1, Math.sin(a) * tilt).normalize()
    const h = 0.42 + rng() * 0.3
    const ox = Math.cos(a) * 0.16, oz = Math.sin(a) * 0.16
    // two-segment curved tentacle with a bulb tip
    const q = new THREE.Quaternion().setFromUnitVectors(up, dir)
    const seg1 = new THREE.CylinderGeometry(0.024, 0.032, h * 0.55, 6, 1)
    seg1.translate(0, h * 0.275, 0)
    seg1.applyQuaternion(q)
    seg1.translate(ox, 0.12, oz)
    geoms.push(paint(seg1, tent, 0.25, rng, 0.5))
    const bendDir = dir.clone().applyAxisAngle(new THREE.Vector3(Math.sin(a), 0, -Math.cos(a)).normalize(), 0.34)
    const mid = new THREE.Vector3(ox + dir.x * h * 0.55, 0.12 + dir.y * h * 0.55, oz + dir.z * h * 0.55)
    const q2 = new THREE.Quaternion().setFromUnitVectors(up, bendDir)
    const seg2 = new THREE.CylinderGeometry(0.017, 0.024, h * 0.5, 6, 1)
    seg2.translate(0, h * 0.25, 0)
    seg2.applyQuaternion(q2)
    seg2.translate(mid.x, mid.y, mid.z)
    geoms.push(paint(seg2, tent, 0.25, rng, 0.5))
    const tip = new THREE.SphereGeometry(0.045, 7, 5)
    tip.translate(mid.x + bendDir.x * h * 0.5, mid.y + bendDir.y * h * 0.5, mid.z + bendDir.z * h * 0.5)
    geoms.push(paint(tip, tent.clone().lerp(new THREE.Color('#fff6da'), 0.6), 0.1, rng, 0))
  }
  return mergeGeometries(geoms, false)!
}

// ---------------- sponges (new) ----------------
/** ribbed barrel sponge with a real inner cavity (closed lathe profile) */
function makeBarrelSponge(rng: Rng, mouths?: THREE.Vector3[]): THREE.BufferGeometry {
  const H = 0.85 + rng() * 0.45
  const R = 0.34 + rng() * 0.14
  const profile: THREE.Vector2[] = [
    new THREE.Vector2(0.001, 0),
    new THREE.Vector2(R * 0.62, 0),
    new THREE.Vector2(R * 0.94, H * 0.16),
    new THREE.Vector2(R * 1.04, H * 0.5),
    new THREE.Vector2(R * 0.98, H * 0.82),
    new THREE.Vector2(R * 1.1, H * 0.96),      // flared rim outer
    new THREE.Vector2(R * 1.02, H * 1.0),
    new THREE.Vector2(R * 0.86, H * 0.94),     // rim rolls inward
    new THREE.Vector2(R * 0.62, H * 0.66),     // inner wall
    new THREE.Vector2(R * 0.3, H * 0.52),
    new THREE.Vector2(0.001, H * 0.5),         // cavity floor → sealed
  ]
  const geo = new THREE.LatheGeometry(profile, 48)
  // growth ribs around the barrel
  const p = geo.attributes.position as THREE.BufferAttribute
  const v = new THREE.Vector3()
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i)
    const phi = Math.atan2(v.z, v.x)
    const rr = Math.hypot(v.x, v.z)
    if (rr > 0.02) {
      const rib = 1 + Math.sin(phi * 9) * 0.045 + Math.sin(phi * 27) * 0.014
      p.setXYZ(i, Math.cos(phi) * rr * rib, v.y, Math.sin(phi) * rr * rib)
    }
  }
  geo.computeVertexNormals()
  const base = new THREE.Color(pickF(['#9a3fd4', '#d43f6e', '#e87a3f', '#d4b83f', '#7a4fd4'], rng))
  paint(geo, base, 0.22, rng, 0.3)
  // interior + rim shading: rim pale, cavity dark
  const col = geo.attributes.color as THREE.BufferAttribute
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i)
    const rr = Math.hypot(p.getX(i), p.getZ(i))
    if (y > H * 0.86 && rr > R * 0.55) col.setXYZ(i, col.getX(i) * 1.3, col.getY(i) * 1.22, col.getZ(i) * 1.18)
    if (y < H * 0.6 && rr < R * 0.7) col.setXYZ(i, col.getX(i) * 0.38, col.getY(i) * 0.34, col.getZ(i) * 0.42)
  }
  if (mouths) mouths.push(new THREE.Vector3(0, H * 0.62, 0))
  return geo
}

/** cluster of purple tube sponges with flared mouths */
function makeTubeSpongeCluster(rng: Rng, mouths?: THREE.Vector3[]): THREE.BufferGeometry {
  const geoms: THREE.BufferGeometry[] = []
  const base = new THREE.Color(pickF(['#7a4fd4', '#9a3fd4', '#3f9ad4'], rng))
  const n = 3 + Math.floor(rng() * 3)
  for (let i = 0; i < n; i++) {
    const r = 0.07 + rng() * 0.06
    const h = 0.35 + rng() * 0.5
    const a = rng() * Math.PI * 2
    const d = rng() * 0.16
    const ox = Math.cos(a) * d, oz = Math.sin(a) * d
    const lean = (rng() - 0.5) * 0.3
    const profile: THREE.Vector2[] = [
      new THREE.Vector2(0.001, 0),
      new THREE.Vector2(r, 0),
      new THREE.Vector2(r * 0.92, h * 0.72),
      new THREE.Vector2(r * 1.22, h * 0.98),     // flare
      new THREE.Vector2(r * 1.18, h * 1.0),
      new THREE.Vector2(r * 0.8, h * 0.94),      // inner
      new THREE.Vector2(r * 0.5, h * 0.8),
      new THREE.Vector2(0.001, h * 0.78),
    ]
    const tube = new THREE.LatheGeometry(profile, 22)
    tube.rotateZ(lean)
    tube.translate(ox, 0, oz)
    paint(tube, base, 0.28, rng, 0.35)
    // mouth shading
    const col = tube.attributes.color as THREE.BufferAttribute
    const p = tube.attributes.position as THREE.BufferAttribute
    for (let j = 0; j < p.count; j++) {
      if (p.getY(j) < h * 0.7 && Math.hypot(p.getX(j) - ox, p.getZ(j) - oz) < r * 0.62) {
        col.setXYZ(j, col.getX(j) * 0.4, col.getY(j) * 0.36, col.getZ(j) * 0.45)
      }
    }
    geoms.push(tube)
    if (mouths) mouths.push(new THREE.Vector3(ox - Math.sin(lean) * h * 0.8, h * 0.85, oz))
  }
  return mergeGeometries(geoms, false)!
}

// ---------------- shader sway injection ----------------
function addSway(mat: THREE.Material, swayAmp: number, wobbleFreq: number, cacheKey: string) {
  mat.onBeforeCompile = (shader) => {
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
  mat.customProgramCacheKey = () => cacheKey
}

// ---------------- system ----------------
interface Family {
  kind: string
  make: (rng: Rng, mouths?: THREE.Vector3[]) => THREE.BufferGeometry
  sway?: [number, number]      // [amp, freq]
  collide?: number             // obstacle radius multiplier
  alphaMap?: boolean
  doubleSide?: boolean
}

const FAMILIES: Record<string, Family> = {
  branch: { kind: 'branch', make: makeBranchCoral, collide: 0.55 },
  brain: { kind: 'brain', make: makeBrainCoral, collide: 0.8 },
  table: { kind: 'table', make: makeTableCoral, collide: 0.7 },
  fan: { kind: 'fan', make: makeFanCoral, sway: [0.045, 0.7], alphaMap: true, doubleSide: true },
  tube: { kind: 'tube', make: makeTubeCoral, sway: [0.02, 1.1], doubleSide: true },
  boulder: { kind: 'boulder', make: makeBoulderCoral, collide: 0.75 },
  soft: { kind: 'soft', make: makeSoftCoral, sway: [0.06, 0.9] },
  anemone: { kind: 'anemone', make: makeAnemone, sway: [0.03, 1.6], doubleSide: false },
  sponge: { kind: 'sponge', make: makeBarrelSponge, collide: 0.55 },
  tubeSponge: { kind: 'tubeSponge', make: makeTubeSpongeCluster, collide: 0.4 },
}

/** generators exported for the reef core builder (corals growing on limestone) */
export const CoralMakers = {
  branch: makeBranchCoral,
  brain: makeBrainCoral,
  table: makeTableCoral,
  tube: makeTubeCoral,
  boulder: makeBoulderCoral,
  soft: makeSoftCoral,
  anemone: makeAnemone,
  sponge: makeBarrelSponge,
  tubeSponge: makeTubeSpongeCluster,
}

export class CoralSystem {
  group = new THREE.Group()
  obstacles: Obstacle[] = []
  anemonePositions: THREE.Vector3[] = []
  clusterCenters: THREE.Vector3[] = []
  /** world-space sponge mouth positions — ambient bubble emitters */
  spongeMouths: THREE.Vector3[] = []

  constructor(scene: THREE.Scene, private heightAt: (x: number, z: number) => number, density = 1) {
    this.build(density)
    scene.add(this.group)
  }

  private build(density: number) {
    const rng = mulberry32(20260828)

    const clusters: { x: number; z: number; r: number; n: number; deep?: boolean; weights?: Partial<Record<string, number>> }[] = [
      // Zone B — coral garden (right side), dense & colourful
      { x: 13, z: -20, r: 9, n: 10, weights: { branch: 3, fan: 2, table: 2, brain: 1.5, tube: 2, soft: 1.5, anemone: 1, sponge: 1 } },
      { x: 24, z: -30, r: 8, n: 8, weights: { branch: 2.5, fan: 2, table: 1.5, brain: 1.5, tube: 1.5, soft: 1, tubeSponge: 1 } },
      { x: 8, z: -34, r: 6, n: 6, weights: { branch: 2, fan: 1.5, brain: 1, tube: 2, soft: 1, sponge: 0.8 } },
      { x: 29, z: -13, r: 7, n: 7, weights: { branch: 2, table: 2, fan: 1.5, brain: 1, anemone: 1, sponge: 0.8 } },
      { x: 18, z: -46, r: 8, n: 6, weights: { fan: 2, branch: 1.5, table: 1.5, brain: 1, tubeSponge: 0.8 } },
      // front-of-camera accents
      { x: 5, z: -15, r: 5, n: 5, weights: { branch: 2, soft: 1.5, tube: 1.5, anemone: 1, brain: 1 } },
      { x: -6, z: -18, r: 5, n: 4, weights: { fan: 1.5, tube: 1.5, brain: 1, soft: 1 } },
      // Zone C — rocky reef (left side)
      { x: -18, z: -24, r: 8, n: 6, weights: { boulder: 2, brain: 2, tube: 1.5, fan: 1, soft: 1 } },
      { x: -29, z: -38, r: 8, n: 7, weights: { boulder: 2, brain: 1.5, tube: 2, fan: 1.5, sponge: 1 } },
      { x: -10, z: -44, r: 6, n: 5, weights: { tube: 2, fan: 1.5, brain: 1, soft: 1 } },
      // near-field accents
      { x: -13, z: -11, r: 5, n: 3, weights: { anemone: 1.5, brain: 1, soft: 1, tube: 1 } },
      { x: 9, z: -9, r: 4.5, n: 3, weights: { anemone: 2, soft: 1, brain: 1 } },
      // deep sparse silhouettes
      { x: -46, z: -60, r: 11, n: 4, deep: true, weights: { fan: 2, table: 2, branch: 1 } },
      { x: 44, z: -58, r: 11, n: 4, deep: true, weights: { fan: 2, table: 1.5, brain: 1 } },
      { x: 2, z: -66, r: 13, n: 5, deep: true, weights: { fan: 2, table: 2, tube: 1 } },
      // SE sand flats — sparse soft gardens between the bommies
      { x: 38, z: -18, r: 8, n: 5, weights: { soft: 2, anemone: 1.5, tube: 1.5, brain: 1, tubeSponge: 0.8 } },
      { x: 50, z: -30, r: 9, n: 4, weights: { tube: 2, soft: 1.5, fan: 1, sponge: 0.8 } },
      // northern spire foothills
      { x: 12, z: -76, r: 9, n: 4, deep: true, weights: { fan: 2, tube: 1.5, table: 1 } },
      { x: -20, z: -74, r: 9, n: 4, deep: true, weights: { fan: 2, table: 2 } },
      // canyon rim colonies
      { x: -48, z: -40, r: 8, n: 5, weights: { boulder: 2, tube: 1.5, brain: 1, fan: 1 } },
      { x: -58, z: -52, r: 8, n: 4, deep: true, weights: { fan: 2, table: 1.5 } },
      // kelp forest fringe
      { x: -34, z: -56, r: 7, n: 4, weights: { boulder: 2, soft: 1.5, tube: 1, sponge: 0.8 } },
      // far horizons
      { x: 56, z: -64, r: 11, n: 4, deep: true, weights: { fan: 2, table: 1.5 } },
      { x: -30, z: -84, r: 12, n: 4, deep: true, weights: { fan: 2, branch: 1 } },
    ]

    const buckets: Record<string, THREE.BufferGeometry[]> = {}
    for (const key of Object.keys(FAMILIES)) buckets[key] = []

    for (const cl of clusters) {
      this.clusterCenters.push(new THREE.Vector3(cl.x, this.heightAt(cl.x, cl.z), cl.z))
      const n = Math.max(1, Math.round(cl.n * density))
      for (let i = 0; i < n; i++) {
        const a = rng() * Math.PI * 2
        const d = Math.sqrt(rng()) * cl.r
        const x = cl.x + Math.cos(a) * d
        const z = cl.z + Math.sin(a) * d * 0.85
        // keep clear of the limestone reef heads — nothing pokes through the karst
        if (insideReefFootprint(x, z, 1.14)) continue

        // weighted family pick
        const weights = cl.weights ?? { branch: 1, brain: 1, table: 1, fan: 1, tube: 1, boulder: 1, soft: 1, anemone: 0.4 }
        const entries = Object.entries(weights).map(([k, w]) => [k, w ?? 0] as [string, number])
        const total = entries.reduce((s, [, w]) => s + w, 0)
        let roll = rng() * total
        let kind = entries[0][0]
        for (const [k, w] of entries) { roll -= w; if (roll <= 0) { kind = k; break } }

        const fam = FAMILIES[kind]
        const mouths: THREE.Vector3[] = []
        const geo = fam.make(rng, mouths)

        // hero scale variation, smaller in deep zone
        const scale = cl.deep ? rand(1.9, 3.0, rng) : rand(1.05, 2.2, rng)
        const rotY = rng() * Math.PI * 2
        const y = this.heightAt(x, z) - 0.06

        const m = new THREE.Matrix4()
          .makeRotationY(rotY)
          .premultiply(new THREE.Matrix4().makeTranslation(x, y, z))
        geo.applyMatrix4(new THREE.Matrix4().makeScale(scale, scale, scale))
        geo.applyMatrix4(m)

        if (cl.deep) tint(geo, new THREE.Color(0.34, 0.42, 0.5))
        buckets[kind].push(geo)

        if (fam.collide) {
          this.obstacles.push({ x, y: y + scale * 0.5, z, r: scale * fam.collide * 1.3 })
        }
        if (kind === 'anemone' && !cl.deep) {
          this.anemonePositions.push(new THREE.Vector3(x, y + 0.4, z))
        }
        // sponge mouths → world space (mouth sits above the cavity floor)
        for (const lm of mouths) {
          const wm = lm.clone().multiplyScalar(scale).applyMatrix4(m)
          this.spongeMouths.push(wm)
        }
      }
    }

    // guarantee at least three anemones near the garden front
    while (this.anemonePositions.length < 3) {
      const spots = [[10, -14], [17, -24], [-11, -13]]
      const [x, z] = spots[this.anemonePositions.length % spots.length]
      const geo = FAMILIES.anemone.make(rng)
      const s = rand(0.9, 1.3, rng)
      geo.applyMatrix4(new THREE.Matrix4().makeScale(s, s, s))
      geo.applyMatrix4(new THREE.Matrix4().makeTranslation(x, this.heightAt(x, z) - 0.06, z))
      buckets.anemone.push(geo)
      this.anemonePositions.push(new THREE.Vector3(x, this.heightAt(x, z) + 0.4, z))
    }

    // merge per family into one mesh each
    for (const key of Object.keys(buckets)) {
      const list = buckets[key]
      if (!list.length) continue
      const fam = FAMILIES[key]
      const merged = mergeGeometries(list, false)!
      let mat: THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial
      if (fam.alphaMap) {
        mat = new THREE.MeshStandardMaterial({
          vertexColors: true, roughness: 0.9, metalness: 0,
          side: THREE.DoubleSide,
          alphaMap: getFanTexture(),
          alphaTest: 0.32,
          transparent: false,
        })
      } else {
        // wet-look reef: clearcoat reads as the mucus sheen of living coral
        mat = new THREE.MeshPhysicalMaterial({
          vertexColors: true, roughness: 0.74, metalness: 0.02,
          clearcoat: 0.5, clearcoatRoughness: 0.42,
          side: fam.doubleSide ? THREE.DoubleSide : THREE.FrontSide,
        })
      }
      if (fam.sway) addSway(mat, fam.sway[0], fam.sway[1], `coral-sway-${key}`)
      const mesh = new THREE.Mesh(merged, mat)
      mesh.castShadow = false
      this.group.add(mesh)
    }
  }
}

// local rand with injected rng
function rand(a: number, b: number, rng: Rng) { return a + rng() * (b - a) }
function pickF<T,>(arr: T[], rng: Rng): T { return arr[Math.floor(rng() * arr.length)] }

