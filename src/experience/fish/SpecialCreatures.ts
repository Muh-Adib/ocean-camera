// ---------------------------------------------------------------
// SpecialCreatures — rare cinematic visitors: a gliding manta ray,
// a calm sea turtle and distant predator silhouettes. They appear
// on randomised schedules to make the ocean feel alive & endless.
//
// v2 realism pass: textured scute shell + real proportions turtle,
// 3D manta with a thick fuselage core, cambered wings, cephalic
// fins and a whip tail (was a flat plane).
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

// ---------- manta ray ----------
function buildRay(): { mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial } {
  const parts: THREE.BufferGeometry[] = []

  // ---- fuselage core: lathe body flattened, nose +z ----
  const core = new THREE.LatheGeometry(
    [0.015, 0.2, 0.34, 0.38, 0.32, 0.18, 0.05].map((r, i, a) => new THREE.Vector2(r, -0.5 + i / (a.length - 1))),
    14,
  )
  core.rotateX(Math.PI / 2)
  core.scale(1.0, 0.55, 1.55)
  core.translate(0, 0, 0.35)
  core.setAttribute('color', new THREE.BufferAttribute(new Float32Array(core.attributes.position.count * 3).fill(0.85), 3))
  core.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(core.attributes.position.count * 2).fill(0.5), 2))
  parts.push(core)

  // ---- wings: cambered sheets tapering to tips, forward-swept ----
  const buildWing = (side: 1 | -1) => {
    const SEG_S = 12, SEG_C = 7
    const pos: number[] = [], cols: number[] = [], uvs: number[] = [], idx: number[] = []
    for (let i = 0; i <= SEG_S; i++) {
      const s = i / SEG_S                       // 0 root → 1 tip
      const x = (0.32 + s * 3.85) * side
      const chord = 1.9 - s * 1.05              // chord taper
      const zC = 0.35 + s * 0.62                // forward sweep
      for (let j = 0; j <= SEG_C; j++) {
        const t = j / SEG_C                     // 0 leading → 1 trailing
        const z = zC + (t - 0.42) * chord
        const y = Math.sin(t * Math.PI) * 0.16 * (1 - s * 0.6)   // chordwise camber
          + s * s * 0.1                         // slight dihedral
        pos.push(x, y, z)
        const shadeC = 0.62 + (1 - t) * 0.3     // leading edge darker
        cols.push(shadeC, shadeC * 1.02, shadeC * 1.05)
        uvs.push(s, t)
      }
    }
    for (let i = 0; i < SEG_S; i++) {
      for (let j = 0; j < SEG_C; j++) {
        const a0 = i * (SEG_C + 1) + j
        const b0 = a0 + 1
        const a1 = (i + 1) * (SEG_C + 1) + j
        const b1 = a1 + 1
        idx.push(a0, b0, a1, b0, b1, a1)
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
    horn.translate(side * 0.42, 0.12, 1.45)
    const col = new Float32Array(horn.attributes.position.count * 3).fill(0.72)
    horn.setAttribute('color', new THREE.BufferAttribute(col, 3))
    const uvArr = new Float32Array(horn.attributes.position.count * 2).fill(0.5)
    horn.setAttribute('uv', new THREE.BufferAttribute(uvArr, 2))
    parts.push(horn)
  }

  // ---- whip tail, thin and long, angled slightly up ----
  const tail = new THREE.CylinderGeometry(0.015, 0.035, 1.7, 5, 2)
  tail.rotateX(-Math.PI / 2 - 0.14)
  tail.translate(0, 0.08, -1.45)
  const tailCol = new Float32Array(tail.attributes.position.count * 3).fill(0.6)
  tail.setAttribute('color', new THREE.BufferAttribute(tailCol, 3))
  tail.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(tail.attributes.position.count * 2).fill(0.5), 2))
  parts.push(tail)

  const merged = mergeGeometries(parts, false)!

  if (!merged) throw new Error('[ocean] manta merge failed')

  const mat = new THREE.MeshStandardMaterial({
    color: '#31465c', vertexColors: true,
    roughness: 0.62, metalness: 0.14, side: THREE.DoubleSide, transparent: true, opacity: 0,
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
  mat.customProgramCacheKey = () => 'ray-flap-v2'
  const mesh = new THREE.Mesh(merged, mat)
  mesh.frustumCulled = false
  return { mesh, mat }
}

// ---------- sea turtle ----------
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
  const skinMat = mkMat('#7a8a5a', 0.82)

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

  // neck + head + beak
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 0.55, 8), skinMat)
  neck.position.set(0, 0.08, 1.42)
  neck.rotation.x = 1.15
  group.add(neck)
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 9), skinMat)
  head.scale.set(0.88, 0.76, 1.18)
  head.position.set(0, 0.3, 1.68)
  group.add(head)
  const beak = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), skinMat)
  beak.scale.set(1.15, 0.55, 1.05)
  beak.position.set(0, 0.27, 1.95)
  group.add(beak)
  for (const side of [1, -1] as const) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 5), mkMat('#14100c', 0.4))
    eye.position.set(side * 0.19, 0.4, 1.78)
    group.add(eye)
  }

  // paddle flippers — front pair long & swept, rear pair shorter
  const flippers: THREE.Mesh[] = []
  const mkFlip = (x: number, z: number, s: number, rotZ: number, rotY: number) => {
    const f = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 7), skinMat)
    f.scale.set(s * 0.16, s * 0.075, s * 1.15)
    f.position.set(x, -0.05, z)
    f.rotation.z = rotZ
    f.rotation.y = rotY
    flippers.push(f)
    group.add(f)
  }
  mkFlip(1.1, 0.82, 1.55, -0.95, 0.35)
  mkFlip(-1.1, 0.82, 1.55, 0.95, -0.35)
  mkFlip(0.92, -0.95, 1.0, -1.15, -0.3)
  mkFlip(-0.92, -0.95, 1.0, 1.15, 0.3)
  // tiny tail stub
  const tailStub = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.26, 6), skinMat)
  tailStub.rotation.x = Math.PI / 2 + 0.5
  tailStub.position.set(0, -0.02, -1.42)
  group.add(tailStub)

  group.scale.setScalar(1.6)
  return { group, flippers, mats }
}

// ---------- predator silhouette ----------
function buildPredator(): { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial } {
  const parts: THREE.BufferGeometry[] = []
  const body = new THREE.LatheGeometry(
    [0.02, 0.28, 0.5, 0.56, 0.42, 0.14, 0.03].map((r, i, a) => new THREE.Vector2(r, -0.5 + i / (a.length - 1))),
    12,
  )
  body.rotateX(Math.PI / 2)
  body.scale(0.55, 0.62, 2.6)
  body.setAttribute('color', new THREE.BufferAttribute(new Float32Array(body.attributes.position.count * 3).fill(1), 3))
  parts.push(body)
  const dorsal = new THREE.BufferGeometry()
  dorsal.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    0, 0.3, 0.5, 0, 1.05, -0.1, 0, 0.32, -0.6,
  ]), 3))
  dorsal.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(6), 2))
  dorsal.setAttribute('color', new THREE.BufferAttribute(new Float32Array(9).fill(1), 3))
  dorsal.computeVertexNormals()
  parts.push(dorsal)
  const tail = new THREE.BufferGeometry()
  tail.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    0, 0, -1.3, 0, 0.55, -2.0, 0, 0, -1.7,
    0, 0, -1.3, 0, 0, -1.7, 0, -0.5, -1.95,
  ]), 3))
  tail.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(12), 2))
  tail.setAttribute('color', new THREE.BufferAttribute(new Float32Array(18).fill(1), 3))
  tail.computeVertexNormals()
  parts.push(tail)
  const merged = mergeGeometries(
    parts.map((p) => (p.index ? p.toNonIndexed() : p)),
    false,
  )!
  const mat = new THREE.MeshBasicMaterial({
    color: '#0a1c2c', transparent: true, opacity: 0, side: THREE.DoubleSide, fog: true,
    depthWrite: false,
  })
  const mesh = new THREE.Mesh(merged, mat)
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
      t: 0, duration: 34, nextIn: rand(18, 40), pathSpeed: 1,
    })
    // turtle
    const turtle = buildTurtle()
    this.group.add(turtle.group)
    this.visitors.push({
      kind: 'turtle', obj: turtle.group, mats: turtle.mats, state: 'hidden',
      t: 0, duration: 44, nextIn: rand(30, 70), pathSpeed: 1,
    })
    this.turtleFlippers = turtle.flippers
    // two predator silhouettes on independent schedules
    for (let i = 0; i < 2; i++) {
      const pred = buildPredator()
      this.group.add(pred.mesh)
      this.visitors.push({
        kind: 'predator', obj: pred.mesh, mats: [pred.mat], state: 'hidden',
        t: 0, duration: 26, nextIn: rand(50, 110) + i * 30, pathSpeed: 1,
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
        // face travel direction
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
        v.obj.rotation.y = Math.atan2(dx, dz) + Math.PI
        v.obj.rotation.z = Math.sin(time * 0.4) * 0.04
        for (let i = 0; i < this.turtleFlippers.length; i++) {
          this.turtleFlippers[i].rotation.x = Math.sin(time * 1.1 + i * 1.7) * 0.45
        }
      } else {
        // predator: straight distant pass, alternating sides
        const seed = v.obj.id
        const dir = seed % 2 === 0 ? 1 : -1
        const x = dir * (-50 + progress * 100)
        const z = -55 - (seed % 3) * 4
        const y = 1.5 + Math.sin(seed * 2.4) * 3
        v.obj.position.set(x, y, z)
        v.obj.rotation.y = dir > 0 ? Math.PI / 2 : -Math.PI / 2
        v.obj.rotation.y += Math.PI // nose forward
        v.obj.rotation.x = Math.sin(time * 2 + seed) * 0.015
      }
    }
  }
}

void randInt
