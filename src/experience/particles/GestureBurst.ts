// ---------------------------------------------------------------
// GestureBurst — pooled particle explosions that visualise every
// gesture: swipe trails, push shockwaves, palm attraction rings.
// ---------------------------------------------------------------
import * as THREE from 'three'
import { sharedUniforms } from '../core/sharedUniforms'
import { makeGlowTexture } from '../utils/math'

interface P {
  alive: boolean
  pos: THREE.Vector3
  vel: THREE.Vector3
  life: number
  maxLife: number
  size: number
}

export class GestureBurst {
  points: THREE.Points
  private pool: P[] = []
  private positions: Float32Array
  private sizes: Float32Array
  private alphas: Float32Array
  private cursor = 0

  constructor(scene: THREE.Scene, poolSize = 340) {
    const geo = new THREE.BufferGeometry()
    this.positions = new Float32Array(poolSize * 3)
    this.sizes = new Float32Array(poolSize)
    this.alphas = new Float32Array(poolSize)
    for (let i = 0; i < poolSize; i++) {
      this.pool.push({
        alive: false,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        life: 0, maxLife: 1, size: 1,
      })
      this.positions[i * 3 + 1] = -999
      this.alphas[i] = 0
    }
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3))
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1))
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1))
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 200)

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uMap: { value: makeGlowTexture() },
        uColor: { value: new THREE.Color('#aef2ff') },
      },
      vertexShader: /* glsl */`
        attribute float aSize;
        attribute float aAlpha;
        varying float vAlpha;
        void main() {
          vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = aSize * (160.0 / max(1.0, -mv.z));
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D uMap;
        uniform vec3 uColor;
        varying float vAlpha;
        void main() {
          vec4 tex = texture2D(uMap, gl_PointCoord);
          gl_FragColor = vec4(uColor, tex.a * vAlpha);
          #include <colorspace_fragment>
        }`,
    })
    this.points = new THREE.Points(geo, mat)
    this.points.frustumCulled = false
    this.points.renderOrder = 9
    scene.add(this.points)
  }

  private emit(pos: THREE.Vector3, vel: THREE.Vector3, life: number, size: number) {
    const p = this.pool[this.cursor]
    this.cursor = (this.cursor + 1) % this.pool.length
    p.alive = true
    p.pos.copy(pos)
    p.vel.copy(vel)
    p.life = 0
    p.maxLife = life
    p.size = size
  }

  /** Swipe: directional trail */
  trail(from: THREE.Vector3, dir: THREE.Vector3, strength: number) {
    const n = Math.floor(10 + strength * 22)
    for (let i = 0; i < n; i++) {
      const spread = new THREE.Vector3(
        (Math.random() - 0.5), (Math.random() - 0.5), (Math.random() - 0.5),
      ).multiplyScalar(0.9)
      const v = dir.clone().multiplyScalar(2.5 + Math.random() * 5 * strength).add(spread)
      this.emit(
        from.clone().addScaledVector(dir, -i * 0.35).add(spread.clone().multiplyScalar(0.7)),
        v,
        0.7 + Math.random() * 0.6,
        0.8 + Math.random() * 1.4 * strength,
      )
    }
  }

  /** Push: radial shockwave */
  shockwave(pos: THREE.Vector3, strength: number) {
    const n = Math.floor(26 + strength * 40)
    for (let i = 0; i < n; i++) {
      const dir = new THREE.Vector3(
        Math.random() - 0.5, (Math.random() - 0.5) * 0.7, Math.random() - 0.5,
      ).normalize()
      this.emit(
        pos.clone().addScaledVector(dir, 0.4),
        dir.multiplyScalar(4 + Math.random() * 7 * strength),
        0.8 + Math.random() * 0.7,
        1.0 + Math.random() * 1.6,
      )
    }
  }

  /** Open palm: soft attraction ring */
  ring(pos: THREE.Vector3) {
    const n = 26
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2
      const dir = new THREE.Vector3(Math.cos(a), Math.sin(a) * 0.4, Math.sin(a)).normalize()
      this.emit(
        pos.clone().addScaledVector(dir, 1.6),
        dir.clone().multiplyScalar(-1.6).add(new THREE.Vector3(0, 0.4, 0)),
        1.1 + Math.random() * 0.4,
        0.9 + Math.random() * 0.9,
      )
    }
  }

  update(dt: number) {
    let dirty = false
    for (let i = 0; i < this.pool.length; i++) {
      const p = this.pool[i]
      if (!p.alive) continue
      dirty = true
      p.life += dt
      if (p.life >= p.maxLife) {
        p.alive = false
        this.alphas[i] = 0
        this.positions[i * 3 + 1] = -999
        continue
      }
      p.vel.multiplyScalar(1 - Math.min(1, dt * 2.6))
      p.pos.addScaledVector(p.vel, dt)
      p.vel.y += 0.6 * dt          // gentle buoyancy
      const t = p.life / p.maxLife
      this.positions[i * 3] = p.pos.x
      this.positions[i * 3 + 1] = p.pos.y
      this.positions[i * 3 + 2] = p.pos.z
      this.alphas[i] = (1 - t) * 0.85
      this.sizes[i] = p.size * (0.6 + t * 0.9)
    }
    if (dirty) {
      ;(this.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true
      ;(this.points.geometry.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true
      ;(this.points.geometry.attributes.aSize as THREE.BufferAttribute).needsUpdate = true
    }
  }
}
