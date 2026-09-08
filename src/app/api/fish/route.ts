// ---------------------------------------------------------------
// /api/fish — the shared FISH TANK store, scoped per SHOW SESSION.
//
// Painted fish designs (colouring-sheet photos turned into texture
// sheets) live here so EVERY screen of the show shows them: the
// studio imports, /output pages (even on other machines) poll the
// version and pull new designs — no reload, no pairing, nothing.
//
// SESSIONS: every design belongs to one show session (venue). The
// exhibition's scanner folder sync targets a session; screens only
// ever poll their own session's tank — two shows on one server stay
// perfectly isolated.
//
//   GET  ?session=X          → { v, items: [{ id, name }] }          (light poll)
//   GET  ?full=1&session=X   → { v, designs: [{ id, name, url }] }   (full pull)
//   POST { action:'add', session, design:{ name, dataUrl } }
//   POST { action:'remove', session, id }
//   POST { action:'clear', session }
//
// In-memory with a best-effort .fish-tank.json mirror so the tank
// survives dev-server restarts on the show machine.
// ---------------------------------------------------------------
import { promises as fs } from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic'

interface FishDesign {
  id: string
  name: string
  url: string      // data:image/jpeg;base64,…
  at: number
}

interface Tank {
  v: number
  designs: FishDesign[]
}

interface TankStore {
  sessions: Map<string, Tank>
  loaded: boolean
}

const MAX_DESIGNS = 12
const MAX_DATAURL = 480_000   // ~480 KB per design keeps the poll cheap
const MAX_SESSIONS = 16       // LRU beyond that — plenty for a venue network

/**
 * one store per server process — SHAPE-CHECKED.
 *
 * Why the shape check: dev-mode HMR / cache swaps can leave an OLDER
 * compiled version of this module's global ({v, designs, loaded} — the
 * pre-session single-tank shape) sitting on globalThis while the new
 * module runs. Trusting a truthy-but-stale value made `st.sessions`
 * undefined and EVERY request 500 — the folder sync then reported
 * "tank refused the scan" for the whole show. We now validate the
 * shape, migrate a legacy single tank into sessions.main, and only
 * then reuse it.
 */
function store(): TankStore {
  const g = globalThis as typeof globalThis & { __oceanFishTank?: TankStore }
  const existing = g.__oceanFishTank
  if (existing && existing.sessions instanceof Map) return existing
  const fresh: TankStore = { sessions: new Map(), loaded: false }
  // carry over a legacy single-tank value if we can (best effort)
  if (existing && Array.isArray((existing as unknown as { designs?: unknown }).designs)) {
    fresh.loaded = (existing as unknown as { loaded?: boolean }).loaded === true
    try {
      fresh.sessions.set('main', {
        v: typeof (existing as unknown as { v?: number }).v === 'number' ? (existing as unknown as { v: number }).v : 1,
        designs: ((existing as unknown as { designs: FishDesign[] }).designs || [])
          .filter((d) => d && typeof d.id === 'string' && typeof d.url === 'string' && d.url.length <= MAX_DATAURL)
          .slice(0, MAX_DESIGNS),
      })
    } catch { /* never trust the stale value too hard */ }
  }
  g.__oceanFishTank = fresh
  return fresh
}

const FILE = () => path.join(process.cwd(), '.fish-tank.json')

function cleanSession(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 24) : ''
  return s || 'main'
}

function tankFor(session: string): Tank {
  const st = store()
  let t = st.sessions.get(session)
  if (!t) {
    t = { v: 1, designs: [] }
    st.sessions.set(session, t)
    // LRU cap — drop the least recently used session tanks
    while (st.sessions.size > MAX_SESSIONS) {
      const oldest = st.sessions.keys().next().value
      if (oldest === undefined) break
      st.sessions.delete(oldest)
    }
  }
  return t
}

async function loadOnce() {
  const st = store()
  if (st.loaded) return
  st.loaded = true
  try {
    const raw = await fs.readFile(FILE(), 'utf8')
    const data = JSON.parse(raw) as {
      designs?: FishDesign[]                       // legacy single-tank format
      sessions?: Record<string, { v?: number; designs?: FishDesign[] }>
    }
    if (Array.isArray(data.sessions) || data.sessions && typeof data.sessions === 'object') {
      for (const [sess, t] of Object.entries(data.sessions ?? {})) {
        if (!t || !Array.isArray(t.designs)) continue
        tankFor(cleanSession(sess)).designs = t.designs
          .filter((d) => d && typeof d.id === 'string' && typeof d.url === 'string' && d.url.length <= MAX_DATAURL)
          .slice(0, MAX_DESIGNS)
      }
    } else if (Array.isArray(data.designs)) {
      // pre-session tank → the 'main' session
      tankFor('main').designs = data.designs
        .filter((d) => d && typeof d.id === 'string' && typeof d.url === 'string' && d.url.length <= MAX_DATAURL)
        .slice(0, MAX_DESIGNS)
    }
  } catch { /* first boot / unreadable — start empty */ }
}

async function persist() {
  try {
    const st = store()
    const sessions: Record<string, { v: number; designs: FishDesign[] }> = {}
    for (const [sess, t] of st.sessions) sessions[sess] = { v: t.v, designs: t.designs }
    await fs.writeFile(FILE(), JSON.stringify({ sessions }), 'utf8')
  } catch { /* read-only fs etc. — memory store still works */ }
}

function sanitizeName(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : ''
  return (s || 'My fish').slice(0, 28)
}

function sanitizeUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.startsWith('data:image/')) return null
  if (raw.length > MAX_DATAURL) return null
  return raw
}

/** never let a thrown store error become an empty 500 — clients show the message */
function err(error: string, status = 500) {
  return Response.json({ ok: false, error }, { status })
}

export async function GET(req: Request) {
  try {
    await loadOnce()
    const url = new URL(req.url)
    const t = tankFor(cleanSession(url.searchParams.get('session')))
    if (url.searchParams.get('full')) {
      return Response.json({ v: t.v, designs: t.designs })
    }
    return Response.json({
      v: t.v,
      items: t.designs.map((d) => ({ id: d.id, name: d.name })),
    })
  } catch (e) {
    return err(`tank store error: ${String((e as Error)?.message ?? e)}`)
  }
}

export async function POST(req: Request) {
  try {
    await loadOnce()
    let body: { action?: string; session?: unknown; design?: { name?: unknown; dataUrl?: unknown }; id?: string }
    try {
      body = await req.json()
    } catch {
      return err('bad json', 400)
    }
    const t = tankFor(cleanSession(body.session))

    if (body.action === 'add' && body.design) {
      const url = sanitizeUrl(body.design.dataUrl)
      if (!url) return err('design must be an image data URL ≤ 480 KB', 400)
      const id = `fish-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
      const design: FishDesign = { id, name: sanitizeName(body.design.name), url, at: Date.now() }
      // newest wins — cap the tank and evict the oldest imports
      t.designs.push(design)
      while (t.designs.length > MAX_DESIGNS) t.designs.shift()
      t.v++
      void persist()
      return Response.json({ ok: true, v: t.v, id, designs: t.designs })
    }

    if (body.action === 'remove' && typeof body.id === 'string') {
      const before = t.designs.length
      t.designs = t.designs.filter((d) => d.id !== body.id)
      if (t.designs.length !== before) t.v++
      void persist()
      return Response.json({ ok: true, v: t.v, designs: t.designs })
    }

    if (body.action === 'clear') {
      t.designs = []
      t.v++
      void persist()
      return Response.json({ ok: true, v: t.v, designs: t.designs })
    }

    return err('unknown action', 400)
  } catch (e) {
    return err(`tank store error: ${String((e as Error)?.message ?? e)}`)
  }
}
