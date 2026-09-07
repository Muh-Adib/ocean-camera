// ---------------------------------------------------------------
// LimestoneReef — THE central limestone structure of the reef.
// A towering karst bommie complex from which the coral garden grows
// naturally (reference: "all structurally connected and growing
// naturally from a central limestone structure"). High-detail
// noise-deformed karst with overhanging ledges, algae-encrusted
// vertex colours and a coral-rubble skirt. Exposes upward-facing
// growth spots so corals root ON the structure, not just beside it.
// ---------------------------------------------------------------
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { mulberry32, noise2, fbm2 } from '../utils/math'
import type { Obstacle } from './Rocks'

export interface GrowthSpot {
  pos: THREE.Vector3
  normal: THREE.Vector3
}

export class LimestoneReef {
  group = new THREE.Group()
  obstacles: Obstacle[] = []
  /** upward-facing surface points where corals can root */
  growthSpots: GrowthSpot[] = []
  private meshes: THREE.Mesh[] = []

  constructor(
    scene: THREE.Scene,
    private heightAt: (x: number, z: number) => number,
    detail = 1,
  ) {
    this.build(detail)
    scene.add(this.group)
  }

  /** limestone colour with algae / mineral stains painted per-vertex */
  private paintLimestone(geo: THREE.BufferGeometry, rng: () => number) {
    geo.computeBoundingBox()
    const bb = geo.boundingBox!
    const h = Math.max(0.001, bb.max.y - bb.min.y)
    const count = geo.attributes.position.count
    const colors = new Float32Array(count * 3)
    const base = new THREE.Color('#a39880')
    const shade = new THREE.Color('#6e6553')
    const algae = new THREE.Color('#5e7a4e')
    const rust = new THREE.Color('#8a6a4a')
    const c = new THREE.Color()
    for (let i = 0; i < count; i++) {
      const x = geo.attributes.position.getX(i)
      const y = geo.attributes.position.getY(i)
      const z = geo.attributes.position.getZ(i)
      const t = (y - bb.min.y) / h
      c.copy(base)
      // crevice darkening toward the base
      c.lerp(shade, (1 - t) * 0.55)
      // algae patches + rust stains from fbm field
      const al = Math.max(0, fbm2(x * 0.5 + 9, z * 0.5 - y * 0.4, 3))
      c.lerp(algae, Math.min(0.5, al * 0.85) * (0.35 + t * 0.4))
      const ru = Math.max(0, noise2(x * 0.9 - 4, y * 0.9 + z * 0.7))
      c.lerp(rust, ru * 0.35)
      // micro variation
      const v = 1 + (rng() - 0.5) * 0.14
      c.multiplyScalar(v)
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  }

  /** one karst tower: icosphere sculpted by ridged fbm + ledges */
  private makeTower(seed: number, r: number, h: number, detail: number): THREE.BufferGeometry {
    const rng = mulberry32(seed)
    const geo = new THREE.IcosahedronGeometry(1, detail === 1 ? 4 : 3)
    const p = geo.attributes.position as THREE.BufferAttribute
    const v = new THREE.Vector3()
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i)
      const ny = v.y                                   // -1..1
      // vertical stretch into a tower
      let rad = 1 + ny * 0.1
      // ridged limestone erosion (large + medium + fine)
      const e1 = 1 - Math.abs(noise2(v.x * 1.4 + seed, v.z * 1.4 - ny * 0.8))
      const e2 = 1 - Math.abs(noise2(v.z * 2.6 - seed, v.x * 2.6 + ny * 1.7))
      const e3 = noise2(v.x * 5.5 + ny * 3, v.z * 5.5)
      rad *= 1 + (e1 - 0.45) * 0.42 + (e2 - 0.5) * 0.2 + e3 * 0.08
      // horizontal ledge shelves every ~40% of height
      const ledge = Math.exp(-Math.pow(((ny + 0.25) % 0.9 - 0.45) * 7, 2)) * 0.22
      rad += ledge * (0.5 + 0.5 * Math.sin(v.x * 4 + v.z * 3))
      // flatten bottom, taper strongly near the sand
      const taper = ny < -0.3 ? 1 + (ny + 0.3) * 0.9 : 1
      rad *= taper
      v.x *= rad * r
      v.z *= rad * r
      v.y = ny * h * (0.86 + 0.14 * rad)
      p.setXYZ(i, v.x, v.y, v.z)
    }
    geo.computeVertexNormals()
    this.paintLimestone(geo, rng)
    return geo
  }

  /** chunky rubble block for the skirt */
  private makeRubble(seed: number): THREE.BufferGeometry {
    const rng = mulberry32(seed)
    const geo = new THREE.IcosahedronGeometry(1, 1)
    const p = geo.attributes.position as THREE.BufferAttribute
    const v = new THREE.Vector3()
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i)
      const n = noise2(v.x * 2.2 + seed, v.z * 2.2 + v.y * 1.4)
      v.multiplyScalar(1 + n * 0.34)
      v.y *= 0.62
      p.setXYZ(i, v.x, v.y, v.z)
    }
    geo.computeVertexNormals()
    this.paintLimestone(geo, rng)
    return geo
  }

  private collectGrowthSpots(geo: THREE.BufferGeometry, world: THREE.Vector3, scale: number) {
    // NOTE: called BEFORE geo.translate — positions are still local
    const pos = geo.attributes.position as THREE.BufferAttribute
    const nor = geo.attributes.normal as THREE.BufferAttribute
    for (let i = 0; i < pos.count; i += 3) {
      if (nor.getY(i) < 0.62) continue
      const ly = pos.getY(i) * scale
      if (ly < 1.2) continue                             // still buried in the sand
      const p = new THREE.Vector3(
        pos.getX(i) * scale + world.x,
        ly + world.y,
        pos.getZ(i) * scale + world.z,
      )
      let dup = false
      for (const g of this.growthSpots) {
        if (g.pos.distanceToSquared(p) < 1.44) { dup = true; break }
      }
      if (!dup) this.growthSpots.push({ pos: p, normal: new THREE.Vector3(0, 1, 0) })
    }
  }

  private build(detail: number) {
    const rng = mulberry32(20260901)
    const towers: { seed: number; x: number; z: number; r: number; h: number }[] = [
      // hero cluster — the central limestone structure of the coral garden
      { seed: 9101, x: 14.5, z: -26, r: 3.4, h: 8.4 },
      { seed: 9102, x: 11.2, z: -23.4, r: 2.3, h: 5.6 },
      { seed: 9103, x: 18.0, z: -23.0, r: 2.0, h: 4.8 },
      { seed: 9104, x: 15.8, z: -30.2, r: 1.9, h: 4.2 },
      // secondary bommie west of the garden
      { seed: 9105, x: -3.5, z: -33, r: 2.1, h: 4.6 },
      // garden-path pinnacles
      { seed: 9106, x: 25.5, z: -32.5, r: 1.6, h: 3.6 },
      { seed: 9107, x: 4.0, z: -38.5, r: 1.7, h: 3.4 },
    ]

    const towerGeos: THREE.BufferGeometry[] = []
    const rubbleGeos: THREE.BufferGeometry[] = []

    for (const t of towers) {
      const geo = this.makeTower(t.seed, t.r, t.h, detail)
      const y = this.heightAt(t.x, t.z) - t.r * 0.28
      const world = new THREE.Vector3(t.x, y, t.z)
      const scale = 1
      this.collectGrowthSpots(geo, world, scale)
      geo.translate(world.x, world.y, world.z)
      towerGeos.push(geo)

      // rubble ring hugging the tower base
      const n = detail === 1 ? 9 : 6
      for (let i = 0; i < n; i++) {
        const a = rng() * Math.PI * 2
        const d = t.r * (1.15 + rng() * 0.75)
        const rx = t.x + Math.cos(a) * d
        const rz = t.z + Math.sin(a) * d * 0.85
        const rg = this.makeRubble(t.seed * 31 + i)
        const rs = 0.5 + rng() * 0.9
        const ry = this.heightAt(rx, rz) - 0.12
        rg.scale(rs, rs * (0.7 + rng() * 0.5), rs)
        rg.rotateY(rng() * Math.PI * 2)
        rg.translate(rx, ry, rz)
        rubbleGeos.push(rg)
      }

      this.obstacles.push({ x: t.x, y: y + t.h * 0.4, z: t.z, r: t.r * 1.25 })
    }

    // towers merged into one draw call
    const towerMeshGeo = mergeGeometries(towerGeos.map((g) => (g.index ? g : g)), false)!
    const towerMat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.94, metalness: 0.0,
    })
    const towerMesh = new THREE.Mesh(towerMeshGeo, towerMat)
    this.group.add(towerMesh)
    this.meshes.push(towerMesh)

    if (rubbleGeos.length) {
      const rubbleGeo = mergeGeometries(rubbleGeos, false)!
      const rubbleMat = new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 0.97, metalness: 0.0,
      })
      const rubbleMesh = new THREE.Mesh(rubbleGeo, rubbleMat)
      this.group.add(rubbleMesh)
      this.meshes.push(rubbleMesh)
    }
  }

  dispose() {
    for (const m of this.meshes) {
      m.geometry.dispose()
      ;(m.material as THREE.Material).dispose()
    }
    this.meshes = []
  }
}
