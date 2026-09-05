// ---------------------------------------------------------------
// FishScan — turns a photo/scan of a coloured template into the
// texture sheet for a custom 3D fish.
//
// WHY THE FISH HAD WHITE PATCHES (and how this pipeline kills each
// cause):
//   1. The PRINTED FRAME around the template is a huge closed ring —
//      bigger than the fish — so "largest component" used to pick the
//      frame and the whole sheet (paper + table) became the texture.
//      → the frame is now DETECTED (hollow box with long straight
//        runs spanning the photo) and cut away; the fish is re-picked
//        from the paper area inside it.
//   2. PALE crayon (light yellow, pink, skin tones) and paper gaps
//      inside the fish were not "ink", so they became holes in the
//      mask and were ERASED to white — white patches exactly where
//      the drawing was coloured.
//      → the fish mask is HOLE-FILLED into a solid silhouette:
//        everything the outline encloses belongs to the fish and is
//        never erased.
//   3. Interior details (pupil, gill strokes, fin rays) are separate
//      components — they were dropped before. → satellites lying
//      inside the silhouette are united with the body.
//   4. Hard alpha erasing left white fringes at the edges.
//      → replaced by BFS INPAINT: every pixel outside the silhouette
//        takes the colour of the NEAREST fish pixel. The photo
//        background can never reach the texture — not white, not
//        table, not shadow — and the model never samples an empty
//        gap near the silhouette either.
//
// Full pipeline: decode → downscale → paper estimate (bright
// percentile of the whole frame) → per-pixel ink mask → 1px dilation
// → components → background rejection (border-touch) → frame cut →
// satellite union → hole-fill → 2px dilation → tight crop at the
// fish bbox → inpaint → STRETCH to fill the whole UV window (no
// letterbox — the painting covers the model edge to edge) → gentle
// saturation/contrast lift → JPEG.
// ---------------------------------------------------------------
import { reserveWhiteTexel } from './CustomFish'
import { SHEET_CONTRACT } from './FishTemplate'

export interface ProcessedFish {
  dataUrl: string
  name: string
}

const WORK_MAX = 1024        // analysis resolution cap
const SHEET = 768            // final texture sheet size
const MAX_DATAURL = 480_000  // transport cap — enforced by the tank API too

/** the UV window (on the square sheet) the fish crop is stretched into */
const WIN_X = Math.round(SHEET_CONTRACT.u0 * SHEET)          // 46
const WIN_Y = Math.round((1 - SHEET_CONTRACT.v1) * SHEET)    // 169
const WIN_W = Math.round((SHEET_CONTRACT.u1 - SHEET_CONTRACT.u0) * SHEET)  // 676
const WIN_H = Math.round((SHEET_CONTRACT.v1 - SHEET_CONTRACT.v0) * SHEET)  // 430

async function decodeImage(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(file) } catch { /* fall through */ }
  }
  const url = URL.createObjectURL(file)
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('decode failed'))
      img.src = url
    })
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 8000)
  }
}

/** downscale to the working size, flattened onto white */
function toWorkCanvas(src: ImageBitmap | HTMLImageElement) {
  const w = 'width' in src ? src.width : 0
  const h = 'height' in src ? src.height : 0
  const scale = Math.min(1, WORK_MAX / Math.max(w, h))
  const W = Math.max(8, Math.round(w * scale))
  const H = Math.max(8, Math.round(h * scale))
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, H)
  ctx.drawImage(src as CanvasImageSource, 0, 0, W, H)
  return { canvas, ctx, W, H }
}

interface FishMask {
  mask: Uint8Array<ArrayBufferLike>          // per-pixel, W*H, 1 = fish (solid)
  x0: number; y0: number; x1: number; y1: number   // tight bbox
  area: number
}

interface Comp {
  id: number
  size: number
  border: boolean                            // touches the photo border
  x0: number; y0: number; x1: number; y1: number
}

/** 8-neighbourhood dilation, `it` passes */
function dilate(src: Uint8Array<ArrayBufferLike>, W: number, H: number, it: number): Uint8Array<ArrayBufferLike> {
  let cur = src
  for (let p = 0; p < it; p++) {
    const out = new Uint8Array(W * H)
    for (let y = 0; y < H; y++) {
      const ya = y > 0 ? y - 1 : 0, yb = y < H - 1 ? y + 1 : H - 1
      for (let x = 0; x < W; x++) {
        if (!cur[y * W + x]) continue
        const xa = x > 0 ? x - 1 : 0, xb = x < W - 1 ? x + 1 : W - 1
        for (let yy = ya; yy <= yb; yy++) {
          const row = yy * W
          for (let xx = xa; xx <= xb; xx++) out[row + xx] = 1
        }
      }
    }
    cur = out
  }
  return cur
}

/** 4-connected components of a binary mask */
function labelComponents(mask: Uint8Array<ArrayBufferLike>, W: number, H: number): { comps: Comp[]; labels: Int32Array<ArrayBufferLike> } {
  const labels = new Int32Array(W * H)
  const comps: Comp[] = []
  const stack: number[] = []
  for (let s = 0; s < W * H; s++) {
    if (!mask[s] || labels[s]) continue
    const id = comps.length + 1
    stack.length = 0
    stack.push(s)
    labels[s] = id
    let size = 0, border = false
    let x0 = W, y0 = H, x1 = 0, y1 = 0
    while (stack.length) {
      const idx = stack.pop()!
      size++
      const y = (idx / W) | 0
      const x = idx - y * W
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) border = true
      if (x > 0 && mask[idx - 1] && !labels[idx - 1]) { labels[idx - 1] = id; stack.push(idx - 1) }
      if (x < W - 1 && mask[idx + 1] && !labels[idx + 1]) { labels[idx + 1] = id; stack.push(idx + 1) }
      if (y > 0 && mask[idx - W] && !labels[idx - W]) { labels[idx - W] = id; stack.push(idx - W) }
      if (y < H - 1 && mask[idx + W] && !labels[idx + W]) { labels[idx + W] = id; stack.push(idx + W) }
    }
    comps.push({ id, size, border, x0, y0, x1, y1 })
  }
  return { comps, labels }
}

/**
 * Non-mask pixels NOT reachable from the image border (4-connected
 * flood through non-mask pixels) — the holes of a component. For the
 * printed frame these holes ARE the paper inside the frame.
 */
function holesOf(comp: Uint8Array<ArrayBufferLike>, W: number, H: number): Uint8Array<ArrayBufferLike> {
  const outside = new Uint8Array(W * H)
  const stack: number[] = []
  const seed = (i: number) => {
    if (!comp[i] && !outside[i]) { outside[i] = 1; stack.push(i) }
  }
  for (let x = 0; x < W; x++) { seed(x); seed((H - 1) * W + x) }
  for (let y = 0; y < H; y++) { seed(y * W); seed(y * W + W - 1) }
  while (stack.length) {
    const idx = stack.pop()!
    const y = (idx / W) | 0
    const x = idx - y * W
    if (x > 0 && !comp[idx - 1] && !outside[idx - 1]) { outside[idx - 1] = 1; stack.push(idx - 1) }
    if (x < W - 1 && !comp[idx + 1] && !outside[idx + 1]) { outside[idx + 1] = 1; stack.push(idx + 1) }
    if (y > 0 && !comp[idx - W] && !outside[idx - W]) { outside[idx - W] = 1; stack.push(idx - W) }
    if (y < H - 1 && !comp[idx + W] && !outside[idx + W]) { outside[idx + W] = 1; stack.push(idx + W) }
  }
  const holes = new Uint8Array(W * H)
  for (let i = 0; i < W * H; i++) if (!comp[i] && !outside[i]) holes[i] = 1
  return holes
}

/**
 * The printed frame's signature: a hollow ring spanning most of the
 * photo whose bbox edges carry long straight runs. A fish never has
 * straight runs across 70% of its own bounding box edges.
 */
function frameSignature(m: Uint8Array<ArrayBufferLike>, W: number, H: number, c: Comp): boolean {
  const bw = c.x1 - c.x0 + 1
  const bh = c.y1 - c.y0 + 1
  if (bw < W * 0.55 || bh < H * 0.55) return false     // must span the photo
  if (c.size / (bw * bh) > 0.5) return false           // hollow — not a solid blob
  let sides = 0
  for (const y of [c.y0, c.y1]) {
    let run = 0, best = 0
    for (let x = c.x0; x <= c.x1; x++) { run = m[y * W + x] ? run + 1 : 0; if (run > best) best = run }
    if (best >= bw * 0.7) sides++
  }
  for (const x of [c.x0, c.x1]) {
    let run = 0, best = 0
    for (let y = c.y0; y <= c.y1; y++) { run = m[y * W + x] ? run + 1 : 0; if (run > best) best = run }
    if (best >= bh * 0.7) sides++
  }
  return sides >= 2
}

/**
 * Per-pixel fish mask with frame cut, satellite union and hole fill.
 * Returns null when nothing fish-sized was found.
 */
function fineFishMask(ctx: CanvasRenderingContext2D, W: number, H: number): FishMask | null {
  const img = ctx.getImageData(0, 0, W, H).data
  const N = W * H

  // paper estimate: bright 88th percentile of the WHOLE frame — robust
  // even when the photo border shows the table instead of the sheet
  const lums: number[] = []
  for (let i = 0; i < N; i += 5) {
    const j = i * 4
    lums.push(0.32 * img[j] + 0.58 * img[j + 1] + 0.1 * img[j + 2])
  }
  lums.sort((a, b) => a - b)
  const paper = lums[Math.floor(lums.length * 0.88)] ?? 255

  // ink: coloured (saturation) or clearly darker than the paper.
  // Threshold is tolerant — the hole fill below rescues anything pale
  // this step misses, as long as the enclosing outline is caught.
  const ink = new Uint8Array(N)
  const paperMask = new Uint8Array(N)                  // bright paper (the sheet)
  for (let i = 0; i < N; i++) {
    const j = i * 4
    if (img[j + 3] < 40) continue
    const r = img[j], g = img[j + 1], b = img[j + 2]
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
    const lum = 0.32 * r + 0.58 * g + 0.1 * b
    if (mx - mn > 26 || lum < paper - 50) ink[i] = 1
    else if (lum > paper - 25) paperMask[i] = 1
  }
  const m1 = dilate(ink, W, H, 1)                      // solidify anti-aliased strokes
  const { comps, labels } = labelComponents(m1, W, H)

  const minArea = Math.max(80, N * 0.004)
  // the photo's background always reaches the border — reject it
  const cands = comps.filter((c) => !c.border && c.size >= minArea)
  // extreme close-up: the fish itself touches the border — allow it
  let pool = cands.length ? cands : comps.filter((c) => c.size >= minArea * 2)
  if (!pool.length) return null
  if (pool.length > 1) {
    // several candidates compete (a toy on the table, a second sheet) —
    // keep the ones sitting ON bright paper. Sampled around the comp's
    // own pixels, so a fat fish that fills its bbox still scores 1.
    const onSheet = (c: Comp) => {
      let n = 0, hit = 0
      for (let y = c.y0; y <= c.y1; y += 12) {
        for (let x = c.x0; x <= c.x1; x += 12) {
          const i = y * W + x
          if (labels[i] === c.id) continue
          n++
          if (paperMask[i]) hit++
        }
      }
      return n < 8 ? 1 : hit / n
    }
    const onPaper = pool.filter((c) => onSheet(c) >= 0.45)
    if (onPaper.length) pool = onPaper
  }
  pool.sort((a, b) => b.size - a.size)

  // pixels reachable from the photo border through non-ink — the true
  // outside; its 6px neighbourhood is the frame's outer band (cut so
  // the fish separates from the frame even when a stroke touches it)
  const reach = new Uint8Array(N)                      // reachable non-ink from border
  {
    const stack: number[] = []
    for (let x = 0; x < W; x++) {
      if (!m1[x] && !reach[x]) { reach[x] = 1; stack.push(x) }
      const b = (H - 1) * W + x
      if (!m1[b] && !reach[b]) { reach[b] = 1; stack.push(b) }
    }
    for (let y = 0; y < H; y++) {
      const l = y * W, r = y * W + W - 1
      if (!m1[l] && !reach[l]) { reach[l] = 1; stack.push(l) }
      if (!m1[r] && !reach[r]) { reach[r] = 1; stack.push(r) }
    }
    while (stack.length) {
      const idx = stack.pop()!
      const y = (idx / W) | 0
      const x = idx - y * W
      if (x > 0 && !m1[idx - 1] && !reach[idx - 1]) { reach[idx - 1] = 1; stack.push(idx - 1) }
      if (x < W - 1 && !m1[idx + 1] && !reach[idx + 1]) { reach[idx + 1] = 1; stack.push(idx + 1) }
      if (y > 0 && !m1[idx - W] && !reach[idx - W]) { reach[idx - W] = 1; stack.push(idx - W) }
      if (y < H - 1 && !m1[idx + W] && !reach[idx + W]) { reach[idx + W] = 1; stack.push(idx + W) }
    }
  }

  let fishId = 0
  let fishLabels: Int32Array<ArrayBufferLike> | null = null

  const frame = pool.find((c) => frameSignature(m1, W, H, c))
  if (frame) {
    // ---- printed frame detected: re-pick the fish INSIDE it ----
    const frameComp = new Uint8Array(N)
    for (let i = 0; i < N; i++) if (labels[i] === frame.id) frameComp[i] = 1
    const inner = holesOf(frameComp, W, H)             // paper enclosed by the frame
    const search = dilate(inner, W, H, 3)              // grow so strokes hugging the paper are covered
    const cut = dilate(reach, W, H, 6)                 // outer frame band — cut it even when the fish touches the frame
    const sub = new Uint8Array(N)
    for (let i = 0; i < N; i++) if (m1[i] && search[i] && !cut[i]) sub[i] = 1
    const subLabeled = labelComponents(sub, W, H)
    const innerFish = subLabeled.comps
      .filter((c) => c.size >= minArea && !frameSignature(sub, W, H, c))
      .sort((a, b) => b.size - a.size)[0]
    if (innerFish) {
      fishId = innerFish.id
      fishLabels = subLabeled.labels
    }
  }
  if (!fishLabels) {
    const pick = pool.find((c) => !frameSignature(m1, W, H, c)) ?? pool[0]
    fishId = pick.id
    fishLabels = labels
  }

  // body = the chosen component …
  const fishMask = new Uint8Array(N)
  let fishSize = 0
  for (let i = 0; i < N; i++) if (fishLabels[i] === fishId) { fishMask[i] = 1; fishSize++ }
  const bodyPixels = fishMask.slice()                  // snapshot in PIXEL space (works across label runs)

  // … + its holes: pale crayon and paper gaps INSIDE the outline are
  // part of the fish — erasing them is what punched white patches in
  const fill = (m: Uint8Array<ArrayBufferLike>) => {
    const h = holesOf(m, W, H)
    for (let i = 0; i < N; i++) if (h[i]) m[i] = 1
  }
  fill(fishMask)

  // satellite marks (pupil, gill strokes, fin rays) — separate comps
  // that live inside the silhouette join the body. Only comps well
  // below half the body size qualify (never a second sheet or a
  // neighbouring object).
  for (const c of comps) {
    if (c.border || c.size < 12 || c.size >= fishSize * 0.5) continue
    let total = 0, inside = 0, body = 0
    for (let y = c.y0; y <= c.y1; y++) {
      for (let x = c.x0; x <= c.x1; x++) {
        const i = y * W + x
        if (labels[i] === c.id) {
          total++
          if (fishMask[i]) inside++
          if (bodyPixels[i]) body++
        }
      }
    }
    if (total === 0 || body / total >= 0.5) continue   // (part of) the body itself
    if (inside / total >= 0.55) {
      for (let i = 0; i < N; i++) if (labels[i] === c.id) fishMask[i] = 1
    }
  }
  fill(fishMask)                                       // satellites may enclose new gaps

  // bbox from a 2px-dilated extent (the crop must include the full AA
  // edge) — but the mask itself stays UNDILATED: a dilated ring would
  // grab the WHITE PAPER just outside the thin outline strokes and the
  // inpaint would then propagate paper-white instead of fish colour.
  const wide = dilate(fishMask, W, H, 2)
  let x0 = W, y0 = H, x1 = 0, y1 = 0, area = 0
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (wide[y * W + x]) {
        area++
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  if (!area || x1 <= x0 || y1 <= y0) return null
  return { mask: fishMask, x0, y0, x1, y1, area }
}

/** tidy file name: extension off, separators spaced, clamped */
function nameFromFile(file: File): string {
  const base = file.name.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').trim()
  return (base || 'My fish').slice(0, 28)
}

/**
 * Photo/scan of a coloured template → texture sheet (JPEG data URL).
 *
 * The fish is cropped EXACTLY at its own bounding box, the background
 * is INPAINTED away (nearest fish colour — never white, never table),
 * and the fish-only image is stretched to fill the entire UV window —
 * so however messy the photo was, the drawing covers the 3D fish
 * fully, at full size, with no white patches and no background.
 */
export async function processFishImage(file: File): Promise<ProcessedFish> {
  const src = await decodeImage(file)
  const { ctx, W, H } = toWorkCanvas(src)
  if ('close' in src && typeof src.close === 'function') src.close()

  const found = fineFishMask(ctx, W, H)

  // fish-only crop — or the whole picture as a last-resort fallback
  let crop: HTMLCanvasElement
  if (found) {
    const cw = found.x1 - found.x0 + 1
    const ch = found.y1 - found.y0 + 1
    crop = document.createElement('canvas')
    crop.width = cw
    crop.height = ch
    const cctx = crop.getContext('2d', { willReadFrequently: true })!
    cctx.drawImage(ctx.canvas, found.x0, found.y0, cw, ch, 0, 0, cw, ch)

    // BFS inpaint: every pixel OUTSIDE the fish silhouette adopts the
    // colour of the nearest fish pixel. The background (table, paper,
    // shadow) never reaches the texture, and there is no white fringe
    // at the silhouette edge for the model to sample.
    const id = cctx.getImageData(0, 0, cw, ch)
    const d = id.data
    const known = new Uint8Array(cw * ch)
    const queue = new Int32Array(cw * ch)
    let qh = 0, qt = 0
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        const i = y * cw + x
        if (!found.mask[(found.y0 + y) * W + (found.x0 + x)]) continue
        const j = i * 4
        const r = d[j], g = d[j + 1], b = d[j + 2]
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
        const lum = 0.32 * r + 0.58 * g + 0.1 * b
        // near-white paper is NEVER a seed: uncolored pockets inside the
        // fish would win the nearest-colour race and flood paper-white
        // over the outside. Excluded, they are inpainted FROM the fish
        // colours around them — gaps get coloured, never stay paper.
        if (lum > 242 && mx - mn < 14) continue
        known[i] = 1
        queue[qt++] = i
      }
    }
    if (qt > 0) {
      const seedsOnly = known.slice()                 // true fish pixels (fixed)
      while (qh < qt) {
        const i = queue[qh++]
        const y = (i / cw) | 0
        const x = i - y * cw
        const j = i * 4
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy
          if (yy < 0 || yy >= ch) continue
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue
            const xx = x + dx
            if (xx < 0 || xx >= cw) continue
            const n = yy * cw + xx
            if (known[n]) continue
            known[n] = 1
            const k = n * 4
            d[k] = d[j]; d[k + 1] = d[j + 1]; d[k + 2] = d[j + 2]; d[k + 3] = 255
            queue[qt++] = n
          }
        }
      }
      // Jacobi diffusion over the filled region: replaces the streaky
      // nearest-copy with a smooth colour extension (seeds stay fixed)
      let cur = new Uint8ClampedArray(d)
      let nxt = new Uint8ClampedArray(d.length)
      for (let p = 0; p < 14; p++) {
        for (let y = 0; y < ch; y++) {
          const ya = y > 0 ? y - 1 : 0, yb = y < ch - 1 ? y + 1 : ch - 1
          for (let x = 0; x < cw; x++) {
            const i = y * cw + x
            const k4 = i * 4
            if (seedsOnly[i]) { nxt[k4] = cur[k4]; nxt[k4 + 1] = cur[k4 + 1]; nxt[k4 + 2] = cur[k4 + 2]; continue }
            let r = 0, g = 0, b = 0, n2 = 0
            for (let yy = ya; yy <= yb; yy++) {
              const xa = x > 0 ? x - 1 : 0, xb = x < cw - 1 ? x + 1 : cw - 1
              for (let xx = xa; xx <= xb; xx++) {
                if (xx === x && yy === y) continue
                const m4 = (yy * cw + xx) * 4
                r += cur[m4]; g += cur[m4 + 1]; b += cur[m4 + 2]; n2++
              }
            }
            nxt[k4] = r / n2; nxt[k4 + 1] = g / n2; nxt[k4 + 2] = b / n2
          }
        }
        const t = cur; cur = nxt; nxt = t
      }
      d.set(cur)
      cctx.putImageData(id, 0, 0)
    }
  } else {
    crop = document.createElement('canvas')
    crop.width = W
    crop.height = H
    crop.getContext('2d')!.drawImage(ctx.canvas, 0, 0)
  }

  // sheet: the fish-only crop stretched to fill the whole UV window
  const sheet = document.createElement('canvas')
  sheet.width = SHEET
  sheet.height = SHEET
  const sctx = sheet.getContext('2d')!
  sctx.fillStyle = '#ffffff'
  sctx.fillRect(0, 0, SHEET, SHEET)
  sctx.imageSmoothingQuality = 'high'
  try { sctx.filter = 'saturate(1.16) contrast(1.07) brightness(1.02)' } catch { /* old browsers */ }
  sctx.drawImage(crop, WIN_X, WIN_Y, WIN_W, WIN_H)
  try { sctx.filter = 'none' } catch { /* noop */ }
  reserveWhiteTexel(sctx, SHEET)

  let dataUrl = sheet.toDataURL('image/jpeg', 0.86)
  // quality walk if the transport cap bites
  let q = 0.86
  while (dataUrl.length > MAX_DATAURL && q > 0.5) {
    q -= 0.12
    dataUrl = sheet.toDataURL('image/jpeg', q)
  }
  return { dataUrl, name: nameFromFile(file) }
}
