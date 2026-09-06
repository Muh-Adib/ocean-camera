// ---------------------------------------------------------------
// SpongeBubbles — fine bubble streams rising from tube-sponge
// osculums. Instanced fresnel-rim spheres (thin bright rim,
// nearly transparent belly — reads as real bubbles), CPU updated.
//
// INTERACTION — when the visitor's gesture current sweeps near a
// sponge cluster, that cluster's stream bursts: bubbles spawn
// faster and rise quicker for a moment.
// ---------------------------------------------------------------
import * as THREE from 'three'
import { mulberry32, rand } from '../utils/math'

interface SBubble {
  lip: number                 // emitter index
  t: number                   // 0..1 progress of the rise
  rise: number                // total rise distance (m)
  speed: number               // rise speed (m/s)
  size: number
  phase: number
  amp: number
  boost: number               // gesture burst multiplier, decays
}

interface FieldInfluence {
  pos: THREE.Vector3
  strength: { value: number }
  radius: number
}

export class SpongeBubbles {
  mesh: THREE.InstancedMesh
  private b: SBubble[] = []
  private dummy = new THREE.Object3D()
  private rng = mulberry32(990077)
  private field: FieldInfluence

  constructor(scene: THREE.Scene, private lips: THREE.Vector3[], field: FieldInfluence, count = 190) {
    this.field = field
    const geo = new THREE.SphereGeometry(0.5, 8, 6)
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */`
        varying vec3 vN;
        varying vec3 vV;
        void main() {
          vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
          vN = normalize(normalMatrix * mat3(instanceMatrix) * normal);
          vV = -mv.xyz;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        varying vec3 vN;
        varying vec3 vV;
        void main() {
          float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.1);
          float a = fres * 0.85 + 0.05;
          vec3 col = mix(vec3(0.72, 0.9, 1.0), vec3(1.0), fres);
          gl_FragColor = vec4(col, a);
          #include <colorspace_fragment>
        }`,
    })
    this.mesh = new THREE.InstancedMesh(geo, mat, count)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 7

    for (let i = 0; i < count; i++) {
      const lip = Math.floor(this.rng() * this.lips.length)
      this.b.push({
        lip,
        t: this.rng(),                    // start scattered along the rise
        rise: 1.0 + this.rng() * 2.4,
        speed: 0.3 + this.rng() * 0.45,
        size: rand(0.022, 0.068) * (this.rng() < 0.12 ? 1.8 : 1),
        phase: this.rng() * Math.PI * 2,
        amp: rand(0.024, 0.08),
        boost: 0,
      })
    }
    this.hideAll()
    scene.add(this.mesh)
  }

  private hideAll() {
    this.dummy.position.set(0, -999, 0)
    this.dummy.scale.setScalar(0.0001)
    this.dummy.updateMatrix()
    for (let i = 0; i < this.b.length; i++) this.mesh.setMatrixAt(i, this.dummy.matrix)
    this.mesh.instanceMatrix.needsUpdate = true
  }

  /** respawn bubble i — gesture current biases new spawns toward
   *  the sponges it is sweeping past */
  private respawn(i: number) {
    const bub = this.b[i]
    const f = this.field
    let lip = Math.floor(this.rng() * this.lips.length)
    if (f.strength.value > 0.35) {
      // weighted pick: sponges near the field centre spawn more
      let best = -1
      let bestW = -1
      for (let k = 0; k < 5; k++) {
        const cand = Math.floor(this.rng() * this.lips.length)
        const d = this.lips[cand].distanceTo(f.pos)
        const w = Math.max(0, 1 - d / (f.radius * 2.2)) * f.strength.value + this.rng() * 0.35
        if (w > bestW) { bestW = w; best = cand }
      }
      if (best >= 0 && bestW > 0.42) lip = best
    }
    bub.lip = lip
    bub.t = 0
    bub.rise = 1.0 + this.rng() * 2.4
    bub.speed = 0.3 + this.rng() * 0.45
    bub.size = rand(0.022, 0.068) * (this.rng() < 0.12 ? 1.8 : 1)
    bub.phase = this.rng() * Math.PI * 2
    bub.amp = rand(0.024, 0.08)
  }

  update(dt: number, time: number) {
    const f = this.field
    const dummy = this.dummy
    const fieldBoost = f.strength.value

    for (let i = 0; i < this.b.length; i++) {
      const bub = this.b[i]
      const lip = this.lips[bub.lip]
      if (!lip) { this.respawn(i); continue }

      // gesture burst: bubbles near the current rise faster
      const dLip = lip.distanceTo(f.pos)
      const near = fieldBoost > 0.25
        ? Math.max(0, 1 - dLip / (f.radius * 2.2)) * fieldBoost : 0
      bub.boost += (near * 1.6 - bub.boost) * Math.min(1, dt * 3)

      bub.t += dt * bub.speed * (1 + bub.boost * 1.6) / bub.rise
      if (bub.t >= 1) { this.respawn(i); continue }

      const y = lip.y + bub.t * bub.rise
      const grow = 0.55 + bub.t * 0.75               // expands as pressure drops
      const wobble = Math.sin(time * 1.9 + bub.phase) * bub.amp * (0.4 + bub.t)
      const wobble2 = Math.cos(time * 1.4 + bub.phase * 1.3) * bub.amp * 0.6 * (0.4 + bub.t)
      dummy.position.set(lip.x + wobble, y, lip.z + wobble2)
      dummy.scale.setScalar(bub.size * grow)
      dummy.updateMatrix()
      this.mesh.setMatrixAt(i, dummy.matrix)
    }
    this.mesh.instanceMatrix.needsUpdate = true
  }
}
