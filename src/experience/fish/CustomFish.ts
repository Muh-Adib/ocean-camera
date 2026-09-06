// ---------------------------------------------------------------
// CustomFish — ONE dedicated 3D fish for every uploaded painting.
//
// The geometry is TRACED FROM THE USER'S OWN TEMPLATE
// (FishSheetData — measured from public/fish/template-ikan.png):
//   • the hull is lofted through the drawn back/belly lines, so the
//     side view of the 3D fish IS the drawing's silhouette;
//   • dorsal / tail / anal / pelvic are thin shells whose outlines
//     are the drawn fin outlines, seated exactly where they are
//     drawn (paired fins mirrored — perfectly symmetric);
//   • pectorals flare out of the flanks at the drawn position;
//   • real 3D eyeballs sit where the pupil was drawn.
//
// TEXTURING IS A 1:1 PLANAR MAP: every vertex samples the sheet at
// the (fx, fy) it came from (SHEET_CONTRACT window). The painting
// therefore colours the model EXACTLY where it was painted on
// paper — a red drawn tail turns the 3D tail red, gill strokes
// land on the gill, background never leaks in because FishScan
// crops to the fish only.
// ---------------------------------------------------------------
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { makeEyeParts, makeFishMaterial } from './FishGeometryFactory'
import { SHEET_CONTRACT } from './FishTemplate'
import {
  SHEET_ASPECT, PED_X, BODY_TOP, BODY_BOT,
  DORSAL, TAIL, ANAL, PELVIC, PECTORAL, EYE,
} from './FishSheetData'

/** model length in world units (nose → tail tip) */
const LEN = 0.92
const ASP = SHEET_ASPECT

// sheet fractions → model space (nose +Z, tail −Z, v up on the sheet)
const wx = (fx: number) => (fx - 0.5) * LEN
const wy = (fy: number) => (0.5 - fy) * (LEN / ASP)
const wz = (fx: number) => (0.5 - fx) * LEN

/**
 * Planar UV from MODEL coordinates (body: length along Z, height along Y)
 * — the heart of "the painting colours the model perfectly".
 */
function planarUV(geo: THREE.BufferGeometry) {
  const uv = geo.attributes.uv as THREE.BufferAttribute
  const pos = geo.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < uv.count; i++) {
    const fx = 0.5 - pos.getZ(i) / LEN
    const fy = 0.5 - (pos.getY(i) * ASP) / LEN
    setSheetUV(uv, i, fx, fy)
  }
  uv.needsUpdate = true
}

/** planar UV from FIN-SHAPE coordinates (pre-rotation: x = length, y = height) */
function finUV(geo: THREE.BufferGeometry) {
  const uv = geo.attributes.uv as THREE.BufferAttribute
  const pos = geo.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < uv.count; i++) {
    const fx = 0.5 - pos.getX(i) / LEN
    const fy = 0.5 - (pos.getY(i) * ASP) / LEN
    setSheetUV(uv, i, fx, fy)
  }
  uv.needsUpdate = true
}

function setSheetUV(uv: THREE.BufferAttribute, i: number, fx: number, fy: number) {
  uv.setXY(
    i,
    SHEET_CONTRACT.u0 + (SHEET_CONTRACT.u1 - SHEET_CONTRACT.u0) * fx,
    SHEET_CONTRACT.v1 - (SHEET_CONTRACT.v1 - SHEET_CONTRACT.v0) * fy,
  )
}

function whiteColors(geo: THREE.BufferGeometry) {
  const n = geo.attributes.position.count
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3))
}

// ---------------- traced body lookup ----------------
const statAt = (fx: number) => {
  const f = Math.min(PED_X, Math.max(0, fx)) * (BODY_TOP.length - 1) / PED_X
  const i = Math.min(BODY_TOP.length - 2, Math.floor(f))
  const fr = f - i
  return {
    top: BODY_TOP[i][1] + (BODY_TOP[i + 1][1] - BODY_TOP[i][1]) * fr,
    bot: BODY_BOT[i][1] + (BODY_BOT[i + 1][1] - BODY_BOT[i][1]) * fr,
  }
}

/** lateral half-width factor — deep-bodied fish, widest just behind the gill */
const widthFactor = (fx: number) => {
  const t = Math.min(1, Math.max(0, fx / PED_X))
  return 0.21 + 0.16 * Math.sin(Math.PI * Math.pow(t, 0.85))
}

const halfWidthAt = (fx: number, hT: number, hB: number) =>
  Math.min(hT, hB) * widthFactor(fx) * 2

/** flank surface |x| at (fx, y world) — for seating eyes ON the skin */
function surfaceXAt(fx: number, y: number): number {
  const { top, bot } = statAt(fx)
  const yTop = wy(top), yBot = wy(bot)
  const cy0 = (yTop + yBot) / 2
  const half = y > cy0 ? yTop - cy0 : cy0 - yBot
  const cy = Math.min(0.96, Math.max(-0.96, (y - cy0) / Math.max(1e-5, half)))
  return Math.sin(Math.acos(cy)) * halfWidthAt(fx, yTop - cy0, cy0 - yBot)
}

/**
 * Lofted hull through the traced back/belly lines.
 * Rings of RAD vertices; asymmetric top/bottom radii; welded seam.
 */
function buildBody(): THREE.BufferGeometry {
  const RINGS = 40, RAD = 48
  const pos: number[] = [], uv: number[] = [], idx: number[] = []
  for (let i = 0; i < RINGS; i++) {
    const fx = (PED_X * i) / (RINGS - 1)
    const { top, bot } = statAt(fx)
    const yTop = wy(top), yBot = wy(bot)
    const cy = (yTop + yBot) / 2
    const hT = Math.max(1e-4, yTop - cy)
    const hB = Math.max(1e-4, cy - yBot)
    const hw = halfWidthAt(fx, hT, hB)
    const z = wz(fx)
    for (let j = 0; j <= RAD; j++) {
      const a = (j / RAD) * Math.PI * 2          // 0 = belly seam, π = back
      const c = Math.cos(a), s = Math.sin(a)
      const y = cy + (c >= 0 ? c * hT : c * hB)
      const x = s * hw
      pos.push(x, y, z)
      uv.push(0, 0)                               // replaced by planarUV
    }
  }
  for (let i = 0; i < RINGS - 1; i++) {
    for (let j = 0; j < RAD; j++) {
      const a0 = i * (RAD + 1) + j
      const b0 = a0 + 1
      const a1 = (i + 1) * (RAD + 1) + j
      const b1 = a1 + 1
      idx.push(a0, b0, a1, b0, b1, a1)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  // weld the belly seam normals
  const n = geo.attributes.normal as THREE.BufferAttribute
  for (let i = 0; i < RINGS; i++) {
    const a = i * (RAD + 1), b = a + RAD
    const nx = n.getX(a) + n.getX(b)
    const ny = n.getY(a) + n.getY(b)
    const nz = n.getZ(a) + n.getZ(b)
    const l = Math.hypot(nx, ny, nz) || 1
    n.setXYZ(a, nx / l, ny / l, nz / l)
    n.setXYZ(b, nx / l, ny / l, nz / l)
  }
  // close the snout with a fan cap (ring 0)
  const { top: sTop, bot: sBot } = statAt(0)
  const cySnout = (wy(sTop) + wy(sBot)) / 2
  const snoutCenterIdx = pos.length / 3
  pos.push(0, cySnout, wz(0) + 0.005)
  uv.push(0, 0)
  for (let j = 0; j < RAD; j++) {
    idx.push(snoutCenterIdx, j, j + 1)
  }

  // close the peduncle with a fan cap (hidden inside the tail root)
  const { top: pTop, bot: pBot } = statAt(PED_X)
  const cyC = (wy(pTop) + wy(pBot)) / 2
  const centerIdx = pos.length / 3
  pos.push(0, cyC, wz(PED_X) - 0.012)
  uv.push(0, 0)
  for (let j = 0; j < RAD; j++) idx.push((RINGS - 1) * (RAD + 1) + j, (RINGS - 1) * (RAD + 1) + j + 1, centerIdx)
  planarUV(geo)
  whiteColors(geo)
  return geo
}

/**
 * A fin shell from a traced outline. The polygon lives in the sheet
 * plane (length × height); it becomes a ShapeGeometry whose local X
 * is the model's Z axis, then rotates into place — so the fin IS the
 * drawn fin, seated exactly where it is drawn, sampling the drawing
 * 1:1 by position. Edges are resampled so the shell bends smoothly
 * with the swim shader instead of flapping as one stiff triangle fan.
 */
function finShell(poly: [number, number][]): THREE.BufferGeometry {
  const dense: [number, number][] = []
  const MAX_SEG = 0.028
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i]
    const [bx, by] = poly[(i + 1) % poly.length]
    dense.push([ax, ay])
    const d = Math.hypot(bx - ax, by - ay)
    const steps = Math.floor(d / MAX_SEG)
    for (let s = 1; s < steps; s++) {
      const f = s / steps
      dense.push([ax + (bx - ax) * f, ay + (by - ay) * f])
    }
  }
  const shape = new THREE.Shape(dense.map(([fx, fy]) => new THREE.Vector2(wz(fx), wy(fy))))
  const geo = new THREE.ShapeGeometry(shape)
  geo.computeVertexNormals()
  finUV(geo)                 // UVs from the SHAPE coords (x = length here)
  geo.rotateY(-Math.PI / 2)  // shape-x → model +z, shape-y → model y
  whiteColors(geo)
  return geo
}

export function buildCustomFish(): { geometry: THREE.BufferGeometry } {
  const parts: THREE.BufferGeometry[] = []

  parts.push(buildBody())
  parts.push(finShell(DORSAL))                       // medial — flat, exactly as drawn
  parts.push(finShell(TAIL))
  parts.push(finShell(ANAL))

  // paired fins — mirrored pair with exact sagittal symmetry.
  // Each fin rotates around its own drawn base arc, seated at the flank surface.
  const pecBase: [number, number] = [0.272, 0.672]   // drawn base arc centre
  const pelBase: [number, number] = [0.345, 0.885]   // drawn pelvic root on the belly

  // Pectoral fins
  const pecZ = wz(pecBase[0])
  const pecY = wy(pecBase[1])
  const pecSx = surfaceXAt(pecBase[0], pecY)

  const rightPec = finShell(PECTORAL)
  rightPec.translate(0, -pecY, -pecZ)

  // assign paddle weights (0 at base origin -> 1 at fin edge)
  const pecPos = rightPec.attributes.position
  const paddleArr = new Float32Array(pecPos.count)
  const maxPecDist = 0.16
  for (let i = 0; i < pecPos.count; i++) {
    const d = Math.hypot(pecPos.getX(i), pecPos.getY(i), pecPos.getZ(i))
    paddleArr[i] = Math.min(1, Math.max(0, d / maxPecDist))
  }
  rightPec.setAttribute('aPecPaddle', new THREE.BufferAttribute(paddleArr, 1))

  rightPec.rotateY(-0.5)
  rightPec.translate(pecSx * 0.82, pecY, pecZ)
  parts.push(rightPec)

  const leftPec = rightPec.clone()
  leftPec.scale(-1, 1, 1)
  if (leftPec.index) {
    const arr = leftPec.index.array as Uint16Array | Uint32Array
    for (let i = 0; i < arr.length; i += 3) {
      const tmp = arr[i]
      arr[i] = arr[i + 1]
      arr[i + 1] = tmp
    }
  }
  leftPec.computeVertexNormals()
  parts.push(leftPec)

  // Pelvic fins
  const pelZ = wz(pelBase[0])
  const pelY = wy(pelBase[1])
  const pelSx = surfaceXAt(pelBase[0], pelY)

  const rightPel = finShell(PELVIC)
  rightPel.translate(0, -pelY, -pelZ)
  rightPel.rotateY(-0.22)
  rightPel.rotateX(-0.35)
  rightPel.translate(pelSx * 0.65, pelY, pelZ)
  parts.push(rightPel)

  const leftPel = rightPel.clone()
  leftPel.scale(-1, 1, 1)
  if (leftPel.index) {
    const arr = leftPel.index.array as Uint16Array | Uint32Array
    for (let i = 0; i < arr.length; i += 3) {
      const tmp = arr[i]
      arr[i] = arr[i + 1]
      arr[i + 1] = tmp
    }
  }
  leftPel.computeVertexNormals()
  parts.push(leftPel)

  // real 3D eyes seated where the pupil was drawn
  const eyeZ = wz(EYE.x)
  const eyeY = wy(EYE.y)
  const eyeR = EYE.rS * LEN * 0.8
  const sx = surfaceXAt(EYE.x, EYE.y)
  parts.push(...makeEyeParts(1, sx, eyeY, eyeZ, eyeR, '#232a31'))
  parts.push(...makeEyeParts(-1, sx, eyeY, eyeZ, eyeR, '#232a31'))

  const merged = mergeGeometries(
    parts.map((p) => {
      const g = p.index ? p.toNonIndexed() : p
      if (!g.attributes.aPecPaddle) {
        g.setAttribute('aPecPaddle', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count), 1))
      }
      return g
    }),
    false,
  )!
  return { geometry: merged }
}

/**
 * Material for a painted fish — same swim-bend/rim shader as the reef
 * species, gentle bump so crayon strokes stay readable.
 */
export function makeCustomFishMaterial(texture: THREE.Texture): THREE.MeshStandardMaterial {
  const mat = makeFishMaterial(texture as THREE.CanvasTexture, 0.075, 7, `fish-custom-${Math.random().toString(36).slice(2)}`)
  mat.bumpScale = 0.12
  return mat
}

/** paint the reserved white texel (eyes sample it) onto a processed sheet */
export function reserveWhiteTexel(ctx: CanvasRenderingContext2D, size: number) {
  const WHITE_UV = 0.965
  const x = WHITE_UV * size
  const y = (1 - WHITE_UV) * size   // v-up → canvas y-down
  const r = size * 0.018
  ctx.save()
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(x - r, y - r, r * 2, r * 2)
  ctx.restore()
}
