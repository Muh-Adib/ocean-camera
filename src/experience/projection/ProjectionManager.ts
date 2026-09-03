// ---------------------------------------------------------------
// ProjectionManager — orchestrator of the projection mapping mode.
//
// One shared ocean world → N virtual cameras → N render targets →
// one composite pass in output space. Owns the mode lifecycle
// (studio / preview / live output), the editor viewport layouts,
// autosave, and the keyboard shortcuts (Enter = projection output,
// Esc = back to preview).
// ---------------------------------------------------------------
import * as THREE from 'three'
import gsap from 'gsap'
import type { SceneManager } from '../core/SceneManager'
import { SurfaceManager } from './SurfaceManager'
import { CameraManager } from './CameraManager'
import { BlendManager } from './BlendManager'
import { CalibrationManager } from './CalibrationManager'
import { OutputManager } from './OutputManager'
import { ProjectManager, encodeProjectPayload, decodeProjectPayload, PORTABLE_LINK_LIMIT } from './ProjectManager'
import { ProjectionEditorUI } from './ProjectionEditorUI'
import { PRESETS, getPreset } from './ProjectionPresets'
import { gridFromCorners } from './ProjectionMath'
import type { ProjectionOutput, ProjectionProject, ProjectionSurface, QualityLevel } from './ProjectionTypes'
import { QUALITY_LEVELS, QUALITY_PROFILES, resolveQuality } from './ProjectionTypes'

export interface ProjectionDeps {
  sceneMgr: SceneManager
  container: HTMLElement
  toast: (message: string, duration?: number) => void
  /** dedicated /output page: no editor chrome, composite only */
  outputOnly?: boolean
}

const AUTOSAVE_DELAY = 900
/** studio → /output live pushes stream at least this often while editing */
const BROADCAST_INTERVAL = 300
const SYNC_CHANNEL = 'ocean-projection-sync-v1'
/** studio heartbeat through the server relay — receivers keep their LIVE status */
const RELAY_HEARTBEAT = 4000
/**
 * without studio contact for this long, /output shows it is HOLDING the last
 * state. Wide on purpose: a HIDDEN control tab gets its 4 s heartbeat interval
 * throttled by Chromium down to ~1/minute (intensive wake-up throttling after
 * 5 min hidden). State pushes are event-driven and never throttle — only this
 * cosmetic marker needs the slack.
 */
const LIVE_FRESH_MS = 70000

export class ProjectionManager {
  /** studio open — the render pipeline is ours */
  active = false
  /** live OUTPUT — fullscreen composite for the projector */
  outputLive = false
  /** dedicated /output page mode (no editor UI, config arrives via sync) */
  outputOnly = false
  /** "view from camera" — editor viewport shows this surface's camera */
  viewThrough: string | null = null
  viewportLayout: 'single' | 'quad' | 'all' = 'single'
  showFrustums = true

  output: ProjectionOutput = { width: 1920, height: 1080, renderScale: 0.6, quality: 'balanced' }

  readonly surfaces = new SurfaceManager()
  private cameras: CameraManager
  private blend = new BlendManager()
  private calib = new CalibrationManager()
  private outputMgr: OutputManager
  project: ProjectManager
  private ui: ProjectionEditorUI | null = null
  private mainCamera: THREE.PerspectiveCamera

  private unsubs: (() => void)[] = []
  private autosaveTimer = 0
  private editingSession = false
  private channel: BroadcastChannel | null = null
  private overlay: HTMLElement | null = null
  private overlayTimer = 0
  private broadcastTimer = 0
  private lastBroadcastAt = 0
  /** /output tab adopted a live studio push (overlay shows LIVE LINK) */
  liveLinked = false
  /** /output booted from a portable link (?d=…) — settings live in the URL itself */
  portableBoot = false
  private portableUrlTimer = 0
  /** studio → server relay: true when the last POST succeeded */
  private relayLastOk: boolean | null = null
  private relayLastPostAt = 0
  /** /output ← server relay stream (crosses browsers & machines, unlike BroadcastChannel) */
  private relayES: EventSource | null = null
  private relayRev = 0
  private lastAppliedJson: string | null = null
  /** performance.now() of the last adopted push / studio heartbeat */
  private lastSyncAt = 0
  private hbTimer = 0
  /** MSAA render targets need float-buffer rendering support (already required by the HalfFloat RTs) */
  private msaaOK = true

  constructor(private deps: ProjectionDeps) {
    this.cameras = new CameraManager(deps.sceneMgr.scene)
    this.outputMgr = new OutputManager(this.blend, this.calib)
    this.outputMgr.maxTexSize = Math.min(deps.sceneMgr.renderer.capabilities.maxTextureSize || 4096, 8192)
    try { this.msaaOK = deps.sceneMgr.renderer.extensions.has('EXT_color_buffer_float') } catch { this.msaaOK = false }
    this.mainCamera = deps.sceneMgr.camera
    this.project = new ProjectManager({
      surfaces: this.surfaces,
      output: this.output,
      setOutput: (o) => { Object.assign(this.output, o); this.ui?.refreshAll() },
    })
    // studio side: every persisted save is also pushed to /output tabs live
    if (deps.outputOnly) this.outputOnly = true
    else {
      this.project.onSave = (project) => {
        try { this.channel?.postMessage({ type: 'project', project }) } catch { /* channel closed */ }
      }
    }

    // full data change → rebuild everything visual
    this.unsubs.push(this.surfaces.onChange(() => this.syncAll()))
    // light change (node drag / numeric edit) → visuals + a fast live push
    // + a debounced autosave, so /output streams the edit as it happens and
    // the config survives even a fast tab close
    this.unsubs.push(this.surfaces.onLightChange((s) => {
      this.syncVisuals(s)
      this.broadcastSoon()
      this.scheduleAutosave()
    }))

    window.addEventListener('resize', this.onResize)
    window.addEventListener('keydown', this.onKeyDown)
  }

  // ------------------------------------------------------------ lifecycle
  enter() {
    if (this.active) return
    this.active = true
    this.mainCamera.layers.enable(1)   // editor viewport sees camera frustums
    this.wireSyncChannel()
    this.startRelayHeartbeat()

    let restored = false
    if (this.surfaces.surfaces.length === 0) {
      restored = this.project.loadLocal()
      if (restored) this.deps.toast('Projection setup restored from autosave', 2600)
      else this.applyPreset('flat-screen', { history: false, toast: false })
    }
    this.syncAll()

    this.ui = new ProjectionEditorUI(this.deps.container, this)
    this.deps.toast(
      restored ? 'Projection studio ready' : 'Projection studio — pick a preset, drag the corners to match your room',
      4200,
    )
    gsap.fromTo(this.ui.root, { opacity: 0 }, { opacity: 1, duration: 0.5, ease: 'power2.out' })
  }

  exit() {
    if (!this.active) return
    if (this.outputLive) this.setOutputLive(false)
    this.active = false
    this.viewThrough = null
    this.mainCamera.layers.disable(1)
    this.cameras.setHelpersVisibleAll(false)
    this.channel?.close()
    this.channel = null
    window.clearInterval(this.hbTimer)
    this.hbTimer = 0
    // the /output page must never write the studio's autosave — it only
    // borrows state (disposal of an output page would otherwise clobber it)
    if (!this.outputOnly) this.project.saveLocal()
    if (this.ui) {
      const el = this.ui
      this.ui = null
      gsap.to(el.root, {
        opacity: 0, duration: 0.35, ease: 'power2.in',
        onComplete: () => el.dispose(),
      })
    }
  }

  toggle() {
    if (this.active) this.exit()
    else this.enter()
  }

  // ------------------------------------------------------------ dedicated /output page
  /**
   * Boot straight into the clean projection composite: no editor, no HUD —
   * just the picture. A session link (/output?s=<id>) locks the feed to that
   * published session — it renders those exact settings forever, even with
   * the studio closed. Without a session it reads the autosave and accepts
   * live pushes from an open studio tab. A small auto-hiding overlay lets
   * the operator switch sessions, change quality and show calibration
   * patterns in place.
   */
  enterOutputOnly() {
    if (this.active) return
    this.active = true
    this.outputOnly = true

    const params = new URLSearchParams(window.location.search)
    const sid = params.get('s')
    const payload = params.get('d')
    let restored = false
    let missingSession = false

    // 1) portable link — the whole project snapshot rides INSIDE the URL, so
    //    this works on any machine, any browser, even with zero shared storage
    if (payload) {
      void decodeProjectPayload(payload).then((project) => {
        if (!project) return
        if (this.project.load(project)) {
          this.portableBoot = true
          // seed the local registry so the session picker works and a trimmed
          // /output?s=<id> reload still boots the same show
          if (sid && /^[a-z0-9][a-z0-9-]{4,48}$/.test(sid)) {
            const name = (params.get('n') || 'Portable session').slice(0, 48)
            this.project.seedSession(sid, name, project)
            this.currentSession = { id: sid, name }
          }
          this.overlay?.querySelector('.pm-out-warn')?.remove()
          this.syncAll()
          this.syncOutputOverlay()
        }
      })
    }

    // 2) published session from this browser's registry
    if (!restored && sid) {
      const rec = this.project.getSession(sid)
      if (rec) {
        restored = this.project.loadSession(sid)
        if (restored) this.currentSession = { id: sid, name: rec.name }
      } else {
        missingSession = true
      }
    }
    if (!restored && !payload) {
      restored = this.project.loadLocal()
      if (!restored) this.applyPreset('flat-screen', { history: false, toast: false })
    }

    this.wireSyncChannel()
    this.wireRelay()
    this.syncAll()
    this.setOutputLive(true)
    this.buildOutputOverlay(restored, missingSession)

    // ?pattern=grid — start with a calibration pattern already up
    const pattern = params.get('pattern')
    if (pattern && CalibrationManager.patternList.includes(pattern as never)) {
      this.setCalibrationAll(pattern as ProjectionSurface['calibration'])
      this.syncOutputOverlay()
    }
  }

  /**
   * A self-contained output link: /output?s=<id>&n=<name>&d=<snapshot>.
   * The projector machine needs NOTHING else — no shared storage, no open
   * control tab — the show settings travel inside the URL itself.
   * Falls back to the registry link when the snapshot would make the URL
   * impractically long (huge meshes).
   */
  async portableSessionLink(id: string, name?: string): Promise<string> {
    const rec = this.project.getSession(id)
    const base = `${location.origin}/output?s=${id}`
    if (!rec) return base
    const label = encodeURIComponent((name ?? rec.name).slice(0, 48))
    try {
      const payload = await encodeProjectPayload(rec.project)
      const url = `${base}&n=${label}&d=${payload}`
      if (url.length <= PORTABLE_LINK_LIMIT) return url
    } catch { /* encode failed — registry link still works same-browser */ }
    return base
  }

  /** live link between the studio tab and /output tabs (same browser) */
  private wireSyncChannel() {
    try { this.channel = new BroadcastChannel(SYNC_CHANNEL) } catch { return }
    this.channel.onmessage = (e) => {
      const msg = e.data as { type?: string; project?: unknown } | null
      if (!msg) return
      if (this.outputOnly && msg.type === 'project' && msg.project) {
        // The studio is the live master: /output always follows it — plain
        // tabs and session-linked tabs alike, so the picture always matches
        // the operator's full settings. With the control closed nothing
        // arrives and the boot state (published session / autosave) keeps
        // running untouched — the show never dies when the studio leaves.
        this.applyStudioPush(msg.project)
      } else if (!this.outputOnly && msg.type === 'request') {
        try { this.channel?.postMessage({ type: 'project', project: this.project.serialize() }) } catch { /* noop */ }
      }
    }
    if (this.outputOnly) {
      // adopt the live studio state immediately when one is open
      try { this.channel.postMessage({ type: 'request' }) } catch { /* noop */ }
    }
  }

  /**
   * Server relay subscriber — the bridge that keeps /output in sync across
   * DIFFERENT browsers and machines: the studio POSTs every state change
   * (plus a 4 s heartbeat) and this EventSource delivers it here. Same
   * apply path as the BroadcastChannel, so both transports can coexist —
   * duplicate deliveries collapse on the identical-payload guard.
   */
  private wireRelay() {
    if (typeof EventSource === 'undefined') return
    try { this.relayES = new EventSource('/api/projection/relay/stream') } catch { return }
    this.relayES.addEventListener('relay', (e) => {
      try {
        const msg = JSON.parse((e as MessageEvent).data as string) as { rev?: number; project?: unknown }
        if (!msg?.project) return
        this.relayRev = msg.rev ?? this.relayRev
        this.applyStudioPush(msg.project)
      } catch { /* malformed event — skip */ }
    })
    this.relayES.addEventListener('hb', () => {
      this.lastSyncAt = performance.now()
      this.syncOutputOverlay()
    })
  }

  /** adopt a push from any live transport (BroadcastChannel or server relay) */
  private applyStudioPush(project: unknown): boolean {
    // identical payload twice (channel + relay racing) — nothing to do
    let json: string
    try { json = JSON.stringify(project) } catch { return false }
    if (json === this.lastAppliedJson) { this.lastSyncAt = performance.now(); return this.liveLinked }

    this.liveLinked = this.project.load(project)
    if (this.liveLinked) {
      this.lastAppliedJson = json
      this.lastSyncAt = performance.now()
      // keep the published session's stored settings current — reloading
      // the link boots the newest state the operator pushed, even if the
      // studio closed without republishing
      if (this.currentSession) {
        try { this.project.updateSessionProject(this.currentSession.id, project as never) } catch { /* noop */ }
      }
      // portable boots keep their URL fresh too — the bookmarked link
      // always reopens the newest show, even on a machine with no registry
      if (this.portableBoot) this.schedulePortableUrlRefresh()
      this.syncOutputOverlay()
    }
    return this.liveLinked
  }

  /** trailing refresh of the ?d= payload after live pushes (portable boots) */
  private schedulePortableUrlRefresh() {
    window.clearTimeout(this.portableUrlTimer)
    this.portableUrlTimer = window.setTimeout(() => {
      if (!this.currentSession) return
      void this.portableSessionLink(this.currentSession.id, this.currentSession.name).then((url) => {
        if (!url.includes('&d=') || url === location.href) return
        try { window.history.replaceState(null, '', url) } catch { /* noop */ }
      })
    }, 1400)
  }

  /** auto-hiding settings overlay for the output page */
  private buildOutputOverlay(restored: boolean, missingSession = false) {
    const el = document.createElement('div')
    el.id = 'pm-out-overlay'
    el.innerHTML = `
      <div class="pm-out-panel">
        <span class="pm-out-title">PROJECTION OUTPUT</span>
        <span class="pm-out-info" id="pm-out-info"></span>
        <label class="pm-out-field">SESSION
          <select id="pm-out-session" class="pm-select pm-select-sm"></select>
        </label>
        <label class="pm-out-field">QUALITY
          <select id="pm-out-quality" class="pm-select pm-select-sm">
            <option value="auto">AUTO (ADAPTIVE)</option>
            <option value="performance">PERFORMANCE</option>
            <option value="balanced">BALANCED</option>
            <option value="high">HIGH</option>
            <option value="ultra">ULTRA</option>
          </select>
        </label>
        <label class="pm-out-field">PATTERN
          <select id="pm-out-pattern" class="pm-select pm-select-sm">
            ${CalibrationManager.patternList.map((p) => `<option value="${p}">${p.toUpperCase()}</option>`).join('')}
          </select>
        </label>
        <button class="pm-btn pm-btn-sm" id="pm-out-fullscreen">FULLSCREEN</button>
        <button class="pm-btn pm-btn-sm" id="pm-out-import">IMPORT .JSON</button>
        ${missingSession
          ? '<span class="pm-out-warn">session link not found — pick a session below or import a .json</span>'
          : restored ? '' : '<span class="pm-out-warn">no saved project — open the studio or import a .json</span>'}
      </div>`
    this.deps.container.appendChild(el)
    this.overlay = el

    el.querySelector('#pm-out-session')?.addEventListener('change', (e) => {
      const id = (e.target as HTMLSelectElement).value
      if (!id) return
      if (this.loadSession(id)) {
        const rec = this.project.getSession(id)
        if (rec) this.currentSession = { id: rec.id, name: rec.name }
        this.liveLinked = false   // switched back to the published snapshot
      }
      this.syncOutputOverlay()
    })
    el.querySelector('#pm-out-quality')?.addEventListener('change', (e) => {
      this.setQuality((e.target as HTMLSelectElement).value as QualityLevel)
    })
    el.querySelector('#pm-out-pattern')?.addEventListener('change', (e) => {
      this.setCalibrationAll((e.target as HTMLSelectElement).value as ProjectionSurface['calibration'])
    })
    el.querySelector('#pm-out-fullscreen')?.addEventListener('click', () => this.requestFullscreen())
    el.querySelector('#pm-out-import')?.addEventListener('click', async () => {
      const ok = await this.project.importFile()
      this.syncOutputOverlay()
      if (ok) this.deps.toast('Project imported', 2200)
    })

    const poke = () => this.pokeOverlay()
    window.addEventListener('mousemove', poke)
    window.addEventListener('touchstart', poke, { passive: true })
    this.unsubs.push(() => {
      window.removeEventListener('mousemove', poke)
      window.removeEventListener('touchstart', poke)
    })
    this.syncOutputOverlay()
    this.pokeOverlay()
  }

  private syncOutputOverlay() {
    if (!this.overlay) return
    const info = this.overlay.querySelector('#pm-out-info')
    const sel = this.overlay.querySelector('#pm-out-pattern') as HTMLSelectElement | null
    const qsel = this.overlay.querySelector('#pm-out-quality') as HTMLSelectElement | null
    const ssel = this.overlay.querySelector('#pm-out-session') as HTMLSelectElement | null
    if (info) {
      const n = this.surfaces.surfaces.filter((s) => s.enabled).length
      const rt = this.effectiveRT()
      const rtTxt = rt ? ` · RT ${rt.w}×${rt.h}${rt.msaa ? ` ${rt.msaa}×AA` : ''}` : ''
      const sess = this.currentSession ? `SESSION "${this.currentSession.name}" · ` : ''
      const portable = this.portableBoot ? 'PORTABLE LINK · ' : ''
      const live = this.liveLinked ? (this.liveFresh() ? 'LIVE LINK · ' : 'HOLDING · ') : ''
      info.textContent = `${sess}${portable}${live}${n} surface${n === 1 ? '' : 's'} · ${this.output.width}×${this.output.height} · ${this.qualityLabel()}${rtTxt}`
    }
    if (ssel) this.refreshSessionSelect(ssel)
    if (qsel) {
      const cur = this.output.quality
      if (cur === 'custom' && !qsel.querySelector('option[value="custom"]')) {
        const o = document.createElement('option')
        o.value = 'custom'
        o.textContent = 'CUSTOM'
        qsel.appendChild(o)
      }
      qsel.value = cur === 'custom' ? 'custom' : cur
    }
    if (sel && this.surfaces.surfaces.length) {
      sel.value = this.surfaces.surfaces[0].calibration
    }
  }

  /** studio contact within the freshness window? (pushes + relay heartbeat) */
  private liveFresh(): boolean {
    return this.lastSyncAt > 0 && performance.now() - this.lastSyncAt < LIVE_FRESH_MS
  }

  /** rebuild the session list (published sessions can appear while running) */
  private refreshSessionSelect(ssel: HTMLSelectElement) {
    const sessions = this.project.listSessions()
    ssel.innerHTML = ''
    if (!sessions.length) {
      const o = document.createElement('option')
      o.value = ''
      o.textContent = 'NO SESSIONS PUBLISHED'
      ssel.appendChild(o)
      return
    }
    for (const s of sessions) {
      const o = document.createElement('option')
      o.value = s.id
      o.textContent = s.name
      ssel.appendChild(o)
    }
    ssel.value = this.currentSession && sessions.some((s) => s.id === this.currentSession!.id)
      ? this.currentSession.id
      : sessions[0].id
  }

  private pokeOverlay() {
    if (!this.outputOnly || !this.overlay) return
    // sessions may have been published elsewhere since the last look
    const ssel = this.overlay.querySelector('#pm-out-session') as HTMLSelectElement | null
    if (ssel && this.overlay.classList.contains('pm-out-visible') !== true) this.refreshSessionSelect(ssel)
    this.overlay.classList.add('pm-out-visible')
    document.body.classList.add('pm-out-interacting')
    window.clearTimeout(this.overlayTimer)
    this.overlayTimer = window.setTimeout(() => {
      this.overlay?.classList.remove('pm-out-visible')
      document.body.classList.remove('pm-out-interacting')
    }, 2600)
  }

  // ------------------------------------------------------------ data sync
  private syncAll() {
    const ids = new Set<string>()
    this.surfaces.surfaces.forEach((s, i) => {
      ids.add(s.id)
      this.cameras.sync(s)
      this.outputMgr.syncSurface(s, i)
    })
    for (const id of this.outputMgr.getSurfaceIds()) {
      if (!ids.has(id)) {
        this.cameras.remove(id)
        this.outputMgr.removeSurface(id)
      }
    }
    this.cameras.updateVisibility(this.surfaces.selectedId, this.active && this.showFrustums)
    this.broadcastSoon()
    this.scheduleAutosave()
  }

  private syncVisuals(s: ProjectionSurface) {
    this.cameras.sync(s)
    this.outputMgr.invalidateGeometry(s.id)
    this.outputMgr.syncSurface(s, this.surfaces.surfaces.indexOf(s))
  }

  /** last renderFrame cost in ms — the UI backs its GPU readbacks off when high */
  frameCost = 0
  /** QA/testing: freeze the expensive per-surface re-renders, keep compositing
   *  the already-rendered targets (lets automated tests run logic at speed) */
  qaFrozen = false

  private scheduleAutosave() {
    // the /output page never persists — it must not clobber the studio's config
    if (this.outputOnly) return
    window.clearTimeout(this.autosaveTimer)
    this.autosaveTimer = window.setTimeout(() => this.project.saveLocal(), AUTOSAVE_DELAY)
  }

  // -------- studio → /output live link (fast, independent of the autosave) ----
  /**
   * Push the current project to open /output tabs within ~300 ms of any
   * change. Trailing-correct: a burst of drag frames always ends with a
   * final push, and the fast path is never blocked by the slower 900 ms
   * localStorage autosave debounce.
   */
  private broadcastSoon() {
    if (this.outputOnly) return
    const wait = Math.max(0, BROADCAST_INTERVAL - (performance.now() - this.lastBroadcastAt))
    window.clearTimeout(this.broadcastTimer)
    this.broadcastTimer = window.setTimeout(() => this.broadcastNow(), wait)
  }

  private broadcastNow() {
    if (this.outputOnly) return
    window.clearTimeout(this.broadcastTimer)
    this.lastBroadcastAt = performance.now()
    const project = this.project.serialize()
    try { this.channel?.postMessage({ type: 'project', project }) } catch { /* channel closed */ }
    this.relayPost(project)
  }

  // -------- studio → server relay (crosses browsers & machines) -------------
  /**
   * Push the state through the Next.js server. BroadcastChannel only crosses
   * tabs of ONE browser — the relay is what makes /output on another browser,
   * another monitor's browser or the projector machine follow live.
   */
  private relayPost(project: ProjectionProject) {
    this.relayLastPostAt = performance.now()
    fetch('/api/projection/relay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project }),
    })
      .then(() => { this.relayLastOk = true })
      .catch(() => { this.relayLastOk = false })
  }

  /** while the studio is open, announce it every few seconds so every
   *  /output page can keep showing LIVE LINK (and flip to HOLDING if the
   *  control disappears) without any state churn */
  private startRelayHeartbeat() {
    if (this.outputOnly || this.hbTimer) return
    this.hbTimer = window.setInterval(() => {
      fetch('/api/projection/relay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hb: 1 }),
      }).catch(() => { /* relay down — channel pushes still work same-browser */ })
    }, RELAY_HEARTBEAT)
  }

  // ------------------------------------------------------------ editing API (used by the editor UI)
  applyPreset(id: string, opts: { history?: boolean; toast?: boolean } = {}) {
    const preset = getPreset(id)
    if (!preset) return
    if (opts.history !== false) this.surfaces.snapshot()
    const built = preset.build(this.output.width, this.output.height)
    this.surfaces.replaceAll(built)
    if (opts.toast !== false) this.deps.toast(`Preset: ${preset.label} — ${preset.hint}`, 3600)
  }

  addSurface() {
    this.surfaces.snapshot()
    const W = this.output.width, H = this.output.height
    const rect = { x: Math.round(W * 0.3), y: Math.round(H * 0.3), width: Math.round(W * 0.4), height: Math.round(H * 0.4) }
    // new surfaces follow the house rule: angular spans locked so camera width
    // stays put and edges stay connectable (seeded from the rect's ratio)
    const fov = 55
    const hFov = 2 * Math.atan(Math.tan((fov * Math.PI) / 360) * Math.max(0.05, rect.width / Math.max(1, rect.height)))
    const s: ProjectionSurface = {
      id: `surf-add-${Date.now().toString(36)}`,
      name: `Surface ${this.surfaces.surfaces.length + 1}`,
      enabled: true,
      locked: false,
      output: { ...rect },
      camera: { position: [0, 2.2, 2], yaw: 0, pitch: 0, fov, near: 0.1, far: 300, span: { h: Math.round((hFov * 180) / Math.PI), v: fov, lock: true } },
      warp: {
        corners: { tl: { x: rect.x, y: rect.y }, tr: { x: rect.x + rect.width, y: rect.y }, br: { x: rect.x + rect.width, y: rect.y + rect.height }, bl: { x: rect.x, y: rect.y + rect.height } },
        gridResolution: 8,
        grid: [],
        gridCustom: false,
      },
      blend: { opacity: 1, brightness: 1, gamma: 1, feather: { left: 0, right: 0, top: 0, bottom: 0 }, mode: 'normal' },
      calibration: 'off',
    }
    s.warp.grid = gridFromCorners(s.warp.corners, 8)
    this.surfaces.add(s)
  }

  /** history session for slider/number drags: snapshot once per interaction */
  beginEdit() {
    if (this.editingSession) return
    this.editingSession = true
    this.surfaces.snapshot()
  }

  endEdit() {
    this.editingSession = false
    this.scheduleAutosave()
  }

  undo() {
    if (this.surfaces.undo()) this.deps.toast('Undo', 1200)
  }

  redo() {
    if (this.surfaces.redo()) this.deps.toast('Redo', 1200)
  }

  /** the published session this project was loaded from / last published as (if any) */
  currentSession: { id: string; name: string } | null = null

  listSessions() { return this.project.listSessions() }

  /**
   * Publish the current setup as a named output session. The returned id is
   * the stable ?s= key for /output — publish again with the same name to
   * update that link's settings in place.
   */
  publishSession(name: string): { id: string; name: string } | null {
    // same name → update the session in place (its /output?s= link stays);
    // a different name → a brand-new session with its own link
    const sameName = this.currentSession?.name === name.trim()
    const meta = this.project.saveSession(name, sameName ? this.currentSession?.id : undefined)
    if (!meta) return null
    this.currentSession = { id: meta.id, name: meta.name }
    this.broadcastNow()   // open /output tabs jump straight to the published state
    this.deps.toast(`Session "${meta.name}" published — COPY LINK in PROJECT gives a portable URL`, 3600)
    this.ui?.refreshAll()
    this.syncOutputOverlay()
    return meta
  }

  /** load a published session back into the live project (continue editing) */
  loadSession(id: string): boolean {
    const rec = this.project.getSession(id)
    if (!rec) return false
    this.surfaces.snapshot()
    if (!this.project.loadSession(id)) return false
    this.currentSession = { id: rec.id, name: rec.name }
    this.syncAll()
    this.deps.toast(`Session "${rec.name}" loaded — keep editing`, 2600)
    this.ui?.refreshAll()
    this.syncOutputOverlay()
    return true
  }

  deleteSession(id: string): boolean {
    const ok = this.project.deleteSession(id)
    if (ok && this.currentSession?.id === id) this.currentSession = null
    if (ok) { this.ui?.refreshAll(); this.syncOutputOverlay() }
    return ok
  }

  /** fullscreen calibration editor (delegates to the editor UI) */
  setFullscreenEditor(on: boolean) {
    this.ui?.toggleFullscreenEditor(on)
  }

  setOutputLive(on: boolean) {
    if (!this.active) on = false
    if (this.outputLive === on) return
    this.outputLive = on
    document.body.classList.toggle('projection-live', on)
    if (on) {
      // on the dedicated /output page the browser blocks silent auto-fullscreen;
      // the overlay's FULLSCREEN button (a real gesture) does it instead
      if (!this.outputOnly) this.requestFullscreen()
      if (!this.outputOnly) this.deps.toast('Projection output — ESC returns to the studio', 2400)
    } else if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => { /* ignore */ })
    }
    this.ui?.setOutputLiveState(on)
  }

  requestFullscreen() {
    const el = document.documentElement
    if (!document.fullscreenElement) {
      el.requestFullscreen?.().catch(() => { /* user/agent refusal — window mode still works */ })
    }
  }

  setViewThrough(id: string | null) {
    this.viewThrough = id
    this.ui?.refreshAll()
  }

  setViewportLayout(layout: 'single' | 'quad' | 'all') {
    this.viewportLayout = layout
    this.ui?.refreshAll()
  }

  setShowFrustums(on: boolean) {
    this.showFrustums = on
    this.cameras.updateVisibility(this.surfaces.selectedId, this.active && on)
  }

  setCalibrationAll(pattern: ProjectionSurface['calibration']) {
    this.surfaces.snapshot()
    this.surfaces.surfaces.forEach((s) => { s.calibration = pattern })
    this.surfaces.emit()
    this.syncOutputOverlay()
  }

  setOutputSize(width: number, height: number) {
    this.output.width = width
    this.output.height = height
    this.broadcastSoon()
    this.scheduleAutosave()
    this.ui?.refreshAll()
  }

  setRenderScale(scale: number) {
    this.output.renderScale = Math.min(1, Math.max(0.1, scale))
    // a manual scale leaves the named profiles (AUTO keeps tuning on its own)
    if (this.output.quality !== 'auto') this.output.quality = 'custom'
    this.broadcastSoon()
    this.scheduleAutosave()
    this.ui?.refreshAll()
    this.syncOutputOverlay()
  }

  // ------------------------------------------------------------ output quality
  /**
   * Switch the output quality profile. Named profiles pin a render scale;
   * AUTO seeds one from the hardware and keeps tuning from live frame cost;
   * CUSTOM keeps whatever manual scale is currently set.
   */
  setQuality(level: QualityLevel) {
    if (!QUALITY_LEVELS.includes(level)) return
    const prev = this.output.quality
    this.output.quality = level
    if (level === 'auto') {
      this.autoInitScale()
      this.resetAutoTuner()
    } else if (level !== 'custom') {
      this.output.renderScale = QUALITY_PROFILES[level].renderScale
    }
    this.broadcastSoon()
    this.scheduleAutosave()
    this.ui?.refreshAll()
    this.syncOutputOverlay()
    if (prev !== level) {
      const label = level === 'auto' ? 'AUTO (ADAPTIVE)' : level === 'custom' ? `CUSTOM ${Math.round(this.output.renderScale * 100)}%` : QUALITY_PROFILES[level].label
      this.deps.toast(`Output quality — ${label}`, 2200)
    }
  }

  /** hardware-based starting point for AUTO (refined live by the tuner) */
  private autoInitScale() {
    const cores = navigator.hardwareConcurrency ?? 4
    const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4
    const mobile = /android|iphone|ipod|mobile|silk/.test(navigator.userAgent.toLowerCase())
    const n = Math.max(1, this.surfaces.surfaces.filter((s) => s.enabled).length)
    let base = cores >= 8 && mem >= 8 ? 0.8 : cores >= 4 ? 0.6 : 0.45
    if (mobile) base -= 0.15
    base -= Math.max(0, n - 3) * 0.05        // every extra camera costs fill-rate
    this.output.renderScale = Math.round(Math.min(0.95, Math.max(0.3, base)) * 20) / 20
  }

  private autoFrames = 0
  private autoCostSum = 0
  private lastAutoStep = 0

  private resetAutoTuner() {
    this.autoFrames = 0
    this.autoCostSum = 0
  }

  /** sliding-window frame-cost watch — nudges the AUTO render scale a notch at a time */
  private tickAutoQuality(cost: number) {
    this.autoFrames++
    this.autoCostSum += cost
    if (this.autoFrames < 60) return
    const avg = this.autoCostSum / this.autoFrames
    this.resetAutoTuner()
    const now = performance.now()
    if (now - this.lastAutoStep < 2500) return
    const s = this.output.renderScale
    if (avg > 30 && s > 0.3) {
      this.output.renderScale = Math.max(0.3, Math.round((s - 0.1) * 10) / 10)
      this.lastAutoStep = now
      this.syncOutputOverlay()
    } else if (avg < 13 && s < 0.95) {
      this.output.renderScale = Math.min(0.95, Math.round((s + 0.1) * 10) / 10)
      this.lastAutoStep = now
      this.syncOutputOverlay()
    }
  }

  /** QA: feed a synthetic frame cost through the real AUTO tuner (deterministic tests) */
  qaAutoTick(cost: number) { this.tickAutoQuality(cost) }

  /** human label of the active quality for readouts */
  qualityLabel(): string {
    const q = this.output.quality
    if (q === 'auto') return `AUTO ${Math.round(this.output.renderScale * 100)}%`
    if (q === 'custom') return `CUSTOM ${Math.round(this.output.renderScale * 100)}%`
    return QUALITY_PROFILES[q].label
  }

  /** effective per-surface source resolution right now (largest enabled slice) */
  effectiveRT(): { w: number; h: number; msaa: number } | null {
    const q = resolveQuality(this.output)
    const enabled = this.surfaces.surfaces.filter((s) => s.enabled)
    const biggest = enabled.reduce<ProjectionSurface | null>(
      (acc, s) => (!acc || s.output.width * s.output.height > acc.output.width * acc.output.height ? s : acc), null)
    if (!biggest) return null
    const rt = this.outputMgr.expectedRTSize(biggest.output.width, biggest.output.height, q.renderScale, q.rtCap)
    return { w: rt.w, h: rt.h, msaa: q.msaa }
  }

  // ------------------------------------------------------------ render pipeline
  /** called from the main loop instead of sceneMgr.render() while active */
  renderFrame() {
    const t0 = performance.now()
    this.renderFrameInner()
    this.frameCost = performance.now() - t0
    if (this.output.quality === 'auto' && !this.qaFrozen) this.tickAutoQuality(this.frameCost)
  }

  private renderFrameInner() {
    const r = this.deps.sceneMgr.renderer
    const scene = this.deps.sceneMgr.scene
    const q = resolveQuality(this.output)
    const msaa = this.msaaOK ? q.msaa : 0

    // 1) shared world → every enabled surface camera → its own RT
    if (!this.qaFrozen) {
      for (const s of this.surfaces.surfaces) {
        if (!s.enabled) continue
        const entry = this.outputMgr.getEntry(s.id)
        if (!entry) continue
        const cam = this.cameras.sync(s)
        const rt = this.outputMgr.ensureRT(entry, s.output.width, s.output.height, q.renderScale, q.rtCap, msaa)
        r.setRenderTarget(rt)
        r.render(scene, cam)
      }
      r.setRenderTarget(null)
    }

    // 2) screen pass
    if (this.outputLive) {
      this.outputMgr.updateCamera(this.output.width, this.output.height, window.innerWidth, window.innerHeight)
      this.outputMgr.renderComposite(r)
      return
    }

    if (this.viewThrough) {
      const cam = this.cameras.get(this.viewThrough)
      if (cam) { r.render(scene, cam); return }
    }

    if (this.viewportLayout !== 'single') {
      this.renderViewportGrid(r, scene)
      return
    }

    // standard editor viewport — main camera + helper layer
    r.render(scene, this.mainCamera)
  }

  /** multi-camera editor view: 2×2 quad or a grid of every enabled surface */
  private renderViewportGrid(r: THREE.WebGLRenderer, scene: THREE.Scene) {
    const list = this.surfaces.surfaces.filter((s) => s.enabled && this.cameras.get(s.id))
      .slice(0, this.viewportLayout === 'quad' ? 4 : 9)
      .map((s) => this.cameras.get(s.id)!)
    if (!list.length) { r.render(scene, this.mainCamera); return }

    const cols = this.viewportLayout === 'quad' ? 2 : Math.ceil(Math.sqrt(list.length))
    const rows = Math.ceil(list.length / cols)
    const w = window.innerWidth, h = window.innerHeight
    const vw = Math.floor(w / cols), vh = Math.floor(h / rows)

    r.setScissorTest(true)
    list.forEach((cam, i) => {
      const col = i % cols, row = Math.floor(i / cols)
      const x = col * vw
      const y = (rows - 1 - row) * vh   // three viewport origin = bottom-left
      r.setViewport(x, y, vw, vh)
      r.setScissor(x, y, vw, vh)
      r.render(scene, cam)
    })
    r.setScissorTest(false)
    r.setViewport(0, 0, w, h)
  }

  // ------------------------------------------------------------ input
  private onResize = () => {
    if (!this.active) return
    this.ui?.handleResize()
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (!this.active) return
    const target = e.target as HTMLElement | null
    const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)

    if (e.key === 'Escape') {
      if (this.outputLive) {
        e.preventDefault()
        this.setOutputLive(false)
      }
      return
    }
    if (typing) return
    if (e.key === 'Enter') {
      // let a focused button keep its native activation
      if ((target as HTMLElement | null)?.tagName === 'BUTTON') return
      e.preventDefault()
      this.setOutputLive(!this.outputLive)
      return
    }
    const meta = e.ctrlKey || e.metaKey
    if (meta && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      if (e.shiftKey) this.redo()
      else this.undo()
    } else if (meta && e.key.toLowerCase() === 'y') {
      e.preventDefault()
      this.redo()
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && this.surfaces.selected) {
      const s = this.surfaces.selected
      if (!s.locked) {
        e.preventDefault()
        this.surfaces.snapshot()
        this.surfaces.remove(s.id)
      }
    }
  }

  // ------------------------------------------------------------ QA / dispose
  /** live-sync transport diagnostics (QA + operator debugging) */
  relayInfo() {
    return {
      lastPostOk: this.relayLastOk,
      esState: this.relayES ? this.relayES.readyState : -1,
      rev: this.relayRev,
      liveLinked: this.liveLinked,
      msSinceSync: this.lastSyncAt ? Math.round(performance.now() - this.lastSyncAt) : null,
    }
  }

  /** QA: force an immediate full push (BroadcastChannel + relay) */
  qaPush() { this.broadcastNow() }

  qaState() {
    return {
      active: this.active,
      outputLive: this.outputLive,
      liveLinked: this.liveLinked,
      relay: this.relayInfo(),
      surfaces: this.surfaces.surfaces.map((s) => ({
        id: s.id, name: s.name, enabled: s.enabled, locked: s.locked,
        output: { ...s.output }, calibration: s.calibration,
        camera: { ...s.camera }, corners: s.warp.corners,
      })),
      selected: this.surfaces.selected?.name ?? null,
      output: { ...this.output },
      quality: this.qualityLabel(),
      frameCostMs: Math.round(this.frameCost * 10) / 10,
      rtPerSurface: this.surfaces.surfaces
        .filter((s) => s.enabled)
        .map((s) => {
          const e = this.outputMgr.getEntry(s.id)
          return { name: s.name, w: e?.rtW ?? 0, h: e?.rtH ?? 0, msaa: e?.samples ?? 0 }
        }),
    }
  }

  dispose() {
    this.exit()
    window.clearTimeout(this.autosaveTimer)
    window.clearTimeout(this.overlayTimer)
    window.clearTimeout(this.broadcastTimer)
    window.clearTimeout(this.portableUrlTimer)
    window.clearInterval(this.hbTimer)
    this.relayES?.close()
    this.relayES = null
    window.removeEventListener('resize', this.onResize)
    window.removeEventListener('keydown', this.onKeyDown)
    this.unsubs.forEach((u) => u())
    this.unsubs = []
    this.channel?.close()
    this.channel = null
    this.overlay?.remove()
    this.overlay = null
    this.cameras.dispose()
    this.outputMgr.dispose()
    this.calib.dispose()
    this.surfaces.surfaces = []
  }

  // ------------------------------------------------------------ preview helpers (used by the editor UI)
  /** pass a toast through to the ocean HUD */
  depsToast(message: string, duration?: number) {
    this.deps.toast(message, duration)
  }

  getRenderer(): THREE.WebGLRenderer {
    return this.deps.sceneMgr.renderer
  }

  /** render a surface camera into the small shared preview RT → 2D canvas */
  renderCameraPreview(s: ProjectionSurface, canvas: HTMLCanvasElement) {
    const r = this.deps.sceneMgr.renderer
    const scene = this.deps.sceneMgr.scene
    const cam = this.cameras.sync(s)
    const rt = this.outputMgr.cameraPreviewRT
    this.outputMgr.readToCanvas(r, rt, canvas, () => {
      r.setRenderTarget(rt)
      r.render(scene, cam)
    })
  }

  /** composite (letterboxed) preview of the full output canvas */
  renderOutputPreview(canvas: HTMLCanvasElement) {
    const r = this.deps.sceneMgr.renderer
    const rt = this.outputMgr.previewRT
    this.outputMgr.updateCamera(this.output.width, this.output.height, rt.width, rt.height)
    this.outputMgr.readToCanvas(r, rt, canvas, () => {
      r.setRenderTarget(rt)
      this.outputMgr.renderComposite(r)
    })
  }

  // ------------------------------------------------------------ static info
  static get presets() {
    return PRESETS
  }
}
