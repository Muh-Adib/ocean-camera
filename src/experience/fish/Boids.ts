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
import type { Pellet } from './Feeding'

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
  // second hand (local two-hand or the phone remote) — same semantics
  active2: boolean
  point2: THREE.Vector3
  dir2: THREE.Vector3
  strength2: number
  mode2: 'current' | 'push' | 'pull' | 'attract' | 'repel'
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
  puff: number              // 0..1 pufferfish defence display (spines out)
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
        puff: 0,
      })
    }
  }

  /** ecosystem event: sudden direction change */
  impulse(dir: THREE.Vector3, strength = 1) {
    for (const f of this.fish) {
      f.vel.addScaledVector(dir, this.params.maxSpeed * 0.6 * strength * rand(0.7, 1.2))
    }
  }

  update(dt: number, time: number, field: FieldCtx, obstacles: Obstacle[], camera: THREE.Vector3, speedScale = 1, pellets?: Pellet[], threats?: THREE.Vector3[]) {
    const p = this.params
    const fish = this.fish
    const n = fish.length
    const maxSpeed = p.maxSpeed * speedScale
    const scatterBoost = 1 + field.scatter * 1.1
    const isPuffer = this.species === 'pufferfish'
    const threats_ = threats && threats.length ? threats : null

    for (let i = 0; i < n; i++) {
      const f = fish[i]
      f.acc.set(0, 0, 0)
      _sep.set(0, 0, 0); _ali.set(0, 0, 0); _coh.set(0, 0, 0)
      let sepCount = 0, neiCount = 0
      let frenzy = 1
      let puffTarget = 0

      // ---- predators: schools panic & scatter, pufferfish inflate ----
      if (threats_) {
        for (let k = 0; k < threats_.length; k++) {
          const d = f.pos.distanceTo(threats_[k])
          if (d < 15) {
            const t = 1 - d / 15
            // most fish bolt away; puffers face the threat and puff up
            _tmp.subVectors(f.pos, threats_[k])
            if (d > 1e-4) _tmp.multiplyScalar(1 / d)
            if (isPuffer) {
              const pr = Math.min(1, (1 - d / 14) * 1.35)
              puffTarget = Math.max(puffTarget, pr * pr)
              if (f.puff < 0.55 && d > 1.2) {
                _tmp.setLength(maxSpeed * 0.9).sub(f.vel)
                this.limit(_tmp, p.maxForce * 1.4)
                f.acc.addScaledVector(_tmp, 2.2)      // sluggish escape attempt
              }
            } else {
              _tmp.setLength(maxSpeed * 1.25).sub(f.vel)
              this.limit(_tmp, p.maxForce * 2.2)
              f.acc.addScaledVector(_tmp, 4.5 * t)    // panic burst
            }
          }
        }
      }

      // pufferfish also puff when the diver swims right up to them
      if (isPuffer) {
        const dc = f.pos.distanceTo(camera)
        if (dc < 5) puffTarget = Math.max(puffTarget, Math.min(1, (1 - dc / 5) * 1.15))
        f.puff += (puffTarget - f.puff) * Math.min(1, dt * 3.2)
      }

      // ---- feeding frenzy: race to the nearest unclaimed pellet ----
      if (pellets && pellets.length) {
        let best: Pellet | null = null
        let bd = 26 * 26
        for (let k = 0; k < pellets.length; k++) {
          const pel = pellets[k]
          if (!pel.active || pel.claimed) continue
          const d2 = f.pos.distanceToSquared(pel.pos)
          if (d2 < bd) { bd = d2; best = pel }
        }
        if (best) {
          _tmp.subVectors(best.pos, f.pos)
          const d = Math.sqrt(bd)
          if (d > 0.5) {
            _tmp.multiplyScalar(1 / d)
            _tmp.setLength(maxSpeed * 1.5).sub(f.vel)
            this.limit(_tmp, p.maxForce * 1.9)
            f.acc.addScaledVector(_tmp, 2.1)
          }
          frenzy = 1.55
          f.speedNorm = Math.min(1, f.speedNorm + dt * 2.4)   // excited tail beats
          if (d < 0.62 + f.scale * 0.16) best.claimed = true   //gulp
        }
      }

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

      // ---- second hand: the SAME localized field for the second
      //      hand (local two-hand or the phone remote) so schools
      //      can follow both sides of a swimming stroke ----
      if (field.active2 && field.strength2 > 0.003) {
        const d2 = f.pos.distanceTo(field.point2)
        const reach2 = field.radius * 2.1
        if (d2 < reach2) {
          const t2 = 1 - d2 / reach2
          const w2 = t2 * t2 * field.strength2 * this.speciesResponse
          f.acc.addScaledVector(field.dir2, w2 * 15)
          if (field.mode2 === 'push' || field.mode2 === 'repel') {
            _tmp.subVectors(f.pos, field.point2).normalize()
            f.acc.addScaledVector(_tmp, w2 * (field.mode2 === 'push' ? 26 : 14))
          } else if (field.mode2 === 'attract') {
            _tmp.subVectors(field.point2, f.pos).normalize()
            f.acc.addScaledVector(_tmp, w2 * 16 * (1 + field.curiosity))
          }
        }
      }

      // ---- integrate ----
      f.vel.addScaledVector(f.acc, dt)
      f.vel.multiplyScalar(1 - Math.min(1, dt * ((field.mode === 'pull' ? 1.2 : 0.35) + (isPuffer ? f.puff * 2.2 : 0))))
      const sp = f.vel.length()
      const maxSp = maxSpeed * scatterBoost * frenzy * (1 + field.strength * 0.35) * (1 - (isPuffer ? f.puff * 0.8 : 0))
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
