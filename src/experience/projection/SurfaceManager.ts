// ---------------------------------------------------------------
// SurfaceManager — the projection state store: surfaces, selection,
// undo/redo history. Pure data + notifications; rendering lives in
// OutputManager, UI subscribes to change events.
// Two channels: emit()  = full refresh (structure/props changed)
//              touch() = light update (node drag — rebuild geometry)
// ---------------------------------------------------------------
import {
  deepCloneSurface, makeSurfaceId,
  type ProjectionSurface,
} from './ProjectionTypes'

type FullListener = () => void
type LightListener = (s: ProjectionSurface) => void

const HISTORY_MAX = 60

export class SurfaceManager {
  surfaces: ProjectionSurface[] = []
  selectedId: string | null = null

  private fullListeners = new Set<FullListener>()
  private lightListeners = new Set<LightListener>()
  private undoStack: string[] = []
  private redoStack: string[] = []

  onChange(fn: FullListener): () => void {
    this.fullListeners.add(fn)
    return () => { this.fullListeners.delete(fn) }
  }

  onLightChange(fn: LightListener): () => void {
    this.lightListeners.add(fn)
    return () => { this.lightListeners.delete(fn) }
  }

  emit() {
    this.fullListeners.forEach((fn) => fn())
  }

  touch(s: ProjectionSurface) {
    this.lightListeners.forEach((fn) => fn(s))
  }

  // ------------------------------------------------------------ selection
  get selected(): ProjectionSurface | null {
    return this.surfaces.find((s) => s.id === this.selectedId) ?? null
  }

  select(id: string | null) {
    if (this.selectedId === id) return
    this.selectedId = id
    this.emit()
  }

  // ------------------------------------------------------------ CRUD
  add(surface: ProjectionSurface, select = true) {
    this.surfaces.push(surface)
    if (select) this.selectedId = surface.id
    this.emit()
    return surface
  }

  remove(id: string) {
    const idx = this.surfaces.findIndex((s) => s.id === id)
    if (idx === -1) return
    this.surfaces.splice(idx, 1)
    if (this.selectedId === id) this.selectedId = this.surfaces[Math.min(idx, this.surfaces.length - 1)]?.id ?? null
    this.emit()
  }

  duplicate(id: string) {
    const src = this.surfaces.find((s) => s.id === id)
    if (!src) return
    const copy = deepCloneSurface(src)
    copy.id = makeSurfaceId()
    copy.name = `${src.name} copy`
    const idx = this.surfaces.indexOf(src)
    this.surfaces.splice(idx + 1, 0, copy)
    this.selectedId = copy.id
    this.emit()
    return copy
  }

  get(id: string): ProjectionSurface | null {
    return this.surfaces.find((s) => s.id === id) ?? null
  }

  /** reorder for output stacking (renderOrder) */
  reorder(id: string, dir: -1 | 1) {
    const idx = this.surfaces.findIndex((s) => s.id === id)
    const next = idx + dir
    if (idx === -1 || next < 0 || next >= this.surfaces.length) return
    const [s] = this.surfaces.splice(idx, 1)
    this.surfaces.splice(next, 0, s)
    this.emit()
  }

  replaceAll(surfaces: ProjectionSurface[], keepSelection = false) {
    this.surfaces = surfaces
    if (!keepSelection || !this.surfaces.some((s) => s.id === this.selectedId)) {
      this.selectedId = this.surfaces[0]?.id ?? null
    }
    this.emit()
  }

  // ------------------------------------------------------------ history
  /** snapshot current state — call BEFORE a mutating interaction */
  snapshot() {
    this.undoStack.push(JSON.stringify(this.surfaces))
    if (this.undoStack.length > HISTORY_MAX) this.undoStack.shift()
    this.redoStack.length = 0
  }

  undo(): boolean {
    const prev = this.undoStack.pop()
    if (!prev) return false
    this.redoStack.push(JSON.stringify(this.surfaces))
    this.applyState(prev)
    return true
  }

  redo(): boolean {
    const next = this.redoStack.pop()
    if (!next) return false
    this.undoStack.push(JSON.stringify(this.surfaces))
    this.applyState(next)
    return true
  }

  get canUndo(): boolean { return this.undoStack.length > 0 }
  get canRedo(): boolean { return this.redoStack.length > 0 }

  /** QA introspection: parse the top history entries */
  debugPeek(): { undoTopName: string | null; undoTopTl: string | null; sizes: [number, number] } {
    const top = this.undoStack[this.undoStack.length - 1]
    let name: string | null = null
    let tl: string | null = null
    if (top) {
      const parsed = JSON.parse(top) as ProjectionSurface[]
      name = parsed[0]?.name ?? null
      tl = parsed[0] ? JSON.stringify(parsed[0].warp.corners.tl) : null
    }
    return { undoTopName: name, undoTopTl: tl, sizes: [this.undoStack.length, this.redoStack.length] }
  }

  private applyState(json: string) {
    this.surfaces = JSON.parse(json) as ProjectionSurface[]
    if (!this.surfaces.some((s) => s.id === this.selectedId)) {
      this.selectedId = this.surfaces[0]?.id ?? null
    }
    this.emit()
  }

  serialize(): ProjectionSurface[] {
    return JSON.parse(JSON.stringify(this.surfaces)) as ProjectionSurface[]
  }
}
