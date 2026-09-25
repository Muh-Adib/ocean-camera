// ---------------------------------------------------------------
// Boids — lightweight flocking simulation: separation, alignment,
// cohesion, wander, obstacle & boundary avoidance, gesture force,
// species behaviours (homebound clownfish, curious pufferfish).
// Movement is always integrated through acceleration → velocity →
// position with damping; fish never teleport.
//
// CHOREOGRAPHY: a School can carry a ROUTE (patrol polyline, orbit
// ring, figure-8) that acts as a moving leader target — the flock
// keeps its natural texture but the FLOW follows the operator's
// path. A one-shot MIGRATION target moves a school to a new anchor
// by swimming (never teleporting). A HEADING bias nudges free
// schools to face a compass direction.
// ---------------------------------------------------------------
import * as THREE from 'three'
import { BOUNDS, clamp, rand } from '../utils/math'
import type { Obstacle } from '../environment/Rocks'
import type { Pellet } from './Feeding'

/** choreography flow modes — 'goto' is the internal migration state */
export type RouteMode = 'patrol' | 'orbit' | 'figure8' | 'goto'

/** active route runtime on a School (built by School.setRoute) */
export interface RouteState {
  mode: RouteMode
  points: THREE.Vector3[]      // patrol waypoints (world space)
  loop: boolean                // true = closed loop · false = ping-pong
  speed: number                // metres / second along the flow
  radius: number               // orbit & figure-8 radius (m)
  cum: number[]                // cumulative segment lengths (patrol)
  total: number                // total polyline length (patrol)
  dist: number                 // travelled distance (patrol)
  dir: 1 | -1                  // ping-pong direction
  angle: number                // orbit / figure-8 phase (rad)
}

/**
 * CAMERA PASS — a single fish performs a close, slow arc AROUND the
 * view point (the wall constellation eye / the swim camera). Used as
 * the DEFAULT behaviour of painted (imported-image) fish: they roam
 * free, but take turns swooping past the camera one by one so every
 * visitor sees each artwork glide by up close, never as a clump.
 */
export interface PassState {
  fish: number                 // index of the fish performing the pass
  center: THREE.Vector3        // live view point (tracked every frame)
  radius: number               // orbit distance from the camera (m)
  speed: number                // tangential speed along the ring (m/s)
  angle: number                // ring phase (rad) — seeded from the fish bearing
  travel: number               // radians traversed so far (done ≥ travelGoal)
  travelGoal: number           // total arc for this pass (~1.6 loops)
  done: boolean                // set when the fish may rejoin free swim
  dir: 1 | -1                  // orbit direction — alternates so passes vary
  yOff: number                 // personal height offset around the ring (m)
  yWave: number                // vertical bob amplitude for this pass (m)
}

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

  // ---- choreography state ----
  route: RouteState | null = null
  migrate: THREE.Vector3 | null = null     // one-shot swim-to target
  heading: THREE.Vector3 | null = null     // free-mode compass bias
  speedMul = 1                             // per-school speed multiplier
  centroid = new THREE.Vector3()           // school centre (updated per frame)
  /** per-fish close camera pass (painted-fish default behaviour) */
  pass: PassState | null = null

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

  // ------------------------------------------------------------ choreography API
  /** new home anchor — fish SWIM over (migration), never teleport */
  setAnchor(v: THREE.Vector3) {
    this.anchor.copy(v)
    this.migrate = v.clone()
  }

  /** free-mode compass heading bias (degrees, 0 = +X/east) — null clears */
  setHeadingDeg(deg: number | null) {
    if (deg === null) { this.heading = null; return }
    const a = THREE.MathUtils.degToRad(deg)
    this.heading = new THREE.Vector3(Math.cos(a), 0, Math.sin(a))
  }

  /** install a choreography route — null returns the school to free swimming */
  setRoute(
    mode: 'patrol' | 'orbit' | 'figure8' | null,
    points: THREE.Vector3[] = [],
    loop = true, speed = 2.2, radius = 7,
  ) {
    if (!mode) { this.route = null; return }
    if (mode === 'patrol' && points.length < 2) { this.route = null; return }
    const rt: RouteState = {
      mode, points: points.map((p) => p.clone()),
      loop, speed: Math.max(0.3, speed), radius: Math.max(2, radius),
      cum: [], total: 0, dist: 0, dir: 1, angle: 0,
    }
    if (mode === 'patrol') {
      // cumulative lengths — waypoint 0 seeded at the school's current spot
      let acc = 0
      rt.cum = [0]
      for (let i = 1; i < rt.points.length; i++) {
        acc += rt.points[i].distanceTo(rt.points[i - 1])
        rt.cum.push(acc)
      }
      if (loop && rt.points.length > 2) {
        acc += rt.points[0].distanceTo(rt.points[rt.points.length - 1])
        rt.cum.push(acc)
      }
      rt.total = Math.max(0.001, acc)
      // start nearest along the path so the school picks up mid-flow
      rt.dist = this.nearestOnPolyline(this.centroid)
    }
    this.route = rt
  }

  /** arc length along the patrol polyline closest to a point (path pickup) */
  private nearestOnPolyline(p: THREE.Vector3): number {
    const rt = this.route
    if (!rt || !rt.points.length) return 0
    const pts = rt.loop && rt.points.length > 2
      ? [...rt.points, rt.points[0]]
      : rt.points
    let best = 0, bestD = Infinity, acc = 0
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i]
      const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z
      const apx = p.x - a.x, apy = p.y - a.y, apz = p.z - a.z
      const len2 = abx * abx + aby * aby + abz * abz || 1e-6
      const t = Math.max(0, Math.min(1, (apx * abx + apy * aby + apz * abz) / len2))
      const dx = apx - abx * t, dy = apy - aby * t, dz = apz - abz * t
      const d = dx * dx + dy * dy + dz * dz
      if (d < bestD) { bestD = d; best = acc + Math.sqrt(len2) * t }
      acc += Math.sqrt(len2)
    }
    return best
  }

  /**
   * evaluate the route/migration leader target for this frame (ONCE per
   * school — per-fish offsets are derived from each fish's wanderSeed).
   * Returns false when no target is active this frame.
   */
  private evalRouteTarget(dt: number, out: THREE.Vector3): boolean {
    // one-shot migration always wins until arrival
    if (this.migrate) {
      out.copy(this.migrate)
      if (this.centroid.distanceTo(this.migrate) < 2.6) this.migrate = null
      return true
    }
    const rt = this.route
    if (!rt) return false
    if (rt.mode === 'patrol') {
      if (rt.points.length < 2) return false
      rt.dist += rt.speed * dt * rt.dir
      if (rt.loop) {
        if (rt.dist >= rt.total) rt.dist -= rt.total
        if (rt.dist < 0) rt.dist += rt.total
      } else {
        if (rt.dist >= rt.total) { rt.dist = rt.total; rt.dir = -1 }
        else if (rt.dist <= 0) { rt.dist = 0; rt.dir = 1 }
      }
      // walk cumulative lengths → segment + local t
      const pts = rt.loop && rt.points.length > 2
        ? [...rt.points, rt.points[0]]
        : rt.points
      let i = 1
      while (i < rt.cum.length - 1 && rt.cum[i] < rt.dist) i++
      const segStart = rt.cum[i - 1]
      const segLen = Math.max(1e-6, rt.cum[i] - segStart)
      const t = (rt.dist - segStart) / segLen
      const a = pts[i - 1], b = pts[i]
      out.set(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t)
      return true
    }
    // parametric rings around the anchor
    const w = rt.speed / Math.max(2, rt.radius)      // rad / s from tangential m/s
    rt.angle += w * dt
    if (rt.mode === 'orbit') {
      out.set(
        this.anchor.x + Math.cos(rt.angle) * rt.radius,
        this.anchor.y + Math.sin(rt.angle * 2.7) * rt.radius * 0.06,
        this.anchor.z + Math.sin(rt.angle) * rt.radius,
      )
    } else {
      // figure-8 (lemniscate of Gerono) — wide along X, crossed along Z
      out.set(
        this.anchor.x + Math.cos(rt.angle) * rt.radius,
        this.anchor.y + Math.sin(rt.angle * 2) * rt.radius * 0.05,
        this.anchor.z + Math.sin(rt.angle * 2) * rt.radius * 0.32,
      )
    }
    return true
  }

  update(dt: number, time: number, field: FieldCtx, obstacles: Obstacle[], camera: THREE.Vector3, speedScale = 1, pellets?: Pellet[], threats?: THREE.Vector3[]) {
    const p = this.params
    const fish = this.fish
    const n = fish.length
    const maxSpeed = p.maxSpeed * speedScale * this.speedMul
    const scatterBoost = 1 + field.scatter * 1.1
    const isPuffer = this.species === 'pufferfish'
    const threats_ = threats && threats.length ? threats : null

    // ---- choreography: one leader target per school per frame ----
    const routeTgt = new THREE.Vector3()
    const onRoute = this.evalRouteTarget(dt, routeTgt)
    let centroidX = 0, centroidY = 0, centroidZ = 0

    // ---- camera pass: advance the ring phase for the passing fish ----
    // (center is tracked LIVE, so the arc stays glued to the camera even
    // when the operator steers the room around mid-pass)
    let passTgt: THREE.Vector3 | null = null
    let passIdx = -1
    if (this.pass && this.pass.fish < n) {
      const ps = this.pass
      ps.angle += ps.dir * (ps.speed / Math.max(1.2, ps.radius)) * dt
      ps.travel += (ps.speed / Math.max(1.2, ps.radius)) * dt
      if (ps.travel >= ps.travelGoal) ps.done = true
      passIdx = ps.fish
      passTgt = new THREE.Vector3(
        ps.center.x + Math.cos(ps.angle) * ps.radius,
        ps.center.y + ps.yOff + ps.yWave * Math.sin(ps.angle * 2.3),
        ps.center.z + Math.sin(ps.angle) * ps.radius,
      )
    }

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

      // ---- choreography: follow the flow leader (route / migration) ----
      if (i === passIdx && passTgt) {
        // the passing fish hugs its ring point around the camera —
        // a firm steer (no personal offset) so the arc reads clean
        _tmp.copy(passTgt).sub(f.pos)
        const dr = _tmp.length()
        if (dr > 0.35) {
          _tmp.multiplyScalar(1 / dr)
          _tmp.setLength(maxSpeed * (dr < 2.2 ? 0.6 : 1.0)).sub(f.vel)
          this.limit(_tmp, p.maxForce * 1.9)
          f.acc.addScaledVector(_tmp, 2.3)
        }
      } else if (onRoute) {
        // personal offset so the school spreads around the leader point
        const ox = Math.sin(f.wanderSeed * 12.9898) * 1.5
        const oy = Math.sin(f.wanderSeed * 78.233) * 0.55
        const oz = Math.cos(f.wanderSeed * 39.425) * 1.5
        _tmp.set(routeTgt.x + ox, routeTgt.y + oy, routeTgt.z + oz).sub(f.pos)
        const dr = _tmp.length()
        if (dr > 0.7) {
          _tmp.multiplyScalar(1 / dr)
          _tmp.setLength(maxSpeed * (dr < 5 ? 0.55 : 0.95)).sub(f.vel)
          this.limit(_tmp, p.maxForce * 1.7)
          f.acc.addScaledVector(_tmp, 2.0)
        }
      } else if (this.heading) {
        // free swim compass bias — a gentle pull to face `heading`,
        // weak enough that wander keeps its natural texture
        const hd = f.vel.x * this.heading.x + f.vel.z * this.heading.z
        if (hd < maxSpeed * 0.5) {
          _tmp.copy(this.heading).setLength(maxSpeed * 0.45).sub(f.vel)
          this.limit(_tmp, p.maxForce * 0.45)
          f.acc.addScaledVector(_tmp, 0.8)
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

      centroidX += f.pos.x; centroidY += f.pos.y; centroidZ += f.pos.z
    }

    // school centroid (route arrival checks + QA telemetry)
    if (n > 0) {
      this.centroid.set(centroidX / n, centroidY / n, centroidZ / n)
      // migration arrival check rides the centroid — evalRouteTarget clears it
    }
  }

  private limit(v: THREE.Vector3, max: number) {
    const l = v.length()
    if (l > max && l > 1e-8) v.multiplyScalar(max / l)
  }
}

// keep _steer referenced (reserved for future steering behaviours)
void _steer
