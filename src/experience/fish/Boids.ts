// ---------------------------------------------------------------
// Boids — lightweight flocking simulation: separation, alignment,
// cohesion, wander, obstacle & boundary avoidance, gesture force,
// species behaviours (homebound clownfish, curious pufferfish).
// Movement is always integrated through acceleration → velocity →
// position with damping; fish never teleport.
// ---------------------------------------------------------------
import * as THREE from 'three'
import { BOUNDS, clamp, rand } from '../utils/math'
import type { Obstacle } from '../environment/Rocks'

export interface FieldCtx {
  active: boolean
  point: THREE.Vector3
  dir: THREE.Vector3
  strength: number          // 0..1
  radius: number
  mode: 'current' | 'push' | 'pull' | 'attract' | 'repel'
  caution: number           // 0..1 (closed fist nearby)
  curiosity: number         // 0..1 (open palm nearby)
  scatter: number           // 0..1 push boost
}

export interface SchoolParams {
  maxSpeed: number
  maxForce: number
  sepW: number
  aliW: number
  cohW: number
  wanderW: number
  separationR: number
  perceptionR: number
  homeStrength: number      // >0 → bound to home anchor (clownfish)
  homeRadius: number
  curiosity: number         // >0 → occasionally approaches camera
}

export interface FishState {
  pos: THREE.Vector3
  vel: THREE.Vector3
  acc: THREE.Vector3
  phase: number
  scale: number
  tint: THREE.Color
  wanderSeed: number
  speedNorm: number         // recent speed / maxSpeed (drives tail beat)
  braveTimer: number
}

// scratch vectors (module-level, no allocation in hot loop)
const _sep = new THREE.Vector3()
const _ali = new THREE.Vector3()
const _coh = new THREE.Vector3()
const _tmp = new THREE.Vector3()
const _steer = new THREE.Vector3()

export class School {
  fish: FishState[] = []
  params: SchoolParams
  anchor: THREE.Vector3
  speciesResponse: number   // per-species gesture sensitivity

  constructor(
    public species: string,
    count: number,
    anchor: THREE.Vector3,
    spawnRadius: number,
    params: SchoolParams,
    scaleRange: [number, number],
    tints: string[],
    speciesResponse = 1,
  ) {
    this.params = params
    this.anchor = anchor.clone()
    this.speciesResponse = speciesResponse
    for (let i = 0; i < count; i++) {
      const pos = anchor.clone().add(new THREE.Vector3(
        rand(-spawnRadius, spawnRadius),
        rand(-spawnRadius, spawnRadius) * 0.5,
        rand(-spawnRadius, spawnRadius),
      ))
      pos.y = clamp(pos.y, BOUNDS.minY + 1, BOUNDS.maxY - 2)
      pos.z = clamp(pos.z, BOUNDS.minZ + 2, BOUNDS.maxZ - 1)
      this.fish.push({
        pos,
        vel: new THREE.Vector3(rand(-1, 1), rand(-0.2, 0.2), rand(-1, 1)).normalize().multiplyScalar(params.maxSpeed * 0.5),
        acc: new THREE.Vector3(),
        phase: rand(0, Math.PI * 2),
        scale: rand(scaleRange[0], scaleRange[1]),
        tint: new THREE.Color(tints[i % tints.length]),
        wanderSeed: rand(0, 100),
        speedNorm: 0.5,
        braveTimer: 0,
      })
    }
  }

  /** ecosystem event: sudden direction change */
  impulse(dir: THREE.Vector3, strength = 1) {
    for (const f of this.fish) {
      f.vel.addScaledVector(dir, this.params.maxSpeed * 0.6 * strength * rand(0.7, 1.2))
    }
  }

  update(dt: number, time: number, field: FieldCtx, obstacles: Obstacle[], camera: THREE.Vector3, speedScale = 1) {
    const p = this.params
    const fish = this.fish
    const n = fish.length
    const maxSpeed = p.maxSpeed * speedScale
    const scatterBoost = 1 + field.scatter * 1.1

    for (let i = 0; i < n; i++) {
      const f = fish[i]
      f.acc.set(0, 0, 0)
      _sep.set(0, 0, 0); _ali.set(0, 0, 0); _coh.set(0, 0, 0)
      let sepCount = 0, neiCount = 0

      // ---- flocking within school ----
      for (let j = 0; j < n; j++) {
        if (i === j) continue
        const o = fish[j]
        const dx = f.pos.x - o.pos.x
        const dy = f.pos.y - o.pos.y
        const dz = f.pos.z - o.pos.z
        const d2 = dx * dx + dy * dy + dz * dz
        if (d2 < p.separationR * p.separationR && d2 > 1e-6) {
          const inv = 1 / d2
          _sep.x += dx * inv; _sep.y += dy * inv; _sep.z += dz * inv
          sepCount++
        }
        if (d2 < p.perceptionR * p.perceptionR) {
          _ali.add(o.vel)
          _coh.add(o.pos)
          neiCount++
        }
      }

      // separation: steer away from crowded neighbours
      if (sepCount > 0) {
        _tmp.copy(_sep).multiplyScalar(1 / sepCount)
        if (_tmp.lengthSq() > 1e-8) {
          _tmp.setLength(maxSpeed).sub(f.vel)
          this.limit(_tmp, p.maxForce * 1.6)
          f.acc.addScaledVector(_tmp, p.sepW)
        }
      }

      // alignment + cohesion
      if (neiCount > 0) {
        _ali.multiplyScalar(1 / neiCount)
        if (_ali.lengthSq() > 1e-8) {
          _ali.setLength(maxSpeed).sub(f.vel)
          this.limit(_ali, p.maxForce)
          f.acc.addScaledVector(_ali, p.aliW)
        }
        _coh.multiplyScalar(1 / neiCount).sub(f.pos)
        if (_coh.lengthSq() > 1e-8) {
          _coh.setLength(maxSpeed * 0.65).sub(f.vel)
          this.limit(_coh, p.maxForce)
          f.acc.addScaledVector(_coh, p.cohW * (1 + field.caution * 1.3))
        }
      }

      // ---- wander ----
      f.acc.x += Math.sin(time * 0.6 + f.wanderSeed) * p.wanderW
      f.acc.y += Math.sin(time * 0.83 + f.wanderSeed * 2.1) * p.wanderW * 0.4
      f.acc.z += Math.cos(time * 0.55 + f.wanderSeed * 3.3) * p.wanderW

      // ---- home bound (clownfish near anemones) ----
      if (p.homeStrength > 0) {
        const dh = f.pos.distanceTo(this.anchor)
        if (dh > p.homeRadius * 0.45) {
          _tmp.subVectors(this.anchor, f.pos)
          const spring = clamp(dh / p.homeRadius, 0, 3)
          f.acc.addScaledVector(_tmp.normalize(), p.homeStrength * spring)
        }
      }

      // ---- curious pufferfish: occasionally drift toward camera ----
      if (p.curiosity > 0) {
        f.braveTimer -= dt
        if (f.braveTimer < -14 && Math.random() < 0.0025) f.braveTimer = rand(4, 7)
        if (f.braveTimer > 0) {
          _tmp.set(camera.x, camera.y - 1.4, camera.z - 3.2).sub(f.pos)
          const dc = _tmp.length()
          if (dc > 3.6) f.acc.addScaledVector(_tmp.normalize(), p.curiosity)
          else f.braveTimer = Math.min(f.braveTimer, 0.4)
        }
      }

      // ---- obstacle avoidance ----
      for (let k = 0; k < obstacles.length; k++) {
        const ob = obstacles[k]
        const dx = f.pos.x - ob.x, dy = f.pos.y - ob.y, dz = f.pos.z - ob.z
        const d2 = dx * dx + dy * dy + dz * dz
        const rr = ob.r + 1.7
        if (d2 < rr * rr && d2 > 1e-6) {
          const d = Math.sqrt(d2)
          const w = (1 - d / rr) * 10
          f.acc.x += (dx / d) * w
          f.acc.y += (dy / d) * w
          f.acc.z += (dz / d) * w
        }
      }

      // ---- boundary avoidance (soft) ----
      const margin = 5
      if (f.pos.x < BOUNDS.minX + margin) f.acc.x += (BOUNDS.minX + margin - f.pos.x) * 1.5
      if (f.pos.x > BOUNDS.maxX - margin) f.acc.x -= (f.pos.x - (BOUNDS.maxX - margin)) * 1.5
      if (f.pos.y < BOUNDS.minY + 2.2) f.acc.y += (BOUNDS.minY + 2.2 - f.pos.y) * 2.4
      if (f.pos.y > BOUNDS.maxY - margin) f.acc.y -= (f.pos.y - (BOUNDS.maxY - margin)) * 2.0
      if (f.pos.z < BOUNDS.minZ + margin) f.acc.z += (BOUNDS.minZ + margin - f.pos.z) * 1.1
      if (f.pos.z > BOUNDS.maxZ - 1.5) f.acc.z -= (f.pos.z - (BOUNDS.maxZ - 1.5)) * 2.6

      // ---- gesture force field (localized influence) ----
      if (field.active && field.strength > 0.003) {
        const d = f.pos.distanceTo(field.point)
        const reach = field.radius * 2.1
        if (d < reach) {
          const t = 1 - d / reach
          const w = t * t * field.strength * this.speciesResponse
          f.acc.addScaledVector(field.dir, w * 15)
          if (field.mode === 'push' || field.mode === 'repel') {
            _tmp.subVectors(f.pos, field.point).normalize()
            f.acc.addScaledVector(_tmp, w * (field.mode === 'push' ? 26 : 14))
          } else if (field.mode === 'attract') {
            _tmp.subVectors(field.point, f.pos).normalize()
            f.acc.addScaledVector(_tmp, w * 16 * (1 + field.curiosity))
          }
          // 'pull' → calm recovery handled by extra damping below
        }
      }

      // ---- integrate ----
      f.vel.addScaledVector(f.acc, dt)
      f.vel.multiplyScalar(1 - Math.min(1, dt * (field.mode === 'pull' ? 1.2 : 0.35)))
      const sp = f.vel.length()
      const maxSp = maxSpeed * scatterBoost * (1 + field.strength * 0.35)
      if (sp > maxSp) f.vel.multiplyScalar(maxSp / sp)
      if (sp < maxSpeed * 0.22 && sp > 1e-5) f.vel.multiplyScalar((maxSpeed * 0.22) / sp)
      f.pos.addScaledVector(f.vel, dt)
      f.speedNorm += ((sp / Math.max(0.001, maxSpeed)) - f.speedNorm) * Math.min(1, dt * 4)
      f.phase += dt * (2.5 + f.speedNorm * 7)
    }
  }

  private limit(v: THREE.Vector3, max: number) {
    const l = v.length()
    if (l > max && l > 1e-8) v.multiplyScalar(max / l)
  }
}

// keep _steer referenced (reserved for future steering behaviours)
void _steer
