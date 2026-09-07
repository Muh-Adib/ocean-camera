// ---------------------------------------------------------------
// PhoneController — the smartphone remote (/control-mobile).
//
// Design goals (operator feedback round 2 — "control di hp sangat
// susah"):
//   • FLOATING STICKS, no aiming needed: the whole left half of the
//     screen is the MOVE pad, the whole right half is the ORBIT pad.
//     Touch ANYWHERE and the stick appears under your thumb — no
//     more hunting for a small circle.
//   • PINCH = DOLLY: two fingers on the stage zoom the view in/out,
//     like a map. The slider stays as a visible alternative.
//   • SPEED button (0.75× / 1.0× / 1.35×) so the gain suits the
//     room and the user.
//   • CAMERA mode runs the EXACT same hand-geometry math as the
//     desktop tracker (interaction/handMath) — palm centre, scale,
//     openness, mirroring are byte-identical, and BOTH hands are
//     streamed — so the wall's full gesture language (swipe, push,
//     pull, palm, fist, swim steering) works identically through
//     the same GestureEngine. No separate control module.
//   • Insecure page (http over LAN) → camera is blocked by the
//     browser itself; the UI now says so plainly and the sticks
//     keep working.
// ---------------------------------------------------------------
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'
import type { Landmark } from '../interaction/HandTracker'
import { extractHandSample, mirrorLandmarks } from '../interaction/handMath'
import { PhoneLink, cleanSessionId, type HandMetrics } from './RemoteLink'
import './remote.css'

const WASM_PATH = '/mediapipe/wasm'
const MODEL_PATH = '/mediapipe/models/hand_landmarker.task'
const SEND_HZ = 40
const DEAD = 0.06
const SPEED_STEPS = [0.75, 1, 1.35]

type Stick = { vx: number; vy: number }

export function mountPhoneController(root: HTMLElement): () => void {
  // the wall QR can deep-link a SHOW SESSION (?s=<id>) — this phone then
  // only steers screens of that session (exhibition isolation)
  const params = new URLSearchParams(window.location.search)
  const session = cleanSessionId(params.get('s'))
  const insecure = !window.isSecureContext

  root.innerHTML = `
    <div class="rm-app">
      <header class="rm-head">
        <div class="rm-brand">
          <span class="rm-dot" id="rm-dot"></span>
          <span class="rm-title">OCEAN REMOTE</span>
        </div>
        <div class="rm-head-actions">
          <button class="rm-speed-btn" id="rm-speed" type="button">SPEED 1.0×</button>
          <button class="rm-cam-btn" id="rm-cam-btn" type="button">CAMERA</button>
        </div>
      </header>

      <div class="rm-cam" id="rm-cam" hidden>
        <video id="rm-video" autoplay playsinline muted></video>
        <canvas id="rm-overlay"></canvas>
        <div class="rm-cam-status" id="rm-cam-status">starting camera…</div>
      </div>

      <div class="rm-stage" id="rm-stage">
        <div class="rm-zone" id="rm-zone-l">
          <div class="rm-stick" id="rm-stick-move">
            <div class="rm-ring"></div>
            <div class="rm-nub"></div>
          </div>
          <span class="rm-zone-label">MOVE · side / lift<br><em>touch anywhere here</em></span>
        </div>
        <div class="rm-zone" id="rm-zone-r">
          <div class="rm-stick" id="rm-stick-orbit">
            <div class="rm-ring"></div>
            <div class="rm-nub"></div>
          </div>
          <span class="rm-zone-label">ORBIT · turn / tilt<br><em>touch anywhere here</em></span>
        </div>
      </div>

      <div class="rm-foot">
        <div class="rm-dolly">
          <span class="rm-dolly-cap">＋</span>
          <div class="rm-dolly-track" id="rm-dolly">
            <div class="rm-dolly-nub"></div>
          </div>
          <span class="rm-dolly-cap">－</span>
        </div>
        <span class="rm-foot-label">DOLLY · or pinch with two fingers</span>
      </div>

      <div class="rm-note" id="rm-note">waiting for the ocean…</div>
    </div>`

  if (session !== 'main') {
    const tag = document.createElement('div')
    tag.className = 'rm-session-tag'
    tag.textContent = `SESSION · ${session.toUpperCase()}`
    root.querySelector('.rm-head-actions')?.appendChild(tag)
  }

  const $ = <T extends HTMLElement>(id: string) => root.querySelector('#' + id) as T
  const dot = $('rm-dot')
  const note = $('rm-note')
  const camBtn = $('rm-cam-btn')
  const camPanel = $('rm-cam')
  const video = $('rm-video') as HTMLVideoElement
  const overlay = $('rm-overlay') as HTMLCanvasElement
  const camStatus = $('rm-cam-status')
  const stage = $('rm-stage')
  const speedBtn = $('rm-speed')

  const link = new PhoneLink(session)
  /** screens of this session currently listening (from the hub) — lets the
   *  phone TELL the difference between "linked but nothing to steer" (screen
   *  tab closed / other session) and a working show, instead of looking
   *  like a mysterious connection failure */
  let screensInRoom = 0
  const updateNote = (live: boolean) => {
    dot.classList.toggle('on', live)
    if (!live) { note.textContent = 'reconnecting to the ocean…'; return }
    note.textContent = screensInRoom > 0
      ? 'connected — steer the ocean'
      : `no screen on session “${session}” yet — open the /output wall`
  }
  link.onState = (live) => {
    updateNote(live)
    if (live && camOn) link.sendCam(true)   // re-announce camera mode after a reconnect
  }
  link.onRoom = (n) => { screensInRoom = n; updateNote(link.live) }
  if (insecure) {
    note.textContent += ' · camera needs HTTPS (this page is http) — sticks still work'
  }

  // ------------------------------------------------------------ speed
  let speed = 1
  speedBtn.addEventListener('click', () => {
    const i = (SPEED_STEPS.indexOf(speed) + 1) % SPEED_STEPS.length
    speed = SPEED_STEPS[i]
    speedBtn.textContent = `SPEED ${speed.toFixed(2).replace(/0$/, '')}×`
    speedBtn.classList.toggle('fast', speed > 1)
  })

  // ------------------------------------------------------------ floating sticks
  const move: Stick = { vx: 0, vy: 0 }
  const orbit: Stick = { vx: 0, vy: 0 }
  let dolly = 0

  const ease = (v: number) => Math.sign(v) * Math.pow(Math.abs(v), 1.25)   // gentle center falloff
  const dz = (v: number) => (Math.abs(v) < DEAD ? 0 : (v - Math.sign(v) * DEAD) / (1 - DEAD))

  interface Zone {
    stick: HTMLElement
    nub: HTMLElement
    st: Stick
    ptr: number
    ox: number          // stick origin (touch point)
    oy: number
    home: () => void    // park the stick back at its rest position
  }
  const zones: Zone[] = []

  /** park the stick visually at the touch point (coordinates relative to the zone) */
  const floatStick = (z: Zone, x: number, y: number) => {
    const pr = (z.stick.parentElement as HTMLElement).getBoundingClientRect()
    const r = z.stick.getBoundingClientRect()
    z.stick.style.left = `${x - pr.left - r.width / 2}px`
    z.stick.style.top = `${y - pr.top - r.height / 2}px`
    z.stick.style.bottom = 'auto'
    z.stick.style.transform = 'none'
  }

  function setupZone(el: HTMLElement, stickId: string, st: Stick): Zone {
    const stick = $(stickId)
    const nub = stick.querySelector('.rm-nub') as HTMLElement
    const z: Zone = {
      stick, nub, st, ptr: -1, ox: 0, oy: 0,
      home: () => {
        stick.style.left = '50%'
        stick.style.top = ''
        stick.style.bottom = '18px'
        stick.style.transform = 'translateX(-50%)'
        nub.style.transform = 'translate(-50%, -50%)'
        stick.classList.remove('live')
      },
    }
    z.home()
    el.dataset.zone = zones.length === 0 ? 'l' : 'r'
    zones.push(z)
    return z
  }
  setupZone($('rm-zone-l'), 'rm-stick-move', move)
  setupZone($('rm-zone-r'), 'rm-stick-orbit', orbit)

  const zoneAt = (x: number): Zone => {
    const r = stage.getBoundingClientRect()
    return x - r.left < r.width / 2 ? zones[0] : zones[1]
  }
  /** stick visual radius — deflection scale for a zone's stick */
  const stickRadius = (z: Zone) => z.stick.getBoundingClientRect().width / 2 || 60

  const setStick = (z: Zone, e: PointerEvent) => {
    const rad = stickRadius(z)
    let dx = (e.clientX - z.ox) / rad
    let dy = (e.clientY - z.oy) / rad
    const len = Math.hypot(dx, dy)
    if (len > 1) { dx /= len; dy /= len }
    z.st.vx = ease(dz(dx))
    z.st.vy = ease(dz(dy))
    z.nub.style.transform = `translate(calc(-50% + ${dx * rad * 0.62}px), calc(-50% + ${dy * rad * 0.62}px))`
  }

  // ------------------------------------------------------------ stage gestures (sticks + pinch)
  const activePtrs = new Map<number, { x: number; y: number; zone: Zone | null }>()
  let pinchBase = 0

  const pinchDist = (): number => {
    const pts = [...activePtrs.values()]
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
  }

  const zeroSticks = () => {
    for (const z of zones) {
      z.st.vx = 0; z.st.vy = 0
      z.nub.style.transform = 'translate(-50%, -50%)'
    }
  }

  stage.addEventListener('pointerdown', (e) => {
    const zone = zoneAt(e.clientX)
    const already = activePtrs.get(e.pointerId)
    if (already) return
    activePtrs.set(e.pointerId, { x: e.clientX, y: e.clientY, zone })
    // capture keeps the gesture alive when the thumb leaves the stage;
    // synthetic pointers (automation / stale ids) have nothing to capture
    try { stage.setPointerCapture(e.pointerId) } catch { /* fine without it */ }
    if (activePtrs.size >= 2) {
      // two fingers → pinch mode: sticks yield, dolly takes over
      pinchBase = pinchDist()
      zeroSticks()
      for (const z of zones) z.stick.classList.remove('live')
      return
    }
    // stick appears under the thumb
    zone.ptr = e.pointerId
    zone.ox = e.clientX
    zone.oy = e.clientY
    floatStick(zone, e.clientX, e.clientY)
    zone.stick.classList.add('live')
    setStick(zone, e)
  })

  stage.addEventListener('pointermove', (e) => {
    const rec = activePtrs.get(e.pointerId)
    if (!rec) return
    rec.x = e.clientX
    rec.y = e.clientY
    if (activePtrs.size >= 2) {
      dolly = Math.max(-1, Math.min(1, (pinchDist() - pinchBase) / 160))
      dollyNub.style.bottom = `${50 + dolly * 42}%`
      return
    }
    if (rec.zone && e.pointerId === rec.zone.ptr) setStick(rec.zone, e)
  })

  const releasePtr = (e: PointerEvent) => {
    const rec = activePtrs.get(e.pointerId)
    if (!rec) return
    activePtrs.delete(e.pointerId)
    if (activePtrs.size >= 2) return
    if (activePtrs.size === 1) {
      // pinch ended — the surviving finger becomes a stick again
      dolly = 0
      dollyNub.style.bottom = '50%'
      const [rest] = activePtrs.values()
      const z = zoneAt(rest.x)
      rest.zone = z
      z.ptr = [...activePtrs.keys()][0]
      z.ox = rest.x
      z.oy = rest.y
      floatStick(z, rest.x, rest.y)
      z.stick.classList.add('live')
      setStick(z, { clientX: rest.x, clientY: rest.y } as PointerEvent)
      return
    }
    // everything released
    dolly = 0
    dollyNub.style.bottom = '50%'
    for (const z of zones) { z.ptr = -1; z.home() }
    void rec
  }
  stage.addEventListener('pointerup', releasePtr)
  stage.addEventListener('pointercancel', releasePtr)

  // ------------------------------------------------------------ dolly slider
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

  // ------------------------------------------------------------ 40 Hz send loop
  const sendTimer = window.setInterval(() => {
    if (!link.live) return
    link.sendCtl(
      move.vx * speed, -move.vy * speed,
      orbit.vx * speed, -orbit.vy * speed,
      dolly * speed,
    )
  }, Math.round(1000 / SEND_HZ))

  // tab hidden → drop everything so the screens stop immediately;
  // RETURNING from hidden → force an immediate reconnect when the socket
  // did not survive the sleep (mobile OSes silently kill idle sockets —
  // without this the phone sat "connected" but deaf for up to minutes),
  // and prove liveness right away with a heartbeat.
  let hiddenAt = 0
  const onVis = () => {
    if (document.hidden) {
      hiddenAt = Date.now()
      if (link.live) {
        link.sendCtl(0, 0, 0, 0, 0)
        if (camOn) link.sendHand(false, 0.5, 0.5, 0, 0)
      }
    } else {
      const awayFor = Date.now() - (hiddenAt || Date.now())
      if (awayFor > 15000 || !link.live) link.forceReconnect()
      else link.send({ t: 'hb' })
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
    if (!navigator.mediaDevices?.getUserMedia) {
      camStatus.textContent = insecure
        ? 'camera blocked — this page is http; open it via https:// (or localhost). Sticks still work.'
        : 'camera API unavailable in this browser — sticks still work.'
      return false
    }
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
    if (video.currentTime !== lastVideoTime && landmarker) {
      lastVideoTime = video.currentTime
      try {
        const res = landmarker.detectForVideo(video, now)
        const list = res?.landmarks ?? []
        const samples = (list as Landmark[][])
          .filter((lm) => lm && lm.length >= 21)
          .map((lm) => extractHandSample(mirrorLandmarks(lm as Landmark[]), now))
        drawOverlay(list as { x: number; y: number }[][])
        if (samples.length > 0) {
          const s0 = samples[0]
          const s1 = samples[1]
          const second: HandMetrics | undefined = s1
            ? { x: s1.x, y: s1.y, o: s1.openness, s: s1.scale }
            : undefined
          // same geometry as the desktop tracker — the wall's GestureEngine
          // cannot tell a phone hand from a hand in front of the laptop
          link.sendHand(true, s0.x, s0.y, s0.openness, samples.length, s0.scale, second)
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
      if (!Array.isArray(lm)) continue
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
