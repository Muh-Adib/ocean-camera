// ---------------------------------------------------------------
// FishDirector — per-school movement choreography state.
//
// Every school (reef species group or painted design) can be
// individually directed:
//   · visible        — show / hide the school
//   · anchor         — location; fish SWIM to a new anchor (never teleport)
//   · heading        — rotation: compass bias the school faces when free
//   · speedMul       — per-school speed multiplier
//   · flow           — movement flow: FREE / PATROL (waypoints) /
//                      ORBIT ring / FIGURE-8
//
// State is a small JSON document per SHOW SESSION. It persists to
// localStorage (instant restore) and syncs through the fish-tank
// API (studio edits reach every /output screen in seconds).
// ---------------------------------------------------------------
import type { FishManager } from './FishManager'

export type FlowMode = 'free' | 'patrol' | 'orbit' | 'figure8'

export interface SchoolFlow {
  mode: FlowMode
  points: [number, number, number][]   // patrol waypoints (world space)
  loop: boolean                        // closed loop vs ping-pong
  speed: number                        // m/s along the flow
  radius: number                       // orbit / figure-8 radius (m)
}

export interface SchoolSetting {
  visible: boolean
  anchor: [number, number, number]
  heading: number                      // degrees 0..360
  speedMul: number
  flow: SchoolFlow
}

export interface DirectorState {
  v: 1
  schools: Record<string, SchoolSetting>
}

export const DEFAULT_FLOW: SchoolFlow = { mode: 'free', points: [], loop: true, speed: 2.2, radius: 7 }

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))

function clampXYZ(raw: unknown, fb: [number, number, number]): [number, number, number] {
  if (!Array.isArray(raw) || raw.length < 3) return fb
  const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : fb[0])
  return [clamp(n(raw[0]), -75, 75), clamp(n(raw[1]), -12, 15), clamp(n(raw[2]), -95, 15)]
}

function sanitizeFlow(raw: unknown): SchoolFlow {
  const f = (raw ?? {}) as Record<string, unknown>
  const mode: FlowMode = f.mode === 'patrol' || f.mode === 'orbit' || f.mode === 'figure8' ? f.mode : 'free'
  let points: [number, number, number][] = []
  if (Array.isArray(f.points)) {
    for (const p of f.points.slice(0, 12)) {
      points.push(clampXYZ(p, [0, 2, -30]))
    }
  }
  if (mode === 'patrol' && points.length < 2) {
    return { mode: 'free', points: [], loop: f.loop !== false, speed: clamp(typeof f.speed === 'number' && Number.isFinite(f.speed) ? f.speed : 2.2, 0.3, 10), radius: clamp(typeof f.radius === 'number' && Number.isFinite(f.radius) ? f.radius : 7, 2, 55) }
  }
  return {
    mode,
    points,
    loop: f.loop !== false,
    speed: clamp(typeof f.speed === 'number' && Number.isFinite(f.speed) ? f.speed : 2.2, 0.3, 10),
    radius: clamp(typeof f.radius === 'number' && Number.isFinite(f.radius) ? f.radius : 7, 2, 55),
  }
}

function sanitizeSetting(raw: unknown): SchoolSetting | null {
  if (!raw || typeof raw !== 'object') return null
  const s = raw as Record<string, unknown>
  return {
    visible: s.visible !== false,
    anchor: clampXYZ(s.anchor, [0, 2, -25]),
    heading: clamp(typeof s.heading === 'number' && Number.isFinite(s.heading) ? s.heading : 0, 0, 360),
    speedMul: clamp(typeof s.speedMul === 'number' && Number.isFinite(s.speedMul) ? s.speedMul : 1, 0.2, 3),
    flow: sanitizeFlow(s.flow),
  }
}

function sanitizeState(raw: unknown): DirectorState {
  const schools: Record<string, SchoolSetting> = {}
  if (raw && typeof raw === 'object') {
    const rec = (raw as Record<string, unknown>).schools
    if (rec && typeof rec === 'object') {
      for (const [id, val] of Object.entries(rec).slice(0, 200)) {
        if (typeof id !== 'string' || !id) continue
        const s = sanitizeSetting(val)
        if (s) schools[id] = s
      }
    }
  }
  return { v: 1, schools }
}

export class FishDirector {
  /** fired after every LOCAL edit (studio) — host pushes it to the server */
  onLocalChange: ((state: DirectorState) => void) | null = null

  private state: DirectorState = { v: 1, schools: {} }
  private session: string

  constructor(private fish: FishManager, session: string) {
    this.session = session
    this.loadLocal()
    this.applyAll()
  }

  // ------------------------------------------------------------ session
  /** switch show session — reload that session's saved choreography */
  setSession(id: string) {
    if (id === this.session) return
    this.session = id
    this.loadLocal()
    this.applyAll()
  }

  private key(): string {
    return `ocean-fish-director:${this.session}`
  }

  private loadLocal() {
    try {
      const raw = localStorage.getItem(this.key())
      this.state = raw ? sanitizeState(JSON.parse(raw)) : { v: 1, schools: {} }
    } catch {
      this.state = { v: 1, schools: {} }
    }
  }

  private persistLocal() {
    try { localStorage.setItem(this.key(), JSON.stringify(this.state)) } catch { /* private mode */ }
  }

  // ------------------------------------------------------------ reads
  exportState(): DirectorState {
    return JSON.parse(JSON.stringify(this.state)) as DirectorState
  }

  get(id: string): SchoolSetting {
    return this.state.schools[id] ?? {
      visible: true, anchor: [0, 2, -25], heading: 0, speedMul: 1, flow: { ...DEFAULT_FLOW, points: [] },
    }
  }

  /** settings merged with live FishManager metadata — the UI / QA list */
  list() {
    const meta = this.fish.schoolList()
    return meta.map((m) => {
      const s = this.state.schools[m.id]
      return {
        ...m,
        visible: s ? s.visible : m.visible,
        anchor: s ? s.anchor : m.anchor,
        heading: s ? s.heading : (m.headingDeg ?? 0),
        speedMul: s ? s.speedMul : m.speedMul,
        flow: s ? s.flow.mode : m.route,
        flowDetail: s ? s.flow : null,
        custom: m.id.startsWith('custom:'),
      }
    })
  }

  // ------------------------------------------------------------ writes
  /** merge a partial setting onto a school, apply + persist + broadcast */
  patch(id: string, partial: {
    visible?: boolean
    anchor?: [number, number, number]
    heading?: number
    speedMul?: number
    flow?: Partial<SchoolFlow>
  }): SchoolSetting {
    const cur = this.state.schools[id] ?? this.get(id)
    const next: SchoolSetting = {
      visible: partial.visible !== undefined ? !!partial.visible : cur.visible,
      anchor: partial.anchor ? clampXYZ(partial.anchor, cur.anchor) : cur.anchor,
      heading: partial.heading !== undefined ? clamp(partial.heading, 0, 360) : cur.heading,
      speedMul: partial.speedMul !== undefined ? clamp(partial.speedMul, 0.2, 3) : cur.speedMul,
      flow: partial.flow ? sanitizeFlow({ ...cur.flow, ...partial.flow }) : cur.flow,
    }
    this.state.schools[id] = next
    this.apply(id, next)
    this.persistLocal()
    this.onLocalChange?.(this.exportState())
    return next
  }

  /** convenience: set the flow mode (+ optional params) in one call */
  setFlow(id: string, mode: FlowMode, opts: { points?: [number, number, number][]; loop?: boolean; speed?: number; radius?: number } = {}) {
    return this.patch(id, { flow: { mode, ...opts } })
  }

  /** append a patrol waypoint (world coords) */
  addWaypoint(id: string, p: [number, number, number]) {
    const cur = this.get(id)
    const points = [...cur.flow.points, p].slice(-12)
    return this.patch(id, { flow: { points } })
  }

  /** clear one school back to show defaults */
  reset(id: string) {
    delete this.state.schools[id]
    const meta = this.fish.schoolList().find((m) => m.id === id)
    this.fish.applyChoreo(id, {
      visible: true,
      headingDeg: null,
      speedMul: 1,
      route: null,
      ...(meta ? { anchor: meta.anchor } : {}),
    })
    this.persistLocal()
    this.onLocalChange?.(this.exportState())
  }

  /** every school back to show defaults */
  resetAll() {
    for (const id of Object.keys(this.state.schools)) this.reset(id)
  }

  /** everything visible again (kept settings, visibility only) */
  showAll() {
    this.fish.showAllSchools()
    for (const id of Object.keys(this.state.schools)) {
      this.state.schools[id].visible = true
    }
    this.persistLocal()
    this.onLocalChange?.(this.exportState())
  }

  // ------------------------------------------------------------ application
  /** (re)apply every stored setting to the live FishManager */
  applyAll() {
    for (const [id, s] of Object.entries(this.state.schools)) this.apply(id, s)
  }

  private apply(id: string, s: SchoolSetting) {
    this.fish.applyChoreo(id, {
      visible: s.visible,
      anchor: s.anchor,
      headingDeg: s.heading || null,
      speedMul: s.speedMul,
      route: s.flow.mode === 'free'
        ? null
        : { mode: s.flow.mode, points: s.flow.points, loop: s.flow.loop, speed: s.flow.speed, radius: s.flow.radius },
    })
  }

  // ------------------------------------------------------------ remote sync
  /** full state arriving from the server (another machine edited) */
  importRemote(raw: unknown) {
    const next = sanitizeState(raw)
    this.state = next
    this.persistLocal()
    this.applyAll()
  }
}
