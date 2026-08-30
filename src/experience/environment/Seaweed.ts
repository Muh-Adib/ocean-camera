// ---------------------------------------------------------------
// Seaweed — instanced blade clusters animated entirely on the GPU.
// Blades bend with the ambient current and react locally to the
// gesture force field (uniform-driven, zero CPU per-blade cost).
// ---------------------------------------------------------------
import * as THREE from 'three'
import { sharedUniforms } from '../core/sharedUniforms'
import { mulberry32 } from '../utils/math'

const VERT = /* glsl */`
  uniform float uTime;
  uniform vec3 uFieldPos;
  uniform vec3 uFieldDir;
  uniform float uFieldStrength;
  uniform float uFieldRadius;
  uniform float uCurrent;      // ambient current strength
  uniform vec2 uCurrentDir;

  attribute vec3 aOffset;      // cluster world position
  attribute vec4 aParams;      // x: phase, y: height scale, z: yaw, w: lean

  varying vec2 vUv;
  varying float vHeight;
  varying float vFlect;

  void main() {
    vUv = uv;
    float phase = aParams.x;
    float hScale = aParams.y;
    float yaw = aParams.z;
    float lean = aParams.w;

    // blade-local position, taper width toward the tip
    vec3 pos = position;
    float t = uv.y;
    pos.x *= mix(1.15, 0.25, t);
    pos.y *= hScale;

    // gentle shape lean + current sway (quadratic along height)
    float bend = t * t;
    float sway = sin(uTime * 0.9 + phase + t * 2.4) * (0.22 + uCurrent * 0.55)
               + sin(uTime * 0.53 + phase * 1.7) * (0.12 + uCurrent * 0.3);
    pos.x += sway * bend + lean * bend;
    pos.z += cos(uTime * 0.7 + phase * 0.9) * (0.1 + uCurrent * 0.25) * bend;

    // local yaw around cluster origin
    float c = cos(yaw), s = sin(yaw);
    vec3 rot = vec3(pos.x * c - pos.z * s, pos.y, pos.x * s + pos.z * c);

    // gesture force field — stronger toward blade tips
    vec3 world = aOffset + rot;
    float d = distance(world, uFieldPos);
    float infl = smoothstep(uFieldRadius * 1.8, 0.0, d) * uFieldStrength;
    vec2 fieldBend = uFieldDir.xz * infl * (0.55 + 0.45 * sin(uTime * 2.1 + phase));
    rot.x += fieldBend.x * bend;
    rot.z += fieldBend.y * bend;
    vFlect = infl;

    vHeight = t;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(aOffset + rot, 1.0);
  }
`

const FRAG = /* glsl */`
  uniform float uEnergy;
  varying vec2 vUv;
  varying float vHeight;
  varying float vFlect;
  void main() {
    vec3 deep = vec3(0.05, 0.22, 0.16);
    vec3 tip = vec3(0.22, 0.62, 0.44);
    vec3 col = mix(deep, tip, vHeight * vHeight);
    col += vec3(0.10, 0.16, 0.05) * vFlect;                 // gesture shimmer
    col *= 0.8 + uEnergy * 0.35;
    float alpha = smoothstep(0.0, 0.12, vUv.y) * (0.92);
    // darken the very base where it roots into sand
    col *= mix(0.55, 1.0, smoothstep(0.0, 0.35, vUv.y));
    gl_FragColor = vec4(col, alpha);
    #include <colorspace_fragment>
  }
`

export class Seaweed {
  mesh: THREE.Mesh

  constructor(scene: THREE.Scene, heightAt: (x: number, z: number) => number, bladeCount = 260) {
    // base blade: tall thin plane
    const blade = new THREE.PlaneGeometry(0.34, 3.4, 1, 8)
    blade.translate(0, 1.7, 0)

    const geo = new THREE.InstancedBufferGeometry()
    geo.index = blade.index
    geo.attributes.position = blade.attributes.position
    geo.attributes.uv = blade.attributes.uv
    geo.attributes.normal = blade.attributes.normal

    const rng = mulberry32(9091)
    const offsets = new Float32Array(bladeCount * 3)
    const params = new Float32Array(bladeCount * 4)

    // cluster distribution — gardens on sand channels between coral
    const clusters: [number, number, number][] = [
      [4, -26, 10], [-6, -34, 9], [22, -42, 9], [-22, -30, 8],
      [12, -12, 7], [-14, -14, 7], [30, -24, 8], [-30, -50, 8],
      [0, -52, 10], [-40, -22, 7], [38, -46, 8], [16, -60, 9],
      [-12, -58, 8], [42, -12, 6],
      // extended meadows across the open ocean
      [44, -22, 8], [52, -36, 8], [-52, -34, 8], [26, -70, 8],
      [-26, -70, 8], [8, -80, 9], [-14, -82, 8], [58, -52, 7],
      [-58, -64, 7], [-8, -70, 8], [36, -8, 6], [50, -14, 6],
    ]

    let i = 0
    let guard = 0
    while (i < bladeCount && guard++ < bladeCount * 40) {
      const cl = clusters[Math.floor(rng() * clusters.length)]
      const a = rng() * Math.PI * 2
      const d = Math.sqrt(rng()) * cl[2]
      const x = cl[0] + Math.cos(a) * d
      const z = cl[1] + Math.sin(a) * d
      if (Math.abs(x) < 5 && z > -16) continue       // keep camera spawn clear
      offsets[i * 3] = x
      offsets[i * 3 + 1] = heightAt(x, z) - 0.1
      offsets[i * 3 + 2] = z
      params[i * 4] = rng() * Math.PI * 2                    // phase
      params[i * 4 + 1] = 0.45 + rng() * 0.85                // height scale
      params[i * 4 + 2] = rng() * Math.PI * 2                // yaw
      params[i * 4 + 3] = (rng() - 0.5) * 0.35               // lean
      i++
    }
    geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsets, 3))
    geo.setAttribute('aParams', new THREE.InstancedBufferAttribute(params, 4))
    geo.instanceCount = i
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, -5, -30), 90)

    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: true,
      uniforms: {
        uTime: sharedUniforms.uTime,
        uFieldPos: sharedUniforms.uFieldPos,
        uFieldDir: sharedUniforms.uFieldDir,
        uFieldStrength: sharedUniforms.uFieldStrength,
        uFieldRadius: sharedUniforms.uFieldRadius,
        uCurrent: { value: 0.25 },
        uCurrentDir: { value: new THREE.Vector2(1, 0) },
        uEnergy: sharedUniforms.uEnergy,
      },
    })
    this.mesh = new THREE.Mesh(geo, mat)
    this.mesh.frustumCulled = false
    scene.add(this.mesh)
  }

  /** dynamic event: ambient current changes direction/strength */
  setCurrent(dirX: number, dirZ: number, strength: number) {
    const u = (this.mesh.material as THREE.ShaderMaterial).uniforms
    u.uCurrentDir.value.set(dirX, dirZ)
    u.uCurrent.value = strength
  }

  get currentStrength() { return (this.mesh.material as THREE.ShaderMaterial).uniforms.uCurrent.value as number }

  /** raw uniforms — shared with other flora (kelp) so the ocean sways as one */
  get uniforms() { return (this.mesh.material as THREE.ShaderMaterial).uniforms as Record<string, { value: any }> }
}
