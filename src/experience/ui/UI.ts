// ---------------------------------------------------------------
// UI — loading experience, cinematic intro, minimal HUD, toasts,
// gesture guide. DOM is created here (semantic + accessible),
// animated with GSAP. Glassmorphism used sparingly.
// ---------------------------------------------------------------
import gsap from 'gsap'
import { rand } from '../utils/math'
import type { CameraFailure } from '../interaction/HandTracker'

export interface UICallbacks {
  onDive: () => void
  onEnableCamera: () => void
  onToggleSound: () => void
  onToggleCamera: () => void
  onShowGuide: () => void
  onToggleSwim: () => void
  onToggleGestureView: () => void
  onSwimBoost: (on: boolean) => void
  onFeed: () => void
}

export class UI {
  root: HTMLElement
  private loadingEl!: HTMLElement
  private loadingStatus!: HTMLElement
  private introEl!: HTMLElement
  private introInner!: HTMLElement
  private hudEl!: HTMLElement
  private statusChip!: HTMLElement
  private statusText!: HTMLElement
  private hintsEl!: HTMLElement
  private toastsEl!: HTMLElement
  private guideEl: HTMLElement | null = null
  private camHelpEl: HTMLElement | null = null
  private camHelpTimer = 0
  private soundBtn!: HTMLButtonElement
  private camBtn!: HTMLButtonElement
  private visionBtn!: HTMLButtonElement
  private swimBtn!: HTMLButtonElement
  private feedBtn!: HTMLButtonElement
  private paddleEl: HTMLElement | null = null
  private privacyNote!: HTMLElement
  cb: UICallbacks

  constructor(container: HTMLElement, cb: UICallbacks) {
    this.cb = cb
    this.root = document.createElement('div')
    this.root.id = 'ocean-ui'
    container.appendChild(this.root)

    this.buildVignette()
    this.buildLoading()
    this.buildIntro()
    this.buildHUD()
    this.buildToasts()
  }

  // ------------------------------------------------------------ vignette
  private buildVignette() {
    const v = document.createElement('div')
    v.id = 'ocean-vignette'
    v.setAttribute('aria-hidden', 'true')
    this.root.appendChild(v)
  }

  // ------------------------------------------------------------ loading
  private buildLoading() {
    this.loadingEl = document.createElement('div')
    this.loadingEl.id = 'ocean-loading'
    this.loadingEl.setAttribute('role', 'status')
    this.loadingEl.setAttribute('aria-live', 'polite')

    const bubbles = document.createElement('div')
    bubbles.className = 'load-bubbles'
    bubbles.setAttribute('aria-hidden', 'true')
    for (let i = 0; i < 7; i++) {
      const b = document.createElement('span')
      const s = rand(6, 16)
      b.style.cssText = `width:${s}px;height:${s}px;left:${rand(8, 88)}%;animation-delay:${rand(0, 3)}s;animation-duration:${rand(2.6, 4.4)}s;`
      bubbles.appendChild(b)
    }
    this.loadingEl.appendChild(bubbles)

    const title = document.createElement('div')
    title.className = 'load-title'
    title.textContent = 'PREPARING THE OCEAN'
    this.loadingEl.appendChild(title)

    this.loadingStatus = document.createElement('div')
    this.loadingStatus.className = 'load-status'
    this.loadingStatus.textContent = 'Loading coral'
    this.loadingEl.appendChild(this.loadingStatus)

    this.root.appendChild(this.loadingEl)
  }

  private loadingStep = 0
  private loadingSteps = ['Loading coral', 'Loading marine life', 'Creating currents', 'Preparing the ecosystem']

  async runLoadingSequence(minDuration = 2400) {
    const start = performance.now()
    for (const step of this.loadingSteps) {
      this.loadingStatus.textContent = step
      this.loadingStep++
      await new Promise((r) => setTimeout(r, minDuration / this.loadingSteps.length))
    }
    const elapsed = performance.now() - start
    if (elapsed < minDuration) await new Promise((r) => setTimeout(r, minDuration - elapsed))
    this.loadingStatus.textContent = 'THE OCEAN IS READY'

    gsap.to(this.loadingStatus, { opacity: 1, duration: 0.4 })
    await new Promise((r) => setTimeout(r, 900))
    gsap.to(this.loadingEl, {
      opacity: 0, duration: 1.1, ease: 'power2.inOut',
      onComplete: () => { this.loadingEl.style.display = 'none' },
    })
    this.showIntro()
  }

  // ------------------------------------------------------------ intro
  private buildIntro() {
    this.introEl = document.createElement('section')
    this.introEl.id = 'ocean-intro'
    this.introEl.setAttribute('aria-label', 'Ocean introduction')
    // hidden from pointer/keyboard until the loading sequence reveals it
    this.introEl.style.display = 'none'
    this.introEl.style.opacity = '0'

    this.introInner = document.createElement('div')
    this.introInner.className = 'intro-inner'

    const kicker = document.createElement('p')
    kicker.className = 'intro-kicker reveal'
    kicker.textContent = 'A LIVING UNDERWATER WORLD'

    const h1 = document.createElement('h1')
    h1.className = 'intro-title reveal'
    h1.textContent = 'ENTER THE OCEAN'

    const sub = document.createElement('p')
    sub.className = 'intro-sub reveal'
    sub.innerHTML = 'Move your hand<br/>and watch the ocean respond.'

    const actions = document.createElement('div')
    actions.className = 'intro-actions reveal'

    const dive = document.createElement('button')
    dive.id = 'btn-dive'
    dive.className = 'btn-primary'
    dive.textContent = 'DIVE IN'
    dive.setAttribute('aria-label', 'Enter the ocean using mouse or touch')
    dive.addEventListener('click', () => this.cb.onDive())

    const cam = document.createElement('button')
    cam.id = 'btn-camera'
    cam.className = 'btn-secondary'
    cam.textContent = 'ENABLE CAMERA'
    cam.setAttribute('aria-label', 'Enter the ocean using hand gestures via camera')
    cam.addEventListener('click', () => this.cb.onEnableCamera())

    actions.appendChild(dive)
    actions.appendChild(cam)

    this.privacyNote = document.createElement('p')
    this.privacyNote.className = 'privacy-note reveal'
    this.privacyNote.textContent =
      'Camera access is used only to detect hand movement. Video is processed locally in your browser and is never uploaded or stored.'

    this.introInner.append(kicker, h1, sub, actions, this.privacyNote)
    this.introEl.appendChild(this.introInner)
    this.root.appendChild(this.introEl)
  }

  private showIntro() {
    this.introEl.style.display = 'flex'
    gsap.to(this.introEl, { opacity: 1, duration: 1.2, ease: 'power2.out' })
    gsap.fromTo('.reveal',
      { y: 26, opacity: 0 },
      { y: 0, opacity: 1, duration: 1.4, stagger: 0.16, ease: 'power3.out', delay: 0.3 })
  }

  hideIntro(onComplete?: () => void) {
    return gsap.timeline({ onComplete: () => onComplete?.() })
      .to(this.introInner, { opacity: 0, y: -20, duration: 0.8, ease: 'power2.in' })
      .to(this.introEl, { opacity: 0, duration: 0.7, ease: 'power2.inOut' }, '-=0.3')
      .call(() => { this.introEl.style.display = 'none' })
  }

  setCameraButtonLoading(loading: boolean) {
    const btn = document.getElementById('btn-camera') as HTMLButtonElement | null
    if (btn) {
      btn.textContent = loading ? 'PREPARING HAND TRACKING…' : 'ENABLE CAMERA'
      btn.disabled = loading
    }
  }

  // ------------------------------------------------------------ HUD
  private buildHUD() {
    this.hudEl = document.createElement('div')
    this.hudEl.id = 'ocean-hud'
    this.hudEl.style.opacity = '0'

    // top-right controls
    const controls = document.createElement('div')
    controls.className = 'hud-controls'
    controls.setAttribute('role', 'toolbar')
    controls.setAttribute('aria-label', 'Ocean controls')

    this.soundBtn = this.iconButton('sound', 'Sound', this.cb.onToggleSound, 'M4 9v6h4l5 4V5L8 9H4z M16.5 12a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z')
    this.camBtn = this.iconButton('cam', 'Camera hand tracking', this.cb.onToggleCamera, 'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z M9 3l-1.5 2h-3A2.5 2.5 0 0 0 2 7.5v9A2.5 2.5 0 0 0 4.5 19h15a2.5 2.5 0 0 0 2.5-2.5v-9A2.5 2.5 0 0 0 19.5 5h-3L15 3H9z')
    this.swimBtn = this.iconButton('swim', 'Free swim — explore the open ocean', this.cb.onToggleSwim, 'M2 12c4-5.2 10.5-5.2 14.5-.6L22 7.4v9.2l-5.5-4C12.5 17.2 6 17.2 2 12z')
    this.feedBtn = this.iconButton('feed', 'Scatter food — feed the fish (G)', this.cb.onFeed, 'M12 3.2a2 2 0 1 1 0 4 2 2 0 0 1 0-4z M6.2 8.6a2 2 0 1 1 0 4 2 2 0 0 1 0-4z M17.8 8.6a2 2 0 1 1 0 4 2 2 0 0 1 0-4z M9 15a2 2 0 1 1 0 4 2 2 0 0 1 0-4z M15 15a2 2 0 1 1 0 4 2 2 0 0 1 0-4z')
    this.visionBtn = this.iconButton('vision', 'Gesture camera view — see how the detection works', this.cb.onToggleGestureView, 'M12 5c-5 0-9.3 3.1-11 7.5C2.7 16.9 7 20 12 20s9.3-3.1 11-7.5C21.3 8.1 17 5 12 5z M12 17a5 5 0 1 1 0-10 5 5 0 0 1 0 10z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z')
    const helpBtn = this.iconButton('help', 'Gesture guide', this.cb.onShowGuide, 'M11 18h2v-2h-2v2z M12 6a4 4 0 0 0-4 4h2a2 2 0 1 1 4 0c0 .9-.4 1.4-1.2 2-.9.7-1.8 1.4-1.8 3h2c0-.7.4-1.1 1.1-1.7.9-.7 1.9-1.5 1.9-3.3A4 4 0 0 0 12 6z M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z')

    controls.append(this.soundBtn, this.camBtn, this.swimBtn, this.feedBtn, this.visionBtn, helpBtn)
    this.hudEl.appendChild(controls)

    // touch forward paddle — hold to glide ahead while free-swimming
    this.paddleEl = document.createElement('button')
    this.paddleEl.id = 'swim-paddle'
    this.paddleEl.textContent = '▲ GLIDE'
    this.paddleEl.setAttribute('aria-label', 'Hold to swim forward')
    this.paddleEl.style.display = 'none'
    this.paddleEl.addEventListener('pointerdown', (e) => { e.preventDefault(); this.cb.onSwimBoost(true) })
    const paddleRelease = () => this.cb.onSwimBoost(false)
    this.paddleEl.addEventListener('pointerup', paddleRelease)
    this.paddleEl.addEventListener('pointercancel', paddleRelease)
    this.paddleEl.addEventListener('pointerleave', paddleRelease)
    this.hudEl.appendChild(this.paddleEl)

    // bottom-left status chip
    this.statusChip = document.createElement('div')
    this.statusChip.className = 'hud-status'
    const dot = document.createElement('span')
    dot.className = 'status-dot'
    dot.setAttribute('aria-hidden', 'true')
    this.statusText = document.createElement('span')
    this.statusText.textContent = 'MOUSE MODE'
    this.statusChip.append(dot, this.statusText)
    this.hudEl.appendChild(this.statusChip)

    // bottom-center gesture hints
    this.hintsEl = document.createElement('div')
    this.hintsEl.className = 'hud-hints'
    this.hintsEl.setAttribute('aria-hidden', 'true')
    this.hintsEl.innerHTML = `
      <span class="hint">← swipe →</span>
      <span class="hint">push / pull</span>
      <span class="hint">open palm · attract</span>
      <span class="hint">fist · caution</span>
      <span class="hint">F · free swim</span>
      <span class="hint">G · feed</span>`
    this.hudEl.appendChild(this.hintsEl)

    this.root.appendChild(this.hudEl)
  }

  private iconButton(id: string, label: string, cb: () => void, svgPath: string): HTMLButtonElement {
    const b = document.createElement('button')
    b.id = `hud-${id}`
    b.className = 'hud-btn'
    b.setAttribute('aria-label', label)
    b.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="${svgPath}"/></svg>`
    b.addEventListener('click', cb)
    return b
  }

  showHUD() {
    gsap.to(this.hudEl, { opacity: 1, duration: 1.4, ease: 'power2.out', delay: 1.5 })
    // hints fade away after a while
    setTimeout(() => {
      gsap.to(this.hintsEl, { opacity: 0, duration: 1.6 })
    }, 14000)
  }

  setStatus(text: string, mode: 'mouse' | 'hand' | 'off' | 'loading') {
    this.statusText.textContent = text
    this.statusChip.dataset.mode = mode
  }

  setSoundIcon(muted: boolean) {
    this.soundBtn.setAttribute('aria-label', muted ? 'Unmute sound' : 'Mute sound')
    this.soundBtn.classList.toggle('is-off', muted)
  }

  setCameraActive(active: boolean) {
    this.camBtn.classList.toggle('is-active', active)
    this.camBtn.setAttribute('aria-label', active ? 'Disable camera hand tracking' : 'Enable camera hand tracking')
    if (active) this.hideCameraHelp()
  }

  setSwimActive(active: boolean) {
    this.swimBtn.classList.toggle('is-active', active)
    this.swimBtn.setAttribute('aria-label', active ? 'Stop free swimming' : 'Free swim — explore the open ocean')
    if (this.paddleEl) this.paddleEl.style.display = active ? 'flex' : 'none'
  }

  setGestureViewActive(active: boolean) {
    this.visionBtn.classList.toggle('is-active', active)
  }

  // ------------------------------------------------------ camera help
  private static readonly CAM_HELP: Record<CameraFailure, { title: string; body: string }> = {
    iframe: {
      title: 'CAMERA BLOCKED BY THE PREVIEW',
      body: 'Hand tracking can\u2019t run inside an embedded preview. Open the ocean in its own tab, then press the camera button — your browser will ask for permission.',
    },
    permission: {
      title: 'CAMERA PERMISSION NEEDED',
      body: 'The browser blocked camera access. Click the camera / lock icon in the address bar, set Camera to Allow, then try again. Mouse & touch stay active meanwhile.',
    },
    'no-device': {
      title: 'NO CAMERA FOUND',
      body: 'No camera was detected on this device. The ocean stays fully alive — move, drag or tap to stir the water.',
    },
    busy: {
      title: 'CAMERA IN USE',
      body: 'Another app seems to be holding your camera. Close it, then press the camera button again.',
    },
    insecure: {
      title: 'SECURE CONNECTION NEEDED',
      body: 'Camera access only works over a secure (https) connection or on localhost. Mouse & touch controls remain fully active.',
    },
    model: {
      title: 'HAND MODEL NOT LOADED',
      body: 'The hand-tracking model couldn\u2019t be fetched (network hiccup). Everything else still responds — try again in a moment.',
    },
    lost: {
      title: 'CAMERA DISCONNECTED',
      body: 'The camera stopped mid-session — it may have been unplugged, turned off, or its permission was revoked. Reconnect it, then try again.',
    },
    unknown: {
      title: 'CAMERA UNAVAILABLE',
      body: 'Something interrupted the camera. Your mouse & touch still keep the ocean alive — or give it another try.',
    },
  }

  /** friendly, specific camera-failure panel (never raw technical errors) */
  showCameraHelp(reason: CameraFailure, onRetry: () => void) {
    this.hideCameraHelp()
    const info = UI.CAM_HELP[reason] ?? UI.CAM_HELP.unknown

    const el = document.createElement('div')
    el.className = 'cam-help'
    el.setAttribute('role', 'alert')

    const h = document.createElement('h3')
    h.textContent = info.title
    const p = document.createElement('p')
    p.textContent = info.body
    el.append(h, p)

    const actions = document.createElement('div')
    actions.className = 'cam-help-actions'

    const retry = document.createElement('button')
    retry.className = 'btn-glass'
    retry.textContent = 'TRY AGAIN'
    retry.setAttribute('aria-label', 'Try enabling the camera again')
    retry.addEventListener('click', () => { this.hideCameraHelp(); onRetry() })
    actions.appendChild(retry)

    // embedded preview → offer the real fix: standalone tab
    if (reason === 'iframe') {
      const open = document.createElement('button')
      open.className = 'btn-glass'
      open.textContent = 'OPEN IN NEW TAB ↗'
      open.setAttribute('aria-label', 'Open the ocean in a new tab so the camera can be enabled')
      open.addEventListener('click', () => window.open(window.location.href, '_blank', 'noopener'))
      actions.appendChild(open)
    }

    el.appendChild(actions)
    this.root.appendChild(el)
    this.camHelpEl = el
    gsap.fromTo(el, { y: 16, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, ease: 'power2.out' })

    window.clearTimeout(this.camHelpTimer)
    this.camHelpTimer = window.setTimeout(() => this.hideCameraHelp(), 20000)
  }

  hideCameraHelp() {
    window.clearTimeout(this.camHelpTimer)
    if (!this.camHelpEl) return
    const el = this.camHelpEl
    this.camHelpEl = null
    gsap.to(el, { opacity: 0, y: 10, duration: 0.4, onComplete: () => el.remove() })
  }

  // ------------------------------------------------------------ toasts
  private buildToasts() {
    this.toastsEl = document.createElement('div')
    this.toastsEl.id = 'ocean-toasts'
    this.toastsEl.setAttribute('role', 'status')
    this.toastsEl.setAttribute('aria-live', 'polite')
    this.root.appendChild(this.toastsEl)
  }

  toast(message: string, duration = 4200) {
    const t = document.createElement('div')
    t.className = 'toast'
    t.textContent = message
    this.toastsEl.appendChild(t)
    gsap.fromTo(t, { y: 18, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, ease: 'power2.out' })
    setTimeout(() => {
      gsap.to(t, { opacity: 0, y: -10, duration: 0.5, onComplete: () => t.remove() })
    }, duration)
  }

  // ------------------------------------------------------------ guide
  showGuide() {
    if (this.guideEl) return
    const g = document.createElement('div')
    g.id = 'ocean-guide'
    g.setAttribute('role', 'dialog')
    g.setAttribute('aria-label', 'Gesture guide')
    g.innerHTML = `
      <div class="guide-card">
        <h2>OCEAN GUIDE</h2>
        <ul>
          <li><b>Swipe hand</b><span>fish &amp; plankton drift that way</span></li>
          <li><b>Push hand forward</b><span>nearby fish scatter</span></li>
          <li><b>Pull hand back</b><span>the ocean settles</span></li>
          <li><b>Open palm</b><span>curious fish approach</span></li>
          <li><b>Closed fist</b><span>fish keep their distance</span></li>
          <li><b>Fast / slow</b><span>stronger / softer reaction</span></li>
          <li><b>Free swim</b><span>press <b>F</b> — drag to look, <b>A</b>/<b>D</b> turn, <b>W</b>/<b>S</b> glide, <b>Q</b>/<b>E</b> strafe, <b>Space</b>/<b>C</b> rise &amp; sink</span></li>
          <li><b>Swim by hand</b><span>while swimming, your open palm steers — hand left / right to turn, <b>fist</b> kicks forward</span></li>
          <li><b>Feed the fish</b><span>press <b>G</b> — pellets sink slowly and nearby schools race in to feast</span></li>
        </ul>
        <p class="guide-keys">No camera? <b>Move / drag</b> the pointer, <b>tap</b> to attract, <b>hold</b> to push, <b>Space</b> attract, <b>X</b> push. On touch, hold <b>▲ GLIDE</b> to swim ahead.</p>
        <button class="btn-primary" id="guide-close">BACK TO THE OCEAN</button>
      </div>`
    this.root.appendChild(g)
    this.guideEl = g
    gsap.fromTo(g, { opacity: 0 }, { opacity: 1, duration: 0.4 })
    gsap.fromTo(g.querySelector('.guide-card'), { y: 30 }, { y: 0, duration: 0.6, ease: 'power3.out' })
    g.querySelector('#guide-close')?.addEventListener('click', () => this.hideGuide())
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { this.hideGuide(); window.removeEventListener('keydown', onKey) } }
    window.addEventListener('keydown', onKey)
  }

  hideGuide() {
    if (!this.guideEl) return
    const g = this.guideEl
    this.guideEl = null
    gsap.to(g, {
      opacity: 0, duration: 0.4,
      onComplete: () => g.remove(),
    })
  }

  // ------------------------------------------------------------ fallback notice
  showFallbackNotice() {
    this.toast('Your device doesn\'t support the full underwater experience — use touch to explore the ocean.', 6000)
  }
}
