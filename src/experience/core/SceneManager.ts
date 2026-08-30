// ---------------------------------------------------------------
// SceneManager — renderer, scene, fog, gradient deep-water dome
// ---------------------------------------------------------------
import * as THREE from 'three'
import { PerformanceManager } from './PerformanceManager'
import { sharedUniforms } from './sharedUniforms'

const COLOR_DEEP = new THREE.Color('#02111f')
const FOG_COLOR = new THREE.Color('#07293f')

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
    this.renderer.toneMappingExposure = 1.26
    this.canvas = this.renderer.domElement
    this.canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;display:block;'
    container.appendChild(this.canvas)

    // ---- scene & fog ----
    this.scene = new THREE.Scene()
    this.scene.background = COLOR_DEEP.clone()
    // lighter fog than the old lagoon — the open ocean is worth seeing
    this.fog = new THREE.FogExp2(FOG_COLOR.clone(), 0.016)
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

  /** Deep-water gradient dome: darker below, teal light above */
  buildBackgroundDome() {
    const geo = new THREE.SphereGeometry(160, 24, 18)
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTop: { value: new THREE.Color('#10688c') },
        uMid: { value: new THREE.Color('#093c58') },
        uBottom: { value: new THREE.Color('#010a14') },
        uEnergy: sharedUniforms.uEnergy,
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
        varying vec3 vWorld;
        void main() {
          float h = normalize(vWorld).y;              // -1 .. 1
          vec3 c = h > 0.0
            ? mix(uMid, uTop, pow(h, 0.75))
            : mix(uMid, uBottom, pow(-h, 0.6));
          c *= 0.82 + uEnergy * 0.35;                 // ecosystem energy brightens the water
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }`,
    })
    const dome = new THREE.Mesh(geo, mat)
    dome.frustumCulled = false
    dome.renderOrder = -10
    this.scene.add(dome)
    return dome
  }

  render() { this.renderer.render(this.scene, this.camera) }

  dispose() {
    window.removeEventListener('resize', this.onResize)
    this.renderer.dispose()
    this.canvas.remove()
    void this.perf
  }
}
