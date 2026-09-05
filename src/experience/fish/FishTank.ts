// ---------------------------------------------------------------
// FishTank — keeps the painted-fish designs in sync everywhere.
//
// The studio console imports coloured sheets; this client polls the
// tank version (cheap, every few seconds — instantly after an own
// import) and pulls the full designs when it changes. Every page of
// the show runs one: the main ocean, the studio tab AND every
// /output projector machine — new fish simply swim in on all of
// them without any reload.
// ---------------------------------------------------------------
import * as THREE from 'three'
import type { FishManager } from './FishManager'

const POLL_MS = 4000
const FAST_POLL_MS = 1200

export class FishTank {
  /** diagnostics */
  lastError: string | null = null
  synced = false

  private timer = 0
  private v = -1
  private busy = false
  private fastUntil = 0

  constructor(private fish: FishManager) {}

  start() {
    this.schedule(0)
  }

  stop() {
    window.clearTimeout(this.timer)
    this.timer = 0
  }

  /** something just changed on THIS page (import/remove) — sync fast for a while */
  poke() {
    this.fastUntil = performance.now() + 6000
    this.schedule(0)
  }

  private schedule(delay: number) {
    window.clearTimeout(this.timer)
    this.timer = window.setTimeout(() => {
      void this.poll().finally(() => {
        this.schedule(performance.now() < this.fastUntil ? FAST_POLL_MS : POLL_MS)
      })
    }, delay)
  }

  private async poll() {
    if (this.busy) return
    this.busy = true
    try {
      const res = await fetch('/api/fish', { cache: 'no-store' })
      if (!res.ok) throw new Error(`tank ${res.status}`)
      const data = await res.json() as { v?: number }
      const v = typeof data.v === 'number' ? data.v : -1
      if (v !== this.v) await this.pullFull(v)
      this.lastError = null
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : 'tank unreachable'
    } finally {
      this.busy = false
    }
  }

  private async pullFull(v: number) {
    const res = await fetch('/api/fish?full=1', { cache: 'no-store' })
    if (!res.ok) throw new Error(`tank full ${res.status}`)
    const data = await res.json() as { v?: number; designs?: { id: string; name: string; url: string }[] }
    const designs = (Array.isArray(data.designs) ? data.designs : [])
      .filter((d) => d && typeof d.id === 'string' && typeof d.url === 'string')
    const ids = new Set(designs.map((d) => d.id))

    // removals first
    for (const id of this.fish.customIds()) {
      if (!ids.has(id)) this.fish.removeCustomDesign(id)
    }
    // additions — textures decode async, add as they arrive
    await Promise.all(designs.map(async (d) => {
      if (this.fish.hasCustomDesign(d.id)) return
      try {
        const texture = await loadTexture(d.url)
        this.fish.addCustomDesign(d.id, texture)
      } catch { /* broken image — skip this design */ }
    }))
    this.v = typeof data.v === 'number' ? data.v : v
    this.synced = true
  }

  /** QA: what is swimming right now */
  info() {
    return {
      v: this.v,
      synced: this.synced,
      lastError: this.lastError,
      designs: this.fish.customInfo(),
    }
  }
}

async function loadTexture(url: string): Promise<THREE.Texture> {
  const img = new Image()
  img.decoding = 'async'
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('fish texture decode failed'))
    img.src = url
  })
  const tex = new THREE.Texture(img)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  tex.needsUpdate = true
  return tex
}
