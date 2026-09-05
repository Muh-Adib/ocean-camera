// ---------------------------------------------------------------
// WallQr — the phone-connection invitation that LIVES ON THE WALL.
//
// Instead of floating a DOM card over the browser window (which
// lands keystoned and distorted on the physical wall), the QR is
// rendered INTO each surface's render target, right after the
// ocean scene. It therefore rides the exact same warp/mesh/morph
// pipeline as the picture: wherever the operator moves, stretches
// or bends the surface, the QR bends with it — and on the physical
// wall it appears perfectly straight and undistorted, "stuck" to
// the wallpaper like a poster.
//
// The moment a phone connects (WebSocket presence) it fades out;
// it returns when the phone leaves. The host surface is a project
// setting (auto = largest enabled surface, or a specific one).
// ---------------------------------------------------------------
import * as THREE from 'three'
import QRCode from 'qrcode'
import type { ProjectionSurface } from '../projection/ProjectionTypes'

const CARD_W = 576
const CARD_H = 720

export class WallQr {
  /** which surface carries the QR: 'auto' (largest enabled) or a surface id */
  host = 'auto'
  /** phone linked → hide (driven by ScreenLink presence) */
  phoneOn = false
  /** operator dismissed it for this page session */
  dismissed = false
  /** surfaces provider — set by ProjectionManager */
  getSurfaces: (() => ProjectionSurface[]) | null = null

  private scene = new THREE.Scene()
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10)
  private mesh: THREE.Mesh
  private mat: THREE.MeshBasicMaterial
  private canvas: HTMLCanvasElement
  private texture: THREE.CanvasTexture | null = null
  private url = ''
  private alpha = 0
  private resolved: ProjectionSurface | null = null

  constructor() {
    this.cam.position.z = 5
    this.canvas = document.createElement('canvas')
    this.canvas.width = CARD_W
    this.canvas.height = CARD_H
    this.mat = new THREE.MeshBasicMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      opacity: 0,
    })
    // pre-boost so the post-ACES composite still lands near paper-white
    this.mat.color.setRGB(1.35, 1.35, 1.35)
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.94, 0.94 * (CARD_H / CARD_W)), this.mat)
    this.mesh.position.set(0, 0.09, 0)
    this.mesh.renderOrder = 999
    this.mesh.frustumCulled = false
    this.scene.add(this.mesh)
    this.redraw()
  }

  /** (re)draw the QR card for the current URL */
  private redraw() {
    this.url = `${location.origin}/control-mobile`
    const ctx = this.canvas.getContext('2d')
    if (!ctx) return
    // card
    ctx.fillStyle = '#f2fbff'
    ctx.fillRect(0, 0, CARD_W, CARD_H)
    ctx.strokeStyle = '#0b3a4c'
    ctx.lineWidth = 6
    ctx.strokeRect(5, 5, CARD_W - 10, CARD_H - 10)

    // labels — drawn immediately; the QR pastes itself over the top area when ready
    ctx.textAlign = 'center'
    ctx.fillStyle = '#04222e'
    ctx.font = 'bold 44px system-ui, sans-serif'
    ctx.fillText('OCEAN REMOTE', CARD_W / 2, 612)
    ctx.font = '26px system-ui, sans-serif'
    ctx.fillStyle = '#2e6478'
    ctx.fillText('scan — your phone is the controller', CARD_W / 2, 664)

    // QR
    const tmp = document.createElement('canvas')
    QRCode.toCanvas(tmp, this.url, {
      width: 496,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#04222e', light: '#ffffff' },
    })
      .then(() => {
        ctx.drawImage(tmp, (CARD_W - 496) / 2, 36, 496, 496)
        this.commit()
      })
      .catch(() => {
        // QR lib failed — show the URL as text so the link is never lost
        ctx.fillStyle = '#04222e'
        ctx.font = 'bold 34px system-ui, sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText('OPEN IN BROWSER:', CARD_W / 2, 240)
        ctx.font = '26px system-ui, sans-serif'
        const words = this.url.split('/')
        const lines = [`//${words.slice(2).join('/')}`]
        lines.forEach((l, i) => ctx.fillText(l, CARD_W / 2, 300 + i * 40))
        this.commit()
      })

    this.commit()
  }

  private commit() {
    if (this.texture) this.texture.dispose()
    this.texture = new THREE.CanvasTexture(this.canvas)
    this.texture.colorSpace = THREE.SRGBColorSpace
    this.texture.anisotropy = 4
    this.mat.map = this.texture
    this.mat.needsUpdate = true
  }

  /** pick the surface that carries the QR right now */
  private resolveHost(): ProjectionSurface | null {
    const list = (this.getSurfaces?.() ?? []).filter((s) => s.enabled && s.warp.grid.length > 0)
    if (!list.length) return null
    if (this.host !== 'auto') {
      const found = list.find((s) => s.id === this.host)
      if (found) return found
    }
    return list.reduce((acc, s) =>
      (!acc || s.output.width * s.output.height > acc.output.width * acc.output.height ? s : acc), list[0])
  }

  /**
   * Per-frame: ease the alpha toward the target visibility and re-resolve
   * the host surface (follows preset switches / enable toggles instantly).
   */
  update(dt: number, want: boolean) {
    const target = want ? 1 : 0
    this.alpha += (target - this.alpha) * Math.min(1, dt * 5.5)
    if (this.alpha < 0.015 && target === 0) this.alpha = 0
    this.mat.opacity = this.alpha
    this.resolved = this.alpha > 0.01 ? this.resolveHost() : null
  }

  /**
   * Called by ProjectionManager right after a surface's scene render, while
   * that surface's RT is still bound. Draws the QR card on top — no clear.
   */
  overlaySurface(r: THREE.WebGLRenderer, s: ProjectionSurface) {
    if (!this.resolved || s.id !== this.resolved.id) return
    if (this.mat.opacity <= 0.02 || !this.mat.map) return
    const prev = r.autoClear
    r.autoClear = false
    r.render(this.scene, this.cam)
    r.autoClear = prev
  }

  /** QA / diagnostics */
  info() {
    return {
      alpha: Math.round(this.alpha * 100) / 100,
      host: this.host,
      hostName: this.resolved?.name ?? null,
      visible: this.alpha > 0.5,
      url: this.url,
    }
  }

  dispose() {
    this.mesh.geometry.dispose()
    this.texture?.dispose()
    this.mat.dispose()
  }
}
