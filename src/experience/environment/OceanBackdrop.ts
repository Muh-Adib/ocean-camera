// ---------------------------------------------------------------
// OceanBackdrop — photoreal far-water image backdrop.
//
// A huge inverted cylinder just inside the sky dome carries a
// realistic underwater photograph (sun shafts beaming through the
// surface, blue depth gradient, distant reef haze). It gives the
// far sea photographic depth for ONE texture fetch and ONE draw
// call — far lighter than modelling extra geometry out there, so
// the "inside the ocean" feel survives even on modest hardware.
//
// Blending keeps the photo married to the 3D world:
//   • lower half sinks toward deep water (photo floor never reads
//     as a paper-cut seam above the 3D terrain)
//   • horizon band is mixed toward the live fog colour so distant
//     geometry and the photo share one atmosphere
//   • a barely-drifting UV offset keeps the water subtly alive
// ---------------------------------------------------------------
import * as THREE from 'three'
import { sharedUniforms } from '../core/sharedUniforms'

export class OceanBackdrop {
  readonly mesh: THREE.Mesh
  private mat: THREE.ShaderMaterial
  private placeholder: THREE.DataTexture
  private tex: THREE.Texture
  private loaded = false

  constructor(scene: THREE.Scene, fogColor: THREE.Color) {
    // 1×1 fog-colour placeholder — no black flash while the photo streams in
    this.placeholder = new THREE.DataTexture(
      new Uint8Array([
        Math.round(Math.pow(fogColor.r, 1 / 2.2) * 255),
        Math.round(Math.pow(fogColor.g, 1 / 2.2) * 255),
        Math.round(Math.pow(fogColor.b, 1 / 2.2) * 255),
        255,
      ]), 1, 1,
    )
    this.placeholder.needsUpdate = true

    const tex = new THREE.TextureLoader().load('/textures/ocean-backdrop.png', () => {
      this.loaded = true
    })
    this.tex = tex
    tex.colorSpace = THREE.SRGBColorSpace
    // mirror-repeat: two copies wrap 360°, seam-free without baking a
    // tileable panorama — every heading sees continuous water
    tex.wrapS = THREE.MirroredRepeatWrapping
    tex.wrapT = THREE.ClampToEdgeWrapping
    tex.repeat.x = 2
    tex.anisotropy = 4

    this.mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uMap: { value: this.placeholder },
        uFog: { value: fogColor.clone() },
        uTint: { value: new THREE.Vector3(0.86, 0.98, 1.06) }, // nudge photo to the scene palette
        uEnergy: sharedUniforms.uEnergy,
        uTime: sharedUniforms.uTime,
      },
      vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D uMap;
        uniform vec3 uFog;
        uniform vec3 uTint;
        uniform float uTime, uEnergy;
        varying vec2 vUv;
        void main() {
          // barely-drifting UV — alive without wobble artefacts
          vec2 uv = vUv;
          uv.x += sin(uTime * 0.011) * 0.0016
                + sin(uTime * 0.0043 + 2.0) * 0.0011;
          vec3 c = texture2D(uMap, uv).rgb * uTint;
          float v = uv.y;                       // 0 = photo bottom, 1 = photo top
          // photographic depth: only the photo floor sinks hard — the
          // blue water + sun-shaft body of the image stays clearly readable
          c *= mix(0.22, 1.2, smoothstep(0.1, 0.75, v));
          // marry to the 3D water: gentle fog wash so photo and geometry
          // share one atmosphere, but the photo still READS as photo
          float fogMix = clamp(0.12 + (1.0 - v) * 0.4, 0.0, 0.58);
          c = mix(c, uFog, fogMix);
          c *= 0.88 + uEnergy * 0.2;
          gl_FragColor = vec4(c, 1.0);
          // OUTPUT/PREVIEW PARITY: grade the backdrop identically on
          // both render paths (see SceneManager dome note)
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    })

    // spans y −62..78 at 152 m — inside the 200 m dome, beyond the
    // far-reef ring (118 m), well inside the 300 m camera far plane
    const geo = new THREE.CylinderGeometry(152, 152, 140, 56, 1, true)
    this.mesh = new THREE.Mesh(geo, this.mat)
    this.mesh.position.set(0, 8, -20)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = -9       // dome (-10) first, then the photo, then the world
    scene.add(this.mesh)
  }

  /** swap in the photo once it arrives (samplers keep the placeholder until then) */
  update() {
    if (this.loaded && this.mat.uniforms.uMap.value === this.placeholder) {
      this.mat.uniforms.uMap.value = this.tex
    }
  }

  /** QA: has the photo finished streaming? */
  get ready() { return this.loaded }

  dispose() {
    this.mesh.geometry.dispose()
    this.mat.dispose()
    this.placeholder.dispose()
    this.tex.dispose()
    this.mesh.removeFromParent()
  }
}
