// ---------------------------------------------------------------
// BlendManager — the composite shader material for output slices.
// Samples the surface's render target (the shared world seen from
// its virtual camera), applies brightness/gamma/feather/opacity,
// and can swap in a calibration pattern. Tone mapping + sRGB are
// applied by the renderer on the FINAL screen pass only, so every
// surface grades identically no matter how many are composited.
// ---------------------------------------------------------------
import * as THREE from 'three'
import type { ProjectionSurface } from './ProjectionTypes'

const VERT = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`

const FRAG = /* glsl */`
uniform sampler2D uMap;
uniform sampler2D uCalib;
uniform float uCalibMix;      // 0 = ocean scene, 1 = calibration pattern
uniform vec4 uFeather;        // left, right, top, bottom (uv fraction)
uniform float uOpacity;
uniform float uBrightness;
uniform float uGamma;
uniform int uMode;            // 0 normal, 1 add, 2 screen
varying vec2 vUv;

void main() {
  vec3 sceneC = texture2D(uMap, vUv).rgb;
  sceneC *= uBrightness;
  sceneC = pow(max(sceneC, vec3(0.0)), vec3(1.0 / max(uGamma, 0.05)));
  vec3 calibC = texture2D(uCalib, vUv).rgb;
  vec3 c = mix(sceneC, calibC, uCalibMix);

  float a = 1.0;
  if (uFeather.x > 0.0) a *= smoothstep(0.0, uFeather.x, vUv.x);
  if (uFeather.y > 0.0) a *= 1.0 - smoothstep(1.0 - uFeather.y, 1.0, vUv.x);
  if (uFeather.z > 0.0) a *= smoothstep(0.0, uFeather.z, vUv.y);
  if (uFeather.w > 0.0) a *= 1.0 - smoothstep(1.0 - uFeather.w, 1.0, vUv.y);
  a *= uOpacity;

  if (uMode == 2) {
    gl_FragColor = vec4(c * a, 1.0);   // screen blending premultiplies
  } else {
    gl_FragColor = vec4(c, a);
  }
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`

export class BlendManager {
  makeMaterial(map: THREE.Texture, calib: THREE.Texture): THREE.ShaderMaterial {
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uMap: { value: map },
        uCalib: { value: calib },
        uCalibMix: { value: 0 },
        uFeather: { value: new THREE.Vector4(0, 0, 0, 0) },
        uOpacity: { value: 1 },
        uBrightness: { value: 1 },
        uGamma: { value: 1 },
        uMode: { value: 0 },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    return mat
  }

  /** push surface blend parameters + textures into the material */
  update(mat: THREE.ShaderMaterial, s: ProjectionSurface, calibTex: THREE.Texture) {
    const u = mat.uniforms
    u.uCalib.value = calibTex
    u.uCalibMix.value = s.calibration === 'off' ? 0 : 1
    const f = s.blend.feather
    ;(u.uFeather.value as THREE.Vector4).set(f.left, f.right, f.top, f.bottom)
    u.uOpacity.value = s.blend.opacity
    u.uBrightness.value = s.blend.brightness
    u.uGamma.value = s.blend.gamma
    const mode = s.blend.mode
    u.uMode.value = mode === 'add' ? 1 : mode === 'screen' ? 2 : 0
    mat.blending = mode === 'add'
      ? THREE.AdditiveBlending
      : mode === 'screen'
        ? THREE.CustomBlending
        : THREE.NormalBlending
    if (mode === 'screen') {
      mat.blendEquation = THREE.AddEquation
      mat.blendSrc = THREE.OneFactor
      mat.blendDst = THREE.OneMinusSrcColorFactor
    }
    mat.needsUpdate = true   // cheap — program unchanged, just blend state
  }

  dispose(mat: THREE.ShaderMaterial) {
    mat.dispose()
  }
}
