// ---------------------------------------------------------------
// Bubbles — instanced translucent spheres rising with a wobble.
// CPU-updated (80 instances is cheap) with gesture drift support.
// ---------------------------------------------------------------
import * as THREE from 'three'
import { sharedUniforms } from '../core/sharedUniforms'
import { rand, mulberry32 } from '../utils/math'

interface Bubble {
  pos: THREE.Vector3
  speed: number
  size: number
  wobblePhase: number
  wobbleAmp: number
  alive: boolean
  drift: THREE.Vector3
}

export class BubbleSystem {
  mesh: THREE.InstancedMesh
  private bubbles: Bubble[] = []
  private dummy = new THREE.Object3D()
  private fieldInfluence: { dir: THREE.Vector3; strength: { value: number }; pos: THREE.Vector3; radius: number }

  constructor(scene: THREE.Scene, count = 90, private heightAt: (x: number, z: number) => number, field: { pos: THREE.Vector3; dir: THREE.Vector3; strength: { value: number }; radius: number }) {
    this.fieldInfluence = field
    const geo = new THREE.SphereGeometry(0.5, 10, 8)
    const mat = new THREE.MeshPhysicalMaterial({
      color: '#cfeeff',
      transparent: true,
      opacity: 0.28,
      roughness: 0.05,
      metalness: 0,
      transmission: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.1,
      depthWrite: false,
    })
    this.mesh = new THREE.InstancedMesh(geo, mat, count)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 6

    const rng = mulberry32(555)
    for (let i = 0; i < count; i++) {
      this.bubbles.push(this.spawn(rng, true))
    }
    scene.add(this.mesh)
  }

  private spawn(rng: () => number, anywhere = false): Bubble {
    const x = rand(-62, 62)
    const z = rand(-88, 10)
    const y = anywhere ? rand(-12, 14) : this.heightAt(x, z) + rand(0.2, 1.5)
    return {
      pos: new THREE.Vector3(x, y, z),
      speed: rand(0.7, 2.0),
      size: rand(0.06, 0.3) * (rng() < 0.15 ? 2.2 : 1),
      wobblePhase: rng() * Math.PI * 2,
      wobbleAmp: rand(0.08, 0.3),
      alive: true,
      drift: new THREE.Vector3(),
    }
  }

  update(dt: number, time: number) {
    const f = this.fieldInfluence
    for (let i = 0; i < this.bubbles.length; i++) {
      const b = this.bubbles[i]
      b.pos.y += b.speed * dt
      b.pos.x += Math.sin(time * 1.7 + b.wobblePhase) * b.wobbleAmp * dt
      b.pos.z += Math.cos(time * 1.3 + b.wobblePhase) * b.wobbleAmp * 0.6 * dt

      // gesture field: bubbles get pushed/drift with the current
      const d = b.pos.distanceTo(f.pos)
      const fs = f.strength.value
      if (fs > 0.01 && d < f.radius * 2.4) {
        const infl = (1 - d / (f.radius * 2.4)) * fs
        b.drift.addScaledVector(f.dir, infl * 6 * dt)
      }
      b.drift.multiplyScalar(1 - Math.min(1, dt * 1.4))
      b.pos.addScaledVector(b.drift, dt * 8)

      // pop near the surface, respawn at seabed
      if (b.pos.y > 16.5 || b.pos.x > 46 || b.pos.x < -46 || b.pos.z < -66 || b.pos.z > 8) {
        this.bubbles[i] = this.spawn(Math.random)
        continue
      }

      this.dummy.position.copy(b.pos)
      const s = b.size * (0.9 + Math.sin(time * 3 + b.wobblePhase) * 0.08)
      this.dummy.scale.setScalar(s)
      this.dummy.rotation.set(0, 0, 0)
      this.dummy.updateMatrix()
      this.mesh.setMatrixAt(i, this.dummy.matrix)
    }
    this.mesh.instanceMatrix.needsUpdate = true
  }

  /** dynamic event: a cluster of bubbles rises from a spot */
  burstCluster(x: number, z: number, n = 14) {
    let spawned = 0
    for (const b of this.bubbles) {
      if (spawned >= n) break
      if (b.pos.y < -8) {
        b.pos.set(x + rand(-1.5, 1.5), this.heightAt(x, z) + rand(0.2, 0.8), z + rand(-1.5, 1.5))
        b.speed = rand(1.6, 2.8)
        spawned++
      }
    }
  }
}
