// ---------------------------------------------------------------
// Seabed — undulating sand terrain with vertex-colored ripples,
// biome-tinted sand, a south-west canyon basin, a northern
// seamount, scattered pebbles and shells
// ---------------------------------------------------------------
import * as THREE from 'three'
import { SEABED_Y, fbm2, noise2, rand, mulberry32 } from '../utils/math'
import { sharedUniforms } from '../core/sharedUniforms'

export class Seabed {
  group = new THREE.Group()
  heightAt = (x: number, z: number) => 0

  constructor(scene: THREE.Scene, pebbleCount = 150) {
    this.buildTerrain()
    this.buildPebbles(Math.round(pebbleCount * 1.7))
    scene.add(this.group)
  }

  /**
   * Terrain height from world coordinates. `n` is the noise-space
   * depth axis (n = worldZ + 20, matching the mesh's local Z).
   * Large-scale features give the open ocean landmarks to navigate by:
   *  • a canyon basin in the south-west (rock arches stand in it)
   *  • a seamount rising toward the northern monoliths
   */
  private terrain(x: number, n: number) {
    const dune = fbm2(x * 0.022, n * 0.022, 4) * 3.4
    const ripple = Math.sin(x * 0.55 + fbm2(x * 0.06, n * 0.06, 2) * 5.0) * 0.18
    const ripple2 = Math.sin(n * 0.34 + x * 0.1) * 0.12
    const canyon = -3.8 * Math.exp(-(((x + 52) ** 2) / 780 + ((n + 26) ** 2) / 640))
    const seamount = 3.2 * Math.exp(-(((x - 10) ** 2) / 640 + ((n + 60) ** 2) / 500))
    return SEABED_Y + dune + ripple + ripple2 + canyon + seamount
  }

  private buildTerrain() {
    const size = 250
    const seg = 140
    const geo = new THREE.PlaneGeometry(size, size, seg, seg)
    geo.rotateX(-Math.PI / 2)
    const pos = geo.attributes.position as THREE.BufferAttribute
    const colors = new Float32Array(pos.count * 3)

    const sandA = new THREE.Color('#c8b58c')
    const sandB = new THREE.Color('#9d8a67')
    const sandDeep = new THREE.Color('#5f6250')
    const kelpSand = new THREE.Color('#8a8a5e')     // olive drift under the kelp forest
    const canyonSand = new THREE.Color('#54523f')   // shadowed canyon floor
    const flatSand = new THREE.Color('#dbc9a0')     // bright shell-rich flats
    const northSand = new THREE.Color('#6a7480')    // cold silty north plain

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const n = pos.getZ(i)          // noise-space depth (worldZ + 20)
      const worldZ = n - 20
      const y = this.terrain(x, n)
      pos.setY(i, y)

      // color: sand mixed by noise, then tinted by biome
      const t = (noise2(x * 0.08, n * 0.08) + 1) * 0.5
      const c = sandA.clone().lerp(sandB, t)
      const depthT = THREE.MathUtils.clamp((-worldZ - 20) / 75, 0, 1)
      c.lerp(sandDeep, depthT * 0.8)

      const kelpT = THREE.MathUtils.clamp((-x - 26) / 22, 0, 1) * THREE.MathUtils.clamp((-worldZ - 26) / 22, 0, 1)
      c.lerp(kelpSand, kelpT * 0.5)
      const flatT = THREE.MathUtils.clamp((x - 24) / 20, 0, 1) * THREE.MathUtils.clamp((worldZ + 34) / 18, 0, 1)
      c.lerp(flatSand, flatT * 0.45)
      const northT = THREE.MathUtils.clamp((-worldZ - 66) / 16, 0, 1)
      c.lerp(northSand, northT * 0.6)
      const cd2 = ((x + 52) ** 2 + (worldZ + 46) ** 2) / 240
      c.lerp(canyonSand, Math.max(0, 1 - cd2) * 0.55)

      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    geo.computeVertexNormals()

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.96,
      metalness: 0,
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.z = -20
    this.group.add(mesh)

    this.heightAt = (x: number, z: number) => this.terrain(x, z + 20)
  }

  private buildPebbles(count: number) {
    const rng = mulberry32(4242)
    const geo = new THREE.IcosahedronGeometry(0.14, 0)
    // deform slightly for organic pebbles
    const p = geo.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < p.count; i++) {
      const s = 0.75 + rng() * 0.5
      p.setXYZ(i, p.getX(i) * s, p.getY(i) * s * 0.7, p.getZ(i) * s)
    }
    geo.computeVertexNormals()

    const mat = new THREE.MeshStandardMaterial({ color: '#8d8471', roughness: 1 })
    const mesh = new THREE.InstancedMesh(geo, mat, count)
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const e = new THREE.Euler()
    const s = new THREE.Vector3()
    const v = new THREE.Vector3()

    let placed = 0
    let guard = 0
    while (placed < count && guard++ < count * 20) {
      const x = rand(-95, 95)
      const z = rand(-100, 16)
      if (Math.hypot(x, z + 20) > 105) continue
      const y = this.heightAt(x, z) + 0.02
      e.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI)
      q.setFromEuler(e)
      const sc = 0.5 + rng() * 2.4
      s.set(sc, sc * (0.6 + rng() * 0.4), sc)
      v.set(x, y, z)
      m.compose(v, q, s)
      mesh.setMatrixAt(placed, m)
      const tint = 0.75 + rng() * 0.5
      mesh.setColorAt(placed, new THREE.Color(tint * 0.55, tint * 0.52, tint * 0.45))
      placed++
    }
    mesh.count = placed
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    this.group.add(mesh)

    // a few scattered shells (thin cones)
    const shellGeo = new THREE.ConeGeometry(0.22, 0.34, 6, 1, true)
    const shellMat = new THREE.MeshStandardMaterial({
      color: '#e8dcc5', roughness: 0.8, side: THREE.DoubleSide,
    })
    const shells = new THREE.InstancedMesh(shellGeo, shellMat, 36)
    for (let i = 0; i < 36; i++) {
      const x = rand(-68, 68), z = rand(-82, 14)
      e.set(rand(-0.5, 0.5), rng() * Math.PI * 2, rand(-0.5, 0.5))
      q.setFromEuler(e)
      const sc = 0.5 + rng() * 0.9
      s.set(sc, sc, sc)
      v.set(x, this.heightAt(x, z) + 0.1, z)
      m.compose(v, q, s)
      shells.setMatrixAt(i, m)
    }
    this.group.add(shells)
    void sharedUniforms
  }
}
