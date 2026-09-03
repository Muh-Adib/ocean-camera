// ---------------------------------------------------------------
// GestureView — "how the camera sees you" panel. Shows the live
// camera feed (mirrored), the 21 detected hand landmarks with their
// skeleton, and the exact gesture the engine currently reads
// (current / swipe / push / pull / attract / caution) with live
// openness & push-pull meters. Makes the detection pipeline
// transparent instead of magic.
// Privacy: everything is drawn locally from the local video feed.
// ---------------------------------------------------------------
import gsap from 'gsap'
import type { HandSample, Landmark } from '../interaction/HandTracker'
import type { GestureStatus } from '../interaction/GestureEngine'

// MediaPipe hand skeleton connections (landmark index pairs)
const BONES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],             // thumb
  [0, 5], [5, 6], [6, 7], [7, 8],             // index
  [5, 9], [9, 10], [10, 11], [11, 12],        // middle
  [9, 13], [13, 14], [14, 15], [15, 16],      // ring
  [13, 17], [17, 18], [18, 19], [19, 20],     // pinky
  [0, 17],                                    // palm base
]

const GESTURE_LABEL: Record<string, string> = {
  idle: 'NO GESTURE',
  current: 'WATER CURRENT',
  swipe: 'SWIPE',
  push: 'PUSH',
  pull: 'PULL',
  attract: 'OPEN PALM · ATTRACT',
  caution: 'FIST · CAUTION',
}

const CW = 208
const CH = 156

export class GestureView {
  private root: HTMLElement
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private handDot: HTMLElement
  private gestureChip: HTMLElement
  private openBar: HTMLElement
  private pushBar: HTMLElement
  private velocityBar: HTMLElement
  private hintEl: HTMLElement
  private visible = false
  private drawAcc = 0

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div')
    this.root.id = 'gesture-view'
    this.root.setAttribute('role', 'region')
    this.root.setAttribute('aria-label', 'Camera gesture detection view')
    this.root.style.display = 'none'

    const header = document.createElement('div')
    header.className = 'gv-header'
    const title = document.createElement('span')
    title.textContent = 'CAMERA · GESTURE ENGINE'
    const close = document.createElement('button')
    close.className = 'gv-close'
    close.setAttribute('aria-label', 'Close gesture view')
    close.textContent = '×'
    close.addEventListener('click', () => this.hide())
    header.append(title, close)

    // live camera preview with landmark skeleton overlay
    const stage = document.createElement('div')
    stage.className = 'gv-stage'
    this.canvas = document.createElement('canvas')
    this.canvas.width = CW
    this.canvas.height = CH
    this.canvas.className = 'gv-canvas'
    stage.appendChild(this.canvas)
    this.ctx = this.canvas.getContext('2d')!

    // live readouts
    const rows = document.createElement('div')
    rows.className = 'gv-rows'

    const handRow = document.createElement('div')
    handRow.className = 'gv-row'
    this.handDot = document.createElement('span')
    this.handDot.className = 'gv-dot'
    const handLabel = document.createElement('span')
    handLabel.textContent = 'HAND'
    const handVal = document.createElement('span')
    handVal.className = 'gv-val'
    handVal.textContent = 'SEARCHING…'
    handVal.id = 'gv-hand-val'
    handRow.append(this.handDot, handLabel, handVal)

    const gestureRow = document.createElement('div')
    gestureRow.className = 'gv-row'
    const gestureLabel = document.createElement('span')
    gestureLabel.textContent = 'GESTURE'
    this.gestureChip = document.createElement('span')
    this.gestureChip.className = 'gv-chip'
    this.gestureChip.textContent = 'NO GESTURE'
    gestureRow.append(gestureLabel, this.gestureChip)

    const meterRow = (label: string, barId: string) => {
      const row = document.createElement('div')
      row.className = 'gv-row'
      const l = document.createElement('span')
      l.textContent = label
      const track = document.createElement('span')
      track.className = 'gv-track'
      const bar = document.createElement('span')
      bar.className = 'gv-bar'
      bar.id = barId
      track.appendChild(bar)
      row.append(l, track)
      return { row, bar }
    }
    const open = meterRow('OPENNESS', 'gv-open-bar')
    const push = meterRow('PUSH / PULL', 'gv-push-bar')
    const vel = meterRow('HAND SPEED', 'gv-vel-bar')
    this.openBar = open.bar
    this.pushBar = push.bar
    this.velocityBar = vel.bar
    // push/pull meter reads from the center
    this.pushBar.style.left = '50%'

    rows.append(handRow, gestureRow, open.row, push.row, vel.row)

    this.hintEl = document.createElement('p')
    this.hintEl.className = 'gv-hint'
    this.hintEl.textContent =
      'Your hand → 21 landmarks → gesture → ocean. Frames are processed locally in your browser and never uploaded.'

    this.root.append(header, stage, rows, this.hintEl)
    parent.appendChild(this.root)
  }

  get isVisible() { return this.visible }

  toggle(): boolean {
    if (this.visible) this.hide()
    else this.show()
    return this.visible
  }

  show() {
    this.visible = true
    this.root.style.display = 'block'
    gsap.fromTo(this.root, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.45, ease: 'power2.out' })
  }

  hide() {
    if (!this.visible) return
    this.visible = false
    gsap.to(this.root, {
      opacity: 0, y: 14, duration: 0.35, ease: 'power2.in',
      onComplete: () => { this.root.style.display = 'none' },
    })
  }

  /** per-frame update — throttled internally to ~30 fps */
  update(
    dt: number,
    sample: HandSample | null,
    landmarks: Landmark[] | null,
    status: GestureStatus,
    tracking: boolean,
    video: HTMLVideoElement | null,
  ) {
    if (!this.visible) return
    this.drawAcc += dt
    if (this.drawAcc < 1 / 30) return
    this.drawAcc = 0

    this.drawVideo(landmarks, tracking, sample, video)
    this.updateReadouts(status, tracking)
  }

  private drawVideo(landmarks: Landmark[] | null, tracking: boolean, sample: HandSample | null, video: HTMLVideoElement | null) {
    const ctx = this.ctx
    ctx.clearRect(0, 0, CW, CH)
    ctx.fillStyle = 'rgba(2, 16, 28, 0.9)'
    ctx.fillRect(0, 0, CW, CH)
    ctx.strokeStyle = 'rgba(120, 200, 230, 0.2)'
    ctx.strokeRect(0.5, 0.5, CW - 1, CH - 1)

    // scan-grid hint while searching
    if (!tracking) {
      ctx.fillStyle = 'rgba(150, 210, 235, 0.55)'
      ctx.font = '11px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('camera off — enable hand tracking', CW / 2, CH / 2)
      return
    }

    // mirrored video frame
    if (video && video.readyState >= 2) {
      ctx.save()
      ctx.scale(-1, 1)
      ctx.drawImage(video, -CW, 0, CW, CH)
      ctx.restore()
      ctx.fillStyle = 'rgba(4, 24, 40, 0.28)'
      ctx.fillRect(0, 0, CW, CH)
    } else {
      ctx.fillStyle = 'rgba(150, 210, 235, 0.55)'
      ctx.font = '11px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('waiting for camera feed…', CW / 2, CH / 2)
    }

    // crosshair at the smoothed control point
    const px = sample?.present ? sample.x * CW : CW / 2
    const py = sample?.present ? sample.y * CH : CH / 2
    ctx.strokeStyle = 'rgba(255, 214, 112, 0.8)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(px - 8, py); ctx.lineTo(px + 8, py)
    ctx.moveTo(px, py - 8); ctx.lineTo(px, py + 8)
    ctx.stroke()

    // skeleton + landmarks
    if (landmarks && landmarks.length >= 21) {
      ctx.lineWidth = 2
      ctx.strokeStyle = 'rgba(110, 231, 255, 0.85)'
      for (const [a, b] of BONES) {
        ctx.beginPath()
        ctx.moveTo(landmarks[a].x * CW, landmarks[a].y * CH)
        ctx.lineTo(landmarks[b].x * CW, landmarks[b].y * CH)
        ctx.stroke()
      }
      for (let i = 0; i < landmarks.length; i++) {
        const tip = i === 4 || i === 8 || i === 12 || i === 16 || i === 20
        ctx.fillStyle = tip ? '#ffd670' : '#6ee7ff'
        ctx.beginPath()
        ctx.arc(landmarks[i].x * CW, landmarks[i].y * CH, tip ? 3.2 : 2.3, 0, Math.PI * 2)
        ctx.fill()
      }
    } else {
      ctx.fillStyle = 'rgba(150, 210, 235, 0.7)'
      ctx.font = '11px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('show your hand to the camera', CW / 2, CH - 10)
    }
  }

  private updateReadouts(status: GestureStatus, tracking: boolean) {
    const present = tracking && status.handPresent
    this.handDot.classList.toggle('is-on', present)
    const handVal = this.root.querySelector('#gv-hand-val') as HTMLElement | null
    if (handVal) handVal.textContent = present ? 'TRACKED' : 'SEARCHING…'

    this.gestureChip.textContent = GESTURE_LABEL[status.name] ?? 'NO GESTURE'
    this.gestureChip.dataset.active = String(status.name !== 'idle')

    this.openBar.style.width = `${Math.round(Math.min(1, Math.max(0, status.openness)) * 100)}%`

    // push/pull: centered bar grows right for push, left for pull
    const rate = Math.max(-1, Math.min(1, status.scaleRate / 0.9))
    if (rate >= 0) {
      this.pushBar.style.left = '50%'
      this.pushBar.style.width = `${rate * 50}%`
    } else {
      this.pushBar.style.left = `${50 + rate * 50}%`
      this.pushBar.style.width = `${-rate * 50}%`
    }

    const speed = Math.min(1, Math.hypot(status.vx, status.vy) / 1.6)
    this.velocityBar.style.width = `${Math.round(speed * 100)}%`
  }

  dispose() {
    this.root.remove()
  }
}
