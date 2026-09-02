'use client'

import { useEffect, useRef } from 'react'

/**
 * Dedicated projection output page — a clean, UI-free surface for the
 * projector. Boots the ocean in output-only mode: the composite renders
 * fullscreen from the saved projection config (localStorage / live sync
 * from an open studio tab). A small settings overlay appears on mouse
 * move so the operator can show or hide calibration patterns in place.
 */
export default function ProjectionOutput() {
  const ref = useRef<HTMLDivElement>(null)
  const bootedRef = useRef(false)

  useEffect(() => {
    if (!ref.current || bootedRef.current) return
    bootedRef.current = true
    let handle: { dispose: () => void } | null = null
    let cancelled = false

    import('@/experience/main').then((mod) => {
      if (cancelled || !ref.current) return
      handle = mod.bootExperience(ref.current, { outputOnly: true })
    })

    return () => {
      cancelled = true
      handle?.dispose()
      handle = null
      bootedRef.current = false
    }
  }, [])

  return (
    <main
      id="ocean-output"
      ref={ref}
      aria-label="Projection mapping output — clean ocean feed"
      style={{ position: 'fixed', inset: 0, background: '#000000', overflow: 'hidden' }}
    />
  )
}
