// ---------------------------------------------------------------
// ReefDecor — bottom-dwelling life that fills the reef floor:
// starfish (beveled 5-arm stars), sea urchins (radiating spikes)
// and scattered scallop shells. Everything is generated once,
// vertex-coloured and merged into ONE static draw call.
// ---------------------------------------------------------------
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { mulberry32 } from '../utils/math'

interface ReefDecorCounts {
  stars: number
  urchins: number
  shells: number
}

const DEFAULTS: ReefDecorCounts = { stars: 8, urchins: 12, shells: 16 }

/** fills a geometry's color attribute with one colour + tiny variation */
function tintGeometry(geo: THREE.BufferGeometry, color: THREE.Color, rng: () => number, vary = 0.08) {
  const count = geo.attributes.position.count
  const arr = new Float32Array(count * 3)
  const c = new THREE.Color()
  for (let i = 0; i < count; i++) {
    const f = 1 + (rng() - 0.5) * 2 * vary
    c.copy(color).multiplyScalar(f)
    arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3))
}

/** beveled 5-arm starfish, lying flat in the XZ plane */
function starGeometry(rng: () => number): THREE.BufferGeometry {
  const arms = 5
  const rOut = 0.34 + rng() * 0.14
  const rIn = rOut * (0.34 + rng() * 0.08)
  const shape = new THREE.Shape()
  for (let i = 0; i < arms * 2; i++) {
    const a = (i / (arms * 2)) * Math.PI * 2 - Math.PI / 2
    const r = i % 2 === 0 ? rOut : rIn
    // slight per-arm irregularity so no two stars read identical
    const wob = 1 + (rng() - 0.5) * 0.12
    const x = Math.cos(a) * r * wob
    const y = Math.sin(a) * r * wob
    if (i === 0) shape.moveTo(x, y)
    else shape.lineTo(x, y)
  }
  shape.closePath()
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.07 + rng() * 0.04,
    bevelEnabled: true,
    bevelThickness: 0.045,
    bevelSize: 0.055,
    bevelSegments: 2,
    steps: 1,
  })
  geo.rotateX(-Math.PI / 2)
  return geo
}

/** one urchin: squashed dark test + ~70 radiating needle spikes */
function urchinGeometry(rng: () => number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []

  const testR = 0.16 + rng() * 0.05
  const test = new THREE.IcosahedronGeometry(testR, 1)
  test.scale(1, 0.82, 1)
  tintGeometry(test, new THREE.Color('#1c1326'), rng, 0.15)
  parts.push(test)

  const spikes = 58 + Math.floor(rng() * 22)
  const spikeLen = 0.26 + rng() * 0.16
  for (let i = 0; i < spikes; i++) {
    // fibonacci-ish sphere distribution with jitter
    const t = i / spikes
    const gy = Math.acos(1 - 2 * t)
    const ga = 2.399963 * i + rng() * 0.5
    const dir = new THREE.Vector3(
      Math.sin(gy) * Math.cos(ga),
      Math.cos(gy) * 0.82,
      Math.sin(gy) * Math.sin(ga),
    ).normalize()
    const len = spikeLen * (0.65 + rng() * 0.6)
    const spike = new THREE.ConeGeometry(0.011 + rng() * 0.007, len, 4)
    spike.translate(0, len * 0.42, 0)                 // pivot at base
    spike.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir))
    // seat the spike base into the test surface
    const base = testR * 0.72
    spike.translate(dir.x * base, dir.y * base, dir.z * base)
    tintGeometry(spike, new THREE.Color().setHSL(0.74 + rng() * 0.04, 0.45, 0.16 + rng() * 0.07), rng, 0.1)
    parts.push(spike)
  }

  return mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)), false)!
}

/** low scallop shell: ribbed half-dome with a pale lip */
function shellGeometry(rng: () => number): THREE.BufferGeometry {
  const r = 0.1 + rng() * 0.09
  const dome = new THREE.SphereGeometry(r, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.52)
  dome.scale(1, 0.34 + rng() * 0.14, 0.92)
  // radial ribs: push alternating meridians outward
  const pos = dome.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i)
    const a = Math.atan2(z, x)
    const rib = 1 + Math.sin(a * 9) * 0.08
    pos.setXYZ(i, x * rib, pos.getY(i), z * rib)
  }
  dome.computeVertexNormals()
  const sand = new THREE.Color().setHSL(0.09 + rng() * 0.03, 0.32 + rng() * 0.18, 0.62 + rng() * 0.12)
  tintGeometry(dome, sand, rng, 0.09)
  return dome
}

export class ReefDecor {
  group = new THREE.Group()
  private mesh: THREE.Mesh | null = null

  constructor(
    scene: THREE.Scene,
    heightAt: (x: number, z: number) => number,
    counts: Partial<ReefDecorCounts> = {},
  ) {
    const n = { ...DEFAULTS, ...counts }
    const rng = mulberry32(20260831)
    const parts: THREE.BufferGeometry[] = []
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const e = new THREE.Euler()
    const s = new THREE.Vector3()
    const p = new THREE.Vector3()

    const place = (geo: THREE.BufferGeometry, lift: number, tilt: number, scale: number) => {
      // keep clear of the camera's start lagoon, scatter across the reef plain
      const a = rng() * Math.PI * 2
      const rad = 9 + rng() * 36
      const x = Math.cos(a) * rad
      const z = -20 + Math.sin(a) * rad
      p.set(x, heightAt(x, z) + lift, z)
      e.set((rng() - 0.5) * tilt, rng() * Math.PI * 2, (rng() - 0.5) * tilt)
      q.setFromEuler(e)
      s.setScalar(scale * (0.8 + rng() * 0.5))
      geo.applyMatrix4(m.compose(p, q, s))
      parts.push(geo)
    }

    // starfish — banded coral-orange / rust / deep red
    const starCols = ['#c85a28', '#b8402e', '#d4763a', '#a83a4a']
    for (let i = 0; i < n.stars; i++) {
      const g = starGeometry(rng)
      tintGeometry(g, new THREE.Color(starCols[Math.floor(rng() * starCols.length)]), rng, 0.1)
      place(g, 0.02, 0.35, 1.15)
    }

    // sea urchins — huddle near rocks, deeper zones
    for (let i = 0; i < n.urchins; i++) {
      place(urchinGeometry(rng), 0.14, 0.5, 1.0 + rng() * 0.5)
    }

    // scallop shells — sand-coloured litter
    for (let i = 0; i < n.shells; i++) {
      place(shellGeometry(rng), 0.01, 0.25, 1.0)
    }

    const merged = mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)), false)!
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.88,
      metalness: 0.02,
    })
    this.mesh = new THREE.Mesh(merged, mat)
    this.group.add(this.mesh)
    scene.add(this.group)
  }

  dispose() {
    if (this.mesh) {
      this.mesh.geometry.dispose()
      ;(this.mesh.material as THREE.Material).dispose()
      this.mesh = null
    }
  }
}
