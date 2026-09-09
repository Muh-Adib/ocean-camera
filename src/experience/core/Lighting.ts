// ---------------------------------------------------------------
// Lighting — sun key light, ambient water glow, volumetric god-ray
// planes and animated procedural caustics projected on the seabed.
// ---------------------------------------------------------------
import * as THREE from 'three'
import gsap from 'gsap'
import { sharedUniforms } from './sharedUniforms'
import { SEABED_Y, rand } from '../utils/math'

export class Lighting {
  group = new THREE.Group()
  private rays: THREE.Mesh[] = []
  private rayMats: THREE.ShaderMaterial[] = []
  private sun!: THREE.DirectionalLight
  private ambient!: THREE.HemisphereLight
  private raysCreated = 0
  private lightEnergy = { value: 1 }

  constructor(scene: THREE.Scene) {
    this.sun = new THREE.DirectionalLight('#dffaff', 3.3)
    this.sun.position.set(6, 42, 8)
    this.sun.castShadow = false
    scene.add(this.sun)

    this.ambient = new THREE.HemisphereLight('#bceef2', '#155a70', 1.15)
    scene.add(this.ambient)

    // faint fill from the front so fish bellies never go fully black
    const fill = new THREE.DirectionalLight('#3fa8c8', 0.65)
    fill.position.set(-8, -4, 24)
    scene.add(fill)

    scene.add(this.group)
  }

  get energy() { return this.lightEnergy }

  buildGodRays(count: number) {
    const mat = () => {
      const m = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        fog: false,
        uniforms: {
          uTime: sharedUniforms.uTime,
          uEnergy: sharedUniforms.uEnergy,
          uSeed: { value: Math.random() * 100 },
          uOpacity: { value: 0 },
        },
        vertexShader: /* glsl */`
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */`
          uniform float uTime, uSeed, uOpacity, uEnergy;
          varying vec2 vUv;
          void main() {
            // vertical falloff: bright at surface, gone at depth
            float v = pow(1.0 - vUv.y, 1.6);
            // horizontal soft edge
            float edge = smoothstep(0.0, 0.42, vUv.x) * smoothstep(1.0, 0.58, vUv.x);
            // slow shimmering brightness bands
            float band = 0.62
              + 0.38 * sin(vUv.x * 9.0 + uSeed)
              + 0.22 * sin(vUv.y * 5.0 - uTime * 0.22 + uSeed * 2.0);
            float a = v * edge * band * uOpacity * (0.55 + uEnergy * 0.5);
            vec3 col = mix(vec3(0.35, 0.75, 0.9), vec3(0.75, 0.95, 1.0), v);
            gl_FragColor = vec4(col * a, a);
          }`,
      })
      return m
    }

    for (let i = 0; i < count; i++) {
      const w = rand(3.2, 8.5)
      const h = rand(46, 64)
      const geo = new THREE.PlaneGeometry(w, h, 1, 1)
      const m = mat()
      const mesh = new THREE.Mesh(geo, m)
      // ring the whole arena with light shafts so every heading gets rays;
      // keep them INSIDE the reef wall band so they never glare against
      // the dark horizon silhouettes
      const a = (i / count) * Math.PI * 2 + rand(-0.25, 0.25)
      const r = rand(5, 26)
      mesh.position.set(Math.cos(a) * r, 20 - h * 0.34, -20 + Math.sin(a) * r)
      mesh.rotation.y = rand(0, Math.PI)
      mesh.rotation.z = rand(-0.16, 0.16)
      mesh.renderOrder = 5
      this.rays.push(mesh)
      this.rayMats.push(m)
      this.group.add(mesh)
    }
    this.raysCreated = count
  }

  /** Animated caustic sheet hovering just above the seabed — full 360° ring */
  buildCaustics() {
    const geo = new THREE.PlaneGeometry(235, 235, 1, 1)
    geo.rotateX(-Math.PI / 2)
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      uniforms: {
        uTime: sharedUniforms.uTime,
        uEnergy: sharedUniforms.uEnergy,
        uOpacity: { value: 0 },
      },
      vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */`
        // tileable water caustic (adapted from the classic Shadertoy pattern)
        uniform float uTime, uOpacity, uEnergy;
        varying vec2 vUv;
        float caustic(vec2 uv, float t) {
          vec2 p = mod(uv * 6.28318, 6.28318) - 250.0;
          vec2 i = p;
          float c = 1.0;
          float inten = 0.005;
          for (int n = 0; n < 4; n++) {
            float tt = t * (1.0 - (3.5 / float(n + 1)));
            i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
            c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten)));
          }
          c /= 4.0;
          c = 1.17 - pow(c, 1.4);
          return pow(abs(c), 6.0);
        }
        void main() {
          float t = uTime * 0.55;
          float c = caustic(vUv * 22.0 + vec2(t * 0.06, t * 0.045), t);
          // fade toward the plane edges and with depth
          float edge = smoothstep(0.0, 0.3, vUv.x) * smoothstep(1.0, 0.7, vUv.x)
                     * smoothstep(0.0, 0.3, vUv.y) * smoothstep(1.0, 0.7, vUv.y);
          float a = c * edge * uOpacity * (0.6 + uEnergy * 0.7);
          vec3 col = vec3(0.55, 0.97, 1.08) * a * 0.95;
          gl_FragColor = vec4(col, a);
        }`,
    })
    const plane = new THREE.Mesh(geo, mat)
    plane.position.set(0, SEABED_Y + 1.3, -20)
    plane.renderOrder = 4
    this.group.add(plane)
    this.causticMat = mat
    return plane
  }
  causticMat!: THREE.ShaderMaterial

  /** GSAP-tweenable: reveal lights during the intro */
  reveal() {
    this.rayMats.forEach((m, i) => {
      setTimeout(() => {
        gsap.to(m.uniforms.uOpacity, { value: rand(0.16, 0.34), duration: 4, ease: 'power2.inOut' })
      }, i * 180)
    })
    gsap.to(this.causticMat.uniforms.uOpacity, { value: 1.0, duration: 5, ease: 'power2.inOut' })
  }

  /** QA: skip the cinematic fade — full light instantly */
  revealNow() {
    this.rayMats.forEach((m) => { m.uniforms.uOpacity.value = 0.5 })
    this.causticMat.uniforms.uOpacity.value = 1.0
  }

  /** dynamic ecosystem event: subtle light energy shift */
  pulseEnergy() {
    const target = rand(0.8, 1.25)
    gsap.to(this.lightEnergy, {
      value: target, duration: 6, ease: 'power2.inOut',
      onUpdate: () => {
        this.sun.intensity = 3.3 * this.lightEnergy.value
        this.ambient.intensity = 1.15 * this.lightEnergy.value
      },
    })
  }

  update(_dt: number) {
    // gentle sway of the ray planes
    for (let i = 0; i < this.rays.length; i++) {
      const r = this.rays[i]
      r.rotation.y += Math.sin(sharedUniforms.uTime.value * 0.05 + i) * 0.0004
      r.position.x += Math.sin(sharedUniforms.uTime.value * 0.07 + i * 2.1) * 0.002
    }
  }
}

