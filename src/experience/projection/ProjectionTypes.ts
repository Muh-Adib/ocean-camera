// ---------------------------------------------------------------
// ProjectionTypes — data model for the projection mapping system.
// A project is a list of surfaces; each surface pairs an OUTPUT
// slice (where it sits on the projector canvas) with a VIRTUAL
// CAMERA (where it looks inside the one shared ocean world).
// ---------------------------------------------------------------

export interface Vec2 { x: number; y: number }

export type CalibrationPattern =
  | 'off' | 'grid' | 'crosshair' | 'colorbars'
  | 'checkerboard' | 'white' | 'black' | 'corners'

export type BlendMode = 'normal' | 'add' | 'screen'

export interface WarpCorners {
  /** top-left, top-right, bottom-right, bottom-left — output pixels, y grows downward */
  tl: Vec2
  tr: Vec2
  br: Vec2
  bl: Vec2
}

export interface ProjectionSurface {
  id: string
  name: string
  enabled: boolean
  locked: boolean

  /** OUTPUT SPACE — the slice rectangle on the projector canvas */
  output: { x: number; y: number; width: number; height: number }

  /** WORLD SPACE — the virtual camera rendering the shared scene */
  camera: {
    position: [number, number, number]
    yaw: number      // degrees, 0 = facing -Z
    pitch: number    // degrees, positive looks up
    fov: number      // vertical FOV (used when span.lock is false)
    near: number
    far: number
    /**
     * Angular span lock — for room walls. When locked, the frustum is
     * derived from the world angles this surface covers (yaw span h,
     * pitch span v) instead of the output rect aspect, so adjacent
     * walls' frustum edges meet EXACTLY and the frame is never cut.
     */
    span: { h: number; v: number; lock: boolean }
  }

  warp: {
    corners: WarpCorners
    gridResolution: number       // mesh warp segments per edge
    grid: Vec2[]                 // (res+1)² points, row-major from TL
    gridCustom: boolean          // true once an interior node was moved by hand
  }

  blend: {
    opacity: number        // 0..1
    brightness: number     // 0.2..2.5
    gamma: number          // 0.3..2.8
    feather: { left: number; right: number; top: number; bottom: number } // 0..0.45 (uv fraction)
    mode: BlendMode
  }

  calibration: CalibrationPattern
}

// ---------------------------------------------------------------
// Output quality — how sharp the projected picture is, sized to the
// machine driving the show. Each profile raises/lowers the per-
// surface render-target resolution (renderScale × output rect), the
// RT size ceiling, and MSAA anti-aliasing on those targets.
// ---------------------------------------------------------------
export type QualityLevel =
  | 'auto'          // adaptive — measures frame cost and tunes itself
  | 'performance'   // weak GPUs, many surfaces
  | 'balanced'      // default — good on most laptops
  | 'high'          // desktop GPUs, big walls
  | 'ultra'         // 1:1 pixels + MSAA — show machines
  | 'custom'        // user picked a manual render scale

export interface QualityProfile {
  label: string
  renderScale: number   // fraction of the output rect rendered per surface
  rtCap: number         // hard ceiling per RT edge (px)
  msaa: number          // MSAA samples on the surface render targets
  hint: string
}

export const QUALITY_PROFILES: Record<Exclude<QualityLevel, 'auto' | 'custom'>, QualityProfile> = {
  performance: {
    label: 'PERFORMANCE', renderScale: 0.4, rtCap: 1536, msaa: 0,
    hint: 'Weak GPUs / 4+ surfaces — smooth motion first, softness expected',
  },
  balanced: {
    label: 'BALANCED', renderScale: 0.6, rtCap: 2048, msaa: 0,
    hint: 'Good on most laptops — the previous default, one notch sharper',
  },
  high: {
    label: 'HIGH', renderScale: 0.8, rtCap: 3072, msaa: 2,
    hint: 'Desktop GPUs and big walls — sharp fish silhouettes, light AA',
  },
  ultra: {
    label: 'ULTRA', renderScale: 1.0, rtCap: 4096, msaa: 4,
    hint: 'Show machines — every output pixel rendered, full 4× anti-aliasing',
  },
}

export const QUALITY_LEVELS: QualityLevel[] = ['auto', 'performance', 'balanced', 'high', 'ultra', 'custom']

export interface ProjectionOutput {
  width: number
  height: number
  renderScale: number   // RT resolution scale: 0.1 .. 1 (set by the quality profile unless custom)
  quality: QualityLevel // which hardware profile is active
}

/** resolved settings actually used by the render pipeline this frame */
export interface ResolvedQuality {
  renderScale: number
  rtCap: number
  msaa: number
}

/**
 * Map a project's output settings onto concrete RT parameters.
 * - named profiles: scale/cap/msaa come from the profile
 * - auto: keeps the adaptive renderScale measured at runtime (cap follows the nearest profile)
 * - custom: user scale with the ultra ceiling so manual settings can still go sharp
 */
export function resolveQuality(out: Pick<ProjectionOutput, 'quality' | 'renderScale'>): ResolvedQuality {
  switch (out.quality) {
    case 'performance': return { renderScale: QUALITY_PROFILES.performance.renderScale, rtCap: QUALITY_PROFILES.performance.rtCap, msaa: 0 }
    case 'balanced': return { renderScale: QUALITY_PROFILES.balanced.renderScale, rtCap: QUALITY_PROFILES.balanced.rtCap, msaa: 0 }
    case 'high': return { renderScale: QUALITY_PROFILES.high.renderScale, rtCap: QUALITY_PROFILES.high.rtCap, msaa: QUALITY_PROFILES.high.msaa }
    case 'ultra': return { renderScale: QUALITY_PROFILES.ultra.renderScale, rtCap: QUALITY_PROFILES.ultra.rtCap, msaa: QUALITY_PROFILES.ultra.msaa }
    case 'custom': return { renderScale: out.renderScale, rtCap: QUALITY_PROFILES.ultra.rtCap, msaa: 0 }
    case 'auto':
    default: {
      const s = Math.min(1, Math.max(0.25, out.renderScale))
      const cap = s >= 0.9 ? QUALITY_PROFILES.ultra.rtCap : s >= 0.7 ? QUALITY_PROFILES.high.rtCap : s >= 0.5 ? QUALITY_PROFILES.balanced.rtCap : QUALITY_PROFILES.performance.rtCap
      return { renderScale: s, rtCap: cap, msaa: 0 }
    }
  }
}

/** nearest profile label for a raw scale — used by readouts in auto/custom modes */
export function describeScale(scale: number): string {
  return `${Math.round(scale * 100)}%`
}

export interface ProjectionProject {
  version: number
  output: ProjectionOutput
  surfaces: ProjectionSurface[]
}

export const PROJECT_VERSION = 2
export const AUTOSAVE_KEY = 'ocean-projection-v1'

let uid = 0
export function makeSurfaceId(): string {
  uid += 1
  return `surf-${uid.toString(36)}-${Date.now().toString(36).slice(-4)}`
}

export function cornersFromRect(rect: { x: number; y: number; width: number; height: number }): WarpCorners {
  const { x, y, width: w, height: h } = rect
  return {
    tl: { x, y },
    tr: { x: x + w, y },
    br: { x: x + w, y: y + h },
    bl: { x, y: y + h },
  }
}

export function cloneVec2(v: Vec2): Vec2 {
  return { x: v.x, y: v.y }
}

export function cloneCorners(c: WarpCorners): WarpCorners {
  return { tl: cloneVec2(c.tl), tr: cloneVec2(c.tr), br: cloneVec2(c.br), bl: cloneVec2(c.bl) }
}

export function deepCloneSurface(s: ProjectionSurface): ProjectionSurface {
  return JSON.parse(JSON.stringify(s)) as ProjectionSurface
}

export function createSurface(init: {
  name: string
  output: { x: number; y: number; width: number; height: number }
  camera: ProjectionSurface['camera']
  gridResolution?: number
  calibration?: CalibrationPattern
}): ProjectionSurface {
  const rect = init.output
  const res = init.gridResolution ?? 8
  return {
    id: makeSurfaceId(),
    name: init.name,
    enabled: true,
    locked: false,
    output: { ...rect },
    camera: {
      position: [...init.camera.position] as [number, number, number],
      yaw: init.camera.yaw,
      pitch: init.camera.pitch,
      fov: init.camera.fov,
      near: init.camera.near,
      far: init.camera.far,
      span: init.camera.span ?? { h: init.camera.fov, v: init.camera.fov, lock: false },
    },
    warp: {
      corners: cornersFromRect(rect),
      gridResolution: res,
      grid: [],          // filled by WarpMath.gridFromCorners once res known
      gridCustom: false,
    },
    blend: {
      opacity: 1,
      brightness: 1,
      gamma: 1,
      feather: { left: 0, right: 0, top: 0, bottom: 0 },
      mode: 'normal',
    },
    calibration: init.calibration ?? 'off',
  }
}

/** numeric sanitizer for JSON imports */
export function clampNum(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}
