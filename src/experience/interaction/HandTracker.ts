// ---------------------------------------------------------------
// HandTracker — MediaPipe Hands (tasks-vision), running 100%
// locally in the browser. The JS is bundled from npm, the WASM
// backend and the hand model are served from /public/mediapipe.
// No CDN is involved → tracking also works offline and behind
// strict networks/firewalls that previously broke camera start.
//
// No video ever leaves the device; the feed is never rendered.
//
// Emits per-frame hand samples: mirrored palm position (0..1),
// openness (0 fist → 1 open), scale (distance proxy for push/pull).
// ---------------------------------------------------------------
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'
import { clamp, damp } from '../utils/math'

export interface HandSample {
  present: boolean
  x: number              // mirrored, 0..1 (screen space)
  y: number              // 0..1 top-down
  openness: number       // 0..1
  scale: number          // palm size in normalized units
  t: number
}

export type Landmark = { x: number; y: number; z: number }

/** local assets served by Next from /public — zero CDN dependency */
const WASM_PATH = '/mediapipe/wasm'
const MODEL_PATH = '/mediapipe/models/hand_landmarker.task'

export type CameraFailure =
  | 'insecure'    // no getUserMedia (http / unsupported browser)
  | 'iframe'      // embedded without camera permissions-policy → blocked
  | 'permission'  // user or browser denied the prompt
  | 'no-device'   // no camera hardware found
  | 'busy'        // camera held by another app / failed to start
  | 'model'       // hand-tracking model could not be fetched
  | 'lost'        // camera vanished mid-session (unplugged / revoked / crashed)
  | 'unknown'

/** reject a promise if it neither resolves nor rejects within `ms` */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout: ${label}`)), ms)
    p.then(
      (v) => { clearTimeout(timer); resolve(v) },
      (e) => { clearTimeout(timer); reject(e) },
    )
  })
}

export class HandTracker {
  video: HTMLVideoElement | null = null
  lastFailure: CameraFailure | null = null
  private landmarker: any = null
  private stream: MediaStream | null = null
  private inflight: Promise<boolean> | null = null
  private lastVideoTime = -1
  private running = false
  private lastSample: HandSample = { present: false, x: 0.5, y: 0.5, openness: 0.5, scale: 0.15, t: 0 }
  private smoothed: HandSample = { present: false, x: 0.5, y: 0.5, openness: 0.5, scale: 0.15, t: 0 }
  /** latest raw landmarks (mirrored to match sample.x) — feeds the gesture view overlay */
  lastLandmarks: Landmark[] | null = null
  onStatus?: (status: 'loading' | 'ready' | 'denied' | 'error' | 'stopped') => void
  onFailure?: (reason: CameraFailure) => void

  get isRunning() { return this.running }

  /** true when this page is displayed inside an iframe (previews, embeds) */
  static get embedded(): boolean {
    try { return window.self !== window.top } catch { return true }
  }

  private fail(reason: CameraFailure): false {
    this.lastFailure = reason
    this.stop()
    this.onStatus?.(reason === 'permission' || reason === 'iframe' ? 'denied' : 'error')
    this.onFailure?.(reason)
    return false
  }

  async start(): Promise<boolean> {
    if (this.running) return true
    // a start is already underway (double-click, intro + HUD button) → share it
    if (this.inflight) return this.inflight
    this.lastFailure = null
    this.onStatus?.('loading')
    this.inflight = this.startInner().finally(() => { this.inflight = null })
    return this.inflight
  }

  private async startInner(): Promise<boolean> {

    // 0) capability checks — friendly reasons, never raw errors
    if (!navigator.mediaDevices?.getUserMedia) {
      return this.fail('insecure')
    }

    // 1) camera (constrained, front facing; relaxed retry)
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
        audio: false,
      })
    } catch (err: any) {
      const name = String(err?.name ?? '')
      // OverconstrainedError / devices without facingMode → plain request
      if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') {
        try {
          this.stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
        } catch (err2: any) {
          return this.fail(classify(String(err2?.name ?? '')))
        }
      } else {
        return this.fail(classify(name))
      }
    }

    // 2) feed the (hidden) video element, waiting for real frames
    const video = document.createElement('video')
    video.autoplay = true
    video.playsInline = true
    video.muted = true
    video.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0.01;pointer-events:none;z-index:-1;'
    video.srcObject = this.stream
    document.body.appendChild(video)
    try {
      await Promise.race([
        video.play(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('video-timeout')), 4000)),
      ])
    } catch {
      this.video = video
      return this.fail('busy')
    }
    this.video = video

    // mid-session loss: camera unplugged / permission revoked / driver crash
    const track = this.stream.getVideoTracks()[0]
    track?.addEventListener('ended', () => {
      if (this.running) this.fail('lost')
    })

    // 3) MediaPipe — fully local (bundled JS + /public WASM & model)
    //    GPU → CPU fallback; every step is time-boxed so the button
    //    can never spin forever
    try {
      const fileset = await withTimeout(FilesetResolver.forVisionTasks(WASM_PATH), 12000, 'wasm fileset')
      try {
        this.landmarker = await withTimeout(HandLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_PATH, delegate: 'GPU' },
          runningMode: 'VIDEO',
          numHands: 1,
        }), 20000, 'gpu landmarker')
      } catch {
        // some devices/drivers reject the GPU delegate — CPU still runs fine
        this.landmarker = await withTimeout(HandLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_PATH, delegate: 'CPU' },
          runningMode: 'VIDEO',
          numHands: 1,
        }), 20000, 'cpu landmarker')
      }
    } catch {
      return this.fail('model')
    }

    this.running = true
    this.onStatus?.('ready')
    return true
  }

  stop() {
    this.running = false
    try { this.landmarker?.close?.() } catch { /* partially-built landmarker may refuse close */ }
    this.landmarker = null
    this.video?.remove()
    this.video = null
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    this.lastSample.present = false
    this.smoothed.present = false
    this.lastLandmarks = null
  }

  /** call once per animation frame; returns smoothed sample */
  detect(dt: number): HandSample {
    if (!this.running || !this.landmarker || !this.video || this.video.readyState < 2) {
      this.smoothed.present = false
      return this.smoothed
    }
    const now = performance.now()
    if (this.video.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = this.video.currentTime
      try {
        const res = this.landmarker.detectForVideo(this.video, now)
        const lm: Landmark[] | undefined = res?.landmarks?.[0]
        if (lm && lm.length >= 21) {
          const s = this.extract(lm, now)
          this.lastSample = s
          this.lastLandmarks = lm.map((p) => ({ x: 1 - p.x, y: p.y, z: p.z }))
        } else {
          this.lastSample.present = false
          this.lastLandmarks = null
        }
      } catch {
        this.lastSample.present = false
        this.lastLandmarks = null
      }
    }

    // exponential smoothing (organic, no jitter)
    const k = damp(14, Math.max(dt, 0.001))
    const s = this.lastSample
    const m = this.smoothed
    if (s.present) {
      if (!m.present) { m.x = s.x; m.y = s.y; m.scale = s.scale; m.openness = s.openness }
      m.present = true
      m.x += (s.x - m.x) * k
      m.y += (s.y - m.y) * k
      m.scale += (s.scale - m.scale) * damp(8, dt)
      m.openness += (s.openness - m.openness) * damp(9, dt)
      m.t = s.t
    } else {
      m.present = false
    }
    return m
  }

  private extract(lm: Landmark[], now: number): HandSample {
    // palm centre = wrist + finger MCP joints
    const ids = [0, 5, 9, 13, 17]
    let px = 0, py = 0
    for (const i of ids) { px += lm[i].x; py += lm[i].y }
    px /= ids.length; py /= ids.length

    // hand scale = wrist → middle-MCP distance (push/pull proxy)
    const dx = lm[9].x - lm[0].x
    const dy = lm[9].y - lm[0].y
    const scale = Math.hypot(dx, dy) || 0.001

    // openness = mean fingertip distance from wrist ÷ hand scale
    const tips = [8, 12, 16, 20]
    let sum = 0
    for (const i of tips) {
      sum += Math.hypot(lm[i].x - lm[0].x, lm[i].y - lm[0].y)
    }
    const openness = clamp((sum / tips.length / scale - 1.35) / 1.25, 0, 1)

    return {
      present: true,
      x: 1 - px,          // mirror for natural selfie-space control
      y: py,
      openness,
      scale,
      t: now,
    }
  }
}

// error name → friendly failure reason
function classify(name: string): CameraFailure {
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      // inside an iframe without allow="camera" the browser blocks silently
      return HandTracker.embedded ? 'iframe' : 'permission'
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'no-device'
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return 'busy'
    default:
      return 'unknown'
  }
}
