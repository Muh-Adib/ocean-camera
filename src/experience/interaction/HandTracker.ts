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
import { damp } from '../utils/math'
import { extractHandSample, mirrorLandmarks } from './handMath'
export { extractHandSample, mirrorLandmarks } from './handMath'

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
/** TWO hands: the ocean follows both (swim strokes, two-palm steering) */
const NUM_HANDS = 2

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

  // ---- multi-hand (numHands = 2) ----
  /** every hand seen in the newest video frame (up to 2, unsmoothed) */
  private rawHands: HandSample[] = []
  private rawLandmarks: Landmark[][] = []
  /** smoothed per-slot samples — slot i follows the detected hand closest to its previous position */
  private slotSamples: HandSample[] = []
  private slotLandmarks: Landmark[][] = []
  /** latest per-frame raw landmarks per hand (mirrored) for overlays */
  lastLandmarksList: Landmark[][] = []
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
          numHands: NUM_HANDS,
        }), 20000, 'gpu landmarker')
      } catch {
        // some devices/drivers reject the GPU delegate — CPU still runs fine
        this.landmarker = await withTimeout(HandLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_PATH, delegate: 'CPU' },
          runningMode: 'VIDEO',
          numHands: NUM_HANDS,
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
    this.rawHands = []
    this.rawLandmarks = []
    this.slotSamples = []
    this.slotLandmarks = []
    this.lastLandmarksList = []
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
        const list: Landmark[][] = []
        for (const lm of res?.landmarks ?? []) {
          if (lm && lm.length >= 21) list.push(mirrorLandmarks(lm as Landmark[]))
        }
        this.rawLandmarks = list
        this.rawHands = list.map((lm) => extractHandSample(lm, now))
        this.lastLandmarksList = list
        this.lastLandmarks = list[0] ?? null
        this.matchSlots(now)
        // primary sample = slot 0 (stable identity, not detection order)
        this.lastSample = this.slotSamples[0] ?? { present: false, x: 0.5, y: 0.5, openness: 0.5, scale: 0.15, t: now }
      } catch {
        this.lastSample.present = false
        this.lastLandmarks = null
        this.lastLandmarksList = []
        this.rawHands = []
        this.rawLandmarks = []
      }
    }

    // exponential smoothing (organic, no jitter) — primary slot
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

    // per-slot smoothing for the multi-hand pipeline
    for (let i = 0; i < this.slotSamples.length; i++) {
      const raw = this.rawHands[i]
      const slot = this.slotSamples[i]
      if (raw) {
        if (!slot.present) { slot.x = raw.x; slot.y = raw.y; slot.scale = raw.scale; slot.openness = raw.openness }
        slot.present = true
        slot.x += (raw.x - slot.x) * k
        slot.y += (raw.y - slot.y) * k
        slot.scale += (raw.scale - slot.scale) * damp(8, dt)
        slot.openness += (raw.openness - slot.openness) * damp(9, dt)
        slot.t = raw.t
      } else {
        slot.present = false
      }
    }
    return m
  }

  /**
   * Assign detected hands to stable slots: each detected hand joins the
   * slot whose previous position it is closest to (greedy 1–2 matching).
   * Keeps slot 0 = "the hand that was already being followed", so a
   * second hand entering the frame never steals the primary channel.
   */
  private matchSlots(now: number) {
    const MAX_AGE_MS = 450
    const prev0 = this.slotSamples[0]?.present && (now - (this.slotSamples[0]?.t ?? 0)) < MAX_AGE_MS ? this.slotSamples[0] : null
    const prev1 = this.slotSamples[1]?.present && (now - (this.slotSamples[1]?.t ?? 0)) < MAX_AGE_MS ? this.slotSamples[1] : null

    let a = 0, b = 1   // default assignment: raw[0]→slot0, raw[1]→slot1
    if (this.rawHands.length === 2 && prev0 && prev1) {
      // choose the assignment with the smaller total travel
      const direct = Math.hypot(this.rawHands[0].x - prev0.x, this.rawHands[0].y - prev0.y)
        + Math.hypot(this.rawHands[1].x - prev1.x, this.rawHands[1].y - prev1.y)
      const swapped = Math.hypot(this.rawHands[1].x - prev0.x, this.rawHands[1].y - prev0.y)
        + Math.hypot(this.rawHands[0].x - prev1.x, this.rawHands[0].y - prev1.y)
      if (swapped < direct) { a = 1; b = 0 }
    }

    const hands: HandSample[] = []
    const lms: Landmark[][] = []
    const idx = [a, b]
    for (let slot = 0; slot < 2; slot++) {
      const src = idx[slot]
      if (src < this.rawHands.length) {
        hands[slot] = this.rawHands[src]
        lms[slot] = this.rawLandmarks[src]
      }
    }
    this.slotSamples = [0, 1].map((i) => hands[i] ?? { present: false, x: 0.5, y: 0.5, openness: 0.5, scale: 0.15, t: now })
    this.slotLandmarks = [0, 1].map((i) => lms[i] ?? [])
  }

  /**
   * All tracked hands this frame, smoothed, in stable slots
   * (slot 0 = primary hand). Empty when none are visible.
   */
  hands(): HandSample[] {
    return this.slotSamples.filter((s) => s.present)
  }

  /** mirrored landmarks per slot — index-aligned with slotSamples (empty array when that hand is gone) */
  landmarksList(): Landmark[][] {
    return this.slotLandmarks
      .map((lm, i) => (this.slotSamples[i]?.present ? lm : []))
      .filter((lm) => lm.length > 0)
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
