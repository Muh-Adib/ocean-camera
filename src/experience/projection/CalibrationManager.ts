// ---------------------------------------------------------------
// CalibrationManager — procedural test patterns rendered to canvas
// textures, so operators can physically align projectors: grid,
// crosshair, color bars, checkerboard, white/black, corner labels.
// ---------------------------------------------------------------
import * as THREE from 'three'
import type { CalibrationPattern } from './ProjectionTypes'

const PATTERNS: CalibrationPattern[] = [
  'off', 'grid', 'crosshair', 'colorbars', 'checkerboard', 'white', 'black', 'corners',
]

export class CalibrationManager {
  private cache = new Map<CalibrationPattern, THREE.CanvasTexture>()
  private blank: THREE.DataTexture | null = null

  /** every pattern option (for UI selects) */
  static get patternList(): CalibrationPattern[] {
    return PATTERNS
  }

  getTexture(pattern: CalibrationPattern): THREE.Texture {
    if (pattern === 'off') return this.getBlank()
    let tex = this.cache.get(pattern)
    if (!tex) {
      tex = new THREE.CanvasTexture(drawPattern(pattern))
      tex.colorSpace = THREE.SRGBColorSpace
      tex.anisotropy = 4
      this.cache.set(pattern, tex)
    }
    return tex
  }

  /** neutral 1×1 white — sampled when calibration is off */
  getBlank(): THREE.Texture {
    if (!this.blank) {
      const data = new Uint8Array([255, 255, 255, 255])
      this.blank = new THREE.DataTexture(data, 1, 1)
      this.blank.colorSpace = THREE.SRGBColorSpace
      this.blank.needsUpdate = true
    }
    return this.blank
  }

  dispose() {
    this.cache.forEach((t) => t.dispose())
    this.cache.clear()
    this.blank?.dispose()
    this.blank = null
  }
}

// ---------------------------------------------------------------- patterns
function drawPattern(pattern: CalibrationPattern): HTMLCanvasElement {
  const W = 960, H = 540
  const c = document.createElement('canvas')
  c.width = W; c.height = H
  const g = c.getContext('2d')!

  const bg = (fill: string) => { g.fillStyle = fill; g.fillRect(0, 0, W, H) }

  switch (pattern) {
    case 'grid': {
      bg('#0d1418')
      const step = W / 12
      g.lineWidth = 1
      for (let x = 0; x <= W; x += step / 3) {
        g.strokeStyle = Math.round(x / (step / 3)) % 3 === 0 ? 'rgba(63,224,200,0.55)' : 'rgba(63,224,200,0.22)'
        g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, H); g.stroke()
      }
      for (let y = 0; y <= H; y += step / 3) {
        g.strokeStyle = Math.round(y / (step / 3)) % 3 === 0 ? 'rgba(63,224,200,0.55)' : 'rgba(63,224,200,0.22)'
        g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(W, y + 0.5); g.stroke()
      }
      g.strokeStyle = '#ffffff'
      g.lineWidth = 2
      g.strokeRect(1, 1, W - 2, H - 2)
      crosshair(g, W / 2, H / 2, 26, '#ffffff')
      break
    }
    case 'crosshair': {
      bg('#101820')
      g.strokeStyle = 'rgba(255,255,255,0.35)'
      g.lineWidth = 1
      for (let x = 0; x <= W; x += 60) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke() }
      for (let y = 0; y <= H; y += 60) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke() }
      crosshair(g, W / 2, H / 2, 60, '#3fe0c8', 2)
      g.strokeStyle = '#3fe0c8'
      g.lineWidth = 2
      g.beginPath(); g.arc(W / 2, H / 2, 44, 0, Math.PI * 2); g.stroke()
      crosshair(g, W / 6, H / 2, 18, 'rgba(255,255,255,0.8)')
      crosshair(g, (5 * W) / 6, H / 2, 18, 'rgba(255,255,255,0.8)')
      crosshair(g, W / 2, H / 6, 18, 'rgba(255,255,255,0.8)')
      crosshair(g, W / 2, (5 * H) / 6, 18, 'rgba(255,255,255,0.8)')
      break
    }
    case 'colorbars': {
      const bars = ['#c0c0c0', '#c0c000', '#00c0c0', '#00c000', '#c000c0', '#c00000', '#0000c0']
      const bw = W / bars.length
      bars.forEach((col, i) => { g.fillStyle = col; g.fillRect(i * bw, 0, bw + 1, H * 0.72) })
      // grayscale ramp
      const steps = 16
      for (let i = 0; i < steps; i++) {
        const v = Math.round((i / (steps - 1)) * 255)
        g.fillStyle = `rgb(${v},${v},${v})`
        g.fillRect((i * W) / steps, H * 0.72, W / steps + 1, H * 0.28)
      }
      break
    }
    case 'checkerboard': {
      const n = 8
      const cw = W / n
      const ch = H / n
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          g.fillStyle = (i + j) % 2 === 0 ? '#f2f2f2' : '#0a0a0a'
          g.fillRect(i * cw, j * ch, cw + 1, ch + 1)
        }
      }
      break
    }
    case 'white': bg('#ffffff'); break
    case 'black': bg('#000000'); break
    case 'corners': {
      bg('#05080a')
      g.strokeStyle = '#ffffff'
      g.lineWidth = 3
      const L = 70, M = 18
      const corner = (x: number, y: number, sx: number, sy: number, label: string) => {
        g.beginPath()
        g.moveTo(x + sx * L, y); g.lineTo(x, y); g.lineTo(x, y + sy * L)
        g.stroke()
        g.fillStyle = '#3fe0c8'
        g.font = '600 22px system-ui, sans-serif'
        g.textAlign = sx > 0 ? 'left' : 'right'
        g.textBaseline = sy > 0 ? 'top' : 'bottom'
        g.fillText(label, x + sx * M, y + sy * M)
      }
      corner(M, M, 1, 1, 'TL')
      corner(W - M, M, -1, 1, 'TR')
      corner(W - M, H - M, -1, -1, 'BR')
      corner(M, H - M, 1, -1, 'BL')
      crosshair(g, W / 2, H / 2, 40, '#3fe0c8', 2)
      g.fillStyle = 'rgba(255,255,255,0.75)'
      g.font = '500 16px system-ui, sans-serif'
      g.textAlign = 'center'; g.textBaseline = 'middle'
      g.fillText('CALIBRATION', W / 2, H / 2 + 62)
      break
    }
  }
  return c
}

function crosshair(g: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, lw = 1.5) {
  g.strokeStyle = color
  g.lineWidth = lw
  g.beginPath()
  g.moveTo(x - r, y); g.lineTo(x + r, y)
  g.moveTo(x, y - r); g.lineTo(x, y + r)
  g.stroke()
}
