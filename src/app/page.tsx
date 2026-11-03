'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Boot splash — server-rendered, zero-JS required to be visible.
 * Covers the gap between first paint and the experience chunk being
 * downloaded + the 3D world built (several seconds on cold boots).
 * It lifts the moment the experience signals `ocean-booted` (its own
 * loading theatre has taken over below this overlay) — with a 30s
 * failsafe so a failed boot can never trap the visitor on the splash.
 *
 * Bubble positions are hard-coded (NOT random) to keep SSR hydration
 * markup identical to the client render.
 */

const SPLASH_BUBBLES = [
  { left: 11, size: 10, delay: 0, dur: 3.4 },
  { left: 24, size: 6, delay: 0.8, dur: 2.9 },
  { left: 38, size: 13, delay: 1.7, dur: 4.2 },
  { left: 52, size: 8, delay: 0.4, dur: 3.1 },
  { left: 66, size: 12, delay: 2.3, dur: 3.9 },
  { left: 79, size: 7, delay: 1.2, dur: 2.7 },
  { left: 89, size: 9, delay: 2.9, dur: 3.6 },
]

export default function Home() {
  const ref = useRef<HTMLDivElement>(null)
  const bootedRef = useRef(false)
  const [splashGone, setSplashGone] = useState(false)

  useEffect(() => {
    const lift = () => setSplashGone(true)
    window.addEventListener('ocean-booted', lift, { once: true })
    const failsafe = window.setTimeout(lift, 30000)
    return () => {
      window.removeEventListener('ocean-booted', lift)
      window.clearTimeout(failsafe)
    }
  }, [])

  useEffect(() => {
    if (!ref.current || bootedRef.current) return
    bootedRef.current = true
    let handle: { dispose: () => void } | null = null
    let cancelled = false

    import('@/experience/main')
      .then((mod) => {
        if (cancelled || !ref.current) return
        handle = mod.bootExperience(ref.current)
        // the experience loading overlay is now on screen — lift the splash
        window.dispatchEvent(new Event('ocean-booted'))
      })
      .catch((err) => {
        console.error('[ocean] chunk/boot failure:', err)
        window.dispatchEvent(new Event('ocean-booted'))
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
    >
      <div id="ocean-splash" data-gone={splashGone || undefined} aria-hidden={splashGone || undefined}>
        <div className="splash-bubbles" aria-hidden="true">
          {SPLASH_BUBBLES.map((b, i) => (
            <span
              key={i}
              style={{
                left: `${b.left}%`,
                width: `${b.size}px`,
                height: `${b.size}px`,
                animationDelay: `${b.delay}s`,
                animationDuration: `${b.dur}s`,
              }}
            />
          ))}
        </div>
        <p className="splash-kicker">A LIVING UNDERWATER WORLD</p>
        <h1 className="splash-title">THE LIVING OCEAN</h1>
        <p className="splash-status" role="status">Diving into the reef…</p>
        <div className="splash-bar" aria-hidden="true"><span /></div>
        <div className="splash-credit">
          <span className="segia-mark" aria-label="Developed by Segia">
            <svg viewBox="0 0 38 10" width="34" height="9" fill="none" aria-hidden="true">
              <path
                d="M1 6.5 Q 5.5 1.5, 10 6.5 T 19 6.5 T 28 6.5 T 37 6.5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
            <i>SEGIA</i>
          </span>
          <span className="splash-credit-note">DEVELOPED BY SEGIA</span>
        </div>
      </div>
    </main>
  )
}
