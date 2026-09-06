// ---------------------------------------------------------------
// FolderSync — LIVE folder watch for the exhibition scanner.
//
// The exhibition setup: a scanner machine saves every coloured sheet
// it photographs into one folder. The operator points this module at
// that folder ONCE; from then on every new image that lands in it is
// automatically processed (FishScan pipeline: template-guided
// silhouette crop, background erase) and released into the session's
// tank — it appears in the pool on every screen within seconds,
// hands-free, all show long.
//
// Browser reality check: a page cannot secretly watch the disk —
// it uses the File System Access API. The picked directory HANDLE is
// persisted in IndexedDB, so after a reload the watch resumes with a
// single click (Chromium requires one user gesture to re-grant
// read permission). Polling (every 2.5 s) is deliberately simple and
// robust: scanner kiosks just drop files, no OS hooks needed.
// ---------------------------------------------------------------
import { processFishImage } from './FishScan'

export type FolderSyncStatus =
  | 'idle'             // nothing picked yet
  | 'watching'         // polling the folder, all good
  | 'needs-permission' // handle exists but Chromium wants a click to re-grant
  | 'unsupported'      // no File System Access API (Firefox / Safari)
  | 'error'            // unreadable folder / IO trouble

export interface FolderSyncState {
  status: FolderSyncStatus
  folderName: string | null
  /** files imported since this page started watching */
  imported: number
  /** files seen and skipped (already processed / not an image) */
  skipped: number
  lastFileName: string | null
  lastError: string | null
}

const POLL_MS = 2500
const DB_NAME = 'ocean-fs'
const STORE = 'handles'
const KEY = 'scan-folder'
/** image extensions the scanner may produce */
const EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif']
/** safety cap for the first (existing-files) sweep */
const INITIAL_SWEEP_CAP = 30

type DirHandle = {
  kind: 'directory'
  name: string
  entries: () => AsyncIterableIterator<[string, FileHandleLike | DirHandle]>
  queryPermission: (opts: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>
  requestPermission: (opts: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>
}
type FileHandleLike = {
  kind: 'file'
  name: string
  getFile: () => Promise<File>
}

export class FolderSync {
  /** live state for the UI */
  state: FolderSyncState = {
    status: 'idle',
    folderName: null,
    imported: 0,
    skipped: 0,
    lastFileName: null,
    lastError: null,
  }

  /** new design ready — the UI posts it to the tank store */
  onDesign: ((design: { name: string; dataUrl: string }) => Promise<boolean>) | null = null
  /** state changed — the UI redraws */
  onChange: (() => void) | null = null

  private dir: DirHandle | null = null
  private timer = 0
  private firstTimer = 0
  private busy = false
  /** "name:lastModified:size" of everything already through the pipeline */
  private seen = new Set<string>()
  private seenAt = new Map<string, number>()
  /** set while the first sweep (existing files) is still draining */
  private initialSweep = false

  constructor() {
    // restore a previously picked folder (status becomes needs-permission
    // until the operator clicks RESUME — Chromium's one-gesture rule)
    void this.restoreSaved()
  }

  // ------------------------------------------------------------ public API
  static get supported(): boolean {
    return typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function'
  }

  /** pick a folder (user gesture) and start watching — existing images sweep in */
  async pickAndWatch(): Promise<boolean> {
    if (!FolderSync.supported) {
      this.set({ status: 'unsupported', lastError: 'This browser cannot watch folders — use Chrome or Edge' })
      return false
    }
    try {
      const picker = (window as unknown as {
        showDirectoryPicker: (o?: { mode?: string }) => Promise<DirHandle>
      }).showDirectoryPicker
      const dir = await picker({ mode: 'read' })
      this.dir = dir
      await this.saveHandle(dir)
      this.resetSeen()
      this.set({ status: 'watching', folderName: dir.name, lastError: null })
      this.initialSweep = true
      this.schedule(0)
      return true
    } catch (e) {
      // AbortError = the operator cancelled the picker — keep previous state
      if ((e as DOMException)?.name === 'AbortError') return false
      this.set({ status: 'error', lastError: String((e as Error)?.message ?? e) })
      return false
    }
  }

  /** re-grant permission after a reload (user gesture) and keep watching */
  async resume(): Promise<boolean> {
    if (!this.dir) return false
    try {
      const p = await this.dir.queryPermission({ mode: 'read' })
      if (p !== 'granted') {
        const granted = await this.dir.requestPermission({ mode: 'read' })
        if (granted !== 'granted') {
          this.set({ status: 'needs-permission', lastError: null })
          return false
        }
      }
      this.resetSeen()
      this.set({ status: 'watching', lastError: null })
      this.initialSweep = true
      this.schedule(0)
      return true
    } catch (e) {
      this.set({ status: 'error', lastError: String((e as Error)?.message ?? e) })
      return false
    }
  }

  stop() {
    window.clearInterval(this.timer)
    window.clearTimeout(this.firstTimer)
    this.timer = 0
    this.firstTimer = 0
    this.initialSweep = false
    if (this.state.status !== 'idle' && this.state.status !== 'needs-permission') {
      this.set({ status: 'idle' })
    }
  }

  /** drop the saved folder entirely */
  async forget(): Promise<void> {
    this.stop()
    this.dir = null
    this.resetSeen()
    try { indexedDB.deleteDatabase(DB_NAME) } catch { /* noop */ }
    this.set({ status: 'idle', folderName: null, lastError: null })
  }

  dispose() {
    this.stop()
    this.onDesign = null
    this.onChange = null
  }

  // ------------------------------------------------------------ persistence
  private async openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error ?? new Error('idb open failed'))
    })
  }

  private async saveHandle(dir: DirHandle) {
    try {
      const db = await this.openDb()
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite')
        tx.objectStore(STORE).put(dir, KEY)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
      db.close()
    } catch { /* private mode — watch still works until the tab closes */ }
  }

  private async restoreSaved() {
    if (!FolderSync.supported) {
      this.set({ status: 'unsupported' })
      return
    }
    try {
      const db = await this.openDb()
      const dir = await new Promise<DirHandle | null>((resolve) => {
        const tx = db.transaction(STORE, 'readonly')
        const req = tx.objectStore(STORE).get(KEY)
        req.onsuccess = () => resolve((req.result as DirHandle) ?? null)
        req.onerror = () => resolve(null)
      })
      db.close()
      if (!dir) return
      this.dir = dir
      const p = await dir.queryPermission({ mode: 'read' })
      if (p === 'granted') {
        this.set({ status: 'watching', folderName: dir.name })
        this.initialSweep = true
        this.schedule(800)
      } else {
        this.set({ status: 'needs-permission', folderName: dir.name })
      }
    } catch { /* no saved handle — stay idle */ }
  }

  // ------------------------------------------------------------ polling
  /** first tick after firstDelay, then a steady POLL_MS cadence */
  private schedule(firstDelay = POLL_MS) {
    window.clearInterval(this.timer)
    window.clearTimeout(this.firstTimer)
    this.firstTimer = window.setTimeout(() => {
      void this.tick()
      this.timer = window.setInterval(() => void this.tick(), POLL_MS)
    }, firstDelay)
  }

  private async tick() {
    if (this.busy || !this.dir) return
    if (this.state.status !== 'watching') return
    this.busy = true
    try {
      // permission can lapse (long idle) — surface it instead of erroring
      const perm = await this.dir.queryPermission({ mode: 'read' })
      if (perm !== 'granted') {
        this.set({ status: 'needs-permission' })
        return
      }
      const files: { handle: FileHandleLike; file: File }[] = []
      for await (const [name, handle] of this.dir.entries()) {
        if (handle.kind !== 'file') continue
        if (name.startsWith('.')) continue
        const lower = name.toLowerCase()
        if (!EXTS.some((ext) => lower.endsWith(ext))) continue
        const file = await (handle as FileHandleLike).getFile()
        const sig = `${name}:${file.lastModified}:${file.size}`
        if (this.seen.has(sig)) {
          // forget stale sigs of the same file (scanner rewrites it)
          continue
        }
        files.push({ handle: handle as FileHandleLike, file })
      }

      // new files arrive oldest-first (scanner order) — lastModified sort
      files.sort((a, b) => a.file.lastModified - b.file.lastModified)

      let budget = this.initialSweep ? INITIAL_SWEEP_CAP : files.length
      for (const { file } of files) {
        const sig = `${file.name}:${file.lastModified}:${file.size}`
        this.remember(sig)
        if (budget <= 0) { this.bump('skipped'); continue }
        budget--
        await this.importFile(file)
      }
      if (this.initialSweep && files.length <= INITIAL_SWEEP_CAP) this.initialSweep = false
    } catch (e) {
      this.set({ status: 'error', lastError: String((e as Error)?.message ?? e) })
    } finally {
      this.busy = false
    }
  }

  /** run one image through the fish pipeline and post the design */
  private async importFile(file: File) {
    try {
      const design = await processFishImage(file)
      const ok = await this.onDesign?.({ name: design.name, dataUrl: design.dataUrl })
      if (ok) {
        this.bump('imported')
        this.set({ lastFileName: file.name, lastError: null })
      } else {
        this.bump('skipped')
        this.set({ lastFileName: file.name, lastError: 'tank refused the scan' })
      }
    } catch (e) {
      // unreadable/no fish found — mark seen so we never retry it
      this.bump('skipped')
      this.set({ lastFileName: file.name, lastError: String((e as Error)?.message ?? 'scan failed') })
    }
  }

  // ------------------------------------------------------------ helpers
  private resetSeen() {
    this.seen.clear()
    this.seenAt.clear()
    this.state.imported = 0
    this.state.skipped = 0
  }

  private remember(sig: string) {
    this.seen.add(sig)
    this.seenAt.set(sig, Date.now())
    // keep the memory bounded (scanner shows can run for days)
    if (this.seenAt.size > 800) {
      const cutoff = Date.now() - 30 * 60 * 1000
      for (const [s, at] of this.seenAt) {
        if (at < cutoff) { this.seenAt.delete(s); this.seen.delete(s) }
      }
    }
  }

  private bump(field: 'imported' | 'skipped') {
    this.state[field]++
    this.onChange?.()
  }

  private set(patch: Partial<FolderSyncState>) {
    Object.assign(this.state, patch)
    this.onChange?.()
  }
}
