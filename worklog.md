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

---
Task ID: 4
Agent: main (Super Z)
Task: Push project to user's GitHub repo (Muh-Adib/ocean-camera)

Work Log:
- Untracked local artifacts (.env, db/custom.db); added /db and *.db to .gitignore
- Squashed 4 auto-generated UUID commits into one clean orphan commit on main (remote was empty, zero risk)
- Commit author set to Muh-Adib with GitHub noreply email
- Added remote origin; pushed main via one-off token URL (token not persisted in .git/config)
- Verified remote HEAD = 319a2f1; fetched and set main → origin/main tracking

Stage Summary:
- Repo live at github.com/Muh-Adib/ocean-camera, single clean commit, no secrets tracked
- Future pushes require only `git push` (upstream configured)
- User advised to revoke the pasted PAT after push

---
Task ID: 5
Agent: main (Super Z)
Task: Repo polish + camera bug hardening + 3D detailing round 3, push to GitHub

Work Log:
- HandTracker hardening: shared in-flight promise (double-click/intro+HUD races can no longer spawn parallel starts); withTimeout() time-boxes every CDN step (import 12s, wasm 12s, GPU/CPU landmarker 20s) so the button can never spin forever; video-track 'ended' listener → new 'lost' failure (unplug/revoke mid-session); stop() wraps landmarker.close() in try/catch
- UI: CAM_HELP.lost entry ("CAMERA DISCONNECTED") with reconnect guidance
- New species 'minnow' (silver baitfish: slim profile, deeply forked tail, mirror flanks, faint lateral band); SPECIES_TINTS.minnow silvery
- FishManager: bait-ball school (minnow ×90 @ [-2,5.5,-32], fast aliW 2.8 / cohW 1.7 / maxSpeed 4.4, response 1.4, swim freq 11) → ~200 fish total
- New ReefDecor module (environment/ReefDecor.ts): beveled 5-arm starfish ×8 (irregular arms, coral-orange/rust palette), sea urchins ×12 (fibonacci-distributed needle spikes seated into dark purple test), ribbed scallop shells ×16 — all vertex-coloured and merged into ONE static draw call, scattered r=9..45 on seabed heightAt
- Docs: README.md (features, gesture + fallback controls, quick start, 7-row camera troubleshooting, stack, structure, perf/a11y, privacy; no platform attribution), LICENSE (MIT © Muh-Adib), package.json renamed the-living-ocean v1.0.0 + repository/author fields
- Verified: tsc clean (src), headless flow DIVE IN → HUD → camera "NO CAMERA FOUND" → TRY AGAIN re-shows → 20s auto-hide (RAF-lag confirmed, panel removed), zero console/page errors; screenshots show bait-ball swarm + caustics

Stage Summary:
- Camera start path is now race-free and fully time-boxed; mid-session camera loss surfaces a specific panel
- Reef gained a 90-fish silver bait-ball and a one-draw-call bottom-dweller layer
- Repo is portfolio-ready: README/LICENSE/package metadata, single clean history on GitHub

---
Task ID: 6
Agent: main (Super Z)
Task: Fix detached fish shapes (realism) + open-world free swimming; searched for a 3D-modeling skill first

Work Log:
- Searched ClawHub per user request: blender-3d-modeling & meshy-3d-agent both require external cloud/API accounts and conflict with the fully-procedural offline design → fixed the actual root cause procedurally instead
- FishGeometryFactory v3 — root cause of "separated" parts was control-point placement: makeBody now returns radiusAt(z) sampled from the 18-pt resampled profile; dorsal/anal fin bases follow the hull (sunk 12%), tips fade to membrane white; tail root buried into the peduncle (-0.86len); pectoral/pelvic roots seated at hull radius; eyes seated at surface radius (+18% poke); pufferfish spikes use radiusAt too; lathe 20→24 segments
- New SwimController (interaction/SwimController.ts): drag-look yaw/pitch, WASD/arrows glide, Space ascend, C/Shift descend, F toggle, Esc exit, touch forwardBoost, water drag + soft bounds (floor via heightAt +0.7 pad, ceiling y=11, ±46/-62..14); capturePose hook snapshots live camera on entry
- CameraRig: swim branch in update (bob + roll + offset, YXZ quaternion), snapshotSwim/enterSwim/exitSwim (GSAP glide home over ~3s), pushSwimPose feed from main loop
- PointerFallback: swimMode flag suppresses hold-push on press-drag, Space/WASD/arrows current, keyboard currents
- UI: swim HUD button (fish glyph), ▲ GLIDE touch paddle (pointer hold → forwardBoost), guide + hints updated, setSwimActive
- main: swim wiring incl. swim.enable() on enter (initially missing — F key dead until added), pointer.swimMode sync, dispose
- README: free-swim feature + controls table + structure update
- Verified headless: tsc clean; DIVE IN → F toggles SWIM MODE (chip+paddle+active button), swam ~40u forward/up across the reef (screenshots swim-1..7: starfish, shells, urchins, Moorish idol with attached dorsal filament, pufferfish, tang schools, clownfish at anemone), zero console/page errors

Stage Summary:
- Fish parts are mathematically seated on the hull → no detached-looking fins/eyes/tails at any distance
- The ocean is now explorable: first-person free swim with inertial water feel and soft world bounds
- Skill search outcome: external 3D-modeling services rejected on-architecture grounds; procedural math achieved the goal offline
