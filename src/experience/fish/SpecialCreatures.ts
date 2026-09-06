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

  // Carapace — heart-shaped dome with vertebral keel and anterior neck notch
  const RINGS = 24, RAD = 28
  const pos: number[] = [], uvs: number[] = [], idx: number[] = []
  for (let i = 0; i < RINGS; i++) {
    const u = i / (RINGS - 1) // 0 posterior tip -> 1 anterior collar
    const z = -1.42 + u * 2.80
    // heart-shaped width profile: widest at shoulders u=0.68, tapering to point at u=0
    const wHeart = 1.22 * Math.sqrt(Math.max(0, u)) * (1 - 0.22 * u) * (1 + 0.15 * Math.sin(u * Math.PI))
    const hDome = 0.52 * Math.sin(Math.pow(u, 0.65) * Math.PI * 0.95)
    for (let j = 0; j <= RAD; j++) {
      const v = j / RAD
      const a = (v - 0.5) * Math.PI // -pi/2 to +pi/2
      const ca = Math.cos(a), sa = Math.sin(a)
      const keel = 1 + 0.08 * Math.pow(Math.max(0, ca), 4.0)
      const x = sa * wHeart
      const collarDip = (u > 0.85) ? -0.12 * Math.pow((u - 0.85) / 0.15, 2) * Math.max(0, ca) : 0
      const y = hDome * ca * keel
      pos.push(x, y, z + collarDip)
      uvs.push(v, u)
    }
  }
  for (let i = 0; i < RINGS - 1; i++) {
    for (let j = 0; j < RAD; j++) {
      const a0 = i * (RAD + 1) + j, b0 = a0 + 1
      const a1 = (i + 1) * (RAD + 1) + j, b1 = a1 + 1
      idx.push(a0, b0, a1, b0, b1, a1)
    }
  }
  const shellGeo = new THREE.BufferGeometry()
  shellGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  shellGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  shellGeo.setIndex(idx)
  shellGeo.computeVertexNormals()

  const shell = new THREE.Mesh(shellGeo, shellMat)
  group.add(shell)

  // marginal rim around the shell edge
  const rim = new THREE.Mesh(new THREE.TorusGeometry(1.08, 0.12, 8, 28), shellMat)
  rim.rotation.x = Math.PI / 2
  rim.scale.set(1.08, 1.34, 1)
  rim.position.set(0, -0.02, -0.05)
  group.add(rim)

  // plastron (belly plate)
  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.96, 16, 8), plastronMat)
  belly.scale.set(0.98, 0.24, 1.26)
  belly.position.set(0, -0.15, -0.05)
  group.add(belly)

  // neck + head + parrot beak
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.22, 0.65, 10), skinMat)
  neck.position.set(0, 0.10, 1.42)
  neck.rotation.x = 1.18
  group.add(neck)

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 10), skinMat)
  head.scale.set(0.88, 0.78, 1.20)
  head.position.set(0, 0.32, 1.72)
  group.add(head)

  // Parrot-like hooked beak (rhamphotheca)
  const beakTop = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.32, 8), skinMat)
  beakTop.rotation.x = -Math.PI / 2 - 0.25 // hooked downward
  beakTop.position.set(0, 0.26, 2.08)
  group.add(beakTop)

  const beakBot = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 0.22), skinMat)
  beakBot.position.set(0, 0.18, 1.95)
  group.add(beakBot)

  // eyes
  for (const side of [1, -1] as const) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.058, 8, 6), mkMat('#151009', 0.35))
    eye.position.set(side * 0.21, 0.42, 1.78)
    group.add(eye)
    const glint = new THREE.Mesh(new THREE.SphereGeometry(0.018, 5, 4), mkMat('#ffffff', 0.2))
    glint.position.set(side * 0.25, 0.45, 1.82)
    group.add(glint)
  }

  // paddle flippers
  const flippers: THREE.Mesh[] = []
  const mkFlip = (x: number, z: number, len: number, rotZ: number, rotY: number) => {
    const f = new THREE.Mesh(buildFlipper(len), skinMat)
    f.position.set(x, -0.05, z)
    f.rotation.z = rotZ
    f.rotation.y = rotY
    flippers.push(f)
    group.add(f)
  }
  mkFlip(1.10, 0.82, 1.85, -0.95, 0.38)     // front pair — long hydrofoils
  mkFlip(-1.10, 0.82, 1.85, 0.95, -0.38)
  mkFlip(0.88, -0.95, 1.05, -1.12, -0.3)   // rear pair — rudders
  mkFlip(-0.88, -0.95, 1.05, 1.12, 0.3)

  // tail stub
  const tailStub = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.32, 6), skinMat)
  tailStub.rotation.x = Math.PI / 2 + 0.45
  tailStub.position.set(0, -0.02, -1.45)
  group.add(tailStub)

  group.scale.setScalar(1.6)
  return { group, flippers, mats }
}

// ---------- realistic predator shark ----------
function buildPredator(): { mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial } {
  const parts: THREE.BufferGeometry[] = []

  // 1. Shark Hull — aerodynamic fusiform predator body with predatory snout,
  // arched back, gills girth, caudal keels, and sealed ends.
  const RINGS = 32, RAD = 28
  const L = 4.2
  const profile = [0.05, 0.09, 0.16, 0.28, 0.40, 0.46, 0.48, 0.47, 0.42, 0.30, 0.16, 0.02]
  const pos: number[] = [], cols: number[] = [], uvs: number[] = [], idx: number[] = []

  const TOP_COLOR = new THREE.Color('#243547')
  const BELLY_COLOR = new THREE.Color('#eef3f8')

  const resample = (t: number) => {
    const f = t * (profile.length - 1)
    const i = Math.floor(f)
    const fr = f - i
    return profile[i] + (profile[Math.min(i + 1, profile.length - 1)] - profile[i]) * fr
  }

  for (let i = 0; i < RINGS; i++) {
    const t = i / (RINGS - 1)
    const z = -2.3 + t * L
    const r = resample(t)
    const yCenter = t > 0.7 ? 0.09 * Math.pow((t - 0.7) / 0.3, 1.4) : 0

    for (let j = 0; j <= RAD; j++) {
      const u = j / RAD
      const a = u * Math.PI * 2
      const cy = -Math.cos(a) // -1 belly -> +1 back
      const sx = Math.sin(a)
      let x = sx * r * 1.05
      let y = yCenter + cy * r

      if (cy > 0) {
        x *= 1 - 0.28 * Math.pow(cy, 1.5)
      } else {
        // Ventral mouth arching: mouth cavity under snout (t in 0.70 .. 0.88)
        if (t >= 0.70 && t <= 0.88 && cy < -0.3) {
          const mFactor = Math.sin(((t - 0.70) / 0.18) * Math.PI) * Math.pow(-cy, 1.3)
          y += mFactor * 0.14
          x *= 1 - mFactor * 0.25
        }
      }

      // Horizontal caudal keels near the tail peduncle (t in 0.08 .. 0.24)
      if (t >= 0.08 && t <= 0.24 && Math.abs(cy) < 0.35) {
        const keelF = Math.sin(((t - 0.08) / 0.16) * Math.PI) * (1 - Math.abs(cy) / 0.35)
        x *= 1 + keelF * 0.55
      }

      pos.push(x, y, z)
      uvs.push(u, t)

      const vertColor = new THREE.Color()
      const shadeT = THREE.MathUtils.smoothstep(cy, -0.22, 0.28)
      vertColor.copy(BELLY_COLOR).lerp(TOP_COLOR, shadeT)
      cols.push(vertColor.r, vertColor.g, vertColor.b)
    }
  }

  for (let i = 0; i < RINGS - 1; i++) {
    for (let j = 0; j < RAD; j++) {
      const a0 = i * (RAD + 1) + j, b0 = a0 + 1
      const a1 = (i + 1) * (RAD + 1) + j, b1 = a1 + 1
      idx.push(a0, b0, a1, b0, b1, a1)
    }
  }

  // Rear cap (tail root at z=-2.3)
  const rearCenter = pos.length / 3
  pos.push(0, 0, -2.3)
  uvs.push(0.5, 0)
  cols.push(TOP_COLOR.r, TOP_COLOR.g, TOP_COLOR.b)
  for (let j = 0; j < RAD; j++) idx.push(rearCenter, j + 1, j)

  // Front cap (snout tip at z=1.8)
  const frontCenter = pos.length / 3
  pos.push(0, 0.09, 1.8)
  uvs.push(0.5, 1)
  cols.push(TOP_COLOR.r, TOP_COLOR.g, TOP_COLOR.b)
  const lastBase = (RINGS - 1) * (RAD + 1)
  for (let j = 0; j < RAD; j++) idx.push(frontCenter, lastBase + j, lastBase + j + 1)

  const bodyGeo = new THREE.BufferGeometry()
  bodyGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  bodyGeo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3))
  bodyGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  bodyGeo.setIndex(idx)
  bodyGeo.computeVertexNormals()
  parts.push(bodyGeo)

  // 2. Razor-Sharp Teeth / Fangs (Mulut & Taring Tajam)
  const palate = new THREE.SphereGeometry(0.24, 10, 8)
  palate.scale(0.85, 0.45, 1.1)
  palate.translate(0, -0.16, 1.12)
  const palCols = new Float32Array(palate.attributes.position.count * 3)
  for (let k = 0; k < palate.attributes.position.count; k++) {
    palCols[k * 3] = 0.08; palCols[k * 3 + 1] = 0.02; palCols[k * 3 + 2] = 0.03
  }
  palate.setAttribute('color', new THREE.BufferAttribute(palCols, 3))
  parts.push(palate)

  // Upper Jaw Teeth (14 sharp white conical fangs)
  for (let k = 0; k < 14; k++) {
    const phi = ((k / 13) * 2 - 1) * 0.95
    const cosP = Math.cos(phi), sinP = Math.sin(phi)
    const tx = sinP * 0.185
    const tz = 1.38 - (1 - cosP) * 0.32
    const ty = -0.10 + (1 - cosP) * 0.03
    const tooth = new THREE.ConeGeometry(0.018, 0.075, 4)
    tooth.rotateX(Math.PI - 0.3)
    tooth.rotateZ(-sinP * 0.35)
    tooth.translate(tx, ty, tz)
    const tCol = new Float32Array(tooth.attributes.position.count * 3).fill(1)
    tooth.setAttribute('color', new THREE.BufferAttribute(tCol, 3))
    parts.push(tooth)
  }

  // Lower Jaw Teeth (12 sharp white conical fangs pointing upward)
  for (let k = 0; k < 12; k++) {
    const phi = ((k / 11) * 2 - 1) * 0.88
    const cosP = Math.cos(phi), sinP = Math.sin(phi)
    const tx = sinP * 0.155
    const tz = 1.28 - (1 - cosP) * 0.28
    const ty = -0.22 + (1 - cosP) * 0.02
    const tooth = new THREE.ConeGeometry(0.016, 0.068, 4)
    tooth.rotateX(0.25)
    tooth.rotateZ(-sinP * 0.3)
    tooth.translate(tx, ty, tz)
    const tCol = new Float32Array(tooth.attributes.position.count * 3).fill(1)
    tooth.setAttribute('color', new THREE.BufferAttribute(tCol, 3))
    parts.push(tooth)
  }

  // 3. 5 Gill Slits on each flank
  for (const s of [1, -1] as const) {
    for (let g = 0; g < 5; g++) {
      const gz = 0.58 + g * 0.075
      const slit = new THREE.CylinderGeometry(0.006, 0.006, 0.22 - g * 0.015, 4)
      slit.rotateZ(s * 0.15)
      slit.translate(s * 0.44, 0.02, gz)
      const sCol = new Float32Array(slit.attributes.position.count * 3)
      for (let k = 0; k < slit.attributes.position.count; k++) {
        sCol[k * 3] = 0.07; sCol[k * 3 + 1] = 0.10; sCol[k * 3 + 2] = 0.14
      }
      slit.setAttribute('color', new THREE.BufferAttribute(sCol, 3))
      parts.push(slit)
    }
  }

  // 4. Predatory Eyes
  for (const s of [1, -1] as const) {
    const eye = new THREE.SphereGeometry(0.048, 8, 6)
    eye.translate(s * 0.24, 0.11, 1.45)
    const eCol = new Float32Array(eye.attributes.position.count * 3)
    for (let k = 0; k < eye.attributes.position.count; k++) {
      eCol[k * 3] = 0.04; eCol[k * 3 + 1] = 0.06; eCol[k * 3 + 2] = 0.08
    }
    eye.setAttribute('color', new THREE.BufferAttribute(eCol, 3))
    parts.push(eye)

    const glint = new THREE.SphereGeometry(0.014, 5, 4)
    glint.translate(s * 0.27, 0.13, 1.48)
    const gCol = new Float32Array(glint.attributes.position.count * 3).fill(1)
    glint.setAttribute('color', new THREE.BufferAttribute(gCol, 3))
    parts.push(glint)
  }

  // 5. Classic First Dorsal Fin (tall triangular swept foil with notch)
  const dorsalGeo = new THREE.BufferGeometry()
  const dPos = [
    0, 0.46, 0.65,
    0, 1.25, -0.05,
    0, 0.40, -0.55,
    0, 0.48, -0.42,
  ]
  const dIdx = [0, 1, 3, 3, 1, 2]
  dorsalGeo.setAttribute('position', new THREE.Float32BufferAttribute(dPos, 3))
  dorsalGeo.setIndex(dIdx)
  dorsalGeo.computeVertexNormals()
  const dCol = new Float32Array(4 * 3)
  for (let k = 0; k < 4; k++) {
    dCol[k * 3] = TOP_COLOR.r; dCol[k * 3 + 1] = TOP_COLOR.g; dCol[k * 3 + 2] = TOP_COLOR.b
  }
  dorsalGeo.setAttribute('color', new THREE.BufferAttribute(dCol, 3))
  parts.push(dorsalGeo)

  // 6. Second Dorsal and Anal Fin
  const d2Geo = new THREE.BufferGeometry()
  d2Geo.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0.20, -1.25,
    0, 0.52, -1.55,
    0, 0.16, -1.68,
  ], 3))
  d2Geo.setIndex([0, 1, 2])
  d2Geo.computeVertexNormals()
  d2Geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(9).fill(TOP_COLOR.r), 3))
  parts.push(d2Geo)

  const analGeo = new THREE.BufferGeometry()
  analGeo.setAttribute('position', new THREE.Float32BufferAttribute([
    0, -0.16, -1.35,
    0, -0.44, -1.62,
    0, -0.14, -1.72,
  ], 3))
  analGeo.setIndex([0, 1, 2])
  analGeo.computeVertexNormals()
  analGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(9).fill(BELLY_COLOR.r), 3))
  parts.push(analGeo)

  // 7. Pectoral Fins (Sickle Hydrofoils)
  for (const s of [1, -1] as const) {
    const pecGeo = new THREE.BufferGeometry()
    const pVerts = [
      s * 0.40, -0.12, 0.72,
      s * 1.48, -0.58, -0.28,
      s * 0.38, -0.24, 0.15,
      s * 0.88, -0.38, 0.05,
    ]
    const pIndices = s > 0 ? [0, 1, 3, 0, 3, 2] : [0, 3, 1, 0, 2, 3]
    pecGeo.setAttribute('position', new THREE.Float32BufferAttribute(pVerts, 3))
    pecGeo.setIndex(pIndices)
    pecGeo.computeVertexNormals()
    const pCol = new Float32Array(4 * 3)
    for (let k = 0; k < 4; k++) {
      const c = k === 0 || k === 1 ? TOP_COLOR : BELLY_COLOR
      pCol[k * 3] = c.r; pCol[k * 3 + 1] = c.g; pCol[k * 3 + 2] = c.b
    }
    pecGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3))
    parts.push(pecGeo)

    // Pelvic fin
    const pelGeo = new THREE.BufferGeometry()
    const pelVerts = [
      s * 0.20, -0.22, -0.52,
      s * 0.58, -0.42, -0.85,
      s * 0.18, -0.20, -0.88,
    ]
    pelGeo.setAttribute('position', new THREE.Float32BufferAttribute(pelVerts, 3))
    pelGeo.setIndex(s > 0 ? [0, 1, 2] : [0, 2, 1])
    pelGeo.computeVertexNormals()
    pelGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(9).fill(BELLY_COLOR.r), 3))
    parts.push(pelGeo)
  }

  // 8. Heterocercal Caudal Fin (two-lobed, long upper lobe with notch)
  const tailGeo = new THREE.BufferGeometry()
  const tailVerts = [
    0, 0.04, -2.15,
    0, 1.15, -3.35,
    0, 0.88, -3.15,
    0, 0.18, -2.55,
    0, -0.58, -2.78,
  ]
  const tailIndices = [
    0, 1, 2,
    0, 2, 3,
    0, 3, 4,
  ]
  tailGeo.setAttribute('position', new THREE.Float32BufferAttribute(tailVerts, 3))
  tailGeo.setIndex(tailIndices)
  tailGeo.computeVertexNormals()
  const tCols = new Float32Array(5 * 3)
  for (let k = 0; k < 5; k++) {
    const c = k <= 3 ? TOP_COLOR : BELLY_COLOR
    tCols[k * 3] = c.r; tCols[k * 3 + 1] = c.g; tCols[k * 3 + 2] = c.b
  }
  tailGeo.setAttribute('color', new THREE.BufferAttribute(tCols, 3))
  parts.push(tailGeo)

  // Merge all geometries
  const merged = mergeGeometries(
    parts.map((p) => {
      const g = p.index ? p.toNonIndexed() : p
      if (!g.attributes.uv) {
        g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2))
      }
      return g
    }),
    false,
  )!

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.36,
    metalness: 0.22,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
  })

  // Hook shark spine wave swimming motion
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = sharedUniforms.uTime
    shader.vertexShader = `
      uniform float uTime;
    ` + shader.vertexShader
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
      #include <begin_vertex>
      {
        float wave = sin(uTime * 2.3 - position.z * 0.75);
        float tailEnv = clamp((0.55 - position.z) / 2.7, 0.0, 1.0);
        transformed.x += wave * 0.19 * (tailEnv * tailEnv);
        transformed.x += sin(uTime * 1.15) * 0.035 * (1.0 - tailEnv);
      }
    `)
  }
  mat.customProgramCacheKey = () => 'shark-swim-v2'

  const mesh = new THREE.Mesh(merged, mat)
  mesh.scale.setScalar(1.2)
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
          const side = i % 2 === 0 ? 1 : -1
          const phase = front ? (i % 2) * Math.PI : (i % 2) * Math.PI + 0.9
          const stroke = Math.sin(time * (front ? 1.2 : 0.85) + phase)
          if (front) {
            // 3-axis underwater flight: flapping Z + feathering Y + rowing X
            this.turtleFlippers[i].rotation.z = (side * -0.92) + stroke * 0.42 * side
            this.turtleFlippers[i].rotation.y = (side * 0.35) + Math.cos(time * 1.2 + phase) * 0.26 * side
            this.turtleFlippers[i].rotation.x = stroke * 0.28 - 0.10
          } else {
            this.turtleFlippers[i].rotation.x = stroke * 0.22 - 0.08
          }
        }
      } else {
        // shark: straight pass with predatory yaw & banking
        const zLine = v.pathSeed === 0 ? -55 : v.pathSeed === 1 ? -12 : 6
        const yLine = v.pathSeed === 0 ? 1.5 + (v.pathSeed % 2) * 3 : v.pathSeed === 1 ? -0.4 : 0.6
        const dir = v.pathSeed === 1 ? -1 : 1
        const x = dir * (-50 + progress * 100)
        v.obj.position.set(x, yLine + Math.sin(progress * Math.PI) * 1.2, zLine)
        v.obj.rotation.y = (dir > 0 ? Math.PI / 2 : -Math.PI / 2) + Math.sin(time * 2.3 + v.pathSeed * 2.1) * 0.06
        v.obj.rotation.z = Math.sin(time * 1.5 + v.pathSeed) * 0.04 * (dir > 0 ? 1 : -1)
        v.obj.rotation.x = Math.sin(time * 2 + v.pathSeed * 3) * 0.02
      }
    }
  }
}

void randInt
