// ---------------------------------------------------------------
// Projection relay store — a tiny in-memory state bus shared by
// every route under /api/projection/relay in this server process.
//
// The studio (control) pushes its full projection state here; any
// number of /output pages subscribe and receive it. This is the
// bridge that makes the output page a true live preview EVEN when
// it runs in another browser or on another machine —
// BroadcastChannel only crosses tabs inside one browser.
//
// The store hangs off globalThis so dev hot-reloads keep the
// current state and live subscribers alive.
// ---------------------------------------------------------------

export interface RelayState {
  /** bumps on every real state push — receivers use it to order applies */
  rev: number
  /** the full serialized projection project (version, output, surfaces) */
  project: unknown
  updatedAt: number
  /** last time a studio announced itself (push or heartbeat) */
  studioSeenAt: number
}

export type RelayListener = (event: 'relay' | 'hb', data: unknown) => void

class RelayStore {
  state: RelayState = { rev: 0, project: null, updatedAt: 0, studioSeenAt: 0 }
  private listeners = new Set<RelayListener>()

  /** studio pushed new state — bump rev and fan out to every subscriber */
  push(project: unknown) {
    this.state = {
      rev: this.state.rev + 1,
      project,
      updatedAt: Date.now(),
      studioSeenAt: Date.now(),
    }
    this.emit('relay', { rev: this.state.rev, project, at: this.state.updatedAt })
  }

  /** studio is still open (no state change) — receivers keep their LIVE status */
  heartbeat() {
    this.state = { ...this.state, studioSeenAt: Date.now() }
    this.emit('hb', { at: this.state.studioSeenAt })
  }

  subscribe(listener: RelayListener): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private emit(event: 'relay' | 'hb', data: unknown) {
    this.listeners.forEach((l) => {
      try { l(event, data) } catch { /* a dead stream must not break others */ }
    })
  }
}

const g = globalThis as unknown as { __oceanProjectionRelay?: RelayStore }
export const relayStore: RelayStore = g.__oceanProjectionRelay ?? (g.__oceanProjectionRelay = new RelayStore())
