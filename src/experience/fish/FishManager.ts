// ---------------------------------------------------------------
// FishManager — owns all schools, one InstancedMesh per school
// (species × colour morph). Updates boids then writes instance
// matrices: position + velocity orientation + per-fish tail phase.
// ---------------------------------------------------------------
import * as THREE from 'three'
import { School, type FieldCtx, type SchoolParams } from './Boids'
import { buildFish, makeFishMaterial, updateFishMaterialTime, SPECIES_TINTS, type SpeciesKey } from './FishGeometryFactory'
import type { Obstacle } from '../environment/Rocks'
import type { Pellet } from './Feeding'
import { BOUNDS, rand } from '../utils/math'
import type { QualityConfig } from '../core/PerformanceManager'

interface SchoolDef {
  species: SpeciesKey
  morph: number
  count: number
  anchor: [number, number, number]
  spawnRadius: number
  params: Partial<SchoolParams>
  scale: [number, number]
  response?: number
}

const BASE: SchoolParams = {
  maxSpeed: 3.0, maxForce: 8,
  sepW: 1.5, aliW: 0.9, cohW: 0.75, wanderW: 2.2,
  separationR: 1.4, perceptionR: 3.4,
  homeStrength: 0, homeRadius: 6, curiosity: 0,
}

const SCHOOL_DEFS: SchoolDef[] = [
  // Zone A — open water: lively tropical schools (two near the camera)
  { species: 'tropical', morph: 0, count: 18, anchor: [-5, 1.5, -16], spawnRadius: 3.5, params: { maxSpeed: 3.6, perceptionR: 3.6 }, scale: [0.7, 1.05], response: 1.15 },
  { species: 'tropical', morph: 1, count: 16, anchor: [7, 3, -24], spawnRadius: 4, params: { maxSpeed: 3.4 }, scale: [0.65, 1.0], response: 1.15 },
  { species: 'tropical', morph: 2, count: 14, anchor: [0, 6, -40], spawnRadius: 5, params: { maxSpeed: 3.8 }, scale: [0.6, 0.95], response: 1.2 },
  { species: 'tropical', morph: 3, count: 12, anchor: [-16, 4.5, -15], spawnRadius: 4, params: { maxSpeed: 3.2 }, scale: [0.65, 1.0], response: 1.1 },
  // Zone B — coral garden residents
  { species: 'clownfish', morph: 0, count: 5, anchor: [10, -10.8, -14], spawnRadius: 1.2, params: { maxSpeed: 2.4, homeStrength: 6, homeRadius: 5, wanderW: 3.2 }, scale: [0.9, 1.15], response: 0.9 },
  { species: 'clownfish', morph: 0, count: 5, anchor: [-13, -11.0, -11], spawnRadius: 1.2, params: { maxSpeed: 2.3, homeStrength: 6, homeRadius: 5, wanderW: 3.2 }, scale: [0.85, 1.1], response: 0.9 },
  { species: 'butterflyfish', morph: 0, count: 9, anchor: [17, -2.5, -26], spawnRadius: 5, params: { maxSpeed: 1.9, cohW: 0.3, aliW: 0.25, wanderW: 3.0 }, scale: [0.95, 1.25], response: 0.8 },
  { species: 'angelfish', morph: 0, count: 4, anchor: [22, 0.5, -20], spawnRadius: 3.5, params: { maxSpeed: 1.6, cohW: 0.5, wanderW: 1.6 }, scale: [1.15, 1.45], response: 0.7 },
  { species: 'angelfish', morph: 0, count: 4, anchor: [-8, 2, -34], spawnRadius: 4, params: { maxSpeed: 1.5, cohW: 0.5, wanderW: 1.6 }, scale: [1.1, 1.4], response: 0.7 },
  // Zone C — rocky reef cruisers
  { species: 'tang', morph: 0, count: 13, anchor: [-20, 0.5, -24], spawnRadius: 5, params: { maxSpeed: 2.2, cohW: 0.9 }, scale: [1.2, 1.6], response: 0.85 },
  { species: 'tang', morph: 0, count: 9, anchor: [14, 6, -48], spawnRadius: 6, params: { maxSpeed: 2.0, cohW: 0.9 }, scale: [1.1, 1.5], response: 0.8 },
  // Moorish idols — striking band-painted drifters along the rocks
  { species: 'moorish', morph: 0, count: 5, anchor: [-24, 3.5, -30], spawnRadius: 4.5, params: { maxSpeed: 1.9, cohW: 0.55, wanderW: 2.0 }, scale: [1.15, 1.45], response: 0.85 },
  { species: 'moorish', morph: 1, count: 3, anchor: [19, -4, -34], spawnRadius: 4, params: { maxSpeed: 1.8, cohW: 0.55, wanderW: 2.0 }, scale: [1.1, 1.35], response: 0.85 },
  // squirrelfish — big-eyed red shelterers hugging the boulder shadows
  { species: 'squirrel', morph: 0, count: 8, anchor: [-21, -7.5, -20], spawnRadius: 3.5, params: { maxSpeed: 1.5, homeStrength: 1.2, homeRadius: 7, cohW: 0.4, aliW: 0.35, wanderW: 3.0 }, scale: [1.0, 1.25], response: 0.75 },
  // bait ball — a dense silver swarm flashing through open water
  { species: 'minnow', morph: 0, count: 90, anchor: [-2, 5.5, -32], spawnRadius: 5, params: { maxSpeed: 4.4, maxForce: 12, sepW: 1.3, aliW: 2.8, cohW: 1.7, wanderW: 1.5, separationR: 0.65, perceptionR: 2.8 }, scale: [0.42, 0.58], response: 1.4 },
  // curious wanderers
  { species: 'pufferfish', morph: 0, count: 4, anchor: [2, -1.5, -12], spawnRadius: 4, params: { maxSpeed: 1.15, cohW: 0.15, aliW: 0.1, wanderW: 2.6, curiosity: 2.2 }, scale: [1.0, 1.25], response: 1.3 },
  // ikan patin — silver catfish gliding in mid-water formation
  { species: 'patin', morph: 0, count: 9, anchor: [-9, 2.5, -27], spawnRadius: 5.5, params: { maxSpeed: 2.1, cohW: 1.1, aliW: 1.0, wanderW: 2.0 }, scale: [1.3, 1.7], response: 0.95 },
  { species: 'patin', morph: 0, count: 6, anchor: [30, 3.5, -52], spawnRadius: 5, params: { maxSpeed: 2.0, cohW: 1.1, aliW: 1.0, wanderW: 2.1 }, scale: [1.2, 1.55], response: 0.95 },
  // Zone D — kelp forest (north-west): tang weaving through the fronds
  { species: 'tang', morph: 0, count: 10, anchor: [-42, -1, -48], spawnRadius: 6, params: { maxSpeed: 2.1, cohW: 0.9 }, scale: [1.15, 1.5], response: 0.85 },
  // second bait ball — silver flashes inside the kelp shadows
  { species: 'minnow', morph: 0, count: 55, anchor: [-48, 4, -56], spawnRadius: 6, params: { maxSpeed: 4.2, maxForce: 12, sepW: 1.3, aliW: 2.6, cohW: 1.6, wanderW: 1.6, separationR: 0.65, perceptionR: 2.8 }, scale: [0.42, 0.58], response: 1.35 },
  // Zone E — sand flats (south-east): cruisers over the open plain
  { species: 'tropical', morph: 2, count: 12, anchor: [36, -2, -18], spawnRadius: 5, params: { maxSpeed: 3.4 }, scale: [0.6, 0.95], response: 1.15 },
  { species: 'squirrel', morph: 0, count: 6, anchor: [42, -8.5, -27], spawnRadius: 3.5, params: { maxSpeed: 1.5, homeStrength: 1.2, homeRadius: 7, cohW: 0.4, wanderW: 3.0 }, scale: [1.0, 1.25], response: 0.75 },
  // Zone F — boulder canyon (south-west): band-painted drifters
  { species: 'moorish', morph: 0, count: 4, anchor: [-46, -5, -40], spawnRadius: 4, params: { maxSpeed: 1.8, cohW: 0.55, wanderW: 2.0 }, scale: [1.1, 1.4], response: 0.85 },
  { species: 'butterflyfish', morph: 0, count: 7, anchor: [-53, -8, -47], spawnRadius: 4, params: { maxSpeed: 1.9, cohW: 0.3, wanderW: 3.0 }, scale: [0.9, 1.2], response: 0.8 },
  // Zone G — the northern spires
  { species: 'angelfish', morph: 0, count: 4, anchor: [12, 2, -72], spawnRadius: 4, params: { maxSpeed: 1.5, cohW: 0.5, wanderW: 1.6 }, scale: [1.1, 1.4], response: 0.7 },
  { species: 'pufferfish', morph: 0, count: 3, anchor: [-14, -0.5, -58], spawnRadius: 4, params: { maxSpeed: 1.15, cohW: 0.15, wanderW: 2.6, curiosity: 2.2 }, scale: [1.0, 1.2], response: 1.3 },
]

interface Entry {
  school: School
  mesh: THREE.InstancedMesh
  phaseAttr: THREE.InstancedBufferAttribute
  puffAttr: THREE.InstancedBufferAttribute | null
  dummy: THREE.Object3D
}

export class FishManager {
  group = new THREE.Group()
  schools: School[] = []
  private entries: Entry[] = []
  private mats: THREE.MeshStandardMaterial[] = []
  private obstacles: Obstacle[]
  private speedScale = 1

  constructor(scene: THREE.Scene, obstacles: Obstacle[], quality: QualityConfig, anemones: THREE.Vector3[]) {
    this.obstacles = obstacles
    const scale = quality.fishScale

    for (const def of SCHOOL_DEFS) {
      const count = Math.max(2, Math.round(def.count * (def.species === 'clownfish' ? Math.max(0.6, scale) : scale)))
      // snap clownfish anchors to actual anemone positions
      let anchor = new THREE.Vector3(...def.anchor)
      if (def.species === 'clownfish' && anemones.length) {
        const best = anemones
          .map((a) => ({ a, d: a.distanceToSquared(anchor) }))
          .sort((x, y) => x.d - y.d)[0]
        if (best) anchor = best.a.clone().add(new THREE.Vector3(0, 1.1, 0))
      }

      const school = new School(
        def.species, count, anchor, def.spawnRadius,
        { ...BASE, ...def.params }, def.scale,
        SPECIES_TINTS[def.species][def.morph % SPECIES_TINTS[def.species].length],
        def.response ?? 1,
      )
      this.schools.push(school)

      const { geometry, texture } = buildFish(def.species)
      const isPuffer = def.species === 'pufferfish'
      const swim = def.species === 'tropical' || def.species === 'minnow' ? 0.09 : isPuffer ? 0.05 : def.species === 'patin' ? 0.08 : 0.075
      const freq = def.species === 'minnow' ? 11 : def.species === 'tropical' ? 9 : isPuffer ? 6 : def.species === 'patin' ? 6.5 : 7
      const mat = makeFishMaterial(texture, swim, freq, `fish-${def.species}`, { puff: isPuffer })
      this.mats.push(mat)

      const phaseAttr = new THREE.InstancedBufferAttribute(new Float32Array(count), 1)
      phaseAttr.setUsage(THREE.DynamicDrawUsage)
      geometry.setAttribute('aPhase', phaseAttr)

      // pufferfish defence display — per-instance inflation 0..1
      let puffAttr: THREE.InstancedBufferAttribute | null = null
      if (isPuffer) {
        puffAttr = new THREE.InstancedBufferAttribute(new Float32Array(count), 1)
        puffAttr.setUsage(THREE.DynamicDrawUsage)
        geometry.setAttribute('aPuff', puffAttr)
      }

      const mesh = new THREE.InstancedMesh(geometry, mat, count)
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      mesh.frustumCulled = false
      // per-instance tints
      for (let i = 0; i < count; i++) mesh.setColorAt(i, school.fish[i].tint)
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true

      this.group.add(mesh)
      this.entries.push({ school, mesh, phaseAttr, puffAttr, dummy: new THREE.Object3D() })
    }

    scene.add(this.group)
  }

  update(dt: number, time: number, field: FieldCtx, pellets?: Pellet[], threats?: THREE.Vector3[]) {
    for (const e of this.entries) {
      e.school.update(dt, time, field, this.obstacles, this.cameraWorld, this.speedScale, pellets, threats)
    }
    // write matrices
    const camDir = new THREE.Vector3()
    for (const e of this.entries) {
      const { school, mesh, phaseAttr, puffAttr, dummy } = e
      for (let i = 0; i < school.fish.length; i++) {
        const f = school.fish[i]
        dummy.position.copy(f.pos)
        // orient nose (+Z) along velocity, gently banked
        if (f.vel.lengthSq() > 1e-6) {
          camDir.copy(f.pos).add(f.vel)
          dummy.lookAt(camDir)
          dummy.rotateZ(Math.sin(time * 0.7 + f.wanderSeed) * 0.08)
        }
        dummy.scale.setScalar(f.scale * (1 + f.puff * 0.22))   // puffed puffers swell
        dummy.updateMatrix()
        mesh.setMatrixAt(i, dummy.matrix)
        phaseAttr.setX(i, f.phase)
        if (puffAttr) puffAttr.setX(i, f.puff)
      }
      mesh.instanceMatrix.needsUpdate = true
      phaseAttr.needsUpdate = true
      if (puffAttr) puffAttr.needsUpdate = true
    }
    // swim shader time
    for (const m of this.mats) updateFishMaterialTime(m, time)
  }

  /** camera world position is injected by main each frame */
  cameraWorld = new THREE.Vector3(0, 2.5, 21)

  setSpeedScale(s: number) { this.speedScale = s }

  /** ecosystem event: random school changes direction */
  randomImpulse() {
    const s = this.schools[Math.floor(Math.random() * this.schools.length)]
    s.impulse(new THREE.Vector3(rand(-1, 1), rand(-0.2, 0.2), rand(-1, 1)).normalize(), 1)
  }

  /** scatter all fish outward from a point (push gesture) */
  scatterFrom(point: THREE.Vector3, strength: number) {
    for (const s of this.schools) {
      for (const f of s.fish) {
        const d = f.pos.distanceTo(point)
        if (d < 14) {
          const w = (1 - d / 14) * strength
          f.vel.addScaledVector(f.vel.clone().sub(point).normalize(), w * 4)
        }
      }
    }
  }

  count(): number {
    return this.schools.reduce((a, s) => a + s.fish.length, 0)
  }

  /** nearest fish position to a point (used by curiosity feedback) */
  nearest(point: THREE.Vector3): THREE.Vector3 | null {
    let best: THREE.Vector3 | null = null
    let bd = Infinity
    for (const s of this.schools) {
      for (const f of s.fish) {
        const d = f.pos.distanceToSquared(point)
        if (d < bd) { bd = d; best = f.pos }
      }
    }
    return best
  }

  dispose() {
    for (const e of this.entries) {
      e.mesh.geometry.dispose()
      ;(e.mesh.material as THREE.Material).dispose()
    }
    void BOUNDS
  }
}
