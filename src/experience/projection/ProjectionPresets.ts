// ---------------------------------------------------------------
// ProjectionPresets — one-click room layouts. Every preset spawns
// N surfaces whose virtual cameras share one eye point in the
// ocean world, so adjacent walls meet seamlessly (cubemap-style
// 90° frustums where the room geometry calls for it).
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

export const PRESETS: PresetDef[] = [
  {
    id: 'flat-screen',
    label: 'Flat Screen',
    hint: 'One wall — the classic single-projector setup',
    build: (W, H) => [
      finish(createSurface({
        name: 'Main Screen',
        output: rect(0.12, 0.10, 0.76, 0.80, W, H),
        camera: { position: [0, 2.2, 2], yaw: 0, pitch: 0, fov: 58, near: 0.1, far: 300 },
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
        camera: { position: [0, 2.6, 9], yaw: 0, pitch: -2, fov: 38, near: 0.1, far: 300 },
        gridResolution: RES,
      })),
    ],
  },
  {
    id: 'panorama-180',
    label: '180° Panorama',
    hint: 'Three screens sweeping a half-circle',
    build: (W, H) => {
      const yawPanels: [string, number][] = [
        ['Left Panel', 58], ['Front Panel', 0], ['Right Panel', -58],
      ]
      return yawPanels.map(([name, yaw], i) => finish(createSurface({
        name,
        output: rect(i * (1 / 3), 0.06, 1 / 3, 0.88, W, H),
        camera: { position: [...EYE] as [number, number, number], yaw, pitch: 0, fov: 62, near: 0.1, far: 300 },
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
        camera: { position: [...EYE] as [number, number, number], yaw: 90, pitch: 0, fov: 90, near: 0.1, far: 300 },
        gridResolution: RES,
      })),
      finish(createSurface({
        name: 'Front Wall',
        output: rect(0.28, 0.04, 0.44, 0.92, W, H),
        camera: { position: [...EYE] as [number, number, number], yaw: 0, pitch: 0, fov: 90, near: 0.1, far: 300 },
        gridResolution: RES,
      })),
      finish(createSurface({
        name: 'Right Wall',
        output: rect(0.72, 0.04, 0.28, 0.92, W, H),
        camera: { position: [...EYE] as [number, number, number], yaw: -90, pitch: 0, fov: 90, near: 0.1, far: 300 },
        gridResolution: RES,
      })),
    ],
  },
  {
    id: 'immersive-room',
    label: 'Immersive Room',
    hint: 'Walls + floor + ceiling wrap the whole space',
    build: (W, H) => [
      finish(createSurface({
        name: 'Ceiling',
        output: rect(0.30, 0, 0.40, 0.15, W, H),
        camera: { position: [...EYE] as [number, number, number], yaw: 0, pitch: 90, fov: 90, near: 0.1, far: 300 },
        gridResolution: 6,
      })),
      finish(createSurface({
        name: 'Left Wall',
        output: rect(0, 0.15, 0.30, 0.70, W, H),
        camera: { position: [...EYE] as [number, number, number], yaw: 90, pitch: 0, fov: 90, near: 0.1, far: 300 },
        gridResolution: 6,
      })),
      finish(createSurface({
        name: 'Front Wall',
        output: rect(0.30, 0.15, 0.40, 0.70, W, H),
        camera: { position: [...EYE] as [number, number, number], yaw: 0, pitch: 0, fov: 90, near: 0.1, far: 300 },
        gridResolution: 6,
      })),
      finish(createSurface({
        name: 'Right Wall',
        output: rect(0.70, 0.15, 0.30, 0.70, W, H),
        camera: { position: [...EYE] as [number, number, number], yaw: -90, pitch: 0, fov: 90, near: 0.1, far: 300 },
        gridResolution: 6,
      })),
      finish(createSurface({
        name: 'Floor',
        output: rect(0.30, 0.85, 0.40, 0.15, W, H),
        camera: { position: [...EYE] as [number, number, number], yaw: 0, pitch: -90, fov: 90, near: 0.1, far: 300 },
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
        camera: { position: [...EYE] as [number, number, number], yaw: f.yaw, pitch: f.pitch, fov: 90, near: 0.1, far: 300 },
        gridResolution: 4,
      })))
    },
  },
  {
    id: 'floor-front',
    label: 'Floor + Front',
    hint: 'Front wall with a floor wedge beneath it',
    build: (W, H) => [
      finish(createSurface({
        name: 'Front Wall',
        output: rect(0.16, 0, 0.68, 0.66, W, H),
        camera: { position: [...EYE] as [number, number, number], yaw: 0, pitch: 0, fov: 62, near: 0.1, far: 300 },
        gridResolution: RES,
      })),
      finish(createSurface({
        name: 'Floor',
        output: rect(0.16, 0.66, 0.68, 0.34, W, H),
        camera: { position: [...EYE] as [number, number, number], yaw: 0, pitch: -90, fov: 46, near: 0.1, far: 300 },
        gridResolution: RES,
      })),
    ],
  },
]

export function getPreset(id: string): PresetDef | undefined {
  return PRESETS.find((p) => p.id === id)
}
