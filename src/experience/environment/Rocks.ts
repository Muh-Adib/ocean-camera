// ---------------------------------------------------------------
// Rocks — noise-sculpted reef boulders (proper high-poly pass):
// smooth-shaded sculpted bodies (welded icosa detail 3) with algae
// crevices, crustose coraline patches, sun-bleached crowns and
// barnacle speckles. Instanced: one draw call. Keeps clear of the
// limestone reef towers. Registers obstacle colliders.
// ---------------------------------------------------------------
import * as THREE from 'three'
import { rand, mulberry32, noise2, fbm2 } from '../utils/math'
import { addDepthSilhouette } from './depthSilhouette'
import { weldSmooth } from './smoothShading'
import { insideReefFootprint } from './ReefSites'

export interface Obstacle { x: number; y: number; z: number; r: number }

export class RockSystem {
  group = new THREE.Group()
  obstacles: Obstacle[] = []

  constructor(scene: THREE.Scene, private heightAt: (x: number, z: number) => number, count = 64) {
    this.build(count)
    scene.add(this.group)
  }

  private makeRockGeometry(seed: number, detail = 3) {
    const geo0 = new THREE.IcosahedronGeometry(1, detail)
    const p = geo0.attributes.position as THREE.BufferAttribute
    const v = new THREE.Vector3()
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i)
      const n = noise2(v.x * 1.7 + seed, v.y * 1.7 + v.z * 1.3)
      const n2 = noise2(v.z * 3.1 - seed, v.x * 2.2)
      const n3 = noise2(v.x * 8.4 + seed * 2, v.z * 8.4 - v.y * 6.2)   // fine grain
      v.multiplyScalar(1 + n * 0.32 + n2 * 0.12 + n3 * 0.045)
      v.y *= 0.78
      p.setXYZ(i, v.x, v.y, v.z)
    }
    const geo = weldSmooth(geo0)                       // weld → smooth normals
    this.paintRock(geo, seed)
    return geo
  }

  /** mineral banding + algae crevices + coraline pink + bleached crown + barnacles */
  private paintRock(geo: THREE.BufferGeometry, seed: number) {
    const p = geo.attributes.position as THREE.BufferAttribute
    const colors = new Float32Array(p.count * 3)
    const c = new THREE.Color()
    const base = new THREE.Color('#5f7a68')
    const algae = new THREE.Color('#3f6b3c')
    const coraline = new THREE.Color('#8a4f72')
    const crown = new THREE.Color('#9aa38f')
    const barnacle = new THREE.Color('#cfc8b4')
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i)
      c.copy(base)
      const band = (noise2(x * 2.4 + seed, (y + z) * 2.4) + 1) * 0.5
      c.multiplyScalar(0.78 + band * 0.5)
      // crevices sit below the mean surface radius
      const r = Math.sqrt(x * x + y * y + z * z)
      const crev = THREE.MathUtils.clamp((1.06 - r) * 7, 0, 1)
      const patch = fbm2(x * 1.1 - seed, (y * 0.7 + z) * 1.1 + seed, 3)
      if (patch > 0.05) c.lerp(algae, Math.min(1, (patch - 0.05) * 4.5) * (0.32 + crev * 0.42))
      const crust = noise2(x * 1.9 - seed * 3, z * 1.9 + y * 1.3)
      if (crust > 0.34) c.lerp(coraline, Math.min(1, (crust - 0.34) * 4) * 0.5)
      c.lerp(crown, THREE.MathUtils.clamp(y * 0.9, 0, 0.5) * 0.38)
      const sp = noise2(x * 22 + seed, z * 22 - y * 18)
      if (sp > 0.62) c.lerp(barnacle, Math.min(1, (sp - 0.62) * 5) * 0.7)
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  }

  private build(count: number) {
    const rng = mulberry32(777)
    const geo = this.makeRockGeometry(31, 3)
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0.02 })
    addDepthSilhouette(mat, { start: 42, end: 105, k: 0.8, color: '#0d4266' }, 'rocks-sil')

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
      if (large && roll < 0.5) { x = rand(-90, 90); z = rand(-96, -56) }        // distant silhouettes
      else if (roll < 0.55) { x = rand(-40, -5); z = rand(-52, -8) }            // rocky reef
      else if (roll < 0.8) { x = rand(-8, 44); z = rand(-56, -4) }              // scattered mid
      else { x = rand(-66, 66); z = rand(-88, 8) }                              // anywhere
      if (Math.abs(x) < 4 && z > -18) continue                                  // keep spawn view clear
      if (insideReefFootprint(x, z, 1.1)) continue                              // never pierce the limestone towers

      const y = this.heightAt(x, z) + scale * 0.32
      e.set(rng() * 0.5 - 0.25, rng() * Math.PI * 2, rng() * 0.5 - 0.25)
      q.setFromEuler(e)
      s.set(scale * rand(0.8, 1.25), scale * rand(0.7, 1), scale * rand(0.8, 1.25))
      pos.set(x, y, z)
      m.compose(pos, q, s)
      mesh.setMatrixAt(placed, m)

      // tint near-white so the vertex painting reads; distant formations sink into the haze
      const shade = large && z < -50 ? 0.42 : rand(0.82, 1.08)
      mesh.setColorAt(placed, new THREE.Color(shade, shade * 1.01, shade * 1.04))

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
