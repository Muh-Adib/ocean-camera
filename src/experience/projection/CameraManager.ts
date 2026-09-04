// ---------------------------------------------------------------
// CameraManager — one virtual perspective camera per projection
// surface, all living in the SAME world coordinates. Cameras only
// see layer 0 (the ocean); editor helpers live on layer 1 so they
// never leak into a projection. CameraHelper frustums visualize
// where each slice is looking.
//
// CHAIN RIG: an optional ChainRig pose is applied at READ time —
// every camera orbits the pivot (the center camera) with the same
// yaw/pitch/dolly offsets AND translates by the same MOVE XYZ offset
// (strafe along the center camera's right, world-up lift, dolly along
// its view), i.e. the whole chain moves as ONE motion. The stored
// surface data is never touched, so rig moves stay out of autosaves,
// sessions and undo history.
// ---------------------------------------------------------------
import * as THREE from 'three'
import type { ProjectionSurface } from './ProjectionTypes'
import type { ChainRig } from './ChainRig'

const DEG = Math.PI / 180

export type SnapView = 'front' | 'back' | 'left' | 'right' | 'floor' | 'ceiling'

export class CameraManager {
  private cameras = new Map<string, THREE.PerspectiveCamera>()
  private helpers = new Map<string, THREE.CameraHelper>()
  /** when set, every sync renders the chained (rigged) pose */
  rig: ChainRig | null = null
  private readonly tmpPos = new THREE.Vector3()
  private readonly tmpAxis = new THREE.Vector3(0, 1, 0)
  private readonly tmpUp = new THREE.Vector3(0, 1, 0)

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

    // ---- effective pose = stored pose (+ chain-rig motion, render-time only)
    let effYaw = c.yaw
    let effPitch = c.pitch
    let ex = c.position[0]
    let ey = c.position[1]
    let ez = c.position[2]
    const rigPose = this.rig?.pose
    if (rigPose?.active) {
      effYaw = c.yaw + rigPose.yaw
      effPitch = Math.max(-89, Math.min(89, c.pitch + rigPose.pitch))
      // orbit the stored position around the pivot (center camera), then
      // MOVE XYZ: dolly along the rotated view + one SHARED translation
      // (strafe along the center camera's right + world-up lift) applied
      // identically to every camera — relative angles never change
      this.tmpPos.set(ex, ey, ez).sub(rigPose.pivot)
      this.tmpPos.applyAxisAngle(this.tmpAxis, rigPose.yaw * DEG).add(rigPose.pivot)
      this.tmpPos.addScaledVector(rigPose.forward, rigPose.dolly)
      this.tmpPos.addScaledVector(rigPose.right, rigPose.mx)
      this.tmpPos.addScaledVector(this.tmpUp, rigPose.my)
      ex = this.tmpPos.x; ey = this.tmpPos.y; ez = this.tmpPos.z
    }

    const posChanged = !cam.position.equals(new THREE.Vector3(ex, ey, ez))
    const rotChanged = cam.rotation.x !== effPitch * DEG || cam.rotation.y !== effYaw * DEG

    // frustum: span-lock derives BOTH fov and aspect from the world angles
    // this surface covers, so neighbouring walls' edges meet exactly.
    // (spans are RELATIVE — the rig rotates every camera equally, so the
    // linked edges stay met while the chain moves; nothing breaks.)
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

    if (posChanged) cam.position.set(ex, ey, ez)
    if (rotChanged) {
      cam.rotation.order = 'YXZ'
      cam.rotation.set(effPitch * DEG, effYaw * DEG, 0)
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
