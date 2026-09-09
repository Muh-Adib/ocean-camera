// ---------------------------------------------------------------
// ReefCore — the central limestone reef head. A weathered karst
// monolith (icosa detail 16 ≈ 5 780 welded, smooth-shaded faces +
// multi-octave karst displacement, stratified ledges, two dark cave
// mouths, a pierce-through arch and rubble at the foot) from which
// the living reef grows: staghorn thickets, table corals, brains,
// tube colonies, barrel sponges, soft corals and anemones attach
// directly to its displaced surface via the same radial function
// used to sculpt it. Satellites: three smaller reef heads around.
// ---------------------------------------------------------------
import * as THREE from 'three'
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { sharedUniforms } from '../core/sharedUniforms'
import { mulberry32, fbm2, noise2 } from '../utils/math'
import { CoralMakers } from './CoralSystem'
import { REEF_SITES, type ReefSite } from './ReefSites'
import type { Obstacle } from './Rocks'

type Rng = () => number

interface ReefSiteDef extends ReefSite {}

const SITES: ReefSiteDef[] = REEF_SITES

// cave mouths: unit direction (local space) + depth as a fraction of R
const CAVES: [number, number, number, number][] = [
  [0.62, 0.12, 0.78, 0.36],
  [-0.78, 0.06, 0.5, 0.3],
]

/** full displaced radius of the karst dome for a unit direction */
function domeRadius(nx: number, ny: number, nz: number, R: number, seed: number): number {
  // broad karst lobes
  const lobes = fbm2(nx * 1.3 + seed, ny * 1.3 + nz * 1.1 - seed, 3) * 0.15
  // stratified weathering ledges (horizontal banding warped by noise)
  const ledge = Math.sin(ny * 5.5 + fbm2(nx * 2 + seed * 0.7, nz * 2, 2) * 2.4) * 0.035
  // fine grain
  const grain = noise2(nx * 6.5 + seed, nz * 6.5 - ny * 5.5) * 0.028
  let r = R * (1 + lobes + ledge + grain)
  // cave mouths: push the surface inward with a smooth angular falloff
  for (const [cx, cy, cz, depth] of CAVES) {
    const d = nx * cx + ny * cy + nz * cz
    const ang = Math.acos(THREE.MathUtils.clamp(d, -1, 1))
    if (ang < 0.55) {
      const k = 1 - ang / 0.55
      r -= depth * R * k * k
    }
  }
  return Math.max(R * 0.42, r)
}

/** weld a displaced non-indexed mesh by position so normals shade smooth */
function weldByPosition(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const bare = new THREE.BufferGeometry()
  bare.setAttribute('position', geo.getAttribute('position'))
  const welded = mergeVertices(bare, 1e-3)
  welded.computeVertexNormals()
  return welded
}

/** limestone vertex paint: mineral banding, coraline crust, algae crevices, bleached crown, dark caves */
function paintLimestone(geo: THREE.BufferGeometry, seed: number, R: number) {
  const pos = geo.attributes.position as THREE.BufferAttribute
  const colors = new Float32Array(pos.count * 3)
  const c = new THREE.Color()
  const base = new THREE.Color('#a89a78')
  const algae = new THREE.Color('#46663e')
  const coraline = new THREE.Color('#7c4a6a')
  const crown = new THREE.Color('#d8cfb8')
  const caveDark = new THREE.Color('#22242c')
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i)
    c.copy(base)
    const band = (noise2(x * 1.7 + seed, (y + z) * 1.7 - seed) + 1) * 0.5
    c.multiplyScalar(0.74 + band * 0.4)
    // stratification tint: ledges slightly darker at their undersides
    c.multiplyScalar(1 + Math.sin(y * 5.5) * 0.05)
    // crevices (concave) catch algae
    const rr = Math.sqrt(x * x + y * y + z * z)
    const crev = THREE.MathUtils.clamp((R * 1.02 - rr) / (R * 0.3), 0, 1)
    const patch = fbm2(x * 0.9 - seed, (y * 0.8 + z) * 0.9 + seed, 3)
    if (patch > 0.04) c.lerp(algae, Math.min(1, (patch - 0.04) * 4) * (0.3 + crev * 0.45))
    // crustose coraline pink
    const crust = noise2(x * 1.6 - seed * 2, z * 1.6 + y)
    if (crust > 0.3) c.lerp(coraline, Math.min(1, (crust - 0.3) * 4) * 0.5)
    // sun-bleached crown
    c.lerp(crown, THREE.MathUtils.clamp(y / (R * 0.9), 0, 1) * 0.22)
    // cave mouths go almost black
    const nx = x, ny = y, nz = z
    const len = Math.max(0.0001, Math.sqrt(nx * nx + ny * ny + nz * nz))
    for (const [cx, cy, cz, depth] of CAVES) {
      const d = (nx / len) * cx + (ny / len) * cy + (nz / len) * cz
      const ang = Math.acos(THREE.MathUtils.clamp(d, -1, 1))
      if (ang < 0.42) {
        const k = 1 - ang / 0.42
        c.lerp(caveDark, Math.min(1, k * 1.4) * Math.min(1, depth * 3.4))
      }
    }
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
}

export class ReefCore {
  group = new THREE.Group()
  obstacles: Obstacle[] = []
  anemonePositions: THREE.Vector3[] = []
  spongeMouths: THREE.Vector3[] = []

  constructor(scene: THREE.Scene, private heightAt: (x: number, z: number) => number) {
    const rng = mulberry32(40001)
    const rockParts: THREE.BufferGeometry[] = []   // limestone (dome + arch + rubble) per site
    const coralParts: THREE.BufferGeometry[] = []  // attached solid corals, all sites
    const anemoneParts: THREE.BufferGeometry[] = []
    const m = new THREE.Matrix4()

    for (const site of SITES) {
      const sy = 0.8                                  // vertical squash of the dome
      const cx = site.x
      const cz = site.z
      const cy = this.heightAt(site.x, site.z) + (site.R - 3.2) * 0.22 + site.R * 0.08

      // ---- karst dome ----
      const dome0 = new THREE.IcosahedronGeometry(site.R, site.detail)
      const p = dome0.attributes.position as THREE.BufferAttribute
      const v = new THREE.Vector3()
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i)
        const n = v.clone().normalize()
        const r = domeRadius(n.x, n.y, n.z, site.R, site.seed)
        p.setXYZ(i, n.x * r, n.y * r, n.z * r)
      }
      const dome = weldByPosition(dome0)          // weld → smooth normals
      paintLimestone(dome, site.seed, site.R)     // paint in LOCAL space (cave dirs, crown)
      dome.scale(1.18, sy, 1.05)
      dome.translate(cx, cy, cz)
      rockParts.push(dome)

      // ---- pierce-through arch on the flank ----
      if (site === SITES[0]) {
        const arch = new THREE.TorusGeometry(site.R * 0.33, site.R * 0.095, 12, 30, Math.PI)
        const ap = arch.attributes.position as THREE.BufferAttribute
        for (let i = 0; i < ap.count; i++) {
          const w = 1 + noise2(ap.getX(i) * 2.1 + site.seed, ap.getY(i) * 2.1) * 0.14
          ap.setXYZ(i, ap.getX(i) * w, ap.getY(i) * w, ap.getZ(i) * w)
        }
        const archW = weldByPosition(arch)          // torus is indexed but wobble splits nothing — still weld
        paintLimestone(archW, site.seed + 3, site.R * 0.6)
        // rock-bridge lintel over the first cave mouth: ring plane ⟂ radial,
        // centred on the cave-mouth surface point so the crown stands proud
        // and the legs bury into the karst on both sides of the opening
        const cd = new THREE.Vector3(0.62, 0.12, 0.78).normalize()
        const cr = domeRadius(cd.x, cd.y, cd.z, site.R, site.seed)
        archW.rotateY(Math.atan2(cd.x, cd.z))       // ring normal = radial dir
        archW.rotateZ(-0.06)
        archW.translate(
          cx + cd.x * cr * 1.16,
          cy + cd.y * cr * sy,
          cz + cd.z * cr * 1.04,
        )
        rockParts.push(archW)
      }

      // ---- rubble ring at the foot ----
      const rubble = 6 + Math.floor(rng() * 4)
      for (let i = 0; i < rubble; i++) {
        const a = rng() * Math.PI * 2
        const d = site.R * (1.05 + rng() * 0.45)
        const rx = cx + Math.cos(a) * d * 1.1
        const rz = cz + Math.sin(a) * d
        const chunk0 = new THREE.IcosahedronGeometry(site.R * (0.1 + rng() * 0.12), 1)
        const cp = chunk0.attributes.position as THREE.BufferAttribute
        for (let j = 0; j < cp.count; j++) {
          const k = 1 + noise2(cp.getX(j) * 3 + site.seed, cp.getZ(j) * 3 + j) * 0.3
          cp.setXYZ(j, cp.getX(j) * k, cp.getY(j) * k * 0.72, cp.getZ(j) * k)
        }
        const chunk = weldByPosition(chunk0)
        paintLimestone(chunk, site.seed + 7, site.R * 0.35)
        chunk.rotateY(rng() * Math.PI * 2)
        chunk.translate(rx, this.heightAt(rx, rz) + site.R * 0.04, rz)
        rockParts.push(chunk)
      }

      // ---- corals growing on the dome surface ----
      const dirs: THREE.Vector3[] = []
      const N = site.corals
      for (let i = 0; i < N; i++) {
        // fibonacci hemisphere (elevation > ~8°), jittered
        const t = (i + 0.5) / N
        const gy = Math.acos(THREE.MathUtils.lerp(0.99, 0.08, t))
        const ga = i * 2.399963 + rng() * 0.6
        dirs.push(new THREE.Vector3(Math.sin(gy) * Math.cos(ga), Math.cos(gy), Math.sin(gy) * Math.sin(ga)))
      }
      // weighted family pick
      const fams: [keyof typeof CoralMakers, number][] = [
        ['branch', 4], ['table', 1.6], ['brain', 1.4], ['tube', 1.2],
        ['sponge', 1], ['tubeSponge', 0.9], ['soft', 0.7],
      ]
      const total = fams.reduce((s, [, w]) => s + w, 0)
      for (const n of dirs) {
        let roll = rng() * total
        let famKey: keyof typeof CoralMakers = 'branch'
        for (const [k, w] of fams) { roll -= w; if (roll <= 0) { famKey = k; break } }

        const mouths: THREE.Vector3[] = []
        const geo = CoralMakers[famKey](rng, mouths)
        // world surface point from the same radial function
        const r = domeRadius(n.x, n.y, n.z, site.R, site.seed)
        const sx = 1.18, sz = 1.05
        const px = cx + n.x * r * sx
        const py = cy + n.y * r * sy
        const pz = cz + n.z * r * sz
        const scale = (site.R / 5.2) * (0.55 + rng() * 0.5) * (famKey === 'table' ? 0.72 : 1)
        // lean toward the surface normal but keep growth mostly upright
        const nrm = new THREE.Vector3(n.x * sx, n.y * sy, n.z * sz).normalize()
        const up = new THREE.Vector3(0, 1, 0)
        const leanDir = up.clone().lerp(nrm, 0.42).normalize()
        const q = new THREE.Quaternion().setFromUnitVectors(up, leanDir)
        const yaw = new THREE.Quaternion().setFromAxisAngle(up, rng() * Math.PI * 2)
        q.premultiply(yaw)
        m.compose(new THREE.Vector3(px, py - 0.13 * scale, pz), q, new THREE.Vector3(scale, scale, scale))
        geo.applyMatrix4(m)
        coralParts.push(geo)
        for (const lm of mouths) {
          this.spongeMouths.push(lm.clone().multiplyScalar(scale).applyMatrix4(m))
        }
        if (famKey === 'sponge' || famKey === 'tubeSponge') {
          this.obstacles.push({ x: px, y: py, z: pz, r: scale * 0.5 })
        }
      }

      // ---- anemones tucked in the lower niches ----
      const nAnem = site === SITES[0] ? 6 : 2
      for (let i = 0; i < nAnem; i++) {
        const a = rng() * Math.PI * 2
        const el = 0.05 + rng() * 0.3
        const n = new THREE.Vector3(Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el)).normalize()
        const r = domeRadius(n.x, n.y, n.z, site.R, site.seed)
        const sx = 1.18, sz = 1.05
        const px = cx + n.x * r * sx
        const py = cy + n.y * r * sy
        const pz = cz + n.z * r * sz
        const scale = (site.R / 5.2) * (0.6 + rng() * 0.4)
        const geo = CoralMakers.anemone(rng)
        m.compose(new THREE.Vector3(px, py - 0.04, pz), new THREE.Quaternion(), new THREE.Vector3(scale, scale, scale))
        geo.applyMatrix4(m)
        anemoneParts.push(geo)
        this.anemonePositions.push(new THREE.Vector3(px, py + 0.4 * scale, pz))
      }

      this.obstacles.push({ x: cx, y: cy, z: cz, r: site.R * 1.12 })
    }

    // ---- merge & materials ----
    const limestoneMat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.92, metalness: 0.01,
    })
    // icosahedron parts are non-indexed while torus parts are indexed —
    // expand everything to non-indexed so the merge succeeds
    const rocks = new THREE.Mesh(mergeGeometries(rockParts.map((g) => (g.index ? g.toNonIndexed() : g)), false)!, limestoneMat)
    this.group.add(rocks)

    const coralMat = new THREE.MeshPhysicalMaterial({
      vertexColors: true, roughness: 0.74, metalness: 0.02,
      clearcoat: 0.5, clearcoatRoughness: 0.42,
    })
    const corals = new THREE.Mesh(mergeGeometries(coralParts.map((g) => (g.index ? g.toNonIndexed() : g)), false)!, coralMat)
    this.group.add(corals)

    // anemones sway with the shared field (same injection as CoralSystem)
    const anemoneMat = new THREE.MeshPhysicalMaterial({
      vertexColors: true, roughness: 0.7, metalness: 0,
      clearcoat: 0.35, clearcoatRoughness: 0.5,
    })
    anemoneMat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = sharedUniforms.uTime
      shader.uniforms.uFieldPos = sharedUniforms.uFieldPos
      shader.uniforms.uFieldDir = sharedUniforms.uFieldDir
      shader.uniforms.uFieldStrength = sharedUniforms.uFieldStrength
      shader.uniforms.uFieldRadius = sharedUniforms.uFieldRadius
      shader.vertexShader = `
        uniform float uTime, uFieldStrength, uFieldRadius;
        uniform vec3 uFieldPos, uFieldDir;
      ` + shader.vertexShader
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
        #include <begin_vertex>
        {
          vec4 wp4 = modelMatrix * vec4(transformed, 1.0);
          float hF = clamp(uv.y, 0.0, 1.0); hF *= hF;
          float sway = sin(uTime * 1.6 + wp4.x * 0.5 + wp4.z * 0.5) * 0.03
                     + sin(uTime * 2.76 + wp4.z * 1.1) * 0.012;
          float dField = distance(wp4.xyz, uFieldPos);
          float infl = smoothstep(uFieldRadius * 1.7, 0.0, dField) * uFieldStrength;
          vec2 bend = vec2(sway, 0.0);
          bend += uFieldDir.xz * infl * 0.85;
          transformed.x += bend.x * hF;
          transformed.z += bend.y * hF;
        }
      `)
    }
    anemoneMat.customProgramCacheKey = () => 'reefcore-anemone'
    const anemones = new THREE.Mesh(mergeGeometries(anemoneParts.map((g) => (g.index ? g.toNonIndexed() : g)), false)!, anemoneMat)
    this.group.add(anemones)

    scene.add(this.group)
  }
}
