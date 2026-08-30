// ---------------------------------------------------------------
// Seabed — undulating sand terrain with vertex-colored ripples,
// scattered pebbles and shells
// ---------------------------------------------------------------
import * as THREE from 'three'
import { SEABED_Y, fbm2, noise2, rand, mulberry32 } from '../utils/math'
import { sharedUniforms } from '../core/sharedUniforms'

export class Seabed {
  group = new THREE.Group()
  heightAt = (x: number, z: number) => 0

  constructor(scene: THREE.Scene, pebbleCount = 150) {
    this.buildTerrain()
    this.buildPebbles(pebbleCount)
    scene.add(this.group)
  }

  private buildTerrain() {
    const size = 170
    const seg = 110
    const geo = new THREE.PlaneGeometry(size, size, seg, seg)
    geo.rotateX(-Math.PI / 2)
    const pos = geo.attributes.position as THREE.BufferAttribute
    const colors = new Float32Array(pos.count * 3)

    const sandA = new THREE.Color('#c8b58c')
    const sandB = new THREE.Color('#9d8a67')
    const sandDeep = new THREE.Color('#5f6250')

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const z = pos.getZ(i)
      // rolling dunes + fine ripples
      const dune = fbm2(x * 0.022, z * 0.022, 4) * 3.4
      const ripple = Math.sin(x * 0.55 + fbm2(x * 0.06, z * 0.06, 2) * 5.0) * 0.18
      const ripple2 = Math.sin(z * 0.34 + x * 0.1) * 0.12
      const y = SEABED_Y + dune + ripple + ripple2
      pos.setY(i, y)

      // color: sand mixed by noise, darker in the deep distance
      const n = (noise2(x * 0.08, z * 0.08) + 1) * 0.5
      const c = sandA.clone().lerp(sandB, n)
      const depthT = THREE.MathUtils.clamp((-z - 20) / 55, 0, 1)
      c.lerp(sandDeep, depthT * 0.8)
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

    this.heightAt = (x: number, z: number) => {
      const zz = z + 20
      const dune = fbm2(x * 0.022, zz * 0.022, 4) * 3.4
      const ripple = Math.sin(x * 0.55 + fbm2(x * 0.06, zz * 0.06, 2) * 5.0) * 0.18
      return SEABED_Y + dune + ripple + Math.sin(zz * 0.34 + x * 0.1) * 0.12
    }
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
      const x = rand(-60, 60)
      const z = rand(-75, 12)
      if (Math.hypot(x, z + 20) > 80) continue
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
    const shells = new THREE.InstancedMesh(shellGeo, shellMat, 24)
    for (let i = 0; i < 24; i++) {
      const x = rand(-45, 45), z = rand(-55, 8)
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
