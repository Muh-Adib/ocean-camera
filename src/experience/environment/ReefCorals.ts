// ---------------------------------------------------------------
// ReefCorals — high-detail procedural coral family builders for
// the 360° reef arena. Every builder takes a detail tier:
//   det 2 → hero pieces of ring A (closest to visitors)
//   det 1 → mid pieces (ring B, filler)
//   det 0 → distant silhouettes (ring C)
// Triangle budgets per piece (det 2):
//   table ~7k, bubble ~5.5k, sponge ~3k, finger ~5k,
//   whip ~1.6k, spiral ~2.4k, anemone ~7k
// All geometry is vertex-coloured; the arena merges each family
// into a handful of draw calls.
// ---------------------------------------------------------------
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { fbm2, noise2 } from '../utils/math'

export type Rng = () => number
export type Det = 0 | 1 | 2

// ---------------- vertex painting helpers ----------------
export function paint(geo: THREE.BufferGeometry, base: THREE.Color, vary: number, rng: Rng, topLighten = 0.18) {
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
    c.lerp(new THREE.Color('#f2fbf6'), t * topLighten)
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return geo
}

export function tint(geo: THREE.BufferGeometry, r: number, g: number, b: number) {
  const col = geo.attributes.color as THREE.BufferAttribute
  for (let i = 0; i < col.count; i++) {
    col.setXYZ(i, col.getX(i) * r, col.getY(i) * g, col.getZ(i) * b)
  }
  return geo
}

export function pickF<T,>(arr: T[], rng: Rng): T { return arr[Math.floor(rng() * arr.length)] }
export function rand(a: number, b: number, rng: Rng) { return a + rng() * (b - a) }

/** taper a tube geometry along its length.
 *  three r185 TubeGeometry UV: uv.x = ALONG the tube, uv.y = around. */
export function taperTube(geo: THREE.BufferGeometry, curve: THREE.Curve<THREE.Vector3>, tipScale: number, tipRound: boolean) {
  const p = geo.attributes.position as THREE.BufferAttribute
  const uv = geo.attributes.uv as THREE.BufferAttribute
  const v = new THREE.Vector3()
  const center = new THREE.Vector3()
  for (let i = 0; i < p.count; i++) {
    const t = Math.min(0.999, Math.max(0, uv.getX(i)))
    v.fromBufferAttribute(p, i)
    curve.getPointAt(t, center)
    const k = 1 + (tipScale - 1) * (tipRound ? Math.sin(t * Math.PI * 0.5) : t)
    v.sub(center).multiplyScalar(k).add(center)
    p.setXYZ(i, v.x, v.y, v.z)
  }
  geo.computeVertexNormals()
}

// =================================================================
// TABLE CORAL — the hero of the reference art. Stacked acropora
// discs with radial ribs, pale growing rims, sagging lobes, a
// wobbly trunk with flared roots and (at high detail) little
// branchlet clusters crowning each disc.
// =================================================================
export function makeTableStack(rng: Rng, det: Det): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const palette = ['#4f9068', '#387a6f', '#5d966d', '#468a72', '#6ca277']
  const base = new THREE.Color(pickF(palette, rng))
  const rimC = base.clone().lerp(new THREE.Color('#b9dcae'), 0.34)   // pale growing rim
  const trunkCol = new THREE.Color('#877a5c')

  const seg = det === 2 ? 128 : det === 1 ? 72 : 40
  const hSeg = det === 2 ? 6 : det === 1 ? 4 : 2
  const lobes = 3 + Math.floor(rng() * 3)
  const ribs = 14 + Math.floor(rng() * 10)
  const ph = rng() * Math.PI * 2

  // ---- trunk: fbm wobble, flared roots ----
  const h = 1.1 + rng() * 1.3
  const trunk = new THREE.CylinderGeometry(0.12, 0.2, h, det === 2 ? 14 : det === 1 ? 10 : 8, 4)
  {
    const tp = trunk.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < tp.count; i++) {
      const x = tp.getX(i), z = tp.getZ(i), y = tp.getY(i)
      const wob = fbm2(x * 5 + 40, (z + y * 0.7) * 5, 2)
      tp.setX(i, x * (1 + wob * 0.24))
      tp.setZ(i, z * (1 + wob * 0.24))
    }
    trunk.translate(0, h / 2, 0)
  }
  parts.push(paint(trunk, trunkCol, 0.22, rng, 0.05))

  const roots = det === 2 ? 7 : det === 1 ? 5 : 4
  for (let r = 0; r < roots; r++) {
    const a = (r / roots) * Math.PI * 2 + rng() * 0.5
    const root = new THREE.ConeGeometry(0.085, 0.34 + rng() * 0.22, det === 2 ? 7 : 5, 1)
    root.translate(0, 0.14, 0)
    root.rotateZ(Math.cos(a) * 0.92)
    root.rotateX(Math.sin(a) * 0.92)
    root.translate(Math.cos(a) * 0.1, 0.02, Math.sin(a) * 0.1)
    parts.push(paint(root, trunkCol.clone().multiplyScalar(0.82), 0.2, rng, 0))
  }

  const levels = 3 + Math.floor(rng() * 3)
  let y = h * rand(0.62, 0.75, rng)
  let r = 1.15 + rng() * 0.65

  for (let l = 0; l < levels; l++) {
    const thick = 0.13 + r * 0.075               // v3: thicker living edge
    // surface height of the disc top at (x,z) — shared by the vertex
    // displacement AND the branchlet placement below
    const discY = (x: number, z: number, rr: number) => {
      const d = Math.min(1, Math.hypot(x, z) / rr)
      const a = Math.atan2(z, x)
      return Math.sin(a * ribs + ph + l * 1.7) * 0.05 * rr * d * d
        + Math.sin(a * lobes + l * 2.3) * 0.07 * rr * d
        + Math.sin(a * (ribs * 3 + 2) + l) * 0.017 * rr * d * d
        - d * d * d * 0.08 * rr
        + (1 - d) * (1 - d) * 0.055 * rr
    }
    const disc = new THREE.CylinderGeometry(r, r * 0.93, thick, seg, hSeg)
    const p = disc.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < p.count; i++) {
      p.setY(i, p.getY(i) + discY(p.getX(i), p.getZ(i), r))
    }
    disc.computeVertexNormals()
    paint(disc, base, 0.13, rng, 0.05)

    // v3: rolled living edge — a wavy torus hugging the rim so the
    // table reads THICK from the side (the classic reference profile)
    if (det >= 1 && l === 0) {
      const tor = new THREE.TorusGeometry(
        r * 0.99, thick * 0.55,
        det === 2 ? 9 : 6, det === 2 ? seg : 48,
      )
      tor.rotateX(Math.PI / 2)                            // lay flat
      {
        const tp = tor.attributes.position as THREE.BufferAttribute
        for (let i = 0; i < tp.count; i++) {
          const x = tp.getX(i), z = tp.getZ(i)
          tp.setY(i, tp.getY(i) + discY(x, z, r))          // follow the undulation
        }
        tor.computeVertexNormals()
      }
      parts.push(paint(tor, base.clone().lerp(rimC, 0.42), 0.14, rng, 0.12))
    }

    // v3: corallite nubs sprinkled over the disc top (det 2 only)
    if (det === 2) {
      const nubs = 16 + Math.floor(rng() * 14)
      for (let i = 0; i < nubs; i++) {
        const na = rng() * Math.PI * 2
        const nd2 = Math.sqrt(rng()) * r * 0.92
        const nx = Math.cos(na) * nd2, nz = Math.sin(na) * nd2
        const nub = new THREE.ConeGeometry(0.018 + rng() * 0.014, 0.05 + rng() * 0.05, 5, 1)
        nub.translate(0, 0.02, 0)
        nub.rotateX((rng() - 0.5) * 0.8)
        nub.rotateZ((rng() - 0.5) * 0.8)
        nub.translate(nx, discY(nx, nz, r) + thick / 2, nz)
        parts.push(paint(nub, base.clone().lerp(rimC, 0.3), 0.2, rng, 0.35))
      }
    }
    {
      // groove shading + ridge light + pale rim + dark underside
      const nn = disc.attributes.normal as THREE.BufferAttribute
      const cc = disc.attributes.color as THREE.BufferAttribute
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), z = p.getZ(i)
        const d = Math.min(1, Math.hypot(x, z) / r)
        const a = Math.atan2(z, x)
        const rib = Math.sin(a * ribs + ph + l * 1.7)
        let k = 1 + rib * 0.16 * d                       // ridges catch light
        k *= 1 - Math.max(0, -rib - 0.25) * 0.42 * d     // v3: deep polyp valleys between ridges
        if (nn.getY(i) < -0.3) k *= 0.58                // underside shadow (kept readable, not pitch black)
        cc.setXYZ(i, cc.getX(i) * k, cc.getY(i) * k, cc.getZ(i) * k)
        if (d > 0.86 && nn.getY(i) > 0) {               // pale living rim
          const m = (d - 0.86) / 0.14
          cc.setXYZ(i,
            cc.getX(i) + (rimC.r - cc.getX(i)) * m * 0.5,
            cc.getY(i) + (rimC.g - cc.getY(i)) * m * 0.5,
            cc.getZ(i) + (rimC.b - cc.getZ(i)) * m * 0.5)
        }
      }
    }

    // branchlets crowning the disc (acropora fingers)
    if (det >= 1) {
      const nb = det === 2 ? 14 + Math.floor(rng() * 10) : 7
      for (let i = 0; i < nb; i++) {
        const ba = rng() * Math.PI * 2
        const bd = (0.4 + rng() * 0.42) * r
        const bx = Math.cos(ba) * bd, bz = Math.sin(ba) * bd
        const surf = discY(bx, bz, r) + thick / 2
        const bl = 0.12 + rng() * 0.17
        const br = 0.02 + rng() * 0.014
        const lean = 0.18 + (bd / r) * 0.5 + rng() * 0.12
        const br1 = new THREE.CylinderGeometry(br * 0.62, br, bl, 5, 2)
        br1.translate(0, bl / 2, 0)
        br1.rotateZ(Math.cos(ba) * lean)
        br1.rotateX(Math.sin(ba) * lean)
        br1.translate(bx, surf, bz)
        parts.push(paint(br1, base.clone().lerp(rimC, 0.5), 0.16, rng, 0.3))
        const tip = new THREE.SphereGeometry(br * 0.72, det === 2 ? 7 : 5, det === 2 ? 6 : 4)
        tip.translate(
          bx + Math.sin(lean) * Math.cos(ba) * bl,
          surf + Math.cos(lean) * bl,
          bz + Math.sin(lean) * Math.sin(ba) * bl,
        )
        parts.push(paint(tip, rimC.clone().lerp(new THREE.Color('#ffffff'), 0.3), 0.12, rng, 0))
      }
    }

    // support struts from the trunk up to the lowest disc rim
    if (l === 0) {
      for (let s = 0; s < 3; s++) {
        const a = (s / 3) * Math.PI * 2 + rng()
        const strut = new THREE.CylinderGeometry(0.035, 0.05, y * 0.8, 6, 1)
        strut.translate(0, y * 0.4, 0)
        strut.rotateZ(Math.cos(a) * 0.42)
        strut.rotateX(Math.sin(a) * 0.42)
        strut.translate(Math.cos(a) * r * 0.42, 0, Math.sin(a) * 0.42 * r)
        parts.push(paint(strut, trunkCol, 0.2, rng, 0.05))
      }
    }

    disc.rotateX(rand(-0.08, 0.08, rng))
    disc.rotateZ(rand(-0.08, 0.08, rng))
    disc.translate(rand(-0.14, 0.14, rng), y, rand(-0.14, 0.14, rng))
    parts.push(disc)

    y += rand(0.28, 0.46, rng)
    r *= rand(0.6, 0.74, rng)
    if (r < 0.3) break
  }
  return mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)), false)!
}

// =================================================================
// BUBBLE CORAL — periwinkle / lavender grape clusters. Each grape
// is a high-res squashed sphere with a lit "window" on top (the
// signature translucent spot of Plerogyra), plus hanging bunches.
// =================================================================
export function makeBubbleCoral(rng: Rng, det: Det): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const palettes = [
    ['#7d9be0', '#a48fe0'], ['#5f7fd0', '#8fa8ec'], ['#b08ad8', '#d893cd'],
    ['#8fb4ea', '#6f92d8'], ['#c39ae0', '#a37ad0'],
  ]
  const [main, accent] = pickF(palettes, rng)
  const ballSeg: [number, number] = det === 2 ? [16, 12] : det === 1 ? [12, 9] : [8, 6]
  const windowC = new THREE.Color('#eae6ff')

  const subClusters = 1 + Math.floor(rng() * 3)
  for (let s = 0; s < subClusters; s++) {
    const cx = rand(-0.45, 0.45, rng), cz = rand(-0.45, 0.45, rng)
    const R = 0.34 + rng() * 0.24

    // dark lumpy base blob the grapes sit on
    const blob = new THREE.SphereGeometry(R * 0.85, det === 2 ? 16 : 10, det === 2 ? 12 : 8)
    {
      const bp = blob.attributes.position as THREE.BufferAttribute
      const v = new THREE.Vector3()
      for (let i = 0; i < bp.count; i++) {
        v.fromBufferAttribute(bp, i)
        const n = fbm2(v.x * 6 + s * 9, (v.y + v.z) * 6, 2)
        v.multiplyScalar(1 + n * 0.16)
        bp.setXYZ(i, v.x, v.y, v.z)
      }
      blob.scale(1.25, 0.5, 1.25)
      blob.translate(cx, R * 0.18, cz)
    }
    parts.push(paint(blob, new THREE.Color(main).multiplyScalar(0.42), 0.2, rng, 0))

    const balls = 24 + Math.floor(rng() * (det === 2 ? 24 : 14))
    const mainC = new THREE.Color(main)
    const accC = new THREE.Color(accent)
    for (let i = 0; i < balls; i++) {
      const t = i / balls
      const gy = Math.acos(1 - 1.85 * t)
      const ga = 2.399963 * i + rng() * 0.55
      const dir = new THREE.Vector3(Math.sin(gy) * Math.cos(ga), Math.abs(Math.cos(gy)) * 0.85 + 0.1, Math.sin(gy) * Math.sin(ga))
      const br = (0.085 + rng() * 0.09) * (1.15 - t * 0.35)
      const ball = new THREE.SphereGeometry(br, ballSeg[0], ballSeg[1])
      // lit window on the upper face of each grape (before translate)
      {
        const wp = ball.attributes.position as THREE.BufferAttribute
        const wc = new Float32Array(wp.count * 3)
        const c = mainC.clone().lerp(accC, rng() * 0.7).multiplyScalar(0.85 + rng() * 0.35)
        const v = new THREE.Vector3()
        for (let j = 0; j < wp.count; j++) {
          v.fromBufferAttribute(wp, j).normalize()
          const w = Math.max(0, v.y - 0.68) / 0.32
          const cc = c.clone().lerp(windowC, w * 0.5)
          wc[j * 3] = cc.r; wc[j * 3 + 1] = cc.g; wc[j * 3 + 2] = cc.b
        }
        ball.setAttribute('color', new THREE.BufferAttribute(wc, 3))
      }
      const dist = R * (0.72 + rng() * 0.4)
      ball.scale(1.06, 0.9, 1.06)
      ball.translate(cx + dir.x * dist, R * 0.12 + dir.y * dist * 0.82, cz + dir.z * dist)
      parts.push(ball)

      // hanging grape bunches under the outer rim
      if (det === 2 && rng() < 0.22) {
        const hb = new THREE.SphereGeometry(br * 0.6, 8, 6)
        hb.scale(1, 1.15, 1)
        hb.translate(cx + dir.x * dist * 1.06, R * 0.02 + dir.y * dist * 0.5, cz + dir.z * dist * 1.06)
        parts.push(paint(hb, mainC.clone().lerp(accC, 0.4).multiplyScalar(0.8), 0.15, rng, 0.1))
      }
    }
  }
  return mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)), false)!
}

// =================================================================
// TUBE SPONGE — ridged purple/magenta tubes with fluted walls,
// wavy flared rims, pore texture and a REAL dark hollow funnel
// inside each osculum. Tube lip positions are exported so the
// bubble system can emit bubble streams from every opening.
// =================================================================
export function makeTubeSponge(rng: Rng, det: Det, out?: { lips: THREE.Vector3[] }): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const palette = ['#7b4fd0', '#c93a8e', '#e06aa0', '#9a5ad0', '#6a3fc0', '#d4509a']
  const base = new THREE.Color(pickF(palette, rng))
  const innerC = base.clone().multiplyScalar(0.16)
  const n = 3 + Math.floor(rng() * (det === 0 ? 2 : 5))
  const tSeg = det === 2 ? 26 : det === 1 ? 16 : 10
  const rSeg = det === 2 ? 22 : det === 1 ? 14 : 9

  for (let i = 0; i < n; i++) {
    const r = 0.1 + rng() * 0.14
    const hgt = 0.6 + rng() * 1.6
    const lean = new THREE.Vector3(rand(-0.3, 0.3, rng), 1, rand(-0.3, 0.3, rng)).normalize()
    const pts = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(lean.x * hgt * 0.25, hgt * 0.55, lean.z * hgt * 0.25),
      new THREE.Vector3(lean.x * hgt * 0.55, hgt, lean.z * hgt * 0.55),
    ]
    const curve = new THREE.CatmullRomCurve3(pts)
    const tube = new THREE.TubeGeometry(curve, tSeg, r, rSeg, false)

    // vertical flutes + pore bumps (uv.x = along tube, uv.y = around)
    const flutes = 7 + Math.floor(rng() * 6)
    const fp = tube.attributes.position as THREE.BufferAttribute
    const fuv = tube.attributes.uv as THREE.BufferAttribute
    const fn = tube.attributes.normal as THREE.BufferAttribute
    const v = new THREE.Vector3(), nn = new THREE.Vector3()
    for (let j = 0; j < fp.count; j++) {
      const t = fuv.getX(j)
      const a = fuv.getY(j) * Math.PI * 2
      v.fromBufferAttribute(fp, j)
      nn.fromBufferAttribute(fn, j)
      const ends = Math.min(1, t / 0.12) * (1 - Math.max(0, (t - 0.86) / 0.14) * 0.55)
      const k = Math.sin(a * flutes + i * 1.7) * 0.05 * r * ends
        + fbm2(a * 2.2 + i * 3, t * 9, 2) * 0.024 * r
      v.addScaledVector(nn, k)
      fp.setXYZ(j, v.x, v.y, v.z)
    }
    tube.computeVertexNormals()
    taperTube(tube, curve, 1.22, false)                    // flared lip

    // wavy rim
    const uv2 = tube.attributes.uv as THREE.BufferAttribute
    const p2 = tube.attributes.position as THREE.BufferAttribute
    const rimLobes = 8 + Math.floor(rng() * 5)
    const rimPh = rng() * Math.PI * 2
    for (let j = 0; j < p2.count; j++) {
      const t = uv2.getX(j)
      if (t > 0.88) {
        const a = uv2.getY(j) * Math.PI * 2
        const k = (t - 0.88) / 0.12
        p2.setY(j, p2.getY(j) + Math.sin(a * rimLobes + rimPh) * r * 0.12 * k)
      }
    }
    tube.computeVertexNormals()
    paint(tube, base, 0.2, rng, 0.12)
    {   // darken toward the opening → hollow read
      const cc = tube.attributes.color as THREE.BufferAttribute
      for (let j = 0; j < uv2.count; j++) {
        const t = uv2.getX(j)
        if (t > 0.55) {
          const k = (t - 0.55) / 0.45
          cc.setXYZ(j, cc.getX(j) * (1 - k * 0.66), cc.getY(j) * (1 - k * 0.6), cc.getZ(j) * (1 - k * 0.52))
        }
      }
    }

    const top = pts[2]
    // dark inner funnel — a true hollow osculum cavity
    const funnel = new THREE.CylinderGeometry(r * 0.84, r * 0.2, r * 1.5, rSeg, 1, true)
    funnel.translate(top.x, top.y - r * 0.72, top.z)
    paint(funnel, innerC, 0.12, rng, 0)

    const a2 = rng() * Math.PI * 2
    const d = rng() * 0.3
    const ox = Math.cos(a2) * d, oz = Math.sin(a2) * d
    tube.translate(ox, 0, oz)
    funnel.translate(ox, 0, oz)
    parts.push(tube, funnel)
    out?.lips.push(new THREE.Vector3(top.x + ox, top.y + 0.04, top.z + oz))
  }

  // mossy skirt at the base
  const skirt = new THREE.SphereGeometry(0.3, det === 2 ? 12 : 8, det === 2 ? 8 : 6)
  skirt.scale(1.35, 0.35, 1.35)
  skirt.translate(0, 0.02, 0)
  parts.push(paint(skirt, base.clone().multiplyScalar(0.35), 0.25, rng, 0))
  return mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)), false)!
}

// =================================================================
// FINGER CORAL — fluted cream fingers with knuckle bulges and
// pale rounded tips on a lumpy base dome.
// =================================================================
export function makeFingerCoral(rng: Rng, det: Det): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const palette = ['#e8dcc0', '#f0e8d0', '#e0b090', '#d8cba8', '#efdcbc']
  const base = new THREE.Color(pickF(palette, rng))
  const tipC = new THREE.Color('#fff6e4')

  const dome = new THREE.SphereGeometry(0.32, det === 2 ? 16 : 10, det === 2 ? 11 : 7)
  dome.scale(1.3, 0.55, 1.3)
  {
    const dp = dome.attributes.position as THREE.BufferAttribute
    const v = new THREE.Vector3()
    for (let i = 0; i < dp.count; i++) {
      v.fromBufferAttribute(dp, i)
      const n = fbm2(v.x * 7, (v.y + v.z) * 7, 2)
      dp.setXYZ(i, v.x * (1 + n * 0.14), v.y, v.z * (1 + n * 0.14))
    }
    dome.computeVertexNormals()
  }
  parts.push(paint(dome, base.clone().multiplyScalar(0.72), 0.18, rng, 0))

  const fingers = 30 + Math.floor(rng() * (det === 2 ? 26 : 16))
  const fSeg = det === 2 ? 12 : 7
  const fH = det === 2 ? 7 : 3
  for (let i = 0; i < fingers; i++) {
    const a = rng() * Math.PI * 2
    const rad = Math.sqrt(rng()) * 0.34
    const hgt = 0.32 + rng() * 0.55 * (1 - rad * 0.9)
    const r0 = 0.045 + rng() * 0.035
    const flutes = 5 + Math.floor(rng() * 4)
    const knu = 2 + Math.floor(rng() * 3)
    const fph = rng() * Math.PI * 2
    const finger = new THREE.CylinderGeometry(r0 * 0.7, r0, hgt, fSeg, fH)
    const fp = finger.attributes.position as THREE.BufferAttribute
    for (let j = 0; j < fp.count; j++) {
      const x = fp.getX(j), z = fp.getZ(j)
      const t = (fp.getY(j) + hgt / 2) / hgt
      const aa = Math.atan2(z, x) + fph
      const k = 1 + Math.sin(aa * flutes) * 0.14 + Math.sin(t * Math.PI * knu) * 0.08 * (1 - t * 0.4)
      fp.setX(j, x * k)
      fp.setZ(j, z * k)
    }
    finger.translate(0, hgt / 2, 0)
    const tilt = 0.16 + rad * 0.85
    finger.rotateZ(Math.cos(a) * tilt)
    finger.rotateX(Math.sin(a) * tilt)
    finger.translate(Math.cos(a) * rad, 0.1, Math.sin(a) * rad)
    finger.computeVertexNormals()
    parts.push(paint(finger, base, 0.2, rng, 0.4))
    const tip = new THREE.SphereGeometry(r0 * 0.62, det === 2 ? 8 : 6, det === 2 ? 6 : 5)
    tip.translate(
      Math.cos(a) * (rad + Math.sin(tilt) * hgt * 0.9),
      0.1 + Math.cos(tilt) * hgt,
      Math.sin(a) * (rad + Math.sin(tilt) * hgt * 0.9),
    )
    parts.push(paint(tip, base.clone().lerp(tipC, 0.55), 0.12, rng, 0))
  }
  return mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)), false)!
}

// =================================================================
// RED SEA WHIP — sinuous crimson gorgonian with spiralling rows
// of pale polyp cones along the blade.
// =================================================================
export function makeRedWhip(rng: Rng, det: Det): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const palette = ['#d02040', '#b01838', '#e03050', '#c22848']
  const base = new THREE.Color(pickF(palette, rng))
  const polypC = base.clone().lerp(new THREE.Color('#ffd9a8'), 0.45)
  const blades = 1 + Math.floor(rng() * 3)
  const up = new THREE.Vector3(0, 1, 0)
  const xAxis = new THREE.Vector3(1, 0, 0)

  for (let b = 0; b < blades; b++) {
    const hgt = 2.2 + rng() * 2.0
    const amp = 0.28 + rng() * 0.34
    const freq = 1.2 + rng() * 1.1
    const ph = rng() * Math.PI * 2
    const a0 = rng() * Math.PI * 2
    const d0 = rng() * 0.24
    const ox = Math.cos(a0) * d0, oz = Math.sin(a0) * d0

    const pts: THREE.Vector3[] = []
    const n = 9
    for (let i = 0; i <= n; i++) {
      const t = i / n
      pts.push(new THREE.Vector3(
        ox + Math.sin(t * Math.PI * freq + ph) * amp * t,
        hgt * t,
        oz + Math.cos(t * Math.PI * freq * 0.8 + ph) * amp * 0.6 * t,
      ))
    }
    const curve = new THREE.CatmullRomCurve3(pts)
    const rad = 0.05 + rng() * 0.026
    const whip = new THREE.TubeGeometry(curve, det === 2 ? 46 : det === 1 ? 30 : 16, rad, det === 0 ? 6 : 10, false)
    taperTube(whip, curve, 0.15, true)
    paint(whip, base, 0.2, rng, 0.3)
    parts.push(whip)

    // polyps — pale cones spiralling around the blade
    if (det >= 1) {
      const nP = det === 2 ? 40 + Math.floor(rng() * 18) : 14
      const q = new THREE.Quaternion()
      for (let i = 0; i < nP; i++) {
        const t = 0.1 + (i / nP) * 0.82
        const pt = curve.getPointAt(t)
        const tan = curve.getTangentAt(t)
        const ref = Math.abs(tan.y) > 0.94 ? xAxis : up
        const nv = new THREE.Vector3().crossVectors(tan, ref).normalize()
        const bv = new THREE.Vector3().crossVectors(tan, nv).normalize()
        const th = i * 2.4
        const dir = nv.multiplyScalar(Math.cos(th)).addScaledVector(bv, Math.sin(th))
        const pl = rad * 1.05 + 0.012
        const polyp = new THREE.ConeGeometry(rad * 0.36, rad * 1.2, 7, 1)
        polyp.translate(0, rad * 0.42, 0)
        q.setFromUnitVectors(up, dir)
        polyp.applyQuaternion(q)
        polyp.translate(pt.x + dir.x * pl, pt.y + dir.y * pl, pt.z + dir.z * pl)
        parts.push(paint(polyp, polypC, 0.18, rng, 0.25))
      }
    }
  }
  return mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)), false)!
}

// =================================================================
// SPIRAL WHIP — the signature cyan crozier curls, now smooth
// high-res tubes with subtle growth banding.
// =================================================================
export function makeSpiralWhip(rng: Rng, det: Det): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const palette = ['#40b8c9', '#35a0b8', '#58ccd8', '#2f98ac']
  const base = new THREE.Color(pickF(palette, rng))
  const strands = 1 + Math.floor(rng() * 3)

  for (let s = 0; s < strands; s++) {
    const h1 = 0.8 + rng() * 0.9
    const R0 = 0.24 + rng() * 0.2
    const turns = 1.5 + rng() * 1.2
    const N = det === 2 ? 44 : det === 1 ? 32 : 22
    const pts: THREE.Vector3[] = []
    const ox = rand(-0.1, 0.1, rng), oz = rand(-0.1, 0.1, rng)
    for (let i = 0; i <= N; i++) {
      const t = i / N
      if (t < 0.42) {
        const k = t / 0.42
        pts.push(new THREE.Vector3(ox + Math.sin(k * 2.2) * 0.05, h1 * k, oz + Math.cos(k * 1.7) * 0.05))
      } else {
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
    const whip = new THREE.TubeGeometry(curve, det === 2 ? 104 : det === 1 ? 68 : 40, 0.02 + rng() * 0.014, det === 0 ? 5 : 9, false)
    taperTube(whip, curve, 0.12, true)
    paint(whip, base, 0.18, rng, 0.35)
    {   // growth banding
      const uv = whip.attributes.uv as THREE.BufferAttribute
      const cc = whip.attributes.color as THREE.BufferAttribute
      const ph = rng() * 9
      for (let j = 0; j < cc.count; j++) {
        const k = 0.93 + Math.sin(uv.getX(j) * 85 + ph) * 0.07
        cc.setXYZ(j, cc.getX(j) * k, cc.getY(j) * k, cc.getZ(j) * k)
      }
    }
    whip.rotateY(rand(0, Math.PI * 2, rng))     // random curl facing
    parts.push(whip)
  }
  return mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)), false)!
}

// =================================================================
// ANEMONE — folded column, oral disc and 3 rings of curved
// tentacles (TubeGeometry, tapering, pale luminous tips) that
// host the clownfish.
// =================================================================
export function makeAnemoneBig(rng: Rng, det: Det): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const tent = new THREE.Color(pickF(['#c9a8e0', '#e0a0c0', '#b898dd'], rng))
  const tipC = tent.clone().lerp(new THREE.Color('#ffffff'), 0.62)

  // folded column
  const colSeg = det === 2 ? 20 : 12
  const column = new THREE.CylinderGeometry(0.4, 0.54, 0.34, colSeg, det === 2 ? 3 : 1)
  {
    const cp = column.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < cp.count; i++) {
      const x = cp.getX(i), z = cp.getZ(i)
      const a = Math.atan2(z, x)
      const k = 1 + Math.sin(a * 10) * 0.055 + Math.sin(a * 3 + 1.2) * 0.03
      cp.setX(i, x * k)
      cp.setZ(i, z * k)
    }
    column.translate(0, 0.14, 0)
    column.computeVertexNormals()
  }
  parts.push(paint(column, new THREE.Color('#8a5f6a'), 0.15, rng, 0.12))

  // oral disc
  const disc = new THREE.CylinderGeometry(0.42, 0.44, 0.08, colSeg)
  disc.translate(0, 0.32, 0)
  parts.push(paint(disc, new THREE.Color('#9a6a74'), 0.12, rng, 0.2))

  const n = det === 2 ? 88 + Math.floor(rng() * 26) : det === 1 ? 58 : 42
  for (let i = 0; i < n; i++) {
    const ring = i % 3
    const a = (i / n) * Math.PI * 2 + rng() * 0.24
    const rr = ring === 2 ? 0.34 : ring === 1 ? 0.22 : 0.12
    const tilt = 0.16 + rr * (0.9 + rng() * 0.3)
    const hgt = (ring === 2 ? 0.52 : 0.34) + rng() * 0.3
    const dir = new THREE.Vector3(Math.cos(a) * tilt, 1, Math.sin(a) * tilt).normalize()
    const ox = Math.cos(a) * rr, oz = Math.sin(a) * rr
    const bend = 0.14 + rng() * 0.2
    const base = new THREE.Vector3(ox, 0.34, oz)
    const mid = base.clone().addScaledVector(dir, hgt * 0.55)
      .add(new THREE.Vector3(Math.cos(a) * bend, 0, Math.sin(a) * bend))
    const top = base.clone().addScaledVector(dir, hgt)
      .add(new THREE.Vector3(Math.cos(a) * bend * 2.1, 0, Math.sin(a) * bend * 2.1))
    const tc = new THREE.CatmullRomCurve3([base, mid, top])
    const tentacle = new THREE.TubeGeometry(tc, det === 2 ? 9 : 5, 0.034, det === 2 ? 7 : 5, false)
    taperTube(tentacle, tc, 0.45, true)
    parts.push(paint(tentacle, tent, 0.25, rng, 0.4))
    const tip = new THREE.SphereGeometry(0.044, det === 2 ? 8 : 5, det === 2 ? 6 : 4)
    tip.translate(top.x, top.y, top.z)
    parts.push(paint(tip, tipC, 0.12, rng, 0))
  }
  return mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)), false)!
}

// =================================================================
// GREEN MOUND — the mossy rocky base every bommie stands on.
// det 2 → icosahedron detail 9 (2 000 tris) with strong fbm
// relief; det 1/0 progressively lighter for the far rings.
// =================================================================
export function makeGreenMound(rng: Rng, size: number, det: Det): THREE.BufferGeometry {
  // NB: icosahedron detail is per-edge linear → faces = 20·(detail+1)²
  const geo = new THREE.IcosahedronGeometry(size, det === 2 ? 10 : det === 1 ? 5 : 3)
  const p = geo.attributes.position as THREE.BufferAttribute
  const v = new THREE.Vector3()
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i)
    const n = fbm2(v.x * 0.9 + size, v.y * 0.9 + v.z * 1.2, det === 2 ? 4 : 3)
    const n2 = fbm2(v.z * 2.1 - size, v.x * 1.6, 2)
    v.multiplyScalar(1 + n * 0.32 + n2 * 0.15)
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

// =================================================================
// STAGHORN BUSH — the signature corymbose Acropora of the
// reference art. A broad encrusting base plate sprouts 3-5
// leaning trunks that recurse into fine tapering limbs with
// axial corallite rings and pale growth tips.
//   det 2 → 4-5 trunks, recursion 4, 8×4 branch segments
//   det 1 → 3 trunks, recursion 3
//   det 0 → 2 trunks, recursion 2 (silhouette read)
// =================================================================
export function makeStaghornBush(rng: Rng, det: Det): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const palette = ['#b05ac9', '#d45a9a', '#5a9ac9', '#c98a5a', '#e07850', '#7ac9a8', '#c9c95a', '#8a7ad0']
  const base = new THREE.Color(pickF(palette, rng))
  const tipC = new THREE.Color('#ffe9c9')
  const up = new THREE.Vector3(0, 1, 0)
  const rs = det === 2 ? 8 : det === 1 ? 7 : 6
  const hs = det === 2 ? 4 : det === 1 ? 3 : 2
  const depth = det === 2 ? 4 : det === 1 ? 3 : 2
  const tipSeg: [number, number] = det === 2 ? [8, 6] : [6, 5]

  const grow = (origin: THREE.Vector3, dir: THREE.Vector3, len: number, radius: number, lvl: number) => {
    const end = origin.clone().addScaledVector(dir, len)
    const cyl = new THREE.CylinderGeometry(radius * 0.58, radius, len, rs, hs)
    const p = cyl.attributes.position as THREE.BufferAttribute
    const bendAxis = new THREE.Vector3(rng() - 0.5, 0, rng() - 0.5).normalize()
    for (let i = 0; i < p.count; i++) {
      const fy = p.getY(i) / len + 0.5
      let x = p.getX(i), z = p.getZ(i)
      const k = fy * fy * 0.85
      x += bendAxis.x * len * 0.2 * k
      z += bendAxis.z * len * 0.2 * k
      // axial corallite rings + fine noise → real staghorn surface
      const r2 = Math.hypot(x, z)
      if (r2 > 0.0005 && fy > 0.03 && fy < 0.97) {
        const ang = Math.atan2(z, x)
        const bump = 1
          + Math.sin(ang * 9 + fy * 34) * 0.045
          + noise2(x * 30 + lvl * 7, z * 30 - fy * 21) * 0.09
        x *= bump; z *= bump
      }
      p.setXYZ(i, x, p.getY(i), z)
    }
    cyl.computeVertexNormals()
    cyl.translate(0, len / 2, 0)
    cyl.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, dir))
    cyl.translate(origin.x, origin.y, origin.z)
    parts.push(paint(cyl, base.clone().offsetHSL((rng() - 0.5) * 0.02, 0, (rng() - 0.5) * 0.09), 0.2, rng, 0.14))
    if (lvl <= 0) {
      const tip = new THREE.SphereGeometry(radius * 0.92, tipSeg[0], tipSeg[1])
      tip.translate(end.x, end.y, end.z)
      parts.push(paint(tip, base.clone().lerp(tipC, 0.62), 0.1, rng, 0))
      return
    }
    const children = lvl >= 3 ? 2 : rng() < 0.45 ? 3 : 2
    for (let i = 0; i < children; i++) {
      const nd = dir.clone()
      const axis = new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize()
      nd.applyAxisAngle(axis, 0.3 + rng() * 0.48)
      nd.y = Math.abs(nd.y) * 0.62 + 0.26
      nd.normalize()
      grow(end, nd, len * (0.68 + rng() * 0.15), radius * 0.66, lvl - 1)
    }
  }

  // corymbose base — encrusting plate with short vertical nubs
  const plate = new THREE.SphereGeometry(0.42, det === 2 ? 18 : 12, det === 2 ? 10 : 7)
  plate.scale(1.25, 0.28, 1.25)
  {
    const pp = plate.attributes.position as THREE.BufferAttribute
    const v = new THREE.Vector3()
    for (let i = 0; i < pp.count; i++) {
      v.fromBufferAttribute(pp, i)
      const n = fbm2(v.x * 6 + 3, (v.y + v.z) * 6, 2)
      pp.setXYZ(i, v.x * (1 + n * 0.14), v.y, v.z * (1 + n * 0.14))
    }
    plate.computeVertexNormals()
  }
  parts.push(paint(plate, base.clone().multiplyScalar(0.55), 0.2, rng, 0.05))
  const nubs = det === 2 ? 12 + Math.floor(rng() * 8) : det === 1 ? 7 : 4
  for (let i = 0; i < nubs; i++) {
    const a = rng() * Math.PI * 2
    const d = Math.sqrt(rng()) * 0.5
    const nl = 0.1 + rng() * 0.16
    const nub = new THREE.CylinderGeometry(0.016, 0.026, nl, 6, 1)
    nub.translate(0, nl / 2, 0)
    nub.rotateZ(Math.cos(a) * 0.3)
    nub.rotateX(Math.sin(a) * 0.3)
    nub.translate(Math.cos(a) * d, 0.06, Math.sin(a) * d)
    parts.push(paint(nub, base.clone().lerp(tipC, 0.25), 0.16, rng, 0.3))
  }

  const trunks = det === 2 ? 4 + (rng() < 0.5 ? 1 : 0) : det === 1 ? 3 : 2
  for (let i = 0; i < trunks; i++) {
    const a = (i / trunks) * Math.PI * 2 + rng() * 0.9
    grow(
      new THREE.Vector3(Math.cos(a) * 0.1, 0.05, Math.sin(a) * 0.1),
      new THREE.Vector3(Math.cos(a) * 0.24, 1, Math.sin(a) * 0.24).normalize(),
      0.42 + rng() * 0.2,
      0.075 + rng() * 0.025,
      depth,
    )
  }
  return mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)), false)!
}
