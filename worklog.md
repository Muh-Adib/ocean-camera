# Worklog

---
Task ID: 1
Agent: main
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
Agent: main
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
Agent: main
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
Agent: main
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
Agent: main
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
Agent: main
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

---
Task ID: 7
Agent: main
Task: Camera rotation via hand-swim + keyboard, wider & more varied ocean, push to GitHub

Work Log:
- SwimController: A/D and ←/→ now TURN the swimmer (eased via yawVel damping), Q/E strafe, W/S + ↑/↓ glide, Space/C rise & sink; new setHandSteer(x, y, present, fist) palm joystick — dead-zone 0.13 with ^1.35 response curve, hand left/right of center turns, up/down pitches, closed fist kicks forward (thrustSmooth ~5/s); max speed 7.5→8.2
- main.ts: feeds hand samples into swim.setHandSteer while swimming (steer only when tracker runs); swim bounds widened to ±74 / -96..18 / ceiling 11.5; swim toast now explains palm steering; Biomes module wired + disposed; dynamic bubble bursts widened
- Biomes (new environment/Biomes.ts): NW kelp forest (330 instanced fronds, heavy-stipe GPU sway, olive→gold gradient, shares seaweed uCurrent/uCurrentDir uniform objects so all flora sways as one — via new Seaweed.uniforms getter); SW canyon with two fbm-weathered rock arches + 10 boulders + 4 wall fins; 5 northern monolith spires on the seamount; 3 sand-flat bommies; static rockwork merged to ONE vertex-coloured draw call (fixed: icosahedron parts are non-indexed — expand indexed parts via toNonIndexed before merge)
- Seabed: 170→250 units, seg 140; terrain() gains a canyon basin (-3.8 gaussian @ -52,-46) and a northern seamount (+3.2 @ 10,-80) — heightAt stays the single source of truth; sand tinted per biome (olive under kelp, bright flats SE, cold silt north, dark canyon)
- Opened up the world: BOUNDS ±68/-92..10, fog 0.0225→0.016, water surface 300×240, particles 150×122 spread, bubbles ±62/-88, ReefDecor radius 9..67, Rocks/CoralSystem/Seaweed scatter extended with SE flats, northern foothills, canyon rim, kelp fringe and far-horizon clusters (+12 coral clusters, +12 seaweed meadows)
- FishManager: 8 new zone schools — kelp tang ×10, kelp bait-ball ×55, sand-flat tropicals ×12 + squirrelfish ×6, canyon idols ×4 + butterflyfish ×7, spire angelfish ×4 + pufferfish ×3 → ~300 fish total
- UI/README: guide gains "Swim by hand" row + expanded free-swim keys; README rewrite of ecosystem/open-world/biome bullets + full swim-controls table (turn, strafe, palm steer, fist kick)
- Verified: tsc clean; headless boot initially failed on Biomes merge (index mismatch) → fixed toNonIndexed normalization → clean boot; DIVE IN → F → SWIM MODE chip + GLIDE paddle; held A/D show clear left/right view rotation in screenshots; W+Space glide/ascend reveals kelp forest, monolith silhouettes, surface waves and mixed schools; Esc/F exits cleanly; fresh reload = zero console/page errors
- Screenshots: download/ocean-open-1.png, ocean-swim-turnleft.png, ocean-swim-turnright.png, ocean-swim-forward.png, ocean-open-world.png

Stage Summary:
- The swimmer can now look/turn left-right with keyboard AND by sweeping the tracked hand; fist = forward burst
- The ocean grew ~2.4× wider with four biomes (coral gardens, kelp forest, boulder canyon, sand flats) plus northern spires — all landmarks procedural, ~300 fish, still one draw call per school and one for all static biome rockwork
- Ready to commit + push

---
Task ID: 8
Agent: main
Task: Model realism overhaul (fish v4, turtle, manta, corals) + feeding interaction; push with fresh PAT

Work Log:
- FishGeometryFactory v4 — bodies rebuilt as organic swept hulls (34 rings × 44 radial, asymmetric cross-sections: dorsal ridge pinching, keel flattening, mid-body lateral compression; welded seam normals); replaced 2-triangle tail + flat fin strips with true ray systems: 13-ray caudal fan with fork curve + scalloped trailing edge, 9-ray dorsal / 7-ray anal grids following the hull with membrane sag + ray-column shading, petal-shaped pectoral/pelvic fans with cup curvature; 4-layer eyes (socket shadow, sclera, species iris, pupil, glint)
- Textures 256→512px: two-layer scale plates, iridescent sheen bands, gill plates with ridged rays, bowed organic bands (angelfish/clownfish/moorish), clownfish band outlines, squirrelfish silver flank stripes, butterflyfish vermiculation rows, soft-edged spots; shared 512px scale BUMP map (neutral texel reserved for fins) wired via bumpScale 0.5; shader gains fin-tip flutter mask
- Bug: resample clamp `segs - 1.0001` → NaN for 2-point fin stations (butterflyfish/pufferfish/squirrel/minnow) AND truncated profiles short of the nose tip on every species → fixed to `Math.min(t, segs - 1e-6)`; verified via bun scripts/nan-probe.ts → 0 NaN across all 9 species
- SpecialCreatures v2 — turtle: scute canvas texture on carapace + marginal rim torus + plastron texture, neck, beak, eyes, paddle flippers (4 shaped, individual rotations), tail stub; manta: lathe fuselage core with thickness + cambered forward-swept wing sheets with leading-edge shading + cephalic fins + whip tail (merged, fixed missing color attribute crash)
- CoralSystem detail — branch corals: 7-seg tapered cylinders with organic bend + larger polyp tips; brain: dual-octave maze ridges + micro relief (26×17); table: substructure skirt, 28-seg disc with dual-frequency rim waves + radial ridges; fan: 11×15 segments; tube: darkened hollow opening rims
- Feeding system (new fish/Feeding.ts) — G key + pellets HUD button drops 11 crumb pellets ahead of the camera; pellets tumble, sink with drag + swirl, rest on seabed, expire ~15s; Boids gains pellet-seek steering (26u range, frenzy 1.55× speed, excited tail beats, first-fish claim → pellet shrinks away); FishManager/update plumbing + dispose
- UI: feed icon button, "G · feed" hint chip, guide row; README: feeding feature + realism bullets + controls row
- Verified: tsc clean; headless fresh boot → zero page errors, zero console errors; swim + turn + glide + feed exercised; screenshots curated (ocean-v4-reef-biomes / feeding / swim-kelp / pellets-seabed / approach)
- Push: commit + push to github.com/Muh-Adib/ocean-camera with user-provided PAT (one-off URL, not persisted)

Stage Summary:
- Fish read as smooth continuous organisms: asymmetric hulls, ray-finned tails/fins, bump-mapped scales, iris eyes — no more simple/flat shapes
- Turtle & manta no longer blob/flat-plane; corals gained organic bend, maze textures, hollow tubes, ridged tables
- New interactive highlight: feeding frenzy (G) — pellets sink, schools break formation and race, bites claimed on touch
- All previous behaviors (swim steering, biomes, camera paths) intact; zero runtime errors

---
Task ID: 9
Agent: main
Task: Fix fish eyes popping out of the body (user report: "mata ikannya seperti keluar dari ikan")

Work Log:
- Diagnosed 4 stacked defects in FishGeometryFactory eye/fPlacement math: (1) sclera sphere centred OUTSIDE the hull surface (+0.18r) so the whole eyeball floated external; (2) eyeR (0.042-0.068) larger than the local head half-width on thin species — angelfish eye was 2.6x the entire head width (frog-eye bulge); (3) eyeY = 0.07*h scaled with GLOBAL body height, landing the eye near the dorsal ridge on tall species where the flank pinches to ~zero; (4) pupil sphere fully nested inside the iris sphere (reach 0.98r vs 1.06r) so the pupil never rendered
- NEW root cause found via /dev-fish close-up viewer: hull rings span z ∈ [-L/2, +L/2] but stat() lookup used z/L*0.5+0.5 (half sensitivity) AND the eye was placed at z = +0.62L — 0.12L in FRONT of the nose tip, i.e. the eyeball floated in open water beside the snout; tail root at -0.86L also hovered 0.18L behind the hull
- Fixes: stat(z) = z/L + 0.5 (one coherent hull-space frame for every lookup); Hull.surfaceXAt(z,y) exact flank x incl. dorsal pinch; eyes re-seated at z=0.28L (station 0.78), y = 38% of LOCAL head height, eyeR clamped to 0.85x local head width, eyeball buried 45%r below the skin — visible part is a low dome wrapped by a dark socket rim; iris/pupil/glint offsets re-tuned so the pupil now breaks the iris surface; tail root moved to -0.46L inside the peduncle; pectorals moved to z=0.1L (station 0.6, just behind the gill plate — old station drifted onto the cheek after the stat fix); puffer spikes now shrink with cross-section height and skip the eye orbit
- Temporary /dev-fish viewer page used to screenshot all 9 species close-up (deleted before commit); eye metrics probed numerically via scripts/eye-probe.ts (all eyes <= 0.85 head width, ~52% dome exposure)
- Verified: tsc clean; all 9 species close-ups show seated eyes + connected tails/fins; live scene boots and renders schools with zero page errors (ocean-eyefix-reef.png)
- Git: reset stray auto-commit 400e616 before it could pollute history; .gitignore now excludes /download/, /tool-results/, /scripts/; commit authored Muh-Adib; pushed with user-provided PAT via one-off URL (not persisted)

Stage Summary:
- Fish no longer have ping-pong-ball eyes: eyeballs are embedded in the head with socket shadow, iris and (now visible) pupil, sized to each species' head
- Tail, dorsal/anal/pectoral/pelvic fins all share one coherent hull coordinate frame — nothing floats off the skin anymore
- Files: FishGeometryFactory.ts (stat/surfaceXAt/eye seating/tail root/pectoral z/spike seat), .gitignore, worklog.md

---
Task ID: 7-b
Agent: main agent
Task: kamera masih error + env detail; reconcile local work with the real remote lineage and push

Work Log:
- Discovered remote main (521a0be) holds a RICHER lineage from the prior session (ray-finned fish v4, scute turtle, 3D manta, feeding frenzy, SwimController, Biomes, WaterSurface) — local workspace was a stale orphan branch; force-push would have destroyed that work
- Adopted remote lineage: git reset --hard remote-main; verified its superset (bait-ball, ReefDecor, biomes already exist there)
- ROOT-CAUSED "kamera masih error": remote HandTracker still imported tasks-vision from jsdelivr CDN + model from storage.googleapis.com → any CDN/firewall hiccup kills camera start
- Ported the local-engine fix onto the remote lineage: static npm import (@mediapipe/tasks-vision 0.10.14), WASM → public/mediapipe/wasm, hand_landmarker.task (7.8 MB) → public/mediapipe/models; forVisionTasks local paths; kept remote's CameraFailure taxonomy, inflight dedup, timeouts, GPU→CPU fallback; package.json + bun.lock updated; zero CDN at runtime now
- Restored public/mediapipe assets from the amended stale commit after reset wiped tracked copies
- README: tech-stack row + privacy bullet updated for the fully-local engine
- Added QA hooks in main.ts (__ocean: fast/yaw/pos/fishCount/swimMode) matching remote's CameraRig/SwimController APIs
- Fixed tsc: FilesetResolver.forHandTasks → forVisionTasks (npm typings)
- Verified headless (agent-browser 480×320, swiftshader ~3fps): boot→intro→DIVE IN→HUD (226 fish), F free-swim toggle, keyboard D turn (yaw −0.111), camera failure panel "NO CAMERA FOUND" with TRY AGAIN, zero console/page errors

Stage Summary:
- Camera start no longer touches any CDN — works offline/restricted networks; failures still show specific reasons with retry
- Repo history preserved and extended (no force push); push is a fast-forward on the real lineage
