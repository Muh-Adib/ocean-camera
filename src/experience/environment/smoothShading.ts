// ---------------------------------------------------------------
// smoothShading — weld a displaced triangle soup by position so
// vertex normals shade SMOOTH instead of flat. The procedural
// builders displace non-indexed primitives; without welding every
// triangle keeps its own normal and the reef reads low-poly draft.
// Vertex colours are preserved: welds hash position only, and the
// colour of each weld group's first source vertex is re-attached.
// ---------------------------------------------------------------
import * as THREE from 'three'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

export function weldSmooth(geo: THREE.BufferGeometry, tolerance = 1e-4): THREE.BufferGeometry {
  const srcPos = geo.getAttribute('position') as THREE.BufferAttribute
  const srcCol = geo.getAttribute('color') as THREE.BufferAttribute | null

  const bare = new THREE.BufferGeometry()
  bare.setAttribute('position', srcPos)
  const welded = mergeVertices(bare, tolerance)
  welded.computeVertexNormals()

  if (srcCol) {
    // same rounding mergeVertices used (decimalShift = log10(1/tolerance))
    const mult = Math.round(Math.pow(10, Math.log10(1 / tolerance)))
    const keyOf = (x: number, y: number, z: number) =>
      `${Math.round(x * mult)},${Math.round(y * mult)},${Math.round(z * mult)}`
    const colorMap = new Map<string, [number, number, number]>()
    for (let i = 0; i < srcPos.count; i++) {
      const k = keyOf(srcPos.getX(i), srcPos.getY(i), srcPos.getZ(i))
      if (!colorMap.has(k)) colorMap.set(k, [srcCol.getX(i), srcCol.getY(i), srcCol.getZ(i)])
    }
    const wPos = welded.getAttribute('position') as THREE.BufferAttribute
    const out = new Float32Array(wPos.count * 3)
    for (let i = 0; i < wPos.count; i++) {
      const c = colorMap.get(keyOf(wPos.getX(i), wPos.getY(i), wPos.getZ(i))) ?? [1, 1, 1]
      out[i * 3] = c[0]; out[i * 3 + 1] = c[1]; out[i * 3 + 2] = c[2]
    }
    welded.setAttribute('color', new THREE.BufferAttribute(out, 3))
  }
  return welded
}
