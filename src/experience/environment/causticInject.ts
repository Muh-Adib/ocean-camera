// ---------------------------------------------------------------
// CausticInject — Stage 6 of the detailing schedule.
// Projects the animated water-caustic pattern ONTO reef surfaces
// (walls, arches, corals, sponges) instead of only the sand sheet.
// The pattern is sampled in WORLD space so it stays anchored to
// the geometry from every viewing angle — the 360° colosseum wall
// shimmers no matter which way the visitor faces.
//
// Implementation: multiplies `diffuseColor` by (1 + caustic), so
// bright crests dance while crevices stay dark — reads as real
// focused light, not a screen-space overlay. Cheap 3-tap caustic
// (vs 4 on the seabed sheet) + distance fade to protect fill rate.
// ---------------------------------------------------------------
import * as THREE from 'three'
import { sharedUniforms } from '../core/sharedUniforms'

export interface CausticOpts {
  /** world-space tiling — larger = finer pattern (default 0.42) */
  scale?: number
  /** max brightening gain (default 0.5) */
  strength?: number
  /** rgb tint of the light (default pale cyan) */
  tint?: [number, number, number]
  /** distance where the effect starts fading (default 78) */
  fadeStart?: number
  /** distance where the effect is gone (default 118) */
  fadeEnd?: number
  /** how much SIDE faces catch the dance — 0.4 subtle, 0.6 lively */
  sideBias?: number
  /** diffuse multiply before the caustic — <1 deepens pale vertex paint (default 1) */
  deepen?: number
  /** saturation multiplier toward the channel hue (default 1) */
  saturate?: number
}

export function injectCaustic(shader: THREE.WebGLProgramParametersWithUniforms, o: CausticOpts = {}) {
  const scale = o.scale ?? 0.42
  const strength = o.strength ?? 0.5
  const tint = o.tint ?? [0.66, 0.93, 1.0]
  shader.uniforms.uCauScale = { value: scale }
  shader.uniforms.uCauStrength = { value: strength }
  shader.uniforms.uCauTint = { value: new THREE.Vector3(...tint) }
  shader.uniforms.uCauFadeA = { value: o.fadeStart ?? 78 }
  shader.uniforms.uCauFadeB = { value: o.fadeEnd ?? 118 }
  shader.uniforms.uCauSideBias = { value: o.sideBias ?? 0.42 }
  shader.uniforms.uCauDeep = { value: o.deepen ?? 1.0 }
  shader.uniforms.uCauSat = { value: o.saturate ?? 1.0 }
  shader.uniforms.uCauTime = sharedUniforms.uTime
  shader.uniforms.uCauEnergy = sharedUniforms.uEnergy

  shader.vertexShader = `
    varying vec3 vCauW;
    varying vec3 vCauN;
  ` + shader.vertexShader
  // world position + normal after ALL vertex deformation (sway included —
  // begin_vertex runs before worldpos_vertex, so swayed positions carry it)
  shader.vertexShader = shader.vertexShader.replace('#include <worldpos_vertex>', `
    #include <worldpos_vertex>
    vCauW = (modelMatrix * vec4( transformed, 1.0 )).xyz;
    vCauN = normalize( mat3( modelMatrix ) * objectNormal );
  `)

  shader.fragmentShader = `
    varying vec3 vCauW;
    varying vec3 vCauN;
    uniform float uCauScale, uCauStrength, uCauFadeA, uCauFadeB, uCauTime, uCauEnergy, uCauSideBias, uCauDeep, uCauSat;
    uniform vec3 uCauTint;
    float cauPat( vec2 p, float t ) {
      vec2 i = p;
      float c = 1.0;
      const float inten = 0.006;
      for ( int n = 0; n < 3; n++ ) {
        float tt = t * ( 1.0 - ( 3.5 / float( n + 1 ) ) );
        i = p + vec2( cos( tt - i.x ) + sin( tt + i.y ), sin( tt - i.y ) + cos( tt + i.x ) );
        c += 1.0 / length( vec2( p.x / ( sin( i.x + tt ) / inten ), p.y / ( cos( i.y + tt ) / inten ) ) );
      }
      c /= 3.0;
      c = 1.17 - pow( c, 1.4 );
      return pow( abs( c ), 5.0 );
    }
  ` + shader.fragmentShader

  shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
    #include <color_fragment>
    {
      // rich-reef grade: pastel vertex paint sinks toward saturated candy
      // colours — depth first, then the caustic light dances on top
      float seaLum = dot( diffuseColor.rgb, vec3( 0.299, 0.587, 0.114 ) );
      diffuseColor.rgb = clamp( mix( vec3( seaLum ), diffuseColor.rgb, uCauSat ), 0.0, 4.0 ) * uCauDeep;
      // tilt the domain with height so vertical walls get their own
      // pattern slice — no mirrored smearing across the floor plane
      vec2 cuv = vCauW.xz * uCauScale + vec2( vCauW.y * 0.33, -vCauW.y * 0.27 );
      float t = uCauTime * 0.5;
      // tame the focal-line spikes — unclamped the pattern multiplies
      // diffuse 5-10x at caustic hotspots and blows surfaces to white
      float ca = min( cauPat( cuv + vec2( t * 0.05, t * 0.038 ), t ) * 1.25, 1.45 );
      // up-facing faces catch the focused light the most; side walls
      // still shimmer (sideBias) so reef walls glow from all headings
      float upBias = uCauSideBias + ( 1.0 - uCauSideBias ) * clamp( vCauN.y, 0.0, 1.0 );
      float camD = distance( cameraPosition, vCauW );
      float fade = smoothstep( uCauFadeB, uCauFadeA, camD );
      diffuseColor.rgb *= 1.0 + ca * upBias * fade * uCauStrength
        * ( 0.65 + uCauEnergy * 0.55 ) * uCauTint;
    }
  `)
}

/** convenience for plain materials that only want the caustic */
export function addCaustic(mat: THREE.Material, o: CausticOpts, cacheKey: string) {
  mat.onBeforeCompile = (shader) => { injectCaustic(shader, o) }
  mat.customProgramCacheKey = () => cacheKey
}

// ---------------------------------------------------------------
// SeaLight — the reef answers the WATER, not just the sun.
// injectCaustic + a view-dependent backscatter rim: surfaces seen
// at grazing angles pick up the surrounding blue water colour
// (light scattering back out of the water column), exactly how
// real coral glows against deep water. Added to indirectDiffuse
// BEFORE opaque_fragment so fog + ACES tone mapping stay correct.
// ---------------------------------------------------------------
export interface SeaLightOpts extends CausticOpts {
  /** backscatter rim gain (default 0.18 — glow, never plastic) */
  rim?: number
  /** fresnel falloff power (default 2.8) */
  rimPower?: number
  /** rgb of the surrounding water light (default deep cyan-blue) */
  rimColor?: [number, number, number]
}

export function injectSeaLight(shader: THREE.WebGLProgramParametersWithUniforms, o: SeaLightOpts = {}) {
  injectCaustic(shader, {
    scale: o.scale, strength: o.strength, tint: o.tint,
    fadeStart: o.fadeStart, fadeEnd: o.fadeEnd, sideBias: o.sideBias,
    // rich-reef grade defaults: deepen pale paint + saturate it —
    // coral reads as vivid colony, not frosted glass
    deepen: o.deepen ?? 0.86,
    saturate: o.saturate ?? 1.24,
  })
  shader.uniforms.uRimStrength = { value: o.rim ?? 0.18 }
  shader.uniforms.uRimPower = { value: o.rimPower ?? 2.8 }
  const rc = o.rimColor ?? [0.2, 0.5, 0.78]
  shader.uniforms.uRimColor = { value: new THREE.Vector3(...rc) }

  shader.fragmentShader = `
    uniform float uRimStrength, uRimPower;
    uniform vec3 uRimColor;
  ` + shader.fragmentShader

  shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
    {
      // grazing view → more water between eye and surface → more
      // scattered sea-light returns; face-on → stays true colour
      vec3 seaV = normalize( cameraPosition - vCauW );
      float seaFres = pow( 1.0 - clamp( dot( seaV, normalize( vCauN ) ), 0.0, 1.0 ), uRimPower );
      vec3 seaRim = uRimColor * seaFres * uRimStrength * ( 0.75 + uCauEnergy * 0.5 );
      reflectedLight.indirectDiffuse += seaRim;
    }
    #include <opaque_fragment>
  `)
}

/** convenience wrapper — sea light for plain reef materials */
export function addSeaLight(mat: THREE.Material, o: SeaLightOpts, cacheKey: string) {
  mat.onBeforeCompile = (shader) => { injectSeaLight(shader, o) }
  mat.customProgramCacheKey = () => cacheKey
}
