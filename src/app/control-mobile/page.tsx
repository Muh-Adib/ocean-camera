'use client'

import { useEffect, useRef } from 'react'

/**
 * Smartphone remote — the page behind the QR shown on /output.
 * A plain control surface (no 3D, no camera until asked): double
 * joystick MOVE/ORBIT + DOLLY throttle steer the projection view
 * over a WebSocket. Toggling CAMERA reveals the phone-camera panel
 * (preview + hand overlay) whose hand signals drive the ocean —
 * and hides every trace of it again when switched off.
 */
export default function ControlMobile() {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    let dispose: (() => void) | null = null
    let cancelled = false

    import('@/experience/remote/PhoneController').then((mod) => {
      if (cancelled || !el) return
      dispose = mod.mountPhoneController(el)
    })

    return () => {
      cancelled = true
      dispose?.()
      dispose = null
    }
  }, [])

  return <main ref={ref} aria-label="Ocean remote control" style={{ position: 'fixed', inset: 0, background: '#02111f', overflow: 'hidden' }} />
}
