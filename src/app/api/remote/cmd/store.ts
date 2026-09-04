// ---------------------------------------------------------------
// Remote-command relay store — the button half of the phone
// controller. While the /api/remote/hands bus carries the phone's
// tracked hands, THIS bus carries everything else the phone pad
// fires: one-shot show commands (feed, burst, shark, turtle…),
// toggles (swim, sound), hold buttons (boost) and the studio's
// host-state echo so the pad can badge SWIM/SOUND with real state.
//
// Same shape as the hands store: hangs off globalThis, tiny, no
// persistence — a dev restart simply clears the pad history.
// ---------------------------------------------------------------

export type RemoteCmdType =
  | 'feed' | 'burst' | 'shark' | 'turtle' | 'ray' | 'pulse' | 'bubbles' | 'impulse'
  | 'swim' | 'sound' | 'boost'
  | 'view'

export const REMOTE_CMD_TYPES: ReadonlySet<string> = new Set([
  'feed', 'burst', 'shark', 'turtle', 'ray', 'pulse', 'bubbles', 'impulse',
  'swim', 'sound', 'boost',
  'view',
])

/** camera-chain move (the VIEW pad / studio CHAIN tab) — all optional */
export interface RemoteCmdView {
  yaw?: number
  pitch?: number
  dolly?: number
  auto?: boolean
  speed?: number
  reset?: boolean
}

/** one pad action, already validated */
export interface RemoteCmd {
  /** monotonic per-room id — clients dedupe on it */
  id: number
  room: string
  /** server receive time (ms epoch) */
  t: number
  type: RemoteCmdType
  /** press/release for hold buttons (boost); undefined = one-shot */
  on?: boolean
  /** camera-chain payload for type 'view' */
  view?: RemoteCmdView
}

/** what the studio publishes so the pad can badge the toggles */
export interface RemoteHostState {
  /** free-swim mode active on the studio */
  swim: boolean
  /** studio sound muted */
  muted: boolean
  /** camera-chain targets the host is currently showing (VIEW pad sync) */
  chain?: { yaw: number; pitch: number; dolly: number; auto: boolean }
  at: number
}

type Listener = (kind: 'cmd' | 'host', payload: unknown) => void

interface Room {
  cmds: RemoteCmd[]
  host: RemoteHostState | null
  listeners: Set<Listener>
  nextId: number
  /** last time the phone fired anything (cmd or ping) — pad liveness */
  padSeenAt: number
}

const MAX_CMDS = 24
const PAD_FRESH_MS = 6000
const MAX_ROOMS = 8

class RemoteCmdStore {
  private rooms = new Map<string, Room>()

  private room(name: string): Room {
    let r = this.rooms.get(name)
    if (!r) {
      // simple room cap — drop the least-recently-seen room if overrun
      if (this.rooms.size >= MAX_ROOMS) {
        let oldestKey = ''
        let oldest = Infinity
        this.rooms.forEach((room, key) => {
          if (room.padSeenAt < oldest) { oldest = room.padSeenAt; oldestKey = key }
        })
        if (oldestKey) this.rooms.delete(oldestKey)
      }
      r = { cmds: [], host: null, listeners: new Set(), nextId: 0, padSeenAt: 0 }
      this.rooms.set(name, r)
    }
    return r
  }

  /** the phone fired a button — record + fan out to every subscriber */
  push(type: RemoteCmdType, room: string, on?: boolean, view?: RemoteCmdView): RemoteCmd {
    const r = this.room(room)
    const cmd: RemoteCmd = { id: ++r.nextId, room, t: Date.now(), type, ...(on === undefined ? {} : { on }), ...(view ? { view } : {}) }
    r.cmds.push(cmd)
    if (r.cmds.length > MAX_CMDS) r.cmds.splice(0, r.cmds.length - MAX_CMDS)
    r.padSeenAt = Date.now()
    r.listeners.forEach((l) => {
      try { l('cmd', cmd) } catch { /* a dead stream must not break others */ }
    })
    return cmd
  }

  /** studio echoed its toggle state — fan out so the pad badges update */
  setHost(
    room: string,
    partial: { swim?: boolean; muted?: boolean; chain?: { yaw: number; pitch: number; dolly: number; auto: boolean } },
  ): RemoteHostState {
    const r = this.room(room)
    const prev = r.host ?? { swim: false, muted: false, at: 0 }
    r.host = {
      swim: typeof partial.swim === 'boolean' ? partial.swim : prev.swim,
      muted: typeof partial.muted === 'boolean' ? partial.muted : prev.muted,
      ...(partial.chain
        ? { chain: partial.chain }
        : prev.chain
          ? { chain: prev.chain }
          : {}),
      at: Date.now(),
    }
    r.listeners.forEach((l) => {
      try { l('host', r.host) } catch { /* ignore dead listeners */ }
    })
    return r.host
  }

  /** pad heartbeat so the QR modal can say "phone connected" even
   *  when the pad (no camera) is idle */
  ping(room: string) {
    this.room(room).padSeenAt = Date.now()
  }

  /** recent commands, newest last (SSE replay / bootstrap) */
  getCmds(room: string, sinceMs = 0): RemoteCmd[] {
    const r = this.room(room)
    if (!sinceMs) return r.cmds.slice(-12)
    const cut = Date.now() - sinceMs
    return r.cmds.filter((c) => c.t >= cut)
  }

  getHost(room: string): RemoteHostState | null {
    return this.room(room).host
  }

  /** is a phone pad actively using this room? (QR status) */
  padLive(room: string): boolean {
    const r = this.rooms.get(room)
    return !!r && Date.now() - r.padSeenAt < PAD_FRESH_MS
  }

  subscribe(room: string, listener: Listener): () => void {
    const r = this.room(room)
    r.listeners.add(listener)
    return () => { r.listeners.delete(listener) }
  }
}

const g = globalThis as unknown as { __oceanRemoteCmds?: RemoteCmdStore }
export const remoteCmdStore: RemoteCmdStore = g.__oceanRemoteCmds ?? (g.__oceanRemoteCmds = new RemoteCmdStore())
