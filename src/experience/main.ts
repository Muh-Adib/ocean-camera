// ---------------------------------------------------------------
// main.ts — experience orchestrator & cinematic sequencer.
// Boots every system, runs the master loop, schedules dynamic
// ecosystem events, adapts quality, handles enter/permission flow.
// ---------------------------------------------------------------
import './style.css'
import * as THREE from 'three'
import gsap from 'gsap'
import { SceneManager } from './core/SceneManager'
import { CameraRig } from './core/CameraRig'
import { PerformanceManager } from './core/PerformanceManager'
import { Lighting } from './core/Lighting'
import { sharedUniforms } from './core/sharedUniforms'
import { Seabed } from './environment/Seabed'
import { RockSystem } from './environment/Rocks'
import { CoralSystem } from './environment/CoralSystem'
import { Seaweed } from './environment/Seaweed'
import { WaterSurface } from './environment/WaterSurface'
import { ParticleField } from './particles/ParticleField'
import { BubbleSystem } from './particles/Bubbles'
import { GestureBurst } from './particles/GestureBurst'
import { FishManager } from './fish/FishManager'
import { SpecialCreatures } from './fish/SpecialCreatures'
import { InteractionField } from './interaction/InteractionField'
import { HandTracker } from './interaction/HandTracker'
import { GestureEngine } from './interaction/GestureEngine'
import { PointerFallback } from './interaction/PointerFallback'
import { AudioManager } from './audio/AudioManager'
import { UI } from './ui/UI'
import { rand, pick } from './utils/math'

export interface ExperienceHandle {
  dispose: () => void
}

export function bootExperience(container: HTMLElement): ExperienceHandle {
  const disposers: (() => void)[] = []

  try {
    return bootInner(container, disposers)
  } catch (err) {
    console.error('[ocean] boot failed:', err)
    container.innerHTML = ''
    showFatal(container, 'The ocean could not start on this device. Please try a modern desktop browser with WebGL enabled.')
    return { dispose: () => {} }
  }
}

function bootInner(container: HTMLElement, disposers: (() => void)[]): ExperienceHandle {
  // ---------------- core ----------------
  const perf = new PerformanceManager()
  let sceneMgr: SceneManager
  try {
    sceneMgr = new SceneManager(container, perf)
  } catch {
    showFatal(container, 'This experience needs WebGL. Please try a modern browser with hardware acceleration enabled.')
    return { dispose: () => {} }
  }
  const cfg = perf.config
  sceneMgr.setPixelRatioCap(cfg.dpr)
  sceneMgr.buildBackgroundDome()

  const cameraRig = new CameraRig(sceneMgr.camera)
  sceneMgr.scene.add(cameraRig.group)
  cameraRig.reducedMotion = perf.reducedMotion

  const lighting = new Lighting(sceneMgr.scene)
  lighting.buildGodRays(cfg.lightRayCount)
  lighting.buildCaustics()

  // ---------------- interaction state (needed early by systems) ----
  const field = new InteractionField()

  // ---------------- environment ----------------
  const seabed = new Seabed(sceneMgr.scene, cfg.pebbleCount)
  const rocks = new RockSystem(sceneMgr.scene, seabed.heightAt, 64)
  const coral = new CoralSystem(sceneMgr.scene, seabed.heightAt, cfg.coralDensity)
  const seaweed = new Seaweed(sceneMgr.scene, seabed.heightAt, cfg.seaweedBlades)
  const surface = new WaterSurface(sceneMgr.scene)
  const obstacles = [...rocks.obstacles, ...coral.obstacles]

  // ---------------- particles ----------------
  const particles = new ParticleField(sceneMgr.scene, cfg.microCount, cfg.planktonCount)
  const bubbles = new BubbleSystem(sceneMgr.scene, cfg.bubbleCount, seabed.heightAt, {
    pos: field.point, dir: field.dir, strength: sharedUniforms.uFieldStrength, radius: 11,
  })
  const bursts = new GestureBurst(sceneMgr.scene, cfg.burstPool)

  // ---------------- fish ----------------
  const fish = new FishManager(sceneMgr.scene, obstacles, cfg, coral.anemonePositions)
  const creatures = new SpecialCreatures(sceneMgr.scene)

  // ---------------- audio / tracking ----------------
  const audio = new AudioManager()
  const handTracker = new HandTracker()
  const gestureEngine = new GestureEngine(sceneMgr.camera, field, {
    onSwipe: (_dir, strength, point, dirVec) => {
      bursts.trail(point, dirVec, strength)
      cameraRig.reactToGesture(dirVec, strength)
      audio.gestureSpark(strength)
      // environment chain reaction: the current shifts
      gsap.to(seaweedCurrent, { x: dirVec.x, z: dirVec.z, duration: 1.2, ease: 'power2.out' })
    },
    onPush: (strength, point) => {
      bursts.shockwave(point, strength)
      cameraRig.pushReaction(strength)
      fish.scatterFrom(point, strength)
      audio.gestureSpark(strength)
    },
    onPull: () => { /* recovery handled by the state machine */ },
    onPalmStart: (point) => {
      bursts.ring(point)
      audio.gestureSpark(0.5)
    },
    onFistStart: () => { /* caution handled by the state machine */ },
  })
  const pointer = new PointerFallback(sceneMgr.canvas, sceneMgr.camera, field, bursts)

  // seaweed ambient current bridge (tweened on swipes)
  const seaweedCurrent = { x: 0.4, z: 0.1 }

  // ---------------- UI ----------------
  let entered = false
  const ui = new UI(container, {
    onDive: () => enterExperience(false),
    onEnableCamera: () => enterExperience(true),
    onToggleSound: () => {
      const muted = !audio.isMuted
      audio.setMuted(muted)
      ui.setSoundIcon(muted)
      ui.toast(muted ? 'Sound off' : 'Sound on', 1800)
    },
    onToggleCamera: async () => {
      if (handTracker.isRunning) {
        handTracker.stop()
        gestureEngine.reset()
        field.setHandActive(false)
        ui.setCameraActive(false)
        ui.setStatus('MOUSE MODE', 'mouse')
        ui.toast('Hand tracking stopped', 2400)
        return
      }
      await startCamera()
    },
    onShowGuide: () => ui.showGuide(),
  })
  handTracker.onStatus = (s) => {
    if (s === 'loading') {
      ui.setStatus('LOADING HAND MODEL…', 'loading')
      ui.setCameraButtonLoading(true)
    }
  }

  // camera start + specific, friendly failure handling
  async function startCamera() {
    ui.setStatus('STARTING CAMERA…', 'loading')
    const ok = await handTracker.start()
    ui.setCameraButtonLoading(false)
    if (ok) {
      ui.setCameraActive(true)
      ui.setStatus('HAND TRACKING', 'hand')
      ui.toast('Move your hand in view of the camera — the ocean follows.', 4200)
      ui.showGuide()
    } else {
      ui.setCameraActive(false)
      ui.setStatus('MOUSE MODE', 'mouse')
      // onFailure below already shows the specific help panel
    }
  }

  handTracker.onFailure = (reason) => {
    ui.setCameraButtonLoading(false)
    ui.setCameraActive(false)
    ui.setStatus('MOUSE MODE', 'mouse')
    ui.showCameraHelp(reason, () => { void startCamera() })
  }

  // ---------------- enter flow ----------------
  function enterExperience(withCamera: boolean) {
    if (entered) return
    entered = true

    ui.hideIntro(() => {
      const introTl = gsap.timeline()
      introTl.add(cameraRig.playIntro(), 0)
      introTl.call(() => { lighting.reveal(); surface.reveal() }, undefined, 2.2)
      introTl.call(() => ui.showHUD(), undefined, 4.5)
      if (perf.isMobile) introTl.call(() => ui.showFallbackNotice(), undefined, 5.2)

      // ecosystem wakes up, then settles
      gsap.to(field, { energy: 0.35, duration: 6, ease: 'power2.inOut', delay: 3 })
      gsap.to(field, { energy: 0.15, duration: 5, ease: 'power2.inOut', delay: 9 })
    })
    audio.start()
    ui.setSoundIcon(false)

    if (withCamera) {
      ui.setStatus('LOADING HAND MODEL…', 'loading')
      ui.setCameraButtonLoading(true)
      // camera starts in parallel with the cinematic descent
      handTracker.start().then((ok) => {
        ui.setCameraButtonLoading(false)
        if (ok) {
          ui.setCameraActive(true)
          ui.setStatus('HAND TRACKING', 'hand')
          ui.toast('Move your hand — the ocean follows.', 4200)
        } else {
          ui.setCameraActive(false)
          ui.setStatus('MOUSE MODE', 'mouse')
          // onFailure below already shows the specific help panel
        }
      })
    } else {
      ui.setStatus('MOUSE MODE', 'mouse')
    }

    pointer.enable()
    disposers.push(() => pointer.disable())
  }

  // ---------------- dynamic ecosystem events ----------------
  let nextEvent = rand(16, 34)
  function dynamicEvents(dt: number) {
    if (!entered) return
    nextEvent -= dt
    if (nextEvent > 0) return
    nextEvent = rand(20, 55)
    const events = [
      () => creatures.triggerRay(),
      () => creatures.triggerTurtle(),
      () => fish.randomImpulse(),
      () => bubbles.burstCluster(rand(-30, 30), rand(-50, -10), 16),
      () => seaweed.setCurrent(rand(-1, 1), rand(-0.4, 0.4), rand(0.15, 0.55)),
      () => lighting.pulseEnergy(),
    ]
    pick(events)()
  }

  // ---------------- adaptive quality ----------------
  perf.onChange((c) => {
    sceneMgr.setPixelRatioCap(c.dpr)
    particles.setPopulation(c.microCount / Math.max(1, cfg.microCount))
  })

  // ---------------- visibility pause ----------------
  let hidden = false
  const onVis = () => {
    hidden = document.hidden
    if (!hidden) clock.getDelta()  // swallow the pause gap
  }
  document.addEventListener('visibilitychange', onVis)

  // ---------------- main loop ----------------
  const clock = new THREE.Clock()
  let raf = 0
  let elapsed = 0

  function loop() {
    raf = requestAnimationFrame(loop)
    if (hidden) return
    const dt = Math.min(0.05, clock.getDelta())
    elapsed += dt
    perf.report(dt)

    // shared clock for every shader
    sharedUniforms.uTime.value = elapsed

    // ---- interaction pipeline ----
    pointer.updateKeyboard(dt)
    if (handTracker.isRunning) {
      const sample = handTracker.detect(dt)
      gestureEngine.update(sample, dt)
    }
    field.update(dt)

    // ---- world ----
    cameraRig.update(dt)
    fish.cameraWorld.copy(cameraRig.group.position)
    lighting.update(dt)

    // seaweed current blends ambient wander + gesture bias
    const swU = (seaweed.mesh.material as THREE.ShaderMaterial).uniforms
    const blend = Math.min(1, dt * 2)
    swU.uCurrentDir.value.x += (seaweedCurrent.x * 0.35 + field.ambientCurrent.x * 0.3 - swU.uCurrentDir.value.x) * blend
    swU.uCurrentDir.value.y += (seaweedCurrent.z * 0.35 + field.ambientCurrent.y * 0.3 - swU.uCurrentDir.value.y) * blend
    swU.uCurrent.value += ((0.25 + field.strength * 0.5) - swU.uCurrent.value) * blend

    fish.update(dt, elapsed, field.snapshot())
    creatures.update(dt, elapsed)
    bubbles.update(dt, elapsed)
    bursts.update(dt)
    dynamicEvents(dt)

    sceneMgr.render()
  }

  // kick everything off
  ui.runLoadingSequence(2600)
  loop()

  // ---------------- dispose ----------------
  return {
    dispose: () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('visibilitychange', onVis)
      handTracker.stop()
      audio.dispose()
      disposers.forEach((d) => d())
      sceneMgr.dispose()
      container.innerHTML = ''
      void particles
    },
  }
}

// ---------------------------------------------------------------
// fatal error screen (WebGL unavailable etc.)
// ---------------------------------------------------------------
function showFatal(container: HTMLElement, message: string) {
  const el = document.createElement('div')
  el.style.cssText = `
    position:fixed; inset:0; display:flex; align-items:center; justify-content:center;
    background:#02111f; color:#bfe0ee; font-family:system-ui,sans-serif;
    text-align:center; padding:2rem; font-size:0.95rem; line-height:1.7; z-index:99;`
  el.textContent = message
  container.appendChild(el)
}
