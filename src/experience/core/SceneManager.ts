// ---------------------------------------------------------------
// SceneManager — renderer, scene, fog, gradient deep-water dome
// ---------------------------------------------------------------
import * as THREE from 'three'
import { PerformanceManager } from './PerformanceManager'
import { sharedUniforms } from './sharedUniforms'

const COLOR_DEEP = new THREE.Color('#054c72')
const FOG_COLOR = new THREE.Color('#0d6390')

export class SceneManager {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  canvas: HTMLCanvasElement
  fog: THREE.FogExp2

  constructor(private container: HTMLElement, private perf: PerformanceManager) {
    // ---- renderer ----
    this.renderer = new THREE.WebGLRenderer({
      antialias: perf.config.tier !== 'low',
      alpha: false,
      powerPreference: 'high-performance',
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, perf.config.dpr))
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.02
    this.canvas = this.renderer.domElement
    this.canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;display:block;'
    this.canvas.dataset.oceanGl = '1'   // vibrance grade hooks this exact canvas
    container.appendChild(this.canvas)

    // ---- scene & fog ----
    this.scene = new THREE.Scene()
    this.scene.background = COLOR_DEEP.clone()
    // deep saturated blue haze — the reef reads clearly to ~110 m and the
    // darker, bluer water makes the fish colours pop against it
    // (a touch denser than the lagoon pass: distance now sinks into blue,
    // not milk)
    this.fog = new THREE.FogExp2(FOG_COLOR.clone(), 0.0115)
    this.scene.fog = this.fog

    // ---- camera ----
    this.camera = new THREE.PerspectiveCamera(
      58, window.innerWidth / window.innerHeight, 0.1, 300,
    )
    this.camera.position.set(0, 3, 22)
    this.camera.lookAt(0, 0, -20)

    window.addEventListener('resize', this.onResize)
  }

  private onResize = () => {
    const w = window.innerWidth, h = window.innerHeight
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(w, h)
  }

  setPixelRatioCap(cap: number) {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, cap))
  }

  /** Bright-lagoon gradient dome: glowing turquoise above, cyan depth below */
  buildBackgroundDome() {
    const geo = new THREE.SphereGeometry(200, 24, 18)
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        // deep tropical water: sunlit blue zenith, ocean-blue mid,
        // dark navy depth — bluer + moodier so fish colours carry the frame
        uTop: { value: new THREE.Color('#4fb3d6') },
        uMid: { value: new THREE.Color('#0a6a97') },
        uBottom: { value: new THREE.Color('#022e45') },
        uEnergy: sharedUniforms.uEnergy,
        uTime: sharedUniforms.uTime,
      },
      vertexShader: /* glsl */`
        varying vec3 vWorld;
        void main() {
          vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uBottom;
        uniform float uEnergy;
        uniform float uTime;
        varying vec3 vWorld;
        void main() {
          float h = normalize(vWorld).y;              // -1 .. 1
          vec3 c = h > 0.0
            ? mix(uMid, uTop, pow(h, 0.75))
            : mix(uMid, uBottom, pow(-h, 0.6));
          // depth-of-field falloff: the far rim sinks gently toward the
          // deep lagoon colour — a soft vertical fade, never a hard band
          c *= mix(0.62, 1.08, smoothstep(-0.55, 0.3, h));
          // — 360° correction: looking UP must read as LIGHT, not void —
          // a soft zenith glow + slow caustic veils so the overhead
          // direction carries the sun even when the surface plane is
          // outside the (pitch-clamped) view frustum
          float zen = pow(max(h, 0.0), 2.4);
          vec2 dp = normalize(vWorld).xz * 3.1;
          float vt = uTime * 0.32;
          float veil = sin(dp.x * 1.7 + vt)
                     * sin(dp.y * 1.9 - vt * 1.23 + sin(dp.x * 0.8 + vt * 0.7) * 1.4);
          veil = pow(max(veil, 0.0), 1.6);
          c += vec3(0.42, 0.78, 0.9) * zen * (0.3 + 0.3 * veil) * (0.8 + uEnergy * 0.4);
          c *= 0.82 + uEnergy * 0.35;                 // ecosystem energy brightens the water
          gl_FragColor = vec4(c, 1.0);
          // OUTPUT/PREVIEW PARITY: the composite pass tone maps everything it
          // draws (three.js skips tone mapping when a scene renders into a
          // render target). Including the chunk here makes the preview path
          // apply ACES too — both paths now grade the dome identically.
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    })
    const dome = new THREE.Mesh(geo, mat)
    dome.frustumCulled = false
    dome.renderOrder = -10
    this.scene.add(dome)
    return dome
  }

  /** Image-based lighting from the water dome — every standard
   *  material (coral, rock, fish, sponge) gains real PBR response */
  buildEnvironment() {
    const pmrem = new THREE.PMREMGenerator(this.renderer)
    const temp = new THREE.Scene()
    const geo = new THREE.SphereGeometry(90, 32, 20)
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {
        uTop: { value: new THREE.Color('#4fb3d6') },
        uMid: { value: new THREE.Color('#0a6a97') },
        uBottom: { value: new THREE.Color('#022e45') },
      },
      vertexShader: /* glsl */`
        varying vec3 vWorld;
        void main() {
          vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uBottom;
        varying vec3 vWorld;
        void main() {
          float h = normalize(vWorld).y;
          vec3 c = h > 0.0
            ? mix(uMid, uTop, pow(h, 0.75))
            : mix(uMid, uBottom, pow(-h, 0.6));
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }`,
    })
    const dome = new THREE.Mesh(geo, mat)
    temp.add(dome)
    const rt = pmrem.fromScene(temp, 0, 0.1, 200)
    this.scene.environment = rt.texture
    this.scene.environmentIntensity = 0.3
    pmrem.dispose()
    geo.dispose()
    mat.dispose()
  }

  render() { this.renderer.render(this.scene, this.camera) }

  dispose() {
    window.removeEventListener('resize', this.onResize)
    this.renderer.dispose()
    this.canvas.remove()
    void this.perf
  }
}
