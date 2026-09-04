// ---------------------------------------------------------------
// RemoteSocket — the WebSocket leg of the remote link.
//
// The old relay (POST + EventSource) was reliable but jittery:
// every hand frame and every pad drag was its own HTTP round trip,
// and SSE delivery arrived in bursts — the fish and the camera
// chain looked "patah-patah" over wifi. This client keeps ONE
// persistent WebSocket to /ws (same port — no mixed content, no
// extra firewall hole), streams at 30 Hz both ways, and reconnects
// with capped backoff. The SSE/POST relay stays wired as the
// automatic fallback while the socket is down.
//
// Messages (all JSON):
//   in:  hello / hands / view / cmd / host / presence / sync
//   out: hello / hands / view / cmd / host / ping
// ---------------------------------------------------------------

export type RemoteSocketStatus = 'off' | 'connecting' | 'live' | 'down'

export interface RemoteHandFrame {
  /** server receive stamp — `at` over WebSocket, `t` over SSE */
  at?: number
  t?: number
  seq?: number
  hands?: {
    x: number; y: number; openness: number; scale: number
    lm?: number[][]; label?: string
  }[]
}

export interface RemotePresence {
  phones: number
  hosts: number
}

export class RemoteSocket {
  status: RemoteSocketStatus = 'off'
  room: string
  /** phone hands frame → RemoteHands.ingest() on every ocean page */
  onHands?: (frame: RemoteHandFrame) => void
  /** camera-chain move (deltas/absolute/reset) → applyRemoteCmd('view') */
  onView?: (v: Record<string, unknown>) => void
  /** pad action → applyRemoteCmd(cmd) */
  onCmd?: (cmd: { id: number; t: number; type: string; on?: boolean }) => void
  /** studio echo (swim/muted/chain) → pad badges / readouts */
  onHost?: (host: Record<string, unknown>) => void
  /** room membership changed → QR badge, status chips */
  onPresence?: (p: RemotePresence) => void
  /** "a new member joined — republish your state" */
  onSync?: () => void

  private ws: WebSocket | null = null
  private retry = 0
  private reconnectTimer = 0
  private disposed = false

  constructor(room?: string) {
    this.room = room
      ?? new URLSearchParams(window.location.search).get('remoteRoom')
      ?? 'ocean'
  }

  get isLive(): boolean {
    return this.status === 'live' && this.ws?.readyState === WebSocket.OPEN
  }

  start() {
    if (this.ws || this.disposed) return
    this.connect()
  }

  private connect() {
    if (this.disposed) return
    clearTimeout(this.reconnectTimer)
    this.setStatus('connecting')
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    let ws: WebSocket
    try {
      ws = new WebSocket(`${proto}://${window.location.host}/ws?room=${encodeURIComponent(this.room)}`)
    } catch {
      this.scheduleReconnect()
      return
    }
    this.ws = ws

    ws.onopen = () => {
      this.retry = 0
      this.setStatus('live')
      ws.send(JSON.stringify({ t: 'hello', role: 'host', room: this.room }))
    }
    ws.onmessage = (ev) => {
      let msg: Record<string, unknown>
      try { msg = JSON.parse(ev.data as string) } catch { return }
      switch (msg.t) {
        case 'hello':
          if (msg.presence) this.onPresence?.(msg.presence as RemotePresence)
          break
        case 'hands':
          this.onHands?.(msg as unknown as RemoteHandFrame)
          break
        case 'view':
          if (msg.v && typeof msg.v === 'object') this.onView?.(msg.v as Record<string, unknown>)
          break
        case 'cmd': {
          const cmd = msg.cmd as { id?: number; t?: number; type?: string; on?: boolean }
          if (cmd && typeof cmd.type === 'string') {
            this.onCmd?.({ id: typeof cmd.id === 'number' ? cmd.id : -1, t: typeof cmd.t === 'number' ? cmd.t : Date.now(), type: cmd.type, ...(typeof cmd.on === 'boolean' ? { on: cmd.on } : {}) })
          }
          break
        }
        case 'host':
          if (msg.host && typeof msg.host === 'object') this.onHost?.(msg.host as Record<string, unknown>)
          break
        case 'presence':
          this.onPresence?.({ phones: Number(msg.phones) || 0, hosts: Number(msg.hosts) || 0 })
          break
        case 'sync':
          this.onSync?.()
          break
        default:
          break
      }
    }
    ws.onclose = ws.onerror = () => {
      if (this.ws === ws) this.ws = null
      if (this.disposed) return
      this.setStatus('down')
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect() {
    if (this.disposed || this.reconnectTimer) return
    const wait = Math.min(5000, 400 * 2 ** Math.min(this.retry, 4))
    this.retry++
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = 0
      this.connect()
    }, wait)
  }

  private send(obj: Record<string, unknown>): boolean {
    if (!this.isLive || !this.ws) return false
    try {
      this.ws.send(JSON.stringify(obj))
      return true
    } catch {
      return false
    }
  }

  /** phone → every ocean page (same shape the POST route stamps) */
  sendHands(hands: unknown[], seq: number): boolean {
    return this.send({ t: 'hands', hands, seq })
  }

  /** camera-chain move — deltas stream at 30 Hz, absolutes for presets */
  sendView(v: {
    dyaw?: number; dpitch?: number; ddolly?: number; dmx?: number; dmy?: number
    yaw?: number; pitch?: number; dolly?: number; moveX?: number; moveY?: number
    auto?: boolean; speed?: number; reset?: boolean
  } | Record<string, unknown>): boolean {
    return this.send({ t: 'view', v })
  }

  sendCmd(type: string, on?: boolean): boolean {
    return this.send({ t: 'cmd', cmd: { type, ...(on === undefined ? {} : { on }) } })
  }

  /** studio echo so pads/badges see the real host state */
  sendHost(host: Record<string, unknown>): boolean {
    return this.send({ t: 'host', host })
  }

  /** app-level liveness (pad heartbeat for the QR fallback path) */
  ping(): boolean {
    return this.send({ t: 'ping' })
  }

  stop() {
    this.disposed = true
    clearTimeout(this.reconnectTimer)
    this.reconnectTimer = 0
    try { this.ws?.close() } catch { /* already closed */ }
    this.ws = null
    this.setStatus('off')
  }

  private setStatus(s: RemoteSocketStatus) {
    if (this.status === s) return
    this.status = s
  }
}
