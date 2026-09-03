// ---------------------------------------------------------------
// ProjectionEditorUI — professional projection-mapping studio
// chrome: surfaces rack (left), live properties (right), tabbed
// dock (output / warp / camera / blend / calibration / project),
// and the fullscreen OUTPUT toggle. Animated with GSAP.
// ---------------------------------------------------------------
import gsap from 'gsap'
import type { ProjectionManager } from './ProjectionManager'
import type { ProjectionSurface, QualityLevel } from './ProjectionTypes'
import { QUALITY_PROFILES } from './ProjectionTypes'
import { OutputNodeEditor } from './OutputNodeEditor'
import { CameraManager } from './CameraManager'
import { PRESETS } from './ProjectionPresets'
import { gridFromCorners } from './ProjectionMath'

const AIM_TARGET: [number, number, number] = [0, 1.4, -8]

export class ProjectionEditorUI {
  root: HTMLElement
  private chrome: HTMLElement
  private listEl: HTMLElement
  private propsEl: HTMLElement
  private tabBody: HTMLElement
  private activeTab = 'output'
  private nodeEditor: OutputNodeEditor
  private previewCanvas: HTMLCanvasElement
  private viewThroughBtn: HTMLButtonElement | null = null
  private compositeCanvas = document.createElement('canvas')
  private camGrid: HTMLElement | null = null
  private previewTimer = 0
  private chromeTimer = 0
  private disposers: (() => void)[] = []

  constructor(private container: HTMLElement, private pm: ProjectionManager) {
    document.body.classList.add('projection-studio-open')

    this.root = document.createElement('div')
    this.root.id = 'projection-studio'
    this.root.innerHTML = `
      <header class="pm-topbar">
        <div class="pm-brand">PROJECTION MAPPING<span>OCEAN · MULTI-SURFACE OUTPUT</span></div>
        <div class="pm-top-group">
          <label class="pm-label" for="pm-preset">PRESET</label>
          <select id="pm-preset" class="pm-select"></select>
        </div>
        <div class="pm-top-actions">
          <button id="pm-mode-preview" class="pm-btn pm-btn-active">PREVIEW</button>
          <button id="pm-mode-output" class="pm-btn">OUTPUT</button>
          <button id="pm-fullscreen" class="pm-btn">⛶ FULLSCREEN</button>
          <button id="pm-exit" class="pm-btn pm-btn-danger">EXIT STUDIO</button>
        </div>
      </header>
      <div class="pm-main">
        <aside class="pm-panel pm-left">
          <div class="pm-panel-head">SURFACES<button class="pm-btn pm-btn-sm" id="pm-add">+ ADD</button></div>
          <ul id="pm-surface-list" class="pm-surface-list"></ul>
          <div class="pm-panel-note">Select a surface, then drag its corner nodes in the OUTPUT tab. Every surface renders the same shared ocean world from its own virtual camera.</div>
        </aside>
        <div class="pm-center" aria-hidden="true"></div>
        <aside class="pm-panel pm-right">
          <div class="pm-panel-head">SURFACE PROPERTIES</div>
          <div id="pm-props" class="pm-props"></div>
          <div class="pm-preview-block">
            <div class="pm-panel-head pm-panel-head-sm">
              CAMERA PREVIEW
              <button class="pm-btn pm-btn-sm" id="pm-view-through">VIEW FROM CAMERA</button>
            </div>
            <canvas id="pm-camera-preview" width="384" height="216"></canvas>
          </div>
        </aside>
      </div>
      <div class="pm-dock">
        <div class="pm-tabs" id="pm-tabs">
          <button data-tab="output" class="pm-tab pm-tab-active">OUTPUT</button>
          <button data-tab="warp" class="pm-tab">WARP</button>
          <button data-tab="camera" class="pm-tab">CAMERA</button>
          <button data-tab="blend" class="pm-tab">BLEND</button>
          <button data-tab="calibration" class="pm-tab">CALIBRATION</button>
          <button data-tab="project" class="pm-tab">PROJECT</button>
        </div>
        <div class="pm-tab-body" id="pm-tab-body"></div>
      </div>`

    // fullscreen output chrome (visible only in output mode)
    this.chrome = document.createElement('div')
    this.chrome.id = 'pm-output-chrome'
    this.chrome.innerHTML = `<div class="pm-chrome-inner"><button class="pm-btn pm-btn-danger" id="pm-exit-output">EXIT OUTPUT — ESC</button></div>`

    container.appendChild(this.root)
    container.appendChild(this.chrome)

    this.listEl = this.root.querySelector('#pm-surface-list')!
    this.propsEl = this.root.querySelector('#pm-props')!
    this.tabBody = this.root.querySelector('#pm-tab-body')!
    this.previewCanvas = this.root.querySelector('#pm-camera-preview')!

    this.buildTopbar()
    this.nodeEditor = new OutputNodeEditor(this.tabBody, pm)
    // tab switching
    this.root.querySelectorAll('.pm-tab').forEach((t) => {
      t.addEventListener('click', () => this.showTab((t as HTMLElement).dataset.tab!))
    })
    this.showTab('output')
    this.refreshAll()

    // data → UI
    this.disposers.push(this.pm.surfaces.onChange(() => this.refreshAll()))
    this.disposers.push(this.pm.surfaces.onLightChange(() => this.nodeEditor.draw()))

    // output chrome behaviour
    const onMove = () => this.pokeChrome()
    window.addEventListener('mousemove', onMove)
    this.disposers.push(() => window.removeEventListener('mousemove', onMove))
    this.chrome.querySelector('#pm-exit-output')?.addEventListener('click', () => this.pm.setOutputLive(false))

    this.previewTimer = window.setInterval(() => this.tick(), 140)
  }

  // ------------------------------------------------------------ topbar
  private buildTopbar() {
    const presetSel = this.root.querySelector('#pm-preset') as HTMLSelectElement
    const ph = document.createElement('option')
    ph.value = ''
    ph.textContent = 'Choose layout…'
    presetSel.appendChild(ph)
    for (const p of PRESETS) {
      const o = document.createElement('option')
      o.value = p.id
      o.textContent = p.label
      presetSel.appendChild(o)
    }
    presetSel.addEventListener('change', () => {
      if (!presetSel.value) return
      this.pm.applyPreset(presetSel.value)
      presetSel.value = ''
    })

    this.root.querySelector('#pm-add')?.addEventListener('click', () => this.pm.addSurface())
    this.root.querySelector('#pm-mode-preview')?.addEventListener('click', () => this.pm.setOutputLive(false))
    this.root.querySelector('#pm-mode-output')?.addEventListener('click', () => this.pm.setOutputLive(true))
    this.root.querySelector('#pm-fullscreen')?.addEventListener('click', () => this.pm.requestFullscreen())
    this.root.querySelector('#pm-exit')?.addEventListener('click', () => this.pm.exit())
  }

  // ------------------------------------------------------------ tabs
  private showTab(tab: string) {
    this.activeTab = tab
    this.root.querySelectorAll('.pm-tab').forEach((t) => {
      t.classList.toggle('pm-tab-active', (t as HTMLElement).dataset.tab === tab)
    })
    this.nodeEditor.root.style.display = tab === 'output' ? 'flex' : 'none'
    if (tab === 'output') this.nodeEditor.handleResizePublic()
    this.tabBody.querySelectorAll('.pm-tabpane').forEach((p) => p.remove())
    if (tab === 'warp') this.buildWarpPane()
    else if (tab === 'camera') this.buildCameraPane()
    else if (tab === 'blend') this.buildBlendPane()
    else if (tab === 'calibration') this.buildCalibrationPane()
    else if (tab === 'project') this.buildProjectPane()
    gsap.fromTo(this.tabBody, { opacity: 0.35 }, { opacity: 1, duration: 0.25, ease: 'power1.out' })
    this.refreshAll()
  }

  private pane(title: string): { pane: HTMLElement; body: HTMLElement } {
    const pane = document.createElement('div')
    pane.className = 'pm-tabpane'
    const head = document.createElement('div')
    head.className = 'pm-panel-head'
    head.textContent = title
    const body = document.createElement('div')
    body.className = 'pm-pane-body'
    pane.append(head, body)
    this.tabBody.appendChild(pane)
    return { pane, body }
  }

  private buildWarpPane() {
    const { body } = this.pane('WARP — MESH DENSITY')
    const s = this.pm.surfaces.selected
    if (!s) { body.appendChild(this.hint('Select a surface to adjust its warp mesh.')); return }

    const row = document.createElement('div')
    row.className = 'pm-row'
    row.appendChild(this.labelEl('GRID RESOLUTION'))
    const sel = document.createElement('select')
    sel.className = 'pm-select pm-select-sm'
    ;[1, 2, 4, 8, 12, 16].forEach((r) => {
      const o = document.createElement('option')
      o.value = String(r)
      o.textContent = `${r} × ${r}`
      if (s.warp.gridResolution === r) o.selected = true
      sel.appendChild(o)
    })
    sel.addEventListener('change', () => {
      this.pm.surfaces.snapshot()
      const res = Number(sel.value)
      s.warp.gridResolution = res
      s.warp.grid = gridFromCorners(s.warp.corners, res)
      this.pm.surfaces.emit()
    })
    row.appendChild(sel)
    body.appendChild(row)

    const btns = document.createElement('div')
    btns.className = 'pm-btn-row'
    btns.appendChild(this.btn('RESET CORNERS', () => this.nodeEditor.runActionPublic('reset')))
    btns.appendChild(this.btn('FIT OUTPUT', () => this.nodeEditor.runActionPublic('fit')))
    btns.appendChild(this.btn('CENTER', () => this.nodeEditor.runActionPublic('center')))
    body.appendChild(btns)
    body.appendChild(this.hint('4 corners = projective corner pin. Raise the grid resolution and drag interior nodes for mesh warping against imperfect walls. Edit nodes in the OUTPUT tab.'))
  }

  private buildCameraPane() {
    const { body } = this.pane('MULTI-CAMERA VIEW')
    const layoutRow = document.createElement('div')
    layoutRow.className = 'pm-btn-row'
    const layouts: [string, string][] = [['single', 'SINGLE'], ['quad', '2 × 2'], ['all', 'ALL']]
    for (const [id, label] of layouts) {
      const b = this.btn(label, () => this.pm.setViewportLayout(id as 'single' | 'quad' | 'all'))
      if (this.pm.viewportLayout === id) b.classList.add('pm-btn-active')
      layoutRow.appendChild(b)
    }
    const fr = this.check('Show camera frustums', this.pm.showFrustums, (on) => this.pm.setShowFrustums(on))
    layoutRow.appendChild(fr)
    body.appendChild(layoutRow)

    body.appendChild(this.hint('Main viewport layout. Every camera renders the same shared world — fish swim continuously across surfaces.'))

    this.camGrid = document.createElement('div')
    this.camGrid.className = 'pm-cam-grid'
    body.appendChild(this.camGrid)
    this.buildCamGrid()
  }

  private buildCamGrid() {
    if (!this.camGrid) return
    this.camGrid.innerHTML = ''
    for (const s of this.pm.surfaces.surfaces) {
      if (!s.enabled) continue
      const cell = document.createElement('button')
      cell.className = 'pm-cam-cell' + (s.id === this.pm.surfaces.selectedId ? ' pm-cam-selected' : '')
      const c = document.createElement('canvas')
      c.width = 192
      c.height = 108
      const cap = document.createElement('span')
      cap.textContent = s.name
      cell.append(c, cap)
      cell.addEventListener('click', () => this.pm.surfaces.select(s.id))
      cell.dataset.surfaceId = s.id
      this.camGrid.appendChild(cell)
    }
  }

  private buildBlendPane() {
    const { body } = this.pane('SURFACE BLEND — affects the projection only')
    const s = this.pm.surfaces.selected
    if (!s) { body.appendChild(this.hint('Select a surface to grade it.')); return }

    body.appendChild(this.sliderRow('OPACITY', s.blend.opacity, 0, 1, 0.01, (v) => { s.blend.opacity = v; this.light(s) }))
    body.appendChild(this.sliderRow('BRIGHTNESS', s.blend.brightness, 0.2, 2.5, 0.01, (v) => { s.blend.brightness = v; this.light(s) }))
    body.appendChild(this.sliderRow('GAMMA', s.blend.gamma, 0.3, 2.8, 0.01, (v) => { s.blend.gamma = v; this.light(s) }))

    const modeRow = document.createElement('div')
    modeRow.className = 'pm-row'
    modeRow.appendChild(this.labelEl('BLEND MODE'))
    const msel = document.createElement('select')
    msel.className = 'pm-select pm-select-sm'
    ;[['normal', 'Normal'], ['add', 'Additive'], ['screen', 'Screen']].forEach(([v, l]) => {
      const o = document.createElement('option')
      o.value = v; o.textContent = l
      if (s.blend.mode === v) o.selected = true
      msel.appendChild(o)
    })
    msel.addEventListener('change', () => {
      this.pm.surfaces.snapshot()
      s.blend.mode = msel.value as ProjectionSurface['blend']['mode']
      this.pm.surfaces.emit()
    })
    modeRow.appendChild(msel)
    body.appendChild(modeRow)

    body.appendChild(this.sepEl())

    const fb = s.blend.feather
    body.appendChild(this.sliderRow('FEATHER LEFT', fb.left, 0, 0.45, 0.01, (v) => { fb.left = v; this.light(s) }))
    body.appendChild(this.sliderRow('FEATHER RIGHT', fb.right, 0, 0.45, 0.01, (v) => { fb.right = v; this.light(s) }))
    body.appendChild(this.sliderRow('FEATHER TOP', fb.top, 0, 0.45, 0.01, (v) => { fb.top = v; this.light(s) }))
    body.appendChild(this.sliderRow('FEATHER BOTTOM', fb.bottom, 0, 0.45, 0.01, (v) => { fb.bottom = v; this.light(s) }))
    body.appendChild(this.hint('Overlap two surfaces and feather their shared edges for seamless projector blending.'))
  }

  private buildCalibrationPane() {
    const { body } = this.pane('CALIBRATION — physical projector alignment')
    const s = this.pm.surfaces.selected
    if (s) {
      const row = document.createElement('div')
      row.className = 'pm-row'
      row.appendChild(this.labelEl('SELECTED SURFACE'))
      const sel = document.createElement('select')
      sel.className = 'pm-select pm-select-sm'
      for (const p of ['off', 'grid', 'crosshair', 'colorbars', 'checkerboard', 'white', 'black', 'corners'] as const) {
        const o = document.createElement('option')
        o.value = p; o.textContent = p.toUpperCase()
        if (s.calibration === p) o.selected = true
        sel.appendChild(o)
      }
      sel.addEventListener('change', () => { s.calibration = sel.value as ProjectionSurface['calibration']; this.pm.surfaces.emit() })
      row.appendChild(sel)
      body.appendChild(row)
    }

    body.appendChild(this.labelEl('APPLY TO ALL SURFACES'))
    const grid = document.createElement('div')
    grid.className = 'pm-pattern-grid'
    for (const p of ['off', 'grid', 'crosshair', 'colorbars', 'checkerboard', 'white', 'black', 'corners'] as const) {
      grid.appendChild(this.btn(p.toUpperCase(), () => this.pm.setCalibrationAll(p), 'pm-btn-sm'))
    }
    body.appendChild(grid)

    const outRow = document.createElement('div')
    outRow.className = 'pm-btn-row'
    outRow.appendChild(this.btn('OPEN PROJECTION OUTPUT (ENTER)', () => this.pm.setOutputLive(true)))
    body.appendChild(outRow)
    body.appendChild(this.hint('Patterns replace the ocean image on the output only — the 3D world keeps running. Use white/black flashes to set projector brightness, grids to align edges.'))
  }

  private buildProjectPane() {
    const { body } = this.pane('PROJECT — output & files')
    const resRow = document.createElement('div')
    resRow.className = 'pm-row'
    resRow.appendChild(this.labelEl('OUTPUT RESOLUTION'))
    const rsel = document.createElement('select')
    rsel.className = 'pm-select pm-select-sm'
    const resOpts: [string, number, number][] = [
      ['1920 × 1080 (16:9)', 1920, 1080], ['2560 × 720 (triple wall)', 2560, 720],
      ['3840 × 1080 (32:9)', 3840, 1080], ['5120 × 1440', 5120, 1440], ['7680 × 2160', 7680, 2160],
    ]
    const customKey = 'custom'
    for (const [label, w, h] of resOpts) {
      const o = document.createElement('option')
      o.value = `${w}x${h}`
      o.textContent = label
      if (this.pm.output.width === w && this.pm.output.height === h) o.selected = true
      rsel.appendChild(o)
    }
    const known = resOpts.some(([, w, h]) => this.pm.output.width === w && this.pm.output.height === h)
    if (!known) {
      const o = document.createElement('option')
      o.value = customKey
      o.textContent = `CUSTOM ${this.pm.output.width} × ${this.pm.output.height}`
      o.selected = true
      rsel.appendChild(o)
    }
    rsel.addEventListener('change', () => {
      if (rsel.value === customKey) return
      const [w, h] = rsel.value.split('x').map(Number)
      this.pm.setOutputSize(w, h)
      this.showTab('project')
    })
    resRow.appendChild(rsel)
    body.appendChild(resRow)

    // ---- free output canvas size + ratio (Resolume-style master aspect) ----
    const whRow = document.createElement('div')
    whRow.className = 'pm-grid2'
    whRow.appendChild(this.numField('CANVAS W', this.pm.output.width, 4, (v) => {
      this.pm.setOutputSize(Math.max(320, Math.min(16384, v)), this.pm.output.height)
    }, 320, 16384))
    whRow.appendChild(this.numField('CANVAS H', this.pm.output.height, 4, (v) => {
      this.pm.setOutputSize(this.pm.output.width, Math.max(240, Math.min(8640, v)))
    }, 240, 8640))
    body.appendChild(whRow)

    const ratioRow = document.createElement('div')
    ratioRow.className = 'pm-btn-row'
    ratioRow.appendChild(this.labelEl('CANVAS RATIO'))
    const aspLbl = document.createElement('span')
    aspLbl.className = 'pm-slider-val'
    aspLbl.textContent = aspectLabel(this.pm.output.width, this.pm.output.height)
    ratioRow.appendChild(aspLbl)
    for (const [label, ratio] of [['16:9', 16 / 9], ['32:9', 32 / 9], ['4:3', 4 / 3], ['1:1', 1]] as const) {
      ratioRow.appendChild(this.btn(label, () => {
        const h = Math.round(this.pm.output.width / ratio)
        this.pm.setOutputSize(this.pm.output.width, h)
        this.showTab('project')
      }, 'pm-btn-sm'))
    }
    body.appendChild(ratioRow)

    // ---- output quality — sized to the machine driving the show ----
    const qRow = document.createElement('div')
    qRow.className = 'pm-row'
    qRow.appendChild(this.labelEl('OUTPUT QUALITY'))
    const qsel = document.createElement('select')
    qsel.className = 'pm-select pm-select-sm'
    const qOpts: [QualityLevel, string][] = [
      ['auto', 'AUTO — TUNES ITSELF'],
      ['performance', 'PERFORMANCE — WEAK GPU'],
      ['balanced', 'BALANCED — LAPTOP'],
      ['high', 'HIGH — DESKTOP GPU'],
      ['ultra', 'ULTRA — 1:1 PIXELS + 4× AA'],
      ['custom', 'CUSTOM SCALE'],
    ]
    for (const [lv, label] of qOpts) {
      const o = document.createElement('option')
      o.value = lv
      o.textContent = label
      if (this.pm.output.quality === lv) o.selected = true
      qsel.appendChild(o)
    }
    qsel.addEventListener('change', () => {
      this.pm.setQuality(qsel.value as QualityLevel)
      this.showTab('project')   // rebuild so slider/readout match the new profile
    })
    qRow.appendChild(qsel)
    body.appendChild(qRow)

    if (this.pm.output.quality === 'custom') {
      const sRow = document.createElement('div')
      sRow.className = 'pm-row'
      sRow.appendChild(this.labelEl('RENDER SCALE'))
      const slider = document.createElement('input')
      slider.type = 'range'
      slider.className = 'pm-slider'
      slider.min = '10'
      slider.max = '100'
      slider.step = '5'
      slider.value = String(Math.round(this.pm.output.renderScale * 100))
      const sVal = document.createElement('span')
      sVal.className = 'pm-slider-val'
      sVal.textContent = `${slider.value}%`
      slider.addEventListener('input', () => {
        sVal.textContent = `${slider.value}%`
        this.pm.setRenderScale(Number(slider.value) / 100)
      })
      sRow.append(slider, sVal)
      body.appendChild(sRow)
    } else {
      const rt = this.pm.effectiveRT()
      const read = document.createElement('div')
      read.className = 'pm-readout'
      const lines: string[] = []
      if (rt) lines.push(`per-surface source: ${rt.w}×${rt.h} px${rt.msaa ? ` · MSAA ${rt.msaa}×` : ''}`)
      lines.push(`GPU frame: ${this.pm.frameCost.toFixed(1)} ms · ${this.pm.surfaces.surfaces.filter((s) => s.enabled).length} camera(s) render the shared scene`)
      if (this.pm.output.quality === 'auto') lines.push('AUTO keeps adjusting the scale from live frame cost — no action needed')
      read.innerHTML = lines.map((l) => `<span>${l}</span>`).join('')
      body.appendChild(read)
    }
    body.appendChild(this.hint(`Quality profiles set how many real pixels each surface renders before warping. ${QUALITY_PROFILES.balanced.hint}. AUTO measures frame cost and moves between ~30% and 95% on its own — pick PERFORMANCE on weak machines or ULTRA when the projector wall deserves every pixel.`))

    body.appendChild(this.sepEl())
    const fileRow = document.createElement('div')
    fileRow.className = 'pm-btn-row'
    fileRow.appendChild(this.btn('EXPORT .JSON', () => this.pm.project.exportFile()))
    fileRow.appendChild(this.btn('IMPORT .JSON', async () => {
      const ok = await this.pm.project.importFile()
      if (ok) this.pm.depsToast('Projection project imported', 2600)
      else this.pm.depsToast('Import failed — not a valid projection project', 3200)
    }))
    body.appendChild(fileRow)

    const saveRow = document.createElement('div')
    saveRow.className = 'pm-btn-row'
    saveRow.appendChild(this.btn('SAVE TO BROWSER', () => { this.pm.project.saveLocal(); this.pm.depsToast('Saved to browser storage', 2000) }))
    saveRow.appendChild(this.btn('RESET PROJECT', () => {
      this.pm.surfaces.snapshot()
      this.pm.project.clearLocal()
      this.pm.applyPreset('flat-screen', { history: false })
      this.pm.depsToast('Project reset', 2000)
    }))
    body.appendChild(saveRow)
    body.appendChild(this.hint('Projects autosave to this browser. Export writes ocean-projection.project.json for other machines and shows.'))

    // ---- output sessions — published setups with permanent /output?s= links ----
    body.appendChild(this.sepEl())
    body.appendChild(this.labelEl('OUTPUT SESSIONS — SHAREABLE OUTPUT LINKS'))
    const pubRow = document.createElement('div')
    pubRow.className = 'pm-row'
    const sessName = document.createElement('input')
    sessName.type = 'text'
    sessName.className = 'pm-input pm-input-grow'
    sessName.maxLength = 48
    sessName.placeholder = this.pm.currentSession ? `${this.pm.currentSession.name} (update)` : 'Session name — e.g. FRONT WALL SHOW'
    const pubBtn = this.btn('PUBLISH', () => {
      const name = sessName.value.trim() || this.pm.currentSession?.name || `Session ${this.pm.listSessions().length + 1}`
      this.pm.publishSession(name)
      this.showTab('project')
    }, 'pm-btn-sm')
    pubRow.append(sessName, pubBtn)
    body.appendChild(pubRow)

    const sessions = this.pm.listSessions()
    if (!sessions.length) {
      body.appendChild(this.hint('Publish the current setup to get a permanent /output?s=… link — the projector page then always opens with these exact settings, even with the studio closed. Publish again with the same name to update the link in place.'))
    } else {
      const list = document.createElement('div')
      list.className = 'pm-session-list'
      for (const sess of sessions) {
        const row = document.createElement('div')
        row.className = 'pm-session-row' + (this.pm.currentSession?.id === sess.id ? ' pm-session-active' : '')
        const label = document.createElement('span')
        label.className = 'pm-session-name'
        label.textContent = sess.name
        label.title = `/output?s=${sess.id}`
        const when = document.createElement('span')
        when.className = 'pm-session-date'
        when.textContent = new Date(sess.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + new Date(sess.updatedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
        const tools = document.createElement('div')
        tools.className = 'pm-btn-row'
        tools.appendChild(this.btn('COPY LINK', async () => {
          const url = `${location.origin}/output?s=${sess.id}`
          const ok = await copyText(url)
          this.pm.depsToast(ok ? `Link copied — /output?s=${sess.id}` : 'Copy failed — select the link: ' + url, 3000)
        }, 'pm-btn-sm'))
        tools.appendChild(this.btn('LOAD', () => {
          this.pm.loadSession(sess.id)
          this.showTab('project')
        }, 'pm-btn-sm'))
        tools.appendChild(this.btn('DEL', () => {
          this.pm.deleteSession(sess.id)
          this.showTab('project')
        }, 'pm-btn-sm pm-btn-danger'))
        row.append(label, when, tools)
        list.appendChild(row)
      }
      body.appendChild(list)
      body.appendChild(this.hint('COPY LINK puts the projector URL on the clipboard. LOAD restores the session here so you can keep editing it — publish again with the same name to refresh its link.'))
    }
  }

  // ------------------------------------------------------------ surfaces list
  private refreshList() {
    this.listEl.innerHTML = ''
    for (const s of this.pm.surfaces.surfaces) {
      const li = document.createElement('li')
      li.className = 'pm-surf' + (s.id === this.pm.surfaces.selectedId ? ' pm-surf-selected' : '') + (s.enabled ? '' : ' pm-surf-off')

      const en = document.createElement('input')
      en.type = 'checkbox'
      en.checked = s.enabled
      en.title = 'Enable / disable this surface'
      en.addEventListener('change', () => {
        this.pm.surfaces.snapshot()
        s.enabled = en.checked
        this.pm.surfaces.emit()
      })

      const name = document.createElement('button')
      name.className = 'pm-surf-name'
      name.textContent = s.name
      name.title = 'Select surface (double-click to rename)'
      name.addEventListener('click', () => this.pm.surfaces.select(s.id))
      name.addEventListener('dblclick', () => {
        const input = document.createElement('input')
        input.className = 'pm-rename'
        input.value = s.name
        input.maxLength = 40
        li.replaceChild(input, name)
        input.focus(); input.select()
        const commit = () => {
          this.pm.surfaces.snapshot()
          s.name = input.value.trim() || s.name
          this.pm.surfaces.emit()
        }
        input.addEventListener('blur', commit)
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') input.blur()
          e.stopPropagation()
        })
      })

      const lock = document.createElement('button')
      lock.className = 'pm-surf-tool' + (s.locked ? ' pm-tool-on' : '')
      lock.textContent = s.locked ? 'LOCKED' : 'LOCK'
      lock.title = 'Lock prevents node dragging and deletion'
      lock.addEventListener('click', () => {
        this.pm.surfaces.snapshot()
        s.locked = !s.locked
        this.pm.surfaces.emit()
      })

      const dup = document.createElement('button')
      dup.className = 'pm-surf-tool'
      dup.textContent = 'COPY'
      dup.title = 'Duplicate surface'
      dup.addEventListener('click', () => {
        this.pm.surfaces.snapshot()
        this.pm.surfaces.duplicate(s.id)
      })

      const del = document.createElement('button')
      del.className = 'pm-surf-tool pm-tool-danger'
      del.textContent = 'DEL'
      del.title = 'Delete surface'
      del.disabled = s.locked
      del.addEventListener('click', () => {
        if (s.locked) return
        this.pm.surfaces.snapshot()
        this.pm.surfaces.remove(s.id)
      })

      li.append(en, name, lock, dup, del)
      this.listEl.appendChild(li)
    }
    if (!this.pm.surfaces.surfaces.length) {
      const li = document.createElement('li')
      li.className = 'pm-surf-empty'
      li.textContent = 'No surfaces — pick a preset or press + ADD.'
      this.listEl.appendChild(li)
    }
  }

  // ------------------------------------------------------------ properties
  private refreshProps() {
    this.propsEl.innerHTML = ''
    const s = this.pm.surfaces.selected
    this.updateViewThroughBtn()
    if (!s) {
      const hint = this.hint('No surface selected.')
      this.propsEl.appendChild(hint)
      return
    }

    // name + flags
    const nameRow = document.createElement('div')
    nameRow.className = 'pm-row'
    const nameInput = document.createElement('input')
    nameInput.type = 'text'
    nameInput.className = 'pm-input pm-input-grow'
    nameInput.value = s.name
    nameInput.maxLength = 40
    nameInput.addEventListener('change', () => {
      this.pm.surfaces.snapshot()
      s.name = nameInput.value.trim() || s.name
      this.pm.surfaces.emit()
    })
    nameRow.appendChild(nameInput)
    this.propsEl.appendChild(nameRow)

    const flagRow = document.createElement('div')
    flagRow.className = 'pm-btn-row'
    flagRow.appendChild(this.check('Enabled', s.enabled, (on) => {
      this.pm.surfaces.snapshot(); s.enabled = on; this.pm.surfaces.emit()
    }))
    flagRow.appendChild(this.check('Locked', s.locked, (on) => {
      this.pm.surfaces.snapshot(); s.locked = on; this.pm.surfaces.emit()
    }))
    this.propsEl.appendChild(flagRow)

    // OUTPUT RECT
    this.propsEl.appendChild(this.sectionEl('OUTPUT — position on the projector canvas'))
    const rect = s.output
    const grid = document.createElement('div')
    grid.className = 'pm-grid2'
    grid.appendChild(this.numField('X', rect.x, 1, (v) => { rect.x = v; this.light(s) }, -16384, 16384))
    grid.appendChild(this.numField('Y', rect.y, 1, (v) => { rect.y = v; this.light(s) }, -16384, 16384))
    grid.appendChild(this.numField('W', rect.width, 1, (v) => {
      const ratio = rect.width / Math.max(1, rect.height)
      rect.width = Math.max(32, v)
      if (rect.lockAspect) rect.height = Math.max(32, Math.round(rect.width / ratio))
      this.light(s)
    }, 32, 16384))
    grid.appendChild(this.numField('H', rect.height, 1, (v) => {
      const ratio = rect.width / Math.max(1, rect.height)
      rect.height = Math.max(32, v)
      if (rect.lockAspect) rect.width = Math.max(32, Math.round(rect.height * ratio))
      this.light(s)
    }, 32, 16384))
    this.propsEl.appendChild(grid)

    // slice ratio — input side of the Resolume-style slice
    const sliceAsp = document.createElement('div')
    sliceAsp.className = 'pm-btn-row'
    sliceAsp.appendChild(this.labelEl('SLICE RATIO'))
    const sliceLbl = document.createElement('span')
    sliceLbl.className = 'pm-slider-val'
    sliceLbl.textContent = aspectLabel(rect.width, rect.height)
    sliceAsp.appendChild(sliceLbl)
    for (const [label, ratio] of [['16:9', 16 / 9], ['4:3', 4 / 3], ['1:1', 1], ['9:16', 9 / 16]] as const) {
      sliceAsp.appendChild(this.btn(label, () => {
        this.pm.surfaces.snapshot()
        rect.height = Math.max(32, Math.round(rect.width / ratio))
        this.pm.surfaces.emit()
      }, 'pm-btn-sm'))
    }
    sliceAsp.appendChild(this.check('Lock', rect.lockAspect === true, (on) => {
      this.pm.surfaces.snapshot()
      rect.lockAspect = on
      this.pm.surfaces.emit()
    }))
    this.propsEl.appendChild(sliceAsp)

    // CAMERA
    this.propsEl.appendChild(this.sectionEl('VIRTUAL CAMERA — world space'))
    const cg = document.createElement('div')
    cg.className = 'pm-grid3'
    const c = s.camera
    const spanLocked = c.span?.lock === true
    cg.appendChild(this.numField('POS X', c.position[0], 0.1, (v) => { c.position[0] = v; this.lightCam(s) }, -200, 200))
    cg.appendChild(this.numField('POS Y', c.position[1], 0.1, (v) => { c.position[1] = v; this.lightCam(s) }, -100, 100))
    cg.appendChild(this.numField('POS Z', c.position[2], 0.1, (v) => { c.position[2] = v; this.lightCam(s) }, -200, 200))
    cg.appendChild(this.numField('YAW °', c.yaw, 1, (v) => { c.yaw = v; this.lightCam(s) }, -720, 720))
    cg.appendChild(this.numField('PITCH °', c.pitch, 1, (v) => { c.pitch = v; this.lightCam(s) }, -95, 95))
    if (spanLocked) {
      cg.appendChild(this.numField('SPAN H °', c.span.h, 1, (v) => { c.span.h = Math.max(4, Math.min(359, v)); this.lightCam(s) }, 4, 359))
    } else {
      cg.appendChild(this.numField('FOV °', c.fov, 1, (v) => { c.fov = Math.max(8, Math.min(150, v)); this.lightCam(s) }, 8, 150))
    }
    this.propsEl.appendChild(cg)

    if (spanLocked) {
      // edge-matched room projection: fov derives from the angular spans
      const spanRow = document.createElement('div')
      spanRow.className = 'pm-row'
      spanRow.appendChild(this.check('Match wall edges (span lock)', true, (on) => {
        this.pm.surfaces.snapshot()
        c.span.lock = on
        this.pm.surfaces.emit()
      }))
      this.propsEl.appendChild(spanRow)
      this.propsEl.appendChild(this.sliderRow('SPAN H', c.span.h, 4, 170, 1, (v) => { c.span.h = v; this.lightCam(s) }))
      this.propsEl.appendChild(this.sliderRow('SPAN V', c.span.v, 4, 170, 1, (v) => { c.span.v = v; this.lightCam(s) }))
      // camera input ratio vs the slice it feeds — one click keeps them equal
      const camRatio = c.span.h / Math.max(1, c.span.v)
      const sliceRatio = rect.width / Math.max(1, rect.height)
      const ratioRow = document.createElement('div')
      ratioRow.className = 'pm-btn-row'
      ratioRow.appendChild(this.labelEl('CAM RATIO'))
      const rl = document.createElement('span')
      rl.className = 'pm-slider-val'
      rl.textContent = `${camRatio.toFixed(2)} · ${aspectLabel(c.span.h, c.span.v)}`
      ratioRow.appendChild(rl)
      ratioRow.appendChild(this.btn('MATCH SLICE', () => {
        this.pm.surfaces.snapshot()
        // keep SPAN H (the wall's angular width) and reshape SPAN V so the
        // frustum ratio equals the slice ratio — no stretched pixels
        c.span.v = Math.max(4, Math.min(179, Math.round(c.span.h / Math.max(0.05, sliceRatio))))
        this.pm.surfaces.emit()
      }, 'pm-btn-sm'))
      this.propsEl.appendChild(ratioRow)
      this.propsEl.appendChild(this.hint('Frustum edges derive from these world angles — adjacent walls tile with no gaps or duplicated content. MATCH SLICE reshapes SPAN V so the camera ratio equals the slice ratio.'))
    } else {
      this.propsEl.appendChild(this.sliderRow('FOV', c.fov, 10, 130, 1, (v) => { c.fov = v; this.lightCam(s) }))
      const lockRow = document.createElement('div')
      lockRow.className = 'pm-row'
      lockRow.appendChild(this.check('Match wall edges (span lock)', false, (on) => {
        this.pm.surfaces.snapshot()
        if (!c.span) c.span = { h: c.fov, v: c.fov, lock: false }
        if (on) {
          // seed spans from the current frustum so nothing jumps
          const hFov = 2 * Math.atan(Math.tan((c.fov * Math.PI) / 360) * Math.max(0.05, s.output.width / Math.max(1, s.output.height)))
          c.span = { h: Math.round((hFov * 180) / Math.PI), v: Math.round(c.fov), lock: true }
        } else {
          c.span.lock = false
        }
        this.pm.surfaces.emit()
      }))
      this.propsEl.appendChild(lockRow)
      this.propsEl.appendChild(this.hint('Span lock derives the frustum from world angles — use it on room walls so corners meet exactly.'))
    }

    const snapRow = document.createElement('div')
    snapRow.className = 'pm-btn-row pm-btn-row-wrap'
    ;([['FRONT', 'front'], ['BACK', 'back'], ['LEFT', 'left'], ['RIGHT', 'right'], ['FLOOR', 'floor'], ['CEILING', 'ceiling']] as const)
      .forEach(([label, view]) => {
        snapRow.appendChild(this.btn(label, () => {
          this.pm.surfaces.snapshot()
          CameraManager.snapView(s.camera, view)
          this.pm.surfaces.emit()
        }, 'pm-btn-sm'))
      })
    snapRow.appendChild(this.btn('AIM AT REEF', () => {
      this.pm.surfaces.snapshot()
      CameraManager.aimAt(s.camera, AIM_TARGET)
      this.pm.surfaces.emit()
    }, 'pm-btn-sm'))
    this.propsEl.appendChild(snapRow)

    const nearFar = document.createElement('div')
    nearFar.className = 'pm-grid2'
    nearFar.appendChild(this.numField('NEAR', c.near, 0.05, (v) => { c.near = Math.max(0.01, v); this.lightCam(s) }, 0.01, 100))
    nearFar.appendChild(this.numField('FAR', c.far, 5, (v) => { c.far = Math.max(20, v); this.lightCam(s) }, 20, 2000))
    this.propsEl.appendChild(nearFar)

    // actions
    this.propsEl.appendChild(this.sepEl())
    const actions = document.createElement('div')
    actions.className = 'pm-btn-row pm-btn-row-wrap'
    actions.appendChild(this.btn('DUPLICATE', () => {
      this.pm.surfaces.snapshot(); this.pm.surfaces.duplicate(s.id)
    }, 'pm-btn-sm'))
    const up = this.btn('▲ ORDER', () => {
      this.pm.surfaces.snapshot(); this.pm.surfaces.reorder(s.id, -1)
    }, 'pm-btn-sm')
    const down = this.btn('▼ ORDER', () => {
      this.pm.surfaces.snapshot(); this.pm.surfaces.reorder(s.id, 1)
    }, 'pm-btn-sm')
    const del = this.btn('DELETE', () => {
      if (s.locked) return
      this.pm.surfaces.snapshot(); this.pm.surfaces.remove(s.id)
    }, 'pm-btn-sm pm-tool-danger')
    del.disabled = s.locked
    actions.append(up, down, del)
    this.propsEl.appendChild(actions)
  }

  private updateViewThroughBtn() {
    if (!this.viewThroughBtn) return
    const sel = this.pm.surfaces.selected
    const active = !!sel && this.pm.viewThrough === sel.id
    this.viewThroughBtn.classList.toggle('pm-btn-active', active)
    this.viewThroughBtn.textContent = active ? 'BACK TO EDITOR VIEW' : 'VIEW FROM CAMERA'
  }

  // ------------------------------------------------------------ misc builders
  private sectionEl(text: string): HTMLElement {
    const d = document.createElement('div')
    d.className = 'pm-section'
    d.textContent = text
    return d
  }

  private sepEl(): HTMLElement {
    const d = document.createElement('div')
    d.className = 'pm-sep'
    return d
  }

  private hint(text: string): HTMLElement {
    const d = document.createElement('p')
    d.className = 'pm-hint'
    d.textContent = text
    return d
  }

  private labelEl(text: string): HTMLElement {
    const l = document.createElement('span')
    l.className = 'pm-label'
    l.textContent = text
    return l
  }

  private btn(label: string, cb: () => void, cls = ''): HTMLButtonElement {
    const b = document.createElement('button')
    b.className = `pm-btn ${cls}`.trim()
    b.textContent = label
    b.addEventListener('click', cb)
    return b
  }

  private check(label: string, value: boolean, cb: (on: boolean) => void): HTMLElement {
    const lab = document.createElement('label')
    lab.className = 'pm-check'
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.checked = value
    input.addEventListener('change', () => cb(input.checked))
    lab.append(input, document.createTextNode(` ${label}`))
    return lab
  }

  /** number field: focus = history snapshot, input = live light update, change = commit */
  private numField(label: string, value: number, step: number, set: (v: number) => void, min: number, max: number): HTMLElement {
    const wrap = document.createElement('label')
    wrap.className = 'pm-field'
    const span = document.createElement('span')
    span.textContent = label
    const input = document.createElement('input')
    input.type = 'number'
    input.className = 'pm-input'
    input.step = String(step)
    input.value = String(Math.round(value * 100) / 100)
    input.addEventListener('focus', () => this.pm.beginEdit())
    input.addEventListener('input', () => {
      const v = parseFloat(input.value)
      if (Number.isFinite(v)) { set(Math.min(max, Math.max(min, v))) }
    })
    input.addEventListener('change', () => {
      const v = parseFloat(input.value)
      if (Number.isFinite(v)) set(Math.min(max, Math.max(min, v)))
      this.pm.endEdit()
      this.pm.surfaces.emit()
    })
    wrap.append(span, input)
    return wrap
  }

  private sliderRow(label: string, value: number, min: number, max: number, step: number, cb: (v: number) => void): HTMLElement {
    const row = document.createElement('div')
    row.className = 'pm-slider-row'
    const span = document.createElement('span')
    span.className = 'pm-label pm-slider-label'
    span.textContent = label
    const input = document.createElement('input')
    input.type = 'range'
    input.min = String(min)
    input.max = String(max)
    input.step = String(step)
    input.value = String(value)
    const val = document.createElement('span')
    val.className = 'pm-slider-val'
    val.textContent = formatVal(value)
    input.addEventListener('pointerdown', () => this.pm.beginEdit())
    input.addEventListener('input', () => {
      const v = parseFloat(input.value)
      cb(v)
      val.textContent = formatVal(v)
    })
    input.addEventListener('change', () => {
      this.pm.endEdit()
      this.pm.surfaces.emit()
    })
    row.append(span, input, val)
    return row
  }

  // ------------------------------------------------------------ refresh
  refreshAll() {
    this.refreshList()
    this.refreshProps()
    if (this.activeTab === 'camera') this.buildCamGrid()
    this.nodeEditor.draw()
  }

  setOutputLiveState(on: boolean) {
    (this.root.querySelector('#pm-mode-preview') as HTMLElement)?.classList.toggle('pm-btn-active', !on);
    (this.root.querySelector('#pm-mode-output') as HTMLElement)?.classList.toggle('pm-btn-active', on)
    this.pokeChrome()
    if (!on) this.chrome.classList.remove('pm-chrome-visible')
  }

  handleResize() {
    this.nodeEditor.handleResizePublic()
  }

  // ------------------------------------------------------------ previews
  private light(s: ProjectionSurface) {
    this.pm.surfaces.touch(s)
    this.nodeEditor.draw()
  }

  private lightCam(s: ProjectionSurface) {
    this.pm.surfaces.touch(s)
  }

  private tick() {
    if (!this.pm.active || this.pm.outputLive || document.hidden) return
    // adaptive back-off: GPU readbacks stall weak pipelines — skip while frames are slow
    if (this.pm.frameCost > 34) return
    // selected camera preview (right panel)
    const sel = this.pm.surfaces.selected
    if (sel?.enabled) this.pm.renderCameraPreview(sel, this.previewCanvas)
    // composite underlay in the OUTPUT tab
    if (this.activeTab === 'output') {
      this.pm.renderOutputPreview(this.compositeCanvas)
      this.nodeEditor.setPreview(this.compositeCanvas)
      this.nodeEditor.draw()
    }
    // camera grid thumbnails in the CAMERA tab
    if (this.activeTab === 'camera' && this.camGrid) {
      this.camGrid.querySelectorAll('canvas').forEach((c) => {
        const id = (c.parentElement as HTMLElement).dataset.surfaceId
        const s = id ? this.pm.surfaces.get(id) : null
        if (s?.enabled) this.pm.renderCameraPreview(s, c as HTMLCanvasElement)
      })
    }
  }

  private pokeChrome() {
    if (!this.pm.outputLive) return
    this.chrome.classList.add('pm-chrome-visible')
    window.clearTimeout(this.chromeTimer)
    this.chromeTimer = window.setTimeout(() => this.chrome.classList.remove('pm-chrome-visible'), 2600)
  }

  // ------------------------------------------------------------ teardown
  dispose() {
    window.clearInterval(this.previewTimer)
    window.clearTimeout(this.chromeTimer)
    this.disposers.forEach((d) => d())
    this.disposers = []
    this.nodeEditor.dispose()
    this.root.remove()
    this.chrome.remove()
    document.body.classList.remove('projection-studio-open', 'projection-live')
    gsap.killTweensOf(this.root)
    void this.container
  }
}

function formatVal(v: number): string {
  return Math.abs(v) >= 10 ? String(Math.round(v)) : String(Math.round(v * 100) / 100)
}

/** readable W:H label — 1920×1080 → "16:9", 3840×1080 → "32:9", odd sizes → "1.78:1" */
function aspectLabel(w: number, h: number): string {
  if (w <= 0 || h <= 0) return '—'
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a)
  const g = gcd(Math.round(w), Math.round(h))
  const rw = Math.round(w) / g
  const rh = Math.round(h) / g
  if (rw <= 64 && rh <= 64) return `${rw}:${rh}`
  return `${(w / h).toFixed(2)}:1`
}

/** clipboard with a legacy fallback (headless / non-secure contexts) */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      ta.remove()
      return ok
    } catch {
      return false
    }
  }
}
