// ---------------------------------------------------------------
// Remote-hands relay store — a tiny in-memory bus shared by every
// route under /api/remote/hands in this server process.
//
// A smartphone controller (the /remote page) tracks its camera at
// ~25 Hz and POSTs both hands here; any number of ocean clients
// (studio "/", /output pages — on this machine OR on the projector
// machine) subscribe over SSE and steer the fish in real time.
//
// Hangs off globalThis so dev hot-reloads keep live subscribers.
// ---------------------------------------------------------------

/** a single tracked hand, already prepared for the ocean pipeline */
export interface RemoteHandDTO {
  /** mirrored palm x, 0..1 (same space as the desktop tracker) */
  x: number
  /** palm y, 0..1 top-down */
  y: number
  /** 0 fist → 1 open */
  openness: number
  /** palm size (wrist → middle-MCP) */
  scale: number
  /** 21 landmarks, mirrored, [x,y,z] each — for skeleton overlays */
  lm?: number[][]
  /** MediaPipe handedness label (informational) */
  label?: string
}

export interface RemoteHandsSnapshot {
  room: string
  seq: number
  /** server receive time (ms epoch) — clients use it for freshness */
  t: number
  hands: RemoteHandDTO[]
}

type Listener = (snap: RemoteHandsSnapshot) => void

interface Room {
  snapshot: RemoteHandsSnapshot | null
  listeners: Set<Listener>
  /** last time a phone posted anything (even an empty frame) */
  phoneSeenAt: number
}

const FRESH_MS = 1500
const MAX_ROOMS = 8

class RemoteHandsStore {
  private rooms = new Map<string, Room>()

  private room(name: string): Room {
    let r = this.rooms.get(name)
    if (!r) {
      // simple room cap — drop the least-recently-seen room if overrun
      if (this.rooms.size >= MAX_ROOMS) {
        let oldestKey = ''
        let oldest = Infinity
        this.rooms.forEach((room, key) => {
          if (room.phoneSeenAt < oldest) { oldest = room.phoneSeenAt; oldestKey = key }
        })
        if (oldestKey) this.rooms.delete(oldestKey)
      }
      r = { snapshot: null, listeners: new Set(), phoneSeenAt: 0 }
      this.rooms.set(name, r)
    }
    return r
  }

  /** phone posted a new frame — fan out to every subscriber of the room */
  push(snap: RemoteHandsSnapshot) {
    const r = this.room(snap.room)
    r.snapshot = snap
    r.phoneSeenAt = Date.now()
    r.listeners.forEach((l) => {
      try { l(snap) } catch { /* a dead stream must not break others */ }
    })
  }

  get(room: string): RemoteHandsSnapshot | null {
    return this.room(room).snapshot
  }

  /** is a phone actively streaming into this room? (used by host/qr UIs) */
  seenRecently(room: string): boolean {
    const r = this.rooms.get(room)
    return !!r && Date.now() - r.phoneSeenAt < FRESH_MS
  }

  subscribe(room: string, listener: Listener): () => void {
    const r = this.room(room)
    r.listeners.add(listener)
    return () => { r.listeners.delete(listener) }
  }
}

const g = globalThis as unknown as { __oceanRemoteHands?: RemoteHandsStore }
export const remoteHandsStore: RemoteHandsStore = g.__oceanRemoteHands ?? (g.__oceanRemoteHands = new RemoteHandsStore())
