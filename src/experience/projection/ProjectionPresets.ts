// ---------------------------------------------------------------
// ProjectionPresets — one-click room layouts. Every preset spawns
// N surfaces whose virtual cameras share one eye point in the
// ocean world. Room walls use ANGULAR SPAN LOCK: each surface's
// frustum is derived from the world angles it covers, so adjacent
// edges meet exactly and the frame is never cut between walls.
// ---------------------------------------------------------------
import { createSurface, type ProjectionSurface } from './ProjectionTypes'
import { gridFromCorners } from './ProjectionMath'

export interface PresetDef {
  id: string
  label: string
  hint: string
  build: (W: number, H: number) => ProjectionSurface[]
}

/** shared eye point — inside the water, reef content lies toward -Z */
const EYE: [number, number, number] = [0, 2.2, 0]
const RES = 8

function finish(s: ProjectionSurface): ProjectionSurface {
  s.warp.grid = gridFromCorners(s.warp.corners, s.warp.gridResolution)
  return s
}

function rect(x: number, y: number, w: number, h: number, W: number, H: number) {
  return { x: Math.round(x * W), y: Math.round(y * H), width: Math.round(w * W), height: Math.round(h * H) }
}

/** camera helper — eye + orientation + optional edge-matched angular span */
function cam(
  yaw: number,
  pitch: number,
  fov: number,
  span?: { h: number; v: number },
): ProjectionSurface['camera'] {
  return {
    position: [...EYE] as [number, number, number],
    yaw, pitch, fov,
    near: 0.1, far: 300,
    span: span ? { h: span.h, v: span.v, lock: true } : { h: fov, v: fov, lock: false },
  }
}

export const PRESETS: PresetDef[] = [
  {
    id: 'flat-screen',
    label: 'Flat Screen',
    hint: 'One wall — the classic single-projector setup',
    build: (W, H) => [
      finish(createSurface({
        name: 'Main Screen',
        output: rect(0.12, 0.10, 0.76, 0.80, W, H),
        camera: cam(0, 0, 58, { h: 62, v: 40 }),
        gridResolution: RES,
      })),
    ],
  },
  {
    id: 'cinema-screen',
    label: 'Cinema Screen',
    hint: 'Wide 2.39:1 style slice with a longer lens',
    build: (W, H) => [
      finish(createSurface({
        name: 'Cinema Wall',
        output: rect(0.03, 0.30, 0.94, 0.40, W, H),
        camera: { ...cam(0, -2, 38, { h: 55, v: 24 }), position: [0, 2.6, 9] },
        gridResolution: RES,
      })),
    ],
  },
  {
    id: 'panorama-180',
    label: '180° Panorama',
    hint: 'Three screens sweeping a half-circle (2° overlap for blending)',
    build: (W, H) => {
      const yawPanels: [string, number][] = [
        ['Left Panel', 60], ['Front Panel', 0], ['Right Panel', -60],
      ]
      return yawPanels.map(([name, yaw], i) => finish(createSurface({
        name,
        output: rect(i * (1 / 3), 0.06, 1 / 3, 0.88, W, H),
        // 62° spans on 60° centres → the seams overlap 2° instead of gapping
        camera: cam(yaw, 0, 62, { h: 62, v: 38 }),
        gridResolution: RES,
      })))
    },
  },
  {
    id: 'immersive-270',
    label: '270° Immersive',
    hint: 'Front + left + right walls meeting at right angles',
    build: (W, H) => [
      finish(createSurface({
        name: 'Left Wall',
        output: rect(0, 0.04, 0.28, 0.92, W, H),
        camera: cam(90, 0, 90, { h: 90, v: 90 }),   // covers yaw 45..135
        gridResolution: RES,
      })),
      finish(createSurface({
        name: 'Front Wall',
        output: rect(0.28, 0.04, 0.44, 0.92, W, H),
        camera: cam(0, 0, 90, { h: 90, v: 90 }),    // covers yaw -45..45
        gridResolution: RES,
      })),
      finish(createSurface({
        name: 'Right Wall',
        output: rect(0.72, 0.04, 0.28, 0.92, W, H),
        camera: cam(-90, 0, 90, { h: 90, v: 90 }),  // covers yaw -135..-45
        gridResolution: RES,
      })),
    ],
  },
  {
    id: 'pano-360',
    label: '360° Linked Ring',
    hint: 'Four span-locked walls closing a full ring — the chain rig can sweep it endlessly with no seam',
    build: (W, H) => {
      // 92° spans on 90° centres → every joint overlaps 2° instead of gapping,
      // exactly like the 180°/270° presets: adjacent frustum edges meet.
      const yawPanels: [string, number][] = [
        ['Front Wall', 0], ['Right Wall', -90], ['Back Wall', 180], ['Left Wall', 90],
      ]
      return yawPanels.map(([name, yaw], i) => finish(createSurface({
        name,
        output: rect(i / 4, 0.06, 1 / 4, 0.88, W, H),
        camera: cam(yaw, 0, 92, { h: 92, v: 90 }),
        gridResolution: RES,
      })))
    },
  },
  {
    id: 'immersive-room',
    label: 'Immersive Room',
    hint: 'Walls + floor + ceiling wrap the whole space',
    build: (W, H) => [
      finish(createSurface({
        name: 'Ceiling',
        output: rect(0.30, 0, 0.40, 0.15, W, H),
        camera: cam(0, 90, 90, { h: 90, v: 90 }),
        gridResolution: 6,
      })),
      finish(createSurface({
        name: 'Left Wall',
        output: rect(0, 0.15, 0.30, 0.70, W, H),
        camera: cam(90, 0, 90, { h: 90, v: 90 }),
        gridResolution: 6,
      })),
      finish(createSurface({
        name: 'Front Wall',
        output: rect(0.30, 0.15, 0.40, 0.70, W, H),
        camera: cam(0, 0, 90, { h: 90, v: 90 }),
        gridResolution: 6,
      })),
      finish(createSurface({
        name: 'Right Wall',
        output: rect(0.70, 0.15, 0.30, 0.70, W, H),
        camera: cam(-90, 0, 90, { h: 90, v: 90 }),
        gridResolution: 6,
      })),
      finish(createSurface({
        name: 'Floor',
        output: rect(0.30, 0.85, 0.40, 0.15, W, H),
        camera: cam(0, -90, 90, { h: 90, v: 90 }),
        gridResolution: 6,
      })),
    ],
  },
  {
    id: 'cube-room',
    label: 'Cube Room',
    hint: 'Six cubemap faces — a full immersive box',
    build: (W, H) => {
      const faces: { name: string; yaw: number; pitch: number; col: number; row: number }[] = [
        { name: 'Ceiling', yaw: 0, pitch: 90, col: 1, row: 0 },
        { name: 'Back Wall', yaw: 180, pitch: 0, col: 2, row: 0 },
        { name: 'Left Wall', yaw: 90, pitch: 0, col: 0, row: 1 },
        { name: 'Front Wall', yaw: 0, pitch: 0, col: 1, row: 1 },
        { name: 'Right Wall', yaw: -90, pitch: 0, col: 2, row: 1 },
        { name: 'Floor', yaw: 0, pitch: -90, col: 0, row: 0 },
      ]
      return faces.map((f) => finish(createSurface({
        name: f.name,
        output: rect(f.col / 3, f.row / 2, 1 / 3, 0.5, W, H),
        camera: cam(f.yaw, f.pitch, 90, { h: 90, v: 90 }),
        gridResolution: 4,
      })))
    },
  },
  {
    id: 'floor-front',
    label: 'Floor + Front',
    hint: 'Front wall with a floor wedge whose top edge meets the wall',
    build: (W, H) => [
      finish(createSurface({
        name: 'Front Wall',
        output: rect(0.16, 0, 0.68, 0.66, W, H),
        // wall covers pitch +17.5 .. -17.5
        camera: cam(0, 0, 35, { h: 62, v: 35 }),
        gridResolution: RES,
      })),
      finish(createSurface({
        name: 'Floor',
        output: rect(0.16, 0.66, 0.68, 0.34, W, H),
        // floor continues from the wall's bottom edge (-17.5°) down to -76.5°
        camera: cam(0, -47, 35, { h: 62, v: 59 }),
        gridResolution: RES,
      })),
    ],
  },
]

export function getPreset(id: string): PresetDef | undefined {
  return PRESETS.find((p) => p.id === id)
}
