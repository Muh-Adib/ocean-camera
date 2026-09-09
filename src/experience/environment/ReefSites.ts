// ---------------------------------------------------------------
// ReefSites — footprint of the limestone reef towers (matches
// LimestoneReef.ts) so Rocks / Seaweed / ReefDecor / CoralSystem
// placements keep clear and nothing pokes through the karst.
// ---------------------------------------------------------------
export interface ReefSite { x: number; z: number; R: number }

export const REEF_SITES: ReefSite[] = [
  { x: 14.5, z: -26, R: 3.4 },
  { x: 11.2, z: -23.4, R: 2.3 },
  { x: 18.0, z: -23.0, R: 2.0 },
  { x: 15.8, z: -30.2, R: 1.9 },
  { x: -3.5, z: -33, R: 2.1 },
  { x: 25.5, z: -32.5, R: 1.6 },
  { x: 4.0, z: -38.5, R: 1.7 },
]

/** true when (x,z) sits inside a reef tower footprint (+margin) */
export function insideReefFootprint(x: number, z: number, margin = 1.1): boolean {
  for (const s of REEF_SITES) {
    const dx = x - s.x, dz = z - s.z
    const rr = s.R * margin
    if (dx * dx + dz * dz < rr * rr) return true
  }
  return false
}
