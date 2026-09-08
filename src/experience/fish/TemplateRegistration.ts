// ---------------------------------------------------------------
// TemplateRegistration — detects the official colouring template's
// outer rectangular frame and 4 corner fiducial markers on a photo/scan,
// computes a perspective homography matrix, and unwarps/crops ONLY the fish
// using the exact canonical silhouette mask.
// ---------------------------------------------------------------

import { TEMPLATE_CANONICAL } from './FishSilhouetteMask'

export interface Point2D {
  x: number
  y: number
}

export interface DetectedTemplate {
  corners: {
    tl: Point2D
    tr: Point2D
    br: Point2D
    bl: Point2D
  }
  confidence: number
}

/**
 * Computes a 3×3 perspective homography matrix mapping points from `src` to `dst`.
 * Both arrays must have 4 points: [TL, TR, BR, BL].
 * Solves Ah = b via Gaussian elimination with partial pivoting.
 */
export function getHomographyMatrix(src: Point2D[], dst: Point2D[]): number[] {
  const A: number[][] = []
  const b: number[] = []

  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i]
    const { x: X, y: Y } = dst[i]
    A.push([x, y, 1, 0, 0, 0, -X * x, -X * y])
    b.push(X)
    A.push([0, 0, 0, x, y, 1, -Y * x, -Y * y])
    b.push(Y)
  }

  const n = 8
  const M: number[][] = []
  for (let i = 0; i < n; i++) {
    M.push([...A[i], b[i]])
  }

  for (let i = 0; i < n; i++) {
    let maxRow = i
    for (let r = i + 1; r < n; r++) {
      if (Math.abs(M[r][i]) > Math.abs(M[maxRow][i])) maxRow = r
    }
    const temp = M[i]
    M[i] = M[maxRow]
    M[maxRow] = temp

    const pivot = M[i][i]
    if (Math.abs(pivot) < 1e-10) continue

    for (let j = i; j <= n; j++) M[i][j] /= pivot
    for (let r = 0; r < n; r++) {
      if (r === i) continue
      const factor = M[r][i]
      for (let j = i; j <= n; j++) M[r][j] -= factor * M[i][j]
    }
  }

  const h: number[] = []
  for (let i = 0; i < n; i++) h.push(M[i][n])
  h.push(1.0)
  return h
}

/**
 * Robustly detects the outer rectangular frame of the template on the work canvas.
 * Scans inward from the 4 outer margins to find the dark printed frame lines,
 * fits linear regression lines to each side, and computes their 4 intersections.
 */
export function detectTemplateFrame(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
): DetectedTemplate | null {
  const img = ctx.getImageData(0, 0, W, H).data
  const bpp = 4

  const lumAt = (x: number, y: number) => {
    const idx = (y * W + x) * bpp
    return 0.32 * img[idx] + 0.58 * img[idx + 1] + 0.1 * img[idx + 2]
  }

  // 1. Estimate paper brightness at margins
  let paperSum = 0
  let paperCount = 0
  for (let x = 8; x < W - 8; x += 32) {
    paperSum += lumAt(x, 8) + lumAt(x, H - 8)
    paperCount += 2
  }
  for (let y = 8; y < H - 8; y += 32) {
    paperSum += lumAt(8, y) + lumAt(W - 8, y)
    paperCount += 2
  }
  const paperLum = paperCount ? paperSum / paperCount : 240
  const lineThreshold = Math.min(130, paperLum - 40)

  // 2. Scan inward along rays to locate dark frame points
  const topPts: Point2D[] = []
  for (let x = Math.round(W * 0.12); x <= Math.round(W * 0.88); x += 16) {
    let bestY = -1
    let minL = 255
    const limitY = Math.round(H * 0.25)
    for (let y = 4; y <= limitY; y++) {
      const l = lumAt(x, y)
      if (l < minL) {
        minL = l
        bestY = y
      }
    }
    if (minL <= lineThreshold) topPts.push({ x, y: bestY })
  }

  const botPts: Point2D[] = []
  for (let x = Math.round(W * 0.12); x <= Math.round(W * 0.88); x += 16) {
    let bestY = -1
    let minL = 255
    const startY = Math.round(H * 0.75)
    for (let y = H - 5; y >= startY; y--) {
      const l = lumAt(x, y)
      if (l < minL) {
        minL = l
        bestY = y
      }
    }
    if (minL <= lineThreshold) botPts.push({ x, y: bestY })
  }

  const leftPts: Point2D[] = []
  for (let y = Math.round(H * 0.12); y <= Math.round(H * 0.88); y += 16) {
    let bestX = -1
    let minL = 255
    const limitX = Math.round(W * 0.25)
    for (let x = 4; x <= limitX; x++) {
      const l = lumAt(x, y)
      if (l < minL) {
        minL = l
        bestX = x
      }
    }
    if (minL <= lineThreshold) leftPts.push({ x: bestX, y })
  }

  const rightPts: Point2D[] = []
  for (let y = Math.round(H * 0.12); y <= Math.round(H * 0.88); y += 16) {
    let bestX = -1
    let minL = 255
    const startX = Math.round(W * 0.75)
    for (let x = W - 5; x >= startX; x--) {
      const l = lumAt(x, y)
      if (l < minL) {
        minL = l
        bestX = x
      }
    }
    if (minL <= lineThreshold) rightPts.push({ x: bestX, y })
  }

  // Must detect frame points on all 4 sides
  const minRequired = 8
  if (
    topPts.length < minRequired ||
    botPts.length < minRequired ||
    leftPts.length < minRequired ||
    rightPts.length < minRequired
  ) {
    return null
  }

  // 3. Outlier rejection via median filtering
  const medianY = (pts: Point2D[]) => {
    const sorted = [...pts].map((p) => p.y).sort((a, b) => a - b)
    return sorted[Math.floor(sorted.length / 2)]
  }
  const medianX = (pts: Point2D[]) => {
    const sorted = [...pts].map((p) => p.x).sort((a, b) => a - b)
    return sorted[Math.floor(sorted.length / 2)]
  }

  const medTopY = medianY(topPts)
  const medBotY = medianY(botPts)
  const medLeftX = medianX(leftPts)
  const medRightX = medianX(rightPts)

  const tol = Math.max(12, Math.round(Math.min(W, H) * 0.04))
  const cleanTop = topPts.filter((p) => Math.abs(p.y - medTopY) <= tol)
  const cleanBot = botPts.filter((p) => Math.abs(p.y - medBotY) <= tol)
  const cleanLeft = leftPts.filter((p) => Math.abs(p.x - medLeftX) <= tol)
  const cleanRight = rightPts.filter((p) => Math.abs(p.x - medRightX) <= tol)

  if (
    cleanTop.length < minRequired ||
    cleanBot.length < minRequired ||
    cleanLeft.length < minRequired ||
    cleanRight.length < minRequired
  ) {
    return null
  }

  // 4. Fit lines:
  // Horizontal sides: y = m*x + c
  const fitHoriz = (pts: Point2D[]) => {
    let sumX = 0, sumY = 0, sumXX = 0, sumXY = 0
    const n = pts.length
    for (const p of pts) {
      sumX += p.x
      sumY += p.y
      sumXX += p.x * p.x
      sumXY += p.x * p.y
    }
    const denom = n * sumXX - sumX * sumX
    if (Math.abs(denom) < 1e-6) return { m: 0, c: sumY / n }
    const m = (n * sumXY - sumX * sumY) / denom
    const c = (sumY - m * sumX) / n
    return { m, c }
  }

  // Vertical sides: x = m*y + c
  const fitVert = (pts: Point2D[]) => {
    let sumX = 0, sumY = 0, sumYY = 0, sumXY = 0
    const n = pts.length
    for (const p of pts) {
      sumX += p.x
      sumY += p.y
      sumYY += p.y * p.y
      sumXY += p.x * p.y
    }
    const denom = n * sumYY - sumY * sumY
    if (Math.abs(denom) < 1e-6) return { m: 0, c: sumX / n }
    const m = (n * sumXY - sumY * sumX) / denom
    const c = (sumX - m * sumY) / n
    return { m, c }
  }

  const lineTop = fitHoriz(cleanTop)
  const lineBot = fitHoriz(cleanBot)
  const lineLeft = fitVert(cleanLeft)
  const lineRight = fitVert(cleanRight)

  // 5. Intersect lines to compute the 4 corners:
  // y = lineH.m * x + lineH.c, x = lineV.m * y + lineV.c
  const intersect = (h: { m: number; c: number }, v: { m: number; c: number }): Point2D => {
    const denom = 1 - h.m * v.m
    if (Math.abs(denom) < 1e-6) {
      return { x: v.c, y: h.c }
    }
    const y = (h.m * v.c + h.c) / denom
    const x = v.m * y + v.c
    return { x, y }
  }

  const tl = intersect(lineTop, lineLeft)
  const tr = intersect(lineTop, lineRight)
  const br = intersect(lineBot, lineRight)
  const bl = intersect(lineBot, lineLeft)

  // 6. Sanity validation: size and aspect ratio
  const avgW = (tr.x - tl.x + br.x - bl.x) / 2
  const avgH = (bl.y - tl.y + br.y - tr.y) / 2

  if (avgW < W * 0.5 || avgH < H * 0.5) return null
  const aspect = avgW / avgH
  // Canonical aspect is 1432 / 994 ≈ 1.4406; allow reasonable camera perspective
  if (aspect < 1.15 || aspect > 1.75) return null

  // 7. Verify fiducial corner box regions
  const checkCornerDensity = (corner: Point2D, dx: number, dy: number) => {
    const boxSize = Math.round(Math.min(avgW, avgH) * 0.035) // ~32px in canonical
    let dark = 0
    let total = 0
    for (let y = 0; y < boxSize; y++) {
      for (let x = 0; x < boxSize; x++) {
        const px = Math.round(corner.x + (dx > 0 ? x : -x))
        const py = Math.round(corner.y + (dy > 0 ? y : -y))
        if (px >= 0 && px < W && py >= 0 && py < H) {
          total++
          if (lumAt(px, py) <= lineThreshold + 20) dark++
        }
      }
    }
    return total > 0 ? dark / total : 0
  }

  const cTL = checkCornerDensity(tl, 1, 1)
  const cTR = checkCornerDensity(tr, -1, 1)
  const cBL = checkCornerDensity(bl, 1, -1)
  const cBR = checkCornerDensity(br, -1, -1)
  const avgCornerScore = (cTL + cTR + cBL + cBR) / 4

  const confidence = Math.min(1.0, 0.5 + avgCornerScore * 0.5)
  if (confidence < 0.55) return null

  return {
    corners: { tl, tr, br, bl },
    confidence,
  }
}

/**
 * Extracts ONLY the fish by perspective-mapping the canonical silhouette
 * into the source image, sampling pixels inside the fish, and discarding everything outside.
 * Applies BFS inpaint and Jacobi diffusion to produce a clean edge padding.
 */
export function warpAndExtractFish(
  srcCtx: CanvasRenderingContext2D,
  srcW: number,
  srcH: number,
  detected: DetectedTemplate,
  fishMask: Uint8Array,
): HTMLCanvasElement {
  const canonFrame: Point2D[] = [
    { x: TEMPLATE_CANONICAL.frame.x0, y: TEMPLATE_CANONICAL.frame.y0 },
    { x: TEMPLATE_CANONICAL.frame.x1, y: TEMPLATE_CANONICAL.frame.y0 },
    { x: TEMPLATE_CANONICAL.frame.x1, y: TEMPLATE_CANONICAL.frame.y1 },
    { x: TEMPLATE_CANONICAL.frame.x0, y: TEMPLATE_CANONICAL.frame.y1 },
  ]

  const detectedFrame: Point2D[] = [
    detected.corners.tl,
    detected.corners.tr,
    detected.corners.br,
    detected.corners.bl,
  ]

  // Homography matrix: canonical template space -> source image space
  const H = getHomographyMatrix(canonFrame, detectedFrame)

  const cw = TEMPLATE_CANONICAL.fish.width // 960
  const ch = TEMPLATE_CANONICAL.fish.height // 614

  const crop = document.createElement('canvas')
  crop.width = cw
  crop.height = ch
  const cctx = crop.getContext('2d', { willReadFrequently: true })!
  const imgData = cctx.createImageData(cw, ch)
  const d = imgData.data

  const srcImg = srcCtx.getImageData(0, 0, srcW, srcH).data
  const srcBpp = 4

  const fishX0 = TEMPLATE_CANONICAL.fish.x0 // 266
  const fishY0 = TEMPLATE_CANONICAL.fish.y0 // 220

  const known = new Uint8Array(cw * ch)
  const queue = new Int32Array(cw * ch)
  let qh = 0, qt = 0

  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const maskIdx = y * cw + x
      const isFish = fishMask[maskIdx] === 1
      if (!isFish) continue

      // Map canonical coordinate (cx, cy) to source coordinate (sx, sy)
      const cx = fishX0 + x
      const cy = fishY0 + y

      const w = H[6] * cx + H[7] * cy + H[8]
      const sx = (H[0] * cx + H[1] * cy + H[2]) / w
      const sy = (H[3] * cx + H[4] * cy + H[5]) / w

      // Bilinear interpolation from source image
      const x0 = Math.floor(sx)
      const y0 = Math.floor(sy)
      const x1 = Math.min(srcW - 1, x0 + 1)
      const y1 = Math.min(srcH - 1, y0 + 1)

      const fx = sx - x0
      const fy = sy - y0

      const cIdx = maskIdx * 4

      if (x0 >= 0 && x1 < srcW && y0 >= 0 && y1 < srcH) {
        const i00 = (y0 * srcW + x0) * srcBpp
        const i10 = (y0 * srcW + x1) * srcBpp
        const i01 = (y1 * srcW + x0) * srcBpp
        const i11 = (y1 * srcW + x1) * srcBpp

        for (let c = 0; c < 3; c++) {
          const top = srcImg[i00 + c] * (1 - fx) + srcImg[i10 + c] * fx
          const bot = srcImg[i01 + c] * (1 - fx) + srcImg[i11 + c] * fx
          d[cIdx + c] = Math.round(top * (1 - fy) + bot * fy)
        }
        d[cIdx + 3] = 255
      } else {
        d[cIdx] = 255
        d[cIdx + 1] = 255
        d[cIdx + 2] = 255
        d[cIdx + 3] = 255
      }

      // Seed for BFS inpainting (exclude near-white pockets to prevent white bleed)
      const r = d[cIdx], g = d[cIdx + 1], b = d[cIdx + 2]
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
      const lum = 0.32 * r + 0.58 * g + 0.1 * b
      if (lum <= 242 || mx - mn >= 14) {
        known[maskIdx] = 1
        queue[qt++] = maskIdx
      }
    }
  }

  // BFS Inpainting outside the silhouette: smoothly propagate fish edge colors
  if (qt > 0) {
    const seedsOnly = known.slice()
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
          d[k] = d[j]
          d[k + 1] = d[j + 1]
          d[k + 2] = d[j + 2]
          d[k + 3] = 255
          queue[qt++] = n
        }
      }
    }

    // Jacobi diffusion for smooth gradient
    let cur = new Uint8ClampedArray(d)
    let nxt = new Uint8ClampedArray(d.length)
    for (let p = 0; p < 14; p++) {
      for (let y = 0; y < ch; y++) {
        const ya = y > 0 ? y - 1 : 0, yb = y < ch - 1 ? y + 1 : ch - 1
        for (let x = 0; x < cw; x++) {
          const i = y * cw + x
          const k4 = i * 4
          if (seedsOnly[i]) {
            nxt[k4] = cur[k4]
            nxt[k4 + 1] = cur[k4 + 1]
            nxt[k4 + 2] = cur[k4 + 2]
            continue
          }
          let r = 0, g = 0, b = 0, n2 = 0
          for (let yy = ya; yy <= yb; yy++) {
            const xa = x > 0 ? x - 1 : 0, xb = x < cw - 1 ? x + 1 : cw - 1
            for (let xx = xa; xx <= xb; xx++) {
              if (xx === x && yy === y) continue
              const m4 = (yy * cw + xx) * 4
              r += cur[m4]
              g += cur[m4 + 1]
              b += cur[m4 + 2]
              n2++
            }
          }
          nxt[k4] = r / n2
          nxt[k4 + 1] = g / n2
          nxt[k4 + 2] = b / n2
        }
      }
      const t = cur
      cur = nxt
      nxt = t
    }
    d.set(cur)
  }

  cctx.putImageData(imgData, 0, 0)
  return crop
}
