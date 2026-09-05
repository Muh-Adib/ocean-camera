// ---------------------------------------------------------------
// FishTemplate — the colouring sheet + the texture layout contract.
//
// The user prints/downloads the blank fish outline, colours it with
// anything (crayons, markers, paint), then photographs or scans it.
// FishScan cuts the painted fish out of the photo and becomes the
// texture of a 3D fish (CustomFish). Every part of the 3D fish
// samples the region of the sheet where that part is DRAWN:
//
//   sheet layout (UV space, v = up, nose LEFT, tail RIGHT):
//
//     ┌──────────────────────────────────────────────┐
//     │            ┌── dorsal fin ──┐                │
//     │   ╭────────┤  (DORSAL rect) ├──╮──╮          │
//     │   │  eye   │     BODY       │  ╰──╮ TAIL     │
//     │   │ gill ╭─┤   (wrap zone)  ╭─╮  ╱  fork     │
//     │   ╰──────╯ ╰ pectoral ╭────╯ ╰─╯           │
//     │      pelvic╱   ╰ anal ─╯                    │
//     └──────────────────────────────────────────────┘
//
// The body wraps the painting around the hull meridian-by-meridian
// (each flank shows the full side view), while each fin samples its
// own rectangle — so a paint stroke on the drawn tail really lands
// on the 3D tail fin. The template below is DRAWN from these same
// constants, so the mapping always matches the printed sheet.
// ---------------------------------------------------------------

export interface SheetRect { x0: number; x1: number; y0: number; y1: number }

/** texture-space regions (v up) the 3D fish samples — the layout contract */
export const FISH_SHEET = {
  /** hull wrap: the painted body, nose (left) → tail root (right) */
  BODY: { x0: 0.055, x1: 0.8, y0: 0.115, y1: 0.885 } as SheetRect,
  /** caudal fin zone (the drawn fork tail) */
  TAIL: { x0: 0.775, x1: 0.965, y0: 0.28, y1: 0.72 } as SheetRect,
  /** top fin */
  DORSAL: { x0: 0.3, x1: 0.615, y0: 0.7, y1: 0.965 } as SheetRect,
  /** bottom rear fin */
  ANAL: { x0: 0.475, x1: 0.635, y0: 0.045, y1: 0.2 } as SheetRect,
  /** side fin behind the gill */
  PECTORAL: { x0: 0.355, x1: 0.53, y0: 0.295, y1: 0.5 } as SheetRect,
  /** bottom front fin */
  PELVIC: { x0: 0.245, x1: 0.365, y0: 0.05, y1: 0.235 } as SheetRect,
  /** reserved blank texel for eyes/fins that must stay pure white */
  WHITE_UV: 0.965,
}

/** draw the blank colouring template (black line art on white) */
export function drawFishTemplate(ctx: CanvasRenderingContext2D, S: number) {
  const X = (u: number) => u * S
  const Y = (v: number) => (1 - v) * S   // UV v-up → canvas y-down
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, S, S)

  // sheet frame + corner registration brackets (like the printed example)
  ctx.strokeStyle = '#111111'
  ctx.lineWidth = S * 0.004
  const m = X(0.028)
  ctx.strokeRect(m, m, S - 2 * m, S - 2 * m)
  ctx.lineWidth = S * 0.006
  const b = X(0.045)
  const corner = (cx: number, cy: number, dx: number, dy: number) => {
    ctx.beginPath()
    ctx.moveTo(cx + dx * b, cy)
    ctx.lineTo(cx, cy)
    ctx.lineTo(cx, cy + dy * b)
    ctx.stroke()
  }
  corner(m, m, 1, 1)
  corner(S - m, m, -1, 1)
  corner(m, S - m, 1, -1)
  corner(S - m, S - m, -1, -1)

  ctx.lineWidth = S * 0.0055
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  // ---- body (nose left, tail root right) — spans the BODY wrap zone ----
  ctx.beginPath()
  ctx.moveTo(X(0.075), Y(0.5))
  // head top → back
  ctx.bezierCurveTo(X(0.1), Y(0.64), X(0.2), Y(0.78), X(0.4), Y(0.835))
  // back → peduncle top
  ctx.bezierCurveTo(X(0.56), Y(0.87), X(0.68), Y(0.76), X(0.775), Y(0.595))
  // peduncle pinch
  ctx.bezierCurveTo(X(0.79), Y(0.55), X(0.79), Y(0.45), X(0.775), Y(0.405))
  // peduncle bottom → belly
  ctx.bezierCurveTo(X(0.68), Y(0.24), X(0.55), Y(0.155), X(0.38), Y(0.155))
  // belly → chin
  ctx.bezierCurveTo(X(0.24), Y(0.16), X(0.14), Y(0.28), X(0.105), Y(0.4))
  // mouth → nose tip
  ctx.bezierCurveTo(X(0.09), Y(0.44), X(0.075), Y(0.47), X(0.075), Y(0.5))
  ctx.closePath()
  ctx.stroke()

  // ---- tail (fork) — spans the TAIL zone ----
  ctx.beginPath()
  ctx.moveTo(X(0.775), Y(0.595))
  ctx.bezierCurveTo(X(0.84), Y(0.63), X(0.9), Y(0.68), X(0.955), Y(0.705))
  ctx.lineTo(X(0.868), Y(0.5))
  ctx.lineTo(X(0.955), Y(0.295))
  ctx.bezierCurveTo(X(0.9), Y(0.32), X(0.84), Y(0.37), X(0.775), Y(0.405))
  ctx.stroke()
  // tail rays
  ctx.lineWidth = S * 0.0025
  for (const [x0, y0, x1, y1] of [
    [0.83, 0.45, 0.935, 0.36], [0.84, 0.5, 0.94, 0.47], [0.83, 0.55, 0.935, 0.63],
  ] as const) {
    ctx.beginPath()
    ctx.moveTo(X(x0), Y(y0))
    ctx.lineTo(X(x1), Y(y1))
    ctx.stroke()
  }
  ctx.lineWidth = S * 0.0055

  // ---- dorsal fin — inside the DORSAL zone, seated on the back ----
  ctx.beginPath()
  ctx.moveTo(X(0.31), Y(0.8))
  ctx.bezierCurveTo(X(0.34), Y(0.9), X(0.38), Y(0.95), X(0.43), Y(0.945))
  ctx.quadraticCurveTo(X(0.47), Y(0.93), X(0.49), Y(0.9))
  ctx.quadraticCurveTo(X(0.52), Y(0.93), X(0.55), Y(0.91))
  ctx.quadraticCurveTo(X(0.58), Y(0.88), X(0.615), Y(0.82))
  ctx.stroke()

  // ---- anal fin (bottom rear) ----
  ctx.beginPath()
  ctx.moveTo(X(0.49), Y(0.19))
  ctx.quadraticCurveTo(X(0.54), Y(0.11), X(0.61), Y(0.075))
  ctx.quadraticCurveTo(X(0.63), Y(0.13), X(0.62), Y(0.185))
  ctx.stroke()

  // ---- pelvic fin (bottom front) ----
  ctx.beginPath()
  ctx.moveTo(X(0.26), Y(0.21))
  ctx.quadraticCurveTo(X(0.27), Y(0.1), X(0.33), Y(0.07))
  ctx.quadraticCurveTo(X(0.365), Y(0.14), X(0.34), Y(0.2))
  ctx.stroke()

  // ---- pectoral fin (side, behind the gill) ----
  ctx.beginPath()
  ctx.moveTo(X(0.375), Y(0.46))
  ctx.quadraticCurveTo(X(0.47), Y(0.38), X(0.525), Y(0.33))
  ctx.quadraticCurveTo(X(0.49), Y(0.44), X(0.40), Y(0.535))
  ctx.stroke()

  // ---- gill plate arc ----
  ctx.beginPath()
  ctx.arc(X(0.245), Y(0.5), X(0.125), Math.PI * 0.32, -Math.PI * 0.32, true)
  ctx.stroke()

  // ---- eye ----
  ctx.beginPath()
  ctx.arc(X(0.175), Y(0.565), X(0.038), 0, Math.PI * 2)
  ctx.stroke()
  ctx.fillStyle = '#111111'
  ctx.beginPath()
  ctx.arc(X(0.175), Y(0.565), X(0.016), 0, Math.PI * 2)
  ctx.fill()

  // ---- mouth ----
  ctx.beginPath()
  ctx.moveTo(X(0.078), Y(0.475))
  ctx.quadraticCurveTo(X(0.1), Y(0.45), X(0.125), Y(0.46))
  ctx.stroke()
}

/** blank template as a PNG blob (S×S square) */
export async function fishTemplateBlob(S = 1600): Promise<Blob | null> {
  const canvas = document.createElement('canvas')
  canvas.width = S
  canvas.height = S
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  drawFishTemplate(ctx, S)
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'))
}

/** trigger a download of the blank colouring template */
export async function downloadFishTemplate() {
  const blob = await fishTemplateBlob()
  if (!blob) return false
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'ocean-fish-template.png'
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
  return true
}
