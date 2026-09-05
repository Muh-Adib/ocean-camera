// ---------------------------------------------------------------
// FishTemplate — THE colouring sheet (the user's own artwork) and
// the texture layout contract.
//
// The official template is the PNG the user supplied — it lives at
// /fish/template-ikan.png (public/fish) and is served as-is:
// what you download is EXACTLY the sheet that was drawn, never a
// regenerated approximation. Print it, colour it, photograph it.
//
// FishScan cuts the painted fish out of the photo, letterboxes it
// onto the sheet at THE TEMPLATE'S OWN ASPECT, and the 3D fish
// (CustomFish) samples the sheet by the contract below. Every part
// of the 3D fish samples the region where that part is DRAWN:
//
//   sheet layout (UV space, v = up, nose LEFT, tail RIGHT):
//
//     ┌────────────────────────────────────────────────┐
//     │        ╭── dorsal fin (wavy) ──╮               │
//     │  ╭─────┤                       ├──╮──╮         │
//     │  │ eye │         BODY          │  ╰──╮ TAIL    │
//     │  │gill ╰─ pectoral ╮   ╭ anal ──╯  ╱  fork    │
//     │   ╰─ pelvic ╰─────╯───╯           ╱            │
//     └────────────────────────────────────────────────┘
//
// The body wraps the painting around the hull meridian-by-meridian
// (each flank shows the full side view), while each fin samples its
// own rectangle — so a stroke of red on the drawn tail really lands
// on the 3D tail fin.
//
// The rects were MEASURED from the user's template (fish bbox
// 961×615 px, aspect 1.563) and the FishScan fit is deterministic:
// the fish crop is letterboxed into a 676×432 canvas (the template
// aspect) which is drawn centred on the 768² sheet → the fish bbox
// always lands at u 0.060..0.940, v 0.218..0.782. The rects below
// are that fit applied to each part's zone, measured as a fraction
// of the fish bbox:
//   body   x 0.000..0.775   v 0.15..0.80   (nose → peduncle)
//   tail   x 0.720..1.000   v 0.19..0.78   (the fork)
//   dorsal x 0.280..0.680   v 0.65..1.00   (above the back)
//   anal   x 0.499..0.707   v 0.07..0.25   (bottom rear)
//   pelvic x 0.280..0.498   v 0.00..0.25   (bottom front)
//   pectoral x 0.300..0.464 v 0.25..0.56   (behind the gill)
//   eye pupil at (0.142, 0.525) — the 3D eyeball is seated there
// ---------------------------------------------------------------

export interface SheetRect { x0: number; x1: number; y0: number; y1: number }

/** texture-space regions (v up) the 3D fish samples — the layout contract */
export const FISH_SHEET = {
  /** hull wrap: the painted body, nose (left) → tail root (right) */
  BODY: { x0: 0.06, x1: 0.742, y0: 0.303, y1: 0.669 } as SheetRect,
  /** caudal fin zone (the drawn fork tail) */
  TAIL: { x0: 0.694, x1: 0.94, y0: 0.325, y1: 0.657 } as SheetRect,
  /** top fin (the wavy crest) */
  DORSAL: { x0: 0.306, x1: 0.658, y0: 0.585, y1: 0.782 } as SheetRect,
  /** bottom rear fin */
  ANAL: { x0: 0.499, x1: 0.682, y0: 0.256, y1: 0.359 } as SheetRect,
  /** side fin behind the gill */
  PECTORAL: { x0: 0.324, x1: 0.468, y0: 0.36, y1: 0.532 } as SheetRect,
  /** bottom front fin */
  PELVIC: { x0: 0.306, x1: 0.498, y0: 0.219, y1: 0.359 } as SheetRect,
  /** reserved blank texel for eyes/fins that must stay pure white */
  WHITE_UV: 0.965,
} as const

/** the official blank sheet — exactly the PNG the user supplied */
export const TEMPLATE_URL = '/fish/template-ikan.png'

/** download the official colouring template (the user's own PNG) */
export async function downloadFishTemplate(): Promise<boolean> {
  try {
    const res = await fetch(TEMPLATE_URL, { cache: 'no-store' })
    if (!res.ok) return false
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'template-ikan.png'
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 4000)
    return true
  } catch {
    return false
  }
}
