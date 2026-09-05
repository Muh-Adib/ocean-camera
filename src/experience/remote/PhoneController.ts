// ---------------------------------------------------------------
// PhoneController — the smartphone remote (/control-mobile).
//
// Design goals (from the operator's feedback):
//   • DOUBLE JOYSTICK, nothing else on screen: left stick = MOVE
//     (side strafe / lift), right stick = ORBIT (turn / tilt),
//     plus a spring-back DOLLY throttle. All velocities — the view
//     keeps gliding where you left it, the sticks just steer.
//   • SMOOTH end to end: 30 Hz velocity packets over WebSocket +
//     exponential damping on the screens = fluid motion with no
//     stutter, even over Wi-Fi jitter.
//   • CAMERA CONTROLS ONLY WHEN CAMERA MODE IS ON. The camera
//     preview, hand overlay and its status live inside a panel
//     that simply does not exist until "CAMERA" is toggled — and
//     everything is removed again when it goes off.
// ---------------------------------------------------------------
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'
import { PhoneLink } from './RemoteLink'
import './remote.css'

const WASM_PATH = '/mediapipe/wasm'
const MODEL_PATH = '/mediapipe/models/hand_landmarker.task'
const SEND_HZ = 30
const DEAD = 0.07

type Stick = { vx: number; vy: number }

export function mountPhoneController(root: HTMLElement): () => void {
  root.innerHTML = `
    <div class="rm-app">
      <header class="rm-head">
        <div class="rm-brand">
          <span class="rm-dot" id="rm-dot"></span>
          <span class="rm-title">OCEAN REMOTE</span>
        </div>
        <button class="rm-cam-btn" id="rm-cam-btn" type="button">CAMERA</button>
      </header>

      <div class="rm-cam" id="rm-cam" hidden>
        <video id="rm-video" autoplay playsinline muted></video>
        <canvas id="rm-overlay"></canvas>
        <div class="rm-cam-status" id="rm-cam-status">starting camera…</div>
      </div>

      <div class="rm-deck">
        <div class="rm-stick-wrap">
          <div class="rm-stick" id="rm-stick-move">
            <div class="rm-ring"></div>
            <div class="rm-nub"></div>
          </div>
          <span class="rm-stick-label">MOVE · side / lift</span>
        </div>
        <div class="rm-stick-wrap">
          <div class="rm-stick" id="rm-stick-orbit">
            <div class="rm-ring"></div>
            <div class="rm-nub"></div>
          </div>
          <span class="rm-stick-label">ORBIT · turn / tilt</span>
        </div>
        <div class="rm-dolly">
          <span class="rm-dolly-cap">＋</span>
          <div class="rm-dolly-track" id="rm-dolly">
            <div class="rm-dolly-nub"></div>
          </div>
          <span class="rm-dolly-cap">－</span>
          <span class="rm-stick-label">DOLLY</span>
        </div>
      </div>

      <div class="rm-note" id="rm-note">waiting for the ocean…</div>
    </div>`

  const $ = <T extends HTMLElement>(id: string) => root.querySelector('#' + id) as T
  const dot = $('rm-dot')
  const note = $('rm-note')
  const camBtn = $('rm-cam-btn')
  const camPanel = $('rm-cam')
  const video = $('rm-video') as HTMLVideoElement
  const overlay = $('rm-overlay') as HTMLCanvasElement
  const camStatus = $('rm-cam-status')

  const link = new PhoneLink()
  link.onState = (live) => {
    dot.classList.toggle('on', live)
    note.textContent = live ? 'connected — steer the ocean' : 'reconnecting to the ocean…'
    if (live && camOn) link.sendCam(true)   // re-announce camera mode after a reconnect
  }

  // ------------------------------------------------------------ sticks
  const move: Stick = { vx: 0, vy: 0 }
  const orbit: Stick = { vx: 0, vy: 0 }
  let dolly = 0

  const ease = (v: number) => Math.sign(v) * Math.pow(Math.abs(v), 1.35)   // gentle center falloff

  function bindStick(el: HTMLElement, st: Stick) {
    const nub = el.querySelector('.rm-nub') as HTMLElement
    let ptr = -1
    const set = (e: PointerEvent) => {
      const r = el.getBoundingClientRect()
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2
      const rad = r.width / 2
      let dx = (e.clientX - cx) / rad
      let dy = (e.clientY - cy) / rad
      const len = Math.hypot(dx, dy)
      if (len > 1) { dx /= len; dy /= len }
      const dz = (v: number) => (Math.abs(v) < DEAD ? 0 : (v - Math.sign(v) * DEAD) / (1 - DEAD))
      st.vx = ease(dz(dx))
      st.vy = ease(dz(dy))
      nub.style.transform = `translate(calc(-50% + ${dx * rad * 0.62}px), calc(-50% + ${dy * rad * 0.62}px))`
    }
    el.addEventListener('pointerdown', (e) => {
      ptr = e.pointerId
      el.setPointerCapture(ptr)
      el.classList.add('live')
      set(e)
    })
    el.addEventListener('pointermove', (e) => { if (e.pointerId === ptr) set(e) })
    const end = (e: PointerEvent) => {
      if (e.pointerId !== ptr) return
      ptr = -1
      el.classList.remove('live')
      st.vx = 0; st.vy = 0
      nub.style.transform = 'translate(-50%, -50%)'
    }
    el.addEventListener('pointerup', end)
    el.addEventListener('pointercancel', end)
  }
  bindStick($('rm-stick-move'), move)
  bindStick($('rm-stick-orbit'), orbit)

  // dolly — a spring-back throttle: hold toward ＋ to fly in, － to fly out
  const dollyTrack = $('rm-dolly')
  const dollyNub = dollyTrack.querySelector('.rm-dolly-nub') as HTMLElement
  let dollyPtr = -1
  const setDolly = (e: PointerEvent) => {
    const r = dollyTrack.getBoundingClientRect()
    dolly = Math.max(-1, Math.min(1, ((r.bottom - e.clientY) / (r.height / 2)) - 1))
    dollyNub.style.bottom = `${50 + dolly * 42}%`
  }
  dollyTrack.addEventListener('pointerdown', (e) => {
    dollyPtr = e.pointerId
    dollyTrack.setPointerCapture(dollyPtr)
    dollyTrack.classList.add('live')
    setDolly(e)
  })
  dollyTrack.addEventListener('pointermove', (e) => { if (e.pointerId === dollyPtr) setDolly(e) })
  const endDolly = (e: PointerEvent) => {
    if (e.pointerId !== dollyPtr) return
    dollyPtr = -1
    dolly = 0
    dollyTrack.classList.remove('live')
    dollyNub.style.bottom = '50%'
  }
  dollyTrack.addEventListener('pointerup', endDolly)
  dollyTrack.addEventListener('pointercancel', endDolly)

  // ------------------------------------------------------------ 30 Hz send loop
  const sendTimer = window.setInterval(() => {
    if (!link.live) return
    link.sendCtl(move.vx, -move.vy, orbit.vx, -orbit.vy, dolly)
  }, Math.round(1000 / SEND_HZ))

  // tab hidden → drop everything so the screens stop immediately
  const onVis = () => {
    if (document.hidden && link.live) {
      link.sendCtl(0, 0, 0, 0, 0)
      if (camOn) link.sendHand(false, 0.5, 0.5, 0, 0)
    }
  }
  document.addEventListener('visibilitychange', onVis)

  // ------------------------------------------------------------ camera mode
  let camOn = false
  let landmarker: HandLandmarker | null = null
  let stream: MediaStream | null = null
  let raf = 0
  let lastVideoTime = -1

  async function camStart() {
    camStatus.textContent = 'asking for the camera…'
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }, audio: false,
      })
    } catch (err: unknown) {
      camStatus.textContent = String((err as Error)?.name) === 'NotAllowedError'
        ? 'camera blocked — allow access in the browser bar'
        : 'camera unavailable on this phone'
      return false
    }
    video.srcObject = stream
    camStatus.textContent = 'loading hand tracking…'
    try {
      const fileset = await FilesetResolver.forVisionTasks(WASM_PATH)
      try {
        landmarker = await HandLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_PATH, delegate: 'GPU' },
          runningMode: 'VIDEO', numHands: 2,
        })
      } catch {
        landmarker = await HandLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_PATH, delegate: 'CPU' },
          runningMode: 'VIDEO', numHands: 2,
        })
      }
    } catch {
      camStatus.textContent = 'hand model failed to load'
      return false
    }
    camStatus.textContent = ''
    detectLoop()
    return true
  }

  function detectLoop() {
    raf = requestAnimationFrame(detectLoop)
    if (video.readyState < 2) return
    const now = performance.now()
    let hands = 0
    if (video.currentTime !== lastVideoTime && landmarker) {
      lastVideoTime = video.currentTime
      try {
        const res = landmarker.detectForVideo(video, now)
        const list = res?.landmarks ?? []
        hands = list.length
        drawOverlay(list)
        if (hands > 0) {
          const lm = list[0]
          const ids = [0, 5, 9, 13, 17]
          let px = 0, py = 0
          for (const i of ids) { px += lm[i].x; py += lm[i].y }
          px /= ids.length; py /= ids.length
          const scale = Math.hypot(lm[9].x - lm[0].x, lm[9].y - lm[0].y) || 0.001
          let sum = 0
          for (const i of [8, 12, 16, 20]) sum += Math.hypot(lm[i].x - lm[0].x, lm[i].y - lm[0].y)
          const open = Math.max(0, Math.min(1, (sum / 4 / scale - 1.35) / 1.25))
          link.sendHand(true, 1 - px, py, open, hands)   // mirrored like the desktop tracker
        } else {
          link.sendHand(false, 0.5, 0.5, 0, 0)
        }
      } catch { /* skip a bad frame */ }
    }
  }

  function drawOverlay(list: { x: number; y: number }[][]) {
    const w = video.clientWidth, h = video.clientHeight
    if (overlay.width !== w || overlay.height !== h) { overlay.width = w; overlay.height = h }
    const ctx = overlay.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = '#5ff0ff'
    for (const lm of list) {
      for (const p of lm) {
        ctx.beginPath()
        ctx.arc((1 - p.x) * w, p.y * h, 2.2, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }

  function camStop() {
    cancelAnimationFrame(raf)
    raf = 0
    try { landmarker?.close() } catch { /* noop */ }
    landmarker = null
    stream?.getTracks().forEach((t) => t.stop())
    stream = null
    video.srcObject = null
    link.sendHand(false, 0.5, 0.5, 0, 0)
  }

  camBtn.addEventListener('click', async () => {
    camOn = !camOn
    camBtn.classList.toggle('on', camOn)
    camBtn.textContent = camOn ? 'CAMERA ON' : 'CAMERA'
    camPanel.hidden = !camOn            // the whole camera UI vanishes when off
    link.sendCam(camOn)
    if (camOn) {
      const ok = await camStart()
      if (!ok) { camOn = false; camBtn.classList.remove('on'); camBtn.textContent = 'CAMERA'; camPanel.hidden = true; link.sendCam(false) }
    } else {
      camStop()
    }
  })

  window.addEventListener('pagehide', () => { if (camOn) camStop() })

  return () => {
    window.clearInterval(sendTimer)
    document.removeEventListener('visibilitychange', onVis)
    if (camOn) camStop()
    link.dispose()
  }
}
