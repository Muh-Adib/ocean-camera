# Worklog

---
Task ID: 1
Agent: main (Super Z)
Task: Build "The Living Ocean" — immersive 3D interactive ocean web experience with hand-gesture control (Three.js + GSAP + MediaPipe Hands)

Work Log:
- Initialized fullstack environment via init script (Next.js 16 + App Router, port 3000)
- Installed three@0.185.1, gsap@3.15.0, @types/three
- Built framework-free experience under `src/experience/` (React only mounts the container in `src/app/page.tsx`)
- Core: SceneManager (fog, ACES, gradient dome), CameraRig (cinematic drift + gesture reaction + intro descent), PerformanceManager (3 device tiers + adaptive FPS degradation), Lighting (god-ray planes, procedural tileable caustics, energy pulses), sharedUniforms (single time/field/energy source for all shaders)
- Environment: Seabed (fbm dunes + ripples + pebbles/shells), RockSystem (deformed instanced boulders + colliders), CoralSystem (8 procedural families — branch/brain/table/fan/tube/boulder/soft/anemone — merged per family, shader sway with gesture-field bend, anemone homes for clownfish), Seaweed (InstancedBufferGeometry, fully GPU sway + field influence)
- Particles: ParticleField (micro + plankton, GPU drift/twinkle/field response), BubbleSystem (instanced, wobble + drift + cluster events), GestureBurst (pooled trails/shockwaves/rings)
- Fish: FishGeometryFactory (6 boid species procedurally built — lathe bodies, parametric fins, canvas-pattern textures, reserved white texel for fins, instanced swim-bend shader via aPhase attribute), Boids (separation/alignment/cohesion/wander/obstacle/boundary/gesture forces, homebound clownfish, camera-curious pufferfish), FishManager (12 schools, per-species InstancedMesh, ~100 fish), SpecialCreatures (gliding ray with flap shader, sea turtle with flipper animation, 2 predator silhouettes on random schedules)
- Interaction: InteractionField (virtual force field + CALM/CURIOUS/ACTIVE/SCATTER/RECOVERY GSAP state machine + shared uniform publishing), HandTracker (MediaPipe tasks-vision via CDN dynamic import, local WASM inference, hidden video, mirrored palm/openness/scale), GestureEngine (swipe L/R/U/D, push/pull via hand scale rate, open palm attract, fist caution, velocity-strength coupling), PointerFallback (move/drag current, tap attract, hold push, WASD/Space/X keyboard)
- Audio: fully procedural WebAudio (drone, brown-noise water, bubble blips, whale calls with echo, gesture shimmer), mute toggle, autoplay-safe start
- UI: staged loading sequence, ENTER THE OCEAN intro with privacy note, minimal glass HUD (sound/camera/help), status chip, gesture hints, OCEAN GUIDE dialog, toasts, reduced-motion support, safe-area support
- Fixed 3 boot bugs found via browser verification: mergeGeometries indexed/non-indexed mixing (fish fins, predator), missing color/uv attributes on predator buffers
- Polished: camera home moved closer (0,1.6,13), fish anchors/scales increased, coral density +~30% & scale 1.05–2.2, fog 0.021, exposure 1.22, god rays/caustics opacity up, school hints
- Verified via agent-browser: loading → intro → DIVE IN descent → HUD → drag particle trail → hold-push shockwave → guide dialog → camera-denial toast fallback → mobile 390×844 layout → 20s stability, zero console errors

Stage Summary:
- Deliverable: runnable immersive ocean at `/` (dev server port 3000), zero console errors, graceful camera/WebGL/mobile fallbacks
- Architecture: 24 vanilla TS modules in src/experience/{core,environment,particles,fish,interaction,audio,ui,utils}; React shell ≤40 lines
- Hand tracking requires internet (MediaPipe CDN + model); all other systems are self-contained and offline-capable
- Privacy: camera frames processed locally via WASM, never uploaded, video element never displayed

---
Task ID: 2
Agent: main (Super Z)
Task: Fix "camera unavailable" error + tune gesture sensitivity + add fish species

Work Log:
- HandTracker: replaced opaque try/catch with typed CameraFailure reasons (insecure/iframe/permission/no-device/busy/model/unknown); OverconstrainedError → relaxed retry {video:true}; video.play() 4s timeout race; MediaPipe GPU→CPU delegate fallback; iframe detection (window.self!==window.top) to attribute silent permissions-policy blocks
- UI: new .cam-help glass panel + CAM_HELP copy per failure reason (role=alert, auto-hide 20s); TRY AGAIN re-runs startCamera; OPEN IN NEW TAB button shown only for iframe case; panel auto-hides on camera success
- main.ts: extracted startCamera(); handTracker.onFailure wires reason → ui.showCameraHelp(); removed generic "Camera unavailable" toast (replaced by specific panel)
- GestureEngine tuning: SWIPE_SPEED 1.05→0.82, PUSH_RATE 0.55→0.42, PALM_ON 0.62→0.54 / OFF 0.4, FIST_ON 0.22→0.27 / OFF 0.4, hold times 0.22/0.24→0.16s, swipe cadence 650→520ms, push/pull cadence 900/1100→760/900ms, strength curves steeper, velocity smoothing damp 7→9, continuous-current threshold 0.12→0.08 & cap 0.55→0.65
- New species in FishGeometryFactory: 'moorish' (tall compressed body, trailing dorsal filament, yellow crown + 2 black bands) and 'squirrel' (red body, silver lateral stripe, oversized eye); tint palettes added
- FishManager: 3 new schools (moorish ×5 @ [-24,3.5,-30], moorish ×3 @ [19,-4,-34], squirrel ×8 homebound @ [-21,-7.5,-20]) → ~16 extra fish, still one InstancedMesh per school

Stage Summary:
- Camera failures now produce a specific, actionable panel (never raw errors); embedded-preview blockage — the likely cause of the user's "camera unavailable" — gets an OPEN IN NEW TAB fix
- Gestures noticeably easier to trigger; added Moorish idol + squirrelfish to the reef (8 boid species total)
- Verified headless: page loads clean, ENABLE CAMERA → "NO CAMERA FOUND" panel + TRY AGAIN, retry flow OK, status chip MOUSE MODE, zero console errors; tsc clean for src/experience

---
Task ID: 3
Agent: main (Super Z)
Task: Enhance 3D detailing — realistic ocean & fish

Work Log:
- FishGeometryFactory v2 (full rewrite): 256px canvas textures with procedural scale rows (brick-offset crescents), gill plates (operculum arcs per flank), dashed lateral lines, mouth shading, 5-stop counter-shading gradients (dark back → silver flanks → pale belly); Catmull-Rom body-profile resampling (7 ctrl pts → 14 smooth pts) + lathe 16→20 radial segments; new 3-layer eyes (sclera + pupil + glint); paired pelvic fins; pufferfish rounder with 44 longer spikes; angelfish trailing dorsal/anal streamers; material wet-look (roughness 0.34, metalness 0.24) + fresnel rim-light shader patch (underwater subsurface feel)
- New WaterSurface module (environment/WaterSurface.ts): 200×160 waving plane at y=15.5 seen from below — 4-octave vertex waves + finite-difference normals, Snell-window facing glow, domain-warped organic shimmer + rare sparkle, gesture-force light ripples, edge alpha fade, GSAP reveal synced with lighting
- Atmosphere: dome top #10688c / mid #093c58, exposure 1.26, fog 0.0225; caustics scale 2.6 (bigger cells) power 6.0, intensity up; god-ray opacity 0.34–0.7
- main.ts: WaterSurface wired + revealed with lighting.reveal()
- BUGFIX (real user-facing): intro buttons were clickable during loading (opacity 0 but display:flex) — programmatic/keyboard clicks broke the entry sequence; intro now display:none until shown. Replaced hideIntro().then() with GSAP onComplete callback (deterministic). CameraRig.update no longer overwrites group.position while the intro tween owns it (introPlaying guard) — fixes camera snap during descent
- Verified: tsc clean; headless flow → tlCreated/revealCalled/hudShown all true, HUD opacity 1; zero console/page errors; desktop screenshot shows organic surface shimmer, detailed fish (Moorish idol visible), caustics

Stage Summary:
- Fish: scales/gills/lateral lines/3-layer eyes/pelvic fins + wet fresnel material → far more lifelike silhouettes and close-ups
- Ocean: animated water-surface ceiling with Snell glow + gesture ripples, richer caustics, brighter surface gradient
- Entry flow race condition fixed; intro camera tween no longer fights the drift controller
- Note: headless software rendering runs ~1-3fps → GSAP timelines crawl there; on real GPUs (60fps) all timings are normal
