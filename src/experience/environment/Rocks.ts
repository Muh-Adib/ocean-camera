// ---------------------------------------------------------------
// Rocks — deformed icosahedron boulders in small/medium/large,
// seeded randomly across zones. Registers obstacle colliders.
// ---------------------------------------------------------------
import * as THREE from 'three'
import { rand, mulberry32, noise2 } from '../utils/math'

export interface Obstacle { x: number; y: number; z: number; r: number }

export class RockSystem {
  group = new THREE.Group()
  obstacles: Obstacle[] = []

  constructor(scene: THREE.Scene, private heightAt: (x: number, z: number) => number, count = 64) {
    this.build(count)
    scene.add(this.group)
  }

  private makeRockGeometry(seed: number, detail = 1) {
    const rng = mulberry32(seed)
    const geo = new THREE.IcosahedronGeometry(1, detail)
    const p = geo.attributes.position as THREE.BufferAttribute
    const v = new THREE.Vector3()
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i)
      const n = noise2(v.x * 1.7 + seed, v.y * 1.7 + v.z * 1.3)
      const n2 = noise2(v.z * 3.1 - seed, v.x * 2.2)
      v.multiplyScalar(1 + n * 0.32 + n2 * 0.12)
      v.y *= 0.78
      p.setXYZ(i, v.x, v.y, v.z)
    }
    geo.computeVertexNormals()
    return geo
  }

  private build(count: number) {
    const rng = mulberry32(777)
    const geo = this.makeRockGeometry(31, 1)
    const mat = new THREE.MeshStandardMaterial({ color: '#5a6b74', roughness: 0.95, metalness: 0.02, flatShading: true })

    const mesh = new THREE.InstancedMesh(geo, mat, count)
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
      if (large && roll < 0.5) { x = rand(-70, 70); z = rand(-78, -52) }        // distant silhouettes
      else if (roll < 0.55) { x = rand(-34, -5); z = rand(-48, -8) }            // rocky reef
      else if (roll < 0.8) { x = rand(-8, 36); z = rand(-52, -4) }              // scattered mid
      else { x = rand(-50, 50); z = rand(-70, 4) }                              // anywhere
      if (Math.abs(x) < 4 && z > -18) continue                                  // keep spawn view clear

      const y = this.heightAt(x, z) + scale * 0.32
      e.set(rng() * 0.5 - 0.25, rng() * Math.PI * 2, rng() * 0.5 - 0.25)
      q.setFromEuler(e)
      s.set(scale * rand(0.8, 1.25), scale * rand(0.7, 1), scale * rand(0.8, 1.25))
      pos.set(x, y, z)
      m.compose(pos, q, s)
      mesh.setMatrixAt(placed, m)

      // darker tint for distant formations
      const shade = large && z < -50 ? 0.35 : rand(0.75, 1.1)
      mesh.setColorAt(placed, new THREE.Color(shade, shade * 1.02, shade * 1.05))

      if (scale > 1.4) {
        this.obstacles.push({ x, y, z, r: scale * 1.05 })
      }
      placed++
    }
    mesh.count = placed
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    this.group.add(mesh)
  }
}
