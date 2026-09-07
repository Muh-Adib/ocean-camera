// ---------------------------------------------------------------
// RemoteLink — WebSocket client for the phone-control hub.
//
// Two flavours live here:
//   • ScreenLink — used by the studio tab and every /output page.
//     Receives stick velocities (→ RemoteRig), phone hand metrics
//     (→ the ocean's interaction field) and phone presence (→ the
//     QR overlay shows/hides). Auto-reconnects forever with a short
//     backoff so the link self-heals after projector sleep, network
//     blips or a dev-server restart.
//   • PhoneLink  — used by /control-mobile. Sends ctl/hand/cam
//     frames at a fixed cadence while anything is live, and
//     reports connection state for the phone UI.
//
// Both speak to the hub created in server.js at /ws/control. A
// session tag rides the hello handshake: control frames only ever
// reach screens of the SAME session, which is what isolates two
// shows (venues / pools) sharing one server.
// ---------------------------------------------------------------

export interface CtlFrame { t: 'ctl'; mx: number; my: number; ox: number; oy: number; dz: number }
export interface HandFrame { t: 'hand'; p: boolean; x: number; y: number; o: number; n: number }
export interface CamFrame { t: 'cam'; on: boolean }
export interface PhoneFrame { t: 'phone'; on: boolean; n: number }
export type ScreenMsg = CtlFrame | HandFrame | CamFrame | PhoneFrame

const WS_PATH = '/ws/control'

function wsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${location.host}${WS_PATH}`
}

/** canonical session tag from a URL param / stored value — '' becomes 'main' */
export function cleanSessionId(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 24) : ''
  return s || 'main'
}

/** shared socket with hello/reconnect — resolves callbacks per role */
class WsBase {
  protected ws: WebSocket | null = null
  protected closed = false
  private retry = 0
  private timer = 0

  constructor(private role: 'phone' | 'screen', protected session: string) {}

  protected connect() {
    if (this.closed) return
    let ws: WebSocket
    try { ws = new WebSocket(wsUrl()) } catch { this.scheduleRetry(); return }
    this.ws = ws
    // EVERY handler is guarded: events from a stale socket (replaced by
    // forceReconnect / a newer connect) must be ignored. Without this,
    // a late onclose from the OLD socket nulled this.ws while the NEW
    // socket was live — send() silently no-oped until the next
    // reconnect: the intermittent "connection failure" on phones that
    // slept and woke.
    ws.onopen = () => {
      if (this.ws !== ws) return
      this.retry = 0
      try { ws.send(JSON.stringify({ t: 'hello', role: this.role, session: this.session })) } catch { /* noop */ }
      this.onOpen?.()
    }
    ws.onmessage = (e) => {
      if (this.ws !== ws) return
      let msg: unknown
      try { msg = JSON.parse(String(e.data)) } catch { return }
      if (msg && typeof msg === 'object') this.onMessage?.(msg as Record<string, unknown>)
    }
    ws.onclose = () => {
      if (this.ws !== ws) return          // stale close — new socket already owns the link
      this.ws = null
      this.onClose?.()
      this.scheduleRetry()
    }
    ws.onerror = () => { try { ws.close() } catch { /* noop */ } }
  }

  /**
   * drop the current link and reconnect immediately (no backoff) —
   * used when the phone returns from sleep: suspended tabs come back
   * with half-open sockets that would otherwise sit "live" but deaf
   * until the hub's sweep (up to 22 s) or TCP gives up (minutes).
   */
  forceReconnect() {
    if (this.closed) return
    window.clearTimeout(this.timer)
    this.timer = 0
    const ws = this.ws
    if (ws) {
      this.ws = null            // detach first — stale events become no-ops
      try { ws.close() } catch { /* noop */ }
    }
    this.connect()
  }

  private scheduleRetry() {
    if (this.closed || this.timer) return
    this.retry++
    const wait = Math.min(4000, 400 * this.retry)
    this.timer = window.setTimeout(() => { this.timer = 0; this.connect() }, wait)
  }

  protected onOpen?: () => void
  protected onClose?: () => void
  protected onMessage?: (msg: Record<string, unknown>) => void

  send(obj: unknown): boolean {
    if (this.ws && this.ws.readyState === 1) {
      try { this.ws.send(JSON.stringify(obj)); return true } catch { return false }
    }
    return false
  }

  get live() { return !!this.ws && this.ws.readyState === 1 }

  dispose() {
    this.closed = true
    window.clearTimeout(this.timer)
    try { this.ws?.close() } catch { /* noop */ }
    this.ws = null
  }
}

// ---------------------------------------------------------------
// ScreenLink — studio + /output side
// ---------------------------------------------------------------
export class ScreenLink extends WsBase {
  /** latest stick velocities — consumed (and cleared) by the rig each frame */
  ctl: CtlFrame | null = null
  /** latest hand metrics from the phone camera */
  hand: HandFrame | null = null
  /** phone presence (drives the QR overlay) */
  phoneOn = false
  phoneCount = 0
  /** last ctl/hand arrival — diagnostics */
  lastCtlAt = 0
  lastHandAt = 0

  constructor(session: string) {
    super('screen', session)
    this.onMessage = (msg) => {
      switch (msg.t) {
        case 'ctl':
          this.ctl = msg as unknown as CtlFrame
          this.lastCtlAt = performance.now()
          break
        case 'hand':
          this.hand = msg as unknown as HandFrame
          this.lastHandAt = performance.now()
          break
        case 'cam':
          // camera mode off → any stale hand signal must stop driving the ocean
          if (msg.on !== true && this.hand) { this.hand = { t: 'hand', p: false, x: 0.5, y: 0.5, o: 0, n: 0 } }
          break
        case 'phone':
          this.phoneOn = msg.on === true
          this.phoneCount = typeof msg.n === 'number' ? msg.n : this.phoneCount
          this.onPresence?.(this.phoneOn)
          break
      }
    }
    this.connect()
  }

  onPresence?: (on: boolean) => void

  /** pull the newest control packet (null when nothing new this frame) */
  takeCtl(): CtlFrame | null {
    const c = this.ctl
    this.ctl = null
    return c
  }

  /** hand signal still fresh? (phone gone silent → treat as absent) */
  freshHand(maxAgeMs = 700): HandFrame | null {
    if (!this.hand) return null
    if (performance.now() - this.lastHandAt > maxAgeMs) return null
    return this.hand.p ? this.hand : null
  }

  /** ms since the last control packet (Infinity when never) */
  ctlAge(): number {
    return this.lastCtlAt ? performance.now() - this.lastCtlAt : Infinity
  }
}

// ---------------------------------------------------------------
// PhoneLink — /control-mobile side
// ---------------------------------------------------------------
export class PhoneLink extends WsBase {
  onState?: (live: boolean) => void
  /** hub room occupancy — screens of THIS session (0 = nothing to steer) */
  onRoom?: (screens: number) => void
  private hbTimer = 0

  constructor(session: string) {
    super('phone', session)
    this.onOpen = () => this.onState?.(true)
    this.onClose = () => this.onState?.(false)
    this.onMessage = (msg) => {
      if (msg.t === 'room' && typeof msg.screens === 'number') this.onRoom?.(msg.screens)
    }
    this.connect()
    // idle heartbeat: proves the phone is alive even when no sticks move.
    // Without it, the hub's idle sweep would drop a quiet-but-open phone.
    this.hbTimer = window.setInterval(() => this.send({ t: 'hb' }), 5000)
  }

  /** stick velocities — called at the phone's 40 Hz cadence while live */
  sendCtl(mx: number, my: number, ox: number, oy: number, dz: number) {
    this.send({ t: 'ctl', mx, my, ox, oy, dz })
  }

  sendHand(present: boolean, x: number, y: number, openness: number, hands: number) {
    this.send({ t: 'hand', p: present, x, y, o: openness, n: hands })
  }

  sendCam(on: boolean) { this.send({ t: 'cam', on }) }

  dispose() {
    window.clearInterval(this.hbTimer)
    this.hbTimer = 0
    super.dispose()
  }
}
