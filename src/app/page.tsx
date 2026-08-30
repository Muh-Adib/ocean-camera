'use client'

import { useEffect, useRef } from 'react'

/**
 * Thin client shell — the entire underwater experience is a
 * framework-free Three.js + GSAP application (src/experience/*).
 * React only mounts the container and boots it once.
 */
export default function Home() {
  const ref = useRef<HTMLDivElement>(null)
  const bootedRef = useRef(false)

  useEffect(() => {
    if (!ref.current || bootedRef.current) return
    bootedRef.current = true
    let handle: { dispose: () => void } | null = null
    let cancelled = false

    import('@/experience/main').then((mod) => {
      if (cancelled || !ref.current) return
      handle = mod.bootExperience(ref.current)
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
      id="ocean-root"
      ref={ref}
      aria-label="Interactive 3D ocean experience"
      style={{ position: 'fixed', inset: 0, background: '#02111f', overflow: 'hidden' }}
    />
  )
}
