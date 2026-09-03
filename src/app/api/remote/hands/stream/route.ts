// ---------------------------------------------------------------
// GET /api/remote/hands/stream?room=ocean — Server-Sent Events feed
// of the smartphone controller's tracked hands. Every ocean client
// (studio and /output pages) keeps one open:
//
//   · on connect → a fresh snapshot is replayed immediately (if the
//     phone is already streaming) so control feels instant
//   · on every phone POST → a 'hands' event with the frame
//   · SSE comments every 15 s keep proxies from idling the stream
//
// EventSource reconnects on its own when the dev server restarts.
// ---------------------------------------------------------------
import { remoteHandsStore, type RemoteHandsSnapshot } from '../store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const REPLAY_FRESH_MS = 1500

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

      // instant catch-up: if the phone is already streaming, the ocean
      // starts following it without waiting for the next POST
      const snap = remoteHandsStore.get(room)
      if (snap && Date.now() - snap.t < REPLAY_FRESH_MS) send('hands', snap)
      send('hello', { room, at: Date.now(), live: remoteHandsStore.seenRecently(room) })

      unsubscribe = remoteHandsStore.subscribe(room, (s: RemoteHandsSnapshot) => send('hands', s))
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
