// ---------------------------------------------------------------
// WaterSurface — the underside of the ocean surface, seen from
// below: a gently waving plane with a bright Snell's-window glow
// overhead, moving shimmer, sparkle highlights and a soft response
// to the gesture force field (ripples of light where the hand is).
// Fully shader-driven (one draw call), fades in during the intro.
// ---------------------------------------------------------------
import * as THREE from 'three'
import gsap from 'gsap'
import { sharedUniforms } from '../core/sharedUniforms'

export class WaterSurface {
  mesh: THREE.Mesh
  private mat: THREE.ShaderMaterial

  constructor(scene: THREE.Scene) {
    const geo = new THREE.PlaneGeometry(300, 240, 72, 58)
    geo.rotateX(Math.PI / 2)               // horizontal; normals face -Y (toward the diver)

    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
      uniforms: {
        uTime: sharedUniforms.uTime,
        uEnergy: sharedUniforms.uEnergy,
        uFieldPos: sharedUniforms.uFieldPos,
        uFieldRadius: sharedUniforms.uFieldRadius,
        uFieldStrength: sharedUniforms.uFieldStrength,
        uOpacity: { value: 0 },
        uDeep: { value: new THREE.Color('#05304a') },
        uBright: { value: new THREE.Color('#b8e8ff') },
      },
      vertexShader: /* glsl */`
        uniform float uTime;
        varying vec3 vWorld;
        varying vec3 vNrm;
        varying vec2 vUv;

        float wave(vec2 p, float t) {
          float h = 0.0;
          h += sin(p.x * 0.14 + t * 0.9) * 0.34;
          h += sin((p.x * 0.6 + p.y * 0.5) * 0.22 - t * 1.15) * 0.18;
          h += sin(p.y * 0.31 - t * 0.7) * 0.13;
          h += sin((p.x - p.y * 0.7) * 0.53 + t * 1.6) * 0.07;
          return h;
        }

        void main() {
          vUv = uv;
          vec3 pos = position;
          float t = uTime;
          pos.y += wave(pos.xz, t);
          // finite-difference normal for the shimmer shading
          float e = 1.4;
          float hx = wave(pos.xz + vec2(e, 0.0), t) - wave(pos.xz - vec2(e, 0.0), t);
          float hz = wave(pos.xz + vec2(0.0, e), t) - wave(pos.xz - vec2(0.0, e), t);
          vNrm = normalize(vec3(-hx, 2.0 * e, -hz));
          vec4 wp = modelMatrix * vec4(pos, 1.0);
          vWorld = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */`
        uniform float uTime, uOpacity, uEnergy;
        uniform float uFieldRadius, uFieldStrength;
        uniform vec3 uDeep, uBright;
        uniform vec3 uFieldPos;
        varying vec3 vWorld;
        varying vec3 vNrm;
        varying vec2 vUv;

        void main() {
          vec3 V = normalize(cameraPosition - vWorld);
          vec3 N = normalize(vNrm);
          // looking straight up into the light → 1 (Snell's window)
          float facing = clamp(dot(V, N), 0.0, 1.0);
          float win = pow(facing, 1.7);

          // travelling shimmer across the underside (domain-warped, organic)
          vec2 p = vWorld.xz * 0.13;
          float t = uTime * 0.7;
          vec2 q = vec2(sin(p.y * 1.7 + t * 0.8), sin(p.x * 1.3 - t * 0.6));
          float sh = sin(p.x * 2.4 + q.y * 2.2 + t * 0.9)
                   * sin(p.y * 2.9 + q.x * 2.6 - t * 0.7);
          sh = pow(max(sh, 0.0), 1.8);
          float sparkle = pow(max(sin(p.x * 4.1 + q.x * 2.9 + t * 1.2)
                                * sin(p.y * 4.7 - q.y * 2.3 - t * 0.9), 0.0), 10.0) * 0.35;

          vec3 col = mix(uDeep, uBright, clamp(win * (0.55 + 0.45 * sh) + sparkle * 0.3, 0.0, 1.0));
          col *= 0.85 + uEnergy * 0.4;

          // gesture → ripple of light on the ceiling of the sea
          float fd = length(vWorld.xz - uFieldPos.xz);
          col += vec3(0.4, 0.8, 1.0) * uFieldStrength * 0.4 * exp(-fd * fd / (uFieldRadius * uFieldRadius));

          float edge = smoothstep(0.0, 0.14, vUv.x) * smoothstep(1.0, 0.86, vUv.x)
                     * smoothstep(0.0, 0.16, vUv.y) * smoothstep(1.0, 0.84, vUv.y);
          float a = uOpacity * edge * (0.42 + win * 0.55);
          gl_FragColor = vec4(col, a);
          #include <colorspace_fragment>
        }`,
    })

    this.mesh = new THREE.Mesh(geo, this.mat)
    this.mesh.position.set(0, 15.5, -20)
    this.mesh.renderOrder = 7
    this.mesh.frustumCulled = false
    scene.add(this.mesh)
  }

  /** fade in with the cinematic intro */
  reveal() {
    gsap.to(this.mat.uniforms.uOpacity, { value: 1, duration: 5, ease: 'power2.inOut' })
  }

  dispose() {
    this.mesh.geometry.dispose()
    this.mat.dispose()
    this.mesh.removeFromParent()
  }
}
