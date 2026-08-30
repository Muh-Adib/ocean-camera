// ---------------------------------------------------------------
// ParticleField — drifting micro particles + glowing plankton.
// Fully GPU-animated: drift, twinkle and gesture-field response
// happen in the vertex shader.
// ---------------------------------------------------------------
import * as THREE from 'three'
import { sharedUniforms } from '../core/sharedUniforms'
import { makeGlowTexture } from '../utils/math'

const VERT = /* glsl */`
  uniform float uTime;
  uniform vec3 uFieldPos;
  uniform vec3 uFieldDir;
  uniform float uFieldStrength;
  uniform float uFieldRadius;
  uniform float uSize;
  uniform float uDrift;        // drift speed multiplier
  attribute vec3 aSeed;        // per-particle randoms
  attribute float aTwinkle;
  varying float vAlpha;
  varying float vGlow;

  void main() {
    vec3 pos = position;
    // slow looping drift driven by seeds (organic curl feel)
    float t = uTime * uDrift;
    pos.x += sin(t * 0.31 + aSeed.x * 6.28) * 1.6
           + sin(t * 0.13 + aSeed.y * 6.28) * 1.1;
    pos.y += sin(t * 0.24 + aSeed.y * 6.28) * 1.2
           + t * (0.08 + aSeed.z * 0.05);            // gentle rise
    pos.z += cos(t * 0.27 + aSeed.z * 6.28) * 1.6
           + sin(t * 0.11 + aSeed.x * 4.0) * 1.0;

    // wrap within a moving box around the origin
    pos = mod(pos + vec3(46.0, 15.0, 38.0), vec3(92.0, 30.0, 76.0)) - vec3(46.0, 15.0, 38.0);
    pos.y -= 13.0;   // box spans y [-13, 17]

    // gesture field response
    vec3 toField = pos - uFieldPos;
    float d = length(toField);
    float infl = smoothstep(uFieldRadius * 2.2, 0.0, d) * uFieldStrength;
    pos += uFieldDir * infl * 2.6;
    pos += normalize(toField + vec3(0.0001)) * infl * 0.8;
    vGlow = infl;

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;
    float tw = 0.55 + 0.45 * sin(uTime * (0.6 + aTwinkle * 1.6) + aTwinkle * 40.0);
    float dist = length(mv.xyz);
    vAlpha = tw * smoothstep(80.0, 28.0, dist);
    gl_PointSize = uSize * (1.0 + aTwinkle * 0.8) * (140.0 / max(1.0, -mv.z)) * (1.0 + infl * 1.5);
  }
`

const FRAG = /* glsl */`
  uniform vec3 uColor;
  uniform sampler2D uMap;
  uniform float uOpacity;
  varying float vAlpha;
  varying float vGlow;
  void main() {
    vec4 tex = texture2D(uMap, gl_PointCoord);
    float a = tex.a * vAlpha * uOpacity;
    vec3 col = uColor * (1.0 + vGlow * 2.0);
    gl_FragColor = vec4(col, a);
    #include <colorspace_fragment>
  }
`

export class ParticleField {
  group = new THREE.Group()
  private micro!: THREE.Points
  private plankton!: THREE.Points

  constructor(scene: THREE.Scene, microCount = 700, planktonCount = 220) {
    this.micro = this.buildSystem(microCount, {
      size: 2.2, drift: 1.0, color: '#8fb8c9', opacity: 0.34, twinkleVariance: 0.35,
    })
    this.plankton = this.buildSystem(planktonCount, {
      size: 4.6, drift: 0.7, color: '#7fe8d8', opacity: 0.5, twinkleVariance: 1.0,
    })
    this.group.add(this.micro, this.plankton)
    scene.add(this.group)
  }

  private buildSystem(count: number, cfg: { size: number; drift: number; color: string; opacity: number; twinkleVariance: number }) {
    const geo = new THREE.BufferGeometry()
    const positions = new Float32Array(count * 3)
    const seeds = new Float32Array(count * 3)
    const twinkle = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 150
      positions[i * 3 + 1] = (Math.random() - 0.5) * 27
      positions[i * 3 + 2] = (Math.random() - 0.5) * 122
      seeds[i * 3] = Math.random()
      seeds[i * 3 + 1] = Math.random()
      seeds[i * 3 + 2] = Math.random()
      twinkle[i] = Math.random() * cfg.twinkleVariance
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3))
    geo.setAttribute('aTwinkle', new THREE.BufferAttribute(twinkle, 1))
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, -18), 170)

    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: sharedUniforms.uTime,
        uFieldPos: sharedUniforms.uFieldPos,
        uFieldDir: sharedUniforms.uFieldDir,
        uFieldStrength: sharedUniforms.uFieldStrength,
        uFieldRadius: sharedUniforms.uFieldRadius,
        uSize: { value: cfg.size },
        uDrift: { value: cfg.drift },
        uColor: { value: new THREE.Color(cfg.color) },
        uOpacity: { value: cfg.opacity },
        uMap: { value: makeGlowTexture() },
      },
    })
    const points = new THREE.Points(geo, mat)
    points.frustumCulled = false
    return points
  }

  /** visible population control for adaptive quality */
  setPopulation(scale: number) {
    for (const pts of [this.micro, this.plankton]) {
      const geo = pts.geometry as THREE.BufferGeometry
      const total = geo.attributes.position.count
      pts.geometry.setDrawRange(0, Math.floor(total * scale))
    }
  }
}
