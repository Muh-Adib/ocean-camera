// ---------------------------------------------------------------
// FishScan — turns a photo/scan of a coloured template into the
// texture sheet for a custom 3D fish.
//
// Pipeline: decode → downscale → estimate the paper background →
// per-pixel ink mask (saturated or darker-than-paper) → detect &
// erase the printed SHEET FRAME → largest connected component (= the
// painted fish, dilated 2px so pale crayon gaps don't shatter it) →
// TIGHT crop at the fish's own bounding box → everything OUTSIDE the
// fish silhouette is erased (the background can never tint the 3D
// fish) → the fish-only crop is STRETCHED to fill the whole UV
// window (no letterbox bands — the painting covers the model edge to
// edge at full size) → gentle saturation/contrast lift → JPEG.
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
  mask: Uint8Array<ArrayBufferLike>          // per-pixel, W*H, 1 = fish
  x0: number; y0: number; x1: number; y1: number   // tight bbox
  area: number
}

/**
 * Per-pixel fish mask: ink (saturated colour or clearly darker than the
 * paper) → printed sheet FRAME detection & erasure → 1px dilation →
 * largest 4-connected component → 2px dilation (pale strokes join) →
 * tight bounding box. Returns null when nothing fish-sized was found.
 */
function fineFishMask(ctx: CanvasRenderingContext2D, W: number, H: number): FishMask | null {
  const img = ctx.getImageData(0, 0, W, H).data

  // paper estimate: median border luminance
  const borderLums: number[] = []
  const lumAt = (x: number, y: number) => {
    const i = (y * W + x) * 4
    return 0.32 * img[i] + 0.58 * img[i + 1] + 0.1 * img[i + 2]
  }
  for (let x = 0; x < W; x += Math.max(1, W >> 6)) borderLums.push(lumAt(x, 1), lumAt(x, H - 2))
  for (let y = 0; y < H; y += Math.max(1, H >> 6)) borderLums.push(lumAt(1, y), lumAt(W - 2, y))
  borderLums.sort((a, b) => a - b)
  const paper = borderLums[Math.floor(borderLums.length / 2)] ?? 255

  let mask: Uint8Array<ArrayBufferLike> = new Uint8Array(W * H)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      const a = img[i + 3]
      if (a < 40) continue
      const r = img[i], g = img[i + 1], b = img[i + 2]
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
      const lum = 0.32 * r + 0.58 * g + 0.1 * b
      if (mx - mn > 34 || lum < paper - 62) mask[y * W + x] = 1
    }
  }

  // ---- dilate 1px (8-neighbourhood) so anti-aliased strokes are solid ----
  // (the old printed-frame erase ran here; the border-touch rejection below
  // supersedes it — a printed frame never touches the photo's border either)
  const dil = (src: Uint8Array<ArrayBufferLike>, it: number): Uint8Array<ArrayBufferLike> => {
    let cur = src
    for (let p = 0; p < it; p++) {
      const out = new Uint8Array(W * H)
      for (let y = 0; y < H; y++) {
        const y0 = y > 0 ? y - 1 : 0, y1 = y < H - 1 ? y + 1 : H - 1
        for (let x = 0; x < W; x++) {
          if (!cur[y * W + x]) continue
          const x0 = x > 0 ? x - 1 : 0, x1 = x < W - 1 ? x + 1 : W - 1
          for (let yy = y0; yy <= y1; yy++) {
            const row = yy * W
            for (let xx = x0; xx <= x1; xx++) out[row + xx] = 1
          }
        }
      }
      cur = out
    }
    return cur
  }
  mask = dil(mask, 1)

  // ---- largest 4-connected component that does NOT touch the image border ----
  // (a photo's background always reaches the border; the painted fish on its
  // sheet never does — white paper margins surround it)
  const seen = new Uint8Array(W * H)
  const labels = new Int32Array(W * H)
  const sizes: number[] = []
  const touches: boolean[] = []
  let cur = 0
  const stack: number[] = []
  for (let s = 0; s < W * H; s++) {
    if (!mask[s] || seen[s]) continue
    cur++
    stack.length = 0
    stack.push(s)
    seen[s] = 1
    labels[s] = cur
    let size = 0
    let border = false
    while (stack.length) {
      const idx = stack.pop()!
      size++
      const y = (idx / W) | 0
      const x = idx - y * W
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) border = true
      if (x > 0 && !seen[idx - 1] && mask[idx - 1]) { seen[idx - 1] = 1; labels[idx - 1] = cur; stack.push(idx - 1) }
      if (x < W - 1 && !seen[idx + 1] && mask[idx + 1]) { seen[idx + 1] = 1; labels[idx + 1] = cur; stack.push(idx + 1) }
      if (y > 0 && !seen[idx - W] && mask[idx - W]) { seen[idx - W] = 1; labels[idx - W] = cur; stack.push(idx - W) }
      if (y < H - 1 && !seen[idx + W] && mask[idx + W]) { seen[idx + W] = 1; labels[idx + W] = cur; stack.push(idx + W) }
    }
    sizes[cur] = size
    touches[cur] = border
  }
  let bestId = 0
  let best = 0
  for (let id = 1; id <= cur; id++) {
    if (touches[id] || sizes[id] < W * H * 0.008) continue
    if (sizes[id] > best) { best = sizes[id]; bestId = id }
  }
  if (!bestId) {
    // everything touches the border (extreme close-up) — take the largest overall
    for (let id = 1; id <= cur; id++) {
      if (sizes[id] > best) { best = sizes[id]; bestId = id }
    }
  }
  if (!bestId || best < W * H * 0.008) return null

  let fish: Uint8Array<ArrayBufferLike> = new Uint8Array(W * H)
  let x0 = W, y0 = H, x1 = 0, y1 = 0
  for (let i = 0; i < W * H; i++) {
    if (labels[i] === bestId) {
      fish[i] = 1
      const y = (i / W) | 0
      const x = i - y * W
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  // 2px dilation of the component only (keep pale colour just outside the strokes)
  fish = dil(fish, 2)
  // re-tighten the bbox after dilation, clamped
  x0 = Math.max(0, x0 - 2); y0 = Math.max(0, y0 - 2)
  x1 = Math.min(W - 1, x1 + 2); y1 = Math.min(H - 1, y1 + 2)
  return { mask: fish, x0, y0, x1, y1, area: best }
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
 * is erased, and the fish-only image is stretched to fill the entire
 * UV window — so however much background the photo had, the drawing
 * covers the 3D fish fully, at full size.
 */
export async function processFishImage(file: File): Promise<ProcessedFish> {
  const src = await decodeImage(file)
  const { ctx, W, H } = toWorkCanvas(src)
  if ('close' in src && typeof src.close === 'function') src.close()

  const found = fineFishMask(ctx, W, H)

  // fish-only crop (background erased) — or the whole picture as fallback
  let crop: HTMLCanvasElement
  if (found) {
    const cw = found.x1 - found.x0 + 1
    const ch = found.y1 - found.y0 + 1
    crop = document.createElement('canvas')
    crop.width = cw
    crop.height = ch
    const cctx = crop.getContext('2d')!
    cctx.drawImage(ctx.canvas, found.x0, found.y0, cw, ch, 0, 0, cw, ch)
    // erase everything outside the fish silhouette
    const mcv = document.createElement('canvas')
    mcv.width = cw
    mcv.height = ch
    const mctx = mcv.getContext('2d')!
    const md = mctx.createImageData(cw, ch)
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        const on = found.mask[(found.y0 + y) * W + (found.x0 + x)]
        const i = (y * cw + x) * 4
        md.data[i] = 255; md.data[i + 1] = 255; md.data[i + 2] = 255
        md.data[i + 3] = on ? 255 : 0
      }
    }
    mctx.putImageData(md, 0, 0)
    cctx.globalCompositeOperation = 'destination-in'
    cctx.drawImage(mcv, 0, 0)
    cctx.globalCompositeOperation = 'source-over'
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
