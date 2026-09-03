'use client'

import { useEffect, useRef } from 'react'

/**
 * Smartphone gesture controller — scanned from the QR code shown on
 * the studio or the /output page. Opens the phone camera, tracks
 * BOTH hands locally with MediaPipe and streams the landmarks to the
 * server so every ocean page follows them in real time.
 */
export default function RemoteControllerPage() {
  const ref = useRef<HTMLDivElement>(null)
  const bootedRef = useRef(false)

  useEffect(() => {
    if (!ref.current || bootedRef.current) return
    bootedRef.current = true
    let handle: { dispose: () => void } | null = null
    let cancelled = false

    import('@/experience/remote/RemotePhone').then((mod) => {
      if (cancelled || !ref.current) return
      handle = mod.bootRemotePhone(ref.current)
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
      id="ocean-remote"
      ref={ref}
      aria-label="Living Ocean smartphone gesture controller"
      style={{ position: 'fixed', inset: 0, background: '#02101d', overflow: 'hidden' }}
    />
  )
}
