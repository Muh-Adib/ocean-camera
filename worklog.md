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
