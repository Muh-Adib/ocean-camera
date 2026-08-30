// ---------------------------------------------------------------
// Feeding — scatter food pellets into the water (key G / HUD
// button). Pellets tumble, sink with drag and a lazy swirl, rest
// on the seabed, then dissolve. Fish detect them through the
// Boids feeding steering and race over; the first fish to reach
// a pellet claims it and the pellet shrinks away in a bite.
// ---------------------------------------------------------------
import * as THREE from 'three'
import { mulberry32 } from '../utils/math'

export interface Pellet {
  active: boolean
  claimed: boolean
  pos: THREE.Vector3
  vel: THREE.Vector3
  spin: number
  life: number
}

const MAX_PELLETS = 42

export class Feeding {
  pellets: Pellet[] = []
  private mesh: THREE.InstancedMesh
  private dummy = new THREE.Object3D()
  private rng = mulberry32(20260901)

  constructor(scene: THREE.Scene, private floorAt: (x: number, z: number) => number) {
    const geo = new THREE.IcosahedronGeometry(0.058, 0)
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0.02 })
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX_PELLETS)
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.mesh.frustumCulled = false
    const tint = new THREE.Color()
    for (let i = 0; i < MAX_PELLETS; i++) {
      this.pellets.push({
        active: false, claimed: false,
        pos: new THREE.Vector3(), vel: new THREE.Vector3(),
        spin: 0, life: 0,
      })
      // sandy crumbs with slight variance
      tint.setHSL(0.08 + this.rng() * 0.02, 0.5, 0.4 + this.rng() * 0.13)
      this.mesh.setColorAt(i, tint)
      this.dummy.position.set(0, -999, 0)
      this.dummy.scale.setScalar(0.001)
      this.dummy.updateMatrix()
      this.mesh.setMatrixAt(i, this.dummy.matrix)
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
    scene.add(this.mesh)
  }

  /** drop a burst of pellets around a world point (usually ahead of the camera) */
  drop(origin: THREE.Vector3, count = 11) {
    let spawned = 0
    for (const p of this.pellets) {
      if (spawned >= count) break
      if (p.active) continue
      p.active = true
      p.claimed = false
      p.pos.set(
        origin.x + (this.rng() - 0.5) * 1.9,
        origin.y + (this.rng() - 0.5) * 0.8,
        origin.z + (this.rng() - 0.5) * 1.9,
      )
      p.vel.set((this.rng() - 0.5) * 0.5, -0.2 - this.rng() * 0.35, (this.rng() - 0.5) * 0.5)
      p.spin = this.rng() * Math.PI * 2
      p.life = 15 + this.rng() * 4
      spawned++
    }
  }

  update(dt: number, time: number) {
    for (let i = 0; i < this.pellets.length; i++) {
      const p = this.pellets[i]
      if (!p.active) continue

      p.life -= p.claimed ? dt * 9 : dt
      if (p.life <= 0) {
        p.active = false
        this.dummy.position.set(0, -999, 0)
        this.dummy.scale.setScalar(0.001)
        this.dummy.updateMatrix()
        this.mesh.setMatrixAt(i, this.dummy.matrix)
        continue
      }

      if (!p.claimed) {
        // sink with water drag + lazy swirl
        p.vel.y -= 1.05 * dt
        p.vel.multiplyScalar(1 - Math.min(1, dt * 1.5))
        p.vel.y = Math.max(p.vel.y, -0.85)
        p.pos.addScaledVector(p.vel, dt)
        p.pos.x += Math.sin(time * 1.7 + p.spin) * dt * 0.26
        p.pos.z += Math.cos(time * 1.3 + p.spin * 1.7) * dt * 0.26
        const floor = this.floorAt(p.pos.x, p.pos.z) + 0.16
        if (p.pos.y < floor) {
          p.pos.y = floor
          p.vel.set(0, 0, 0)
        }
      }

      const s = Math.min(1, p.life / 1.1)
      this.dummy.position.copy(p.pos)
      this.dummy.rotation.set(p.spin + time * 0.9, p.spin * 2.1, p.spin * 0.7)
      this.dummy.scale.setScalar(Math.max(0.001, s))
      this.dummy.updateMatrix()
      this.mesh.setMatrixAt(i, this.dummy.matrix)
    }
    this.mesh.instanceMatrix.needsUpdate = true
  }

  dispose() {
    this.mesh.geometry.dispose()
    ;(this.mesh.material as THREE.Material).dispose()
  }
}
