// ---------------------------------------------------------------
// OutputManager — the composite stage. Each surface becomes a
// mesh (warped by its grid, textured with its own render target
// of the SHARED scene) laid out in output space. An orthographic
// camera letterboxes the output canvas onto whatever screen is
// rendering. Also owns the low-cost GPU→2D readbacks used by the
// editor's camera previews and output preview.
// ---------------------------------------------------------------
import * as THREE from 'three'
import type { ProjectionSurface, Vec2 } from './ProjectionTypes'
import { BlendManager } from './BlendManager'
import { CalibrationManager } from './CalibrationManager'

interface SurfaceEntry {
  mesh: THREE.Mesh
  material: THREE.ShaderMaterial
  geometry: THREE.BufferGeometry
  res: number
  rt: THREE.WebGLRenderTarget
  rtW: number
  rtH: number
  order: number
}

const RT_CAP = 2048

export class OutputManager {
  /** composite scene — surfaces only, black letterbox background */
  scene = new THREE.Scene()
  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 20)
  previewRT = new THREE.WebGLRenderTarget(480, 270, { type: THREE.UnsignedByteType })
  cameraPreviewRT = new THREE.WebGLRenderTarget(384, 216, { type: THREE.UnsignedByteType })

  private entries = new Map<string, SurfaceEntry>()
  private readBuf: ImageData | null = null
  private readCanvas: HTMLCanvasElement | null = null

  constructor(private blend: BlendManager, private calib: CalibrationManager) {
    this.scene.background = new THREE.Color('#000000')
    this.camera.position.set(0, 0, 5)
  }

  /** fit the output space into the current view (letterbox) */
  updateCamera(outputW: number, outputH: number, viewW: number, viewH: number) {
    if (outputW <= 0 || outputH <= 0 || viewW <= 0 || viewH <= 0) return
    const scale = Math.min(viewW / outputW, viewH / outputH)
    const halfW = viewW / scale / 2
    const halfH = viewH / scale / 2
    this.camera.left = outputW / 2 - halfW
    this.camera.right = outputW / 2 + halfW
    this.camera.top = outputH / 2 - halfH
    this.camera.bottom = outputH / 2 + halfH
    this.camera.updateProjectionMatrix()
  }

  // ------------------------------------------------------------ render targets
  ensureRT(entry: SurfaceEntry, wantW: number, wantH: number, scale: number): THREE.WebGLRenderTarget {
    const w = Math.max(64, Math.min(RT_CAP, Math.round(wantW * scale)))
    const h = Math.max(64, Math.min(RT_CAP, Math.round(wantH * scale)))
    if (entry.rtW !== w || entry.rtH !== h) {
      entry.rt.setSize(w, h)
      entry.rtW = w
      entry.rtH = h
    }
    return entry.rt
  }

  // ------------------------------------------------------------ surface sync
  syncSurface(s: ProjectionSurface, index: number) {
    let entry = this.entries.get(s.id)
    if (!entry) {
      const rt = new THREE.WebGLRenderTarget(64, 64, { type: THREE.HalfFloatType })
      const material = this.blend.makeMaterial(rt.texture, this.calib.getBlank())
      const geometry = new THREE.BufferGeometry()
      const mesh = new THREE.Mesh(geometry, material)
      mesh.frustumCulled = false
      mesh.matrixAutoUpdate = false
      this.scene.add(mesh)
      entry = { mesh, material, geometry, res: -1, rt, rtW: 0, rtH: 0, order: index }
      this.entries.set(s.id, entry)
    }
    entry.order = index
    entry.mesh.renderOrder = index
    entry.mesh.visible = s.enabled

    if (entry.res !== s.warp.gridResolution) {
      this.rebuildGeometry(entry, s)
    }
    this.ensureRT(entry, s.output.width, s.output.height, 1)  // track size for material aspect only
    this.blend.update(entry.material, s, this.calib.getTexture(s.calibration))
  }

  /** recompute the warped mesh from the surface grid (y-down output px) */
  rebuildGeometry(entry: SurfaceEntry, s: ProjectionSurface) {
    const res = s.warp.gridResolution
    const grid = s.warp.grid
    const n = res + 1
    const positions = new Float32Array(n * n * 3)
    const uvs = new Float32Array(n * n * 2)
    let pi = 0, ui = 0
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const p: Vec2 = grid[j * n + i] ?? { x: 0, y: 0 }
        positions[pi++] = p.x
        positions[pi++] = p.y      // ortho camera is y-flipped (top=0, bottom=H)
        positions[pi++] = 0
        uvs[ui++] = i / res
        uvs[ui++] = 1 - j / res    // RT v=1 is the top row of the scene render
      }
    }
    const idx: number[] = []
    for (let j = 0; j < res; j++) {
      for (let i = 0; i < res; i++) {
        const a = j * n + i, b = a + 1, c = a + n + 1, d = a + n
        idx.push(a, b, d, b, c, d)
      }
    }
    entry.geometry.dispose()
    entry.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    entry.geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
    entry.geometry.setIndex(idx)
    entry.res = res
  }

  removeSurface(id: string) {
    const entry = this.entries.get(id)
    if (!entry) return
    this.scene.remove(entry.mesh)
    entry.geometry.dispose()
    this.blend.dispose(entry.material)
    entry.rt.dispose()
    this.entries.delete(id)
  }

  hasSurface(id: string): boolean {
    return this.entries.has(id)
  }

  getSurfaceIds(): string[] {
    return [...this.entries.keys()]
  }

  getEntry(id: string): SurfaceEntry | undefined {
    return this.entries.get(id)
  }

  /** drop geometry caches so grids rebuild on next sync (grid edited) */
  invalidateGeometry(id: string) {
    const entry = this.entries.get(id)
    if (entry) entry.res = -1
  }

  renderComposite(renderer: THREE.WebGLRenderer) {
    renderer.render(this.scene, this.camera)
  }

  // ------------------------------------------------------------ readbacks
  /**
   * Render a scene/camera pair into a small byte RT, then copy it to a
   * 2D canvas with an approximate linear→sRGB curve (tone mapping is
   * skipped on RT paths, so editor previews brighten manually).
   */
  readToCanvas(
    renderer: THREE.WebGLRenderer,
    rt: THREE.WebGLRenderTarget,
    canvas: HTMLCanvasElement,
    renderFn: () => void,
  ) {
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    renderer.setRenderTarget(rt)
    renderFn()
    renderer.setRenderTarget(null)

    const w = rt.width, h = rt.height
    const buf = new Uint8Array(w * h * 4)
    renderer.readRenderTargetPixels(rt, 0, 0, w, h, buf)

    if (!this.readCanvas || this.readCanvas.width !== w || this.readCanvas.height !== h) {
      this.readCanvas = document.createElement('canvas')
      this.readCanvas.width = w
      this.readCanvas.height = h
    }
    const rctx = this.readCanvas.getContext('2d')!
    const img = rctx.createImageData(w, h)
    const d = img.data
    for (let y = 0; y < h; y++) {
      const srcRow = (h - 1 - y) * w * 4      // GL origin is bottom-left
      const dstRow = y * w * 4
      for (let x = 0; x < w * 4; x += 4) {
        d[dstRow + x] = CURVE[buf[srcRow + x]]
        d[dstRow + x + 1] = CURVE[buf[srcRow + x + 1]]
        d[dstRow + x + 2] = CURVE[buf[srcRow + x + 2]]
        d[dstRow + x + 3] = 255
      }
    }
    rctx.putImageData(img, 0, 0)
    ctx.drawImage(this.readCanvas, 0, 0, canvas.width, canvas.height)
  }

  dispose() {
    ;[...this.entries.keys()].forEach((id) => this.removeSurface(id))
    this.previewRT.dispose()
    this.cameraPreviewRT.dispose()
  }
}

/** 256-entry linear → sRGB-ish lookup (gamma 1/2.2) for editor readbacks */
const CURVE = (() => {
  const t = new Uint8Array(256)
  for (let i = 0; i < 256; i++) t[i] = Math.round(Math.pow(i / 255, 1 / 2.2) * 255)
  return t
})()
