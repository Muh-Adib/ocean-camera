// ---------------------------------------------------------------
// RemotePhone — the smartphone controller behind the /remote route.
//
// Scanned from the QR code (or opened directly), it offers THREE
// controller modes behind a segmented switch:
//
//   CAMERA — the phone's FRONT camera (visible preview, mirrored)
//   tracks up to TWO hands with the same local MediaPipe model the
//   desktop uses; both hands stream to /api/remote/hands at ~25 Hz.
//
//   BUTTONS — a touch pad: action grid (feed/burst/shark/turtle/
//   ray/pulse), SWIM & SOUND toggles with real studio-state badges,
//   hold-to-BOOST, and a joystick that steers the current by
//   streaming a synthesized open-palm hand through the same hands
//   pipeline — see RemotePhonePad.
//
//   VIEW — the camera-chain remote: drag to orbit the whole output
//   camera rig as ONE motion around the center camera, snap across
//   the 270° linked sweep, dolly, auto-orbit or reset — see
//   RemotePhoneView. What moves is the camera/surface chain the
//   projector is showing; span-locked walls stay perfectly joined.
//
// Every ocean page (studio and /output, any machine on the LAN)
// picks all three channels up over SSE and reacts in real time.
// ---------------------------------------------------------------
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'
import { extractHandSample, mirrorLandmarks } from '../interaction/handMath'
import type { Landmark } from '../interaction/HandTracker'
import type { RemoteCmdType } from './RemoteCmds'
import { buildPadStage, type PadHandle, type PadHandFrame } from './RemotePhonePad'
import { buildViewStage, type ViewHandle, type ViewPayload } from './RemotePhoneView'

const ROOM = new URLSearchParams(window.location.search).get('room') || 'ocean'
const WASM_PATH = '/mediapipe/wasm'
const MODEL_PATH = '/mediapipe/models/hand_landmarker.task'
const SEND_INTERVAL_MS = 40       // ≈25 fps upstream
const IDLE_SEND_MS = 400          // keepalive when no hands are visible

const BONES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
]
const HAND_COLORS = ['#6ee7ff', '#ffd670']

export interface RemotePhoneHandle {
  dispose: () => void
}

export function bootRemotePhone(container: HTMLElement): RemotePhoneHandle {
  // ---------------- DOM ----------------
  container.innerHTML = ''
  const root = document.createElement('div')
  root.style.cssText = [
    'position:fixed', 'inset:0', 'display:flex', 'flex-direction:column',
    'background:radial-gradient(120% 90% at 50% 0%, #07344f 0%, #032036 55%, #02101d 100%)',
    'color:#dff3fb', 'font-family:system-ui,-apple-system,sans-serif',
    'user-select:none', '-webkit-user-select:none', 'overscroll-behavior:none',
    'touch-action:manipulation',
  ].join(';')

  const header = document.createElement('div')
  header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 14px 6px;'
  const title = document.createElement('div')
  title.innerHTML = '<span style="font-size:13px;font-weight:700;letter-spacing:0.14em;">LIVING OCEAN</span>' +
    '<span style="font-size:11px;color:#7fd4ee;letter-spacing:0.1em;"> · REMOTE</span>'
  const statusChip = document.createElement('div')
  statusChip.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:11px;letter-spacing:0.06em;color:#9fc9da;'
  const dot = document.createElement('span')
  dot.style.cssText = 'width:8px;height:8px;border-radius:50%;background:#5b7c8d;flex:none;'
  const statusText = document.createElement('span')
  statusText.textContent = 'IDLE'
  statusChip.append(dot, statusText)
  header.append(title, statusChip)

  // ---- mode switch (CAMERA / BUTTONS) ----
  const tabs = document.createElement('div')
  tabs.setAttribute('role', 'tablist')
  tabs.style.cssText = [
    'display:flex', 'gap:4px', 'margin:2px 14px 8px', 'padding:4px', 'flex:none',
    'border-radius:999px', 'background:rgba(2,16,28,0.75)',
    'border:1px solid rgba(110,231,255,0.22)',
  ].join(';')
  const mkTab = (label: string) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.setAttribute('role', 'tab')
    b.textContent = label
    b.style.cssText = [
      'flex:1', 'appearance:none', 'border:none', 'border-radius:999px',
      'padding:9px 0', 'font-size:11.5px', 'font-weight:700', 'letter-spacing:0.16em',
      'color:#8fb9ca', 'background:transparent', 'cursor:pointer', 'min-height:38px',
      'transition:background 0.15s ease, color 0.15s ease',
    ].join(';')
    return b
  }
  const camTab = mkTab('CAMERA')
  const padTab = mkTab('BUTTONS')
  const viewTab = mkTab('VIEW')
  tabs.append(camTab, padTab, viewTab)

  const tabBase = [
    'flex:1', 'appearance:none', 'border:none', 'border-radius:999px',
    'padding:9px 0', 'font-size:11.5px', 'font-weight:700', 'letter-spacing:0.16em',
    'cursor:pointer', 'min-height:38px', 'min-width:0',
    'transition:background 0.15s ease, color 0.15s ease',
  ]
  const paintTabs = (mode: 'cam' | 'pad' | 'view') => {
    const active = ['background:linear-gradient(135deg,#8fe6ff,#5ec8ea)', 'color:#04222f', 'box-shadow:0 4px 14px rgba(94,200,234,0.35)']
    const idle = ['background:transparent', 'color:#8fb9ca', 'box-shadow:none']
    camTab.style.cssText = [...tabBase, ...(mode === 'cam' ? active : idle)].join(';')
    padTab.style.cssText = [...tabBase, ...(mode === 'pad' ? active : idle)].join(';')
    viewTab.style.cssText = [...tabBase, ...(mode === 'view' ? active : idle)].join(';')
  }

  // ---- CAMERA stage (unchanged visuals) ----
  const stage = document.createElement('div')
  stage.style.cssText = 'position:relative;flex:1;overflow:hidden;background:rgba(1,12,22,0.6);'
  const video = document.createElement('video')
  video.autoplay = true
  video.muted = true
  video.playsInline = true
  video.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transform:scaleX(-1);opacity:0;'
  const canvas = document.createElement('canvas')
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;'
  stage.append(video, canvas)

  const startCard = document.createElement('div')
  startCard.style.cssText = 'position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:24px;text-align:center;background:rgba(2,16,28,0.55);backdrop-filter:blur(4px);'
  const startTitle = document.createElement('div')
  startTitle.style.cssText = 'font-size:17px;font-weight:600;'
  startTitle.textContent = 'Become the current'
  const startHint = document.createElement('p')
  startHint.style.cssText = 'margin:0;font-size:12.5px;line-height:1.65;color:#a9d3e3;max-width:300px;'
  startHint.textContent =
    'Your phone becomes the gesture controller: BOTH hands are tracked and the fish follow them on the big screen, in real time.'
  const startBtn = document.createElement('button')
  startBtn.type = 'button'
  startBtn.textContent = 'START CAMERA'
  startBtn.style.cssText = [
    'appearance:none', 'border:1px solid rgba(110,231,255,0.45)', 'border-radius:999px',
    'padding:14px 34px', 'font-size:13px', 'font-weight:700', 'letter-spacing:0.18em',
    'color:#04222f', 'background:linear-gradient(135deg,#8fe6ff,#5ec8ea)',
    'box-shadow:0 10px 30px rgba(94,200,234,0.35)', 'cursor:pointer', 'min-height:44px',
  ].join(';')
  const privacy = document.createElement('p')
  privacy.style.cssText = 'margin:0;font-size:10.5px;color:#6f9aad;max-width:300px;'
  privacy.textContent = 'Frames are processed on this phone and never uploaded — only 21 landmark points per hand are sent.'
  const warn = document.createElement('p')
  warn.style.cssText = 'display:none;margin:0;font-size:11.5px;line-height:1.55;padding:10px 12px;border-radius:10px;background:rgba(255,190,90,0.12);border:1px solid rgba(255,190,90,0.4);color:#ffd670;max-width:320px;'
  startCard.append(startTitle, startHint, startBtn, privacy, warn)
  stage.appendChild(startCard)

  // ---- BUTTONS stage ----
  const legend = document.createElement('div')
  legend.style.cssText = 'padding:8px 14px 10px;font-size:11px;line-height:1.6;color:#8fb9ca;text-align:center;flex:none;'
  legend.innerHTML = 'open palm → attract · fist → caution · move both hands like swimming'

  root.append(header, tabs, stage, legend)
  container.appendChild(root)

  const setStatus = (text: string, color: string) => {
    statusText.textContent = text
    dot.style.background = color
    dot.style.boxShadow = `0 0 8px ${color}`
  }
  const buzz = (ms = 12) => { try { navigator.vibrate?.(ms) } catch { /* no haptics */ } }

  // ---------------- shared network helpers ----------------
  let seq = 0
  async function postHands(hands: PadHandFrame[]): Promise<boolean> {
    try {
      const res = await fetch('/api/remote/hands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room: ROOM, seq: seq++, t: Date.now(), hands }),
      })
      return res.ok
    } catch {
      return false
    }
  }

  async function sendCmd(type: RemoteCmdType, on?: boolean, view?: ViewPayload): Promise<boolean> {
    try {
      const res = await fetch('/api/remote/cmd', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room: ROOM, cmd: { type, ...(on === undefined ? {} : { on }), ...(view ? { view } : {}) } }),
      })
      return res.ok
    } catch {
      return false
    }
  }

  // ---------------- BUTTONS pad ----------------
  let padStatusRevert = 0
  const markSent = (text: string, color: string) => {
    setStatus(text, color)
    if (padStatusRevert) { clearTimeout(padStatusRevert); padStatusRevert = 0 }
    if (text.startsWith('SENT')) {
      padStatusRevert = window.setTimeout(() => setStatus('PAD READY', '#7fd4ee'), 900)
    }
  }
  const pad = buildPadStage({
    room: ROOM,
    sendCmd,
    postHands,
    setStatus: markSent,
    buzz,
  })
  stage.appendChild(pad.root)

  // ---------------- VIEW pad (camera-chain remote) ----------------
  const view = buildViewStage({
    room: ROOM,
    sendView: (v) => sendCmd('view', undefined, v),
    setStatus: markSent,
    buzz,
  })
  stage.appendChild(view.root)

  // ---------------- state ----------------
  const ctx = canvas.getContext('2d')!
  let landmarker: HandLandmarker | null = null
  let stream: MediaStream | null = null
  let running = false
  let disposed = false
  let mode: 'cam' | 'pad' | 'view' = 'cam'
  let lastVideoTime = -1
  let lastSend = 0
  let lastIdleSend = 0
  let failCount = 0
  let fpsCount = 0
  let fpsShown = 0
  let fpsAt = performance.now()
  let lastHands: Landmark[][] = []

  // insecure origin (plain http over LAN): the phone will block the camera
  const isLocalHost = /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname)
  if (!window.isSecureContext && !isLocalHost) {
    warn.style.display = 'block'
    warn.textContent =
      'This page is not HTTPS, so the phone will block the camera. ' +
      'Open it through the app\u2019s HTTPS link, or run the server with `npm run dev:https` and scan that QR. ' +
      'The BUTTONS pad works on plain http too.'
  }

  // ---------------- camera sending ----------------
  async function send(hands: {
    x: number; y: number; openness: number; scale: number
    lm: number[][]; label: string
  }[]) {
    const ok = await postHands(hands)
    if (ok) {
      failCount = 0
      if (running) setStatus(hands.length ? `LIVE · ${hands.length} HAND${hands.length === 1 ? '' : 'S'}${fpsShown ? ` · ${fpsShown} FPS` : ''}` : 'LIVE · SEARCHING', '#7bffb2')
    } else if (++failCount >= 3 && running) {
      setStatus('OFFLINE — server unreachable', '#ff8f8f')
    }
  }

  function maybeSend(hands: ReturnType<typeof collectHands>, nowMs: number) {
    const empty = hands.length === 0
    if (empty) {
      if (nowMs - lastIdleSend < IDLE_SEND_MS) return
      lastIdleSend = nowMs
    } else if (nowMs - lastSend < SEND_INTERVAL_MS) {
      return
    }
    lastSend = nowMs
    void send(hands)
  }

  function collectHands(): {
    x: number; y: number; openness: number; scale: number
    lm: number[][]; label: string
  }[] {
    return lastHands.map((lm, i) => {
      const s = extractHandSample(lm, performance.now())
      return {
        x: round(s.x), y: round(s.y),
        openness: round(s.openness), scale: round(s.scale, 4),
        lm: lm.map((p) => [round(p.x), round(p.y), round(p.z)]),
        label: i === 0 ? 'primary' : 'second',
      }
    })
  }

  const round = (v: number, digits = 4) => {
    const f = 10 ** digits
    return Math.round(v * f) / f
  }

  // ---------------- overlay drawing ----------------
  function drawOverlay() {
    const w = canvas.width = stage.clientWidth * Math.min(2, window.devicePixelRatio || 1)
    const h = canvas.height = stage.clientHeight * Math.min(2, window.devicePixelRatio || 1)
    ctx.clearRect(0, 0, w, h)
    for (let i = 0; i < lastHands.length && i < 2; i++) {
      const lm = lastHands[i]
      const color = HAND_COLORS[i]
      ctx.lineWidth = Math.max(2, w / 220)
      ctx.strokeStyle = color
      ctx.globalAlpha = 0.9
      for (const [a, b] of BONES) {
        ctx.beginPath()
        ctx.moveTo(lm[a].x * w, lm[a].y * h)
        ctx.lineTo(lm[b].x * w, lm[b].y * h)
        ctx.stroke()
      }
      ctx.globalAlpha = 1
      for (let j = 0; j < lm.length; j++) {
        const tip = j === 4 || j === 8 || j === 12 || j === 16 || j === 20
        ctx.fillStyle = tip ? '#ffffff' : color
        ctx.beginPath()
        ctx.arc(lm[j].x * w, lm[j].y * h, tip ? w / 130 : w / 190, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }

  // ---------------- detection loop ----------------
  function loop() {
    if (disposed || !running) return
    requestAnimationFrame(loop)
    if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime
      try {
        const res = landmarker?.detectForVideo(video, performance.now())
        const lms: Landmark[][] = []
        for (const raw of res?.landmarks ?? []) {
          if (raw && raw.length >= 21) lms.push(mirrorLandmarks(raw as Landmark[]))
        }
        lastHands = lms
        fpsCount++
      } catch { /* keep last frame */ }
    }
    drawOverlay()

    const now = performance.now()
    if (now - fpsAt >= 1000) {
      fpsShown = Math.round((fpsCount * 1000) / (now - fpsAt))
      fpsCount = 0
      fpsAt = now
    }
    maybeSend(collectHands(), now)
  }

  // ---------------- start / stop camera ----------------
  async function start() {
    startBtn.disabled = true
    startBtn.textContent = 'STARTING…'
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      })
      video.srcObject = stream
      await video.play()
      const fileset = await FilesetResolver.forVisionTasks(WASM_PATH)
      try {
        landmarker = await HandLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_PATH, delegate: 'GPU' },
          runningMode: 'VIDEO',
          numHands: 2,
        })
      } catch {
        landmarker = await HandLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_PATH, delegate: 'CPU' },
          runningMode: 'VIDEO',
          numHands: 2,
        })
      }
      running = true
      video.style.opacity = '1'
      startCard.style.display = 'none'
      setStatus('CONNECTING…', '#ffd670')
      loop()
    } catch (err) {
      startBtn.disabled = false
      startBtn.textContent = 'TRY AGAIN'
      const name = (err as Error)?.name ?? ''
      warn.style.display = 'block'
      warn.textContent = name === 'NotAllowedError'
        ? 'Camera permission was denied — allow it in the browser settings and try again.'
        : `Camera could not start (${name || 'unknown error'}). Close other apps using the camera and try again.`
    }
  }

  function stopCamera() {
    running = false
    lastHands = []
    try { landmarker?.close?.() } catch { /* partial landmarker may refuse */ }
    landmarker = null
    stream?.getTracks().forEach((t) => t.stop())
    stream = null
    video.srcObject = null
    video.style.opacity = '0'
    startBtn.disabled = false
    startBtn.textContent = 'START CAMERA'
    startCard.style.display = 'flex'
  }

  startBtn.addEventListener('click', () => { void start() })

  // ---------------- mode switching ----------------
  function setMode(next: 'cam' | 'pad' | 'view') {
    if (mode === next || disposed) return
    mode = next
    if (next !== 'cam') {
      // release the camera entirely — pads must not burn battery
      if (running) { stopCamera(); void postHands([]) }
    }
    if (next === 'pad') {
      view.stop()
      setStatus('PAD READY', '#7fd4ee')
      stage.style.background = 'transparent'
      legend.innerHTML = 'stick steers the fish · buttons fire the show · flick = current'
      pad.start()
    } else if (next === 'view') {
      pad.stop()
      setStatus('VIEW PAD READY', '#7fd4ee')
      stage.style.background = 'transparent'
      legend.innerHTML = 'one motion — every output camera follows · pivot = center camera · 270° linked sweep'
      view.start()
    } else {
      pad.stop()
      view.stop()
      stage.style.background = 'rgba(1,12,22,0.6)'
      legend.innerHTML = 'open palm → attract · fist → caution · move both hands like swimming'
      setStatus('IDLE', '#5b7c8d')
    }
    // stage children: video, canvas, startCard, pad.root, view.root — toggle pads only
    pad.root.style.display = next === 'pad' ? 'flex' : 'none'
    view.root.style.display = next === 'view' ? 'flex' : 'none'
    startCard.style.display = next === 'cam' ? (running ? 'none' : 'flex') : 'none'
    canvas.style.display = next === 'cam' ? 'block' : 'none'
    video.style.display = next === 'cam' ? 'block' : 'none'
    paintTabs(next)
  }
  camTab.addEventListener('click', () => { buzz(8); setMode('cam') })
  padTab.addEventListener('click', () => { buzz(8); setMode('pad') })
  viewTab.addEventListener('click', () => { buzz(8); setMode('view') })
  paintTabs('cam')

  // final "hands gone" beat so the fish calm down the moment the tab closes
  const onPageHide = () => {
    try {
      navigator.sendBeacon?.(
        '/api/remote/hands',
        new Blob([JSON.stringify({ room: ROOM, seq: seq++, hands: [] })], { type: 'application/json' }),
      )
    } catch { /* best effort */ }
  }
  window.addEventListener('pagehide', onPageHide)

  return {
    dispose() {
      disposed = true
      running = false
      pad.stop()
      view.stop()
      window.removeEventListener('pagehide', onPageHide)
      try { landmarker?.close?.() } catch { /* partial landmarker may refuse */ }
      landmarker = null
      stream?.getTracks().forEach((t) => t.stop())
      stream = null
      video.srcObject = null
      root.remove()
    },
  }
}
