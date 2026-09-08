// ---------------------------------------------------------------
// RemoteHands — phone-camera hand frames → the ocean's OWN gesture
// pipeline.
//
// The operator's rule: "pastikan controlnya sama dengan control
// gestur di langsung, bukan modul yang berbeda". The phone's hand
// metrics are therefore converted into the exact same HandSample
// objects the desktop HandTracker produces and fed into the SAME
// GestureEngine instance — identical swipe / push / pull / palm /
// fist analysis, identical callbacks (bursts, audio, camera
// reaction), identical swim-steering. No parallel field hacks.
// ---------------------------------------------------------------
import type { HandFrame } from './RemoteLink'
import type { HandSample } from '../interaction/HandTracker'

/** frames older than this stop driving the ocean (phone tab hidden / Wi-Fi hiccup) */
const FRESH_MS = 700

export class RemoteHands {
  private frame: HandFrame | null = null
  private at = 0
  /** true while fresh phone-hand frames are arriving (status readouts) */
  active = false

  /** latest frame from the WebSocket — called every render frame by the projection pump */
  feed(h: HandFrame | null) {
    if (!h || !h.p) {
      // absence must also expire: hand lost on the phone → release
      if (h) { this.frame = h; this.at = performance.now() }
      else if (performance.now() - this.at > FRESH_MS) { this.frame = null }
      if (!h) this.active = false
      return
    }
    this.frame = h
    this.at = performance.now()
    this.active = true
  }

  /** HandSample[] for gestureEngine.update() — empty when nothing fresh */
  take(): HandSample[] {
    const h = this.frame
    if (!h || !h.p) return []
    if (performance.now() - this.at > FRESH_MS) { this.active = false; return [] }
    const now = performance.now()
    const out: HandSample[] = [{
      present: true,
      x: h.x,
      y: h.y,
      openness: h.o,
      scale: h.s && h.s > 0.001 ? h.s : 0.25,   // sane default for old phone builds
      t: now,
    }]
    if (h.b) {
      out.push({
        present: true,
        x: h.b.x,
        y: h.b.y,
        openness: h.b.o,
        scale: h.b.s > 0.001 ? h.b.s : 0.25,
        t: now,
      })
    }
    return out
  }
}
