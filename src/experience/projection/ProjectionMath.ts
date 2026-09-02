// ---------------------------------------------------------------
// ProjectionMath — 4-point perspective (homography) warping and
// the mesh-warp grid derived from it. Dragging a corner re-solves
// the homography; every grid node then lands exactly on the true
// perspective mapping, so the warped slice keeps a correct
// projective look (Resolume-style corner pin).
// ---------------------------------------------------------------
import type { Vec2, WarpCorners } from './ProjectionTypes'

export type Mat3 = number[] // row-major [h11 h12 h13; h21 h22 h23; h31 h32 1]

/** Gaussian elimination with partial pivoting for an n×n system */
function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = b.length
  const M = A.map((row, i) => [...row, b[i]])
  for (let col = 0; col < n; col++) {
    // pivot
    let piv = col
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r
    }
    if (Math.abs(M[piv][col]) < 1e-12) return null
    if (piv !== col) { const t = M[piv]; M[piv] = M[col]; M[col] = t }
    // eliminate below
    for (let r = col + 1; r < n; r++) {
      const f = M[r][col] / M[col][col]
      if (f === 0) continue
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c]
    }
  }
  // back-substitute
  const x = new Array<number>(n).fill(0)
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n]
    for (let c = r + 1; c < n; c++) s -= M[r][c] * x[c]
    x[r] = s / M[r][r]
  }
  return x
}

/**
 * Homography mapping the unit square
 *   (0,0)=TL  (1,0)=TR  (1,1)=BR  (0,1)=BL
 * onto the given output quad (y-down output pixels).
 */
export function homographyFromQuad(quad: WarpCorners): Mat3 {
  const src: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]]
  const dst: Vec2[] = [quad.tl, quad.tr, quad.br, quad.bl]
  const A: number[][] = []
  const b: number[] = []
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i]
    const dx = dst[i].x, dy = dst[i].y
    A.push([x, y, 1, 0, 0, 0, -dx * x, -dx * y]); b.push(dx)
    A.push([0, 0, 0, x, y, 1, -dy * x, -dy * y]); b.push(dy)
  }
  const h = solveLinear(A, b)
  if (!h) {
    // degenerate quad — fall back to an affine-ish identity over the bbox
    return [1, 0, quad.tl.x, 0, 1, quad.tl.y, 0, 0, 1]
  }
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1]
}

export function applyHomography(m: Mat3, x: number, y: number): Vec2 {
  const w = m[6] * x + m[7] * y + m[8]
  return {
    x: (m[0] * x + m[1] * y + m[2]) / w,
    y: (m[3] * x + m[4] * y + m[5]) / w,
  }
}

export function gridIndex(res: number, i: number, j: number): number {
  return j * (res + 1) + i
}

/** Rebuild the whole mesh grid so it follows the 4 corners projectively */
export function gridFromCorners(corners: WarpCorners, res: number): Vec2[] {
  const H = homographyFromQuad(corners)
  const pts: Vec2[] = []
  for (let j = 0; j <= res; j++) {
    for (let i = 0; i <= res; i++) {
      pts.push(applyHomography(H, i / res, j / res))
    }
  }
  return pts
}

/** Re-derive the 4 corners from a (possibly hand-edited) grid */
export function cornersFromGrid(grid: Vec2[], res: number): WarpCorners {
  return {
    tl: { ...grid[gridIndex(res, 0, 0)] },
    tr: { ...grid[gridIndex(res, res, 0)] },
    br: { ...grid[gridIndex(res, res, res)] },
    bl: { ...grid[gridIndex(res, 0, res)] },
  }
}

/** Shift every grid point + corners by a delta (whole-surface drag) */
export function translateGrid(grid: Vec2[], dx: number, dy: number): void {
  for (const p of grid) { p.x += dx; p.y += dy }
}

export function quadCentroid(q: WarpCorners): Vec2 {
  return {
    x: (q.tl.x + q.tr.x + q.br.x + q.bl.x) / 4,
    y: (q.tl.y + q.tr.y + q.br.y + q.bl.y) / 4,
  }
}

/** point-in-quad (ray casting over the 4-corner hull) */
export function pointInQuad(p: Vec2, q: WarpCorners): boolean {
  const poly = [q.tl, q.tr, q.br, q.bl]
  let inside = false
  for (let i = 0, j = 3; i < 4; j = i++) {
    const xi = poly[i].x, yi = poly[i].y
    const xj = poly[j].x, yj = poly[j].y
    const intersect = ((yi > p.y) !== (yj > p.y)) &&
      (p.x < ((xj - xi) * (p.y - yi)) / (yj - yi + 1e-9) + xi)
    if (intersect) inside = !inside
  }
  return inside
}
