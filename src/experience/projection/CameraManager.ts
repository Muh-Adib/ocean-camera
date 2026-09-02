// ---------------------------------------------------------------
// CameraManager — one virtual perspective camera per projection
// surface, all living in the SAME world coordinates. Cameras only
// see layer 0 (the ocean); editor helpers live on layer 1 so they
// never leak into a projection. CameraHelper frustums visualize
// where each slice is looking.
// ---------------------------------------------------------------
import * as THREE from 'three'
import type { ProjectionSurface } from './ProjectionTypes'

const DEG = Math.PI / 180

export type SnapView = 'front' | 'back' | 'left' | 'right' | 'floor' | 'ceiling'

export class CameraManager {
  private cameras = new Map<string, THREE.PerspectiveCamera>()
  private helpers = new Map<string, THREE.CameraHelper>()

  constructor(private scene: THREE.Scene) {}

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
    const projChanged = cam.fov !== c.fov || cam.near !== c.near || cam.far !== c.far ||
      Math.abs(cam.aspect - s.output.width / Math.max(1, s.output.height)) > 1e-4

    if (posChanged) cam.position.set(c.position[0], c.position[1], c.position[2])
    if (rotChanged) {
      cam.rotation.order = 'YXZ'
      cam.rotation.set(c.pitch * DEG, c.yaw * DEG, 0)
    }
    if (projChanged) {
      cam.fov = c.fov
      cam.near = c.near
      cam.far = c.far
      cam.aspect = Math.max(0.05, s.output.width / Math.max(1, s.output.height))
      cam.updateProjectionMatrix()
    }
    const helper = this.helpers.get(s.id)
    if (helper && (projChanged || posChanged || rotChanged)) helper.update()
    return cam
  }

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
