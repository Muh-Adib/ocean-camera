// ---------------------------------------------------------------
// POST — the studio pushes its full projection state (or a small
// heartbeat so receivers know the control is still open).
// GET  — current snapshot as JSON (bootstrap / debugging).
//
// Live /output pages use GET /api/projection/relay/stream (SSE).
// ---------------------------------------------------------------
import { NextResponse } from 'next/server'
import { relayStore } from './store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const s = relayStore.state
  return NextResponse.json({
    rev: s.rev,
    project: s.project,
    updatedAt: s.updatedAt,
    studioSeenAt: s.studioSeenAt,
  })
}

export async function POST(req: Request) {
  let body: { project?: unknown; hb?: unknown } | null = null
  try { body = await req.json() } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 })
  }
  if (body && typeof body === 'object') {
    if (body.project && typeof body.project === 'object') relayStore.push(body.project)
    else if (body.hb) relayStore.heartbeat()
  }
  return NextResponse.json({ ok: true, rev: relayStore.state.rev })
}
