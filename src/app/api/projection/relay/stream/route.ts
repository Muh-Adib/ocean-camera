// ---------------------------------------------------------------
// GET /api/projection/relay/stream — Server-Sent Events feed of the
// studio's projection state. Every /output page keeps one open:
//
//   · on connect → the current snapshot arrives immediately (so a
//     freshly opened output adopts the running show at once)
//   · on every studio push → an 'relay' event with the full project
//   · on studio heartbeat (4 s) → an 'hb' event (state unchanged)
//   · SSE comments every 15 s keep proxies from idling the stream out
//
// EventSource reconnects on its own when the dev server restarts.
// ---------------------------------------------------------------
import { relayStore } from '../store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request) {
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

      const s = relayStore.state
      if (s.project) send('relay', { rev: s.rev, project: s.project, at: s.updatedAt })
      send('hello', { at: Date.now() })

      unsubscribe = relayStore.subscribe((event, data) => send(event, data))
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
