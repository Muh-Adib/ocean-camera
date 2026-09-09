// ---------------------------------------------------------------
// Rocks — noise-sculpted reef boulders (proper high-poly pass):
// three sculpted variants (icosa detail 3 = 1 280 faces each) with
// three displacement octaves (broad lobes / knobby relief / fine
// grain), smooth mineral shading, algae-painted crevices,
// sun-bleached crowns and barnacle speckles. Instanced: 3 draw
// calls total. Registers obstacle colliders.
// ---------------------------------------------------------------
import * as THREE from 'three'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { rand, mulberry32, noise2, fbm2 } from '../utils/math'
import { insideReefFootprint } from './ReefSites'

export interface Obstacle { x: number; y: number; z: number; r: number }

/** weld a displaced non-indexed mesh by position so normals shade smooth */
function weldByPosition(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const bare = new THREE.BufferGeometry()
  bare.setAttribute('position', geo.getAttribute('position'))
  const welded = mergeVertices(bare, 1e-3)
  welded.computeVertexNormals()
  return welded
}

export class RockSystem {
  group = new THREE.Group()
  obstacles: Obstacle[] = []

  constructor(scene: THREE.Scene, private heightAt: (x: number, z: number) => number, count = 64) {
    this.build(count)
    scene.add(this.group)
  }

  /** sculpted boulder: radial multi-octave displacement, smooth normals */
  private makeRockGeometry(seed: number) {
    const geo0 = new THREE.IcosahedronGeometry(1, 4)   // 500 faces, welded → 251 smooth-shaded verts
    const p = geo0.attributes.position as THREE.BufferAttribute
    const v = new THREE.Vector3()
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i)
      const n = v.clone().normalize()
      // three octaves: broad lobes, knobby relief, fine grain
      const d1 = fbm2(n.x * 1.6 + seed, n.y * 1.6 + n.z * 1.4 - seed, 3) * 0.30
      const d2 = noise2(n.x * 4.2 - seed, n.z * 4.2 + n.y * 3.1) * 0.10
      const d3 = noise2(n.x * 9.5 + seed * 2, n.z * 9.5 - n.y * 8.4) * 0.035
      v.multiplyScalar(1 + d1 + d2 + d3)
      v.y *= 0.8
      p.setXYZ(i, v.x, v.y, v.z)
    }
    const geo = weldByPosition(geo0)
    this.paintRock(geo, seed)
    return geo
  }

  /** mineral banding + algae crevices + bleached crown + barnacle speckle */
  private paintRock(geo: THREE.BufferGeometry, seed: number) {
    const p = geo.attributes.position as THREE.BufferAttribute
    const colors = new Float32Array(p.count * 3)
    const c = new THREE.Color()
    const base = new THREE.Color('#6c7a80')
    const algae = new THREE.Color('#3f6b3c')
    const coraline = new THREE.Color('#8a4f72')
    const crown = new THREE.Color('#9aa38f')
    const barnacle = new THREE.Color('#cfc8b4')
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i)
      c.copy(base)
      // mineral banding
      const band = (noise2(x * 2.4 + seed, (y + z) * 2.4) + 1) * 0.5
      c.multiplyScalar(0.76 + band * 0.5)
      // radius (≈1 + displacement) → crevices sit below the mean surface
      const r = Math.sqrt(x * x + y * y + z * z)
      const crevice = THREE.MathUtils.clamp((1.06 - r) * 7, 0, 1)
      const patch = fbm2(x * 1.1 - seed, (y * 0.7 + z) * 1.1 + seed, 3)
      if (patch > 0.05) {
        c.lerp(algae, Math.min(1, (patch - 0.05) * 4.5) * (0.32 + crevice * 0.42))
      }
      // crustose coraline pink on mid-height patches
      const crust = noise2(x * 1.9 - seed * 3, z * 1.9 + y * 1.3)
      if (crust > 0.34) c.lerp(coraline, Math.min(1, (crust - 0.34) * 4) * 0.55)
      // sun-bleached crown
      c.lerp(crown, THREE.MathUtils.clamp(y * 0.9, 0, 0.5) * 0.4)
      // barnacle speckles
      const sp = noise2(x * 22 + seed, z * 22 - y * 18)
      if (sp > 0.62) c.lerp(barnacle, Math.min(1, (sp - 0.62) * 5) * 0.7)
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  }

  private build(count: number) {
    const rng = mulberry32(777)
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.93,
      metalness: 0.02,
    })

    // three sculpted variants share the instances
    const variants = [this.makeRockGeometry(31), this.makeRockGeometry(87), this.makeRockGeometry(141)]
    const meshes = variants.map((g) => {
      const m = new THREE.InstancedMesh(g, mat, Math.ceil(count / 3) + 4)
      m.instanceMatrix.setUsage(THREE.StaticDrawUsage)
      this.group.add(m)
      return m
    })
    const perMesh = new Array(meshes.length).fill(0)

    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const e = new THREE.Euler()
    const s = new THREE.Vector3()
    const pos = new THREE.Vector3()

    let placed = 0
    let guard = 0
    while (placed < count && guard++ < count * 30) {
      const large = rng() < 0.16
      const scale = large ? rand(2.6, 4.6) : rand(0.5, 1.8)
      // zone C rocky reef (left) gets extra density, deep zone gets big distant formations
      let x: number, z: number
      const roll = rng()
      if (large && roll < 0.5) { x = rand(-90, 90); z = rand(-96, -56) }        // distant silhouettes
      else if (roll < 0.55) { x = rand(-40, -5); z = rand(-52, -8) }            // rocky reef
      else if (roll < 0.8) { x = rand(-8, 44); z = rand(-56, -4) }              // scattered mid
      else { x = rand(-66, 66); z = rand(-88, 8) }                              // anywhere
      if (Math.abs(x) < 4 && z > -18) continue                                  // keep spawn view clear
      if (insideReefFootprint(x, z, 1.06)) continue                             // never intersect the reef heads

      const y = this.heightAt(x, z) + scale * 0.3
      e.set(rng() * 0.5 - 0.25, rng() * Math.PI * 2, rng() * 0.5 - 0.25)
      q.setFromEuler(e)
      s.set(scale * rand(0.8, 1.25), scale * rand(0.7, 1), scale * rand(0.8, 1.25))
      pos.set(x, y, z)
      m.compose(pos, q, s)

      const mi = placed % meshes.length
      const mesh = meshes[mi]
      mesh.setMatrixAt(perMesh[mi], m)

      // tint: near-white so the vertex painting reads; distant formations sink into the haze
      const shade = large && z < -50 ? rand(0.42, 0.5) : rand(0.82, 1.08)
      mesh.setColorAt(perMesh[mi], new THREE.Color(shade, shade * 1.01, shade * 1.04))
      perMesh[mi]++

      if (scale > 1.4) {
        this.obstacles.push({ x, y, z, r: scale * 1.05 })
      }
      placed++
    }
    for (let i = 0; i < meshes.length; i++) {
      meshes[i].count = perMesh[i]
      meshes[i].instanceMatrix.needsUpdate = true
      const ic = meshes[i].instanceColor
      if (ic) ic.needsUpdate = true
    }
  }
}
