// ---------------------------------------------------------------
// SpecialCreatures — rare cinematic visitors: a gliding manta ray,
// a calm sea turtle and distant predator silhouettes. They appear
// on randomised schedules to make the ocean feel alive & endless.
// ---------------------------------------------------------------
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { sharedUniforms } from '../core/sharedUniforms'
import { rand, randInt } from '../utils/math'

// ---------- manta ray ----------
function buildRay(): { mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial } {
  const geo = new THREE.PlaneGeometry(8, 4.2, 14, 8)
  geo.rotateX(-Math.PI / 2)
  const p = geo.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i)
    const wingT = Math.min(1, Math.abs(x) / 4)
    // wing taper toward tips + slight forward sweep
    let nz = z * (1 - wingT * 0.55) + wingT * 0.7
    // body bulge
    const bodyT = 1 - Math.min(1, Math.abs(x) / 1.1)
    p.setZ(i, nz)
    p.setY(i, bodyT * 0.34)
    nz = nz
  }
  // wing thickness illusion via vertex colors (darker center line)
  const colors = new Float32Array(p.count * 3)
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i)
    const bodyT = 1 - Math.min(1, Math.abs(x) / 2.2)
    const c = 0.55 + bodyT * 0.45
    colors[i * 3] = c; colors[i * 3 + 1] = c; colors[i * 3 + 2] = c
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geo.computeVertexNormals()

  const mat = new THREE.MeshStandardMaterial({
    color: '#31465c', vertexColors: true,
    roughness: 0.7, metalness: 0.1, side: THREE.DoubleSide, transparent: true, opacity: 0,
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
        float w = abs(position.x) / 4.0;
        transformed.y += sin(uTime * 1.15 - w * 2.2) * w * 0.9;
      }
    `)
  }
  mat.customProgramCacheKey = () => 'ray-flap'
  const mesh = new THREE.Mesh(geo, mat)
  mesh.frustumCulled = false
  return { mesh, mat }
}

// ---------- sea turtle ----------
function buildTurtle(): { group: THREE.Group; flippers: THREE.Mesh[]; mats: THREE.MeshStandardMaterial[] } {
  const group = new THREE.Group()
  const mats: THREE.MeshStandardMaterial[] = []
  const mkMat = (c: string, r = 0.75) => {
    const m = new THREE.MeshStandardMaterial({ color: c, roughness: r, transparent: true, opacity: 0 })
    mats.push(m)
    return m
  }
  const shellMat = mkMat('#4f6b46')
  const skinMat = mkMat('#7a8a5a')

  const shell = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), shellMat)
  shell.scale.set(1.15, 0.55, 1.4)
  group.add(shell)
  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.92, 12, 8), mkMat('#c8b482'))
  belly.scale.set(1.05, 0.3, 1.28)
  belly.position.y = -0.18
  group.add(belly)
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 8), skinMat)
  head.scale.set(0.85, 0.8, 1.15)
  head.position.set(0, 0.12, 1.55)
  group.add(head)

  const flippers: THREE.Mesh[] = []
  const flipGeo = new THREE.SphereGeometry(0.5, 8, 6)
  const mkFlip = (x: number, z: number, s: number, rotZ: number) => {
    const f = new THREE.Mesh(flipGeo, skinMat)
    f.scale.set(s * 0.22, s * 0.1, s)
    f.position.set(x, -0.05, z)
    f.rotation.z = rotZ
    flippers.push(f)
    group.add(f)
  }
  mkFlip(1.05, 0.85, 1.5, -0.9)
  mkFlip(-1.05, 0.85, 1.5, 0.9)
  mkFlip(0.95, -0.9, 1.0, -1.1)
  mkFlip(-0.95, -0.9, 1.0, 1.1)
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
