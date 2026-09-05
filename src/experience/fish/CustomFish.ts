// ---------------------------------------------------------------
// CustomFish — the 3D fish whose skin is a CHILD'S PAINTING.
//
// The geometry is built with the same swept-hull + ray-fin anatomy
// as the reef species, but every UV is remapped onto the colouring
// sheet layout (FishTemplate.FISH_SHEET):
//   • the hull WRAPS the painting around its circumference — each
//     flank shows the full side view, nose → tail;
//   • each fin samples the sheet region where that fin is DRAWN
//     (tail fork, dorsal, anal, pelvic, pectoral) — so a stroke of
//     red on the printed tail really turns the 3D tail red;
//   • the eyes stay real 3D eyeballs sampling a reserved white
//     texel, so the fish keeps its lively look whatever was drawn.
// ---------------------------------------------------------------
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import {
  WHITE_UV, makeHull, makeTailFan, makeRayFin, makePectoralFan, makeEyeParts,
  makeFishMaterial, type BodySpec,
} from './FishGeometryFactory'
import { FISH_SHEET, type SheetRect } from './FishTemplate'

const WHITE = new THREE.Color('#ffffff')

/** friendly, slightly chunky reef fish silhouette (tail → nose radii) */
const CUSTOM_BODY: BodySpec = {
  profile: [0.02, 0.075, 0.14, 0.19, 0.21, 0.17, 0.105, 0.045, 0.012],
  w: 0.47, h: 1.05, len: 0.6,
}
const TAIL_SPEC = { len: 0.22, spread: 0.16, fork: 0.6 }
const DORSAL_SPEC: [number, number][] = [[0.16, 0.07], [0.0, 0.12], [-0.18, 0.05]]
const ANAL_SPEC: [number, number][] = [[0.02, 0.06], [-0.2, 0.05]]

/** force a part's vertex colors to white so the painting shows untinted */
function whiteColors(geo: THREE.BufferGeometry) {
  const n = geo.attributes.position.count
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3))
}

const lerp = (a: number, b: number, f: number) => a + (b - a) * f

/**
 * Remap a fin's UVs onto its sheet region.
 * uMode: 'zFront' → head-side edge of the fin = rect left (tail/dorsal/anal);
 *        'radial' → fan grows along +x, root = rect left (pectoral/pelvic).
 * vMode: 'up'     → base at rect bottom, tip at top (dorsal);
 *        'down'   → base at rect top, tip hangs to bottom (anal/pelvic);
 *        'span'   → full vertical extent (tail fork).
 */
function mapFinUV(
  geo: THREE.BufferGeometry,
  rect: SheetRect,
  uMode: 'zFront' | 'radial',
  vMode: 'up' | 'down' | 'span',
) {
  geo.computeBoundingBox()
  const bb = geo.boundingBox!
  const pos = geo.attributes.position as THREE.BufferAttribute
  const uv = geo.attributes.uv as THREE.BufferAttribute
  const zSpan = Math.max(1e-5, bb.max.z - bb.min.z)
  const xSpan = Math.max(1e-5, bb.max.x - bb.min.x)
  const ySpan = Math.max(1e-5, bb.max.y - bb.min.y)
  for (let i = 0; i < uv.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i)
    let fu: number
    if (uMode === 'zFront') fu = (bb.max.z - z) / zSpan          // front → rect left
    else fu = (x - bb.min.x) / xSpan                             // root → rect left
    fu = Math.min(1, Math.max(0, fu))
    let fv: number
    if (vMode === 'up') fv = (y - bb.min.y) / ySpan              // base → rect bottom
    else if (vMode === 'down') fv = (bb.max.y - y) / ySpan       // base → rect top
    else fv = (y - bb.min.y) / ySpan                             // span: top lobe → rect top
    fv = Math.min(1, Math.max(0, fv))
    const u = lerp(rect.x0, rect.x1, fu)
    const v = vMode === 'down' ? lerp(rect.y1, rect.y0, fv) : lerp(rect.y0, rect.y1, fv)
    uv.setXY(i, u, v)
  }
  uv.needsUpdate = true
}

/** wrap the sheet's BODY zone around the hull circumference */
function mapBodyUV(geo: THREE.BufferGeometry) {
  const B = FISH_SHEET.BODY
  const uv = geo.attributes.uv as THREE.BufferAttribute
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i)                    // 0..1 around (0 = belly seam)
    const t = uv.getY(i)                    // 0 tail → 1 nose
    const cy = -Math.cos(u * Math.PI * 2)   // -1 belly → +1 back
    const s = 1 - t                         // 0 nose → 1 tail root
    const nv = (cy + 1) / 2
    uv.setXY(i, lerp(B.x0, B.x1, s), lerp(B.y0, B.y1, nv))
  }
  uv.needsUpdate = true
}

export function buildCustomFish(): { geometry: THREE.BufferGeometry } {
  const parts: THREE.BufferGeometry[] = []

  // --- hull — painting wrapped around it ---
  const { geo: body, radiusAt, widthAt, surfaceXAt } = makeHull(CUSTOM_BODY)
  mapBodyUV(body)
  parts.push(body)

  // --- caudal fin — samples the painted tail fork ---
  const tail = makeTailFan(TAIL_SPEC.len, TAIL_SPEC.spread, TAIL_SPEC.fork, WHITE)
  mapFinUV(tail, FISH_SHEET.TAIL, 'zFront', 'span')
  whiteColors(tail)
  tail.translate(0, 0, -CUSTOM_BODY.len * 0.46)
  parts.push(tail)

  // --- dorsal + anal — ray grids seated on the hull ---
  const dorsal = makeRayFin(DORSAL_SPEC, WHITE, radiusAt, CUSTOM_BODY.h, 1, 9)
  mapFinUV(dorsal, FISH_SHEET.DORSAL, 'zFront', 'up')
  whiteColors(dorsal)
  parts.push(dorsal)

  const anal = makeRayFin(ANAL_SPEC, WHITE, radiusAt, CUSTOM_BODY.h, -1, 7)
  mapFinUV(anal, FISH_SHEET.ANAL, 'zFront', 'down')
  whiteColors(anal)
  parts.push(anal)

  // --- pectorals behind the gill plate, pelvics on the belly ---
  const pecZ = CUSTOM_BODY.len * 0.1
  const pecW = widthAt(pecZ) * CUSTOM_BODY.w
  const pecY = -radiusAt(pecZ) * CUSTOM_BODY.h * 0.12
  const pelZ = CUSTOM_BODY.len * 0.08
  const pelY = -radiusAt(pelZ) * CUSTOM_BODY.h * 0.62
  for (const side of [1, -1] as const) {
    const pec = makePectoralFan(0.15, WHITE, 6)
    mapFinUV(pec, FISH_SHEET.PECTORAL, 'radial', 'down')
    whiteColors(pec)
    pec.rotateY(side * -0.9)
    pec.rotateZ(side * 0.5)
    pec.translate(side * pecW * 0.74, pecY, pecZ)
    parts.push(pec)

    const pel = makePectoralFan(0.135, WHITE, 5)
    mapFinUV(pel, FISH_SHEET.PELVIC, 'radial', 'down')
    whiteColors(pel)
    pel.rotateY(side * -0.5)
    pel.rotateX(-0.85)
    pel.translate(side * widthAt(pelZ) * CUSTOM_BODY.w * 0.4, pelY, pelZ)
    parts.push(pel)
  }

  // --- real 3D eyes sampling the reserved white texel ---
  const eyeZ = CUSTOM_BODY.len * 0.28
  const eyeY = radiusAt(eyeZ) * CUSTOM_BODY.h * 0.38
  const skinX = surfaceXAt(eyeZ, eyeY)
  const eyeR = Math.min(0.048, skinX * 0.85)
  parts.push(...makeEyeParts(1, skinX, eyeY, eyeZ, eyeR, '#2a2014'))
  parts.push(...makeEyeParts(-1, skinX, eyeY, eyeZ, eyeR, '#2a2014'))

  const merged = mergeGeometries(
    parts.map((p) => (p.index ? p.toNonIndexed() : p)),
    false,
  )!
  return { geometry: merged }
}

/**
 * Material for a painted fish — same swim-bend/rim shader as the reef
 * species, gentler scale bump so crayon strokes stay readable.
 */
export function makeCustomFishMaterial(texture: THREE.Texture): THREE.MeshStandardMaterial {
  const mat = makeFishMaterial(texture as THREE.CanvasTexture, 0.085, 7, `fish-custom-${Math.random().toString(36).slice(2)}`)
  mat.bumpScale = 0.16
  return mat
}

/** paint the reserved white texel (eyes sample it) onto a processed sheet */
export function reserveWhiteTexel(ctx: CanvasRenderingContext2D, size: number) {
  const x = WHITE_UV * size
  const y = (1 - WHITE_UV) * size   // v-up → canvas y-down
  const r = size * 0.018
  ctx.save()
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(x - r, y - r, r * 2, r * 2)
  ctx.restore()
}
