// ---------------------------------------------------------------
// main.ts — experience orchestrator & cinematic sequencer.
// Boots every system, runs the master loop, schedules dynamic
// ecosystem events, adapts quality, handles enter/permission flow.
// ---------------------------------------------------------------
import './style.css'
import './projection/projection.css'
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
import type { HandSample, Landmark } from './interaction/HandTracker'
import { GestureEngine } from './interaction/GestureEngine'
import { PointerFallback } from './interaction/PointerFallback'
import { SwimController } from './interaction/SwimController'
import { RemoteHands } from './remote/RemoteHands'
import { RemoteCmds, type RemoteCmd } from './remote/RemoteCmds'
import { AudioManager } from './audio/AudioManager'
import { UI } from './ui/UI'
import { GestureView } from './ui/GestureView'
import { ProjectionManager } from './projection/ProjectionManager'
import { rand, pick } from './utils/math'
import { gridFromCorners } from './projection/ProjectionMath'

export interface ExperienceHandle {
  dispose: () => void
}

export interface BootOptions {
  /** dedicated projection-output boot (/output page): no UI, composite only */
  outputOnly?: boolean
}

export function bootExperience(container: HTMLElement, opts: BootOptions = {}): ExperienceHandle {
  const disposers: (() => void)[] = []

  try {
    return bootInner(container, disposers, opts.outputOnly === true)
  } catch (err) {
    console.error('[ocean] boot failed:', err)
    container.innerHTML = ''
    showFatal(container, 'The ocean could not start on this device. Please try a modern desktop browser with WebGL enabled.')
    return { dispose: () => {} }
  }
}

function bootInner(container: HTMLElement, disposers: (() => void)[], outputOnly = false): ExperienceHandle {
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
  // smartphone remote: the phone streams both hands over SSE and —
  // while fresh — takes priority over the local camera as the
  // gesture source on THIS page (and on every /output page too)
  const remoteHands = new RemoteHands()
  remoteHands.start()
  // smartphone BUTTON PAD: one-shot show commands + toggle echoes
  // (feed/burst/shark/… + swim/sound/boost) over a second SSE link
  const remoteCmds = new RemoteCmds()
  remoteCmds.start()
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
    publishHostState()
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
  const gestureView = outputOnly ? null : new GestureView(container)
  const ui = new UI(container, {
    onDive: () => enterExperience(false),
    onEnableCamera: () => enterExperience(true),
    onToggleSound: () => {
      const muted = !audio.isMuted
      audio.setMuted(muted)
      ui.setSoundIcon(muted)
      ui.toast(muted ? 'Sound off' : 'Sound on', 1800)
      publishHostState()
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
      if (!gestureView) return
      const active = gestureView.toggle()
      ui.setGestureViewActive(active)
      if (active && !handTracker.isRunning) {
        ui.toast('Enable the camera to see live hand detection.', 3400)
      }
    },
    onSwimBoost: (on) => { swim.forwardBoost = on ? 1 : 0 },
    onFeed: () => doFeed(),
    onToggleProjection: () => {
      projection.toggle()
      ui.setProjectionActive(projection.active)
    },
  })
  if (outputOnly) {
    // pure output: nothing but the picture — the projection pipeline takes over
    ui.root.style.display = 'none'
  }
  // ---------------- projection mapping ----------------
  const projection = new ProjectionManager({
    sceneMgr,
    container,
    toast: (m, d) => ui.toast(m, d),
    outputOnly,
  })
  if (outputOnly) projection.enterOutputOnly()

  handTracker.onStatus = (s) => {
    if (s === 'loading') {
      ui.setStatus('LOADING HAND MODEL…', 'loading')
      ui.setCameraButtonLoading(true)
    }
  }

  // phone contact — the status chip mirrors who is steering the ocean
  remoteHands.onStatus = (s) => {
    if (s === 'live') {
      ui.setStatus('REMOTE HANDS', 'hand')
      ui.toast('Phone connected — both hands steer the ocean.', 3200)
    } else if (s === 'stale' || s === 'off') {
      if (!swim.active) {
        ui.setStatus(handTracker.isRunning ? 'HAND TRACKING' : 'MOUSE MODE', handTracker.isRunning ? 'hand' : 'mouse')
      }
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

  // ---------------- smartphone button pad ----------------
  /** every page runs its own sim, so world events land on the
   *  studio AND on every /output; view-changing commands only run
   *  where there is a view (the studio) */
  const fishCentroid = () => {
    const c = new THREE.Vector3()
    let n = 0
    for (const s of fish.schools) {
      const f = s.fish[0]
      if (f) { c.add(f.pos); n++ }
    }
    return n ? c.multiplyScalar(1 / n) : new THREE.Vector3(0, 2, -30)
  }

  function applyRemoteCmd(cmd: RemoteCmd) {
    switch (cmd.type) {
      case 'feed':
        doFeed()
        break
      case 'burst': {
        const p = fishCentroid()
        bursts.shockwave(p, 0.85)
        fish.scatterFrom(p, 0.85)
        audio.gestureSpark(0.8)
        if (!outputOnly) cameraRig.pushReaction(0.85)
        break
      }
      case 'shark':
        creatures.triggerPredator()
        if (!outputOnly) ui.toast('PHONE PAD · Shark!', 1600)
        break
      case 'turtle':
        creatures.triggerTurtle()
        if (!outputOnly) ui.toast('PHONE PAD · Turtle glides in', 1600)
        break
      case 'ray':
        creatures.triggerRay()
        if (!outputOnly) ui.toast('PHONE PAD · Ray sweeps by', 1600)
        break
      case 'pulse':
        lighting.pulseEnergy()
        break
      case 'bubbles':
        bubbles.burstCluster(rand(-55, 55), rand(-72, -8), 18)
        break
      case 'impulse':
        fish.randomImpulse()
        break
      case 'swim':
        if (!outputOnly) {
          swim.setActive(!swim.active)
          publishHostState()
        }
        break
      case 'sound':
        if (!outputOnly) {
          const muted = !audio.isMuted
          audio.setMuted(muted)
          ui.setSoundIcon(muted)
          ui.toast(muted ? 'Sound off (phone)' : 'Sound on (phone)', 1600)
          publishHostState()
        }
        break
      case 'boost':
        if (!outputOnly) swim.forwardBoost = cmd.on ? 1 : 0
        break
      case 'view': {
        // CAMERA CHAIN — moves the output cameras as ONE motion around the
        // center camera. Every page renders surfaces, so every page applies
        // it (studio, /output mirrors, session links — no gating).
        projection.chain.applyView(cmd.view)
        // the studio owns the host echo; throttle so 18 Hz drag streams
        // don't flood the relay (trailing publish keeps the pad honest)
        if (!outputOnly) publishChainStateSoon()
        break
      }
    }
  }
  remoteCmds.onCmd = applyRemoteCmd

  /** echo the studio's toggle state so the pad badges SWIM/SOUND
   *  with the real thing (phone polls /api/remote/cmd) */
  function publishHostState() {
    if (outputOnly) return
    const chain = projection.chain
    void fetch('/api/remote/cmd', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        room: remoteCmds.room,
        host: {
          swim: swim.active,
          muted: audio.isMuted,
          chain: {
            yaw: Math.round(chain.yawT * 10) / 10,
            pitch: Math.round(chain.pitchT * 10) / 10,
            dolly: Math.round(chain.dollyT * 100) / 100,
            moveX: Math.round(chain.moveXT * 100) / 100,
            moveY: Math.round(chain.moveYT * 100) / 100,
            auto: chain.auto,
          },
        },
      }),
      keepalive: true,
    }).catch(() => { /* badges are cosmetic */ })
  }

  // view drags stream at ~18 Hz — echo the chain back at most ~2×/s
  let chainPublishTimer = 0
  function publishChainStateSoon() {
    if (chainPublishTimer) return
    chainPublishTimer = window.setTimeout(() => {
      chainPublishTimer = 0
      publishHostState()
    }, 550)
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
  let frameTick = 0

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
    // gesture source: the phone remote while its stream is fresh,
    // otherwise the local camera (both can track TWO hands)
    let samples: HandSample[] = []
    let lmList: Landmark[][] = []
    let tracking = false
    let video: HTMLVideoElement | null = null
    if (remoteHands.isFresh) {
      samples = remoteHands.hands
      lmList = remoteHands.landmarks
      tracking = true
    } else if (handTracker.isRunning) {
      handTracker.detect(dt)          // drives per-slot smoothing
      samples = handTracker.hands()
      lmList = handTracker.landmarksList()
      tracking = true
      video = handTracker.video
    }
    gestureEngine.update(samples, dt)
    gestureView?.update(dt, samples, lmList, gestureEngine.status, tracking, video)
    // in swim mode the primary palm doubles as a steering joystick
    // (local or remote — whichever is driving)
    if (swim.active) {
      const steer = samples[0]
      swim.setHandSteer(steer ? steer.x : 0.5, steer ? steer.y : 0.5, !!steer, !!steer && steer.openness < 0.28)
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

    // Automation environments (software WebGL) render orders of magnitude
    // slower — skip most frames entirely there so tests stay responsive.
    // Real browsers (navigator.webdriver false) always render 1:1.
    const headless = (navigator as Navigator & { webdriver?: boolean }).webdriver === true
    const skipRender = headless && (frameTick++ % 8) !== 0

    // projection mode owns the frame when its studio is open:
    // N surface cameras render the shared world into N targets,
    // then the composite (or the editor viewport) hits the screen.
    if (skipRender) {
      // sim above still ran — just don't draw this tick
    } else if (projection.active) {
      projection.renderFrame(dt)
    } else {
      sceneMgr.render()
    }
  }

  // kick everything off
  if (outputOnly) {
    // no loading theatre on the projector feed — dive straight to the composite
    entered = true
  } else {
    ui.runLoadingSequence(2600)
  }
  publishHostState()   // the pad's SWIM/SOUND badges start from the truth
  loop()

  // QA/testing hooks (harmless in production, handy in devtools & CI)
  ;(window as unknown as { __ocean: Record<string, unknown> }).__ocean = {
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
    /** live force-field state (QA: two-hand / remote verification) */
    field: () => ({
      active: field.active,
      active2: field.active2,
      strength: Math.round(field.strength * 1000) / 1000,
      strength2: Math.round(field.strength2 * 1000) / 1000,
      point: field.point.toArray().map((n) => Math.round(n * 10) / 10),
      point2: field.point2.toArray().map((n) => Math.round(n * 10) / 10),
    }),
    gesture: () => ({ ...gestureEngine.status }),
    /** smartphone BUTTON PAD diagnostics (QA: apply a pad command) */
    pad: {
      status: () => remoteCmds.status,
      room: () => remoteCmds.room,
      /** fire a pad command straight into the pipeline (no network) */
      apply: (type: string, on?: boolean) => {
        applyRemoteCmd({ id: -1, room: remoteCmds.room, t: Date.now(), type: type as RemoteCmd['type'], on })
        return true
      },
    },
    /** CAMERA CHAIN diagnostics (QA: drive the rig like the phone does) */
    chain: {
      state: () => projection.chain.qaState(),
      /** apply a view payload exactly as a 'view' cmd would land */
      view: (v: unknown) => {
        applyRemoteCmd({ id: -1, room: remoteCmds.room, t: Date.now(), type: 'view', view: v as never })
        return projection.chain.qaState()
      },
      reset: () => { projection.chain.reset(); return projection.chain.qaState() },
    },
    /** smartphone remote link diagnostics */
    remote: {
      status: () => remoteHands.status,
      fresh: () => remoteHands.isFresh,
      hands: () => remoteHands.hands.length,
      room: () => remoteHands.room,
      /** simulate a phone frame straight into the pipeline (QA, no network) */
      inject: (x: number, y: number, openness: number, second?: { x: number; y: number; openness: number }) => {
        const now = Date.now()
        const mk = (hx: number, hy: number, ho: number): HandSample => ({ present: true, x: hx, y: hy, openness: ho, scale: 0.15, t: now })
        remoteHands.hands = second
          ? [mk(x, y, openness), mk(second.x, second.y, second.openness)]
          : [mk(x, y, openness)]
        remoteHands.landmarks = []
        remoteHands.lastAt = now
        return remoteHands.hands.length
      },
      clear: () => { remoteHands.hands = []; remoteHands.landmarks = []; remoteHands.lastAt = 0 },
    },
    threats: () => creatures.getThreatPoints().map((p) => p.toArray()),
    pufferPos: () => fish.schools.filter((s) => s.species === 'pufferfish')
      .map((s) => s.fish.map((f) => f.pos.toArray().map((n) => Math.round(n * 10) / 10))),
    tp: (...args: unknown[]) => {
      if (!swim.active) return false
      swim.position.set(Number(args[0]), Number(args[1]), Number(args[2]))
      return true
    },
    projection: {
      enter: () => { projection.enter(); ui.setProjectionActive(true) },
      exit: () => { projection.exit(); ui.setProjectionActive(false) },
      isActive: () => projection.active,
      state: () => projection.qaState(),
      preset: (id: string) => projection.applyPreset(id),
      select: (name: string) => {
        const s = projection.surfaces.surfaces.find((x) => x.name.toLowerCase() === String(name).toLowerCase())
        if (s) projection.surfaces.select(s.id)
        return !!s
      },
      output: (on: boolean) => projection.setOutputLive(on),
      calibrate: (pattern: string) => projection.setCalibrationAll(pattern as never),
      scale: (n: number) => projection.setRenderScale(n),
      quality: (q: string) => { projection.setQuality(q as never); return projection.qualityLabel() },
      autoSample: (cost: number) => { projection.qaAutoTick(cost); return projection.qualityLabel() },
      publish: (name: string) => projection.publishSession(String(name)),
      sessions: () => projection.listSessions(),
      loadSession: (id: string) => projection.loadSession(String(id)),
      /** portable /output link with the whole project embedded (?…&d=…) */
      link: (id: string) => projection.portableSessionLink(String(id)),
      portable: () => projection.portableBoot,
      fsEdit: (on?: boolean) => projection.setFullscreenEditor(on !== false),
      /** live-sync transport diagnostics (BroadcastChannel + server relay) */
      relay: () => projection.relayInfo(),
      /** force an immediate full push to every open /output */
      pushNow: () => projection.qaPush(),
      freeze: (on: boolean) => { projection.qaFrozen = on },
      save: () => projection.project.saveLocal(),
      loadLocal: () => projection.project.loadLocal(),
      exportFile: () => projection.project.exportFile(),
      snapshot: () => projection.surfaces.snapshot(),
      undo: () => projection.undo(),
      redo: () => projection.redo(),
      hist: () => projection.surfaces.debugPeek(),
      warpCorner: (surfaceName: string, corner: 'tl' | 'tr' | 'br' | 'bl', x: number, y: number) => {
        const s = projection.surfaces.surfaces.find((sc) => sc.name.toLowerCase() === String(surfaceName).toLowerCase())
        if (!s) return false
        s.warp.corners[corner] = { x, y }
        s.warp.grid = gridFromCorners(s.warp.corners, s.warp.gridResolution)
        projection.surfaces.emit()
        return true
      },
      /** QA: move a whole surface through the LIGHT path (like a real drag in
       *  the output editor) — exercises the fast live-push chain */
      moveSurface: (surfaceName: string, dx: number, dy: number) => {
        const s = projection.surfaces.surfaces.find((sc) => sc.name.toLowerCase() === String(surfaceName).toLowerCase())
        if (!s) return false
        s.output.x += dx
        s.output.y += dy
        for (const k of ['tl', 'tr', 'br', 'bl'] as const) {
          s.warp.corners[k].x += dx
          s.warp.corners[k].y += dy
        }
        s.warp.grid.forEach((p) => { p.x += dx; p.y += dy })
        projection.surfaces.touch(s)
        return true
      },
    },
  }

  // ---------------- dispose ----------------
  return {
    dispose: () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('visibilitychange', onVis)
      remoteCmds.stop()
      remoteHands.stop()
      handTracker.stop()
      swim.disable()
      audio.dispose()
      gestureView?.dispose()
      projection.dispose()
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
