// ---------------------------------------------------------------
// OutputNodeEditor — the 2D output-space slice editor. Draws the
// projector canvas with every surface outline, live composite
// preview underneath, and draggable corner/mesh nodes for the
// selected surface. Supports snap-to-grid, numeric coordinate
// readout, whole-surface dragging, and undo integration.
// ---------------------------------------------------------------
import gsap from 'gsap'
import type { ProjectionManager } from './ProjectionManager'
import type { ProjectionSurface, Vec2 } from './ProjectionTypes'
import { gridFromCorners, gridIndex, pointInQuad } from './ProjectionMath'

interface DragState {
  kind: 'corner' | 'node' | 'surface'
  nodeIndex?: number
  cornerKey?: 'tl' | 'tr' | 'br' | 'bl'
  startX: number
  startY: number
  origOutput: { x: number; y: number }
  origGrid: Vec2[]
  origCorners: ProjectionSurface['warp']['corners']
}

interface SnapTargetSet {
  pts: Vec2[]
  edges: [Vec2, Vec2][]
}

interface SnapHit {
  p: Vec2
  d2: number
  kind: 'point' | 'edge'
  a: Vec2
  b?: Vec2
}

const CORNER_KEYS: (keyof ProjectionSurface['warp']['corners'])[] = ['tl', 'tr', 'br', 'bl']

export class OutputNodeEditor {
  root: HTMLElement
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private coordsEl: HTMLElement
  private drag: DragState | null = null
  private hoverKey: string | null = null
  private scale = 1
  private ox = 0
  private oy = 0
  private snapEnabled = true
  private snapSize = 10
  /** magnetic seams — snap to neighbouring surfaces so edges connect gap-free */
  private surfSnap = true
  /** rule-of-thirds / center / ruler guides drawn over the output space */
  guides = true
  /** live snap indicator while dragging */
  private snapHit: SnapHit | null = null
  /** UI bridge — fullscreen editor toggle (wired by ProjectionEditorUI) */
  onFullscreen: (() => void) | null = null
  private dpr = Math.min(window.devicePixelRatio || 1, 2)
  private previewCanvas: HTMLCanvasElement
  private ro: ResizeObserver

  constructor(private container: HTMLElement, private pm: ProjectionManager) {
    this.root = document.createElement('div')
    this.root.className = 'pm-output-editor'
    this.root.innerHTML = `
      <div class="pm-editor-toolbar">
        <label class="pm-check"><input type="checkbox" id="pm-snap" checked> SNAP</label>
        <select id="pm-snap-size" class="pm-select pm-select-sm" title="Snap grid size">
          <option value="5">5 px</option>
          <option value="10" selected>10 px</option>
          <option value="25">25 px</option>
          <option value="50">50 px</option>
        </select>
        <label class="pm-check" title="Magnetic seams — surfaces snap to each other so edges connect without gaps"><input type="checkbox" id="pm-magnet" checked> MAGNET</label>
        <label class="pm-check" title="Rule-of-thirds, center cross and ruler guides over the output"><input type="checkbox" id="pm-guides" checked> GUIDES</label>
        <span class="pm-toolbar-sep"></span>
        <button class="pm-btn pm-btn-sm" data-act="undo" title="Undo (Ctrl+Z)">UNDO</button>
        <button class="pm-btn pm-btn-sm" data-act="redo" title="Redo (Ctrl+Shift+Z)">REDO</button>
        <span class="pm-toolbar-sep"></span>
        <button class="pm-btn pm-btn-sm" data-act="reset" title="Reset corners to the output rectangle">RESET CORNERS</button>
        <button class="pm-btn pm-btn-sm" data-act="fit" title="Fit surface to the whole output">FIT OUTPUT</button>
        <button class="pm-btn pm-btn-sm" data-act="center" title="Center the surface">CENTER</button>
        <button class="pm-btn pm-btn-sm" data-act="fullscreen" title="Edit this canvas fullscreen with guides — same tools, whole screen">⛶ FULLSCREEN</button>
        <span class="pm-editor-tip">drag corners to pin · select a surface by clicking it · drag inside to move · hold ALT to bypass snapping</span>
      </div>
      <div class="pm-editor-stage">
        <canvas id="pm-output-canvas"></canvas>
        <div class="pm-coords" style="display:none"></div>
      </div>`

    this.canvas = this.root.querySelector('#pm-output-canvas')!
    this.ctx = this.canvas.getContext('2d')!
    this.coordsEl = this.root.querySelector('.pm-coords')!
    this.previewCanvas = document.createElement('canvas')  // live composite underlay

    // events
    this.canvas.addEventListener('pointerdown', this.onPointerDown)
    window.addEventListener('pointermove', this.onPointerMove)
    window.addEventListener('pointerup', this.onPointerUp)
    this.root.querySelector('#pm-snap')?.addEventListener('change', (e) => {
      this.snapEnabled = (e.target as HTMLInputElement).checked
      this.draw()
    })
    this.root.querySelector('#pm-snap-size')?.addEventListener('change', (e) => {
      this.snapSize = Number((e.target as HTMLSelectElement).value)
      this.draw()
    })
    this.root.querySelector('#pm-magnet')?.addEventListener('change', (e) => {
      this.surfSnap = (e.target as HTMLInputElement).checked
      this.draw()
    })
    this.root.querySelector('#pm-guides')?.addEventListener('change', (e) => {
      this.guides = (e.target as HTMLInputElement).checked
      this.draw()
    })
    this.root.querySelectorAll('[data-act]').forEach((b) => {
      b.addEventListener('click', () => this.runAction((b as HTMLElement).dataset.act!))
    })

    this.ro = new ResizeObserver(() => this.handleResize())
    this.ro.observe(this.root.querySelector('.pm-editor-stage')!)
    container.appendChild(this.root)
    this.handleResize()
  }

  // ------------------------------------------------------------ actions
  private runAction(act: string) {
    const s = this.pm.surfaces.selected
    const W = this.pm.output.width, H = this.pm.output.height
    switch (act) {
      case 'undo': this.pm.undo(); return
      case 'redo': this.pm.redo(); return
      case 'fullscreen': this.onFullscreen?.(); return
      case 'reset':
        if (!s) return
        this.pm.surfaces.snapshot()
        s.warp.corners = {
          tl: { x: s.output.x, y: s.output.y },
          tr: { x: s.output.x + s.output.width, y: s.output.y },
          br: { x: s.output.x + s.output.width, y: s.output.y + s.output.height },
          bl: { x: s.output.x, y: s.output.y + s.output.height },
        }
        s.warp.gridCustom = false
        s.warp.grid = gridFromCorners(s.warp.corners, s.warp.gridResolution)
        this.pm.surfaces.emit()
        break
      case 'fit': {
        if (!s) return
        this.pm.surfaces.snapshot()
        this.applySurfaceRect(s, 0, 0, W, H)
        this.pm.surfaces.emit()
        break
      }
      case 'center': {
        if (!s) return
        this.pm.surfaces.snapshot()
        const dx = (W - s.output.width) / 2 - s.output.x
        const dy = (H - s.output.height) / 2 - s.output.y
        this.moveSurfaceBy(s, dx, dy)
        this.pm.surfaces.emit()
        break
      }
    }
    this.draw()
  }

  private applySurfaceRect(s: ProjectionSurface, x: number, y: number, w: number, h: number) {
    s.output = { x, y, width: w, height: h }
    s.warp.corners = {
      tl: { x, y }, tr: { x: x + w, y }, br: { x: x + w, y: y + h }, bl: { x, y: y + h },
    }
    s.warp.gridCustom = false
    s.warp.grid = gridFromCorners(s.warp.corners, s.warp.gridResolution)
  }

  private moveSurfaceBy(s: ProjectionSurface, dx: number, dy: number) {
    s.output.x += dx
    s.output.y += dy
    CORNER_KEYS.forEach((k) => {
      s.warp.corners[k].x += dx
      s.warp.corners[k].y += dy
    })
    s.warp.grid.forEach((p) => { p.x += dx; p.y += dy })
  }

  // ------------------------------------------------------------ coordinate mapping
  private handleResize() {
    const stage = this.canvas.parentElement!
    const w = stage.clientWidth, h = stage.clientHeight
    if (w < 4 || h < 4) return
    this.canvas.width = Math.round(w * this.dpr)
    this.canvas.height = Math.round(h * this.dpr)
    this.canvas.style.width = `${w}px`
    this.canvas.style.height = `${h}px`
    this.draw()
  }

  private computeFit(W: number, H: number) {
    const cw = this.canvas.width / this.dpr
    const ch = this.canvas.height / this.dpr
    const s = Math.min(cw / W, ch / H) * 0.94
    this.scale = s
    this.ox = (cw - W * s) / 2
    this.oy = (ch - H * s) / 2
  }

  private toCanvas(p: Vec2): Vec2 {
    return { x: p.x * this.scale + this.ox, y: p.y * this.scale + this.oy }
  }

  private toOutput(cx: number, cy: number): Vec2 {
    return { x: (cx - this.ox) / this.scale, y: (cy - this.oy) / this.scale }
  }

  // ------------------------------------------------------------ hit testing
  private nodePositions(s: ProjectionSurface): Vec2[] {
    return s.warp.grid
  }

  private hitNode(s: ProjectionSurface, out: Vec2): { kind: 'corner' | 'node'; index: number; cornerKey?: 'tl' | 'tr' | 'br' | 'bl' } | null {
    const res = s.warp.gridResolution
    const tol = 9 / this.scale
    // corners first (bigger targets)
    const corners: [string, Vec2, keyof ProjectionSurface['warp']['corners']][] = [
      ['tl', s.warp.corners.tl, 'tl'], ['tr', s.warp.corners.tr, 'tr'],
      ['br', s.warp.corners.br, 'br'], ['bl', s.warp.corners.bl, 'bl'],
    ]
    for (const [, p, key] of corners) {
      if (Math.abs(p.x - out.x) < tol && Math.abs(p.y - out.y) < tol) return { kind: 'corner', index: CORNER_KEYS.indexOf(key), cornerKey: key as 'tl' | 'tr' | 'br' | 'bl' }
    }
    // interior mesh nodes
    for (let idx = 0; idx < this.nodePositions(s).length; idx++) {
      const p = s.warp.grid[idx]
      const isCorner = idx === 0 || idx === res || idx === res * (res + 1) + res || idx === res * (res + 1)
      if (isCorner) continue
      if (Math.abs(p.x - out.x) < tol * 0.8 && Math.abs(p.y - out.y) < tol * 0.8) {
        return { kind: 'node', index: idx }
      }
    }
    return null
  }

  // ------------------------------------------------------------ pointer
  private onPointerDown = (e: PointerEvent) => {
    const rect = this.canvas.getBoundingClientRect()
    const cx = e.clientX - rect.left, cy = e.clientY - rect.top
    const out = this.toOutput(cx, cy)
    const W = this.pm.output.width, H = this.pm.output.height
    if (out.x < -40 || out.y < -40 || out.x > W + 40 || out.y > H + 40) return

    const sel = this.pm.surfaces.selected
    // 1) node grab on selected surface
    if (sel && !sel.locked) {
      const hit = this.hitNode(sel, out)
      if (hit) {
        this.pm.surfaces.snapshot()
        this.drag = {
          kind: hit.kind,
          nodeIndex: hit.index,
          cornerKey: hit.cornerKey,
          startX: out.x, startY: out.y,
          origOutput: { ...sel.output },
          origGrid: sel.warp.grid.map((p) => ({ ...p })),
          origCorners: JSON.parse(JSON.stringify(sel.warp.corners)),
        }
        this.canvas.setPointerCapture(e.pointerId)
        this.showCoords(true)
        return
      }
    }

    // 2) select by polygon hit (topmost last drawn = highest renderOrder)
    for (let i = this.pm.surfaces.surfaces.length - 1; i >= 0; i--) {
      const s = this.pm.surfaces.surfaces[i]
      if (!s.enabled) continue
      if (pointInQuad(out, s.warp.corners)) {
        if (this.pm.surfaces.selectedId !== s.id) {
          this.pm.surfaces.select(s.id)
          return
        }
        if (!s.locked) {
          // whole-surface move
          this.pm.surfaces.snapshot()
          this.drag = {
            kind: 'surface', startX: out.x, startY: out.y,
            origOutput: { ...s.output },
            origGrid: s.warp.grid.map((p) => ({ ...p })),
            origCorners: JSON.parse(JSON.stringify(s.warp.corners)),
          }
          this.canvas.setPointerCapture(e.pointerId)
          this.showCoords(true)
        }
        return
      }
    }
  }

  // ------------------------------------------------------------ magnetic seams
  /**
   * Snap targets from every OTHER surface: their corners plus their four
   * outline edges (and the boundary nodes of hand-edited meshes). Dragging a
   * surface (or any of its nodes) near a neighbour lands EXACTLY on the
   * neighbour's geometry, so projected seams stay connected without gaps.
   */
  private snapTargets(excludeId: string | null): SnapTargetSet {
    const pts: Vec2[] = []
    const edges: [Vec2, Vec2][] = []
    for (const s of this.pm.surfaces.surfaces) {
      if (s.id === excludeId || !s.enabled) continue
      const c = s.warp.corners
      pts.push({ ...c.tl }, { ...c.tr }, { ...c.br }, { ...c.bl })
      edges.push([c.tl, c.tr], [c.tr, c.br], [c.br, c.bl], [c.bl, c.tl])
      if (s.warp.gridCustom && s.warp.gridResolution > 1) {
        const res = s.warp.gridResolution
        const n = res + 1
        const g = s.warp.grid
        for (let i = 1; i < res; i++) {
          pts.push({ ...g[gridIndex(res, i, 0)] }, { ...g[gridIndex(res, i, res)] })
          pts.push({ ...g[gridIndex(res, 0, i)] }, { ...g[gridIndex(res, res, i)] })
        }
        void n
      }
    }
    return { pts, edges }
  }

  /** nearest point-snap, else nearest edge-snap, within a ~14 px (canvas) radius */
  private snapToTargets(p: Vec2, targets: SnapTargetSet): SnapHit | null {
    const R = Math.max(8, 14 / this.scale)
    let best: SnapHit | null = null
    for (const t of targets.pts) {
      const d2 = (t.x - p.x) ** 2 + (t.y - p.y) ** 2
      if (d2 <= R * R && (!best || d2 < best.d2)) best = { p: { ...t }, d2, kind: 'point', a: { ...t } }
    }
    if (best) return best
    for (const [a, b] of targets.edges) {
      const vx = b.x - a.x, vy = b.y - a.y
      const len2 = vx * vx + vy * vy
      if (len2 < 1e-6) continue
      let t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2
      t = Math.max(0, Math.min(1, t))
      const q = { x: a.x + vx * t, y: a.y + vy * t }
      const d2 = (q.x - p.x) ** 2 + (q.y - p.y) ** 2
      if (d2 <= R * R && (!best || d2 < best.d2)) best = { p: q, d2, kind: 'edge', a: { ...a }, b: { ...b } }
    }
    return best
  }

  /**
   * Whole-surface drag: test all four would-be corners against the targets
   * and shift by the single best snap — the surface glues edge-first onto
   * its neighbour instead of fighting the grid snap.
   */
  private snapSurfaceDelta(corners: Vec2[], targets: SnapTargetSet): SnapHit | null {
    let best: SnapHit | null = null
    for (const c of corners) {
      const hit = this.snapToTargets(c, targets)
      if (hit && (!best || hit.d2 < best.d2)) {
        best = { ...hit, p: { x: hit.p.x - c.x, y: hit.p.y - c.y } }  // store delta in p
      }
    }
    return best
  }

  private onPointerMove = (e: PointerEvent) => {
    const rect = this.canvas.getBoundingClientRect()
    const cx = e.clientX - rect.left, cy = e.clientY - rect.top
    const out = this.toOutput(cx, cy)
    const s = this.pm.surfaces.selected

    if (!this.drag) {
      // hover state
      this.snapHit = null
      let hover: string | null = null
      if (s && !s.locked) {
        const hit = this.hitNode(s, out)
        if (hit) hover = hit.kind === 'corner' ? `corner-${hit.cornerKey}` : `node-${hit.index}`
      }
      if (hover !== this.hoverKey) {
        this.hoverKey = hover
        this.canvas.style.cursor = hover
          ? hover.startsWith('corner') ? 'grab' : 'crosshair'
          : 'default'
        this.draw()
      }
      return
    }

    const sel = this.pm.surfaces.selected
    if (!sel) return
    const W = this.pm.output.width, H = this.pm.output.height
    let dx = out.x - this.drag.startX
    let dy = out.y - this.drag.startY
    this.snapHit = null

    // magnetic seams first — surfaces glue onto their neighbours edge-exact;
    // hold ALT (or untick MAGNET) to bypass. Grid snap only fills the gaps.
    const magnet = this.snapEnabled && this.surfSnap && !e.altKey
    const targets = magnet ? this.snapTargets(sel.id) : null
    if (targets && this.drag.kind === 'surface') {
      const cand = CORNER_KEYS.map((k) => ({
        x: this.drag!.origCorners[k].x + dx,
        y: this.drag!.origCorners[k].y + dy,
      }))
      const hit = this.snapSurfaceDelta(cand, targets)
      if (hit) {
        dx += hit.p.x; dy += hit.p.y
        this.snapHit = { kind: hit.kind, a: hit.a, b: hit.b, d2: hit.d2, p: hit.p }
      }
    } else if (targets && (this.drag.kind === 'corner' || this.drag.kind === 'node')) {
      const base = this.drag.kind === 'corner'
        ? this.drag.origCorners[this.drag.cornerKey!]
        : this.drag.origGrid[this.drag.nodeIndex!]
      const hit = this.snapToTargets({ x: base.x + dx, y: base.y + dy }, targets)
      if (hit) {
        dx = hit.p.x - base.x
        dy = hit.p.y - base.y
        this.snapHit = hit
      }
    }

    if (this.snapEnabled && !e.altKey && !this.snapHit) {
      let absX: number, absY: number
      if (this.drag.kind === 'surface') {
        absX = this.drag.origOutput.x + dx
        absY = this.drag.origOutput.y + dy
      } else if (this.drag.kind === 'corner') {
        const key = this.drag.cornerKey!
        absX = this.drag.origCorners[key].x + dx
        absY = this.drag.origCorners[key].y + dy
      } else {
        const idx = this.drag.nodeIndex!
        absX = this.drag.origGrid[idx].x + dx
        absY = this.drag.origGrid[idx].y + dy
      }
      dx += this.snapDelta(absX, W)
      dy += this.snapDelta(absY, H)
    }

    if (this.drag.kind === 'surface') {
      const nx = Math.round(this.drag.origOutput.x + dx)
      const ny = Math.round(this.drag.origOutput.y + dy)
      const shiftX = nx - this.drag.origOutput.x
      const shiftY = ny - this.drag.origOutput.y
      sel.output.x = nx
      sel.output.y = ny
      CORNER_KEYS.forEach((k) => {
        sel.warp.corners[k].x = this.drag!.origCorners[k].x + shiftX
        sel.warp.corners[k].y = this.drag!.origCorners[k].y + shiftY
      })
      sel.warp.grid.forEach((p, i) => {
        p.x = this.drag!.origGrid[i].x + shiftX
        p.y = this.drag!.origGrid[i].y + shiftY
      })
      this.updateCoords(out, `${sel.output.x}, ${sel.output.y}`)
    } else if (this.drag.kind === 'corner') {
      const key = this.drag.cornerKey!
      sel.warp.corners[key] = { x: Math.round(this.drag.origCorners[key].x + dx), y: Math.round(this.drag.origCorners[key].y + dy) }
      sel.warp.grid = gridFromCorners(sel.warp.corners, sel.warp.gridResolution)
      sel.warp.gridCustom = false
      this.updateCoords(out, `${Math.round(sel.warp.corners[key].x)}, ${Math.round(sel.warp.corners[key].y)}`)
    } else {
      const idx = this.drag.nodeIndex!
      sel.warp.grid[idx] = {
        x: Math.round(this.drag.origGrid[idx].x + dx),
        y: Math.round(this.drag.origGrid[idx].y + dy),
      }
      sel.warp.gridCustom = true
      this.updateCoords(out, `${Math.round(sel.warp.grid[idx].x)}, ${Math.round(sel.warp.grid[idx].y)}`)
    }

    // live feedback: composite geometry + camera aspect + editor canvas
    this.pm.surfaces.touch(sel)
    this.draw()
  }

  private snapDelta(abs: number, max: number): number {
    const g = this.snapSize
    const snapped = Math.round(abs / g) * g
    let delta = snapped - abs
    if (Math.abs(snapped) <= 4 || Math.abs(max - snapped) <= 4) delta = (Math.abs(snapped) <= 4 ? 0 : max) - abs
    return delta
  }

  private onPointerUp = () => {
    if (!this.drag) return
    this.drag = null
    this.snapHit = null
    this.showCoords(false)
    this.pm.endEdit()
    this.pm.surfaces.emit()   // full refresh: properties, list, autosave
    this.draw()
  }

  // ------------------------------------------------------------ overlays
  private showCoords(on: boolean) {
    this.coordsEl.style.display = on ? 'block' : 'none'
  }

  private updateCoords(out: Vec2, text: string) {
    this.coordsEl.textContent = `X ${Math.round(out.x)}  Y ${Math.round(out.y)}   →  ${text}`
  }

  /** composite preview underlay — called by the UI's preview ticker */
  setPreview(source: HTMLCanvasElement | null) {
    this.previewCanvas = source ?? document.createElement('canvas')
  }

  draw() {
    const ctx = this.ctx
    const W = this.pm.output.width, H = this.pm.output.height
    this.computeFit(W, H)
    const cw = this.canvas.width, ch = this.canvas.height
    ctx.save()
    ctx.scale(this.dpr, this.dpr)
    ctx.clearRect(0, 0, cw, ch)

    // output space backdrop
    const o = this.toCanvas({ x: 0, y: 0 })
    const w = W * this.scale, h = H * this.scale
    ctx.fillStyle = '#04101a'
    ctx.fillRect(o.x, o.y, w, h)

    // live composite preview (throttled readback from the GPU)
    if (this.previewCanvas?.width > 1) {
      ctx.save()
      ctx.globalAlpha = 0.85
      ctx.drawImage(this.previewCanvas, o.x, o.y, w, h)
      ctx.restore()
    }

    // snap grid
    if (this.snapEnabled) {
      ctx.strokeStyle = 'rgba(120,200,225,0.09)'
      ctx.lineWidth = 1
      const g = this.snapSize * this.scale
      if (g > 7) {
        ctx.beginPath()
        for (let x = o.x % g; x < o.x + w; x += g) { ctx.moveTo(x, o.y); ctx.lineTo(x, o.y + h) }
        for (let y = o.y % g; y < o.y + h; y += g) { ctx.moveTo(o.x, y); ctx.lineTo(o.x + w, y) }
        ctx.stroke()
      }
    }
    ctx.strokeStyle = 'rgba(150,215,235,0.4)'
    ctx.lineWidth = 1
    ctx.strokeRect(o.x, o.y, w, h)

    // surfaces (topmost last)
    for (const s of this.pm.surfaces.surfaces) this.drawSurface(ctx, s, s.id === this.pm.surfaces.selectedId)

    // connection proofs + calibration guides + live snap feedback
    this.drawSeamGlue(ctx)
    if (this.guides) this.drawGuides(ctx)
    if (this.snapHit) this.drawSnapHit(ctx)

    ctx.restore()
  }

  /** bright “glue” where two surfaces’ edges touch within ~3 px — proof the seams connect */
  private drawSeamGlue(ctx: CanvasRenderingContext2D) {
    const list = this.pm.surfaces.surfaces.filter((s) => s.enabled)
    if (list.length < 2) return
    const EPS = 3
    const quads = list.map((s) => {
      const c = s.warp.corners
      return [[c.tl, c.tr], [c.tr, c.br], [c.br, c.bl], [c.bl, c.tl]] as [Vec2, Vec2][]
    })
    const distToSeg = (p: Vec2, a: Vec2, b: Vec2): number => {
      const vx = b.x - a.x, vy = b.y - a.y
      const len2 = vx * vx + vy * vy
      if (len2 < 1e-6) return Math.hypot(p.x - a.x, p.y - a.y)
      let t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2
      t = Math.max(0, Math.min(1, t))
      return Math.hypot(p.x - (a.x + vx * t), p.y - (a.y + vy * t))
    }
    const segs: [Vec2, Vec2][] = []
    const dots: Vec2[] = []
    for (let i = 0; i < quads.length; i++) {
      for (let j = i + 1; j < quads.length; j++) {
        for (const ea of quads[i]) {
          for (const eb of quads[j]) {
            const na = distToSeg(ea[0], eb[0], eb[1]) < EPS
            const nb = distToSeg(ea[1], eb[0], eb[1]) < EPS
            if (na && nb) { segs.push([{ ...ea[0] }, { ...ea[1] }]); segs.push([{ ...eb[0] }, { ...eb[1] }]) }
            else if (na || nb) dots.push({ ...(na ? ea[0] : ea[1]) })
          }
        }
      }
    }
    if (!segs.length && !dots.length) return
    ctx.save()
    ctx.lineCap = 'round'
    for (const [p, q] of segs) {
      const cp = this.toCanvas(p), cq = this.toCanvas(q)
      ctx.strokeStyle = 'rgba(255,224,138,0.25)'
      ctx.lineWidth = 7
      ctx.beginPath(); ctx.moveTo(cp.x, cp.y); ctx.lineTo(cq.x, cq.y); ctx.stroke()
      ctx.strokeStyle = 'rgba(255,224,138,0.85)'
      ctx.lineWidth = 2
      ctx.beginPath(); ctx.moveTo(cp.x, cp.y); ctx.lineTo(cq.x, cq.y); ctx.stroke()
    }
    for (const p of dots) {
      const cp = this.toCanvas(p)
      ctx.fillStyle = 'rgba(255,224,138,0.95)'
      ctx.beginPath(); ctx.arc(cp.x, cp.y, 3.4, 0, Math.PI * 2); ctx.fill()
    }
    ctx.restore()
  }

  /** rule-of-thirds, center cross and a 100 px ruler over the output space */
  private drawGuides(ctx: CanvasRenderingContext2D) {
    const W = this.pm.output.width, H = this.pm.output.height
    const o = this.toCanvas({ x: 0, y: 0 })
    const w = W * this.scale, h = H * this.scale
    if (w < 30 || h < 30) return
    ctx.save()
    ctx.strokeStyle = 'rgba(140,220,245,0.20)'
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let i = 1; i <= 2; i++) {
      const x = o.x + (w * i) / 3, y = o.y + (h * i) / 3
      ctx.moveTo(x, o.y); ctx.lineTo(x, o.y + h)
      ctx.moveTo(o.x, y); ctx.lineTo(o.x + w, y)
    }
    ctx.stroke()
    const cx = o.x + w / 2, cy = o.y + h / 2
    ctx.strokeStyle = 'rgba(255,224,138,0.45)'
    ctx.beginPath()
    ctx.moveTo(cx - 11, cy); ctx.lineTo(cx + 11, cy)
    ctx.moveTo(cx, cy - 11); ctx.lineTo(cx, cy + 11)
    ctx.stroke()
    ctx.strokeStyle = 'rgba(150,215,235,0.42)'
    ctx.fillStyle = 'rgba(190,228,240,0.62)'
    ctx.font = '500 8px ui-monospace, monospace'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.beginPath()
    for (let x = 0; x <= W; x += 100) {
      const px = this.toCanvas({ x, y: 0 }).x
      ctx.moveTo(px, o.y); ctx.lineTo(px, o.y - 6)
      if (x > 0 && x % 500 === 0) ctx.fillText(String(x), px + 2, o.y - 14)
    }
    for (let y = 0; y <= H; y += 100) {
      const py = this.toCanvas({ x: 0, y }).y
      ctx.moveTo(o.x, py); ctx.lineTo(o.x - 6, py)
    }
    ctx.stroke()
    ctx.restore()
  }

  /** the live magnet indicator — the exact corner/edge the drag is glued to */
  private drawSnapHit(ctx: CanvasRenderingContext2D) {
    const hit = this.snapHit!
    const a = this.toCanvas(hit.a)
    ctx.save()
    if (hit.kind === 'edge' && hit.b) {
      const b = this.toCanvas(hit.b)
      ctx.strokeStyle = 'rgba(255,224,138,0.9)'
      ctx.lineWidth = 3
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke()
    }
    ctx.fillStyle = '#ffe08a'
    ctx.beginPath(); ctx.arc(a.x, a.y, 4.6, 0, Math.PI * 2); ctx.fill()
    ctx.strokeStyle = 'rgba(4,20,30,0.9)'
    ctx.lineWidth = 1.4
    ctx.beginPath(); ctx.arc(a.x, a.y, 4.6, 0, Math.PI * 2); ctx.stroke()
    ctx.restore()
  }

  private drawSurface(ctx: CanvasRenderingContext2D, s: ProjectionSurface, selected: boolean) {
    const res = s.warp.gridResolution
    const pts = s.warp.corners
    const path = new Path2D()
    const c0 = this.toCanvas(pts.tl)
    const c1 = this.toCanvas(pts.tr)
    const c2 = this.toCanvas(pts.br)
    const c3 = this.toCanvas(pts.bl)
    path.moveTo(c0.x, c0.y); path.lineTo(c1.x, c1.y); path.lineTo(c2.x, c2.y); path.lineTo(c3.x, c3.y)
    path.closePath()

    // fill
    ctx.fillStyle = selected ? 'rgba(63,224,200,0.10)' : 'rgba(150,215,235,0.045)'
    ctx.fill(path)

    // feather bands (selected only)
    if (selected) {
      const f = s.blend.feather
      const band = (a: Vec2, b: Vec2, frac: number) => {
        if (frac <= 0) return
        const grad = ctx.createLinearGradient(a.x, a.y, b.x, b.y)
        grad.addColorStop(0, 'rgba(63,224,200,0.28)')
        grad.addColorStop(1, 'rgba(63,224,200,0)')
        ctx.fillStyle = grad
        ctx.beginPath()
        const a2 = { x: a.x + (b.x - a.x) * frac, y: a.y + (b.y - a.y) * frac }
        const b2 = { x: b.x + (a.x - b.x) * frac, y: b.y + (a.y - b.y) * frac }
        ctx.moveTo(a.x, a.y); ctx.lineTo(a2.x, a2.y); ctx.lineTo(b2.x, b2.y); ctx.lineTo(b.x, b.y)
        ctx.closePath(); ctx.fill()
      }
      band(c0, c1, f.top); band(c1, c2, f.right); band(c2, c3, f.bottom); band(c3, c0, f.left)
    }

    // outline
    ctx.setLineDash(s.enabled ? [] : [6, 5])
    ctx.strokeStyle = selected ? '#3fe0c8' : 'rgba(170,220,240,0.42)'
    ctx.lineWidth = selected ? 2 : 1.2
    ctx.stroke(path)
    ctx.setLineDash([])

    // mesh grid lines for the selected surface (res>1)
    if (selected && res > 1) {
      ctx.strokeStyle = 'rgba(63,224,200,0.18)'
      ctx.lineWidth = 1
      ctx.beginPath()
      for (let j = 0; j <= res; j++) {
        for (let i = 0; i < res; i++) {
          const a = this.toCanvas(s.warp.grid[gridIndex(res, i, j)])
          const b = this.toCanvas(s.warp.grid[gridIndex(res, i + 1, j)])
          ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y)
        }
      }
      for (let i = 0; i <= res; i++) {
        for (let j = 0; j < res; j++) {
          const a = this.toCanvas(s.warp.grid[gridIndex(res, i, j)])
          const b = this.toCanvas(s.warp.grid[gridIndex(res, i, j + 1)])
          ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y)
        }
      }
      ctx.stroke()
    }

    // nodes
    if (selected && !s.locked) {
      // interior mesh nodes
      for (let idx = 0; idx < s.warp.grid.length; idx++) {
        const isCorner = idx === 0 || idx === res || idx === res * (res + 1) + res || idx === res * (res + 1)
        if (isCorner || res < 1) continue
        const p = this.toCanvas(s.warp.grid[idx])
        const hovered = this.hoverKey === `node-${idx}`
        ctx.beginPath()
        ctx.arc(p.x, p.y, hovered ? 4.4 : 3, 0, Math.PI * 2)
        ctx.fillStyle = hovered ? '#ffe08a' : 'rgba(63,224,200,0.75)'
        ctx.fill()
      }
      // corners
      const cornerPts: [Vec2, string, keyof ProjectionSurface['warp']['corners']][] = [
        [pts.tl, 'TL', 'tl'], [pts.tr, 'TR', 'tr'], [pts.br, 'BR', 'br'], [pts.bl, 'BL', 'bl'],
      ]
      for (const [p, label, key] of cornerPts) {
        const cp = this.toCanvas(p)
        const hovered = this.hoverKey === `corner-${key}`
        ctx.fillStyle = hovered ? '#ffe08a' : '#3fe0c8'
        ctx.fillRect(cp.x - 5, cp.y - 5, 10, 10)
        ctx.strokeStyle = 'rgba(4,20,30,0.9)'
        ctx.lineWidth = 1.4
        ctx.strokeRect(cp.x - 5, cp.y - 5, 10, 10)
        ctx.fillStyle = 'rgba(210,245,255,0.9)'
        ctx.font = '600 9px ui-monospace, monospace'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(label, cp.x, cp.y)
      }
    }

    // label
    const centroid = this.toCanvas({
      x: (pts.tl.x + pts.tr.x + pts.br.x + pts.bl.x) / 4,
      y: (pts.tl.y + pts.tr.y + pts.br.y + pts.bl.y) / 4,
    })
    ctx.font = '600 10px ui-monospace, monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const label = s.locked ? `${s.name} — LOCKED` : s.name
    const tw = ctx.measureText(label).width
    ctx.fillStyle = selected ? 'rgba(6,26,36,0.85)' : 'rgba(6,20,30,0.65)'
    ctx.fillRect(centroid.x - tw / 2 - 5, centroid.y - 8, tw + 10, 16)
    ctx.fillStyle = selected ? '#8ff0dd' : 'rgba(190,225,240,0.75)'
    ctx.fillText(label, centroid.x, centroid.y)
  }

  // ------------------------------------------------------------ public bridges for the editor UI
  handleResizePublic() {
    this.handleResize()
  }

  runActionPublic(act: string) {
    this.runAction(act)
  }

  dispose() {
    this.canvas.removeEventListener('pointerdown', this.onPointerDown)
    window.removeEventListener('pointermove', this.onPointerMove)
    window.removeEventListener('pointerup', this.onPointerUp)
    this.ro.disconnect()
    this.root.remove()
    void this.container
    gsap.killTweensOf(this.root)
  }
}


