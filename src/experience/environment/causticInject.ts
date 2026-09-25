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
  /** albedo mottling amount — procedural ± variation that breaks flat surfaces (default 0) */
  detail?: number
  /** world-space frequency of the detail field (default 2.6) */
  detailScale?: number
  /** micro-bump strength — noise-gradient normal tilt, the actual “detail shading” (default 0) */
  bump?: number
}

export function injectCaustic(shader: THREE.WebGLProgramParametersWithUniforms, o: CausticOpts = {}) {
  const scale = o.scale ?? 0.42
  const strength = o.strength ?? 0.5
  const tint = o.tint ?? [0.66, 0.93, 1.0]
  const detail = o.detail ?? 0
  const bump = o.bump ?? 0
  shader.uniforms.uCauScale = { value: scale }
  shader.uniforms.uCauStrength = { value: strength }
  shader.uniforms.uCauTint = { value: new THREE.Vector3(...tint) }
  shader.uniforms.uCauFadeA = { value: o.fadeStart ?? 78 }
  shader.uniforms.uCauFadeB = { value: o.fadeEnd ?? 118 }
  shader.uniforms.uCauSideBias = { value: o.sideBias ?? 0.42 }
  shader.uniforms.uCauDeep = { value: o.deepen ?? 1.0 }
  shader.uniforms.uCauSat = { value: o.saturate ?? 1.0 }
  shader.uniforms.uCauDetail = { value: detail }
  shader.uniforms.uCauDetailScale = { value: o.detailScale ?? 2.6 }
  shader.uniforms.uCauBump = { value: bump }
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
    uniform float uCauDetail, uCauDetailScale, uCauBump;
    uniform vec3 uCauTint;
    // VIBRANCE — luminance-anchored saturation that protects colours which
    // are already vivid (they keep ~their amount) while muted khakis/pastels
    // get the full push. A flat lum-mix either clips candy or barely
    // touches mud — this curve does both jobs at once.
    vec3 reefVibrance( vec3 c, float vib ) {
      float lum = dot( c, vec3( 0.299, 0.587, 0.114 ) );
      float sat = max( c.r, max( c.g, c.b ) ) - min( c.r, min( c.g, c.b ) );
      float amt = max( vib * mix( 1.0, 0.68, clamp( sat * 1.55, 0.0, 1.0 ) ), 1.0 );
      return clamp( mix( vec3( lum ), c, amt ), 0.0, 4.0 );
    }
    // DETAIL FIELD — continuous 3D trig mottle (no plane seams like 2D
    // triplanar). Two broad octaves + one fine grain, roughly -1..1.
    float reefDetail( vec3 p ) {
      float n = sin( p.x * 1.9 + sin( p.y * 1.3 + p.z * 0.7 ) * 1.6 ) * 0.52;
      n += sin( p.y * 3.4 + sin( p.z * 2.1 + p.x * 1.2 ) * 1.9 ) * 0.30;
      n += sin( p.z * 6.3 + sin( p.x * 4.7 + p.y * 3.1 ) * 2.3 ) * 0.18;
      return n;
    }
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
      diffuseColor.rgb = reefVibrance( diffuseColor.rgb, uCauSat ) * uCauDeep;
${detail > 0 ? `      // albedo mottling — organic colour variation that kills the flat,
      // airbrushed look on large smooth vertex-painted surfaces
      diffuseColor.rgb *= 1.0 + uCauDetail * reefDetail( vCauW * uCauDetailScale );` : ''}
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

  if (bump > 0) {
    // MICRO-BUMP — finite-difference gradient of the detail field tilts the
    // world normal, so the sun, ambient AND caustics all shade the relief.
    // Gradient is soft-capped so noise spikes never fold the normal.
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `
      #include <normal_fragment_maps>
      {
        vec3 wn = normalize( vCauN );
        float de = 0.14;
        vec3 sp = vCauW * uCauDetailScale;
        float n0 = reefDetail( sp );
        vec3 g = vec3(
          reefDetail( sp + vec3( de, 0.0, 0.0 ) ) - n0,
          reefDetail( sp + vec3( 0.0, de, 0.0 ) ) - n0,
          reefDetail( sp + vec3( 0.0, 0.0, de ) ) - n0
        ) / de;
        g -= wn * dot( wn, g );
        float glen = length( g );
        g *= uCauBump / ( 1.0 + glen * 0.45 ) / max( glen, 1e-4 );
        vec3 wnp = normalize( wn - g );
        vec3 nvv = normalize( ( viewMatrix * vec4( wnp, 0.0 ) ).xyz );
        // respect double-sided backface flip (fins, leaves, discs)
        float facing = dot( normal, nvv ) < 0.0 ? -1.0 : 1.0;
        normal = normalize( nvv * facing );
      }
    `)
  }
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
    // rich-reef grade defaults: deepen pale paint + vibrance-lift it —
    // coral reads as vivid colony, not frosted glass
    deepen: o.deepen ?? 0.84,
    saturate: o.saturate ?? 1.42,
    detail: o.detail ?? 0.13,
    bump: o.bump ?? 0.34,
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
