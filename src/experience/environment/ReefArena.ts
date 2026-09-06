// ---------------------------------------------------------------
// ReefArena — the 360° coral colosseum.
// A circular reef wall surrounds a bright sandy clearing so the
// scene reads beautifully from EVERY heading (visitors walk a
// full circle around the projection room). Built from bommies:
// mossy green mounds crowned with the signature corals of the
// reference art — stacked sage table corals, periwinkle bubble
// clusters, magenta tube sponges, cream finger bundles, crimson
// sea whips and the iconic cyan spiral curls.
// Everything is vertex-coloured and merged per family into a
// handful of draw calls, with shader sway on the soft families.
// ---------------------------------------------------------------
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { sharedUniforms } from '../core/sharedUniforms'
import { mulberry32, fbm2 } from '../utils/math'
import type { Obstacle } from './Rocks'

type Rng = () => number

// arena centre matches the seabed focus + camera gaze target
const CX = 0
const CZ = -20

// ---------------- vertex painting helpers ----------------
function paint(geo: THREE.BufferGeometry, base: THREE.Color, vary: number, rng: Rng, topLighten = 0.18) {
  geo.computeBoundingBox()
  const bb = geo.boundingBox!
  const h = Math.max(0.001, bb.max.y - bb.min.y)
  const count = geo.attributes.position.count
  const colors = new Float32Array(count * 3)
  const c = new THREE.Color()
  for (let i = 0; i < count; i++) {
    const y = geo.attributes.position.getY(i)
    const t = (y - bb.min.y) / h
    c.copy(base)
    c.multiplyScalar(1 + (rng() - 0.5) * vary)
    c.lerp(new THREE.Color('#f2fbf4'), t * topLighten * 0.5)
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return geo
}

function tint(geo: THREE.BufferGeometry, r: number, g: number, b: number) {
  const col = geo.attributes.color as THREE.BufferAttribute
  for (let i = 0; i < col.count; i++) {
    col.setXYZ(i, col.getX(i) * r, col.getY(i) * g, col.getZ(i) * b)
  }
  return geo
}

function pickF<T,>(arr: T[], rng: Rng): T { return arr[Math.floor(rng() * arr.length)] }
function rand(a: number, b: number, rng: Rng) { return a + rng() * (b - a) }

/** taper a tube geometry along its curve (uv.y runs 0..1 along length) */
function taperTube(geo: THREE.BufferGeometry, curve: THREE.Curve<THREE.Vector3>, tipScale: number, tipRound: boolean) {
  const p = geo.attributes.position as THREE.BufferAttribute
  const uv = geo.attributes.uv as THREE.BufferAttribute
  const v = new THREE.Vector3()
  const center = new THREE.Vector3()
  for (let i = 0; i < p.count; i++) {
    const t = uv.getY(i)
    v.fromBufferAttribute(p, i)
    curve.getPointAt(Math.min(0.999, t), center)
    const k = 1 + (tipScale - 1) * (tipRound ? Math.sin(t * Math.PI * 0.5) : t)
    v.sub(center).multiplyScalar(k).add(center)
    p.setXYZ(i, v.x, v.y, v.z)
  }
  geo.computeVertexNormals()
}

// ---------------- shader sway injection (same water as the rest of the ocean) ---
function addSway(mat: THREE.Material, swayAmp: number, wobbleFreq: number, cacheKey: string) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = sharedUniforms.uTime
    shader.uniforms.uFieldPos = sharedUniforms.uFieldPos
    shader.uniforms.uFieldDir = sharedUniforms.uFieldDir
    shader.uniforms.uFieldStrength = sharedUniforms.uFieldStrength
    shader.uniforms.uFieldRadius = sharedUniforms.uFieldRadius
    shader.uniforms.uSwayAmp = { value: swayAmp }
    shader.uniforms.uWobbleFreq = { value: wobbleFreq }

    shader.vertexShader = `
      uniform float uTime, uSwayAmp, uWobbleFreq, uFieldStrength, uFieldRadius;
      uniform vec3 uFieldPos, uFieldDir;
    ` + shader.vertexShader

    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
      #include <begin_vertex>
      {
        vec4 wp4 = modelMatrix * vec4(transformed, 1.0);
        float hF = clamp(uv.y, 0.0, 1.0); hF *= hF;
        float sway = sin(uTime * uWobbleFreq + wp4.x * 0.5 + wp4.z * 0.5) * uSwayAmp
                   + sin(uTime * uWobbleFreq * 1.73 + wp4.z * 1.1) * uSwayAmp * 0.4;
        float dField = distance(wp4.xyz, uFieldPos);
        float infl = smoothstep(uFieldRadius * 1.7, 0.0, dField) * uFieldStrength;
        vec2 bend = vec2(sway, 0.0);
        bend += uFieldDir.xz * infl * 0.85;
        bend.x += sin(uTime * 2.3 + wp4.z * 1.3) * infl * 0.35;
        transformed.x += bend.x * hF;
        transformed.z += bend.y * hF;
        transformed.y -= dot(bend, bend) * hF * hF * 0.5;
      }
    `)
  }
  mat.customProgramCacheKey = () => cacheKey
}

// =================================================================
// coral family builders (reference-art accurate)
// =================================================================

/** THE hero of the reference: 3-5 stacked sage/teal table discs on a trunk */
function makeTableStack(rng: Rng): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const palette = ['#6fae84', '#4f948c', '#7fb08a', '#63a892', '#8fbc96']
  const base = new THREE.Color(pickF(palette, rng))
  const trunkCol = new THREE.Color('#877a5c')

  const h = 1.1 + rng() * 1.3
  const trunk = new THREE.CylinderGeometry(0.13, 0.22, h, 8, 3)
  trunk.translate(0, h / 2, 0)
  parts.push(paint(trunk, trunkCol, 0.2, rng, 0.05))

  const levels = 3 + Math.floor(rng() * 3)          // 3..5 discs
  let y = h * rand(0.62, 0.75, rng)
  let r = 1.15 + rng() * 0.65
  const lobes = 3 + Math.floor(rng() * 3)

  for (let l = 0; l < levels; l++) {
    const disc = new THREE.CylinderGeometry(r, r * 0.93, 0.11 + r * 0.05, 30, 1)
    const p = disc.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i)
      const d = Math.hypot(x, z) / r
      const a = Math.atan2(z, x)
      p.setY(i, p.getY(i)
        + Math.sin(a * lobes + l * 1.7) * 0.085 * r * d
        + Math.sin(a * (lobes * 3 + 2) + l) * 0.03 * r * d
        - d * d * d * 0.07 * r)                     // rim droops toward the sand
    }
    disc.computeVertexNormals()
    // underside shading reads as soft shadow under the table
    paint(disc, base, 0.16, rng, 0.14)
    {
      const nn = disc.attributes.normal as THREE.BufferAttribute
      const cc = disc.attributes.color as THREE.BufferAttribute
      for (let i = 0; i < nn.count; i++) {
        if (nn.getY(i) < -0.3) cc.setXYZ(i, cc.getX(i) * 0.55, cc.getY(i) * 0.6, cc.getZ(i) * 0.58)
      }
    }
    disc.rotateX(rand(-0.09, 0.09, rng))
    disc.rotateZ(rand(-0.09, 0.09, rng))
    disc.translate(rand(-0.14, 0.14, rng), y, rand(-0.14, 0.14, rng))
    parts.push(disc)

    // support struts from the trunk up to the lowest disc rim
    if (l === 0) {
      for (let s = 0; s < 3; s++) {
        const a = (s / 3) * Math.PI * 2 + rng()
        const strut = new THREE.CylinderGeometry(0.035, 0.05, y * 0.8, 5, 1)
        strut.translate(0, y * 0.4, 0)
        strut.rotateZ(Math.cos(a) * 0.42)
        strut.rotateX(Math.sin(a) * 0.42)
        strut.translate(Math.cos(a) * r * 0.42, 0, Math.sin(a) * r * 0.42)
        parts.push(paint(strut, trunkCol, 0.2, rng, 0.05))
      }
    }

    y += rand(0.28, 0.46, rng)
    r *= rand(0.6, 0.74, rng)
    if (r < 0.3) break
  }
  return mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)), false)!
}

/** periwinkle / lavender grape clusters — the dominant purple balls */
function makeBubbleCoral(rng: Rng): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const palettes = [
    ['#7d9be0', '#a48fe0'], ['#5f7fd0', '#8fa8ec'], ['#b08ad8', '#d893cd'],
    ['#8fb4ea', '#6f92d8'], ['#c39ae0', '#a37ad0'],
  ]
  const [main, accent] = pickF(palettes, rng)
  const subClusters = 1 + Math.floor(rng() * 3)

  for (let s = 0; s < subClusters; s++) {
    const cx = rand(-0.45, 0.45, rng), cz = rand(-0.45, 0.45, rng)
    const R = 0.34 + rng() * 0.24

    // dark base blob the balls sit on
    const blob = new THREE.SphereGeometry(R * 0.85, 9, 7)
    blob.scale(1.25, 0.5, 1.25)
    blob.translate(cx, R * 0.18, cz)
    parts.push(paint(blob, new THREE.Color(main).multiplyScalar(0.42), 0.2, rng, 0))

    const balls = 20 + Math.floor(rng() * 16)
    const mainC = new THREE.Color(main)
    const accC = new THREE.Color(accent)
    for (let i = 0; i < balls; i++) {
      const t = i / balls
      const gy = Math.acos(1 - 1.85 * t)
      const ga = 2.399963 * i + rng() * 0.55
      const dir = new THREE.Vector3(Math.sin(gy) * Math.cos(ga), Math.abs(Math.cos(gy)) * 0.85 + 0.1, Math.sin(gy) * Math.sin(ga))
      const br = (0.085 + rng() * 0.09) * (1.15 - t * 0.35)
      const ball = new THREE.SphereGeometry(br, 7, 5)
      const dist = R * (0.72 + rng() * 0.4)
      ball.scale(1.06, 0.9, 1.06)
      ball.translate(cx + dir.x * dist, R * 0.12 + dir.y * dist * 0.82, cz + dir.z * dist)
      const c = mainC.clone().lerp(accC, rng() * 0.7).multiplyScalar(0.85 + rng() * 0.35)
      parts.push(paint(ball, c, 0.14, rng, 0.1))
    }
  }
  return mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)), false)!
}

/** vivid purple / magenta tube sponges with dark hollow rims */
function makeTubeSponge(rng: Rng): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const palette = ['#7b4fd0', '#c93a8e', '#e06aa0', '#9a5ad0', '#6a3fc0', '#d4509a']
  const base = new THREE.Color(pickF(palette, rng))
  const n = 3 + Math.floor(rng() * 5)

  for (let i = 0; i < n; i++) {
    const r = 0.1 + rng() * 0.14
    const h = 0.6 + rng() * 1.6
    const lean = new THREE.Vector3(rand(-0.3, 0.3, rng), 1, rand(-0.3, 0.3, rng)).normalize()
    const pts = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(lean.x * h * 0.25, h * 0.55, lean.z * h * 0.25),
      new THREE.Vector3(lean.x * h * 0.55, h, lean.z * h * 0.55),
    ]
    const curve = new THREE.CatmullRomCurve3(pts)
    const tube = new THREE.TubeGeometry(curve, 7, r, 9, false)
    taperTube(tube, curve, 1.18, false)             // flared lip
    paint(tube, base, 0.22, rng, 0.12)
    // darken toward the opening → hollow
    {
      const uv = tube.attributes.uv as THREE.BufferAttribute
      const cc = tube.attributes.color as THREE.BufferAttribute
      for (let j = 0; j < uv.count; j++) {
        const t = uv.getY(j)
        if (t > 0.6) {
          const k = (t - 0.6) / 0.4
          cc.setXYZ(j, cc.getX(j) * (1 - k * 0.68), cc.getY(j) * (1 - k * 0.62), cc.getZ(j) * (1 - k * 0.55))
        }
      }
    }
    // dark disc caps the opening
    const cap = new THREE.CircleGeometry(r * 0.94, 9)
    cap.rotateX(-Math.PI / 2)
    const top = pts[2]
    cap.translate(top.x, top.y + 0.005, top.z)
    paint(cap, base.clone().multiplyScalar(0.16), 0.15, rng, 0)

    const a = rng() * Math.PI * 2
    const d = rng() * 0.3
    tube.translate(Math.cos(a) * d, 0, Math.sin(a) * d)
    cap.translate(Math.cos(a) * d, 0, Math.sin(a) * d)
    parts.push(tube, cap)
  }
  return mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)), false)!
}

/** dense cream / salmon finger bundles */
function makeFingerCoral(rng: Rng): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const palette = ['#e8dcc0', '#f0e8d0', '#e0b090', '#d8cba8', '#efdcbc']
  const base = new THREE.Color(pickF(palette, rng))

  const dome = new THREE.SphereGeometry(0.32, 10, 7)
  dome.scale(1.3, 0.55, 1.3)
  parts.push(paint(dome, base.clone().multiplyScalar(0.72), 0.18, rng, 0))

  const fingers = 26 + Math.floor(rng() * 20)
  for (let i = 0; i < fingers; i++) {
    const a = rng() * Math.PI * 2
    const rad = Math.sqrt(rng()) * 0.34
    const h = 0.32 + rng() * 0.55 * (1 - rad * 0.9)
    const r = 0.045 + rng() * 0.035
    const finger = new THREE.CylinderGeometry(r * 0.72, r, h, 6, 1)
    finger.translate(0, h / 2, 0)
    const tilt = 0.16 + rad * 0.85
    finger.rotateZ(Math.cos(a) * tilt)
    finger.rotateX(Math.sin(a) * tilt)
    finger.translate(Math.cos(a) * rad, 0.1, Math.sin(a) * rad)
    parts.push(paint(finger, base, 0.2, rng, 0.4))
    const tip = new THREE.SphereGeometry(r * 0.74, 6, 5)
    tip.translate(Math.cos(a) * (rad + Math.sin(tilt) * h * 0.9), 0.1 + Math.cos(tilt) * h, Math.sin(a) * (rad + Math.sin(tilt) * h * 0.9))
    parts.push(paint(tip, base.clone().lerp(new THREE.Color('#fff8e8'), 0.45), 0.12, rng, 0))
  }
  return mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)), false)!
}

/** long sinuous crimson sea whips */
function makeRedWhip(rng: Rng): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const palette = ['#d02040', '#b01838', '#e03050', '#c22848']
  const base = new THREE.Color(pickF(palette, rng))
  const blades = 1 + Math.floor(rng() * 3)

  for (let b = 0; b < blades; b++) {
    const h = 2.2 + rng() * 2.0
    const amp = 0.28 + rng() * 0.34
    const freq = 1.2 + rng() * 1.1
    const ph = rng() * Math.PI * 2
    const pts: THREE.Vector3[] = []
    const n = 7
    for (let i = 0; i <= n; i++) {
      const t = i / n
      pts.push(new THREE.Vector3(
        Math.sin(t * Math.PI * freq + ph) * amp * t,
        h * t,
        Math.cos(t * Math.PI * freq * 0.8 + ph) * amp * 0.6 * t,
      ))
    }
    const curve = new THREE.CatmullRomCurve3(pts)
    const whip = new THREE.TubeGeometry(curve, 16, 0.05 + rng() * 0.026, 6, false)
    taperTube(whip, curve, 0.15, true)
    paint(whip, base, 0.2, rng, 0.3)
    // tiny side polyp nubs
    const nubs = 5 + Math.floor(rng() * 5)
    for (let i = 0; i < nubs; i++) {
      const t = 0.25 + rng() * 0.7
      const c = curve.getPointAt(t)
      const nub = new THREE.SphereGeometry(0.035 + rng() * 0.02, 5, 4)
      nub.translate(c.x + rand(-0.06, 0.06, rng), c.y, c.z + rand(-0.06, 0.06, rng))
      parts.push(paint(nub, base.clone().multiplyScalar(1.2), 0.15, rng, 0.2))
    }
    const a = rng() * Math.PI * 2
    const d = rng() * 0.24
    whip.translate(Math.cos(a) * d, 0, Math.sin(a) * d)
    parts.push(whip)
  }
  return mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)), false)!
}

/** the signature cyan spiral curls (fern-crozier whips) */
function makeSpiralWhip(rng: Rng): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const palette = ['#40b8c9', '#35a0b8', '#58ccd8', '#2f98ac']
  const base = new THREE.Color(pickF(palette, rng))
  const strands = 1 + Math.floor(rng() * 3)

  for (let s = 0; s < strands; s++) {
    const h1 = 0.8 + rng() * 0.9
    const R0 = 0.24 + rng() * 0.2
    const turns = 1.5 + rng() * 1.2
    const pts: THREE.Vector3[] = []
    const N = 26
    const ox = rand(-0.1, 0.1, rng), oz = rand(-0.1, 0.1, rng)
    for (let i = 0; i <= N; i++) {
      const t = i / N
      if (t < 0.42) {
        // stem: rises with a lazy lean
        const k = t / 0.42
        pts.push(new THREE.Vector3(ox + Math.sin(k * 2.2) * 0.05, h1 * k, oz + Math.cos(k * 1.7) * 0.05))
      } else {
        // crozier: flat inward spiral in the vertical plane
        const k = (t - 0.42) / 0.58
        const th = -Math.PI / 2 + k * turns * Math.PI * 2
        const R = R0 * (1 - k * 0.82)
        pts.push(new THREE.Vector3(
          ox + Math.cos(th) * R,
          h1 + R0 + Math.sin(th) * R,
          oz + Math.sin(k * 9) * 0.02,
        ))
      }
    }
    const curve = new THREE.CatmullRomCurve3(pts)
    const whip = new THREE.TubeGeometry(curve, 40, 0.02 + rng() * 0.014, 5, false)
    taperTube(whip, curve, 0.12, true)
    paint(whip, base, 0.18, rng, 0.35)
    const a = rng() * Math.PI * 2
    const d = rng() * 0.22
    whip.rotateY(rand(0, Math.PI * 2, rng))         // random curl facing
    whip.translate(Math.cos(a) * d, 0, Math.sin(a) * d)
    parts.push(whip)
  }
  return mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)), false)!
}

/** mossy green mound — the rocky base every bommie stands on */
function makeGreenMound(rng: Rng, size: number): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(size, 2)
  const p = geo.attributes.position as THREE.BufferAttribute
  const v = new THREE.Vector3()
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i)
    const n = fbm2(v.x * 0.9 + size, v.y * 0.9 + v.z * 1.2, 3)
    const n2 = fbm2(v.z * 2.1 - size, v.x * 1.6, 2)
    v.multiplyScalar(1 + n * 0.3 + n2 * 0.14)
    p.setXYZ(i, v.x, Math.max(0.02, v.y) * 0.62, v.z)   // flatten into a dome
  }
  geo.computeVertexNormals()
  const rock = new THREE.Color('#4d6555')
  const algae = new THREE.Color('#6d8f6a')
  const teal = new THREE.Color('#3f6b60')
  const pos = geo.attributes.position as THREE.BufferAttribute
  const arr = new Float32Array(pos.count * 3)
  const c = new THREE.Color()
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i)
    c.copy(rock).multiplyScalar(0.82 + fbm2(x * 1.1, (y + z) * 1.1, 2) * 0.4)
    const patch = fbm2(x * 0.7 - size, (y * 0.8 + z) * 0.7 + size, 3)
    if (patch > 0.05) c.lerp(algae, Math.min(1, (patch - 0.05) * 3.4) * 0.62)
    const tealP = fbm2(z * 0.9 + size * 2, (x - y) * 0.9, 2)
    if (tealP > 0.18) c.lerp(teal, Math.min(1, (tealP - 0.18) * 3) * 0.5)
    arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3))
  return geo
}

/** big lavender anemone with pale-tipped tentacles (clownfish host) */
function makeAnemoneBig(rng: Rng): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const tent = new THREE.Color(pickF(['#c9a8e0', '#e0a0c0', '#b898dd'], rng))
  const disc = new THREE.CylinderGeometry(0.42, 0.52, 0.2, 12)
  disc.translate(0, 0.1, 0)
  parts.push(paint(disc, new THREE.Color('#8a5f6a'), 0.15, rng, 0.1))
  const n = 44 + Math.floor(rng() * 14)
  const up = new THREE.Vector3(0, 1, 0)
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng() * 0.3
    const tilt = 0.2 + rng() * 0.34
    const dir = new THREE.Vector3(Math.cos(a) * tilt, 1, Math.sin(a) * tilt).normalize()
    const h = 0.5 + rng() * 0.36
    const t = new THREE.ConeGeometry(0.042, h, 5, 2)
    t.translate(0, h / 2, 0)
    t.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, dir))
    const ox = Math.cos(a) * 0.24, oz = Math.sin(a) * 0.24
    t.translate(ox, 0.16, oz)
    parts.push(paint(t, tent, 0.25, rng, 0.55))
    const tip = new THREE.SphereGeometry(0.05, 5, 4)
    tip.translate(ox + dir.x * h, 0.16 + dir.y * h, oz + dir.z * h)
    parts.push(paint(tip, tent.clone().lerp(new THREE.Color('#ffffff'), 0.6), 0.1, rng, 0))
  }
  return mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)), false)!
}

// =================================================================
// ReefArena system
// =================================================================
interface FamilySpec {
  make: (rng: Rng) => THREE.BufferGeometry
  sway?: [number, number]
  collide?: number
}

const FAMILIES: Record<string, FamilySpec> = {
  table:   { make: makeTableStack, collide: 0.72 },
  bubble:  { make: makeBubbleCoral, collide: 0.5 },
  sponge:  { make: makeTubeSponge, collide: 0.4 },
  finger:  { make: makeFingerCoral, collide: 0.42 },
  redwhip: { make: makeRedWhip, sway: [0.05, 0.8] },
  spiral:  { make: makeSpiralWhip, sway: [0.045, 0.9] },
  anemone: { make: makeAnemoneBig, sway: [0.03, 1.4] },
}

interface Mound { x: number; z: number; R: number; H: number }

export class ReefArena {
  group = new THREE.Group()
  obstacles: Obstacle[] = []
  anemonePositions: THREE.Vector3[] = []
  counts: Record<string, number> = {}

  constructor(scene: THREE.Scene, private heightAt: (x: number, z: number) => number) {
    this.build()
    scene.add(this.group)
  }

  /** ground height including any bommie mound sitting at (x,z) */
  private moundAt: Mound[] = []
  private groundAt(x: number, z: number) {
    let y = this.heightAt(x, z)
    for (const m of this.moundAt) {
      const d = Math.hypot(x - m.x, z - m.z)
      if (d < m.R) y += m.H * 0.92 * Math.sqrt(1 - (d / m.R) ** 2)
    }
    return y
  }

  private build() {
    const rng = mulberry32(3434001)
    const buckets: Record<string, THREE.BufferGeometry[]> = {}
    for (const key of Object.keys(FAMILIES)) { buckets[key] = []; this.counts[key] = 0 }
    const mounds: THREE.BufferGeometry[] = []

    const place = (kind: string, x: number, z: number, scale: number, sink = 0.1) => {
      const geo = FAMILIES[kind].make(rng)
      geo.scale(scale, scale, scale)
      geo.rotateY(rng() * Math.PI * 2)
      geo.rotateX(rand(-0.05, 0.05, rng))
      geo.rotateZ(rand(-0.05, 0.05, rng))
      geo.translate(x, this.groundAt(x, z) - sink, z)
      buckets[kind].push(geo)
      this.counts[kind]++
    }

    const addMound = (x: number, z: number, R: number, H: number) => {
      const g = makeGreenMound(rng, R)
      g.rotateY(rng() * Math.PI * 2)
      g.translate(x, this.heightAt(x, z) - H * 0.1, z)
      mounds.push(g)
      this.moundAt.push({ x, z, R: R * 0.98, H })
      if (R > 1.6) this.obstacles.push({ x, y: this.heightAt(x, z) + H * 0.5, z, r: R * 0.92 })
    }

    // ---------- ring A — the main reef wall (12 bommies, 4 sand channels) ----------
    for (let slot = 0; slot < 16; slot++) {
      if (slot % 4 === 2) continue                      // channels SW/SE/NW/NE-ish
      const a = (slot / 16) * Math.PI * 2 + rand(-0.05, 0.05, rng)
      const r = 30 + rand(-3.5, 4, rng)
      const x = CX + Math.cos(a) * r
      const z = CZ + Math.sin(a) * r

      const R = rand(2.4, 3.6, rng)
      const H = rand(1.8, 3.6, rng)
      addMound(x, z, R, H)

      // hero table stack right on the crown
      place('table', x + rand(-0.6, 0.6, rng), z + rand(-0.6, 0.6, rng), rand(1.9, 2.8, rng), 0.3)
      if (rng() < 0.5) place('table', x + rand(-1.6, 1.6, rng), z + rand(-1.6, 1.6, rng), rand(1.1, 1.6, rng), 0.1)
      // entourage around the flank
      place('bubble', x + rand(-1.9, 1.9, rng), z + rand(-1.9, 1.9, rng), rand(1.3, 2.0, rng))
      place('bubble', x + rand(-2.2, 2.2, rng), z + rand(-2.2, 2.2, rng), rand(1.1, 1.7, rng))
      place('sponge', x + rand(-2, 2, rng), z + rand(-2, 2, rng), rand(1.2, 1.9, rng))
      place('sponge', x + rand(-2.2, 2.2, rng), z + rand(-2.2, 2.2, rng), rand(1.1, 1.7, rng))
      place('finger', x + rand(-2, 2, rng), z + rand(-2, 2, rng), rand(1.4, 2.2, rng))
      place(rng() < 0.55 ? 'redwhip' : 'spiral', x + rand(-2.1, 2.1, rng), z + rand(-2.1, 2.1, rng), rand(1.2, 1.8, rng))
      if (rng() < 0.7) place('spiral', x + rand(-2.3, 2.3, rng), z + rand(-2.3, 2.3, rng), rand(1.1, 1.7, rng))
      if (rng() < 0.55) place('redwhip', x + rand(-2.3, 2.3, rng), z + rand(-2.3, 2.3, rng), rand(1.1, 1.7, rng))
      if (rng() < 0.8) {
        place('anemone', x + rand(-1.7, 1.7, rng), z + rand(-1.7, 1.7, rng), rand(0.9, 1.3, rng))
        const ap = new THREE.Vector3(x, this.heightAt(x, z) + 0.5, z)
        this.anemonePositions.push(ap)
      }
      // small table accents at the foot
      if (rng() < 0.6) place('table', x + rand(-3, 3, rng), z + rand(-3, 3, rng), rand(0.8, 1.2, rng), 0.06)
    }

    // ---------- between the rings — scattered filler colonies ----------
    for (let i = 0; i < 34; i++) {
      const a = rng() * Math.PI * 2
      const r = 36 + rng() * 9
      const x = CX + Math.cos(a) * r
      const z = CZ + Math.sin(a) * r
      place(pickF(['bubble', 'sponge', 'finger', 'spiral', 'redwhip'], rng), x, z, rand(0.8, 1.4, rng), 0.06)
    }

    // ---------- clearing edge — low foreground accents framing the sand ----------
    for (let i = 0; i < 9; i++) {
      const a = rng() * Math.PI * 2
      const r = 25.5 + rng() * 3
      const x = CX + Math.cos(a) * r
      const z = CZ + Math.sin(a) * r
      const kind = pickF(['bubble', 'sponge', 'spiral', 'finger'], rng)
      place(kind, x, z, rand(0.9, 1.4, rng), 0.05)
      if (kind === 'anemone') this.anemonePositions.push(new THREE.Vector3(x, this.heightAt(x, z) + 0.4, z))
    }

    // ---------- sand channels — whips & curls line the paths ----------
    for (let c = 0; c < 4; c++) {
      const base = ((c * 4 + 2) / 16) * Math.PI * 2
      for (let i = 0; i < 5; i++) {
        const a = base + rand(-0.09, 0.09, rng)
        const r = 26 + i * rand(5, 7.5, rng)
        const x = CX + Math.cos(a) * r
        const z = CZ + Math.sin(a) * r
        place(pickF(['redwhip', 'spiral', 'bubble'], rng), x, z, rand(0.7, 1.15, rng), 0.05)
      }
    }

    // ---------- ring B — secondary reef (bigger, sparser) ----------
    for (let slot = 0; slot < 10; slot++) {
      const a = ((slot + 0.5) / 10) * Math.PI * 2 + rand(-0.07, 0.07, rng)
      const r = 51 + rand(-4, 6, rng)
      const x = CX + Math.cos(a) * r
      const z = CZ + Math.sin(a) * r

      const R = rand(3.2, 4.6, rng)
      const H = rand(2.2, 3.8, rng)
      addMound(x, z, R, H)

      place('table', x + rand(-0.8, 0.8, rng), z + rand(-0.8, 0.8, rng), rand(2.8, 4.0, rng), 0.4)
      place('bubble', x + rand(-2.6, 2.6, rng), z + rand(-2.6, 2.6, rng), rand(1.6, 2.4, rng))
      place('sponge', x + rand(-2.8, 2.8, rng), z + rand(-2.8, 2.8, rng), rand(1.5, 2.2, rng))
      place('finger', x + rand(-2.6, 2.6, rng), z + rand(-2.6, 2.6, rng), rand(1.7, 2.6, rng))
      place(rng() < 0.5 ? 'redwhip' : 'spiral', x + rand(-2.8, 2.8, rng), z + rand(-2.8, 2.8, rng), rand(1.5, 2.2, rng))
      if (rng() < 0.6) place('table', x + rand(-3.6, 3.6, rng), z + rand(-3.6, 3.6, rng), rand(1.3, 2.0, rng), 0.08)
    }

    // ---------- ring C — distant giant silhouettes fading into the blue ----------
    for (let slot = 0; slot < 10; slot++) {
      const a = (slot / 10) * Math.PI * 2 + rand(-0.1, 0.1, rng)
      const r = 73 + rand(-5, 9, rng)
      const x = CX + Math.cos(a) * r
      const z = CZ + Math.sin(a) * r

      const R = rand(4.5, 6.5, rng)
      const H = rand(3.5, 6, rng)
      addMound(x, z, R, H)
      place('table', x, z, rand(3.8, 5.2, rng), 0.5)
      if (rng() < 0.7) place('sponge', x + rand(-3.5, 3.5, rng), z + rand(-3.5, 3.5, rng), rand(2.0, 3.0, rng))
      if (rng() < 0.6) place('finger', x + rand(-3.5, 3.5, rng), z + rand(-3.5, 3.5, rng), rand(2.2, 3.2, rng))
    }
    // ring-C haze: geometries are tinted per-vertex at merge time below

    // ---------- merge per family ----------
    const mats: Record<string, THREE.Material> = {}
    for (const key of Object.keys(buckets)) {
      const list = buckets[key]
      if (!list.length) continue
      const fam = FAMILIES[key]
      const merged = mergeGeometries(list, false)!

      // horizon haze: drown corals far from the arena centre toward ring-C blue
      const p = merged.attributes.position as THREE.BufferAttribute
      const col = merged.attributes.color as THREE.BufferAttribute
      for (let i = 0; i < p.count; i++) {
        const d = Math.hypot(p.getX(i) - CX, p.getZ(i) - CZ)
        const haze = THREE.MathUtils.clamp((d - 46) / 34, 0, 1)
        if (haze > 0) {
          const k = 1 - haze * 0.62
          col.setXYZ(i, col.getX(i) * k, col.getY(i) * (k + haze * 0.16), col.getZ(i) * (k + haze * 0.26))
        }
      }

      const mat = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.86,
        metalness: 0.02,
      })
      if (fam.sway) addSway(mat, fam.sway[0], fam.sway[1], `arena-sway-${key}`)
      mats[key] = mat
      const mesh = new THREE.Mesh(merged, mat)
      this.group.add(mesh)
    }

    // mounds — one merged mossy mesh
    if (mounds.length) {
      const merged = mergeGeometries(mounds.map((g) => (g.index ? g.toNonIndexed() : g)), false)!
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0.01 })
      this.group.add(new THREE.Mesh(merged, mat))
    }
  }

  /** QA summary */
  stats() {
    return { ...this.counts, mounds: this.moundAt.length, obstacles: this.obstacles.length }
  }
}
