// ---------------------------------------------------------------
// CameraManager — one virtual perspective camera per projection
// surface, all living in the SAME world coordinates. Cameras only
// see layer 0 (the ocean); editor helpers live on layer 1 so they
// never leak into a projection. CameraHelper frustums visualize
// where each slice is looking.
// ---------------------------------------------------------------
import * as THREE from 'three'
import type { ProjectionSurface } from './ProjectionTypes'
import type { RemoteRig } from '../remote/RemoteRig'

const DEG = Math.PI / 180

export type SnapView = 'front' | 'back' | 'left' | 'right' | 'floor' | 'ceiling'

export class CameraManager {
  private cameras = new Map<string, THREE.PerspectiveCamera>()
  private helpers = new Map<string, THREE.CameraHelper>()

  /** phone-remote rigid constellation transform (null → cameras pose plainly) */
  rig: RemoteRig | null = null
  /** per-frame constellation cache — computed from BASE surface data, never
   *  from the (already rig-offset) THREE cameras, or offsets would compound */
  private frameId = 0
  private frameSurfaces: ProjectionSurface[] = []
  private cPivot = new THREE.Vector3()
  private cFwd = new THREE.Vector3()
  private cRight = new THREE.Vector3()
  private cReady = false

  constructor(private scene: THREE.Scene) {}

  /** start a new render frame — constellation recomputes lazily on first sync */
  beginFrame(surfaces: ProjectionSurface[]) {
    this.frameId++
    this.frameSurfaces = surfaces
    this.cReady = false
  }

  /** pivot = centroid of every enabled camera's base position; fwd/right =
   *  their mean view axes. One rigid frame of reference for the whole show. */
  private ensureConstellation() {
    if (this.cReady) return
    this.cReady = true
    let px = 0, py = 0, pz = 0
    let fx = 0, fy = 0, fz = 0
    let n = 0
    for (const s of this.frameSurfaces) {
      if (!s.enabled) continue
      const c = s.camera
      px += c.position[0]; py += c.position[1]; pz += c.position[2]
      const yaw = c.yaw * DEG, pitch = c.pitch * DEG
      // camera forward for YXZ euler (0,0,0 looks down −Z)
      fx += -Math.sin(yaw) * Math.cos(pitch)
      fy += Math.sin(pitch)
      fz += -Math.cos(yaw) * Math.cos(pitch)
      n++
    }
    if (n === 0) { this.cPivot.set(0, 2, 0); this.cFwd.set(0, 0, -1); this.cRight.set(1, 0, 0); return }
    this.cPivot.set(px / n, py / n, pz / n)
    this.cFwd.set(fx / n, fy / n, fz / n).normalize()
    // right = fwd × up (normalized; degenerate straight-down views fall back)
    this.cRight.set(this.cFwd.z, 0, -this.cFwd.x)
    if (this.cRight.lengthSq() < 1e-6) this.cRight.set(1, 0, 0)
    this.cRight.normalize()
  }

  /** create-or-update the camera for a surface; returns it */
  sync(s: ProjectionSurface): THREE.PerspectiveCamera {
    let cam = this.cameras.get(s.id)
    if (!cam) {
      cam = new THREE.PerspectiveCamera(60, 1, 0.1, 300)
      cam.layers.set(0)                 // ocean only — never helpers
      this.cameras.set(s.id, cam)
      const helper = new THREE.CameraHelper(cam)
      helper.layers.set(1)              // editor viewport only
      helper.traverse((o) => { o.layers.set(1) })
      const mat = helper.material as THREE.LineBasicMaterial
      mat.transparent = true
      mat.depthTest = false
      mat.opacity = 0.3
      this.scene.add(helper)
      this.helpers.set(s.id, helper)
    }
    const c = s.camera
    const posChanged = !cam.position.equals(new THREE.Vector3(...c.position))
    const rotChanged = cam.rotation.x !== c.pitch * DEG || cam.rotation.y !== c.yaw * DEG

    // frustum: span-lock derives BOTH fov and aspect from the world angles
    // this surface covers, so neighbouring walls' edges meet exactly.
    // unlocked keeps the classic behaviour: vertical fov + output-rect aspect.
    const locked = c.span?.lock === true
    const spanH = Math.max(4, c.span?.h ?? c.fov)
    const spanV = Math.max(4, c.span?.v ?? c.fov)
    const wantFov = locked ? spanV : c.fov
    const wantAspect = locked
      ? Math.tan((spanH * DEG) / 2) / Math.tan((spanV * DEG) / 2)
      : s.output.width / Math.max(1, s.output.height)
    const projChanged = cam.fov !== wantFov || cam.near !== c.near || cam.far !== c.far ||
      Math.abs(cam.aspect - wantAspect) > 1e-4

    if (posChanged) cam.position.set(c.position[0], c.position[1], c.position[2])
    if (rotChanged) {
      cam.rotation.order = 'YXZ'
      cam.rotation.set(c.pitch * DEG, c.yaw * DEG, 0)
    }
    if (projChanged) {
      cam.fov = wantFov
      cam.near = c.near
      cam.far = c.far
      cam.aspect = Math.max(0.05, wantAspect)
      cam.updateProjectionMatrix()
    }
    const helper = this.helpers.get(s.id)
    if (helper && (projChanged || posChanged || rotChanged)) helper.update()

    // phone-remote rigid constellation — applied AFTER the base pose so it
    // composes onto fresh surface data every frame (no compounding)
    if (this.rig) {
      this.ensureConstellation()
      this.basePos.set(c.position[0], c.position[1], c.position[2])
      this.baseQuat.setFromEuler(this.baseEuler.set(c.pitch * DEG, c.yaw * DEG, 0, 'YXZ'))
      this.rig.applyTo(cam, this.basePos, this.baseQuat, this.cPivot, this.cFwd, this.cRight)
    }
    return cam
  }

  private basePos = new THREE.Vector3()
  private baseQuat = new THREE.Quaternion()
  private baseEuler = new THREE.Euler()

  get(id: string): THREE.PerspectiveCamera | undefined {
    return this.cameras.get(id)
  }

  remove(id: string) {
    const cam = this.cameras.get(id)
    if (cam) {
      this.cameras.delete(id)
      void cam
    }
    const helper = this.helpers.get(id)
    if (helper) {
      this.scene.remove(helper)
      helper.dispose()
      this.helpers.delete(id)
    }
  }

  /** frustum visibility: selected = strong, others = faint, all optional */
  updateVisibility(selectedId: string | null, showAll: boolean) {
    this.helpers.forEach((helper, id) => {
      const selected = id === selectedId
      helper.visible = selected || showAll
      const mat = helper.material as THREE.LineBasicMaterial
      mat.opacity = selected ? 0.95 : 0.22
    })
  }

  setHelpersVisibleAll(visible: boolean) {
    this.helpers.forEach((h) => { h.visible = visible })
  }

  /** aim a surface camera at a world point (derives yaw/pitch) */
  static aimAt(c: ProjectionSurface['camera'], target: [number, number, number]) {
    const dx = target[0] - c.position[0]
    const dy = target[1] - c.position[1]
    const dz = target[2] - c.position[2]
    const len = Math.hypot(dx, dy, dz) || 1
    c.yaw = Math.round((Math.atan2(-dx, -dz) / DEG) * 10) / 10
    c.pitch = Math.round((Math.asin(Math.max(-1, Math.min(1, dy / len))) / DEG) * 10) / 10
  }

  /** snap yaw/pitch to a canonical room view, keeping position */
  static snapView(c: ProjectionSurface['camera'], view: SnapView) {
    switch (view) {
      case 'front': c.yaw = 0; c.pitch = 0; break
      case 'back': c.yaw = 180; c.pitch = 0; break
      case 'left': c.yaw = 90; c.pitch = 0; break
      case 'right': c.yaw = -90; c.pitch = 0; break
      case 'floor': c.pitch = -90; break
      case 'ceiling': c.pitch = 90; break
    }
  }

  dispose() {
    ;[...this.cameras.keys()].forEach((id) => this.remove(id))
  }
}
