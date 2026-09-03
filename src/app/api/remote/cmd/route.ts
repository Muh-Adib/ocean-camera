// ---------------------------------------------------------------
// /api/remote/cmd — the smartphone BUTTON PAD pushes its actions
// here; the studio publishes its toggle state back so the pad can
// badge SWIM / SOUND with the real host state.
//
// POST { room, cmd: { type, on? } }   → fire a pad action
// POST { room, host: { swim, muted } } → studio toggle-state echo
// POST { room, ping: true }            → pad heartbeat (liveness)
// GET  ?room=ocean → { ok, padLive, host, cmds[] } (bootstrap/poll)
//
// Live ocean clients use GET /api/remote/cmd/stream (SSE).
// ---------------------------------------------------------------
import { NextResponse } from 'next/server'
import { remoteCmdStore, REMOTE_CMD_TYPES, type RemoteCmdType } from './store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  const room = new URL(req.url).searchParams.get('room')?.slice(0, 32) || 'ocean'
  return NextResponse.json({
    ok: true,
    room,
    padLive: remoteCmdStore.padLive(room),
    host: remoteCmdStore.getHost(room),
    cmds: remoteCmdStore.getCmds(room),
  })
}

export async function POST(req: Request) {
  let body: unknown = null
  try { body = await req.json() } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 })
  }
  const b = (body ?? {}) as Record<string, unknown>
  const room = typeof b.room === 'string' ? b.room.slice(0, 32) || 'ocean' : 'ocean'

  // pad heartbeat — keeps the "phone connected" badge alive on the QR modal
  if (b.ping === true) {
    remoteCmdStore.ping(room)
    return NextResponse.json({ ok: true })
  }

  // studio toggle-state echo
  if (b.host && typeof b.host === 'object') {
    const h = b.host as Record<string, unknown>
    const host = remoteCmdStore.setHost(room, {
      swim: typeof h.swim === 'boolean' ? h.swim : undefined,
      muted: typeof h.muted === 'boolean' ? h.muted : undefined,
    })
    return NextResponse.json({ ok: true, host })
  }

  // pad action
  const cmdRaw = b.cmd && typeof b.cmd === 'object' ? (b.cmd as Record<string, unknown>) : null
  const type = cmdRaw && typeof cmdRaw.type === 'string' ? cmdRaw.type : ''
  if (!REMOTE_CMD_TYPES.has(type)) {
    return NextResponse.json({ ok: false, error: 'unknown cmd' }, { status: 400 })
  }
  const on = typeof cmdRaw?.on === 'boolean' ? cmdRaw.on : undefined
  const cmd = remoteCmdStore.push(type as RemoteCmdType, room, on)
  return NextResponse.json({ ok: true, id: cmd.id })
}
