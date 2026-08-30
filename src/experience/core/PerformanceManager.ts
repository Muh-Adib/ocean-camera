// ---------------------------------------------------------------
// PerformanceManager — device tiering, adaptive quality, FPS watch
// ---------------------------------------------------------------
import { clamp } from '../utils/math'

export type Tier = 'high' | 'medium' | 'low'

export interface QualityConfig {
  tier: Tier
  dpr: number
  fishScale: number
  microCount: number
  planktonCount: number
  bubbleCount: number
  burstPool: number
  lightRayCount: number
  seaweedBlades: number
  coralDensity: number
  pebbleCount: number
}

export const QUALITY: Record<Tier, QualityConfig> = {
  high: {
    tier: 'high', dpr: 2, fishScale: 1,
    microCount: 700, planktonCount: 220, bubbleCount: 90, burstPool: 340,
    lightRayCount: 12, seaweedBlades: 260, coralDensity: 1, pebbleCount: 150,
  },
  medium: {
    tier: 'medium', dpr: 1.5, fishScale: 0.7,
    microCount: 420, planktonCount: 140, bubbleCount: 60, burstPool: 240,
    lightRayCount: 8, seaweedBlades: 180, coralDensity: 0.72, pebbleCount: 100,
  },
  low: {
    tier: 'low', dpr: 1, fishScale: 0.45,
    microCount: 260, planktonCount: 90, bubbleCount: 40, burstPool: 150,
    lightRayCount: 5, seaweedBlades: 120, coralDensity: 0.5, pebbleCount: 60,
  },
}

export class PerformanceManager {
  config: QualityConfig
  /** true when user prefers reduced motion (a11y) */
  reducedMotion: boolean
  isMobile: boolean
  private listeners = new Set<(c: QualityConfig) => void>()
  private frameTimes: number[] = []
  private degradedSteps = 0
  private lastDegrade = 0

  constructor() {
    const ua = navigator.userAgent.toLowerCase()
    const mobile = /android|iphone|ipad|ipod|mobile|silk/.test(ua)
    const tablet = /ipad|tablet/.test(ua) || (mobile && Math.min(screen.width, screen.height) > 700)
    this.isMobile = mobile
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const cores = navigator.hardwareConcurrency ?? 4
    const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4

    let tier: Tier = 'high'
    if (mobile && !tablet) tier = 'low'
    else if (tablet || cores <= 4 || mem <= 3) tier = 'medium'

    const cfg = { ...QUALITY[tier] }
    cfg.dpr = clamp(window.devicePixelRatio || 1, 1, cfg.dpr)
    this.config = cfg
  }

  onChange(fn: (c: QualityConfig) => void) { this.listeners.add(fn) }

  private broadcast() { this.listeners.forEach((fn) => fn(this.config)) }

  /** call once per rendered frame */
  report(dt: number) {
    if (dt <= 0 || dt > 0.5) return
    this.frameTimes.push(dt)
    if (this.frameTimes.length > 90) this.frameTimes.shift()
    const now = performance.now()
    if (this.frameTimes.length >= 60 && now - this.lastDegrade > 8000 && this.degradedSteps < 2) {
      const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length
      const fps = 1 / avg
      if (fps < 42) this.degrade()
    }
  }

  /** drop one quality step */
  private degrade() {
    this.lastDegrade = performance.now()
    this.frameTimes.length = 0
    this.degradedSteps++
    const c = this.config
    if (c.dpr > 1.35) c.dpr = 1.25
    else if (c.dpr > 1.05) c.dpr = 1
    else {
      // reduce populations ~35%
      c.microCount = Math.floor(c.microCount * 0.65)
      c.planktonCount = Math.floor(c.planktonCount * 0.65)
      c.bubbleCount = Math.floor(c.bubbleCount * 0.65)
      c.seaweedBlades = Math.floor(c.seaweedBlades * 0.8)
      c.lightRayCount = Math.max(3, Math.floor(c.lightRayCount * 0.6))
    }
    this.broadcast()
  }

  currentFps(): number {
    if (!this.frameTimes.length) return 60
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length
    return 1 / avg
  }
}
