// ---------------------------------------------------------------
// SpecialCreatures — rare cinematic visitors: a gliding manta ray,
// a calm sea turtle and patrolling shark silhouettes. They appear
// on randomised schedules to make the ocean feel alive & endless.
//
// v3 realism pass:
//   • turtle — swims nose-first (was rotated 180° = drifting
//     backwards), textured wrinkly skin, tapered paddle flippers
//     pivoting at the shoulder, parrot beak, detailed eyes
//   • manta — wings are true 3D double-skin volumes (dark top /
//     pale underside with shoulder patches), the fuselage carries
//     counter-shaded vertex colours, and the whip tail now roots
//     INSIDE the fuselage (was floating detached behind it)
//   • sharks — swim nose-forward, proper two-lobed caudal fin,
//     pectoral fins, second dorsal; one patrol crosses the reef so
//     schools scatter and pufferfish put their spines up
// ---------------------------------------------------------------
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { sharedUniforms } from '../core/sharedUniforms'
import { rand, randInt } from '../utils/math'

// ---------- shared canvas textures ----------
let scuteTex: THREE.CanvasTexture | null = null
function getScuteTexture(): THREE.CanvasTexture {
  if (scuteTex) return scuteTex
  const S = 256
  const c = document.createElement('canvas')
  c.width = c.height = S
  const g = c.getContext('2d')!
  // olive-brown gradient base
  const grad = g.createLinearGradient(0, 0, 0, S)
  grad.addColorStop(0, '#77854f')
  grad.addColorStop(0.55, '#5d6e44')
  grad.addColorStop(1, '#4a5c3c')
  g.fillStyle = grad
  g.fillRect(0, 0, S, S)
  // mottling
  const rng = (() => { let s = 7; return () => (s = (s * 16807) % 2147483647) / 2147483647 })()
  for (let i = 0; i < 260; i++) {
    const x = rng() * S, y = rng() * S, r = 2 + rng() * 7
    g.fillStyle = rng() > 0.5 ? 'rgba(30,42,24,0.10)' : 'rgba(190,200,140,0.08)'
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill()
  }
  // scute plates: offset rounded-rect grid with dark seams + light bevel
  const rows = 6, cols = 7
  const cw = S / cols, ch = S / rows
  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < cols; col++) {
      const x = (col + (r % 2) * 0.5) * cw
      const y = r * ch
      const w = cw * 0.86, h = ch * 0.82
      g.strokeStyle = 'rgba(18,26,14,0.55)'
      g.lineWidth = 3
      g.strokeRect(x - w / 2, y - h / 2, w, h)
      g.strokeStyle = 'rgba(210,220,160,0.16)'
      g.lineWidth = 1.6
      g.strokeRect(x - w / 2 + 2.5, y - h / 2 + 2.5, w - 5, h - 5)
    }
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  scuteTex = tex
  return tex
}

let plastronTex: THREE.CanvasTexture | null = null
function getPlastronTexture(): THREE.CanvasTexture {
  if (plastronTex) return plastronTex
  const S = 128
  const c = document.createElement('canvas')
  c.width = c.height = S
  const g = c.getContext('2d')!
  g.fillStyle = '#cdb98c'
  g.fillRect(0, 0, S, S)
  const rows = 4, cols = 5
  const cw = S / cols, ch = S / rows
  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < cols; col++) {
      g.strokeStyle = 'rgba(90,70,44,0.5)'
      g.lineWidth = 2.4
      g.strokeRect((col + 0.5) * cw, (r + 0.5) * ch, cw * 0.8, ch * 0.72)
    }
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  plastronTex = tex
  return tex
}

/** mottled, wrinkled turtle skin — head, neck and flippers */
let skinTex: THREE.CanvasTexture | null = null
function getTurtleSkinTexture(): THREE.CanvasTexture {
  if (skinTex) return skinTex
  const S = 256
  const c = document.createElement('canvas')
  c.width = c.height = S
  const g = c.getContext('2d')!
  const grad = g.createLinearGradient(0, 0, 0, S)
  grad.addColorStop(0, '#8a9663')
  grad.addColorStop(0.5, '#75855a')
  grad.addColorStop(1, '#5f7048')
  g.fillStyle = grad
  g.fillRect(0, 0, S, S)
  const rng = (() => { let s = 91; return () => (s = (s * 16807) % 2147483647) / 2147483647 })()
  // mottled blotches
  for (let i = 0; i < 210; i++) {
    const x = rng() * S, y = rng() * S, r = 2 + rng() * 6
    g.fillStyle = rng() > 0.5 ? 'rgba(38,50,28,0.14)' : 'rgba(206,214,158,0.10)'
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill()
  }
  // fine scale speckles
  for (let i = 0; i < 500; i++) {
    g.fillStyle = rng() > 0.5 ? 'rgba(24,32,18,0.10)' : 'rgba(222,228,176,0.08)'
    g.fillRect(rng() * S, rng() * S, 1.6, 1.6)
  }
  // wrinkle folds — soft horizontal arcs
  for (let i = 0; i < 14; i++) {
    const y = rng() * S
    g.strokeStyle = 'rgba(30,40,22,0.20)'
    g.lineWidth = 2 + rng() * 2.4
    g.beginPath()
    g.moveTo(0, y)
    g.quadraticCurveTo(S * 0.5, y + (rng() - 0.5) * 26, S, y + (rng() - 0.5) * 14)
    g.stroke()
    g.strokeStyle = 'rgba(214,222,168,0.12)'
    g.lineWidth = 1.4
    g.beginPath()
    g.moveTo(0, y + 2.4)
    g.quadraticCurveTo(S * 0.5, y + 2.4 + (rng() - 0.5) * 22, S, y + (rng() - 0.5) * 12)
    g.stroke()
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  skinTex = tex
  return tex
}

// ---------- manta ray ----------
const MANTA_TOP = new THREE.Color('#2c3a48')
const MANTA_BELLY = new THREE.Color('#d8dcd4')

function buildRay(): { mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial } {
  const parts: THREE.BufferGeometry[] = []

  // ---- fuselage core: lathe body flattened, nose +z ----
  const core = new THREE.LatheGeometry(
    [0.015, 0.2, 0.34, 0.38, 0.32, 0.18, 0.05].map((r, i, a) => new THREE.Vector2(r, -0.5 + i / (a.length - 1))),
    14,
  )
  core.rotateX(Math.PI / 2)
  core.scale(1.4, 0.7, 2.0)
  core.translate(0, 0, 0.5)
  core.computeVertexNormals()

  // counter-shade the fuselage: dark back, pale belly (manta idaei look)
  {
    const n = core.attributes.normal
    const cols = new Float32Array(core.attributes.position.count * 3)
    const c = new THREE.Color()
    for (let i = 0; i < core.attributes.position.count; i++) {
      const ny = n.getY(i)
      c.copy(MANTA_BELLY).lerp(MANTA_TOP, THREE.MathUtils.smoothstep(ny, -0.35, 0.4))
      cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b
    }
    core.setAttribute('color', new THREE.BufferAttribute(cols, 3))
  }
  core.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(core.attributes.position.count * 2).fill(0.5), 2))
  parts.push(core)

  // ---- wings: TRUE 3D volumes — cambered double skins with a
  // thickness that tapers to the leading/trailing edges and tip.
  // Roots start deep inside the fuselage so the joint is buried.
  const buildWing = (side: 1 | -1) => {
    const SEG_S = 15, SEG_C = 9
    const rng = (() => { let s = 41; return () => (s = (s * 16807) % 2147483647) / 2147483647 })()
    // spot anchors on the top skin (span, chord) — classic manta markings
    const spots: [number, number, number][] = []
    for (let i = 0; i < 7; i++) spots.push([0.12 + rng() * 0.5, 0.15 + rng() * 0.6, 0.05 + rng() * 0.07])

    const pos: number[] = [], cols: number[] = [], uvs: number[] = [], idx: number[] = []
    const c = new THREE.Color()
    const pushVert = (x: number, y: number, z: number, top: boolean, s: number, t: number) => {
      pos.push(x, y, z)
      uvs.push(s, t)
      if (top) {
        c.copy(MANTA_TOP)
        // white shoulder patch near the root leading edge
        const sh = Math.hypot((s - 0.06) * 1.4, (t - 0.14) * 1.6)
        if (sh < 0.16) c.lerp(new THREE.Color('#e2e8e2'), (1 - sh / 0.16) * 0.85)
        // dark body spots
        for (const [ss, tt, rr] of spots) {
          const d = Math.hypot((s - ss) * 2.4, (t - tt) * 1.7)
          if (d < rr * 6) c.lerp(new THREE.Color('#111a22'), (1 - d / (rr * 6)) * 0.75)
        }
        // wings darken slightly toward the tips
        c.multiplyScalar(1 - s * 0.18)
      } else {
        c.copy(MANTA_BELLY).multiplyScalar(1 - s * s * 0.28)  // tips shade grey
      }
      cols.push(c.r, c.g, c.b)
    }
    for (let i = 0; i <= SEG_S; i++) {
      const s = i / SEG_S                       // 0 root → 1 tip
      const x = (0.14 + s * 4.1) * side         // root buried in the fuselage
      const chord = 2.6 - s * 1.3               // broad manta disc taper
      const zC = 0.5 - s * 0.15                 // near-straight leading edge
      const th = (0.24 * Math.pow(1 - s, 0.7) + 0.015)    // thick wing root
      for (let j = 0; j <= SEG_C; j++) {
        const t = j / SEG_C                     // 0 leading → 1 trailing
        const z = zC + (t - 0.42) * chord
        const camber = Math.sin(t * Math.PI) * 0.18 * (1 - s * 0.5) + s * s * 0.06
        const bump = Math.pow(Math.sin(t * Math.PI), 0.7)
        const yTop = camber + th * bump
        const yBot = camber - th * bump * 0.35
        pushVert(x, yTop, z, true, s, t)        // top skin first
      }
      for (let j = 0; j <= SEG_C; j++) {
        const t = j / SEG_C
        const z = zC + (t - 0.42) * chord
        const camber = Math.sin(t * Math.PI) * 0.18 * (1 - s * 0.5) + s * s * 0.06
        const bump = Math.pow(Math.sin(t * Math.PI), 0.7)
        const yBot = camber - th * bump * 0.35
        pushVert(x, yBot, z, false, s, t)       // then bottom skin
      }
    }
    const R = SEG_C + 1
    for (let i = 0; i < SEG_S; i++) {
      for (let j = 0; j < SEG_C; j++) {
        // top skin
        const a0 = i * 2 * R + j, b0 = a0 + 1, a1 = (i + 1) * 2 * R + j, b1 = a1 + 1
        idx.push(a0, b0, a1, b0, b1, a1)
        // bottom skin (wound opposite so it faces down)
        const o = R
        idx.push(a0 + o, a1 + o, b0 + o, b0 + o, a1 + o, b1 + o)
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    g.setIndex(idx)
    g.computeVertexNormals()
    return g
  }
  parts.push(buildWing(1), buildWing(-1))

  // ---- cephalic fins (the two horns that funnel plankton) ----
  for (const side of [1, -1] as const) {
    const horn = new THREE.ConeGeometry(0.09, 0.55, 6, 2)
    horn.rotateX(-Math.PI / 2.4)
    horn.rotateZ(side * 0.55)
    horn.translate(side * 0.55, 0.16, 1.85)
    const col = new Float32Array(horn.attributes.position.count * 3).fill(0)
    const c = new THREE.Color()
    const n = horn.attributes.normal
    for (let i = 0; i < horn.attributes.position.count; i++) {
      c.copy(MANTA_TOP).lerp(MANTA_BELLY, THREE.MathUtils.clamp(-n.getY(i) * 0.8, 0, 0.5))
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b
    }
    horn.setAttribute('color', new THREE.BufferAttribute(col, 3))
    const uvArr = new Float32Array(horn.attributes.position.count * 2).fill(0.5)
    horn.setAttribute('uv', new THREE.BufferAttribute(uvArr, 2))
    parts.push(horn)
  }

  // ---- whip tail ROOTED in the fuselage: front tip buried at z=+0.3,
  // deep inside the core (core back reaches z=-0.5 with real thickness) ----
  const tail = new THREE.CylinderGeometry(0.012, 0.055, 2.5, 6, 3)
  tail.rotateX(-Math.PI / 2 - 0.05)
  tail.translate(0, 0.06, -0.95)
  const tailCol = new Float32Array(tail.attributes.position.count * 3)
  {
    const c = new THREE.Color()
    const n = tail.attributes.normal
    for (let i = 0; i < tail.attributes.position.count; i++) {
      c.copy(MANTA_TOP).lerp(MANTA_BELLY, THREE.MathUtils.clamp(-n.getY(i) * 0.9, 0, 0.6))
      tailCol[i * 3] = c.r; tailCol[i * 3 + 1] = c.g; tailCol[i * 3 + 2] = c.b
    }
  }
  tail.setAttribute('color', new THREE.BufferAttribute(tailCol, 3))
  tail.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(tail.attributes.position.count * 2).fill(0.5), 2))
  parts.push(tail)

  const merged = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)), false)!

  if (!merged) throw new Error('[ocean] manta merge failed')

  const mat = new THREE.MeshStandardMaterial({
    color: '#ffffff', vertexColors: true,
    roughness: 0.58, metalness: 0.12, side: THREE.DoubleSide, transparent: true, opacity: 0,
  })
  // wing flap
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = sharedUniforms.uTime
    shader.vertexShader = `
      uniform float uTime;
    ` + shader.vertexShader
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
      #include <begin_vertex>
      {
        float w = abs(position.x) / 4.2;
        transformed.y += sin(uTime * 1.15 - w * 2.2) * w * 0.95;
      }
    `)
  }
  mat.customProgramCacheKey = () => 'ray-flap-v3'
  const mesh = new THREE.Mesh(merged, mat)
  mesh.frustumCulled = false
  return { mesh, mat }
}

// ---------- sea turtle ----------
/** tapered paddle flipper — pivot at the shoulder (origin), extends +z */
function buildFlipper(len: number): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(0.5, 12, 8)
  const p = g.attributes.position
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i)
    const u = THREE.MathUtils.clamp((z + 0.5) / 0.85, 0, 1)   // 0 base → 1 tip
    const taper = 1 - 0.42 * u                                 // narrows toward the tip
    const sweep = z * z * 0.28 * Math.sign(z || 1)             // trailing curve
    p.setXYZ(
      i,
      x * taper,
      y * (taper * 0.9) + Math.sin(u * Math.PI) * 0.06,        // gentle camber
      z + sweep,
    )
  }
  g.scale(len * 0.34, len * 0.16, len)
  g.translate(0, 0, len * 0.42)                                // shoulder joint at origin
  g.computeVertexNormals()
  return g
}

function buildTurtle(): { group: THREE.Group; flippers: THREE.Mesh[]; mats: THREE.MeshStandardMaterial[] } {
  const group = new THREE.Group()
  const mats: THREE.MeshStandardMaterial[] = []
  const mkMat = (c: string, r = 0.75, map?: THREE.Texture) => {
    const m = new THREE.MeshStandardMaterial({ color: c, roughness: r, map, transparent: true, opacity: 0 })
    mats.push(m)
    return m
  }
  const shellMat = mkMat('#a8b488', 0.66, getScuteTexture())
  const plastronMat = mkMat('#e8dcc0', 0.8, getPlastronTexture())
  const skinMat = mkMat('#8a9663', 0.82, getTurtleSkinTexture())

  // carapace — textured dome
  const shell = new THREE.Mesh(new THREE.SphereGeometry(1, 22, 13), shellMat)
  shell.scale.set(1.15, 0.5, 1.42)
  group.add(shell)
  // marginal rim around the shell edge
  const rim = new THREE.Mesh(new THREE.TorusGeometry(1.06, 0.13, 8, 26), shellMat)
  rim.rotation.x = Math.PI / 2
  rim.scale.set(1.1, 1.36, 1)
  rim.position.y = -0.02
  group.add(rim)
  // plastron (belly plate)
  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.94, 14, 8), plastronMat)
  belly.scale.set(1.0, 0.26, 1.24)
  belly.position.y = -0.16
  group.add(belly)

  // neck + head + parrot beak
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.21, 0.6, 9), skinMat)
  neck.position.set(0, 0.08, 1.42)
  neck.rotation.x = 1.15
  group.add(neck)
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 9), skinMat)
  head.scale.set(0.88, 0.76, 1.18)
  head.position.set(0, 0.3, 1.68)
  group.add(head)
  // two stacked beak lobes → the parrot-beak cleft
  const beakTop = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), skinMat)
  beakTop.scale.set(1.15, 0.5, 1.1)
  beakTop.position.set(0, 0.31, 1.96)
  group.add(beakTop)
  const beakBot = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), skinMat)
  beakBot.scale.set(1.0, 0.42, 0.95)
  beakBot.position.set(0, 0.2, 1.93)
  group.add(beakBot)
  // eyes — dark ball + glint, ringed by the skin texture
  for (const side of [1, -1] as const) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), mkMat('#151009', 0.35))
    eye.position.set(side * 0.2, 0.41, 1.76)
    group.add(eye)
    const glint = new THREE.Mesh(new THREE.SphereGeometry(0.016, 5, 4), mkMat('#ffffff', 0.2))
    glint.position.set(side * 0.24, 0.44, 1.8)
    group.add(glint)
  }

  // paddle flippers — pivoted at the shoulder, tapered, cambered
  const flippers: THREE.Mesh[] = []
  const mkFlip = (x: number, z: number, len: number, rotZ: number, rotY: number) => {
    const f = new THREE.Mesh(buildFlipper(len), skinMat)
    f.position.set(x, -0.05, z)
    f.rotation.z = rotZ
    f.rotation.y = rotY
    flippers.push(f)
    group.add(f)
  }
  mkFlip(1.05, 0.82, 1.75, -0.95, 0.38)     // front pair — long & swept
  mkFlip(-1.05, 0.82, 1.75, 0.95, -0.38)
  mkFlip(0.9, -0.95, 1.05, -1.12, -0.3)     // rear pair — shorter
  mkFlip(-0.9, -0.95, 1.05, 1.12, 0.3)
  // tiny tail stub
  const tailStub = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.3, 6), skinMat)
  tailStub.rotation.x = Math.PI / 2 + 0.5
  tailStub.position.set(0, -0.02, -1.42)
  group.add(tailStub)

  group.scale.setScalar(1.6)
  return { group, flippers, mats }
}

// ---------- shark silhouette ----------
function buildPredator(): { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial } {
  const parts: THREE.BufferGeometry[] = []
  const addTri = (verts: number[]) => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3))
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(verts.length / 3 * 2), 2))
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(verts.length).fill(1), 3))
    g.computeVertexNormals()
    parts.push(g)
  }
  // fuselage — fusiform: ~6.8:1 length-to-height like a real shark
  const body = new THREE.LatheGeometry(
    [0.02, 0.22, 0.42, 0.5, 0.4, 0.16, 0.03].map((r, i, a) => new THREE.Vector2(r, -0.5 + i / (a.length - 1))),
    12,
  )
  body.rotateX(Math.PI / 2)
  body.scale(0.5, 0.5, 3.4)
  body.setAttribute('color', new THREE.BufferAttribute(new Float32Array(body.attributes.position.count * 3).fill(1), 3))
  parts.push(body)
  // dorsal — swept back, plus a small second dorsal
  addTri([0, 0.2, 0.9, 0, 1.02, -0.2, 0, 0.22, -0.75])
  addTri([0, 0.18, -1.05, 0, 0.46, -1.42, 0, 0.18, -1.5])
  // pectoral fins — long, swept back and down
  addTri([0.16, -0.12, 0.8, 1.05, -0.52, -0.4, 0.18, -0.18, 0.3])
  addTri([-0.16, -0.12, 0.8, -1.05, -0.52, -0.4, -0.18, -0.18, 0.3])
  // caudal fin — two-lobed (longer upper lobe, like a real shark)
  addTri([0, 0.04, -1.6, 0, 0.95, -2.75, 0, 0.12, -2.05])
  addTri([0, 0.04, -1.6, 0, 0.12, -2.05, 0, -0.4, -2.35])
  const merged = mergeGeometries(
    parts.map((p) => (p.index ? p.toNonIndexed() : p)),
    false,
  )!
  const mat = new THREE.MeshBasicMaterial({
    color: '#0a1c2c', transparent: true, opacity: 0, side: THREE.DoubleSide, fog: true,
    depthWrite: false,
  })
  const mesh = new THREE.Mesh(merged, mat)
  mesh.scale.setScalar(1.3)
  mesh.frustumCulled = false
  return { mesh, mat }
}

// ---------------- manager ----------------
type Kind = 'ray' | 'turtle' | 'predator'

interface Visitor {
  kind: Kind
  obj: THREE.Object3D
  mats: (THREE.Material & { opacity: number })[]
  state: 'hidden' | 'entering' | 'cruising' | 'leaving'
  t: number
  duration: number
  nextIn: number
  pathSpeed: number
  pathSeed: number          // 0 deep patrol, 1 reef crossing (predators)
}

export class SpecialCreatures {
  group = new THREE.Group()
  private visitors: Visitor[] = []

  constructor(scene: THREE.Scene) {
    // ray
    const ray = buildRay()
    this.group.add(ray.mesh)
    this.visitors.push({
      kind: 'ray', obj: ray.mesh, mats: [ray.mat], state: 'hidden',
      t: 0, duration: 34, nextIn: rand(18, 40), pathSpeed: 1, pathSeed: 0,
    })
    // turtle
    const turtle = buildTurtle()
    this.group.add(turtle.group)
    this.visitors.push({
      kind: 'turtle', obj: turtle.group, mats: turtle.mats, state: 'hidden',
      t: 0, duration: 44, nextIn: rand(30, 70), pathSpeed: 1, pathSeed: 0,
    })
    this.turtleFlippers = turtle.flippers
    // three shark silhouettes on independent schedules: a deep patrol
    // and two reef passes (one through the pufferfish anchor zone, one
    // past the curious cluster near the camera) so the defence display
    // reliably triggers wherever the puffers are drifting
    for (let i = 0; i < 3; i++) {
      const pred = buildPredator()
      this.group.add(pred.mesh)
      this.visitors.push({
        kind: 'predator', obj: pred.mesh, mats: [pred.mat], state: 'hidden',
        t: 0, duration: 26, nextIn: rand(35, 85) + i * 25, pathSpeed: 1, pathSeed: i,
      })
    }
    scene.add(this.group)
  }
  private turtleFlippers: THREE.Mesh[] = []

  /** force a ray pass (dynamic ecosystem event) */
  triggerRay() {
    const v = this.visitors.find((x) => x.kind === 'ray')!
    if (v.state === 'hidden') v.nextIn = 0.5
  }
  triggerTurtle() {
    const v = this.visitors.find((x) => x.kind === 'turtle')!
    if (v.state === 'hidden') v.nextIn = 0.5
  }
  triggerPredator() {
    // prefer a reef-crossing shark so the pufferfish defence display is
    // actually witnessed; fall back to any hidden shark
    const v = this.visitors.find((x) => x.kind === 'predator' && x.state === 'hidden' && x.pathSeed !== 0)
      ?? this.visitors.find((x) => x.kind === 'predator' && x.state === 'hidden')
    if (v) v.nextIn = 0.5
  }

  /** live shark positions — FishManager makes schools scatter & puffers inflate */
  getThreatPoints(): THREE.Vector3[] {
    const pts: THREE.Vector3[] = []
    for (const v of this.visitors) {
      if (v.kind === 'predator' && v.state !== 'hidden') pts.push(v.obj.position)
    }
    return pts
  }

  update(dt: number, time: number) {
    for (const v of this.visitors) {
      if (v.state === 'hidden') {
        v.nextIn -= dt
        if (v.nextIn <= 0) {
          v.state = 'entering'
          v.t = 0
        }
        continue
      }

      v.t += dt
      const progress = v.t / v.duration

      // fade in / out envelope
      let opacity = 1
      if (v.state === 'entering') {
        opacity = Math.min(1, v.t / 4)
        if (v.t > 4) v.state = 'cruising'
      } else if (progress > 0.82) {
        opacity = Math.max(0, 1 - (progress - 0.82) / 0.18)
      }
      for (const m of v.mats) m.opacity = opacity * (v.kind === 'predator' ? 0.85 : 1)

      if (progress >= 1) {
        v.state = 'hidden'
        v.nextIn = v.kind === 'ray' ? rand(40, 90) : v.kind === 'turtle' ? rand(60, 120) : rand(80, 160)
        for (const m of v.mats) m.opacity = 0
        continue
      }

      // ---- paths ----
      if (v.kind === 'ray') {
        const a = progress * Math.PI * 2 * 0.85 + 1.5
        const x = Math.sin(a) * 30
        const z = -42 + Math.cos(a) * 12
        const y = 3 + Math.sin(progress * Math.PI) * 4 + Math.sin(time * 0.5) * 0.8
        v.obj.position.set(x, y, z)
        // face travel direction (nose is +Z in model space)
        const dx = Math.cos(a) * 30
        const dz = -Math.sin(a) * 12
        v.obj.rotation.y = Math.atan2(dx, dz)
        v.obj.rotation.z = Math.sin(time * 1.15) * -0.06
      } else if (v.kind === 'turtle') {
        const a = progress * Math.PI * 1.1 + 2.4
        const x = Math.sin(a) * 24
        const z = -30 + Math.cos(a) * 9
        const y = 5.5 + Math.sin(progress * Math.PI) * 2.5
        v.obj.position.set(x, y, z)
        const dx = Math.cos(a) * 24
        const dz = -Math.sin(a) * 9
        // nose (+Z) faces the travel direction — no flip, no back-pedalling
        v.obj.rotation.y = Math.atan2(dx, dz)
        v.obj.rotation.z = Math.sin(time * 0.4) * 0.04
        for (let i = 0; i < this.turtleFlippers.length; i++) {
          const front = i < 2
          const phase = front ? (i % 2) * Math.PI : (i % 2) * Math.PI + 0.9
          this.turtleFlippers[i].rotation.x =
            Math.sin(time * (front ? 1.25 : 0.9) + phase) * (front ? 0.55 : 0.35) - 0.12
        }
      } else {
        // shark: straight pass — seed 0 sweeps the deep north, seed 1
        // cuts through the pufferfish anchor zone, seed 2 grazes the
        // curious cluster that drifts near the camera
        const zLine = v.pathSeed === 0 ? -55 : v.pathSeed === 1 ? -12 : 6
        const yLine = v.pathSeed === 0 ? 1.5 + (v.pathSeed % 2) * 3 : v.pathSeed === 1 ? -0.4 : 0.6
        const dir = v.pathSeed === 1 ? -1 : 1
        const x = dir * (-50 + progress * 100)
        v.obj.position.set(x, yLine + Math.sin(progress * Math.PI) * 1.2, zLine)
        v.obj.rotation.y = dir > 0 ? Math.PI / 2 : -Math.PI / 2
        v.obj.rotation.x = Math.sin(time * 2 + v.pathSeed * 3) * 0.015
      }
    }
  }
}

void randInt
