// ---------------------------------------------------------------
// remotePresenceBus — a tiny cross-module bus for "a phone is in
// the room" events from the WebSocket relay.
//
// main.ts (every ocean page) emits RemoteSocket presence updates;
// the /output QR badge subscribes so it hides the INSTANT a phone
// connects (and comes back the moment it leaves) — no waiting for
// the next liveness poll. The old hands/pad polling stays as the
// fallback for SSE-only phones.
// ---------------------------------------------------------------

export interface RemotePresence {
  phones: number
  hosts: number
}

type Fn = (p: RemotePresence) => void

const g = globalThis as unknown as { __oceanPresenceFns?: Fn[] }

export function emitRemotePresence(p: RemotePresence) {
  for (const fn of g.__oceanPresenceFns ?? []) {
    try { fn(p) } catch { /* a dead subscriber must not break others */ }
  }
}

export function subscribeRemotePresence(fn: Fn): () => void {
  if (!g.__oceanPresenceFns) g.__oceanPresenceFns = []
  g.__oceanPresenceFns.push(fn)
  return () => {
    const fns = g.__oceanPresenceFns
    if (!fns) return
    const i = fns.indexOf(fn)
    if (i >= 0) fns.splice(i, 1)
  }
}
