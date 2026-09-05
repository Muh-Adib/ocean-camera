// ---------------------------------------------------------------
// FishTemplate — THE colouring sheet (the user's own artwork).
//
// The official template is the PNG the user supplied — it lives at
// /fish/template-ikan.png (public/fish) and is served as-is:
// what you download is EXACTLY the sheet that was drawn, never a
// regenerated approximation. Print it, colour it, photograph it.
//
// FishScan cuts the painted fish out of the photo and letterboxes
// it onto the sheet at THE TEMPLATE'S OWN ASPECT (SHEET_CONTRACT
// below), so the fish bbox always lands on the same UV window.
// The 3D fish (CustomFish, built from FishSheetData's traced
// outline) samples that window with a 1:1 planar map — the drawing
// paints the model exactly where it was painted on paper.
// ---------------------------------------------------------------

/**
 * The UV window the fish crop always occupies on the square texture
 * sheet: u 0.06..0.94 (nose → tail), v 0.22..0.78 (belly → back,
 * v up). FishScan letterboxes every scan into a 676×430 canvas
 * (the template's aspect) centred on the 768² sheet → this window.
 */
export const SHEET_CONTRACT = {
  aspect: 1.5728,                 // fish bbox w/h measured from the template
  u0: 0.06, u1: 0.94,
  v0: 0.22, v1: 0.78,             // v up: v1 = back line, v0 = belly
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
