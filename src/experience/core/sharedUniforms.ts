// ---------------------------------------------------------------
// Shared GLSL uniforms — one source of truth for time, gesture
// force field and global light energy. Systems reference the SAME
// uniform objects so a single write updates every shader.
// ---------------------------------------------------------------
import * as THREE from 'three'

export const sharedUniforms = {
  uTime: { value: 0 },
  /** world-space centre of the gesture force field */
  uFieldPos: { value: new THREE.Vector3(0, 0, -500) },
  /** world-space direction of the current */
  uFieldDir: { value: new THREE.Vector3(0, 0, 1) },
  /** 0..1 gesture intensity */
  uFieldStrength: { value: 0 },
  /** influence radius */
  uFieldRadius: { value: 11 },
  /** global light / ecosystem energy 0..1 */
  uEnergy: { value: 0.15 },
}
