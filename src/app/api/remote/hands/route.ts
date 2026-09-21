// ---------------------------------------------------------------
// /api/remote/hands — the smartphone controller pushes its tracked
// hands here at ~25 Hz.
//
// POST { room, seq, hands: [{ x, y, openness, scale, lm?, label? }] }
// GET  ?room=ocean → current snapshot as JSON (bootstrap / debugging)
//
// Live ocean clients use GET /api/remote/hands/stream (SSE).
// ---------------------------------------------------------------
import { NextResponse } from 'next/server'
import { remoteHandsStore, type RemoteHandDTO } from './store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const clamp01 = (v: unknown, fallback = 0): number => {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(1, Math.max(0, n))
}

/** validate + sanitize one hand from the wire (never trust the client) */
function sanitizeHand(raw: unknown): RemoteHandDTO | null {
  if (!raw || typeof raw !== 'object') return null
  const h = raw as Record<string, unknown>
  const lmRaw = Array.isArray(h.lm) ? h.lm : []
  const lm: number[][] = []
  for (let i = 0; i < Math.min(21, lmRaw.length); i++) {
    const p = lmRaw[i]
    if (Array.isArray(p) && p.length >= 2) {
      lm.push([
        clamp01(p[0], 0.5),
        clamp01(p[1], 0.5),
        Math.min(1, Math.max(-1, typeof p[2] === 'number' && Number.isFinite(p[2]) ? p[2] : 0)),
      ])
    }
  }
  return {
    x: clamp01(h.x, 0.5),
    y: clamp01(h.y, 0.5),
    openness: clamp01(h.openness, 0),
    scale: Math.min(1, Math.max(0.001, clamp01(h.scale, 0.15))),
    lm: lm.length === 21 ? lm : undefined,
    label: typeof h.label === 'string' ? h.label.slice(0, 16) : undefined,
  }
}

export async function GET(req: Request) {
  const room = new URL(req.url).searchParams.get('room')?.slice(0, 32) || 'ocean'
  const snap = remoteHandsStore.get(room)
  return NextResponse.json({
    ok: true,
    room,
    live: remoteHandsStore.seenRecently(room),
    snapshot: snap,
  })
}

export async function POST(req: Request) {
  let body: unknown = null
  try { body = await req.json() } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 })
  }
  const b = (body ?? {}) as Record<string, unknown>
  const room = typeof b.room === 'string' ? b.room.slice(0, 32) || 'ocean' : 'ocean'
  const seq = typeof b.seq === 'number' && Number.isFinite(b.seq) ? Math.floor(b.seq) : 0
  const t = typeof b.t === 'number' && Number.isFinite(b.t) ? b.t : Date.now()

  const handsRaw = Array.isArray(b.hands) ? b.hands : []
  const hands: RemoteHandDTO[] = []
  for (const raw of handsRaw.slice(0, 2)) {          // hard cap: two hands
    const h = sanitizeHand(raw)
    if (h) hands.push(h)
  }

  remoteHandsStore.push({ room, seq, t: Date.now(), hands })
  return NextResponse.json({ ok: true, hands: hands.length })
}
