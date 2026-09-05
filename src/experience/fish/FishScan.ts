// ---------------------------------------------------------------
// FishScan — turns a photo/scan of a coloured template into the
// texture sheet for a custom 3D fish.
//
// Pipeline: decode → downscale → estimate the paper background →
// ink mask (saturated or dark pixels) → detect & remove the SHEET
// FRAME (the printed border must never be mistaken for the fish —
// that made whole-sheet textures and ghost-white fish) → largest
// remaining connected component (= the painted fish) → crop to its
// bounding box → letterbox onto the TEMPLATE'S OWN ASPECT (so the
// FishTemplate layout contract holds for ANY photo) → gentle
// saturation/contrast lift → reserve the white texel the 3D eyes
// sample → JPEG data URL.
//
// Robust by design: pencil-only drawings, coloured backgrounds,
// slightly tilted photos and close-up scans all degrade gracefully.
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

/**
 * The official template's fish-bbox aspect (w/h), traced from the
 * user's sheet (950 × 604 px). Every scan is letterboxed onto a
 * canvas of this aspect before it lands on the texture sheet, so
 * the fish bbox always fills SHEET_CONTRACT's UV window.
 */
const TPL_ASPECT = SHEET_CONTRACT.aspect
const CONTRACT_W = 676                                  // 768 × 0.88
const CONTRACT_H = Math.round(CONTRACT_W / TPL_ASPECT)  // ≈ 430

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

interface Blob2D { minX: number; minY: number; maxX: number; maxY: number; size: number }

/**
 * Ink mask + largest connected component on a coarse grid.
 * A printed sheet FRAME (long straight ink lines near the borders)
 * is detected and erased first — the frame is the biggest stroke on
 * the sheet and would otherwise win the "largest component" vote.
 * Returns the fish bbox in work-canvas pixel coordinates.
 */
function findFishBBox(ctx: CanvasRenderingContext2D, W: number, H: number): Blob2D | null {
  // coarse grid — component search is O(cells) and precision is not needed
  const G = Math.min(220, Math.max(64, Math.round(Math.max(W, H) / 4)))
  const cell = Math.max(1, Math.ceil(Math.max(W, H) / G))
  const cols = Math.ceil(W / cell)
  const rows = Math.ceil(H / cell)
  const img = ctx.getImageData(0, 0, W, H).data

  // paper estimate: median border luminance
  const borderLums: number[] = []
  const lumAt = (x: number, y: number) => {
    const i = (y * W + x) * 4
    return 0.32 * img[i] + 0.58 * img[i + 1] + 0.1 * img[i + 2]
  }
  for (let x = 0; x < W; x += Math.max(1, W >> 6)) {
    borderLums.push(lumAt(x, 1), lumAt(x, H - 2))
  }
  for (let y = 0; y < H; y += Math.max(1, H >> 6)) {
    borderLums.push(lumAt(1, y), lumAt(W - 2, y))
  }
  borderLums.sort((a, b) => a - b)
  const paper = borderLums[Math.floor(borderLums.length / 2)] ?? 255

  // ink = saturated colour OR clearly darker than the paper.
  // MAX-POOLED per cell (4 sub-samples): thin 4-6 px pen strokes must not
  // slip between cell centres — a dashed mask shatters the fish into
  // fragments and the "largest component" becomes a mere piece of it.
  const mask = new Uint8Array(cols * rows)
  const sub = Math.max(1, cell >> 2)
  const offs = [0, -sub, sub]
  for (let gy = 0; gy < rows; gy++) {
    for (let gxx = 0; gxx < cols; gxx++) {
      let hit = false
      for (const dy of offs) {
        for (const dx of offs) {
          const x = Math.min(W - 1, Math.max(0, gxx * cell + (cell >> 1) + dx))
          const y = Math.min(H - 1, Math.max(0, gy * cell + (cell >> 1) + dy))
          const i = (y * W + x) * 4
          const r = img[i], g = img[i + 1], b = img[i + 2]
          const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
          const sat = mx - mn
          const lum = 0.32 * r + 0.58 * g + 0.1 * b
          const a = img[i + 3]
          if (a < 40) continue                                   // transparent
          if (sat > 34 || lum < paper - 62) { hit = true; break }
        }
        if (hit) break
      }
      if (hit) mask[gy * cols + gxx] = 1
    }
  }

  // ---- sheet-frame detection: a long straight ink line near each border ----
  // (run on the raw mask, BEFORE dilation — dilation would thicken the
  // frame and could bridge it to the fish)
  const lineAt = {
    top: -1, bottom: -1, left: -1, right: -1,
  }
  const ROW_FRAC = 0.55
  const searchBands = Math.max(2, Math.round(rows * 0.12))
  const searchCols = Math.max(2, Math.round(cols * 0.12))
  const rowFrac = (gy: number) => {
    let n = 0
    for (let gx = 0; gx < cols; gx++) n += mask[gy * cols + gx]
    return n / cols
  }
  const colFrac = (gx: number) => {
    let n = 0
    for (let gy = 0; gy < rows; gy++) n += mask[gy * cols + gx]
    return n / rows
  }
  for (let d = 0; d < searchBands; d++) {
    if (lineAt.top < 0 && rowFrac(d) > ROW_FRAC) lineAt.top = d
    if (lineAt.bottom < 0 && rowFrac(rows - 1 - d) > ROW_FRAC) lineAt.bottom = rows - 1 - d
  }
  for (let d = 0; d < searchCols; d++) {
    if (lineAt.left < 0 && colFrac(d) > ROW_FRAC) lineAt.left = d
    if (lineAt.right < 0 && colFrac(cols - 1 - d) > ROW_FRAC) lineAt.right = cols - 1 - d
  }
  // erase everything outside the frame lines (and the lines themselves —
  // they are up to 2 coarse cells thick, so cut 2 cells inward per side)
  const cut = { top: 0, bottom: rows - 1, left: 0, right: cols - 1 }
  let framed = false
  if (lineAt.top >= 0) { cut.top = lineAt.top + 2; framed = true }
  if (lineAt.bottom >= 0) { cut.bottom = lineAt.bottom - 2; framed = true }
  if (lineAt.left >= 0) { cut.left = lineAt.left + 2; framed = true }
  if (lineAt.right >= 0) { cut.right = lineAt.right - 2; framed = true }
  if (framed) {
    for (let gy = 0; gy < rows; gy++) {
      for (let gxx = 0; gxx < cols; gxx++) {
        if (gy < cut.top || gy > cut.bottom || gxx < cut.left || gxx > cut.right) {
          mask[gy * cols + gxx] = 0
        }
      }
    }
  }

  // ---- dilate 2 cells (8-neighbourhood) so the drawing is ONE component ----
  // colouring sheets are thin outlines; canvas downscaling thins them further,
  // and the ring breaks at narrow junctions (mouth sliver, tail peduncle).
  // Two coarse cells (~10 px) bridge those gaps without merging the (already
  // cut) frame back in — the frame remnant stays far smaller than the fish.
  let dil = new Uint8Array(cols * rows)
  dil.set(mask)
  for (let pass = 0; pass < 2; pass++) {
    const src = dil
    const out = new Uint8Array(cols * rows)
    out.set(src)
    for (let gy = 0; gy < rows; gy++) {
      const y0 = gy > 0 ? gy - 1 : 0
      const y1 = gy < rows - 1 ? gy + 1 : rows - 1
      for (let gxx = 0; gxx < cols; gxx++) {
        if (!src[gy * cols + gxx]) continue
        const x0 = gxx > 0 ? gxx - 1 : 0
        const x1 = gxx < cols - 1 ? gxx + 1 : cols - 1
        for (let yy = y0; yy <= y1; yy++) {
          for (let xx = x0; xx <= x1; xx++) out[yy * cols + xx] = 1
        }
      }
    }
    dil = out
  }

  // largest 4-connected component (on the dilated mask)
  const seen = new Uint8Array(cols * rows)
  let best: Blob2D | null = null
  const stack: number[] = []
  for (let start = 0; start < cols * rows; start++) {
    if (!dil[start] || seen[start]) continue
    stack.length = 0
    stack.push(start)
    seen[start] = 1
    let minX = cols, minY = rows, maxX = 0, maxY = 0, size = 0
    while (stack.length) {
      const idx = stack.pop()!
      const cy = (idx / cols) | 0
      const cx = idx - cy * cols
      size++
      if (cx < minX) minX = cx
      if (cx > maxX) maxX = cx
      if (cy < minY) minY = cy
      if (cy > maxY) maxY = cy
      for (const n of [idx - 1, idx + 1, idx - cols, idx + cols]) {
        if (n < 0 || n >= cols * rows || seen[n] || !dil[n]) continue
        // no wrap across row edges
        if ((n === idx - 1 && cx === 0) || (n === idx + 1 && cx === cols - 1)) continue
        seen[n] = 1
        stack.push(n)
      }
    }
    if (!best || size > best.size) best = { minX, minY, maxX, maxY, size }
  }
  if (!best || best.size < 12) return null

  // grid → pixels with padding
  const pad = Math.round(Math.max(4, Math.min(W, H) * 0.015))
  return {
    minX: Math.max(0, best.minX * cell - pad),
    minY: Math.max(0, best.minY * cell - pad),
    maxX: Math.min(W - 1, (best.maxX + 1) * cell + pad),
    maxY: Math.min(H - 1, (best.maxY + 1) * cell + pad),
    size: best.size,
  }
}

/** tidy file name: extension off, separators spaced, clamped */
function nameFromFile(file: File): string {
  const base = file.name.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').trim()
  return (base || 'My fish').slice(0, 28)
}

/**
 * Photo/scan of a coloured template → texture sheet (JPEG data URL).
 *
 * The fish crop is letterboxed onto a CONTRACT_W × CONTRACT_H canvas
 * (the official template's aspect) which is drawn centred on the
 * square sheet — exactly where SHEET_CONTRACT's UV window expects the
 * fish to be, whatever the photo's own aspect was.
 * Throws with a friendly message when nothing fish-like was found.
 */
export async function processFishImage(file: File): Promise<ProcessedFish> {
  const src = await decodeImage(file)
  const { ctx, W, H } = toWorkCanvas(src)
  if ('close' in src && typeof src.close === 'function') src.close()

  const bbox = findFishBBox(ctx, W, H)
  const bw = bbox ? bbox.maxX - bbox.minX : W
  const bh = bbox ? bbox.maxY - bbox.minY : H
  // degenerate detection → fall back to the whole picture (close-up scans)
  const use = !bbox || bw * bh < W * H * 0.04 ? { minX: 0, minY: 0, maxX: W - 1, maxY: H - 1 } : bbox

  const cw = use.maxX - use.minX
  const ch = use.maxY - use.minY

  // 1) letterbox the fish crop onto the template-aspect contract canvas
  const inter = document.createElement('canvas')
  inter.width = CONTRACT_W
  inter.height = CONTRACT_H
  const ictx = inter.getContext('2d')!
  ictx.fillStyle = '#ffffff'
  ictx.fillRect(0, 0, CONTRACT_W, CONTRACT_H)
  const fitC = Math.min(CONTRACT_W / cw, CONTRACT_H / ch)
  const dw = cw * fitC
  const dh = ch * fitC
  try { ictx.filter = 'saturate(1.16) contrast(1.07) brightness(1.02)' } catch { /* old browsers */ }
  ictx.imageSmoothingQuality = 'high'
  ictx.drawImage(ctx.canvas, use.minX, use.minY, cw, ch, (CONTRACT_W - dw) / 2, (CONTRACT_H - dh) / 2, dw, dh)
  try { ictx.filter = 'none' } catch { /* noop */ }

  // 2) the contract canvas lands centred on the sheet — margin 6% each side
  const sheet = document.createElement('canvas')
  sheet.width = SHEET
  sheet.height = SHEET
  const sctx = sheet.getContext('2d')!
  sctx.fillStyle = '#ffffff'
  sctx.fillRect(0, 0, SHEET, SHEET)
  sctx.imageSmoothingQuality = 'high'
  sctx.drawImage(inter, (SHEET - CONTRACT_W) / 2, (SHEET - CONTRACT_H) / 2, CONTRACT_W, CONTRACT_H)
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
