// ---------------------------------------------------------------
// CoralSystem — 8 procedural coral families (branch, brain, table,
// fan, tube, boulder, soft, anemone) with shader-driven current
// sway, placed as biome clusters. Registers obstacle colliders and
// anemone homes for clownfish.
// ---------------------------------------------------------------
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { sharedUniforms } from '../core/sharedUniforms'
import { mulberry32 } from '../utils/math'
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
  for (let i = 0; i < count; i++) {
    const y = geo.attributes.position.getY(i)
    const t = (y - bb.min.y) / h
    c.copy(base)
    const v = 1 + (rng() - 0.5) * vary
    c.multiplyScalar(v)
    c.lerp(new THREE.Color('#ffffff'), t * topLighten * 0.55)
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

// ---------------- shared fan silhouette texture ----------------
let fanTexture: THREE.Texture | null = null
function getFanTexture(): THREE.Texture {
  if (fanTexture) return fanTexture
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  g.fillStyle = '#000'
  g.fillRect(0, 0, 128, 128)
  g.strokeStyle = '#fff'
  g.lineCap = 'round'
  const cx = 64, cy = 124
  const branch = (x: number, y: number, angle: number, len: number, w: number, depth: number) => {
    const x2 = x + Math.sin(angle) * len
    const y2 = y - Math.cos(angle) * len
    g.lineWidth = w
    g.beginPath(); g.moveTo(x, y); g.lineTo(x2, y2); g.stroke()
    if (depth <= 0) return
    const n = 2
    for (let i = 0; i < n; i++) {
      branch(x2, y2, angle + (i === 0 ? -1 : 1) * (0.18 + Math.random() * 0.3), len * (0.55 + Math.random() * 0.25), Math.max(1, w * 0.62), depth - 1)
    }
    if (Math.random() < 0.5) branch(x2, y2, angle + (Math.random() - 0.5) * 0.2, len * 0.5, Math.max(1, w * 0.5), depth - 1)
  }
  for (let i = -3; i <= 3; i++) branch(cx, cy, i * 0.19, 34 + Math.random() * 8, 3.4, 4)
  fanTexture = new THREE.CanvasTexture(c)
  return fanTexture
}

// ---------------- coral family generators ----------------
function makeBranchCoral(rng: Rng): THREE.BufferGeometry {
  const geoms: THREE.BufferGeometry[] = []
  const palette = ['#ff7bac', '#c06ad4', '#ff9a5a', '#f2d05a', '#ff6f61']
  const base = new THREE.Color(pickF(palette, rng))
  const up = new THREE.Vector3(0, 1, 0)

  const grow = (origin: THREE.Vector3, dir: THREE.Vector3, len: number, radius: number, depth: number) => {
    const end = origin.clone().addScaledVector(dir, len)
    const cyl = new THREE.CylinderGeometry(radius * 0.62, radius, len, 7, 3)
    // gentle organic bend: bow the mid-height vertices along a jitter axis
    {
      const p = cyl.attributes.position as THREE.BufferAttribute
      const bend = new THREE.Vector3(rng() - 0.5, 0, rng() - 0.5).multiplyScalar(len * 0.24)
      for (let i = 0; i < p.count; i++) {
        const fy = (p.getY(i) / len + 0.5)
        const k = fy * fy * 0.8 + fy * 0.2
        p.setXYZ(i, p.getX(i) + bend.x * k, p.getY(i), p.getZ(i) + bend.z * k)
      }
    }
    cyl.translate(0, len / 2, 0)
    cyl.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, dir))
    cyl.translate(origin.x, origin.y, origin.z)
    geoms.push(paint(cyl, base, 0.25, rng, 0.1))
    if (depth <= 0) {
      const tip = new THREE.SphereGeometry(radius * 1.05, 8, 6)
      tip.translate(end.x, end.y, end.z)
      geoms.push(paint(tip, base.clone().lerp(new THREE.Color('#fff2b0'), 0.5), 0.15, rng, 0))
      return
    }
    const children = 2 + (rng() < 0.45 ? 1 : 0)
    for (let i = 0; i < children; i++) {
      const nd = dir.clone()
      const axis = new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize()
      nd.applyAxisAngle(axis, 0.35 + rng() * 0.5)
      nd.y = Math.abs(nd.y) * 0.65 + 0.28
      nd.normalize()
      grow(end, nd, len * (0.6 + rng() * 0.2), radius * 0.7, depth - 1)
    }
  }
  grow(new THREE.Vector3(0, 0, 0), new THREE.Vector3(rng() * 0.3 - 0.15, 1, rng() * 0.3 - 0.15).normalize(), 0.55 + rng() * 0.3, 0.1, 3)
  return mergeGeometries(geoms, false)!
}

function makeBrainCoral(rng: Rng): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(0.85, 26, 17)
  const p = geo.attributes.position as THREE.BufferAttribute
  const v = new THREE.Vector3()
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i)
    // fine meandering ridges: two maze octaves + micro relief
    const b = Math.sin(v.x * 12) * Math.sin(v.z * 12) * 0.055
      + Math.sin(v.x * 5.2 + v.z * 3.8) * 0.045
      + Math.sin(v.x * 23) * Math.sin(v.z * 21) * 0.018
    v.multiplyScalar(1 + b)
    p.setXYZ(i, v.x, v.y * 0.68, v.z * 0.88)
  }
  geo.computeVertexNormals()
  const base = new THREE.Color(pickF(['#c9a05a', '#9aa75a', '#c78a6a'], rng))
  return paint(geo, base, 0.2, rng, 0.25)
}

function makeTableCoral(rng: Rng): THREE.BufferGeometry {
  const geoms: THREE.BufferGeometry[] = []
  const h = 0.5 + rng() * 0.5
  const col = new THREE.CylinderGeometry(0.09, 0.14, h, 7, 2)
  col.translate(0, h / 2, 0)
  geoms.push(paint(col, new THREE.Color('#b8a888'), 0.15, rng, 0.1))
  // substructure skirt under the disc
  const skirt = new THREE.ConeGeometry(0.34, 0.24, 8, 1, true)
  skirt.rotateX(Math.PI)
  skirt.translate(0, h - 0.1, 0)
  geoms.push(paint(skirt, new THREE.Color('#a89878'), 0.18, rng, 0.1))

  const r = 0.8 + rng() * 0.7
  const disc = new THREE.CylinderGeometry(r, r * 0.9, 0.13, 28, 1)
  // wavy rim + radial ridges on top
  const p = disc.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i)
    const a = Math.atan2(z, x)
    const d = Math.hypot(x, z) / r
    p.setY(i, p.getY(i)
      + Math.sin(a * 3 + rng() * 6) * 0.05 * d
      + Math.sin(a * 9 + 1.7) * 0.024 * d)
  }
  disc.computeVertexNormals()
  disc.translate(0, h, 0)
  const base = new THREE.Color(pickF(['#d9b98a', '#caa2a2', '#c9c48a'], rng))
  geoms.push(paint(disc, base, 0.18, rng, 0.4))
  return mergeGeometries(geoms, false)!
}

function makeFanCoral(rng: Rng): THREE.BufferGeometry {
  const geo = new THREE.PlaneGeometry(1.5, 1.7, 11, 15)
  geo.translate(0, 0.85, 0)
  const p = geo.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i)
    p.setZ(i, Math.pow(y / 1.7, 2) * 0.28 - Math.abs(x) * 0.12)  // gentle cup
  }
  geo.computeVertexNormals()
  const base = new THREE.Color(pickF(['#b3455e', '#8a4fb0', '#7b68c9', '#c46a8a'], rng))
  paint(geo, base, 0.2, rng, 0.45)
  return geo
}

function makeTubeCoral(rng: Rng): THREE.BufferGeometry {
  const geoms: THREE.BufferGeometry[] = []
  const base = new THREE.Color(pickF(['#4fb8a8', '#5a9ac9', '#68c9b0'], rng))
  const n = 5 + Math.floor(rng() * 4)
  for (let i = 0; i < n; i++) {
    const r = 0.09 + rng() * 0.07
    const h = 0.4 + rng() * 0.5
    const tube = new THREE.CylinderGeometry(r * 0.8, r, h, 8, 3, true)
    const a = rng() * Math.PI * 2
    const d = rng() * 0.18
    tube.translate(Math.cos(a) * d, h / 2, Math.sin(a) * d)
    tube.rotateY(rng() * Math.PI)
    paint(tube, base, 0.3, rng, 0.0)   // topLighten 0 → rims stay dark
    // darkened rim toward the opening — reads as a hollow polyp tube
    {
      const p = tube.attributes.position as THREE.BufferAttribute
      const col = tube.attributes.color as THREE.BufferAttribute
      for (let j = 0; j < p.count; j++) {
        const fy = p.getY(j) / h + 0.5                 // 0 bottom → 1 top
        if (fy > 0.55) {
          const k = (fy - 0.55) / 0.45
          col.setXYZ(j, col.getX(j) * (1 - k * 0.62), col.getY(j) * (1 - k * 0.58), col.getZ(j) * (1 - k * 0.5))
        }
      }
    }
    geoms.push(tube)
  }
  return mergeGeometries(geoms, false)!
}

function makeBoulderCoral(rng: Rng): THREE.BufferGeometry {
  const geoms: THREE.BufferGeometry[] = []
  const base = new THREE.Color(pickF(['#8a8a5f', '#9a7f5f', '#7f8a6a'], rng))
  const n = 3 + Math.floor(rng() * 3)
  for (let i = 0; i < n; i++) {
    const blob = new THREE.IcosahedronGeometry(0.28 + rng() * 0.22, 1)
    const p = blob.attributes.position as THREE.BufferAttribute
    const v = new THREE.Vector3()
    for (let j = 0; j < p.count; j++) {
      v.fromBufferAttribute(p, j)
      v.multiplyScalar(1 + Math.sin(v.x * 12 + v.z * 10) * 0.08)
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
  const base = new THREE.Color(pickF(['#d45a9a', '#9a5ad4', '#5ac9d4', '#e07a5a'], rng))
  const n = 2 + Math.floor(rng() * 3)
  for (let i = 0; i < n; i++) {
    const blob = new THREE.SphereGeometry(0.22 + rng() * 0.2, 10, 8)
    const p = blob.attributes.position as THREE.BufferAttribute
    for (let j = 0; j < p.count; j++) {
      const y = p.getY(j)
      if (y > 0.1) p.setXYZ(j, p.getX(j) * 1.25, y, p.getZ(j) * 1.25)  // flared top
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
  const tent = new THREE.Color(pickF(['#e88ab0', '#b0e88a', '#e8c48a', '#c48ae8'], rng))
  const disc = new THREE.CylinderGeometry(0.3, 0.36, 0.14, 10)
  disc.translate(0, 0.07, 0)
  geoms.push(paint(disc, new THREE.Color('#a06a5a'), 0.15, rng, 0.1))
  const n = 34 + Math.floor(rng() * 12)
  const up = new THREE.Vector3(0, 1, 0)
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng() * 0.3
    const tilt = 0.22 + rng() * 0.3
    const dir = new THREE.Vector3(Math.cos(a) * tilt, 1, Math.sin(a) * tilt).normalize()
    const h = 0.42 + rng() * 0.28
    const t = new THREE.ConeGeometry(0.035, h, 5, 2)
    t.translate(0, h / 2, 0)
    t.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, dir))
    const ox = Math.cos(a) * 0.16, oz = Math.sin(a) * 0.16
    t.translate(ox, 0.12, oz)
    geoms.push(paint(t, tent, 0.25, rng, 0.6))
    const tip = new THREE.SphereGeometry(0.045, 5, 4)
    tip.translate(ox + dir.x * h, 0.12 + dir.y * h, oz + dir.z * h)
    geoms.push(paint(tip, tent.clone().lerp(new THREE.Color('#ffffff'), 0.55), 0.1, rng, 0))
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
  make: (rng: Rng) => THREE.BufferGeometry
  sway?: [number, number]      // [amp, freq]
  collide?: number             // obstacle radius multiplier
  alphaMap?: boolean
}

const FAMILIES: Record<string, Family> = {
  branch: { kind: 'branch', make: makeBranchCoral, collide: 0.55 },
  brain: { kind: 'brain', make: makeBrainCoral, collide: 0.8 },
  table: { kind: 'table', make: makeTableCoral, collide: 0.7 },
  fan: { kind: 'fan', make: makeFanCoral, sway: [0.045, 0.7], alphaMap: true },
  tube: { kind: 'tube', make: makeTubeCoral, sway: [0.02, 1.1] },
  boulder: { kind: 'boulder', make: makeBoulderCoral, collide: 0.75 },
  soft: { kind: 'soft', make: makeSoftCoral, sway: [0.06, 0.9] },
  anemone: { kind: 'anemone', make: makeAnemone, sway: [0.03, 1.6] },
}

export class CoralSystem {
  group = new THREE.Group()
  obstacles: Obstacle[] = []
  anemonePositions: THREE.Vector3[] = []
  clusterCenters: THREE.Vector3[] = []

  constructor(scene: THREE.Scene, private heightAt: (x: number, z: number) => number, density = 1) {
    this.build(density)
    scene.add(this.group)
  }

  private build(density: number) {
    const rng = mulberry32(20260828)

    const clusters: { x: number; z: number; r: number; n: number; deep?: boolean; weights?: Partial<Record<string, number>> }[] = [
      // Zone B — coral garden (right side), dense & colourful
      { x: 13, z: -20, r: 9, n: 10, weights: { branch: 3, fan: 2, table: 2, brain: 1.5, tube: 2, soft: 1.5, anemone: 1 } },
      { x: 24, z: -30, r: 8, n: 8, weights: { branch: 2.5, fan: 2, table: 1.5, brain: 1.5, tube: 1.5, soft: 1 } },
      { x: 8, z: -34, r: 6, n: 6, weights: { branch: 2, fan: 1.5, brain: 1, tube: 2, soft: 1 } },
      { x: 29, z: -13, r: 7, n: 7, weights: { branch: 2, table: 2, fan: 1.5, brain: 1, anemone: 1 } },
      { x: 18, z: -46, r: 8, n: 6, weights: { fan: 2, branch: 1.5, table: 1.5, brain: 1 } },
      // front-of-camera accents
      { x: 5, z: -15, r: 5, n: 5, weights: { branch: 2, soft: 1.5, tube: 1.5, anemone: 1, brain: 1 } },
      { x: -6, z: -18, r: 5, n: 4, weights: { fan: 1.5, tube: 1.5, brain: 1, soft: 1 } },
      // Zone C — rocky reef (left side)
      { x: -18, z: -24, r: 8, n: 6, weights: { boulder: 2, brain: 2, tube: 1.5, fan: 1, soft: 1 } },
      { x: -29, z: -38, r: 8, n: 7, weights: { boulder: 2, brain: 1.5, tube: 2, fan: 1.5 } },
      { x: -10, z: -44, r: 6, n: 5, weights: { tube: 2, fan: 1.5, brain: 1, soft: 1 } },
      // near-field accents
      { x: -13, z: -11, r: 5, n: 3, weights: { anemone: 1.5, brain: 1, soft: 1, tube: 1 } },
      { x: 9, z: -9, r: 4.5, n: 3, weights: { anemone: 2, soft: 1, brain: 1 } },
      // deep sparse silhouettes
      { x: -46, z: -60, r: 11, n: 4, deep: true, weights: { fan: 2, table: 2, branch: 1 } },
      { x: 44, z: -58, r: 11, n: 4, deep: true, weights: { fan: 2, table: 1.5, brain: 1 } },
      { x: 2, z: -66, r: 13, n: 5, deep: true, weights: { fan: 2, table: 2, tube: 1 } },
      // SE sand flats — sparse soft gardens between the bommies
      { x: 38, z: -18, r: 8, n: 5, weights: { soft: 2, anemone: 1.5, tube: 1.5, brain: 1 } },
      { x: 50, z: -30, r: 9, n: 4, weights: { tube: 2, soft: 1.5, fan: 1 } },
      // northern spire foothills
      { x: 12, z: -76, r: 9, n: 4, deep: true, weights: { fan: 2, tube: 1.5, table: 1 } },
      { x: -20, z: -74, r: 9, n: 4, deep: true, weights: { fan: 2, table: 2 } },
      // canyon rim colonies
      { x: -48, z: -40, r: 8, n: 5, weights: { boulder: 2, tube: 1.5, brain: 1, fan: 1 } },
      { x: -58, z: -52, r: 8, n: 4, deep: true, weights: { fan: 2, table: 1.5 } },
      // kelp forest fringe
      { x: -34, z: -56, r: 7, n: 4, weights: { boulder: 2, soft: 1.5, tube: 1 } },
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

        // weighted family pick
        const weights = cl.weights ?? { branch: 1, brain: 1, table: 1, fan: 1, tube: 1, boulder: 1, soft: 1, anemone: 0.4 }
        const entries = Object.entries(weights).map(([k, w]) => [k, w ?? 0] as [string, number])
        const total = entries.reduce((s, [, w]) => s + w, 0)
        let roll = rng() * total
        let kind = entries[0][0]
        for (const [k, w] of entries) { roll -= w; if (roll <= 0) { kind = k; break } }

        const fam = FAMILIES[kind]
        const geo = fam.make(rng)

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
      let mat: THREE.MeshStandardMaterial
      if (fam.alphaMap) {
        mat = new THREE.MeshStandardMaterial({
          vertexColors: true, roughness: 0.9, metalness: 0,
          side: THREE.DoubleSide,
          alphaMap: getFanTexture(),
          alphaTest: 0.32,
          transparent: false,
        })
      } else {
        mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0.02 })
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

