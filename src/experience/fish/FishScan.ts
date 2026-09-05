// ---------------------------------------------------------------
// FishScan — turns a photo/scan of a coloured template into the
// texture sheet for a custom 3D fish.
//
// Pipeline: decode → downscale → estimate the paper background →
// ink mask (saturated or dark pixels) → largest connected component
// (= the painted fish, ignoring the thin frame and corner marks) →
// crop to its bounding box → fit onto a clean square sheet with a
// small margin → gentle saturation/contrast lift for projection →
// reserve the white texel the 3D eyes sample → JPEG data URL.
//
// Robust by design: pencil-only drawings, coloured backgrounds,
// slightly tilted photos and close-up scans all degrade gracefully.
// ---------------------------------------------------------------
import { reserveWhiteTexel } from './CustomFish'

export interface ProcessedFish {
  dataUrl: string
  name: string
}

const WORK_MAX = 1024        // analysis resolution cap
const SHEET = 768            // final texture sheet size
const MAX_DATAURL = 480_000  // transport cap — enforced by the tank API too

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

  // ink = saturated colour OR clearly darker than the paper
  const mask = new Uint8Array(cols * rows)
  for (let gy = 0; gy < rows; gy++) {
    for (let gxx = 0; gxx < cols; gxx++) {
      const x = Math.min(W - 1, gxx * cell + (cell >> 1))
      const y = Math.min(H - 1, gy * cell + (cell >> 1))
      const i = (y * W + x) * 4
      const r = img[i], g = img[i + 1], b = img[i + 2]
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
      const sat = mx - mn
      const lum = 0.32 * r + 0.58 * g + 0.1 * b
      const a = img[i + 3]
      if (a < 40) continue                                   // transparent
      if (sat > 34 || lum < paper - 62) mask[gy * cols + gxx] = 1
    }
  }

  // largest 4-connected component
  const seen = new Uint8Array(cols * rows)
  let best: Blob2D | null = null
  const stack: number[] = []
  for (let start = 0; start < cols * rows; start++) {
    if (!mask[start] || seen[start]) continue
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
        if (n < 0 || n >= cols * rows || seen[n] || !mask[n]) continue
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

  // fit onto a clean square sheet, 6% margin, aspect preserved
  const sheet = document.createElement('canvas')
  sheet.width = SHEET
  sheet.height = SHEET
  const sctx = sheet.getContext('2d')!
  sctx.fillStyle = '#ffffff'
  sctx.fillRect(0, 0, SHEET, SHEET)
  const margin = SHEET * 0.06
  const avail = SHEET - margin * 2
  const fit = Math.min(avail / cw, avail / ch)
  const dw = cw * fit
  const dh = ch * fit
  try { sctx.filter = 'saturate(1.16) contrast(1.07) brightness(1.02)' } catch { /* old browsers */ }
  sctx.imageSmoothingQuality = 'high'
  sctx.drawImage(ctx.canvas, use.minX, use.minY, cw, ch, (SHEET - dw) / 2, (SHEET - dh) / 2, dw, dh)
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
