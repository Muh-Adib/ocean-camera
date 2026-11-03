'use client'

// ---------------------------------------------------------------
// BuildVersionGuard — self-healing long-lived tabs.
//
// Wahana screens (projector /output) and controller tabs stay open
// for days. After an image upgrade the tab keeps running the OLD
// build: its JS posts Server Action IDs the new server has never
// heard of ("Failed to find Server Action ... older or newer
// deployment") and the tab quietly misbehaves until a human
// refreshes it.
//
// This guard polls /api/build-id (served by the custom server.js)
// and hard-reloads the tab exactly once when the running build
// changes. A sessionStorage stamp prevents reload loops if the
// server flaps between builds mid-upgrade.
// ---------------------------------------------------------------
import { useEffect } from 'react'

const POLL_MS = 60_000
const RELOAD_COOLDOWN_MS = 30_000

export default function BuildVersionGuard() {
  useEffect(() => {
    let baseline: string | null = null
    let dead = false

    const check = async () => {
      if (dead) return
      try {
        const res = await fetch('/api/build-id', { cache: 'no-store' })
        if (!res.ok) return
        const json = (await res.json()) as { buildId?: string | null }
        const id = typeof json?.buildId === 'string' ? json.buildId : null
        if (!id || id === 'dev') return
        if (baseline === null) {
          baseline = id
          return
        }
        if (id !== baseline && !dead) {
          const last = Number(sessionStorage.getItem('bvg-last-reload') || 0)
          if (Date.now() - last > RELOAD_COOLDOWN_MS) {
            dead = true
            sessionStorage.setItem('bvg-last-reload', String(Date.now()))
            location.reload()
          } else {
            // reloaded too recently — adopt the new id and wait for the next poll
            baseline = id
          }
        }
      } catch {
        // server briefly unreachable (restarting) — try again next tick
      }
    }

    void check()
    const timer = window.setInterval(check, POLL_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      dead = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  return null
}
