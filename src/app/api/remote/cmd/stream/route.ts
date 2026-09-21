// ---------------------------------------------------------------
// GET /api/remote/cmd/stream?room=ocean — Server-Sent Events feed
// of the smartphone BUTTON PAD. Every ocean page (studio and every
// /output) keeps one open so a pad press lands everywhere at once:
//
//   · on connect → recent commands (last 3 s) are replayed, then
//     the current host state, so a just-opened page is up to date
//   · on every pad press   → a 'cmd' event
//   · on studio echo       → a 'host' event (pad toggle badges)
//   · SSE comments every 15 s keep proxies from idling the stream
//
// EventSource reconnects on its own when the dev server restarts.
// ---------------------------------------------------------------
import { remoteCmdStore } from '../store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const REPLAY_MS = 3000

export async function GET(req: Request) {
  const room = new URL(req.url).searchParams.get('room')?.slice(0, 32) || 'ocean'
  const encoder = new TextEncoder()
  let unsubscribe: (() => void) | null = null
  let hbTimer: ReturnType<typeof setInterval> | null = null
  let closed = false

  const stream = new ReadableStream({
    start(controller) {
      const push = (chunk: string) => {
        if (closed) return
        try { controller.enqueue(encoder.encode(chunk)) } catch { closed = true }
      }
      const send = (event: string, data: unknown) => push(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)

      // catch-up: replay very recent pad presses so a page opened in
      // the middle of a show still catches the last action. Continuous
      // 'view' (camera-chain) drags are only replayed while fresh — a
      // page opened later must not lurch to a stale rig target.
      const now = Date.now()
      for (const cmd of remoteCmdStore.getCmds(room, REPLAY_MS)) {
        if (cmd.type === 'view' && now - cmd.t > 1500) continue
        send('cmd', cmd)
      }
      const host = remoteCmdStore.getHost(room)
      if (host) send('host', host)
      send('hello', { room, at: Date.now(), padLive: remoteCmdStore.padLive(room) })

      unsubscribe = remoteCmdStore.subscribe(room, (kind, payload) => send(kind, payload))
      hbTimer = setInterval(() => push(': hb\n\n'), 15000)

      const abort = () => {
        if (closed) return
        closed = true
        unsubscribe?.()
        unsubscribe = null
        if (hbTimer) { clearInterval(hbTimer); hbTimer = null }
        try { controller.close() } catch { /* already closed */ }
      }
      req.signal.addEventListener('abort', abort)
    },
    cancel() {
      closed = true
      unsubscribe?.()
      unsubscribe = null
      if (hbTimer) { clearInterval(hbTimer); hbTimer = null }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
