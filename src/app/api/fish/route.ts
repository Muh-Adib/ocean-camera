// ---------------------------------------------------------------
// /api/fish — the shared FISH TANK store.
//
// Painted fish designs (colouring-sheet photos turned into texture
// sheets) live here so EVERY screen of the show shows them: the
// studio imports, /output pages (even on other machines) poll the
// version and pull new designs — no reload, no pairing, nothing.
//
//   GET                → { v, items: [{ id, name }] }          (light poll)
//   GET ?full=1        → { v, designs: [{ id, name, url }] }   (full pull)
//   POST add           → { action:'add', design:{ name, dataUrl } }
//   POST remove        → { action:'remove', id }
//   POST clear         → { action:'clear' }
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
  loaded: boolean
}

const MAX_DESIGNS = 12
const MAX_DATAURL = 480_000   // ~480 KB per design keeps the poll cheap

/** one tank per server process */
function tank(): Tank {
  const g = globalThis as typeof globalThis & { __oceanFishTank?: Tank }
  if (!g.__oceanFishTank) g.__oceanFishTank = { v: 1, designs: [], loaded: false }
  return g.__oceanFishTank
}

const FILE = () => path.join(process.cwd(), '.fish-tank.json')

async function loadOnce() {
  const t = tank()
  if (t.loaded) return
  t.loaded = true
  try {
    const raw = await fs.readFile(FILE(), 'utf8')
    const data = JSON.parse(raw) as { designs?: FishDesign[] }
    if (Array.isArray(data.designs)) {
      t.designs = data.designs
        .filter((d) => d && typeof d.id === 'string' && typeof d.url === 'string' && d.url.length <= MAX_DATAURL)
        .slice(0, MAX_DESIGNS)
    }
  } catch { /* first boot / unreadable — start empty */ }
}

async function persist() {
  try {
    const t = tank()
    await fs.writeFile(FILE(), JSON.stringify({ v: t.v, designs: t.designs }), 'utf8')
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

export async function GET(req: Request) {
  await loadOnce()
  const t = tank()
  const url = new URL(req.url)
  if (url.searchParams.get('full')) {
    return Response.json({ v: t.v, designs: t.designs })
  }
  return Response.json({
    v: t.v,
    items: t.designs.map((d) => ({ id: d.id, name: d.name })),
  })
}

export async function POST(req: Request) {
  await loadOnce()
  let body: { action?: string; design?: { name?: unknown; dataUrl?: unknown }; id?: string }
  try {
    body = await req.json()
  } catch {
    return Response.json({ ok: false, error: 'bad json' }, { status: 400 })
  }
  const t = tank()

  if (body.action === 'add' && body.design) {
    const url = sanitizeUrl(body.design.dataUrl)
    if (!url) return Response.json({ ok: false, error: 'design must be an image data URL ≤ 480 KB' }, { status: 400 })
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

  return Response.json({ ok: false, error: 'unknown action' }, { status: 400 })
}
