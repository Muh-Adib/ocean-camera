// ---------------------------------------------------------------
// DepthSilhouette — camera-relative "depth of field" blue tint.
// Injects a fragment stage that fades distant geometry toward a
// deep blue silhouette — the reference-art look where the far
// rim of the reef melts into dark blue shapes instead of bright
// fog. Runs AFTER the fog chunk, so it wins over lagoon haze.
// ---------------------------------------------------------------
import * as THREE from 'three'

export interface SilhouetteOpts {
  /** view distance where darkening begins (m) */
  start: number
  /** view distance where the silhouette is complete (m) */
  end: number
  /** final blend strength 0..1 */
  k?: number
  /** silhouette colour (deep lagoon blue by default) */
  color?: THREE.ColorRepresentation
}

/** low-level injection — composable with other onBeforeCompile edits */
export function injectSilhouette(shader: THREE.WebGLProgramParametersWithUniforms, o: SilhouetteOpts) {
  shader.uniforms.uSilColor = { value: new THREE.Color(o.color ?? '#0b3350') }
  shader.uniforms.uSilStart = { value: o.start }
  shader.uniforms.uSilEnd = { value: o.end }
  shader.uniforms.uSilK = { value: o.k ?? 0.88 }

  shader.vertexShader = `varying float vSilZ;\n` + shader.vertexShader
  shader.vertexShader = shader.vertexShader.replace(
    '#include <fog_vertex>',
    /* glsl */`
      #include <fog_vertex>
      vSilZ = -mvPosition.z;
    `,
  )
  shader.fragmentShader = `varying float vSilZ;
    uniform vec3 uSilColor;
    uniform float uSilStart, uSilEnd, uSilK;\n` + shader.fragmentShader
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <fog_fragment>',
    /* glsl */`
      #include <fog_fragment>
      {
        float silF = smoothstep(uSilStart, uSilEnd, vSilZ) * uSilK;
        gl_FragColor.rgb = mix(gl_FragColor.rgb, uSilColor, silF);
      }
    `,
  )
}

/** standalone helper for plain materials (seabed, rocks, …) */
export function addDepthSilhouette(mat: THREE.Material, o: SilhouetteOpts, cacheKey: string) {
  mat.onBeforeCompile = (shader) => { injectSilhouette(shader, o) }
  mat.customProgramCacheKey = () => cacheKey
}
