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
//     frames at a fixed 30 Hz cadence while anything is live, and
//     reports connection state for the phone UI.
//
// Both speak to the hub created in server.js at /ws/control.
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

/** shared socket with hello/reconnect — resolves callbacks per role */
class WsBase {
  protected ws: WebSocket | null = null
  protected closed = false
  private retry = 0
  private timer = 0

  constructor(private role: 'phone' | 'screen') {}

  protected connect() {
    if (this.closed) return
    try { this.ws = new WebSocket(wsUrl()) } catch { this.scheduleRetry(); return }
    const ws = this.ws
    ws.onopen = () => {
      this.retry = 0
      try { ws.send(JSON.stringify({ t: 'hello', role: this.role })) } catch { /* noop */ }
      this.onOpen?.()
    }
    ws.onmessage = (e) => {
      let msg: unknown
      try { msg = JSON.parse(String(e.data)) } catch { return }
      if (msg && typeof msg === 'object') this.onMessage?.(msg as Record<string, unknown>)
    }
    ws.onclose = () => { this.ws = null; this.onClose?.(); this.scheduleRetry() }
    ws.onerror = () => { try { ws.close() } catch { /* noop */ } }
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

  constructor() {
    super('screen')
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

  constructor() {
    super('phone')
    this.onOpen = () => this.onState?.(true)
    this.onClose = () => this.onState?.(false)
    this.connect()
  }

  /** stick velocities — called at the phone's 30 Hz cadence while live */
  sendCtl(mx: number, my: number, ox: number, oy: number, dz: number) {
    this.send({ t: 'ctl', mx, my, ox, oy, dz })
  }

  sendHand(present: boolean, x: number, y: number, openness: number, hands: number) {
    this.send({ t: 'hand', p: present, x, y, o: openness, n: hands })
  }

  sendCam(on: boolean) { this.send({ t: 'cam', on }) }
}
