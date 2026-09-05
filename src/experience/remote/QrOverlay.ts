// ---------------------------------------------------------------
// QrOverlay — the phone-connection invitation on /output.
//
// While no phone is linked, a QR rides ON the projected picture
// (centered on the wall constellation, sized to the walls) so the
// operator can point their phone at the screen and scan. It FOLLOWS
// the walls: move a surface, warp a corner, morph the mesh — the
// QR re-positions over the picture at the constellation centroid.
// The moment a phone connects, it fades out; it returns if the
// phone leaves (unless the operator dismissed it for this session).
// ---------------------------------------------------------------
import QRCode from 'qrcode'
import type { ProjectionSurface } from '../projection/ProjectionTypes'
import './remote.css'

const TICK_MS = 120          // reposition cadence while visible (cheap math only)
const MIN_QR_OUT = 130       // clamp: smallest QR in output px
const MAX_QR_OUT = 250

export class QrOverlay {
  private root: HTMLElement | null = null
  private canvas: HTMLCanvasElement | null = null
  private hint: HTMLElement | null = null
  /** operator closed it for this page session */
  private dismissed = false
  /** phone currently linked (driven by ScreenLink presence) */
  phoneOn = false
  private timer = 0
  private visible = false

  constructor(private container: HTMLElement) {
    this.build()
  }

  private build() {
    const el = document.createElement('div')
    el.id = 'pm-qr'
    el.innerHTML = `
      <button class="pm-qr-close" title="hide for this session">×</button>
      <div class="pm-qr-card">
        <canvas></canvas>
        <span class="pm-qr-title">OCEAN REMOTE</span>
        <span class="pm-qr-hint">scan — your phone becomes the controller</span>
      </div>`
    this.container.appendChild(el)
    this.root = el
    this.canvas = el.querySelector('canvas')
    this.hint = el.querySelector('.pm-qr-hint')

    el.querySelector('.pm-qr-close')?.addEventListener('click', () => {
      this.dismissed = true
      this.show(false)
    })

    // draw the QR once — the URL is this page's own origin + /control-mobile
    const url = `${location.origin}/control-mobile`
    if (this.canvas) {
      QRCode.toCanvas(this.canvas, url, {
        width: 220,
        margin: 1,
        errorCorrectionLevel: 'M',
        color: { dark: '#04222e', light: '#eafcff' },
      }).catch(() => {
        if (this.hint) this.hint.textContent = url
      })
    }

    this.timer = window.setInterval(() => this.tick(), TICK_MS)
  }

  /** recompute position/size from the current surfaces (called on a timer) */
  tick() {
    if (!this.root) return
    const wantVisible = !this.dismissed && !this.phoneOn
    this.show(wantVisible)
    if (!wantVisible) return

    const { cx, cy, size } = this.wallCentroid()
    if (cx < -1e6) { this.root.style.opacity = '0'; return }

    // output space → screen space (same letterbox fit as the composite)
    const W = window.innerWidth, H = window.innerHeight
    const out = this.getOutputSize?.()
    const ow = out?.w ?? 1920, oh = out?.h ?? 1080
    if (ow <= 0 || oh <= 0) return
    const scale = Math.min(W / ow, H / oh)
    const sx = W / 2 + (cx - ow / 2) * scale
    const sy = H / 2 + (cy - oh / 2) * scale
    const px = Math.max(64, Math.min(Math.min(W, H) * 0.42, size * scale))

    this.root.style.opacity = '1'
    const card = this.root.querySelector('.pm-qr-card') as HTMLElement | null
    if (card) {
      card.style.left = `${Math.round(sx)}px`
      card.style.top = `${Math.round(sy)}px`
      const q = Math.round(px * 0.66)
      if (this.canvas) { this.canvas.style.width = `${q}px`; this.canvas.style.height = `${q}px` }
      card.style.setProperty('--qr-w', `${Math.round(px)}px`)
    }
  }

  /** centroid + characteristic size of the enabled wall constellation (output px) */
  private wallCentroid(): { cx: number; cy: number; size: number } {
    const list: ProjectionSurface[] = (this.getSurfaces?.() ?? []).filter((s) => s.enabled && s.warp.grid.length > 0)
    if (!list.length) return { cx: -1e9, cy: -1e9, size: 0 }
    let sx = 0, sy = 0, n = 0
    let minDim = Infinity
    for (const s of list) {
      const c = s.warp.corners
      const cx = (c.tl.x + c.tr.x + c.br.x + c.bl.x) / 4
      const cy = (c.tl.y + c.tr.y + c.br.y + c.bl.y) / 4
      sx += cx; sy += cy; n++
      const w = Math.max(0, (Math.abs(c.tr.x - c.tl.x) + Math.abs(c.br.x - c.bl.x)) / 2)
      const h = Math.max(0, (Math.abs(c.bl.y - c.tl.y) + Math.abs(c.br.y - c.tr.y)) / 2)
      minDim = Math.min(minDim, Math.max(w, h) * 0.9)
    }
    const size = Math.max(MIN_QR_OUT, Math.min(MAX_QR_OUT, minDim === Infinity ? 200 : minDim))
    return { cx: sx / n, cy: sy / n, size }
  }

  /** surfaces provider — set by ProjectionManager */
  getSurfaces: (() => ProjectionSurface[]) | null = null
  /** live output canvas size — set by ProjectionManager */
  getOutputSize: (() => { w: number; h: number }) | null = null

  private show(on: boolean) {
    if (!this.root) return
    if (on === this.visible) return
    this.visible = on
    this.root.classList.toggle('pm-qr-on', on)
  }

  dispose() {
    window.clearInterval(this.timer)
    this.root?.remove()
    this.root = null
    this.canvas = null
  }
}
