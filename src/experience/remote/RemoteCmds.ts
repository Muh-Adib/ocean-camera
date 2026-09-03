// ---------------------------------------------------------------
// RemoteCmds — ocean-side client of the phone BUTTON PAD link.
//
// Keeps one EventSource open to /api/remote/cmd/stream and turns
// pad presses into applyRemoteCmd() calls in main.ts, exactly the
// way RemoteHands turns the phone's tracked hands into gesture
// samples. Also receives the studio's host-state echo (swim/muted)
// — only useful on the studio itself; /output pages ignore it.
// ---------------------------------------------------------------
import type { RemoteCmd, RemoteCmdType, RemoteHostState } from '@/app/api/remote/cmd/store'

export type RemoteCmdsStatus = 'off' | 'connecting' | 'live'

export type { RemoteCmd, RemoteCmdType, RemoteHostState }

export class RemoteCmds {
  status: RemoteCmdsStatus = 'off'
  room: string
  /** pad press → applyRemoteCmd() in main.ts */
  onCmd?: (cmd: RemoteCmd) => void
  /** studio echo → pad badges (phone side); ocean side mostly ignores */
  onHost?: (host: RemoteHostState) => void

  private es: EventSource | null = null
  private seen = new Set<number>()

  constructor(room?: string) {
    this.room = room
      ?? new URLSearchParams(window.location.search).get('remoteRoom')
      ?? 'ocean'
  }

  start() {
    if (this.es) return
    this.status = 'connecting'
    const es = new EventSource(`/api/remote/cmd/stream?room=${encodeURIComponent(this.room)}`)
    this.es = es

    es.addEventListener('hello', () => { this.status = 'live' })
    es.addEventListener('cmd', (ev) => {
      try {
        const cmd = JSON.parse((ev as MessageEvent).data) as RemoteCmd
        if (typeof cmd?.id !== 'number' || typeof cmd?.type !== 'string') return
        if (this.seen.has(cmd.id)) return          // replay dedupe
        this.seen.add(cmd.id)
        if (this.seen.size > 64) {
          // keep the dedupe set small — drop the oldest quarter
          const ids = [...this.seen].sort((a, b) => a - b)
          for (const id of ids.slice(0, 16)) this.seen.delete(id)
        }
        this.status = 'live'
        this.onCmd?.(cmd)
      } catch { /* malformed frame — the next one follows */ }
    })
    es.addEventListener('host', (ev) => {
      try {
        const host = JSON.parse((ev as MessageEvent).data) as RemoteHostState
        if (host && typeof host === 'object') this.onHost?.(host)
      } catch { /* ignore */ }
    })
    es.onerror = () => {
      // EventSource retries on its own
      if (this.status !== 'live') this.status = 'connecting'
    }
  }

  stop() {
    this.es?.close()
    this.es = null
    this.seen.clear()
    this.status = 'off'
  }
}
