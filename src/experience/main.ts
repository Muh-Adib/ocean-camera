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
import { ReefDecor } from './environment/ReefDecor'
import { Biomes } from './environment/Biomes'
import { ParticleField } from './particles/ParticleField'
import { BubbleSystem } from './particles/Bubbles'
import { GestureBurst } from './particles/GestureBurst'
import { FishManager } from './fish/FishManager'
import { SpecialCreatures } from './fish/SpecialCreatures'
import { Feeding } from './fish/Feeding'
import { InteractionField } from './interaction/InteractionField'
import { HandTracker } from './interaction/HandTracker'
import { GestureEngine } from './interaction/GestureEngine'
import { PointerFallback } from './interaction/PointerFallback'
import { SwimController } from './interaction/SwimController'
import { AudioManager } from './audio/AudioManager'
import { UI } from './ui/UI'
import { GestureView } from './ui/GestureView'
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
  const decor = new ReefDecor(sceneMgr.scene, seabed.heightAt)
  const biomes = new Biomes(sceneMgr.scene, seabed.heightAt, seaweed.uniforms)
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
  const feeding = new Feeding(sceneMgr.scene, seabed.heightAt)

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

  // ---------------- free swim (open-world exploration) ----------------
  const swim = new SwimController(sceneMgr.canvas, seabed.heightAt, {
    x: 74, minZ: -96, maxZ: 18, maxY: 11.5, floorPad: 0.7,
  })
  swim.capturePose = () => cameraRig.snapshotSwim()
  swim.onChange = (on) => {
    pointer.swimMode = on
    ui.setSwimActive(on)
    if (on) {
      cameraRig.enterSwim()
      ui.setStatus('SWIM MODE', 'hand')
      ui.hideGuide()
      ui.toast(handTracker.isRunning
        ? 'Free swim — your open palm steers: hand left / right to turn, fist to kick forward.'
        : 'Free swim — drag to look, A / D to turn, W to glide, Space / C to rise and sink.', 5200)
      audio.gestureSpark(0.4)
    } else {
      cameraRig.exitSwim()
      const hand = handTracker.isRunning
      ui.setStatus(hand ? 'HAND TRACKING' : 'MOUSE MODE', hand ? 'hand' : 'mouse')
      ui.toast('Back to the drift.', 2200)
    }
  }

  // seaweed ambient current bridge (tweened on swipes)
  const seaweedCurrent = { x: 0.4, z: 0.1 }

  // ---------------- UI ----------------
  let entered = false
  const gestureView = new GestureView(container)
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
    onToggleSwim: () => swim.setActive(!swim.active),
    onToggleGestureView: () => {
      const active = gestureView.toggle()
      ui.setGestureViewActive(active)
      if (active && !handTracker.isRunning) {
        ui.toast('Enable the camera to see live hand detection.', 3400)
      }
    },
    onSwimBoost: (on) => { swim.forwardBoost = on ? 1 : 0 },
    onFeed: () => doFeed(),
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

  // ---------------- feeding ----------------
  let firstFeed = true
  function doFeed() {
    if (!entered) return
    const dir = new THREE.Vector3()
    sceneMgr.camera.getWorldDirection(dir)
    const origin = cameraRig.group.position.clone().addScaledVector(dir, 4.5)
    origin.y = Math.min(origin.y + 1.4, 10.2)
    feeding.drop(origin, 11)
    audio.gestureSpark(0.3)
    ui.toast(firstFeed ? 'Snacks away — watch the schools race in to eat!' : 'Snacks away.', firstFeed ? 3600 : 1800)
    firstFeed = false
  }
  const onFeedKey = (e: KeyboardEvent) => {
    if (e.code === 'KeyG' && !e.repeat) doFeed()
  }
  window.addEventListener('keydown', onFeedKey)
  disposers.push(() => window.removeEventListener('keydown', onFeedKey))

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
    swim.enable()
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
      () => bubbles.burstCluster(rand(-55, 55), rand(-72, -8), 16),
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
      gestureView.update(dt, sample, handTracker.lastLandmarks, gestureEngine.status, true, handTracker.video)
      // in swim mode the palm doubles as a steering joystick
      if (swim.active) {
        swim.setHandSteer(sample.x, sample.y, sample.present, sample.present && sample.openness < 0.28)
      }
    } else {
      gestureView.update(dt, null, null, gestureEngine.status, false, null)
    }
    field.update(dt)

    // ---- world ----
    if (swim.active) {
      swim.update(dt)
      cameraRig.pushSwimPose(swim.position, swim.yaw, swim.pitch)
    }
    cameraRig.update(dt)
    fish.cameraWorld.copy(cameraRig.group.position)
    lighting.update(dt)

    // seaweed current blends ambient wander + gesture bias
    const swU = (seaweed.mesh.material as THREE.ShaderMaterial).uniforms
    const blend = Math.min(1, dt * 2)
    swU.uCurrentDir.value.x += (seaweedCurrent.x * 0.35 + field.ambientCurrent.x * 0.3 - swU.uCurrentDir.value.x) * blend
    swU.uCurrentDir.value.y += (seaweedCurrent.z * 0.35 + field.ambientCurrent.y * 0.3 - swU.uCurrentDir.value.y) * blend
    swU.uCurrent.value += ((0.25 + field.strength * 0.5) - swU.uCurrent.value) * blend

    fish.update(dt, elapsed, field.snapshot(), feeding.pellets, creatures.getThreatPoints())
    creatures.update(dt, elapsed)
    feeding.update(dt, elapsed)
    bubbles.update(dt, elapsed)
    bursts.update(dt)
    dynamicEvents(dt)

    sceneMgr.render()
  }

  // kick everything off
  ui.runLoadingSequence(2600)
  loop()

  // QA/testing hooks (harmless in production, handy in devtools & CI)
  ;(window as unknown as { __ocean: Record<string, (...args: unknown[]) => unknown> }).__ocean = {
    fast: () => { gsap.ticker.lagSmoothing(false) },
    yaw: () => (swim.active ? swim.yaw : cameraRig.snapshotSwim().yaw),
    pos: () => (swim.active ? swim.position.toArray() : cameraRig.group.position.toArray()),
    fishCount: () => fish.count(),
    swimMode: () => swim.active,
    forceShark: () => creatures.triggerPredator(),
    forceTurtle: () => creatures.triggerTurtle(),
    forceRay: () => creatures.triggerRay(),
    puffs: () => fish.schools.filter((s) => s.species === 'pufferfish')
      .map((s) => s.fish.map((f) => Math.round(f.puff * 100) / 100)),
    parkPuffer: (...args: unknown[]) => {
      const pf = fish.schools.find((s) => s.species === 'pufferfish')
      const f = pf?.fish[Number(args[0] ?? 0)]
      if (!f) return false
      f.pos.set(Number(args[1]), Number(args[2]), Number(args[3]))
      f.vel.set(0, 0, 0)
      return true
    },
    park: (...args: unknown[]) => {
      // park(species, index, x, y, z) — QA staging helper
      const s = fish.schools.find((sc) => sc.species === String(args[0]))
      const f = s?.fish[Number(args[1] ?? 0)]
      if (!f) return false
      f.pos.set(Number(args[2]), Number(args[3]), Number(args[4]))
      f.vel.set(0, 0, 0)
      return true
    },
    threats: () => creatures.getThreatPoints().map((p) => p.toArray()),
    pufferPos: () => fish.schools.filter((s) => s.species === 'pufferfish')
      .map((s) => s.fish.map((f) => f.pos.toArray().map((n) => Math.round(n * 10) / 10))),
    tp: (...args: unknown[]) => {
      if (!swim.active) return false
      swim.position.set(Number(args[0]), Number(args[1]), Number(args[2]))
      return true
    },
  }

  // ---------------- dispose ----------------
  return {
    dispose: () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('visibilitychange', onVis)
      handTracker.stop()
      swim.disable()
      audio.dispose()
      gestureView.dispose()
      disposers.forEach((d) => d())
      sceneMgr.dispose()
      container.innerHTML = ''
      decor.dispose()
      biomes.dispose()
      feeding.dispose()
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
