// ---------------------------------------------------------------
// RemotePhone — the smartphone controller behind the /remote route.
//
// Scanned from the QR code (or opened directly), it:
//   1. opens the phone's FRONT camera (visible preview, mirrored)
//   2. tracks up to TWO hands with the same local MediaPipe model
//      the desktop uses — nothing leaves the phone except the
//      tiny landmark samples
//   3. streams both hands to /api/remote/hands at ~25 Hz
//
// Every ocean page (studio and /output, any machine on the LAN)
// picks the stream up over SSE and steers the fish in real time —
// a swimming stroke with both arms becomes two moving attractors.
// ---------------------------------------------------------------
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'
import { extractHandSample, mirrorLandmarks } from '../interaction/handMath'
import type { Landmark } from '../interaction/HandTracker'

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
  header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px 14px 8px;'
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

  const legend = document.createElement('div')
  legend.style.cssText = 'padding:8px 14px 10px;font-size:11px;line-height:1.6;color:#8fb9ca;text-align:center;'
  legend.innerHTML = 'open palm → attract · fist → caution · move both hands like swimming'

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

  root.append(header, stage, legend)
  container.appendChild(root)

  // insecure origin (plain http over LAN): the phone will block the camera
  const isLocalHost = /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname)
  if (!window.isSecureContext && !isLocalHost) {
    warn.style.display = 'block'
    warn.textContent =
      'This page is not HTTPS, so the phone will block the camera. ' +
      'Open it through the app\u2019s HTTPS link, or run the server with `npm run dev:https` and scan that QR.'
  }

  // ---------------- state ----------------
  const ctx = canvas.getContext('2d')!
  let landmarker: HandLandmarker | null = null
  let stream: MediaStream | null = null
  let running = false
  let disposed = false
  let lastVideoTime = -1
  let lastSend = 0
  let lastIdleSend = 0
  let seq = 0
  let failCount = 0
  let fpsCount = 0
  let fpsShown = 0
  let fpsAt = performance.now()
  let lastHands: Landmark[][] = []

  const setStatus = (text: string, color: string) => {
    statusText.textContent = text
    dot.style.background = color
    dot.style.boxShadow = `0 0 8px ${color}`
  }

  // ---------------- sending ----------------
  async function send(hands: {
    x: number; y: number; openness: number; scale: number
    lm: number[][]; label: string
  }[]) {
    const now = Date.now()
    try {
      const res = await fetch('/api/remote/hands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room: ROOM, seq: seq++, t: now, hands }),
      })
      if (res.ok) {
        failCount = 0
        if (running) setStatus(hands.length ? `LIVE · ${hands.length} HAND${hands.length === 1 ? '' : 'S'}${fpsShown ? ` · ${fpsShown} FPS` : ''}` : 'LIVE · SEARCHING', '#7bffb2')
      } else {
        throw new Error(`http ${res.status}`)
      }
    } catch {
      if (++failCount >= 3 && running) setStatus('OFFLINE — server unreachable', '#ff8f8f')
    }
  }

  function maybeSend(hands: ReturnType<typeof collectHands>, nowMs: number) {
    const empty = hands.length === 0
    const lastSent = lastSend
    if (empty) {
      if (nowMs - lastIdleSend < IDLE_SEND_MS) return
      lastIdleSend = nowMs
    } else if (nowMs - lastSent < SEND_INTERVAL_MS) {
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

  // ---------------- start / stop ----------------
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

  startBtn.addEventListener('click', () => { void start() })

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
