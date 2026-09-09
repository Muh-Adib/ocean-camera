// ---------------------------------------------------------------
// ReefSites — shared footprint of the limestone reef heads so other
// systems (coral clusters, seaweed, decor) can keep clear of the
// domes and nothing pokes through the karst surface.
// ---------------------------------------------------------------
export interface ReefSite {
  x: number
  z: number
  R: number
  corals: number
  detail: number
  seed: number
}

export const REEF_SITES: ReefSite[] = [
  { x: 2, z: -34, R: 5.2, corals: 24, detail: 16, seed: 4041 },   // hero — mid-frame from spawn (20·17² ≈ 5 780 faces)
  { x: -18, z: -48, R: 2.6, corals: 10, detail: 10, seed: 4042 }, // satellite NW of hero
  { x: 24, z: -20, R: 2.2, corals: 9, detail: 10, seed: 4043 },   // satellite on the garden fringe
  { x: -4, z: -56, R: 2.0, corals: 8, detail: 10, seed: 4044 },   // satellite on the way to the deep
]

/** true when (x,z) sits inside a reef head footprint (+margin) */
export function insideReefFootprint(x: number, z: number, margin = 1.12): boolean {
  for (const s of REEF_SITES) {
    const dx = x - s.x, dz = z - s.z
    const rr = s.R * margin
    if (dx * dx + dz * dz < rr * rr) return true
  }
  return false
}
