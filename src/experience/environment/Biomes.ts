// ---------------------------------------------------------------
// Biomes — landmarks & habitats that give the open ocean variety:
//   • NW  Kelp Forest — tall GPU-swayed kelp (shares the seaweed
//     current uniforms so every plant answers the same water)
//   • SW  Boulder Canyon — two noise-deformed rock arches, wall
//     fins and boulder piles standing in the seabed canyon
//   • N   The Spires — tall monolith silhouettes on the seamount
//   • SE  Sand Flats — algae-painted coral bommies
// Static rockwork is merged into ONE draw call.
// ---------------------------------------------------------------
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { sharedUniforms } from '../core/sharedUniforms'
import { mulberry32, fbm2 } from '../utils/math'

// ---------------- kelp (instanced, GPU sway) ----------------
const KELP_VERT = /* glsl */`
  uniform float uTime;
  uniform vec3 uFieldPos;
  uniform vec3 uFieldDir;
  uniform float uFieldStrength;
  uniform float uFieldRadius;
  uniform float uCurrent;
  uniform vec2 uCurrentDir;

  attribute vec3 aOffset;
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

    vec3 pos = position;
    float t = uv.y;
    // frond taper + gentle width ripple along the stipe
    pos.x *= mix(1.0, 0.1, t) * (1.0 + 0.25 * sin(t * 21.0 + phase));
    pos.y *= hScale;

    // heavy stipe: slower, weightier sway than seaweed
    float bend = t * t;
    float sway = sin(uTime * 0.55 + phase + t * 1.7) * (0.18 + uCurrent * 0.5)
               + sin(uTime * 0.31 + phase * 1.6) * (0.1 + uCurrent * 0.28);
    vec2 cur = uCurrentDir * uCurrent;
    pos.x += sway * bend + lean * bend + cur.x * bend * 1.6;
    pos.z += (cos(uTime * 0.42 + phase * 0.9) * (0.09 + uCurrent * 0.22) + cur.y * 1.2) * bend;

    float c = cos(yaw), s = sin(yaw);
    vec3 rot = vec3(pos.x * c - pos.z * s, pos.y, pos.x * s + pos.z * c);

    vec3 world = aOffset + rot;
    float d = distance(world, uFieldPos);
    float infl = smoothstep(uFieldRadius * 1.6, 0.0, d) * uFieldStrength;
    vec2 fieldBend = uFieldDir.xz * infl * (0.4 + 0.4 * sin(uTime * 1.7 + phase));
    rot.x += fieldBend.x * bend;
    rot.z += fieldBend.y * bend;
    vFlect = infl;

    vHeight = t;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(aOffset + rot, 1.0);
  }
`

const KELP_FRAG = /* glsl */`
  uniform float uEnergy;
  varying vec2 vUv;
  varying float vHeight;
  varying float vFlect;
  void main() {
    vec3 holdfast = vec3(0.055, 0.075, 0.035);
    vec3 stipe   = vec3(0.16, 0.20, 0.07);
    vec3 blade   = vec3(0.30, 0.34, 0.11);
    vec3 tip     = vec3(0.46, 0.44, 0.16);
    vec3 col = mix(holdfast, stipe, smoothstep(0.0, 0.3, vHeight));
    col = mix(col, blade, smoothstep(0.25, 0.65, vHeight));
    col = mix(col, tip, smoothstep(0.6, 1.0, vHeight));
    col += vec3(0.10, 0.13, 0.04) * vFlect;                 // gesture shimmer
    col *= 0.82 + uEnergy * 0.35;
    float alpha = smoothstep(0.0, 0.1, vUv.y) * 0.96;
    col *= mix(0.5, 1.0, smoothstep(0.0, 0.3, vUv.y));
    gl_FragColor = vec4(col, alpha);
    #include <colorspace_fragment>
  }
`

// ---------------- rock helpers ----------------

/** displace vertices along their normals with fbm for a weathered look */
function weather(geo: THREE.BufferGeometry, freq: number, amp: number, seed: number) {
  const pos = geo.attributes.position as THREE.BufferAttribute
  const nor = geo.attributes.normal as THREE.BufferAttribute
  const v = new THREE.Vector3()
  const n = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i)
    const d = fbm2(v.x * freq + seed, v.y * freq + v.z * freq - seed, 3) * amp
      + fbm2(v.z * freq * 2.1 - seed, v.y * freq * 1.7, 2) * amp * 0.4
    n.fromBufferAttribute(nor, i)
    pos.setXYZ(i, v.x + n.x * d, v.y + n.y * d, v.z + n.z * d)
  }
  geo.computeVertexNormals()
}

/** rock vertex colours: mineral base + algae patches in the crevices */
function paintRock(geo: THREE.BufferGeometry, base: THREE.Color, algae: THREE.Color, seed: number, algaeAmt = 0.4) {
  const pos = geo.attributes.position as THREE.BufferAttribute
  const arr = new Float32Array(pos.count * 3)
  const c = new THREE.Color()
  const lo = base.clone().multiplyScalar(0.72)
  const hi = base.clone().multiplyScalar(1.22)
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i)
    c.copy(lo).lerp(hi, (fbm2(x * 0.9 + seed, (y + z) * 0.9, 3) + 1) * 0.5)
    const patch = fbm2(x * 0.55 - seed * 2, (y * 0.8 + z) * 0.55 + seed, 3)
    if (patch > 0.08) c.lerp(algae, Math.min(1, (patch - 0.08) * 3.2) * algaeAmt)
    arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3))
}

export class Biomes {
  group = new THREE.Group()
  private statics: THREE.Mesh | null = null
  private kelp: THREE.Mesh | null = null

  constructor(
    scene: THREE.Scene,
    heightAt: (x: number, z: number) => number,
    currentUniforms?: Record<string, { value: any }>,
  ) {
    const rng = mulberry32(777001)
    this.buildStatics(rng, heightAt)
    this.buildKelp(rng, heightAt, currentUniforms)
    scene.add(this.group)
  }

  // ---------- static rockwork (one merged draw call) ----------
  private buildStatics(rng: () => number, heightAt: (x: number, z: number) => number) {
    const parts: THREE.BufferGeometry[] = []
    const rockBase = new THREE.Color('#6f665a')
    const algae = new THREE.Color('#4e6f45')
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const e = new THREE.Euler()

    const drop = (geo: THREE.BufferGeometry, x: number, z: number, sink: number, rotY: number, tilt: number) => {
      e.set((rng() - 0.5) * tilt, rotY, (rng() - 0.5) * tilt)
      q.setFromEuler(e)
      geo.applyMatrix4(m.compose(new THREE.Vector3(x, heightAt(x, z) - sink, z), q, new THREE.Vector3(1, 1, 1)))
      parts.push(geo)
    }

    // — canyon arches (SW) —
    const arch = (R: number, tube: number, x: number, z: number, rotY: number) => {
      const g = new THREE.TorusGeometry(R, tube, 9, 24, Math.PI)
      weather(g, 0.32, tube * 0.34, rng() * 9)
      paintRock(g, rockBase, algae, rng() * 7, 0.45)
      drop(g, x, z, tube * 0.55, rotY, 0.06)
    }
    arch(5.8, 1.5, -52, -46, 0.6)     // grand arch in the canyon
    arch(4.1, 1.15, -41, -36, 2.1)    // smaller companion upstream

    // — boulder piles at the arch feet —
    for (let i = 0; i < 10; i++) {
      const g = new THREE.IcosahedronGeometry(0.7 + rng() * 1.4, 1)
      weather(g, 0.75, 0.34, rng() * 9)
      paintRock(g, rockBase.clone().multiplyScalar(0.92), algae, rng() * 7, 0.4)
      const a = rng() * Math.PI * 2
      const cx = -52 + Math.cos(a) * (5 + rng() * 9)
      const cz = -46 + Math.sin(a) * (5 + rng() * 8)
      g.scale(1, 0.72 + rng() * 0.3, 1)
      drop(g, cx, cz, 0.25, rng() * Math.PI * 2, 0.5)
    }

    // — canyon wall fins —
    for (const [fx, fz] of [[-44, -52], [-60, -42], [-56, -56], [-47, -38]]) {
      const h = 5.5 + rng() * 2.6
      const g = new THREE.CylinderGeometry(1.1 + rng() * 0.7, 2.0 + rng() * 0.8, h, 6, 4)
      g.translate(0, h / 2, 0)
      g.scale(0.5, 1, 1.7)
      weather(g, 0.5, 0.4, rng() * 9)
      paintRock(g, rockBase.clone().multiplyScalar(0.85), algae, rng() * 7, 0.5)
      drop(g, fx, fz, 0.4, rng() * Math.PI * 2, 0.1)
    }

    // — northern spires on the seamount —
    const spires: [number, number, number][] = [
      [-18, -80, 14], [10, -84, 16.5], [32, -76, 11], [-40, -78, 12.5], [-2, -74, 9],
    ]
    for (const [sx, sz, h] of spires) {
      const g = new THREE.CylinderGeometry(0.9 + rng() * 0.8, 2.7 + rng() * 1.0, h, 7, 6)
      g.translate(0, h / 2, 0)
      weather(g, 0.42, 0.55, rng() * 9)
      paintRock(g, new THREE.Color('#66686c'), new THREE.Color('#3f5c52'), rng() * 7, 0.5)
      drop(g, sx, sz, 1.3, rng() * Math.PI * 2, 0.09)
    }

    // — sand-flat bommies (SE) —
    for (const [bx, bz, br] of [[38, -14, 3.0], [47, -25, 2.4], [57, -9, 3.4]] as const) {
      const g = new THREE.SphereGeometry(br, 14, 10)
      g.scale(1.3, 0.62, 1.3)
      weather(g, 0.6, 0.4, rng() * 9)
      paintRock(g, new THREE.Color('#8d8168'), new THREE.Color('#5d7d4e'), rng() * 7, 0.55)
      drop(g, bx, bz, br * 0.28, rng() * Math.PI * 2, 0.06)
    }

    // icosahedron parts are non-indexed while torus/cylinder/sphere are
    // indexed — expand everything to non-indexed so the merge succeeds
    const merged = mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)), false)!
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.94,
      metalness: 0.02,
    })
    this.statics = new THREE.Mesh(merged, mat)
    this.group.add(this.statics)
  }

  // ---------- kelp forest (instanced GPU sway) ----------
  private buildKelp(
    rng: () => number,
    heightAt: (x: number, z: number) => number,
    currentUniforms?: Record<string, { value: any }>,
  ) {
    const blade = new THREE.PlaneGeometry(0.62, 11, 1, 16)
    blade.translate(0, 5.5, 0)

    const geo = new THREE.InstancedBufferGeometry()
    geo.index = blade.index
    geo.attributes.position = blade.attributes.position
    geo.attributes.uv = blade.attributes.uv
    geo.attributes.normal = blade.attributes.normal

    const KELP_COUNT = 330
    const offsets = new Float32Array(KELP_COUNT * 3)
    const params = new Float32Array(KELP_COUNT * 4)

    // groves across the north-western forest
    const groves: [number, number, number][] = [
      [-38, -38, 9], [-46, -44, 10], [-54, -38, 8], [-60, -50, 9],
      [-42, -56, 10], [-50, -62, 9], [-36, -48, 7], [-56, -30, 7],
      [-64, -40, 8], [-44, -68, 8], [-34, -60, 6], [-62, -58, 8],
      [-40, -30, 6], [-52, -52, 9], [-58, -66, 7], [-46, -34, 8],
    ]

    let i = 0
    let guard = 0
    while (i < KELP_COUNT && guard++ < KELP_COUNT * 40) {
      const gr = groves[Math.floor(rng() * groves.length)]
      const a = rng() * Math.PI * 2
      const d = Math.sqrt(rng()) * gr[2]
      const x = gr[0] + Math.cos(a) * d
      const z = gr[1] + Math.sin(a) * d
      offsets[i * 3] = x
      offsets[i * 3 + 1] = heightAt(x, z) - 0.2
      offsets[i * 3 + 2] = z
      params[i * 4] = rng() * Math.PI * 2              // phase
      params[i * 4 + 1] = 0.5 + rng() * 0.55           // height scale → 5.5..11.5 m
      params[i * 4 + 2] = rng() * Math.PI * 2          // yaw
      params[i * 4 + 3] = (rng() - 0.5) * 0.3          // lean
      i++
    }
    geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsets, 3))
    geo.setAttribute('aParams', new THREE.InstancedBufferAttribute(params, 4))
    geo.instanceCount = i
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(-48, -4, -50), 60)

    const mat = new THREE.ShaderMaterial({
      vertexShader: KELP_VERT,
      fragmentShader: KELP_FRAG,
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: true,
      uniforms: {
        uTime: sharedUniforms.uTime,
        uFieldPos: sharedUniforms.uFieldPos,
        uFieldDir: sharedUniforms.uFieldDir,
        uFieldStrength: sharedUniforms.uFieldStrength,
        uFieldRadius: sharedUniforms.uFieldRadius,
        // share the seaweed current uniforms so the whole ocean sways together
        uCurrent: currentUniforms?.uCurrent ?? { value: 0.25 },
        uCurrentDir: currentUniforms?.uCurrentDir ?? { value: new THREE.Vector2(1, 0) },
        uEnergy: sharedUniforms.uEnergy,
      },
    })
    this.kelp = new THREE.Mesh(geo, mat)
    this.kelp.frustumCulled = false
    this.group.add(this.kelp)
  }

  dispose() {
    if (this.statics) {
      this.statics.geometry.dispose()
      ;(this.statics.material as THREE.Material).dispose()
      this.statics = null
    }
    if (this.kelp) {
      this.kelp.geometry.dispose()
      ;(this.kelp.material as THREE.Material).dispose()
      this.kelp = null
    }
  }
}
