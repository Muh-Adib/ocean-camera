// ---------------------------------------------------------------
// ProjectManager — save / load / export / import of the projection
// configuration. JSON is the project format; localStorage keeps an
// autosave so the studio reopens exactly as the operator left it.
// ---------------------------------------------------------------
import {
  AUTOSAVE_KEY, PROJECT_VERSION, QUALITY_LEVELS, SESSIONS_KEY, clampNum,
  type OutputSessionMeta, type ProjectionOutput, type ProjectionProject,
  type ProjectionSurface, type QualityLevel,
} from './ProjectionTypes'
import { gridFromCorners, cornersFromGrid } from './ProjectionMath'
import { CalibrationManager } from './CalibrationManager'
import type { SurfaceManager } from './SurfaceManager'

export interface ProjectHost {
  surfaces: SurfaceManager
  output: ProjectionOutput
  setOutput(o: ProjectionOutput): void
  /** which surface carries the phone QR ('auto' = largest enabled) */
  qrHost: string
  setQrHost(host: string): void
}

/** one published output session — a full project snapshot under a stable id */
interface SessionRecord extends OutputSessionMeta {
  project: ProjectionProject
}

// ---------------------------------------------------------------- portable payloads
// Output links must survive OUTSIDE the control's browser — projectors are
// usually another machine. These helpers pack a whole project snapshot into a
// URL-safe string (deflate + base64url when CompressionStream exists) so the
// /output page can boot the exact show straight from the link itself.

function bytesToB64url(bytes: Uint8Array): string {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : ''
  const bin = atob(b64 + pad)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** pack a project into a portable string: "z…" deflate or "j…" raw JSON base64url */
export async function encodeProjectPayload(project: ProjectionProject): Promise<string> {
  const json = JSON.stringify(project)
  if (typeof CompressionStream !== 'undefined') {
    try {
      const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('deflate-raw'))
      const buf = await new Response(stream).arrayBuffer()
      return 'z' + bytesToB64url(new Uint8Array(buf))
    } catch { /* deflate unavailable — fall through to plain */ }
  }
  return 'j' + bytesToB64url(new TextEncoder().encode(json))
}

/** unpack a portable string back into a project (returns null when broken) */
export async function decodeProjectPayload(raw: string): Promise<ProjectionProject | null> {
  try {
    const mode = raw[0]
    const bytes = b64urlToBytes(raw.slice(1))
    let text: string
    if (mode === 'z' && typeof DecompressionStream !== 'undefined') {
      const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
      text = new TextDecoder().decode(await new Response(stream).arrayBuffer())
    } else {
      text = new TextDecoder().decode(bytes)
    }
    const parsed = JSON.parse(text) as ProjectionProject
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

/** portable links cap — beyond this some browsers / QR tools choke on the URL */
export const PORTABLE_LINK_LIMIT = 24000

export const SESSION_ID_RE = /^[a-z0-9][a-z0-9-]{4,48}$/

export class ProjectManager {
  /** fired after every successful localStorage persist (studio → /output live sync) */
  onSave: ((project: ProjectionProject) => void) | null = null

  constructor(private host: ProjectHost) {}

  // ------------------------------------------------------------ sessions
  // Published output sessions: each one is a full project snapshot with a
  // stable id — reopenable from any tab via /output?s=<id>, independent of
  // the studio, and loadable back into the studio to continue editing.

  private readRegistry(): Record<string, SessionRecord> {
    try {
      const raw = localStorage.getItem(SESSIONS_KEY)
      if (!raw) return {}
      const reg = JSON.parse(raw) as Record<string, SessionRecord>
      return reg && typeof reg === 'object' ? reg : {}
    } catch { return {} }
  }

  private writeRegistry(reg: Record<string, SessionRecord>) {
    try { localStorage.setItem(SESSIONS_KEY, JSON.stringify(reg)) } catch { /* storage full — non-fatal */ }
  }

  /** all published sessions, newest update first */
  listSessions(): OutputSessionMeta[] {
    return Object.values(this.readRegistry())
      .map(({ id, name, createdAt, updatedAt }) => ({ id, name, createdAt, updatedAt }))
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  getSession(id: string): (OutputSessionMeta & { project: ProjectionProject }) | null {
    const rec = this.readRegistry()[id]
    return rec ? { id: rec.id, name: rec.name, createdAt: rec.createdAt, updatedAt: rec.updatedAt, project: rec.project } : null
  }

  /**
   * Publish the current project as a named session. Publishing again with
   * the same name (or an explicit id) UPDATES that session in place so its
   * /output?s=<id> link keeps working with the newest settings.
   */
  saveSession(name: string, id?: string): OutputSessionMeta | null {
    const cleanName = (name || '').trim().slice(0, 48) || 'Output session'
    const reg = this.readRegistry()
    const key = id && reg[id] ? id : Object.values(reg).find((r) => r.name === cleanName)?.id
    const now = Date.now()
    const rec: SessionRecord = key && reg[key]
      ? { ...reg[key], name: cleanName, updatedAt: now, project: this.serialize() }
      : { id: `sess-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`, name: cleanName, createdAt: now, updatedAt: now, project: this.serialize() }
    reg[rec.id] = rec
    this.writeRegistry(reg)
    return { id: rec.id, name: rec.name, createdAt: rec.createdAt, updatedAt: rec.updatedAt }
  }

  /** restore a published session into the live project (studio or /output) */
  loadSession(id: string): boolean {
    const rec = this.readRegistry()[id]
    if (!rec) return false
    return this.load(rec.project)
  }

  /**
   * Replace the stored snapshot of a published session. Live studio pushes
   * keep a session link's settings current even without an explicit
   * republish — reloading the link boots the newest state the operator set.
   */
  updateSessionProject(id: string, project: ProjectionProject): boolean {
    const reg = this.readRegistry()
    if (!reg[id]) return false
    reg[id] = { ...reg[id], project }
    this.writeRegistry(reg)
    return true
  }

  deleteSession(id: string): boolean {
    const reg = this.readRegistry()
    if (!reg[id]) return false
    delete reg[id]
    this.writeRegistry(reg)
    return true
  }

  /**
   * Install a session record that arrived OUTSIDE this browser — a portable
   * /output?s=…&d=… link carries its own snapshot. Seeding the registry makes
   * the overlay's session picker work and a plain /output?s=<id> reload boot
   * the same show even when the long URL was trimmed.
   */
  seedSession(id: string, name: string, project: ProjectionProject): void {
    if (!SESSION_ID_RE.test(id)) return
    try {
      const reg = this.readRegistry()
      const now = Date.now()
      const prev = reg[id]
      reg[id] = prev
        ? { ...prev, name, project }
        : { id, name, createdAt: now, updatedAt: now, project }
      this.writeRegistry(reg)
    } catch { /* storage full — the URL itself still carries the data */ }
  }

  serialize(): ProjectionProject {
    return {
      version: PROJECT_VERSION,
      output: { ...this.host.output },
      surfaces: this.host.surfaces.serialize(),
      qr: { host: this.host.qrHost },
    }
  }

  /** sanitize + apply a project (import / autosave). Returns success. */
  load(raw: unknown): boolean {
    if (!raw || typeof raw !== 'object') return false
    const p = raw as Partial<ProjectionProject>
    if (!Array.isArray(p.surfaces)) return false

    const surfaces: ProjectionSurface[] = []
    for (const item of p.surfaces) {
      try {
        const s = sanitizeSurface(item)
        if (s) surfaces.push(s)
      } catch { /* skip broken surface */ }
    }
    if (!surfaces.length) return false

    const out = p.output ?? ({} as Partial<ProjectionOutput>)
    const quality = QUALITY_LEVELS.includes(out.quality as never) ? (out.quality as QualityLevel) : 'balanced'
    this.host.setOutput({
      width: clampNum(out.width, 1920, 320, 16384),
      height: clampNum(out.height, 1080, 240, 8640),
      renderScale: clampNum(out.renderScale, 0.6, 0.1, 1),
      quality,
    })
    this.host.surfaces.replaceAll(surfaces)
    // QR host setting — 'auto' or a surface id (fall back to auto when stale)
    const qh = typeof p.qr?.host === 'string' ? p.qr.host : 'auto'
    this.host.setQrHost(qh === 'auto' || surfaces.some((s) => s.id === qh) ? qh : 'auto')
    return true
  }

  // ------------------------------------------------------------ autosave
  saveLocal() {
    try {
      const project = this.serialize()
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(project))
      this.onSave?.(project)
    } catch { /* storage full / disabled — non-fatal */ }
  }

  loadLocal(): boolean {
    try {
      const raw = localStorage.getItem(AUTOSAVE_KEY)
      if (!raw) return false
      return this.load(JSON.parse(raw))
    } catch {
      return false
    }
  }

  clearLocal() {
    try { localStorage.removeItem(AUTOSAVE_KEY) } catch { /* noop */ }
  }

  // ------------------------------------------------------------ files
  exportFile() {
    const blob = new Blob([JSON.stringify(this.serialize(), null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'ocean-projection.project.json'
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 4000)
  }

  importFile(): Promise<boolean> {
    return new Promise((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.json,application/json'
      input.onchange = async () => {
        const file = input.files?.[0]
        if (!file) { resolve(false); return }
        try {
          const text = await file.text()
          resolve(this.load(JSON.parse(text)))
        } catch {
          resolve(false)
        }
      }
      input.click()
    })
  }
}

// ---------------------------------------------------------------- sanitize
function sanitizeSurface(raw: unknown): ProjectionSurface | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const out = (r.output ?? {}) as Record<string, unknown>
  const cam = (r.camera ?? {}) as Record<string, unknown>
  const warp = (r.warp ?? {}) as Record<string, unknown>
  const blend = (r.blend ?? {}) as Record<string, unknown>
  const feather = (blend.feather ?? {}) as Record<string, unknown>
  const pos = (cam.position ?? []) as unknown[]

  const width = clampNum(out.width, 800, 32, 16384)
  const height = clampNum(out.height, 600, 32, 8640)
  const rect = {
    x: clampNum(out.x, 0, -16384, 16384),
    y: clampNum(out.y, 0, -16384, 16384),
    width,
    height,
    ...(out.lockAspect === true ? { lockAspect: true } : {}),
  }
  const res = [1, 2, 4, 6, 8, 12, 16].includes(clampNum(warp.gridResolution, 8, 1, 16))
    ? clampNum(warp.gridResolution, 8, 1, 16) : 8

  const s: ProjectionSurface = {
    id: typeof r.id === 'string' && r.id ? r.id : `surf-import-${Math.random().toString(36).slice(2, 9)}`,
    name: typeof r.name === 'string' && r.name ? r.name.slice(0, 48) : 'Surface',
    enabled: r.enabled !== false,
    locked: r.locked === true,
    output: rect,
    camera: {
      position: [
        clampNum(pos[0], 0, -500, 500),
        clampNum(pos[1], 2.2, -500, 500),
        clampNum(pos[2], 0, -500, 500),
      ],
      yaw: clampNum(cam.yaw, 0, -720, 720),
      pitch: clampNum(cam.pitch, 0, -95, 95),
      fov: clampNum(cam.fov, 60, 8, 150),
      near: clampNum(cam.near, 0.1, 0.01, 100),
      far: clampNum(cam.far, 300, 10, 2000),
      span: {
        h: clampNum((cam.span as { h?: unknown } | undefined)?.h, 60, 4, 359),
        v: clampNum((cam.span as { v?: unknown } | undefined)?.v, 60, 4, 179),
        lock: (cam.span as { lock?: unknown } | undefined)?.lock === true,
      },
    },
    warp: {
      corners: { tl: { x: 0, y: 0 }, tr: { x: 0, y: 0 }, br: { x: 0, y: 0 }, bl: { x: 0, y: 0 } },
      gridResolution: res,
      grid: [],
      gridCustom: warp.gridCustom === true,
    },
    blend: {
      opacity: clampNum(blend.opacity, 1, 0, 1),
      brightness: clampNum(blend.brightness, 1, 0.2, 2.5),
      gamma: clampNum(blend.gamma, 1, 0.3, 2.8),
      feather: {
        left: clampNum(feather.left, 0, 0, 0.45),
        right: clampNum(feather.right, 0, 0, 0.45),
        top: clampNum(feather.top, 0, 0, 0.45),
        bottom: clampNum(feather.bottom, 0, 0, 0.45),
      },
      mode: blend.mode === 'add' ? 'add' : blend.mode === 'screen' ? 'screen' : 'normal',
    },
    calibration: CalibrationManager.patternList.includes(r.calibration as never)
      ? (r.calibration as ProjectionSurface['calibration']) : 'off',
  }

  // grid: accept a stored grid if it matches res, else rebuild from corners
  const gridRaw = warp.grid
  if (Array.isArray(gridRaw) && gridRaw.length === (res + 1) * (res + 1) && warp.gridCustom === true) {
    s.warp.grid = (gridRaw as { x: unknown; y: unknown }[]).map((p) => ({
      x: clampNum(p?.x, 0, -16384, 32768),
      y: clampNum(p?.y, 0, -16384, 32768),
    }))
  } else if (Array.isArray(gridRaw) && gridRaw.length === (res + 1) * (res + 1)) {
    s.warp.grid = (gridRaw as { x: unknown; y: unknown }[]).map((p) => ({
      x: clampNum(p?.x, 0, -16384, 32768),
      y: clampNum(p?.y, 0, -16384, 32768),
    }))
  } else {
    // legacy/partial: corners stored separately or default to the rect
    const c = (warp.corners ?? {}) as Record<string, { x?: unknown; y?: unknown }>
    s.warp.corners = {
      tl: { x: clampNum(c.tl?.x, rect.x, -16384, 32768), y: clampNum(c.tl?.y, rect.y, -16384, 32768) },
      tr: { x: clampNum(c.tr?.x, rect.x + width, -16384, 32768), y: clampNum(c.tr?.y, rect.y, -16384, 32768) },
      br: { x: clampNum(c.br?.x, rect.x + width, -16384, 32768), y: clampNum(c.br?.y, rect.y + height, -16384, 32768) },
      bl: { x: clampNum(c.bl?.x, rect.x, -16384, 32768), y: clampNum(c.bl?.y, rect.y + height, -16384, 32768) },
    }
    s.warp.grid = gridFromCorners(s.warp.corners, res)
    s.warp.gridCustom = false
    return s
  }
  s.warp.corners = cornersFromGrid(s.warp.grid, res)
  return s
}
