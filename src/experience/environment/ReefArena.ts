// ---------------------------------------------------------------
// ReefArena — the 360° coral colosseum (high-detail edition).
// A circular reef wall surrounds a bright sandy clearing so the
// scene reads beautifully from EVERY heading (visitors walk a
// full circle around the projection room).
//
// DETAIL TIERS — builders take a detail tier so poly budget is
// spent where visitors actually look:
//   ring A (r 26-34, closest)   → det 2 heroes (~7k tris/piece)
//   filler / clearing / ring B  → det 1 mid
//   channels / ring C (distant) → det 0 silhouettes
//
// MATERIALS — per-family physical materials (wet clearcoat on
// sponges & bubble grapes, matte stone tables) + a camera-
// relative DEEP-BLUE SILHOUETTE stage that darkens the arena
// edges into reference-art depth-of-field silhouettes.
//
// SPONGE BUBBLES — every tube sponge exports its osculum lip
// positions; SpongeBubbles emits fine bubble streams from them.
// ---------------------------------------------------------------
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { sharedUniforms } from '../core/sharedUniforms'
import { mulberry32, fbm2 } from '../utils/math'
import { injectSilhouette } from './depthSilhouette'
import { injectCaustic } from './causticInject'
import {
  makeTableStack, makeBubbleCoral, makeTubeSponge, makeFingerCoral,
  makeRedWhip, makeSpiralWhip, makeAnemoneBig, makeGreenMound,
  makeStaghornBush, makeFirePlate, makeClam, makeFeatherStar,
  paint, pickF, rand, type Rng, type Det,
} from './ReefCorals'
import type { Obstacle } from './Rocks'

// arena centre matches the seabed focus + camera gaze target
const CX = 0
const CZ = -20

// ---------------- shader sway injection (gesture-reactive) ------
function swayInjections(shader: THREE.WebGLProgramParametersWithUniforms, swayAmp: number, wobbleFreq: number) {
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

// ---------------- per-family material behaviour ------------------
interface MatSpec {
  rough: number
  metal?: number
  /** clearcoat strength — wet glossy families */
  clear?: number
  clearRough?: number
  side?: THREE.Side
}

const MATSPEC: Record<string, MatSpec> = {
  table:   { rough: 0.82 },
  staghorn: { rough: 0.72 },
  bubble:  { rough: 0.34, clear: 0.65, clearRough: 0.22 },
  sponge:  { rough: 0.5, clear: 0.5, clearRough: 0.3, side: THREE.DoubleSide },
  finger:  { rough: 0.78 },
  redwhip: { rough: 0.62, clear: 0.25, clearRough: 0.35 },
  spiral:  { rough: 0.6, clear: 0.3, clearRough: 0.35 },
  anemone: { rough: 0.55 },
  // stage 7 species
  fireplate: { rough: 0.58, clear: 0.3, clearRough: 0.3 },   // wet hydrocoran sheen
  clam:      { rough: 0.3, clear: 0.7, clearRough: 0.18 },   // glossy nacre shell
  feather:   { rough: 0.66 },
}

function arenaMaterial(key: string, spec: MatSpec, sway: [number, number] | undefined): THREE.Material {
  const base = {
    vertexColors: true,
    roughness: spec.rough,
    metalness: spec.metal ?? 0.02,
  }
  const mat = spec.clear
    ? new THREE.MeshPhysicalMaterial({ ...base, clearcoat: spec.clear, clearcoatRoughness: spec.clearRough ?? 0.25 })
    : new THREE.MeshStandardMaterial(base)
  if (spec.side) mat.side = spec.side
  mat.onBeforeCompile = (shader) => {
    if (sway) swayInjections(shader, sway[0], sway[1])
    // Stage 6: the water-caustic light dance now lives ON the reef
    // surfaces themselves — every heading sees shimmering walls
    injectCaustic(shader, { scale: 0.45, strength: 0.52 })
    // the deep-blue silhouette: distant reef melts into dark shapes
    injectSilhouette(shader, { start: 42, end: 112, k: 0.58, color: '#0f4468' })
  }
  mat.customProgramCacheKey = () => `arena-${key}`
  return mat
}

// =================================================================
// ReefArena system
// =================================================================
interface FamilySpec {
  make: (rng: Rng, det: Det, out?: { lips: THREE.Vector3[] }) => THREE.BufferGeometry
  sway?: [number, number]
  collide?: number
}

const FAMILIES: Record<string, FamilySpec> = {
  table:   { make: (r, d) => makeTableStack(r, d), collide: 0.72 },
  staghorn: { make: (r, d) => makeStaghornBush(r, d), collide: 0.55 },
  bubble:  { make: (r, d) => makeBubbleCoral(r, d), collide: 0.5 },
  sponge:  { make: (r, d, o) => makeTubeSponge(r, d, o), collide: 0.4 },
  finger:  { make: (r, d) => makeFingerCoral(r, d), collide: 0.42 },
  redwhip: { make: (r, d) => makeRedWhip(r, d), sway: [0.05, 0.8] },
  spiral:  { make: (r, d) => makeSpiralWhip(r, d), sway: [0.045, 0.9] },
  anemone: { make: (r, d) => makeAnemoneBig(r, d), sway: [0.03, 1.4] },
  // stage 7 — new species, distributed around the FULL circle so
  // every heading (front AND behind the camera) gets them
  fireplate: { make: (r, d) => makeFirePlate(r, d), collide: 0.5 },
  clam:      { make: (r, d) => makeClam(r, d), collide: 0.45 },
  feather:   { make: (r, d) => makeFeatherStar(r, d), sway: [0.035, 1.2] },
}

interface Mound { x: number; z: number; R: number; H: number }

const AY = new THREE.Vector3(0, 1, 0)
const AX = new THREE.Vector3(1, 0, 0)
const AZ = new THREE.Vector3(0, 0, 1)

export class ReefArena {
  group = new THREE.Group()
  obstacles: Obstacle[] = []
  anemonePositions: THREE.Vector3[] = []
  /** world-space tube-sponge osculum positions (bubble emitters) */
  spongeLips: THREE.Vector3[] = []
  counts: Record<string, number> = {}
  /** QA: world position of every placed piece, per family */
  piecePos: Record<string, THREE.Vector3[]> = {}
  tris = 0

  constructor(scene: THREE.Scene, private heightAt: (x: number, z: number) => number, tier: 'high' | 'medium' | 'low' = 'high') {
    // Stage 9 — tier-scaled ring detail: the colosseum previously built
    // at FULL poly on every device (2.8M+ tris) which swamps phones and
    // software renderers. Heroes stay rich on low tiers; far rings and
    // fillers degrade first — silhouettes still read perfectly.
    this.det = tier === 'low'
      ? { hero: 1, mid: 0, far: 0, filler: 0, rubble: false }
      : tier === 'medium'
        ? { hero: 2, mid: 1, far: 0, filler: 1, rubble: true }
        : { hero: 2, mid: 1, far: 0, filler: 1, rubble: true }
    this.build()
    scene.add(this.group)
  }

  private det: { hero: Det; mid: Det; far: Det; filler: Det; rubble: boolean }

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
    for (const key of Object.keys(FAMILIES)) { buckets[key] = []; this.counts[key] = 0; this.piecePos[key] = [] }
    const mounds: THREE.BufferGeometry[] = []
    const rubble: THREE.BufferGeometry[] = []

    const place = (kind: string, x: number, z: number, scale: number, sink = 0.1, det: Det = 1) => {
      const lips: THREE.Vector3[] = []
      const geo = FAMILIES[kind].make(rng, det, { lips })
      geo.scale(scale, scale, scale)
      const ry = rng() * Math.PI * 2
      const rx = rand(-0.05, 0.05, rng)
      const rz = rand(-0.05, 0.05, rng)
      geo.rotateY(ry)
      geo.rotateX(rx)
      geo.rotateZ(rz)
      const gy = this.groundAt(x, z) - sink
      geo.translate(x, gy, z)
      buckets[kind].push(geo)
      this.counts[kind]++
      this.piecePos[kind]?.push(new THREE.Vector3(x, gy, z))
      // transform the sponge osculum lips with the very same matrix
      // sequence so bubble emitters land exactly at each opening
      for (const lp of lips) {
        lp.multiplyScalar(scale)
        lp.applyAxisAngle(AY, ry)
        lp.applyAxisAngle(AX, rx)
        lp.applyAxisAngle(AZ, rz)
        lp.add(new THREE.Vector3(x, gy, z))
        this.spongeLips.push(lp)
      }
    }

    const addMound = (x: number, z: number, R: number, H: number, det: Det) => {
      const g = makeGreenMound(rng, R, det)
      g.rotateY(rng() * Math.PI * 2)
      g.translate(x, this.heightAt(x, z) - H * 0.1, z)
      mounds.push(g)
      this.moundAt.push({ x, z, R: R * 0.98, H })
      if (R > 1.6) this.obstacles.push({ x, y: this.heightAt(x, z) + H * 0.5, z, r: R * 0.92 })
      // rubble scattered around near-ring mound feet
      if (det === 2 && this.det.rubble) {
        const n = 5 + Math.floor(rng() * 5)
        for (let i = 0; i < n; i++) {
          const a = rng() * Math.PI * 2
          const d = R * (0.75 + rng() * 0.55)
          const rock = new THREE.IcosahedronGeometry(0.09 + rng() * 0.26, 1)
          const rp = rock.attributes.position as THREE.BufferAttribute
          for (let j = 0; j < rp.count; j++) {
            rp.setY(j, rp.getY(j) * (0.55 + rng() * 0.3))
          }
          rock.computeVertexNormals()
          rock.rotateY(rng() * Math.PI * 2)
          rock.translate(x + Math.cos(a) * d, this.groundAt(x + Math.cos(a) * d, z + Math.sin(a) * d) + 0.02, z + Math.sin(a) * d)
          rubble.push(paint(rock, new THREE.Color(pickF(['#5f7a68', '#6b8272', '#55705f'], rng)), 0.3, rng, 0.25))
        }
      }
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
      addMound(x, z, R, H, this.det.hero)

      // hero table stack right on the crown
      place('table', x + rand(-0.6, 0.6, rng), z + rand(-0.6, 0.6, rng), rand(1.9, 2.8, rng), 0.3, this.det.hero)
      if (rng() < 0.5) place('table', x + rand(-1.6, 1.6, rng), z + rand(-1.6, 1.6, rng), rand(1.1, 1.6, rng), 0.1, this.det.mid)
      // v3: hero staghorn bushes — the signature reference species,
      // previously absent from the arena wall entirely
      place('staghorn', x + rand(-1.3, 1.3, rng), z + rand(-1.3, 1.3, rng), rand(1.5, 2.3, rng), 0.12, this.det.hero)
      if (rng() < 0.55) place('staghorn', x + rand(-2, 2, rng), z + rand(-2, 2, rng), rand(1.1, 1.7, rng), 0.1, this.det.mid)
      // entourage around the flank
      place('bubble', x + rand(-1.9, 1.9, rng), z + rand(-1.9, 1.9, rng), rand(1.3, 2.0, rng), 0.1, this.det.hero)
      place('bubble', x + rand(-2.2, 2.2, rng), z + rand(-2.2, 2.2, rng), rand(1.1, 1.7, rng), 0.1, this.det.mid)
      place('sponge', x + rand(-2, 2, rng), z + rand(-2, 2, rng), rand(1.2, 1.9, rng), 0.1, this.det.hero)
      place('sponge', x + rand(-2.2, 2.2, rng), z + rand(-2.2, 2.2, rng), rand(1.1, 1.7, rng), 0.1, this.det.mid)
      place('finger', x + rand(-2, 2, rng), z + rand(-2, 2, rng), rand(1.4, 2.2, rng), 0.1, this.det.hero)
      place('finger', x + rand(-2.4, 2.4, rng), z + rand(-2.4, 2.4, rng), rand(1.0, 1.5, rng), 0.08, this.det.mid)
      place(rng() < 0.55 ? 'redwhip' : 'spiral', x + rand(-2.1, 2.1, rng), z + rand(-2.1, 2.1, rng), rand(1.2, 1.8, rng), 0.1, this.det.hero)
      if (rng() < 0.7) place('spiral', x + rand(-2.3, 2.3, rng), z + rand(-2.3, 2.3, rng), rand(1.1, 1.7, rng), 0.1, this.det.mid)
      if (rng() < 0.55) place('redwhip', x + rand(-2.3, 2.3, rng), z + rand(-2.3, 2.3, rng), rand(1.1, 1.7, rng), 0.1, this.det.mid)
      if (rng() < 0.8) {
        place('anemone', x + rand(-1.7, 1.7, rng), z + rand(-1.7, 1.7, rng), rand(0.9, 1.3, rng), 0.1, this.det.hero)
        const ap = new THREE.Vector3(x, this.heightAt(x, z) + 0.5, z)
        this.anemonePositions.push(ap)
      }
      // stage 7 accents — every hero bommie gets a fire plate + odds of
      // a clam and a feather star (spread across ALL slots = 360°)
      place('fireplate', x + rand(-1.6, 1.6, rng), z + rand(-1.6, 1.6, rng), rand(1.1, 1.7, rng), 0.08, this.det.hero)
      if (rng() < 0.45) place('clam', x + rand(-1.9, 1.9, rng), z + rand(-1.9, 1.9, rng), rand(0.8, 1.3, rng), 0.05, this.det.hero)
      if (rng() < 0.65) place('feather', x + rand(-2.1, 2.1, rng), z + rand(-2.1, 2.1, rng), rand(1.0, 1.6, rng), 0.04, this.det.hero)
      // small table accents at the foot
      if (rng() < 0.6) place('table', x + rand(-3, 3, rng), z + rand(-3, 3, rng), rand(0.8, 1.2, rng), 0.06, 1)
    }

    // ---------- ring A2 — staggered gap-filler sub-ring (r 33-42) ----------
    // small mossy bommies + mid colonies weave the wall continuous so
    // no see-through gaps break the colosseum from any heading
    for (let slot = 0; slot < 14; slot++) {
      const a = ((slot + 0.5) / 14) * Math.PI * 2 + rand(-0.06, 0.06, rng)
      const r = 36.5 + rand(-2.5, 3.5, rng)
      const x = CX + Math.cos(a) * r
      const z = CZ + Math.sin(a) * r
      const R = rand(1.2, 1.9, rng)
      const H = rand(0.9, 1.7, rng)
      addMound(x, z, R, H, this.det.mid)
      place(rng() < 0.4 ? 'table' : 'finger', x + rand(-0.7, 0.7, rng), z + rand(-0.7, 0.7, rng), rand(1.1, 1.7, rng), 0.12, this.det.mid)
      if (rng() < 0.45) place('staghorn', x + rand(-1.1, 1.1, rng), z + rand(-1.1, 1.1, rng), rand(1.0, 1.6, rng), 0.1, this.det.mid)
      place(pickF(['bubble', 'sponge'], rng), x + rand(-1.5, 1.5, rng), z + rand(-1.5, 1.5, rng), rand(1.0, 1.5, rng), 0.08, this.det.mid)
      place(pickF(['spiral', 'redwhip', 'finger'], rng), x + rand(-1.6, 1.6, rng), z + rand(-1.6, 1.6, rng), rand(0.9, 1.4, rng), 0.06, this.det.mid)
      place(pickF(['sponge', 'bubble'], rng), x + rand(-1.8, 1.8, rng), z + rand(-1.8, 1.8, rng), rand(0.9, 1.4, rng), 0.06, this.det.mid)
      if (rng() < 0.5) place('bubble', x + rand(-1.8, 1.8, rng), z + rand(-1.8, 1.8, rng), rand(0.8, 1.2, rng), 0.06, this.det.mid)
      // anti-bolong densify: one more mid colony per sub-ring slot
      place(pickF(['finger', 'redwhip', 'spiral', 'bubble'], rng), x + rand(-2.1, 2.1, rng), z + rand(-2.1, 2.1, rng), rand(0.9, 1.5, rng), 0.06, this.det.mid)
      // stage 7 accents for the sub-ring too
      if (rng() < 0.5) place('fireplate', x + rand(-1.4, 1.4, rng), z + rand(-1.4, 1.4, rng), rand(0.9, 1.4, rng), 0.06, this.det.mid)
      if (rng() < 0.45) place('feather', x + rand(-1.6, 1.6, rng), z + rand(-1.6, 1.6, rng), rand(0.9, 1.4, rng), 0.04, this.det.mid)
    }

    // ---------- between the rings — scattered filler colonies ----------
    for (let i = 0; i < 34; i++) {
      const a = rng() * Math.PI * 2
      const r = 36 + rng() * 9
      const x = CX + Math.cos(a) * r
      const z = CZ + Math.sin(a) * r
      place(pickF(['bubble', 'sponge', 'finger', 'spiral', 'redwhip', 'staghorn', 'staghorn', 'fireplate', 'clam'], rng), x, z, rand(0.8, 1.4, rng), 0.06, this.det.filler)
    }

    // ---------- clearing edge — low foreground accents framing the sand ----------
    for (let i = 0; i < 9; i++) {
      const a = rng() * Math.PI * 2
      const r = 25.5 + rng() * 3
      const x = CX + Math.cos(a) * r
      const z = CZ + Math.sin(a) * r
      const kind = pickF(['bubble', 'sponge', 'spiral', 'finger'], rng)
      place(kind, x, z, rand(0.9, 1.4, rng), 0.05, this.det.filler)
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
        place(pickF(['redwhip', 'spiral', 'bubble'], rng), x, z, rand(0.7, 1.15, rng), 0.05, i < 2 ? this.det.mid : this.det.far)
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
      addMound(x, z, R, H, this.det.mid)

      place('table', x + rand(-0.8, 0.8, rng), z + rand(-0.8, 0.8, rng), rand(2.8, 4.0, rng), 0.4, this.det.mid)
      place('staghorn', x + rand(-2.2, 2.2, rng), z + rand(-2.2, 2.2, rng), rand(1.8, 2.6, rng), 0.12, this.det.mid)
      place('fireplate', x + rand(-2.4, 2.4, rng), z + rand(-2.4, 2.4, rng), rand(1.6, 2.4, rng), 0.1, this.det.mid)
      if (rng() < 0.55) place('clam', x + rand(-2.6, 2.6, rng), z + rand(-2.6, 2.6, rng), rand(1.1, 1.7, rng), 0.06, this.det.mid)
      if (rng() < 0.6) place('feather', x + rand(-2.8, 2.8, rng), z + rand(-2.8, 2.8, rng), rand(1.2, 1.9, rng), 0.05, this.det.mid)
      place('bubble', x + rand(-2.6, 2.6, rng), z + rand(-2.6, 2.6, rng), rand(1.6, 2.4, rng), 0.1, this.det.mid)
      place('sponge', x + rand(-2.8, 2.8, rng), z + rand(-2.8, 2.8, rng), rand(1.5, 2.2, rng), 0.1, this.det.mid)
      place('finger', x + rand(-2.6, 2.6, rng), z + rand(-2.6, 2.6, rng), rand(1.7, 2.6, rng), 0.1, this.det.mid)
      place(rng() < 0.5 ? 'redwhip' : 'spiral', x + rand(-2.8, 2.8, rng), z + rand(-2.8, 2.8, rng), rand(1.5, 2.2, rng), 0.1, this.det.mid)
      place(pickF(['bubble', 'sponge', 'spiral'], rng), x + rand(-3.2, 3.2, rng), z + rand(-3.2, 3.2, rng), rand(1.2, 1.8, rng), 0.08, this.det.mid)
      if (rng() < 0.6) place('table', x + rand(-3.6, 3.6, rng), z + rand(-3.6, 3.6, rng), rand(1.3, 2.0, rng), 0.08, this.det.far)
    }

    // ---------- ring C — distant giant silhouettes fading into the blue ----------
    for (let slot = 0; slot < 10; slot++) {
      const a = (slot / 10) * Math.PI * 2 + rand(-0.1, 0.1, rng)
      const r = 73 + rand(-5, 9, rng)
      const x = CX + Math.cos(a) * r
      const z = CZ + Math.sin(a) * r

      const R = rand(4.5, 6.5, rng)
      const H = rand(3.5, 6, rng)
      addMound(x, z, R, H, this.det.far)
      place('table', x, z, rand(3.8, 5.2, rng), 0.5, this.det.far)
      if (rng() < 0.7) place('sponge', x + rand(-3.5, 3.5, rng), z + rand(-3.5, 3.5, rng), rand(2.0, 3.0, rng), 0.1, this.det.far)
      if (rng() < 0.6) place('finger', x + rand(-3.5, 3.5, rng), z + rand(-3.5, 3.5, rng), rand(2.2, 3.2, rng), 0.1, this.det.far)
    }

    // ---------- backfill ridge — continuous 360° reef wall (anti-bolong) ----------
    // An undulating rock ridge threaded between ring A and ring A2 that
    // seals every see-through gap between the bommies. The 4 sand
    // channels cut through as smooth dips so the swim lanes survive.
    {
      const ANG = 260
      const ROWS = 6
      const R0 = 40
      const pos = new Float32Array((ANG + 1) * (ROWS + 1) * 3)
      const idx: number[] = []
      const channelA = [Math.PI * 0.25, Math.PI * 0.75, Math.PI * 1.25, Math.PI * 1.75]
      let o = 0
      for (let i = 0; i <= ANG; i++) {
        const a = (i / ANG) * Math.PI * 2
        // wobble the ridge centreline in/out for an organic plan
        const rw = R0 + Math.sin(a * 9 + 1.2) * 2.2 + Math.sin(a * 23 + 4) * 1.1
          + (fbm2(Math.cos(a) * 3 + 9, Math.sin(a) * 3, 2) - 0.5) * 3
        const wx = CX + Math.cos(a) * rw
        const wz = CZ + Math.sin(a) * rw
        const gy = this.heightAt(wx, wz)
        // dip to a low sill where the sand channels pass through
        let dip = 1
        for (const ca of channelA) {
          const d = Math.abs(Math.atan2(Math.sin(a - ca), Math.cos(a - ca)))
          dip = Math.min(dip, 0.1 + Math.min(1, d / 0.17) * 0.9)
        }
        const Hbase = 1.6 + (fbm2(Math.cos(a) * 2.2 - 5, Math.sin(a) * 2.2 + 7, 3) + 0.5) * 2.2
        const Hh = 0.45 + (Hbase - 0.45) * dip
        for (let jr = 0; jr <= ROWS; jr++) {
          const t = jr / ROWS
          const rr = rw + Math.sin(t * Math.PI) * 1.1 - t * 1.4     // belly out, lean in at the crest
          const y = gy - 0.55 + t * Hh * (0.85 + 0.3 * Math.sin(a * 5 + t * 3))
          pos[o++] = CX + Math.cos(a) * rr
          pos[o++] = y
          pos[o++] = CZ + Math.sin(a) * rr
        }
      }
      // fine rocky relief between the buried base and the crest
      for (let i = 0; i <= ANG; i++) {
        for (let jr = 1; jr < ROWS; jr++) {
          const k = (i * (ROWS + 1) + jr) * 3
          const x = pos[k], y = pos[k + 1], z = pos[k + 2]
          const a = (i / ANG) * Math.PI * 2
          const nx = Math.cos(a), nz = Math.sin(a)
          const n = fbm2(x * 0.55 + i * 0.13, (y + z) * 0.55, 3) - 0.5
          pos[k] += nx * n * 1.15
          pos[k + 2] += nz * n * 1.15
          pos[k + 1] += (fbm2(z * 0.8, x * 0.8, 2) - 0.5) * 0.7
        }
      }
      for (let i = 0; i < ANG; i++) {
        for (let jr = 0; jr < ROWS; jr++) {
          const a0 = i * (ROWS + 1) + jr
          const b0 = (i + 1) * (ROWS + 1) + jr
          idx.push(a0, b0, a0 + 1, b0, b0 + 1, a0 + 1)
        }
      }
      const ridge = new THREE.BufferGeometry()
      ridge.setAttribute('position', new THREE.BufferAttribute(pos, 3))
      ridge.setIndex(idx)
      ridge.computeVertexNormals()
      // mossy rock vertex colours with algae patches + pale crest
      {
        const pCount = pos.length / 3
        const cols = new Float32Array(pCount * 3)
        const rock = new THREE.Color('#54705e')
        const algae = new THREE.Color('#6d8f6a')
        const crest = new THREE.Color('#7d9a74')
        const c = new THREE.Color()
        for (let i = 0; i < ANG + 1; i++) {
          for (let jr = 0; jr <= ROWS; jr++) {
            const k = (i * (ROWS + 1) + jr) * 3
            const x = pos[k], y = pos[k + 1], z = pos[k + 2]
            c.copy(rock).multiplyScalar(0.85 + fbm2(x * 1.1, (y + z) * 1.1, 2) * 0.35)
            const patch = fbm2(x * 0.7 - 4, (y * 0.8 + z) * 0.7 + 6, 3)
            if (patch > 0.05) c.lerp(algae, Math.min(1, (patch - 0.05) * 3.2) * 0.6)
            c.lerp(crest, Math.max(0, (jr / ROWS - 0.55)) * 0.8)
            cols[k] = c.r; cols[k + 1] = c.g; cols[k + 2] = c.b
          }
        }
        ridge.setAttribute('color', new THREE.BufferAttribute(cols, 3))
      }
      this.tris += (idx.length / 3)
      const ridgeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0.01, side: THREE.DoubleSide })
      ridgeMat.onBeforeCompile = (shader) => {
        injectCaustic(shader, { scale: 0.4, strength: 0.4 })
        injectSilhouette(shader, { start: 42, end: 112, k: 0.58, color: '#0f4468' })
      }
      ridgeMat.customProgramCacheKey = () => 'arena-ridge'
      this.group.add(new THREE.Mesh(ridge, ridgeMat))
    }

    // ---------- merge per family ----------
    for (const key of Object.keys(buckets)) {
      const list = buckets[key]
      if (!list.length) continue
      const merged = mergeGeometries(list, false)!
      this.tris += merged.attributes.position.count / 3

      // gentle baked depth layering for ring C (the camera-relative
      // silhouette shader does the heavy lifting — this just helps
      // the far reef sit into the blue even before shading kicks in)
      const p = merged.attributes.position as THREE.BufferAttribute
      const col = merged.attributes.color as THREE.BufferAttribute
      for (let i = 0; i < p.count; i++) {
        const d = Math.hypot(p.getX(i) - CX, p.getZ(i) - CZ)
        const haze = THREE.MathUtils.clamp((d - 58) / 30, 0, 1)
        if (haze > 0) {
          const k = 1 - haze * 0.3
          col.setXYZ(i, col.getX(i) * k, col.getY(i) * (k + haze * 0.08), col.getZ(i) * (k + haze * 0.12))
        }
      }

      const fam = FAMILIES[key]
      const mesh = new THREE.Mesh(merged, arenaMaterial(key, MATSPEC[key] ?? { rough: 0.85 }, fam.sway))
      this.group.add(mesh)
    }

    // mounds — one merged mossy mesh
    if (mounds.length) {
      const merged = mergeGeometries(mounds.map((g) => (g.index ? g.toNonIndexed() : g)), false)!
      this.tris += merged.attributes.position.count / 3
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0.01 })
      mat.onBeforeCompile = (shader) => {
        injectCaustic(shader, { scale: 0.4, strength: 0.42 })
        injectSilhouette(shader, { start: 42, end: 112, k: 0.58, color: '#0f4468' })
      }
      mat.customProgramCacheKey = () => 'arena-mound'
      this.group.add(new THREE.Mesh(merged, mat))
    }

    // rubble — one merged mesh
    if (rubble.length) {
      const merged = mergeGeometries(rubble.map((g) => (g.index ? g.toNonIndexed() : g)), false)!
      this.tris += merged.attributes.position.count / 3
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94, metalness: 0.02 })
      mat.onBeforeCompile = (shader) => {
        injectCaustic(shader, { scale: 0.5, strength: 0.45 })
        injectSilhouette(shader, { start: 42, end: 112, k: 0.58, color: '#0f4468' })
      }
      mat.customProgramCacheKey = () => 'arena-rubble'
      this.group.add(new THREE.Mesh(merged, mat))
    }
  }

  /** QA summary */
  stats() {
    return {
      ...this.counts,
      mounds: this.moundAt.length,
      obstacles: this.obstacles.length,
      spongeLips: this.spongeLips.length,
      triK: Math.round(this.tris / 100) / 10,
    }
  }
}
