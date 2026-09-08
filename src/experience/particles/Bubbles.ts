// ---------------------------------------------------------------
// Bubbles — instanced translucent spheres rising with a wobble.
// CPU-updated with gesture drift support. Two populations:
//   • ambient bubbles spawning across the seabed
//   • EMITTER bubbles trickling continuously out of sponge
//     oscula (registered via addEmitter) — each emitter owns a
//     small slot ring; a popped bubble respawns at its emitter.
// ---------------------------------------------------------------
import * as THREE from 'three'
import { sharedUniforms } from '../core/sharedUniforms'
import { rand, mulberry32 } from '../utils/math'

interface SpongeEmitter {
  pos: THREE.Vector3
  rate: number
  size: number
  speed: number
  acc: number
}

interface Bubble {
  pos: THREE.Vector3
  speed: number
  size: number
  wobblePhase: number
  wobbleAmp: number
  alive: boolean
  drift: THREE.Vector3
  /** 'ambient' or the emitter index this bubble belongs to */
  src: 'ambient' | number
}

/** bubbles reserved per registered emitter */
const SLOTS_PER_EMITTER = 6

export class BubbleSystem {
  mesh: THREE.InstancedMesh
  private bubbles: Bubble[] = []
  private emitters: SpongeEmitter[] = []
  private ambientCount: number
  private dummy = new THREE.Object3D()
  private fieldInfluence: { dir: THREE.Vector3; strength: { value: number }; pos: THREE.Vector3; radius: number }
  private zero = new THREE.Matrix4().makeScale(0, 0, 0)

  constructor(scene: THREE.Scene, count = 90, private heightAt: (x: number, z: number) => number, field: { pos: THREE.Vector3; dir: THREE.Vector3; strength: { value: number }; radius: number }) {
    this.fieldInfluence = field
    this.ambientCount = count
    // headroom so addEmitter() can claim slots without rebuilding the mesh
    const capacity = count + 120
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
    this.mesh = new THREE.InstancedMesh(geo, mat, capacity)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 6

    const rng = mulberry32(555)
    for (let i = 0; i < capacity; i++) {
      if (i < count) {
        this.bubbles.push(this.spawnAmbient(rng, true))
      } else {
        // unclaimed emitter slots: invisible until an emitter claims them
        this.bubbles.push({ ...this.spawnAmbient(rng, false), alive: false, src: 'ambient' })
        this.mesh.setMatrixAt(i, this.zero)
      }
    }
    scene.add(this.mesh)
  }

  /** register a sponge osculum / vent as a continuous bubble source */
  addEmitter(pos: THREE.Vector3, opts: { rate?: number; size?: number; speed?: number } = {}) {
    const index = this.emitters.length
    if (index * SLOTS_PER_EMITTER >= 120) return          // headroom guard
    this.emitters.push({
      pos: pos.clone(),
      rate: opts.rate ?? 1,
      size: opts.size ?? 0.1,
      speed: opts.speed ?? 1,
      acc: Math.random(),
    })
    // claim SLOTS_PER_EMITTER pool slots for this emitter
    let claimed = 0
    for (let i = this.ambientCount; i < this.bubbles.length && claimed < SLOTS_PER_EMITTER; i++) {
      const b = this.bubbles[i]
      if (b.src === 'ambient' && !b.alive) {
        b.src = index
        b.alive = false
        b.size = this.emitters[index].size * rand(0.7, 1.5)
        claimed++
      }
    }
  }

  private spawnAmbient(rng: () => number, anywhere = false): Bubble {
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
      src: 'ambient',
    }
  }

  private spawnFromEmitter(b: Bubble, e: SpongeEmitter) {
    b.pos.set(
      e.pos.x + rand(-0.05, 0.05),
      e.pos.y + rand(0, 0.1),
      e.pos.z + rand(-0.05, 0.05),
    )
    b.speed = e.speed * rand(0.85, 1.3)
    b.size = e.size * rand(0.6, 1.6)
    b.wobblePhase = Math.random() * Math.PI * 2
    b.wobbleAmp = rand(0.04, 0.14)
    b.alive = true
    b.drift.set(0, 0, 0)
  }

  update(dt: number, time: number) {
    const f = this.fieldInfluence

    // emitter credits — each osculum releases bubbles at its own cadence
    for (const e of this.emitters) {
      e.acc += e.rate * dt
    }
    for (let i = 0; i < this.bubbles.length; i++) {
      const b = this.bubbles[i]

      if (typeof b.src === 'number') {
        const e = this.emitters[b.src]
        if (!e) continue
        // emitter slots respawn at their mouth after popping
        if (!b.alive) {
          if (e.acc >= 1) {
            e.acc -= 1
            this.spawnFromEmitter(b, e)
          } else {
            this.mesh.setMatrixAt(i, this.zero)
            continue
          }
        }
      }

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

      // pop near the surface / out of bounds
      if (b.pos.y > 16.5 || b.pos.x > 46 || b.pos.x < -46 || b.pos.z < -66 || b.pos.z > 8) {
        if (b.src === 'ambient') {
          this.bubbles[i] = this.spawnAmbient(Math.random)
        } else {
          b.alive = false
          this.mesh.setMatrixAt(i, this.zero)
        }
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
      if (b.src === 'ambient' && b.pos.y < -8) {
        b.pos.set(x + rand(-1.5, 1.5), this.heightAt(x, z) + rand(0.2, 0.8), z + rand(-1.5, 1.5))
        b.speed = rand(1.6, 2.8)
        spawned++
      }
    }
  }
}
