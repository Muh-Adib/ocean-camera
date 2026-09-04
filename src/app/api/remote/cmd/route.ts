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
import { remoteCmdStore, REMOTE_CMD_TYPES, type RemoteCmdType, type RemoteCmdView } from './store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const num = (v: unknown, min: number, max: number): number | undefined => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : undefined
}

/** strict view-payload sanitizer (drag streams hit this ~20×/s) */
function sanitizeView(raw: unknown): RemoteCmdView | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const v = raw as Record<string, unknown>
  const out: RemoteCmdView = {}
  const yaw = num(v.yaw, -180, 180)
  const pitch = num(v.pitch, -89, 89)
  const dolly = num(v.dolly, -20, 20)
  const moveX = num(v.moveX, -20, 20)
  const moveY = num(v.moveY, -20, 20)
  const speed = num(v.speed, 1, 30)
  // per-tick deltas — small by design (velocity·dt), clamped generously
  const dyaw = num(v.dyaw, -30, 30)
  const dpitch = num(v.dpitch, -30, 30)
  const ddolly = num(v.ddolly, -10, 10)
  const dmx = num(v.dmx, -10, 10)
  const dmy = num(v.dmy, -10, 10)
  if (yaw !== undefined) out.yaw = Math.round(yaw * 10) / 10
  if (pitch !== undefined) out.pitch = Math.round(pitch * 10) / 10
  if (dolly !== undefined) out.dolly = Math.round(dolly * 100) / 100
  if (moveX !== undefined) out.moveX = Math.round(moveX * 100) / 100
  if (moveY !== undefined) out.moveY = Math.round(moveY * 100) / 100
  if (speed !== undefined) out.speed = Math.round(speed * 10) / 10
  if (dyaw !== undefined) out.dyaw = Math.round(dyaw * 100) / 100
  if (dpitch !== undefined) out.dpitch = Math.round(dpitch * 100) / 100
  if (ddolly !== undefined) out.ddolly = Math.round(ddolly * 100) / 100
  if (dmx !== undefined) out.dmx = Math.round(dmx * 100) / 100
  if (dmy !== undefined) out.dmy = Math.round(dmy * 100) / 100
  if (typeof v.auto === 'boolean') out.auto = v.auto
  if (typeof v.reset === 'boolean') out.reset = v.reset
  return Object.keys(out).length ? out : undefined
}

export async function GET(req: Request) {
  const room = new URL(req.url).searchParams.get('room')?.slice(0, 32) || 'ocean'
  return NextResponse.json({
    ok: true,
    v: 3,   // relay payload version — view cmds + host.chain supported
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
    let chain: { yaw: number; pitch: number; dolly: number; auto: boolean; moveX?: number; moveY?: number } | undefined
    if (h.chain && typeof h.chain === 'object') {
      const c = h.chain as Record<string, unknown>
      const yaw = num(c.yaw, -180, 180)
      const pitch = num(c.pitch, -89, 89)
      const dolly = num(c.dolly, -20, 20)
      const moveX = num(c.moveX, -20, 20)
      const moveY = num(c.moveY, -20, 20)
      if (yaw !== undefined && pitch !== undefined && dolly !== undefined) {
        chain = {
          yaw: Math.round(yaw * 10) / 10,
          pitch: Math.round(pitch * 10) / 10,
          dolly: Math.round(dolly * 100) / 100,
          auto: c.auto === true,
          ...(moveX !== undefined ? { moveX: Math.round(moveX * 100) / 100 } : {}),
          ...(moveY !== undefined ? { moveY: Math.round(moveY * 100) / 100 } : {}),
        }
      }
    }
    const host = remoteCmdStore.setHost(room, {
      swim: typeof h.swim === 'boolean' ? h.swim : undefined,
      muted: typeof h.muted === 'boolean' ? h.muted : undefined,
      ...(chain ? { chain } : {}),
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
  const view = sanitizeView(cmdRaw?.view)
  const cmd = remoteCmdStore.push(type as RemoteCmdType, room, on, view)
  return NextResponse.json({ ok: true, id: cmd.id })
}
