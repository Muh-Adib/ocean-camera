// ---------------------------------------------------------------
// RemoteHands — client side of the phone controller link.
//
// Keeps one EventSource open to /api/remote/hands/stream and
// exposes the newest tracked hands as plain HandSamples, so the
// ocean's gesture pipeline treats a phone in someone's hand
// EXACTLY like a hand in front of the local camera.
//
// Freshness: a snapshot older than STALE_MS marks the link stale
// (phone closed, wifi drop…) — main.ts then falls back to local
// tracking automatically.
// ---------------------------------------------------------------
import type { HandSample, Landmark } from '../interaction/HandTracker'
import type { RemoteHandFrame } from './RemoteSocket'

export type RemoteHandsStatus = 'off' | 'connecting' | 'live' | 'stale'

const STALE_MS = 1300

export class RemoteHands {
  status: RemoteHandsStatus = 'off'
  /** newest remote hands (mirrored, same space as the desktop tracker) */
  hands: HandSample[] = []
  /** newest mirrored landmarks per hand (aligned with hands) */
  landmarks: Landmark[][] = []
  /** epoch ms of the newest applied frame */
  lastAt = 0
  room: string
  onStatus?: (s: RemoteHandsStatus) => void

  private es: EventSource | null = null
  /** last applied sender seq (QA diagnostics) */
  seq = -1
  private watchdog = 0

  constructor(room?: string) {
    this.room = room
      ?? new URLSearchParams(window.location.search).get('remoteRoom')
      ?? 'ocean'
  }

  get isFresh(): boolean {
    return this.lastAt > 0 && Date.now() - this.lastAt < STALE_MS
  }

  start() {
    if (this.es) return
    this.setStatus('connecting')
    const es = new EventSource(`/api/remote/hands/stream?room=${encodeURIComponent(this.room)}`)
    this.es = es

    es.addEventListener('hello', () => {
      if (this.status !== 'live') this.setStatus(this.isFresh ? 'live' : 'connecting')
    })
    es.addEventListener('hands', (ev) => {
      try {
        this.ingest(JSON.parse((ev as MessageEvent).data) as RemoteHandFrame)
      } catch { /* malformed frame — ignore, the next one follows in ~40 ms */ }
    })
    es.onerror = () => {
      // EventSource retries on its own; just reflect the contact state
      if (this.status === 'live' || this.status === 'connecting') this.setStatus(this.isFresh ? 'live' : 'connecting')
    }

    // freshness watchdog: a phone that stopped streaming (tab closed,
    // wifi drop) must drop the LIVE badge even though the SSE stream
    // itself is still perfectly connected
    if (!this.watchdog) {
      this.watchdog = window.setInterval(() => {
        if (this.status === 'live' && !this.isFresh) this.setStatus('stale')
        if (this.status === 'stale' && this.isFresh) this.setStatus('live')
      }, 400)
    }
  }

  /** apply one hands frame from ANY transport (SSE event or the
   *  WebSocket relay — same shape, same freshness gate). The gate
   *  runs on the SERVER receive stamp: replays carry an older stamp
   *  and are dropped, while frames from ANY number of phones — each
   *  with its own private seq — still interleave safely. Gating on
   *  the sender seq would let a second phone (or a QA inject)
   *  starve the first one forever. */
  ingest(data: RemoteHandFrame) {
    const stamp = typeof (data as { at?: number }).at === 'number'
      ? (data as { at: number }).at
      : typeof data.t === 'number' ? data.t : Date.now()
    if (stamp <= this.lastAt) return
    this.seq = typeof data.seq === 'number' ? data.seq : this.seq
    this.lastAt = stamp
    const hands: HandSample[] = []
    const lms: Landmark[][] = []
    for (const h of (data.hands ?? []).slice(0, 2)) {
      hands.push({
        present: true,
        x: h.x, y: h.y,
        openness: h.openness, scale: h.scale,
        t: this.lastAt,
      })
      if (h.lm && h.lm.length >= 21) {
        lms.push(h.lm.map((p) => ({ x: p[0], y: p[1], z: p[2] ?? 0 })))
      }
    }
    this.hands = hands
    this.landmarks = lms
    this.setStatus('live')
  }

  /** stop the stream (page dispose) */
  stop() {
    this.es?.close()
    this.es = null
    if (this.watchdog) { window.clearInterval(this.watchdog); this.watchdog = 0 }
    this.hands = []
    this.landmarks = []
    this.lastAt = 0
    this.seq = -1
    this.setStatus('off')
  }

  private setStatus(s: RemoteHandsStatus) {
    if (this.status === s) return
    this.status = s
    this.onStatus?.(s)
  }
}
