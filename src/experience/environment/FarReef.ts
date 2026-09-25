// ---------------------------------------------------------------
// FarReef — the world's distant back-drop: layered silhouette reef
// banks that fill every heading so the ocean NEVER ends in blank
// fog. Three depth layers:
//   • gap banks (E / S / W, 34–78 m out) — where the arena and the
//     biomes leave open water, muted reef mounds + spires continue
//     the scenery with a hazier, farther look;
//   • the far ring (92–118 m, 360°) — low banks + occasional tall
//     spires that break the horizon line everywhere;
//   • every piece is seated in the sand (heightAt − sink) and fades
//     into water haze EARLIER than the near reef (its own depth
//     silhouette starts at 44 m) so distance reads at a glance.
// One merged geometry per layer → three draw calls total.
// ---------------------------------------------------------------
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { addDepthSilhouette } from './depthSilhouette'
import { mulberry32, fbm2 } from '../utils/math'

/** mute + cool a colour toward "seen through water" */
function haze(hex: string, mute: number): THREE.Color {
  const c = new THREE.Color(hex)
  const gray = new THREE.Color(c.r * 0.32 + c.g * 0.42 + c.b * 0.26,
    c.r * 0.32 + c.g * 0.42 + c.b * 0.26,
    c.r * 0.32 + c.g * 0.42 + c.b * 0.26)
  return gray.lerp(c, 1 - mute)
}

export class FarReef {
  group = new THREE.Group()

  constructor(scene: THREE.Scene, heightAt: (x: number, z: number) => number) {
    const rng = mulberry32(20260925)
    const parts: THREE.BufferGeometry[] = []

    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const e = new THREE.Euler()

    /** weathered, algae-tinted silhouette mound seated in the sand */
    const bank = (x: number, z: number, r: number, h: number, col: THREE.Color) => {
      const g = new THREE.IcosahedronGeometry(r, 2)
      g.scale(1, h / (r * 2), 1)
      // organic weathering along the normals
      const p = g.attributes.position as THREE.BufferAttribute
      for (let i = 0; i < p.count; i++) {
        const vx = p.getX(i), vy = p.getY(i), vz = p.getZ(i)
        const d = fbm2(vx * 0.24 + x, (vy + vz) * 0.24 + z, 3) * r * 0.24
        const s = 1 + d / Math.max(0.4, Math.hypot(vx, vy, vz))
        p.setXYZ(i, vx * s, vy * s, vz * s)
      }
      g.computeVertexNormals()
      // vertex paint: muted base, darker foot, pale sunlit crown
      const arr = new Float32Array(p.count * 3)
      const foot = col.clone().multiplyScalar(0.62)
      const crown = col.clone().lerp(new THREE.Color('#8fc9c2'), 0.3)
      const c = new THREE.Color()
      for (let i = 0; i < p.count; i++) {
        const vy = p.getY(i)
        const t = THREE.MathUtils.clamp((vy + h * 0.5) / h, 0, 1)
        c.copy(foot).lerp(crown, Math.pow(t, 1.3))
        const n = fbm2(p.getX(i) * 0.5 + z, p.getZ(i) * 0.5 + x, 2) * 0.35
        c.offsetHSL(0, 0, n * 0.5)
        arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b
      }
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3))
      e.set((rng() - 0.5) * 0.12, rng() * Math.PI * 2, (rng() - 0.5) * 0.12)
      q.setFromEuler(e)
      const sink = h * 0.16
      m.compose(new THREE.Vector3(x, heightAt(x, z) + h * 0.32 - sink, z), q, new THREE.Vector3(1, 1, 1))
      g.applyMatrix4(m)
      parts.push(g)
    }

    /** karst needle silhouette — the far-rim skyline */
    const spire = (x: number, z: number, r: number, h: number, col: THREE.Color) => {
      const g = new THREE.CylinderGeometry(r * (0.42 + rng() * 0.25), r, h, 7, 5)
      g.translate(0, h / 2, 0)
      const p = g.attributes.position as THREE.BufferAttribute
      for (let i = 0; i < p.count; i++) {
        const y = p.getY(i)
        const k = 1 + Math.sin(y * 1.9 + x) * 0.09
        p.setXYZ(i, p.getX(i) * k, y, p.getZ(i) * k)
      }
      g.computeVertexNormals()
      const arr = new Float32Array(p.count * 3)
      const c = new THREE.Color()
      for (let i = 0; i < p.count; i++) {
        const t = p.getY(i) / h
        c.copy(col).multiplyScalar(0.78 + t * 0.4)
        arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b
      }
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3))
      e.set((rng() - 0.5) * 0.1, rng() * Math.PI * 2, (rng() - 0.5) * 0.1)
      q.setFromEuler(e)
      m.compose(new THREE.Vector3(x, heightAt(x, z) - h * 0.08, z), q, new THREE.Vector3(1, 1, 1))
      g.applyMatrix4(m)
      parts.push(g)
    }

    // palette: muted teal reef rock — already "under water" before fog
    const bankCols = [
      haze('#4e8f7d', 0.34), haze('#5d9a86', 0.3), haze('#47858f', 0.32),
      haze('#6aa08b', 0.3), haze('#3f7d8c', 0.34),
    ]
    const spireCol = haze('#57838f', 0.38)
    const farCol = haze('#3d7285', 0.45)

    // ---- gap banks: east / south / west open water (34–78 m) ----
    const scatter = (cx: number, cz: number, rx: number, rz: number, n: number, spires: number, scale: number) => {
      for (let i = 0; i < n; i++) {
        const x = cx + (rng() - 0.5) * 2 * rx
        const z = cz + (rng() - 0.5) * 2 * rz
        const r = (3.4 + rng() * 6.2) * scale
        const h = (3.4 + rng() * 5.2) * scale
        bank(x, z, r, h, bankCols[Math.floor(rng() * bankCols.length)])
      }
      for (let i = 0; i < spires; i++) {
        const x = cx + (rng() - 0.5) * 2 * rx
        const z = cz + (rng() - 0.5) * 2 * rz
        spire(x, z, 1.3 + rng() * 1.7, 7 + rng() * 9, spireCol)
      }
    }
    // keep the gap banks off the direct north corridor the home camera
    // stares down (that view is owned by the real arena reef)
    scatter(62, -12, 20, 26, 9, 3, 1.0)     // east gap
    scatter(-64, -8, 20, 26, 9, 3, 1.0)     // west gap
    scatter(0, 40, 42, 12, 8, 2, 0.85)      // south, behind the visitor
    scatter(34, 26, 14, 9, 4, 1, 0.8)       // SE approach
    scatter(-36, 26, 14, 9, 4, 1, 0.8)      // SW approach

    // ---- the far ring (92–118 m, 360°): horizon fill everywhere ----
    // tall enough that the sand→water horizon line always sits BEHIND a
    // soft silhouette ridge, never as a naked straight edge
    for (let i = 0; i < 34; i++) {
      const a = (i / 34) * Math.PI * 2 + rng() * 0.16
      const r = 92 + rng() * 26
      const x = Math.cos(a) * r
      const z = -20 + Math.sin(a) * r
      bank(x, z, 6 + rng() * 9, 7 + rng() * 9, farCol)
    }
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + rng() * 0.5
      const r = 96 + rng() * 22
      const x = Math.cos(a) * r
      const z = -20 + Math.sin(a) * r
      spire(x, z, 2.2 + rng() * 2.8, 14 + rng() * 16, farCol)
    }

    const merged = mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)), false)!
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 1,
      metalness: 0,
    })
    // far layers sink into water haze EARLIER than the near reef —
    // distance reads instantly, and up close they still shade like rock
    addDepthSilhouette(mat, { start: 44, end: 112, k: 0.62, color: '#11566f' }, 'far-reef')
    const mesh = new THREE.Mesh(merged, mat)
    mesh.frustumCulled = false
    this.group.add(mesh)
    scene.add(this.group)
  }

  stats() {
    const mesh = this.group.children[0] as THREE.Mesh
    const geo = mesh.geometry as THREE.BufferGeometry
    return {
      tris: Math.round((geo.index ? geo.index.count : geo.attributes.position.count) / 3),
    }
  }

  dispose() {
    const mesh = this.group.children[0] as THREE.Mesh | undefined
    if (mesh) {
      mesh.geometry.dispose()
      ;(mesh.material as THREE.Material).dispose()
    }
    this.group.removeFromParent()
  }
}
