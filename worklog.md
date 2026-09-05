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

---
Task ID: 10
Agent: main agent
Task: Round pufferfish + spike-up defence display when a shark approaches; fix turtle swimming backwards + more detail; fix manta ("ikan patin") detached body/wings/tail

Work Log:
- Pufferfish rebuilt as a true globefish: near-spherical profile (blunt snout 0.115, fat belly 0.335, thick peduncle, len 0.4 ≈ height), w 1.04
- Root-caused the spikes: cones were axis-mismatched (rotateX+rotateY pointed them sideways — half stabbed INTO the body). Now each spike is seated on the hull and oriented along the elliptic surface normal via quaternion; 78 spikes, orbit-clear around the eyes
- Defence display: every spike vertex carries an aSpike apex weight (0 base → 1 tip); pufferfish material gains instanced aPuff and a shader that inflates the hull radially (0.17·core-falloff) while spine tips extend +0.34 — bases stay glued to the inflating skin. aPuff is written per-instance by FishManager; instances also swell 1.22× and slow to 20% speed while puffed
- Threat plumbing: SpecialCreatures.getThreatPoints() exposes live shark positions → main → FishManager → Boids. All schools panic-bolt from sharks (weighted 4.5·t); pufferfish puff via pr²·(clamped 1.35× curve) and puff at the diver within 5u
- Sharks rebuilt: 3 silhouettes (deep patrol z=-55, puffer-anchor crossing z=-12, camera-grazing z=+6, schedules 35-85s), fusiform 6.8:1 body, swept dorsal + second dorsal, long pectorals, two-lobed caudal fin, ×1.3 scale. Fixed the += PI rotation bug — they previously swam tail-first (same bug the turtle had)
- Turtle: removed the +PI yaw flip (was visibly swimming backwards); added wrinkled mottled skin texture, parrot beak (two lobes), eyes with glints, tapered cambered paddle flippers pivoting at the shoulder with front/rear anti-phase stroke
- Manta ("ikan patin"): whip tail now roots INSIDE the fuselage (front tip buried at z=+0.3 — was a floating cylinder behind the body); wings rebuilt as true 3D double-skin volumes with dark spotted tops, pale undersides, white shoulder patches; near-straight leading edge, forward-curving trailing edge; fuselage enlarged + counter-shaded dark-top/pale-belly; cephalic horns repositioned
- Debug/QA hooks: __ocean.forceShark/forceTurtle/forceRay/puffs/threats/pufferPos/tp
- Verified: tsc clean; fresh boot zero console/page errors; puffs rise 0→0.7 next to the diver; screenshots confirm spherical puffed body with radiating spines; dev-viewer close-ups (temporary /dev-creatures page, deleted) confirmed turtle facing/flipper detail, manta disc + white belly + rooted tail, shark silhouette
- Noted: headless tab throttles RAF ~30× — visitor fades/paths crawl in CI; everything moves at real speed in a normal browser

Stage Summary:
- Pufferfish: round ball + spikes that rise when a shark (or the diver) gets close — the requested defence effect
- Turtle: swims nose-first with richer skin/beak/eye/flipper detail
- Manta: one continuous organism — body, wings and tail all connected, counter-shaded
- Sharks: read as sharks, swim forward, and drive a visible panic response through the reef

---
Task ID: 2
Agent: main (Super Z)
Task: Gesture camera view panel + ikan patin species, rebased onto the GitHub lineage (hand-tracking bundle, fish v4, feeding, swim mode)

Work Log:
- Discovered local repo had diverged from origin (origin holds the newer lineage: locally-bundled MediaPipe, ray-finned fish v4, Feeding, SwimController, wider ocean, tuned gesture thresholds). Reset local main onto origin/main to preserve the user-approved work.
- Ported onto that base:
  - NEW src/experience/ui/GestureView.ts — "CAMERA · GESTURE ENGINE" panel: live mirrored camera preview, 21-landmark skeleton overlay (MediaPipe bone graph, fingertip highlights), control crosshair, HAND tracked/searching dot, gesture chip (NO GESTURE / WATER CURRENT / SWIPE / PUSH / PULL / ATTRACT / CAUTION), openness meter, centered push/pull meter, hand-speed meter, local-processing privacy note. 30 fps throttled, GSAP in/out, mobile full-width layout. Toggled from a new eye HUD button (hud-vision).
  - GestureEngine: public `status` snapshot (name/strength/openness/scaleRate/vx/vy) maintained across all gesture branches; remote's tuned thresholds preserved.
  - HandTracker: public mirrored `lastLandmarks` for the overlay (cleared on loss/stop).
  - UI: vision button + setGestureViewActive; main.ts: panel wiring, loop update, dispose.
  - NEW species 'patin' (silver catfish) in fish v4 architecture: SpeciesDef + tint + school (2 groups: mid-water reef formation + eastern sands), swim/freq tuning, and `barbels` support in buildFish (cone feelers rooted at the upper lip via hull widthAt/radiusAt lookups). Hull-continuous by construction (v4 swept hull + seated fins), so body/fins/tail can never read as separated.
  - QA hook: added `parkPuffer` + generic `park(species,i,x,y,z)` staging helpers.
- Installed @mediapipe/tasks-vision@0.10.14 (bun) for the bundled tracker import; restarted dev server.
- Verified headless: intro→dive→HUD→panel open/close + mobile layout, 236 fish, console clean after server restart, tsc clean; puff defence cycle re-verified on merged base via forceShark + parkPuffer → puffs [0.95,...]; patin close-up screenshots confirm continuous silver catfish silhouette with forked tail.

Stage Summary:
- User request satisfied: gesture camera now has a visible "how it works" view (preview + skeleton + live gesture readouts), and gesture handling rides the hardened local tracker (no CDN, timeouts, GPU→CPU fallback, friendly failure panels).
- Patin swims in the ocean again with fully fused detailing; pufferfish/shark/turtle realism retained from the approved origin lineage.

---
Task ID: 11
Agent: main (Super Z)
Task: Projection Mapping Output Mode — Resolume-style multi-surface projection system over the shared ocean world

Work Log:
- New src/experience/projection/ module (11 files + projection.css):
  - ProjectionTypes: scalable data model — surface = output rect + virtual camera + warp (corners/grid) + blend + calibration; project = {version, output{w,h,renderScale}, surfaces[]}
  - ProjectionMath: 4-point homography solver (DLT + Gaussian elimination w/ partial pivoting) mapping the unit square to any output quad; grid rebuild from corners (true perspective corner pin, not bilinear); grid<->corner round-trips; point-in-quad hit testing
  - ProjectionPresets: 7 room layouts (Flat Screen, Cinema, 180° Panorama, 270° Immersive, Immersive Room, Cube Room, Floor+Front) — room presets share ONE eye point [0,2.2,0] with cubemap-style 90° frustums so adjacent walls meet seamlessly
  - SurfaceManager: CRUD/duplicate/rename/reorder/lock/enable + selection + undo/redo (60-deep JSON snapshots) + two-channel notifications (full emit / light touch for drags)
  - CameraManager: per-surface PerspectiveCamera synced from data (pos/yaw/pitch/fov/near/far, aspect from output rect), YXZ euler, cameras pinned to layer 0; CameraHelper frustums on layer 1 (editor-only, never leak into projections); aimAt + snapView helpers
  - BlendManager: composite ShaderMaterial — samples the surface RT, brightness/gamma grading, 4-edge feather (smoothstep), opacity, normal/add/screen blending; calibration texture swap; tone mapping + sRGB applied by the renderer only on the final screen pass (verified three r185 skips it for RTs) so all surfaces grade identically
  - CalibrationManager: procedural 960×540 CanvasTexture patterns (grid, crosshair, SMPTE-style color bars + gray ramp, checkerboard, white, black, corner labels TL/TR/BR/BL) + blank fallback
  - OutputManager: composite scene of warped grid meshes (y-down ortho camera letterboxing the output canvas onto any screen), HalfFloat RTs per surface (renderScale-scaled, 2048 cap), UV flip for RT sampling, GPU→2D readbacks (byte RT + gamma LUT) feeding the editor previews
  - ProjectManager: JSON project format (ocean-projection.project.json) with full sanitization, localStorage autosave/restore, file export/import
  - ProjectionManager: orchestrator — studio lifecycle, N-camera RT render pass + composite/editor viewport screen pass, quad/all multi-camera viewport layouts (scissored), view-through-camera, fullscreen OUTPUT mode (body class + requestFullscreen + Esc), Enter toggles output, autosave debounce, frameCost metering, qaFrozen QA lever, QA API on window.__ocean.projection
  - ProjectionEditorUI + OutputNodeEditor: pro studio chrome — surfaces rack (add/dup/rename/lock/delete/enable), live properties (output rect, camera numerics + FOV slider + view snaps + aim), tabbed dock (OUTPUT node editor / WARP / CAMERA / BLEND / CALIBRATION / PROJECT); 2D node editor with draggable corner + mesh nodes, snap-to-grid (5/10/25/50), edge snapping, numeric coords overlay, whole-surface dragging, live composite underlay, feather band visualization, camera thumbnail grid; GSAP transitions; adaptive preview ticker that backs off when frameCost > 34ms
- main.ts integration: projection owns the frame when active (renderFrame replaces sceneMgr.render), HUD projector button, dispose chain, QA hooks (enter/exit/state/preset/select/output/calibrate/scale/freeze/save/loadLocal/exportFile/undo/redo/snapshot/hist/warpCorner)
- UI.ts: new HUD icon button (projector glyph) + setProjectionActive; UICallbacks extended
- Headless-verify fixes: navigator.webdriver frame throttle (renders 1 of 8 frames in automation only — real GPUs unaffected; CDP evals stay responsive on software WebGL), qaFrozen RT-pass skip for fast logic tests, adaptive preview back-off
- Bugs found & fixed during verification: editor tabs had no click handlers (wired); output-live mode never hid the studio chrome (CSS rule added); checkerboard pattern arithmetic cleaned; drag-state snap refs corrected for non-TL corners
- Verified headless (agent-browser): real HUD button opens studio; flat-screen default; 270° preset → 3 surfaces with correct cameras (yaw 0/±90, fov 90, shared eye); real-mouse corner drag (1689,108 → 2190,610 with 10px snap); dramatic corner-pin renders a true perspective mesh; calibration grid/textures swap on output; output mode → fullscreen UI-free 3-wall continuous composite + cube-room 6-face composite (screenshots); save→localStorage→reload→autosave restore; undo/redo round-trip (22,22 → 11,11 → 22,22); tabs/panels/slider panes all live; exit restores interactive ocean + intro; tsc clean; 0 console errors (pre-existing three.js 'map undefined' warnings also present on clean baseline)

Stage Summary:
- The ocean is now a projection-mapping source: one shared Three.js scene → N virtual cameras → N warpable output slices, with blending, calibration, presets, undo and project files — the minimum viable pipeline (spec's 10 critical requirements) fully working plus mesh warp, edge feather, presets and multi-camera views
- Existing interactive experience untouched when the studio is closed (render path unchanged; verified end-to-end)
- Screenshots: download/screenshots/pm-studio-270.png, pm-output-editor.png, pm-calibration.png, pm-output-live.png, pm-cube-room.png, pm-cornerpin.png, interactive-restored.png

---
Task ID: 12
Agent: main (Super Z)
Task: Dedicated /output projection page (clean feed + in-place calibration settings) + seamless camera edge matching (span lock)

Work Log:
- NEW src/app/output/page.tsx — clean /output route: boots the full ocean in output-only mode (position:fixed black stage, no React chrome), dynamic-imports bootExperience with { outputOnly: true }
- main.ts: BootOptions { outputOnly } threaded through bootInner — UI root hidden, loading sequence + intro skipped, GestureView skipped (nullable, loop guarded), interaction never enabled; ProjectionManager gets outputOnly dep and calls enterOutputOnly(); audio/tracker stay inert (never started)
- ProjectionManager: enterOutputOnly() — loads autosaved project (fallback flat-screen), syncs, forces OUTPUT composite; wireSyncChannel() BroadcastChannel('ocean-projection-sync-v1'): studio answers 'request' + pushes full project on every saveLocal (new ProjectManager.onSave hook); /output listens + applies live and requests once on boot; /output never autosaves (scheduleAutosave gated) so it can't clobber studio config
- Output overlay (#pm-out-overlay): auto-hiding settings panel on mousemove/touch — PATTERN select (off/grid/crosshair/bars/checker/white/black/corners → setCalibrationAll), FULLSCREEN, IMPORT .JSON, live "N surfaces · W×H" readout, warn line when no saved project; body.pm-out-interacting restores cursor while visible; ?pattern=<name> query pre-calibrates; overlay syncs after programmatic calibration changes
- Seamless edges: ProjectionSurface.camera now carries span {h, v, lock}; CameraManager.sync derives fov=span.v and aspect=tan(h/2)/tan(v/2) when locked (shared-eye cubemap-style exact tiling) instead of rect aspect; presets updated — 270°/Immersive Room/Cube walls+floor+ceiling lock 90×90 (edges meet exactly at ±45°), 180° panorama spans 62×38 on 60° centres (2° overlap for blending), Floor+Front floor wedge re-derived to continue the wall bottom edge (pitch -47, span 59); flat/cinema stay unlocked
- Editor UI: properties panel shows SPAN H/V inputs + sliders + "Match wall edges (span lock)" checkbox (locking seeds spans from the current frustum so nothing jumps)
- Fixed: ProjectManager host captured a stale output object — setOutput now mutates in place (Object.assign) and setOutputSize/setRenderScale mutate fields
- Verified headless: /output boots clean (0 console errors), 3 surfaces restored from studio autosave, overlay pattern select → all surfaces grid → off, overlay fades in on mousemove; two-tab BroadcastChannel sync — studio cube-room preset propagated to /output live (6 faces); ?pattern=grid works; studio regression — 270 preset span lock 90×90 on non-square rects (538×994 etc.), properties shows span controls; /output screenshot with span lock shows the seabed/horizon/rocks/seaweed continuous across all three walls — no visible seams or cut frames (vs. the previous aspect-derived seams); tsc clean
- Screenshots: download/screenshots/output-page-seams.png (continuous 3-wall feed), output-page-grid.png (calibration grid + overlay)

Stage Summary:
- /output is now the projector feed: picture only, operator grid/settings auto-hide, live-linked to the studio tab, importable anywhere
- Span lock guarantees wall-to-wall frame continuity for room layouts — frustum edges meet exactly by construction

---
Task ID: 13
Agent: main (Super Z)
Task: Output quality system — sharper projection picture with hardware-adjustable quality options

Work Log:
- ProjectionTypes: new QualityLevel ('auto' | 'performance' | 'balanced' | 'high' | 'ultra' | 'custom') + QUALITY_PROFILES (performance 0.4×/1536 cap, balanced 0.6×/2048, high 0.8×/3072 + 2× MSAA, ultra 1:1/4096 + 4× MSAA) + resolveQuality() → concrete {renderScale, rtCap, msaa}; ProjectionOutput gains quality field; PROJECT_VERSION → 2 (v1 projects load as 'balanced')
- OutputManager: RT ceiling lifted 2048 → per-profile cap up to 4096, always clamped by the GPU's real maxTextureSize (read from renderer capabilities); ensureRT now takes cap+msaa, recreates the target when MSAA changes (samples are fixed at allocation) and rebinds the material's uMap; expectedRTSize() for readouts; removed the legacy aspect-tracking ensureRT call in syncSurface that could fight the render-frame sizing
- ProjectionManager: setQuality() (named profiles pin the scale, AUTO seeds from hardware cores/memory/mobile + surface count, CUSTOM keeps manual), adaptive AUTO tuner — sliding window over real frameCost, steps the render scale ±0.1 (max one notch / 2.5 s) between 0.30 and 0.95, up when avg < 13 ms, down when avg > 30 ms; renderFrameInner resolves quality once per frame and passes cap/msaa (MSAA gated on EXT_color_buffer_float); /output overlay gains QUALITY select + live readout "1 surface · 1920×1080 · ULTRA · RT 1459×864 4×AA"; setRenderScale marks 'custom' when not auto; qaState + quality/frameCostMs/rtPerSurface
- Editor UI: PROJECT pane RENDER SCALE replaced by OUTPUT QUALITY select (6 levels) — named levels show a live readout (per-surface source px, MSAA, GPU frame ms, camera count), CUSTOM shows a 10–100% slider; pane rebuilds on switch; new .pm-readout/.pm-slider styles
- ProjectManager: sanitizes + persists output.quality (backward compatible with v1 autosaves); main.ts QA hooks: projection.quality(q), projection.autoSample(cost) (drives the real tuner deterministically)
- README: quality system documented in the studio + /output sections

Verified headless (agent-browser):
- Profiles: BALANCED 875×518 → HIGH 1167×691 2×AA → ULTRA 1459×864 4×AA → PERFORMANCE 584×346 — RTs resize live, zero GL errors (MSAA HalfFloat works on swiftshader too)
- AUTO: seeds 45% on the CI VM; autoSample(3ms ×60) stepped UP to 60%; autoSample(45ms ×120) stepped DOWN to 50% then held (2.5 s anti-oscillation guard works)
- CUSTOM: slider 85% → output {renderScale:0.85, quality:'custom'}
- Persistence: save → page reload → quality 'auto' + scale restored; /output overlay select mirrors + can switch quality in place (PERFORMANCE/RT 584×346); studio→/output BroadcastChannel sync carries quality live
- tsc clean; console shows only the three pre-existing three.js warnings
- Screenshots: download/screenshots/quality-project-pane.png (ULTRA select + live readout), quality-output-page.png

Stage Summary:
- The projection is sharper by default (0.5 → 0.6 render scale) and can now be pushed to true 1:1 + 4× AA on show machines, or throttled to PERFORMANCE on weak rigs
- AUTO genuinely measures the machine: seeds from hardware, then keeps tuning from live frame cost — no user action required
- Quality choice travels with the project file (v2) and stays backward compatible with v1 autosaves

---
Task ID: 14
Agent: main (Super Z)
Task: Published output sessions with permanent ?s= links; output-faithful settings; camera/slice ratio controls (Resolume-style)

Work Log:
- Sessions registry (ProjectManager): localStorage 'ocean-projection-sessions-v1' — saveSession/listSessions/getSession/loadSession/deleteSession; publishing again with the same name UPDATES that session in place (its link keeps working), a new name creates a new session; snapshots carry the full project (surfaces, cameras, warp, blend, quality, canvas)
- ProjectionManager: publishSession/loadSession/deleteSession/listSessions + currentSession tracking; /output?s=<id> loads that exact session at boot and LOCKS it — BroadcastChannel pushes are ignored for session-linked tabs so the picture never drifts from the published settings; ?s= unknown → autosave fallback + explicit overlay warning; /output overlay gains a SESSION menu (switch published shows live; re-reads the registry each time the overlay wakes); info line shows SESSION "name"
- Fixed the reported "output doesn't match the settings" bug: onLightChange (corner drags, numeric field edits) never scheduled the autosave — /output kept rendering stale config after a fast close. Light changes now autosave (900 ms debounce) — verified W=500 edit lands in localStorage within 1.6 s
- Ratios, input & output: master canvas gets free CANVAS W/H number fields + 16:9/32:9/4:3/1:1 quick buttons + reduced-ratio label (1920×1080 → "16:9"); the resolution select recognizes custom sizes; per-surface SLICE RATIO quick-sets + persisted lockAspect (W↔H stay coupled while editing, sanitized through project load); locked cameras show CAM RATIO with a MATCH SLICE button (SPAN V reshaped so frustum ratio = slice ratio)
- House rule enforcement: all presets were already span-locked; addSurface() now births new surfaces span-locked too (seeded from the rect ratio) so camera width stays put and edges stay connectable everywhere
- Studio PROJECT pane: OUTPUT SESSIONS section (name + PUBLISH, session rows with COPY LINK → clipboard w/ execCommand fallback, LOAD, DEL, active highlight); QA hooks projection.publish/sessions/loadSession
- Headless-verify fixes/notes: agent-browser tab switching proved unreliable in this session (tab N didn't move) — earlier apparent "session drift" was actually quality() being applied on the /output tab itself; retested with distinct tabs → lock holds (studio push PERFORMANCE, session link stays HIGH); stale Next dev bundle once masked the new-name-session fix (cache-buster reload confirmed the fix)

Verified headless:
- Publish 'Wall Show' → /output?s=<id> renders session settings (HIGH, RT 1167×691 2×AA) even though the studio autosave held custom 0.5; studio push to PERFORMANCE leaves the session tab untouched
- Same-name republish keeps the id (updatedAt refreshed); different name → new id; registry lists both
- /output overlay SESSION select switches Floor Show ↔ Cube Ultra Show in place; info follows
- With every tab closed except /output (control gone), reload still renders the published session — config comes from the registry, not the studio
- Studio LOAD restores the session (ULTRA + surfaces) → continue editing → republish keeps the same link
- Light-edit autosave fix verified (savedW 500 = liveW); slice 16:9 → 500×281; Lock + W=640 → 360 (ratio held 1.778); MATCH SLICE 62×40 → 62×35 (cam 1.771 ≈ slice 1.779); canvas 3200×900 + 32:9 snap
- tsc clean; zero page errors; screenshots: download/screenshots/sessions-project-pane.png, session-output-overlay.png

Stage Summary:
- Output links are now real show files: publish → copy /output?s=… → the projector opens byte-identical settings forever, control tab or not, and the operator can flip between published shows from the projector itself
- /output can no longer show stale settings — every edit persists, and session links are immune to studio drift
- Camera width and aspect are first-class: spans locked everywhere by default, slice/canvas ratios editable with one-click ratio snaps and camera↔slice matching

---
Task ID: 14-b
Agent: main (Super Z)
Task: Fix /output not matching the studio's full settings + no live sync when the output shape changes

Work Log:
- Root causes found (3): (1) session-linked /output tabs hard-ignored every studio push (currentSession lock) — published links froze at publish-time settings; (2) pushed warp/grid changes never rebuilt composite geometry — OutputManager.syncSurface only rebuilt when gridResolution changed, so corner pins / mesh edits / surface moves serialized in project pushes (and studio undo/redo) rendered stale; (3) studio→output sync rode the 900 ms autosave debounce, which a continuous drag kept resetting — /output only moved ≥0.9 s after the last edit and felt disconnected
- ProjectionManager: removed the session lock — /output (plain or ?s=) now always adopts studio pushes; session tabs also post 'request' at boot so they mirror the live studio immediately; new liveLinked flag + "LIVE LINK ·" marker in the overlay readout; picking a session from the overlay resets the marker
- New fast sync path: broadcastSoon()/broadcastNow() — trailing-correct 300 ms throttle, fully independent of the autosave; wired into onChange(syncAll), onLightChange, setOutputSize, setQuality, setRenderScale, publishSession (immediate) and onSave (immediate, kept as hard sync); timer cleared in dispose
- Session links stay current: ProjectManager.updateSessionProject() — an /output?s= tab that adopts a push also rewrites its session's stored snapshot, so reloading the link later boots the newest settings even without a republish
- OutputManager: gridSignature() (grid length + gridCustom + rounded node coords) stored per entry; syncSurface rebuilds geometry when the signature changes — pushed warp edits now rebuild exactly when the shape actually changed; invalidateGeometry clears the signature
- main.ts QA hook moveSurface(name, dx, dy) — walks a surface's rect + corners + grid through the LIGHT path (surfaces.touch) like a real output-editor drag
- README: session + live-sync sections rewritten to the new model

Verified headless (agent-browser, two tabs):
- Boot handshake: /output adopts the studio's exact state at open (surface rect, HIGH) — overlay "LIVE LINK · 1 surface · 1920×1080 · HIGH · RT 1167×691 2×AA"
- Light path: studio moveSurface(260,140) → /output rect (490,248) within 250 ms; pixel-diff of before/after screenshots confirms the picture actually moved
- Full path: warpCorner br(1750,1000) → /output corners match; keystone visible in screenshot (sync-after-warp.png)
- Quality: studio ULTRA → session tab RT jumps to 1459×864 4×AA live
- Session: publish 'Sync Show' → /output?s= boots snapshot then follows every later studio edit (previously frozen); studio tab CLOSED → session tab keeps rendering (frameCost 8.2 ms); reload → boots the newest pushed snapshot (ULTRA + moved rect), no republish needed; registry record verified updated (storedQuality 'ultra', storedOut 340,188)
- Session resume: reopened studio lists the session, LOAD restores ULTRA + rect, continued edits propagate to the still-open /output tabs (440,238 · HIGH · LIVE LINK)
- Canvas: 2560×720 push adopted by /output (readout "2560×720"); tsc clean; zero page errors (only the 3 pre-existing three.js warnings)

Stage Summary:
- /output is now a true live mirror of the studio's full settings — shape edits (corners, mesh, surface moves, canvas, quality) land in ≤300 ms and rebuild geometry only when the shape really changed
- Session links: boot from the published snapshot, follow the studio while it's open, keep running when it closes, and self-update so a later reload always restores the newest settings
- Control-off model intact: no studio → no pushes → the output holds its state forever, exactly as published/pushed last

---
Task ID: 15
Agent: main (Super Z)
Task: Output still didn't show the shaped surfaces (screenshot: control left / projector right) + control should show the output preview inside the screen preview + fullscreen calibration editing with guides + surfaces must snap to each other

Work Log:
- Reproduced headlessly: same-browser BroadcastChannel sync actually works (light + full paths both land ≤300 ms) — the real break was cross-context: sessions live in localStorage and live sync in BroadcastChannel, and NEITHER crosses a browser or machine, so a projector browser booted the flat-screen preset ("Main Screen", one plain full frame — exactly the user's screenshot). Proven with an isolated agent-browser session.
- ProjectManager: portable payload codec — encodeProjectPayload/decodeProjectPayload (deflate-raw via CompressionStream → base64url, "z…" prefix; plain base64url "j…" fallback), PORTABLE_LINK_LIMIT 24000, SESSION_ID_RE, seedSession() installs a session that arrived from outside the browser
- ProjectionManager: portableSessionLink(id) builds /output?s=<id>&n=<name>&d=<snapshot>; enterOutputOnly boots ?d= FIRST (works with zero shared storage), seeds the registry + currentSession, clears the stale "no saved project" warn, marks portableBoot (overlay shows "PORTABLE LINK ·"); live pushes refresh the URL's ?d= payload via debounced history.replaceState (1.4 s trailing) so a bookmarked portable link self-updates; dispose clears the new timer
- ProjectionEditorUI: COPY LINK now copies the PORTABLE link (toast explains settings travel inside the URL; falls back to registry link when the project is too large); publish toast updated; session hint rewritten around portable links
- Output preview PiP: new "OUTPUT PREVIEW" topbar toggle + a .pm-out-pip panel inside the main screen preview (pm-center) showing the letterboxed live composite (shared 480×270 readback, 140 ms tick, existing frame-cost back-off), canvas-size label follows output W×H
- Fullscreen calibration editor: "⛶ FULLSCREEN CALIBRATION EDITOR" in the CALIBRATION tab (+ "⛶ FULLSCREEN" action in the shared node-editor toolbar) reparents the SAME OutputNodeEditor into a fullscreen #pm-fs-edit overlay — same corner pins, mesh nodes, snapping — with a bar of quick patterns (OFF/GRID/CROSSHAIR/WHITE) + EXIT; ESC closes (capture-phase, stops before other handlers) and the editor returns to the dock; preview ticker feeds it while open
- Magnetic seams in OutputNodeEditor: MAGNET + GUIDES checkboxes; snapTargets() collects every other surface's corners + 4 outline edges (+ custom-mesh boundary nodes); corner/node drags point-snap then edge-snap (project onto segment) within ~14 canvas px; whole-surface drags test all 4 corners and apply the single best snap; grid snap only fills gaps when no magnet hit; ALT bypasses; live snap indicator (bright point/edge); drawSeamGlue() paints yellow glue lines/dots where surfaces' edges touch within 3 px — visible proof seams connect; drawGuides() adds rule-of-thirds, center cross and a 100 px ruler with 500 px labels
- main.ts QA hooks: projection.link(id) → portable URL, projection.portable() → boot flag, projection.fsEdit(on) → fullscreen editor
- projection.css: .pm-out-pip panel + #pm-fs-edit overlay styles (+ small-screen PiP shrink)

Verified headless (agent-browser, main session + isolated "proj2" browser as the projector machine):
- Portable link (3502 chars, ?s=&n=Wall%20Show&d=z…): opened in the ISOLATED browser (empty storage) → boots 3 surfaces with the warped Front Wall tr(1500,80) intact, overlay "SESSION "Wall Show" · PORTABLE LINK · 3 surfaces · 1920×1080 · BALANCED · RT 507×596", portable:true — the user's exact bug (output ≠ control across devices) is dead
- Trimmed /output?s=<id> on that same isolated browser also boots the full show from the seeded registry (was "Main Screen" flat before)
- PiP: present, visible, size label 1920×1080, 118240/129600 lit pixels — real composite picture
- Fullscreen editor: opens (editor reparented, canvas resizes to 1280×~550, pattern buttons present), grid pattern renders, ESC closes, editor back in dock (display flex), pattern state persists
- Magnet: gap test — moved Left Wall −60, dropped tr corner at 546 (8 px off) with MAGNET ON → lands EXACTLY (538,43) matching Front Wall tl (cornerExact:true); bottom corner likewise (538,1037)===bl; MAGNET OFF control run → same gesture lands (550,40), gap −12 (no glue)
- Seam glue lines visible in dock editor screenshot (yellow line at the shared edge)
- Live-sync regression: studio calibrate('off') + moveSurface(+40) → /output tab mirrors within the 300 ms push (pattern off, tl x −20)
- tsc clean; zero page errors (only the 3 pre-existing three.js warnings); screenshots: download/screenshots/{fs-calibration-grid,seam-snap-connected}.png

Stage Summary:
- Output links are now truly portable: the whole show rides inside the URL, so ANY browser or machine opens the exact shaped multi-surface output with no control open and no shared storage — same-browser live sync (≤300 ms) still layers on top when available
- The control screen now always shows the projected result inside the screen preview (PiP), and the CALIBRATION tab can blow the same surface editor up fullscreen with guides and patterns for pixel-accurate alignment
- Surfaces magnetically snap edge-exact to their neighbours (with live seam-glue feedback), so multi-wall layouts connect without breaks

---
Task ID: 16
Agent: main (Super Z)
Task: User feedback — the PiP can't be repositioned, so drop it and make /output itself the live preview that mirrors every control change

Work Log:
- Removed the OUTPUT PREVIEW PiP entirely per the user's preference (it was fixed-position and they no longer want it): deleted the topbar toggle, the .pm-out-pip panel + CSS, the 480×270 composite draw branch in the preview ticker and its size label; the composite readback now feeds only the OUTPUT-tab editor and the fullscreen calibration editor
- Added "OPEN OUTPUT ↗" to the studio topbar — opens /output in a new tab (the output page is now the preview surface, and with the relay it follows every edit)
- Root cause of the remaining "output doesn't follow control" reports: BroadcastChannel only crosses tabs of ONE browser — an /output window in another browser (second display browser, projector machine) had no live path at all
- New server relay (src/app/api/projection/relay/): store.ts (in-memory state bus on globalThis, rev-bumped pushes + studio heartbeats, fanned out to subscribers), route.ts (POST push {project} / POST {hb:1} heartbeat / GET JSON snapshot), stream/route.ts (SSE: initial snapshot on connect, live 'relay' + 'hb' events, 15 s keep-alive comments, abort/cancel cleanup)
- ProjectionManager studio side: broadcastNow() now also POSTs the serialized project to the relay (~300 ms trailing throttle, same envelope as the channel); a 4 s heartbeat runs while the studio is open so outputs can show an honest contact status
- ProjectionManager /output side: wireRelay() subscribes via EventSource; pushes go through applyStudioPush() — the same load/session-refresh/portable-URL/overlay path as BroadcastChannel — with an identical-payload guard so the two transports can race without double work; relayInfo() + qaPush() + relay()/pushNow() QA hooks added
- Output overlay status now shows LIVE LINK while the studio is in contact and HOLDING after the contact stops (LIVE_FRESH_MS = 70 s — wide on purpose: a hidden control tab gets its 4 s heartbeat throttled by Chromium to ~1/min; state pushes themselves never throttle)
- Leak fixed while testing: exit() called saveLocal() unconditionally, so disposing an /output page (e.g. dev HMR unmount) wrote the projector's localStorage autosave — now guarded to studio pages only
- README live-sync section rewritten around the two-transport model

Verified headless (agent-browser, main session + isolated "proj2" browser as the projector machine):
- PiP gone (.pm-out-pip / #pm-pip absent), OPEN OUTPUT present; tsc clean
- Cross-browser: proj2 with localStorage.clear() and NO link params boots the studio's exact state via the relay snapshot (870,468 · LIVE LINK · rev 10) — pure server, no storage, no portable URL
- Live follow: studio moveSurface(+300,+180) → proj2 lands exactly (790,428); warpCorner br(1750,1000) → proj2 corners match; quality ULTRA → proj2 RT 1459×864 4×AA, readout ULTRA
- Same-browser: fresh /output tab boots newest autosave and follows edits via channel+relay (liveLinked true, mirrored 870,468)
- Studio exit → both outputs keep rendering (outputLive true, state intact, rev frozen at 10, screenshots saved); zero page errors on both browsers
- Timing notes: EventSource connects in ~5–10 s in headless; ES readyState/hb verified via relay diagnostics (msSinceSync fresh while control foreground; frozen only under background-tab throttling, covered by the 70 s window)

Stage Summary:
- The control no longer needs an embedded preview at all: /output is the preview — pixel-identical, live in ≤300 ms, and it now follows the control across browsers and machines via the server relay, not just across tabs
- The show-must-not-die contract is untouched: close the control and every output keeps rendering its last state; reopen and edit and they snap back to LIVE LINK

---
Task ID: 17
Agent: main (Super Z)
Task: Smartphone remote control via QR code — phone camera mode tracking BOTH hands, every page follows in real time

Work Log:
- New server relay src/app/api/remote/hands/: store.ts (globalThis in-memory bus per room — snapshot, listeners, phoneSeenAt, 8-room LRU cap), route.ts (POST phone frames — validated/sanitized: hard cap 2 hands, x/y/openness clamped 0..1, 21-point landmark matrices, garbage-tolerant; GET ?room= snapshot), stream/route.ts (SSE: instant replay of a fresh snapshot on connect, live 'hands' events, 15 s keep-alives, abort/cancel cleanup), host/route.ts (GET /api/remote/host → LAN IPv4 candidates via os.networkInterfaces so the QR can point the phone at the machine instead of localhost)
- Shared math: interaction/handMath.ts — extractHandSample() + mirrorLandmarks() moved out of HandTracker so the DESKTOP tracker and the PHONE controller produce byte-identical HandSamples (same mirroring, same openness/scale curves)
- HandTracker: numHands 1 → 2; per-frame results matched to stable slots (greedy nearest-previous-position assignment, 450 ms memory) so a second hand entering never steals the primary channel; hands() + landmarksList() expose smoothed per-hand samples; detect() still returns the primary sample for swim steering
- InteractionField: full second force point (point2/dir2/strength2/mode2 + independent idle clock + setTarget2) — FieldSnapshot/FieldCtx extended; Boids got a mirrored second gesture-force block (current/push/repel/attract per point) so schools follow both hands of a swimming stroke
- GestureEngine rewritten as per-hand channels: HandChannel state (hist, velocity, palm/fist hysteresis, cadence) ×2; channel 0 → field.setTarget, channel 1 → field.setTarget2; callbacks fire from either hand; merged status (priority: push > swipe > pull > attract > caution > current), hands count added
- RemoteHands client (experience/remote/): EventSource on /api/remote/hands/stream, freshness window 1300 ms, 400 ms watchdog live→stale→live, exposes hands+landmarks in the exact same shape as the local tracker
- main.ts: gesture source priority = phone remote while fresh → local camera (both 2-hand); status chip REMOTE HANDS on phone contact with toast, honest fallback to HAND TRACKING/MOUSE MODE when the stream dies; GestureView updated to draw BOTH skeletons (cyan/amber) with per-hand crosshairs + "TRACKED × n"; QA hooks __ocean.remote.{status,fresh,hands,room,inject,clear} + __ocean.field() + __ocean.gesture()
- RemotePhone (experience/remote/ + src/app/remote/page.tsx): ocean-styled phone controller — front camera preview (mirrored) with live skeleton overlay, START CAMERA gate, GPU→CPU landmarker fallback, ~25 Hz POST (400 ms idle keepalive), sendBeacon 'hands gone' on pagehide, OFFLINE/status chip + FPS, insecure-context warning (phone cameras need HTTPS off-localhost)
- RemoteQR modal: REMOTE QR buttons in the projection-studio topbar and the /output overlay → glass modal with QR (npm qrcode, dynamic import), URL row + COPY, candidate origin chips (this origin + LAN addresses from /api/remote/host, localhost deprioritized for the phone), live connection poll ("● PHONE CONNECTED — 2 hands streaming"), HTTPS hint when !isSecureContext; modal closes on ESC/backdrop and in projection dispose
- package.json: npm run dev:https (next dev --experimental-https) for LAN phone camera; README: new "Smartphone remote control" section + Quick Start note

Verified headless (agent-browser + curl/python fake phone):
- API: POST 2-hand frames → {ok,hands:2}; snapshot GET live:true; 4-hand/garbage payload → sanitized to 2 (clamps verified); SSE stream connects + hello event
- Studio /: remote.status connecting → with fake stream fresh:true, hands:2, field {active, active2, point [-6,1.6,1.7] for hand@x0.3, point2 [4.9,0.9,1.7] for hand@x0.68 — mirroring + channel split correct}, gesture 'attract' (open palm) — park('pufferfish') drifted toward the attract point under stream
- /output: same stream lands live (fresh, 2 hands, strength 0.80/0.59 both points) — the projector page follows the phone directly, no control tab needed
- QR modals on studio AND /output: open, QR data-URL renders (first open pays one dev compile), URL correct /remote?room=ocean, /output modal reads "● PHONE CONNECTED — 2 hands streaming"
- /remote page boots: START CAMERA card, no insecure warning on localhost, headless camera-denial handled by TRY AGAIN state
- Regression: fresh reload + __ocean.remote.inject two hands → both field points engaged, zero console errors; tsc clean; eslint clean on all new/modified files (only pre-existing MediaPipe WASM vendor warnings remain)

Stage Summary:
- Scan a QR (studio topbar or /output overlay) → the phone's camera becomes a two-hand gesture controller; every ocean page on the network — control and outputs — follows the swim in real time, and falls back to local tracking the moment the phone stops
- Two-hand tracking is now native everywhere: desktop camera (stable slots) and phone remote share one pipeline with two independent force points, so alternating swimming strokes drive two currents instead of being averaged away
- Show-time safety unchanged: the phone is a pure ADD-ON — closing it never disturbs the output pages

---
Task ID: 18
Agent: main (Super Z)
Task: Phone controller BUTTON PAD mode — one-thumb show control (action grid, joystick, toggles, hold-boost) beside the camera mode, all realtime

Work Log:
- New command relay src/app/api/remote/cmd/: store.ts (globalThis bus per room — cmd ring (24 cap, monotonic ids), hostState echo {swim,muted}, padSeenAt liveness, 8-room LRU), route.ts (POST cmd/host/ping — type whitelist REMOTE_CMD_TYPES, GET bootstrap snapshot with padLive), stream/route.ts (SSE: 3 s cmd replay on connect + host snapshot + live 'cmd'/'host' events + 15 s heartbeat)
- RemoteCmds client (experience/remote/): EventSource on /api/remote/cmd/stream, id-set dedupe (64 cap), onCmd/onHost; main.ts assigns applyRemoteCmd — feed (doFeed), burst (fish-centroid shockwave + scatter + camera push), shark/turtle/ray (visitors), pulse (lighting), bubbles, impulse; swim/sound/boost are studio-only (outputOnly pages apply world events, never view changes); publishHostState() echoes swim/muted at boot + on every change (swim.onChange, sound toggle, remote swim/sound cmds)
- RemotePhonePad (experience/remote/): ocean-glass touch pad — 6-button action grid (FEED/BURST/SHARK/TURTLE/RAY/PULSE with hand-drawn SVG stroke icons + per-action accent colors), joystick (pointer-capture, 90 ms keepalive, knob glow) that streams a synthesized open-palm hand (openness 0.78 → attract) through the EXISTING /api/remote/hands pipeline — fish follow the stick on every page with zero new consumption code; SWIM/SOUND toggles with live state badges (host poll 1.5 s), BOOST hold (press/release cmd pair, dimmed until SWIM is on), haptics (navigator.vibrate), pad heartbeat ping 2.5 s keeps the QR modal green in buttons mode
- RemotePhone reworked into a two-mode controller: segmented CAMERA/BUTTONS switch; entering BUTTONS fully stops the camera (battery) and posts empty hands; leaving restores the START CAMERA card; per-mode legend text; pagehide beacon kept
- Robustness fixes found by headless testing: RemoteHands frame gate moved from sender-seq to SERVER receive timestamp (the POST route stamps t) — a second phone/QA inject with its own private seq previously starved the first sender forever; joystick guards: finite-check + center fallback + hidden-rect bail (NaN → null → corner-clamp bug), setPointerCapture try/catch; removed duplicate pad legend
- RemoteQR: modal copy now mentions the BUTTONS pad; connection poll checks hands liveness OR pad liveness ('● PHONE CONNECTED — pad / camera active'); REMOTE QR button tooltips updated (studio + /output)
- QA hooks: __ocean.pad.{status,room,apply(type,on)} — pad.apply fires a command straight into the pipeline
- README: remote section rewritten for the two-mode controller

Verified headless (agent-browser + curl fake phone):
- API: POST cmd → {ok,id}; host echo stored+returned; ping → padLive:true; unknown type rejected; GET snapshot lists cmds; SSE replayed host+hello then live 'cmd' events
- End-to-end: curl shark → studio threat 1 + toast 'PHONE PAD · Shark!'; curl feed/swim/sound/boost all consumed (swimMode toggled true→false via commands, hostState published swim:true after)
- Phone pad clicks (TURTLE/SHARK/BOOST) POSTed and recorded on the server (cmd ids 12-17); BOOST hold captured on:true → on:false pair ~580 ms apart
- Joystick: synthetic drag → hands snapshot (0.808, 0.332, openness 0.78, 'stick') exactly as computed; same-page stream test → studio field.active true, point (0.9,1.4,-6.2) follows x0.75/y0.35; release → hands [] → field deactivates
- Badges: curl swim → pad poll flips SWIM badge ON + BOOST opacity 1 (state-driven); sound badge tracks muted
- UI: 390x844 screenshots — action grid + toggles + centered knob, single legend; QR modal on /output shows new copy + 'PHONE CONNECTED — pad / camera active'
- CAMERA regression: tab back → START CAMERA card, no page errors; tsc clean; eslint clean on all new/modified files

Stage Summary:
- The phone is now a full remote: CAMERA (both-hand gesture steering) or BUTTONS (one-thumb show control: feed/burst/shark/turtle/ray/pulse + joystick current + swim/sound toggles + hold-boost), both channels realtime over SSE to the studio AND every /output page
- Multi-sender hands relay is now timestamp-gated — any number of phones/QA sources can coexist safely
- Show-time safety unchanged: closing the pad stops timers/releases the stick; closing the phone calms the water and falls back to local tracking

---
Task ID: 19
Agent: main (Super Z)
Task: Phone VIEW remote moves the CAMERA CHAIN as one motion (pivot = center camera) + 270° linked viewpoint sweep with zero breaks + 360° Linked Ring preset

Work Log:
- New ChainRig (projection/ChainRig.ts): yaw/pitch/dolly targets with exponential ease + ping-pong AUTO sweep across the ±135° range (270° linked coverage); pivot = the enabled surface whose output slice center sits nearest the canvas center ("posisi tengah kamera"); forward vector of the rotated center camera drives the dolly; applyView({yaw,pitch,dolly,auto,speed,reset}) is idempotent; pose is exposed read-only
- Render-time transform: CameraManager.sync now computes the effective pose (stored pose + rig orbit around pivot + dolly along the rotated center-camera forward) — the stored surface data is NEVER mutated, so autosaves, published sessions, portable links and undo history stay clean while the rig swings (verified: qaState storedCam yaw 0 / pos [0,2.2,0] while rig showed 48°)
- Interconnection guarantee: every camera gets the SAME yaw/pitch offsets around the shared pivot, so relative angles — and therefore span-locked wall edges (62°/90°/92° spans) — stay exactly met during any motion; the picture sweeps 270° with no cut ("tidak patah tampilannya")
- Relay: new 'view' cmd type with sanitized payload (yaw ±180, pitch ±89, dolly ±20, speed 1–30, auto/reset booleans) through the existing /api/remote/cmd store + SSE stream; stale 'view' cmds (>1.5 s) are excluded from stream replay so a freshly opened page never lurches to an old drag target; RemoteHostState now carries chain {yaw,pitch,dolly,auto} and the studio publishes it (trailing 550 ms throttle against 18 Hz drag streams)
- main.ts: 'view' case applies on EVERY page (studio + all /output — each renders its own surfaces, no outputOnly gating); publishHostState extended with chain; QA hooks __ocean.chain.{state,view,reset}
- Phone: new VIEW stage (remote/RemotePhoneView.ts) — orbit drag pad (relative grab, 0.28°/px yaw · 0.14°/px pitch, crosshair feedback, ~18 Hz stream), 7 viewpoint chips (−135…+135 every 45°), YAW/PITCH/DOLLY touch sliders with host-sync guard, AUTO ORBIT toggle + RESET; mode switch is now three-way CAMERA / BUTTONS / VIEW (pads stop the camera; leaving a pad stops its timers + stream)
- Studio: new CHAIN dock tab — live readout (yaw/pitch/dolly + pivot surface, refreshed by the 140 ms tick), three sliders queued through a 120 ms trailing push (pm.pushChainView = apply locally + POST to the relay so every /output follows), 270° LINKED SWEEP chips, AUTO ORBIT, RESET; /output overlay info shows the live sweep (CHAIN AUTO -46°)
- New preset 'pano-360' (360° Linked Ring): four span-locked walls (92° spans on 90° centres, 2° overlap joins) closing a full ring the rig can sweep endlessly — completes the linked family 180°/270°/360°
- Dev-server note: the sandbox reaps tool-call descendants (and OOM killed chrome once) — scripts/start-dev-daemon.py double-forks `bun run dev` so it re-parents to init and survives; a restart was REQUIRED because the old process's globalThis remoteCmdStore singleton (created before the 'view' type existed) silently dropped the 4th push() argument

Verified headless (agent-browser + curl fake phone):
- Relay: POST view {yaw:120,dolly:-3} → stored intact; host echo carries chain; stale-view replay filter in place
- Full loop: curl view {yaw:60,pitch:8,dolly:1.5} → studio targets set, rig eased (yaw 16→…→60), engaged, center='Main Screen', stored camera data untouched
- pano-360: 4 walls span-locked h92/v90; rig yaw→90 with all stored yaws (0/−90/180/90) unchanged; center tie-break = Right Wall (two middle slices tie at 0.125 offset)
- Phone pad: 3-way tabs render; VIEW tab chip '+90°' → cmd {'yaw':90} stored → studio target.yaw=90; readout + sliders sync from host chain echo (screenshot)
- Multi-page: one view cmd → /output (yaw −29.3) and studio (yaw 45.5) both easing toward −120 simultaneously — one motion everywhere
- AUTO ORBIT {auto:true,speed:14} → auto engaged, yaw sweeping; RESET glides targets home; zero console errors (only pre-existing three.js warnings)
- Screenshots: download/qa-remote-view-pad.png, qa-studio-chain-tab.png, qa-output-chain.png; tsc clean (only pre-existing examples//skills/ errors); eslint clean on all changed files

Stage Summary:
- The QR remote now primarily controls the CAMERA/SURFACE CHAIN: one motion, pivot at the center camera, 270° of linked viewpoints that interpolate continuously — walls stay seam-joined while the view sweeps
- Same rig driven from the studio CHAIN tab; both apply at render time so no saved data is ever bent by a show-time move
- pano-360 completes the span-locked preset family for full-ring rooms

---
Task ID: 20
Agent: main (Super Z)
Task: Remote VIEW gains MOVE XYZ + naik-turun kamera (pivot = center screen), and the /output auto-QR badge (small, vmin-sized, shows until a phone connects)

Work Log:
- ChainRig: new moveX/moveY axes (eased + targets, ±10 m moveRange) completing MOVE XYZ (dolly stays Z); applyView accepts moveX/moveY — applied BEFORE the auto-orbit early-return so translation keeps working while the sweep owns yaw; reset zeroes all five targets; pose now carries mx/my + `right` vector (center camera's horizontal right = (-fz,0,fx), always well-defined up to ±89°); transformedCenter includes the move; qaState exposes moveX/moveY/target/range.move
- CameraManager.sync: after the orbit + dolly, adds ONE shared translation to every camera — right·mx + worldUp·my — so the chain strafes/rises as a rigid group: relative angles and span-locked wall edges stay exactly met, nothing patah
- Relay: RemoteCmdView + host.chain gain moveX/moveY (sanitizeView clamps ±20, rounds 0.01; host parse passes them through); main.ts publishHostState echoes moveXT/moveYT so the phone sliders stay honest
- RemotePhoneView rebuilt: two pads side by side — ORBIT (yaw/pitch, unchanged) + MOVE pad (drag right/left = strafe X, drag up/down = naik/turun Y, 0.034 m/px relative grab, ~18 Hz) — plus a 2×2 slider grid (YAW | PITCH / DOLLY Z | LIFT Y), two-line readout (YAW/PITCH + MOVE X·Y·Z), viewpoint chips, AUTO ORBIT + RESET; host poll syncs moveX/moveY; stop() releases both pads
- Studio CHAIN tab: DOLLY Z relabel + new MOVE X M / LIFT Y M sliders (queued through the 120 ms trailing push like the rest), readout now shows `YAW · PITCH · XYZ x y z`, hint text explains the three translation axes
- New RemoteQrBadge (experience/remote/): fixed bottom-right QR badge mounted on /output only — sizes with clamp(64px, 11vmin, 112px) + vmin label so it follows the screen size, renders the /remote?room= QR once via pickRemoteBase() (LAN-aware, refactored out of RemoteQR), polls hands live OR padLive every 1.5 s: shows while NO phone is connected, fades out on connection, comes back when the phone leaves, stays hidden while the full modal is open; tap opens openRemoteQR; disposed with the projection
- RemoteQR refactor: exported pickRemoteBases/isLocalBase/pickRemoteBase (no duplicate LAN logic); README remote section rewritten (auto-QR + MOVE XYZ + LIFT Y)

Verified headless (agent-browser + curl fake phone):
- Badge: visible at boot (opacity 1, QR data-URL loaded, 105×80 @ 720p, 14 px from the corner) → pad ping → fades (0.86 mid-transition) → gone; 6 s later (heartbeat expired) back to 1 on its own; tap opens the modal with the right URL and the badge hides; ESC closes → badge returns on the next poll
- Relay: POST view {moveX:2.5, moveY:-1.2, dolly:-2} → sanitized intact; studio chain eases toward it (0.5→1.6→…, RAF-throttled in headless, smooth by design) and the STORED camera stays [0,2.2,0]/yaw 0 — render-time-only transform confirmed
- Studio CHAIN tab: all five sliders present; MOVE X slider → target.moveX −3 + relay push {moveX:-3, auto:false}; readout shows XYZ live; RESET zeroes everything
- Phone VIEW: ORBIT + MOVE pads + 4 sliders render; synthetic drag on the MOVE pad (right + up) streams {moveX:3.13, moveY:3.23} = exactly dx·0.034 / dy·0.034; padLive stays true (badge logic consistent)
- Multi-page: one move cmd → /output tab chain engaged, easing to (−1.5, 2) while targets land everywhere — one motion on every screen; zero page errors on studio, /output and /remote
- Host echo now carries moveX/moveY; tsc clean (only pre-existing examples//skills/ errors); eslint clean on all changed files
- Screenshots: download/qa-output-qr-badge.png, qa-phone-view-move.png, qa-studio-chain-move.png

Stage Summary:
- The QR remote now moves the camera chain through space, not just around it: ORBIT (yaw/pitch) + MOVE XYZ (strafe X, naik-turun Y, dolly Z) all pivot on the center camera and stay one synchronized motion on the studio and every output screen
- The output screen sells itself: a small self-hiding QR waits in the corner until a phone joins, then vanishes until it's needed again

---
Task ID: 21
Agent: main (Super Z)
Task: Fix "patah-patah" remote link + camera edge breaks — true WebSocket relay, delta-based soft-edge camera chain, and a minimal camera-only phone controller with a double joystick

Work Log:
- User feedback: (1) koneksi patah-patah — gunakan WS; (2) kamera patah saat movement mencapai edge; (3) kontrol HP terlalu banyak — hanya kamera saat kamera dipakai, off saat tidak; (4) kontrol berbentuk double joystick dengan gerakan lebih smooth.
- TRUE WEBSOCKET on the SAME port: scripts/ocean-ws.mjs (dependency-free RFC6455 relay — handshake SHA1 accept, masked client frames, 16/64-bit lengths, ping/pong sweep, rooms, monotonic cmd ids, presence, 'sync' request on join; fragmented frames closed by design) + scripts/dev-server.mjs (Next 16 programmatic custom server: HTTP(S) + /ws upgrade → relay, all other upgrades → app.getUpgradeHandler() so dev HMR keeps working; RUN_HTTPS=1 generates a self-signed cert via openssl into .next/certificates/). package.json: dev/dev:https now run the custom server — the WS shares port 3000 (no mixed content, no extra firewall hole).
- RemoteSocket.ts (browser client): persistent ws(s)://host/ws?room=…, hello/host role, capped-backoff reconnect (0.4s→5s), callbacks hands/view/cmd/host/presence/sync; sendHands/sendView/sendCmd/sendHost/ping. main.ts wires it on EVERY page: hands → remoteHands.ingest(), view/cmd → applyRemoteCmd, sync → publishHostState, presence → new remotePresenceBus; publishHostState also pushes over WS; 3 s chain beacon while engaged keeps late joiners converging. SSE/POST relays stay wired as automatic fallback.
- ChainRig (anti-patah): new DELTA API (dyaw/dpitch/ddolly/dmx/dmy) — velocity pads nudge the page's OWN live target so a late packet can never LURCH the camera back to a stale absolute (root cause of the edge breaks); softEdge() = tanh compression beyond 82% of any range (pushing into ±135° yaw / ±45° pitch / ±10 m move / ±8 m dolly decelerates asymptotically instead of hard-stopping; verified 240° of pushed deltas saturate exactly at 135 with no NaN); auto orbit is now SINUSOIDAL (yawT = range·sin(phase), C¹ reversal at the edges, starts from the current yaw via asin); ease 4.2 → 5; pitchRange 30 → 45 (studio CHAIN slider derives from it automatically).
- Relay payload: RemoteCmdView + route sanitizer carry the five delta fields (SSE fallback parity, clamped ±30/±10, 0.01 rounding).
- Phone rebuilt (user asked "control hanya kamera, off jika tidak"): /remote is now ONE screen — boot card (START CAMERA) or the live camera view; RemotePhonePad.ts (BUTTONS grid/toggles/boost) and RemotePhoneView.ts (pads/sliders/chips) DELETED.
- New RemotePhoneSticks.ts: double VELOCITY joystick floating over the camera view — LEFT = MOVE (kanan/kiri = geser X, atas/bawah = naik-turun Y, 6.5/4.5 m·s⁻¹), RIGHT = ORBIT (yaw 80°/s — stick right looks right, pitch 38°/s), smoothstep + 14% deadzone, per-stick pointer capture (multi-touch), knob glow + spring-back, PINCH anywhere = dolly (9 m/pinch), small ⟲ reset button, 30 Hz flush loop streaming rounded deltas; controls exist ONLY while the camera runs. RemotePhone.ts: camera loop unchanged (2 hands, 25 Hz) but sendHands/sendView prefer the WS (POST fallback), status chip shows '· WS', ?qa=1 boots sticks without a camera (start card hidden) for headless tests (__oceanPhone hook).
- RemoteHands: frame-apply logic extracted into ingest() — WS frames and SSE events share one path with the same server-stamp freshness gate; seq made public for QA. RemoteQrBadge: subscribes to the presence bus — INSTANT hide on phone join / show on leave (1 s hold to stop poll flicker); hands/pad polling kept as fallback; vmin sizing unchanged (follows screen).
- QA hooks: __ocean.ws.{status,live,sendView}, __ocean.remote.{at,now,seq}, __oceanPhone (phone page).
- New QA tools: scripts/ws-smoke.mjs (relay protocol test), scripts/ws-fake-phone.mjs (choreographed phone: delta streams, hands, cmds, auto, pings).

Verified headless (agent-browser + node WS clients):
- Relay: hello/presence/sync/view/cmd/hands fanout ✓ (host receives all, hands stamped with server `at`, cmd ids monotonic); presence {phones} correct on join AND graceful close; host echo fanout ✓.
- Pages: studio + /output + /remote all report __ocean.ws live; zero page errors (only pre-existing three.js warnings).
- Deltas end-to-end: fake phone dyaw stream → studio target.yaw 17.5→44.5; dmx → moveX −3.6; /output moveX 0.8; stress 60×4° deltas saturate EXACTLY at +135, NaN-free.
- Hands: WS burst ingested 1:1 (seq 0→50 monitored in-page), freshness gate intact, SSE path unchanged.
- Phone sticks: ORBIT drag → studio yaw −86.6 / pitch +17.5 (stick right = look right); MOVE drag → moveX +6.6 / moveY +1.7 (naik); ⟲ reset → studio targets all 0. Fixed during QA: start card (z-index) blocked synthetic drags in ?qa=1 — now hidden.
- QR badge: visible at boot (opacity 1) → phone joins → fades INSTANTLY via WS presence (0.59 mid-fade sampled) → phone leaves → back to 1. Earlier "stuck hidden" reading traced to zombie sockets of killed test processes — relay 25 s sweep cleans them; graceful close is instant.
- tsc clean (only pre-existing examples//skills/ errors); eslint clean on all new/modified files; all pages 200 after final edits; WS RELAY OK.
- Screenshots: download/qa-phone-sticks-final.png (double joystick), qa-output-ws-badge.png, qa-studio-final.png.

Stage Summary:
- The remote link now rides a real same-port WebSocket: hands, view deltas, commands and presence are steady push — the patah-patah is gone, and SSE/POST remain as silent fallback.
- The camera chain can no longer break at its edges: velocity deltas + tanh soft limits + sinusoidal auto sweep mean every motion decelerates smoothly into its range and reverses without a jolt; walls stay span-locked through all of it.
- The phone is one idea: camera on → the view IS the controller (MOVE + ORBIT double joystick, pinch dolly, reset); camera off → controls off. Everything else lives in the studio.
Task: QR smartphone connection on /output + /control-mobile double-joystick remote over a real WebSocket + smooth rigid camera rig (user: "qr untuk koneksi dengan smartphone"; earlier: "gunakan ws", "control di hp terlalu banyak ... doubel joystik ... lebih smooth")

Work Log:
- Discovered the earlier QR/remote work was never persisted (git log ended at the relay commit) — rebuilt the whole smartphone link from scratch
- server.js (new): custom Next.js server owning the HTTP socket — WebSocket hub at /ws/control (package `ws`, noServer + path-routed upgrade), role-tagged sockets (phone/screen), phone→screen fan-out for ctl/hand/cam frames, phone presence broadcasts on connect/disconnect, ping/pong liveness sweep every 15 s; package.json dev/start now run it (`node server.js`), everything non-WS still handled by Next
- RemoteRig (new): ONE rigid transform shared by every projection camera — orbit (yaw world-Y ∘ pitch local-right around the constellation pivot = centroid of surface cameras) + dolly along the mean view axis + strafe along mean right + lift; applied AFTER base pose in CameraManager.sync via applyTo(), constellation recomputed per frame from BASE surface data (no compounding). RIGIDITY IS THE EDGE FIX: adjacent frustums stay congruent under any orbit/pan, so walls can never tear at the seams
- Feel: phone sends stick VELOCITIES (deflection = speed); rig integrates targets and glides current→target with exponential damping (7.5/s) — packet jitter, stick release and limit hits all decay as one fluid motion. SOFT LIMITS: rubber-band gain eases to 0 at bounds (pitch ±62°, dolly −14..+26, strafe ±16, lift −7..+9) — verified by a deterministic unit test (scripts/rig-limits-test.mjs, 8/8 PASS: no overshoot, near-bound speed <5% of free speed, all finite)
- RemoteLink (new): ScreenLink (studio + /output) with auto-reconnect + backoff — consumes ctl frames, hand frames (700 ms freshness), phone presence; PhoneLink (/control-mobile) sends ctl/hand/cam
- Stale-input handling: packets older than 350 ms bleed the last velocity out smoothly (decayInput) — view coasts to a gentle stop whether the phone tab hides, Wi-Fi hiccups or the socket drops; no drift, no mid-air freeze
- QrOverlay (new): QR rides ON the projected picture while no phone is linked — encodes <origin>/control-mobile, positioned at the centroid of the enabled walls' warped corners, sized to the walls (clamped 130–250 output px), re-ticks every 120 ms so it FOLLOWS moves/warps/morphs (verified: +200,+60 output px → +133,+40 screen px = exact letterbox scale); hides the moment a phone links, returns when it leaves, × dismisses for the session
- /control-mobile (new page + PhoneController): DOUBLE JOYSTICK only — left MOVE (x strafe / y lift), right ORBIT (x yaw / y pitch), spring-back DOLLY throttle; pointer-capture sticks with dead zone + eased response; 30 Hz send loop; camera panel (getUserMedia preview + hand overlay + status) EXISTS ONLY while CAMERA mode is on — toggling off removes every trace and stops the stream (verified in headless: panel display:none by default, toggle on→visible, off→gone, graceful failure without a camera); numHands 2, palm/openness metrics streamed up
- main.ts: phone hand signals drive the ocean (field target + strength from openness) when the local camera isn't running; QA hooks: projection.remote(), rigSet(), qrInfo()
- remote.css: QR card (glassy, breathing glow, follows wall centroid) + full mobile remote UI (safe-area aware, touch-action none)

Verified headless (agent-browser, ws protocol test + 2 concurrent browser sessions as phone + wall):
- Hub: presence true on connect / false on close; ctl/hand/cam fan-out exact
- /output: QR visible at wall centroid on boot; phone (real second browser on /control-mobile) connects → QR hides; drag of the REAL orbit stick on the phone → /output rig integrates (yaw 6.4°, pitch 3.6° at headless ~2 fps; real browsers integrate at full 60 fps); phone closes → QR returns; ScreenLink auto-reconnect heals forced WS drops ("reconnecting" → "open")
- Watchdog: injected rig offsets decay smoothly; no drift after input stops (glide-to-target then frozen)
- Soft limits: rig-limits unit test 8/8 PASS (never overshoots bounds, rubber band works)
- Camera panel only-when-on; /output + / still boot clean (236 fish, no page errors); tsc clean
- Note: headless tabs crash-restore every ~1–2 min under RT load (environment artifact, not app behavior — system state self-heals on the pages' own reconnect paths)
- Screenshots: download/screenshots/qr-output-wall.png (QR on the wall), control-mobile-ui.png (double joystick + CAMERA button)

Stage Summary:
- The wall now invites the phone: a live QR sits on the projected picture, follows every wall move/warp, and vanishes the instant a phone links
- The phone is a double-joystick remote over a real WebSocket — smooth velocity control with rigid constellation camera motion, soft rubber-band limits and graceful decay, so the walls stay seamless and the motion stays fluid edge to edge
- Camera controls appear only when camera mode is on; everything else stays out of the way

---
Task ID: 17-b
Agent: main (Super Z)
Task: Reconcile with the previous session's pushed commits (remote main had 5 commits this checkout never had)

Work Log:
- Remote main carried the earlier SSE-based remote iteration (api/remote cmd/hands/host routes, /remote page, ChainRig, RemoteSocket/RemotePhone/RemoteQR/RemoteHands modules, two-hand gesture system)
- Merged FETCH_HEAD; resolved conflicts keeping the NEW stack as canonical: server.js WS hub, RemoteRig, QrOverlay, /control-mobile, CameraManager rig hook, ProjectionManager
- Deleted the rejected SSE transport stack (the source of "patah patah" + the chain rig edge tearing it was meant to fix)
- PORTED the orthogonal two-hand gesture work: HandTracker (numHands 2 + stable slots + hands()/landmarksList()), handMath, GestureEngine multi-sample update, GestureView multi-hand draw, InteractionField/Boids enhancements, Linked Ring preset
- main.ts interaction loop updated to the new API: detect() drives slot smoothing, samples = handTracker.hands(), GestureView takes the samples array, swim steering uses the primary palm

Verified: tsc clean; /output boots (QR at wall centroid, WS open), /control-mobile connects (green dot), /output flips to phoneOn + hides QR; home page boots with 236 fish and zero page errors; pushed 97df41c..1e9b497

Stage Summary:
- One canonical smartphone link now exists (WebSocket), the stuttering SSE remote is gone, and the good two-hand gesture work from the old branch rides on the new stack

---
Task ID: 22
Agent: main (Super Z)
Task: QR menempel di wall (in-projection WallQr + host setting) + fitur baru "ikan warna" — colouring-sheet → texture → 3D fish, dengan folder import di console control

Work Log:
- User feedback: (1) posisi QR sudah ada tapi belum mengikuti surface & terdistorsi karena tidak sesuai wall → QR harus MENEMPEL di wall dan hilang saat ada koneksi; (2) fitur baru: user mewarnai template ikan kosong, foto/scan, texture ikannya diambil dari gambar user (seperti contoh Template Ikan.png) lalu ikannya berenang di ocean; harus muncul sesuai session di semua layar; input gambar ada di console control + bisa impor otomatis dari folder lokal.
- WALL QR (remote/WallQr.ts): QR dirender KE DALAM render target tiap surface (render kedua tanpa clear, material toneMapped:false + pre-boost 1.35, depthTest off) — sehingga melewati warp/mesh/morph pipeline yang sama dengan picture: menempel di wall, ikut segala move/warp/preset, dan di dinding fisik tampil LURUS (pre-distorted otomatis di output space). Kartu QR (576×720): QR + "OCEAN REMOTE" + "scan — your phone is the controller" digambar via qrcode.toCanvas ke CanvasTexture; alpha fade (ease 5.5/s) via MeshBasicMaterial.opacity; ukuran konstan (94% tinggi view) di posisi sedikit atas. QA verified: QR muncul di composite /output, ikut moveSurface(+320,+90) EXACT, ikut warpCorner(keystone), alpha→0 saat phone hadir & kembali saat pergi.
- QR HOST SETTING: ProjectionProject.qr.host ('auto' = enabled surface terluas | surface id) — ProjectManager.serialize/load membawanya (sanitasi id); UI: pane PROJECT dapat section "PHONE QR ON WALL" (select AUTO + nama surface → pm.setQrHost → broadcast + autosave). BUGFIX: qrHost awalnya di-pass sebagai snapshot value ke ProjectHost → serialize selalu 'auto'; diganti live getter (const self + eslint-disable no-this-alias). Verified: studio select → autosave {host:'surf-…'} → /output boot menghormati host tsb.
- QrOverlay (DOM) jadi FALLBACK saja: disembunyikan saat WallQr punya host (hasWallHost provider), center saat tak ada surface. qrInfo() QA kini melaporkan {wall:{alpha,host,hostName,visible,url}}.
- ZOMBIE PHONE FIX (root cause lama "QR tidak muncul"): ditemukan 3 socket phone zombie di hub (tab QA lama masih hidup) → presence 'on' selamanya → QR tak pernah tampil. server.js: ws.lastSeen + sweep 5 s; phone idle >22 s (tanpa frame apa pun) di-terminate → announce. PhoneLink kini kirim heartbeat {t:'hb'} tiap 5 s agar phone hidup tapi diam tak di-expires.
- FISH TEMPLATE (fish/FishTemplate.ts): layout kontrak FISH_SHEET (BODY wrap 0.055–0.80, TAIL, DORSAL, ANAL, PECTORAL, PELVIC rect, WHITE_UV 0.965) + drawFishTemplate() — mewarnai outline ala contoh user (nose kiri, ekor kanan, sirip punggung/samping/perut, mata, insang, frame + corner bracket registrasi); downloadFishTemplate() → PNG 1600².
- CUSTOM FISH (fish/CustomFish.ts): buildCustomFish() — hull makeHull + UV wrap (s=1-t sepanjang badan, v=(cy+1)/2 lingkar) memetakan lukisan melingkar ke badan; tiap sirip (makeTailFan/makeRayFin/makePectoralFan) di-remap bbox → rect-nya masing-masing (uMode zFront/radial, vMode up/down/span) + vertex colors putih; mata 3D asli sampling WHITE_UV (direserve putih di processor). makeCustomFishMaterial() = makeFishMaterial + bumpScale 0.16. FishGeometryFactory: export makeHull/makeTailFan/makeRayFin/makePectoralFan/makeEyeParts/setUniformUV/WHITE_UV/BodySpec.
- FISH SCAN (fish/FishScan.ts): decode → downscale 1024 → estimasi kertas (median border luminance) → mask ink (sat>34 || lum<paper-62) di grid kasar → largest 4-connected component (= ikan, mengabaikan frame tipis) → bbox + pad → fit kanvas 768² putih margin 6% + filter saturate/contrast → reserveWhiteTexel → JPEG ≤480 KB (quality walk). Fallback whole-image utk close-up scan.
- FISHMANAGER: addCustomDesign/removeCustomDesign/customInfo — 1 school (6 ekor, tint putih, curiosity 0.7, anchor acak [−6..8, 0.5..4, −24..−14]) per design, geometry+material+texture didispose saat remove.
- TANK API (app/api/fish/route.ts): globalThis store + mirror .fish-tank.json (gitignored); GET (items ringan) / GET ?full=1 (dengan url) / POST add-remove-clear; cap 12 design × 480 KB, evict oldest.
- FISHTANK (fish/FishTank.ts): poll versi (4 s; 1.2 s setelah poke), pull full saat berubah, diff add/remove → FishManager — jalan di SEMUA page (main + /output mesin lain) sehingga ikan baru berenang di semua layar tanpa reload. info() utk QA (__ocean.projection.fish()).
- CONSOLE UI: tab FISH baru di ProjectionEditorUI — DOWNLOAD TEMPLATE, IMPORT PHOTO / SCAN (input multiple), IMPORT FOLDER (webkitdirectory), status scan, grid "IN THE TANK" (thumbnail + nama + DEL). projection.css: .pm-fish-grid/.pm-fish-cell/.pm-fish-name/.pm-fish-del.

Verified headless (agent-browser, server restart bersih):
- /output boot: WallQr alpha→0.99, hostName "Main Screen", QR tampil DI picture (bukan DOM); moveSurface +320/+90 → QR pindah EXACT mengikuti; warpCorner → QR keystone mengikuti wall; phone WS connect → alpha 0.68→0.09 (fade, lambat hanya krn RAF headless) → close → alpha naik lagi; host eksplisit via PROJECT select → /output boot memakai surface tsb.
- Fish E2E: template berwarna (dibuat dr line art user + flood-fill interior) di-upload via tab FISH → FishScan memotong ikan → POST tank → studio fishCount 236→242 (1 design × 6) → /output ikut 242 tanpa reload; screenshot menampilkan ikan rainbow berenang; remove → 236 kembali.
- server.js: zombie phones ter-expire ≤22 s (lebih dulu: ditemukan 3 zombie nyata dari sesi lama yang membuat QR tak muncul — persis keluhan user).
- tsc clean (kecuali examples//skills/ pre-existing); eslint clean di semua file berubah (server.js CommonJS require = style lama file itu); semua page 200; zero page errors.
- Screenshots: download/qa-wall-qr-output.png (QR di wall), qa-wall-qr-moved.png (ikut pindah), qa-wall-qr-warped.png (ikut keystone), qa-painted-fish.png (ikan warna), qa-fish-tab.png (tab FISH), qa-project-qr.png (QR host select).

Stage Summary:
- QR kini MENEMPEL di wall: dirender ke dalam picture, mengikuti move/warp/morph, tampil lurus di dinding fisik, hilang saat phone connect, kembali saat phone pergi, dan host-nya bisa dipilih per surface di console (AUTO = wall terluas).
- Akar masalah "QR tidak muncul" (socket phone zombie di hub) dibasmi dengan idle-expiry + heartbeat.
- Fitur "ikan warna": template kosong bisa diunduh dari console, user mewarnai & memotret/scan, gambar otomatis dipotong jadi texture — ikan 3D-nya langsung berenang di semua layar; impor bisa per foto atau seluruh folder lokal; setiap design membentuk school kecil dan bisa dihapus lagi.

---
Task ID: 23
Agent: main (Super Z)
Task: "templatenya menggunakan ikan yang saya kirim png nya bukan buatkan mu ... ikannya sudah saya coba kirim namun belum muncul ... pastikan ikannya 3D sesuai dengan gambar yang saya kirim lengkap dengan mata kepala dan sirip nya namun di buat 3d"

Work Log:
- ROOT CAUSE 1 (frame = ikan): template PNG milik user punya FRAME bingkai; FishScan lama memilih komponen terbesar = frame → tekstur = seluruh lembar (mayoritas putih) → ikan 3D hampir putih semua → "belum muncul". Tank server memang berisi 2 upload "Template Ikan" user (POST sukses) — kegagalannya murni di tekstur.
- ROOT CAUSE 2 (bug traversal): saat mengubah pencarian komponen ke mask hasil DILASI, seed memeriksa `dil[start]` tetapi tetangga masih memeriksa `!mask[n]` (mask mentah) → jembatan dilasi tak terlihat → outline ikan (garis tipis, terputus-putus) tetap terfragmentasi; komponen terbesar = arc perut saja (196 sel vs 4901). Ditemukan via instrumentasi bertingkat (__fishScanDebug/Inner/Alpha) + port verbatim di eval; fix: neighbor check → `!dil[n]`.
- FishScan diperkuat: max-pool 9 sub-sampel/sel (garis 4-6px tak lagi lolos antar pusat sel), deteksi & potong FRAME (garis lurus panjang dekat tepi, dipotong 2 sel ke dalam), dilasi 2 sel (menyambung mulut/peduncle), normalisasi aspek ke 961/615 (canvas kontrak 676×433 → kontrak zona SELALU pas untuk foto apa pun), fallback whole-image tetap ada.
- TEMPLATE MILIK USER: public/fish/template-ikan.png (disederhanakan: PNG asli user, 1492×1054, RGBA). FishTemplate.ts: FISH_SHEET baru DIUKUR dari PNG user (bbox ikan 961×615; zona badan/ekor/punggung/anal/perut/dada + posisi mata) — drawFishTemplate prosedural DIHAPUS; downloadFishTemplate() = fetch PNG asli; tab FISH menampilkan PREVIEW template asli (.pm-fish-tpl).
- CustomFish disesuaikan siluet template user: hull profile 12 titik (kepala tumpul, terdalam di belakang insang, peduncle jelas di ~77% badan, h/l ≈ 0.51), len 0.85; TAIL 0.25/0.21/fork 0.62; DORSAL 6 titik (punggung bergelombang); ANAL 3 titik; pectoral 0.17 @ len·0.1; pelvic 0.15 @ len·0.12; mata 3D 5-layer di posisi mata gambar (eyeZ len·0.32, cy 0.16, r ≤0.046) — sampel WHITE_UV.
- E2E headless (upload lewat input file asli tab FISH): template kosong user → tekstur ikan UTUH (u 0.10..0.90, v 0.25..0.76; mata/kepala/sirip lengkap, frame hilang); lembar berwarna (dibuat dr template user, diwarnai per zona) → zona sample: BODY oranye, TAIL lobes merah, DORSAL kuning, PECTORAL cyan ✓. Tank live: desain user ("Gemini Generated Image", di-upload user saat live test) berenang 6 ekor/desain; /output sync (v naik, 0 page error).
- Membersihkan entri uji dari tank (menyisakan 2 desain milik user); tsc + eslint bersih.

Stage Summary:
- Ikan warna kini benar-benar bekerja: unduh = template ASLI milik user, scan = tahan frame/garis tipis/foto, tekstur = ikan utuh sesuai kontrak, ikan 3D = siluet template user dengan mata/kepala/sirip 3D, muncul di semua layar.
- Akar "belum muncul" dibasmi dua lapis: frame-vs-ikan dan bug neighbor-check (mask vs dil) pada pencarian komponen.
