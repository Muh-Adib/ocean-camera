// ---------------------------------------------------------------
// Sponges — barrel & tube sponges of the reef. Each sponge exposes
// osculum (mouth) EMITTERS: the BubbleSystem continuously trickles
// bubbles out of them, and the gesture field pushes those streams.
// Barrel: ribbed lathe body with a hollow dark interior + lip.
// Tubes: leaning clustered tubes with rim lips.
// ---------------------------------------------------------------
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { mulberry32, noise2 } from '../utils/math'
import type { Obstacle } from './Rocks'
import type { GrowthSpot } from './LimestoneReef'

export interface SpongeEmitter {
  pos: THREE.Vector3
  /** bubbles per second */
  rate: number
  size: number
  speed: number
}

export class SpongeSystem {
  group = new THREE.Group()
  obstacles: Obstacle[] = []
  emitters: SpongeEmitter[] = []
  private meshes: THREE.Mesh[] = []

  constructor(
    scene: THREE.Scene,
    private heightAt: (x: number, z: number) => number,
    detail = 1,
    attach: GrowthSpot[] = [],
  ) {
    this.build(detail, attach)
    scene.add(this.group)
  }

  // ---------------- barrel sponge ----------------
  private makeBarrel(rng: () => number, detail: number): THREE.BufferGeometry {
    const parts: THREE.BufferGeometry[] = []
    const R = 0.55 + rng() * 0.5
    const H = 0.9 + rng() * 0.9
    const colBase = new THREE.Color().setHSL(
      [0.72, 0.13, 0.02, 0.9][Math.floor(rng() * 4)],
      0.45 + rng() * 0.25,
      0.32 + rng() * 0.14,
    )

    // body profile: bulged barrel, open mouth at the top
    const profile: THREE.Vector2[] = []
    const steps = detail >= 0.6 ? 14 : 9
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      const r = R * (0.62 + 0.38 * Math.sin(Math.PI * Math.pow(t, 0.85)))
      profile.push(new THREE.Vector2(Math.max(0.02, r), t * H))
    }
    const body = new THREE.LatheGeometry(profile, detail >= 0.6 ? 40 : 24)
    // vertical ribs + encrustation noise
    const p = body.attributes.position as THREE.BufferAttribute
    const colArr = new Float32Array(p.count * 3)
    const c = new THREE.Color()
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i)
      const a = Math.atan2(z, x)
      const rib = 1 + Math.sin(a * (14 + Math.floor(rng() * 6))) * 0.045
        + noise2(x * 6 + y * 3, z * 6 - y * 2) * 0.05
      p.setX(i, x * rib)
      p.setZ(i, z * rib)
      c.copy(colBase)
      // darker toward the base, paler streaks running up
      c.multiplyScalar(0.72 + (y / H) * 0.4)
      c.offsetHSL(0, 0, Math.sin(a * 9 + y * 5) * 0.03)
      c.multiplyScalar(1 + noise2(x * 15, z * 15 + y * 10) * 0.08)
      colArr[i * 3] = c.r; colArr[i * 3 + 1] = c.g; colArr[i * 3 + 2] = c.b
    }
    body.setAttribute('color', new THREE.BufferAttribute(colArr, 3))
    body.computeVertexNormals()
    parts.push(body)

    // dark interior throat (a cylinder sunk into the mouth)
    const throat = new THREE.CylinderGeometry(R * 0.66, R * 0.5, H * 0.34, 28, 1, true)
    const tCol = new Float32Array(throat.attributes.position.count * 3)
    for (let i = 0; i < throat.attributes.position.count; i++) {
      tCol[i * 3] = 0.06; tCol[i * 3 + 1] = 0.035; tCol[i * 3 + 2] = 0.05
    }
    throat.setAttribute('color', new THREE.BufferAttribute(tCol, 3))
    throat.translate(0, H * 0.86, 0)
    parts.push(throat)

    // rim lip
    const lip = new THREE.TorusGeometry(R * 0.78, R * 0.09, 10, detail >= 0.6 ? 34 : 20)
    lip.rotateX(Math.PI / 2)
    lip.translate(0, H, 0)
    parts.push(paintSimple(lip, colBase.clone().multiplyScalar(0.85), rng))

    return mergeGeometries(parts, false)!
  }

  // ---------------- tube sponge cluster ----------------
  private makeTubeCluster(rng: () => number, detail: number): THREE.BufferGeometry {
    const parts: THREE.BufferGeometry[] = []
    const colBase = new THREE.Color().setHSL(
      [0.72, 0.55, 0.12][Math.floor(rng() * 3)],
      0.4 + rng() * 0.3,
      0.3 + rng() * 0.18,
    )
    const n = 3 + Math.floor(rng() * 5)
    for (let i = 0; i < n; i++) {
      const r = 0.09 + rng() * 0.11
      const h = 0.7 + rng() * 1.3
      const leanA = rng() * Math.PI * 2
      const lean = 0.1 + rng() * 0.35
      const dirV = new THREE.Vector3(Math.cos(leanA) * lean, 1, Math.sin(leanA) * lean).normalize()

      const tube = new THREE.CylinderGeometry(r * 0.86, r, h, detail >= 0.6 ? 14 : 9, 4, true)
      // ribs
      const p = tube.attributes.position as THREE.BufferAttribute
      const colArr = new Float32Array(p.count * 3)
      const c = new THREE.Color()
      for (let j = 0; j < p.count; j++) {
        const fy = p.getY(j) / h + 0.5
        const ang = Math.atan2(p.getZ(j), p.getX(j))
        const rib = 1 + Math.sin(ang * 9) * 0.05 + noise2(p.getX(j) * 14, fy * 9) * 0.04
        p.setX(j, p.getX(j) * rib)
        p.setZ(j, p.getZ(j) * rib)
        c.copy(colBase).multiplyScalar(0.7 + fy * 0.42)
        if (fy > 0.8) c.multiplyScalar(1 - (fy - 0.8) * 2.2)   // dark throat
        colArr[j * 3] = c.r; colArr[j * 3 + 1] = c.g; colArr[j * 3 + 2] = c.b
      }
      tube.setAttribute('color', new THREE.BufferAttribute(colArr, 3))
      tube.computeVertexNormals()
      tube.translate(0, h / 2, 0)
      tube.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dirV))
      const ox = Math.cos(leanA + 1.7) * (rng() - 0.5) * 0.3
      const oz = Math.sin(leanA + 1.7) * (rng() - 0.5) * 0.3
      tube.translate(ox, 0, oz)
      parts.push(tube)

      // rim lip at the osculum
      const tipPos = new THREE.Vector3(ox, 0, oz).addScaledVector(dirV, h)
      const lip = new THREE.TorusGeometry(r * 0.88, r * 0.11, 7, detail >= 0.6 ? 18 : 11)
      lip.rotateX(Math.PI / 2)
      lip.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dirV))
      lip.translate(tipPos.x, tipPos.y, tipPos.z)
      parts.push(paintSimple(lip, colBase.clone().multiplyScalar(0.8), rng))
    }
    return mergeGeometries(parts, false)!
  }

  // ---------------- encrusting sponge patch (colour accent) ----------------
  private makeEncrusting(rng: () => number): THREE.BufferGeometry {
    const blob = new THREE.SphereGeometry(0.3 + rng() * 0.25, 14, 9)
    const p = blob.attributes.position as THREE.BufferAttribute
    const colBase = new THREE.Color().setHSL(rng() < 0.5 ? 0.78 : 0.02, 0.5, 0.34)
    for (let i = 0; i < p.count; i++) {
      const b = 1 + noise2(p.getX(i) * 18 + 3, p.getZ(i) * 18 + p.getY(i) * 12) * 0.14
      p.setXYZ(i, p.getX(i) * b, Math.max(0.02, p.getY(i) * b * 0.4), p.getZ(i) * b)
    }
    blob.computeVertexNormals()
    return paintSimple(blob, colBase, rng, 0.1)
  }

  private build(detail: number, attach: GrowthSpot[]) {
    const rng = mulberry32(20260902)

    const spots: { x: number; z: number; kind: 'barrel' | 'tube' | 'encrusting'; scale: number }[] = [
      // garden & limestone neighbourhood
      { x: 10.5, z: -22.5, kind: 'barrel', scale: 1.35 },
      { x: 17.5, z: -28.5, kind: 'tube', scale: 1.2 },
      { x: 21.0, z: -24.0, kind: 'barrel', scale: 0.95 },
      { x: 6.5, z: -31.0, kind: 'tube', scale: 1.0 },
      { x: 26.5, z: -17.5, kind: 'barrel', scale: 1.1 },
      { x: -4.5, z: -30.0, kind: 'tube', scale: 1.25 },
      { x: -15.5, z: -21.0, kind: 'barrel', scale: 1.0 },
      { x: -24.0, z: -35.0, kind: 'tube', scale: 1.1 },
      { x: -33.0, z: -52.0, kind: 'barrel', scale: 1.3 },
      { x: 33.0, z: -24.0, kind: 'tube', scale: 0.95 },
      { x: 2.5, z: -44.0, kind: 'barrel', scale: 1.05 },
      { x: -8.0, z: -12.5, kind: 'encrusting', scale: 1.4 },
      { x: 14.0, z: -13.0, kind: 'encrusting', scale: 1.2 },
      { x: -19.0, z: -14.0, kind: 'encrusting', scale: 1.3 },
    ]

    const barrelGeos: THREE.BufferGeometry[] = []
    const tubeGeos: THREE.BufferGeometry[] = []
    const crustGeos: THREE.BufferGeometry[] = []

    const placeSponge = (kind: string, x: number, z: number, scale: number, yOverride?: number) => {
      const y = yOverride ?? this.heightAt(x, z) - 0.04
      let geo: THREE.BufferGeometry
      if (kind === 'barrel') {
        geo = this.makeBarrel(rng, detail)
        barrelGeos.push(geo)
        // osculum emitter at the barrel mouth
        const H = geo.boundingBox?.max.y ?? 1.2
        this.emitters.push({
          pos: new THREE.Vector3(x, y + H * scale * 0.96, z),
          rate: 0.9 + rng() * 0.9,
          size: 0.09 + rng() * 0.07,
          speed: 0.85 + rng() * 0.5,
        })
        this.obstacles.push({ x, y: y + 0.5, z, r: 0.85 * scale })
      } else if (kind === 'tube') {
        geo = this.makeTubeCluster(rng, detail)
        tubeGeos.push(geo)
        // one emitter per cluster (tallest tube) + occasionally a second
        const H = geo.boundingBox?.max.y ?? 1.4
        this.emitters.push({
          pos: new THREE.Vector3(x + (rng() - 0.5) * 0.3, y + H * scale * 0.94, z + (rng() - 0.5) * 0.3),
          rate: 0.7 + rng() * 0.8,
          size: 0.07 + rng() * 0.05,
          speed: 0.8 + rng() * 0.5,
        })
      } else {
        geo = this.makeEncrusting(rng)
        crustGeos.push(geo)
      }
      geo.scale(scale, scale, scale)
      geo.rotateY(rng() * Math.PI * 2)
      geo.translate(x, y, z)
    }

    for (const s of spots) placeSponge(s.kind, s.x, s.z, s.scale)

    // 3 sponges growing directly ON the limestone structure
    for (let i = 0; i < Math.min(3, attach.length); i++) {
      const spot = attach[Math.floor(attach.length * (0.2 + i * 0.3))]
      placeSponge(i === 1 ? 'barrel' : 'tube', spot.pos.x, spot.pos.z, 0.55 + rng() * 0.3, spot.pos.y - 0.05)
    }

    const addMesh = (list: THREE.BufferGeometry[]) => {
      if (!list.length) return
      const merged = mergeGeometries(list, false)!
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.0 })
      const mesh = new THREE.Mesh(merged, mat)
      this.group.add(mesh)
      this.meshes.push(mesh)
    }
    addMesh(barrelGeos)
    addMesh(tubeGeos)
    addMesh(crustGeos)
  }

  dispose() {
    for (const m of this.meshes) {
      m.geometry.dispose()
      ;(m.material as THREE.Material).dispose()
    }
    this.meshes = []
  }
}

/** flat colour + slight per-vertex variation */
function paintSimple(geo: THREE.BufferGeometry, color: THREE.Color, rng: () => number, vary = 0.06): THREE.BufferGeometry {
  const count = geo.attributes.position.count
  const arr = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    const f = 1 + (rng() - 0.5) * 2 * vary
    arr[i * 3] = color.r * f; arr[i * 3 + 1] = color.g * f; arr[i * 3 + 2] = color.b * f
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3))
  return geo
}
