# 🌊 The Living Ocean

> **An ocean that can feel you.** A cinematic, interactive 3D underwater world that responds to your hand movements through your webcam — no controllers, no gloves, just your hand.

<p align="center">
  <img src="download/ocean-final-desktop.png" alt="The Living Ocean — a coral reef teeming with fish, lit by god rays" width="800" />
</p>

The Living Ocean is a real-time 3D ocean built with **Three.js**, **GSAP** and **MediaPipe Hands**. Raise your webcam hand and the reef reacts: sweep to push a current through the seaweed, open your palm to draw fish closer, close your fist and the reef goes quiet, shove your hand forward to scatter a school in an explosion of bubbles. Everything runs **100% locally in your browser** — camera frames are processed on-device via WASM and are never uploaded or displayed.

---

## ✨ Features

- **Hand-gesture control** — swipe, push, pull, open palm and fist gestures, each with its own force field, animation and sound. Velocity-strength coupling means faster movements hit harder.
- **A living ecosystem** — ~300 fish across 9 procedurally-built species (clownfish, blue tang, angelfish, butterflyfish, Moorish idols, squirrelfish, pufferfish and two silver bait-balls) driven by boids flocking simulation with separation, alignment, cohesion, wander, obstacle avoidance and gesture forces. Bodies are organic swept hulls with a dorsal ridge, compressed flanks and welded smooth normals; fins are true ray fans with membranes and scalloped edges; scales are bump-mapped micro-relief; eyes carry socket, sclera, iris, pupil and glint layers.
- **Feeding frenzy** — press **G** (or the pellets HUD button) to scatter food. Pellets tumble down with water drag and swirl, rest on the seabed, and every school within range breaks formation and races the nearest crumb — the first fish to reach it gulps it down in a shrinking bite.
- **Open-world free swimming** — press **F** (or the waves HUD button) to leave the cinematic drift and explore the whole ocean first-person: drag to look around, turn with **A / D** or the arrow keys, glide with **W / S**, strafe with **Q / E**, rise and sink with Space / C — with soft collision against the seabed and the world edge. With the camera on, your **open palm becomes a swim joystick**: hold it left or right of center to turn, up / down to pitch, and close it into a fist for a forward kick. Touch devices get a hold-to-glide paddle.
- **Four biomes to discover** — the coral gardens of the east, a swaying **kelp forest** in the north-west, a **boulder canyon** with two rock arches in the south-west, shell-bright **sand flats** in the south-east, and towering **monolith spires** on the northern seamount. Each biome has its own sand tint, resident schools and landmarks to navigate by.
- **Special visitors** — a gliding manta ray (broad double-skin wings with a dark back and pale underside, counter-shaded fuselage and a whip tail rooted inside the body), a cruising sea turtle (scute-textured shell, wrinkled mottled skin, tapered paddle flippers that stroke from the shoulder, parrot beak) and three patrolling shark silhouettes (deep-water pass plus two reef crossings) appear on random schedules. Pufferfish are camera-curious and will come say hello.
- **Pufferfish defence display** — when a shark crosses the reef (or you swim right up to one), pufferfish inflate into a ball and their spines extend off the skin in real time — a per-instance shader morph — while the rest of the school panics and scatters around the predator.
- **Procedural reef** — fbm-dune seabed with a canyon basin and seamount, biome-tinted sand, pebbles and shells, 8 procedural coral families, deformed instanced boulders, GPU-swaying seaweed and kelp, starfish, sea urchins and scallop shells — zero external 3D assets.
- **Atmosphere** — animated water surface with Snell-window glow, procedural caustics, volumetric god rays, depth-graded fog, particle plankton, bubble clusters and a fully procedural WebAudio soundscape (drone, water noise, whale calls, gesture shimmer).
- **Cinematic entry** — GSAP-sequenced loading, dive-in descent and staged reveals.
- **Graceful everywhere** — three quality tiers with adaptive degradation, mobile/touch layout, reduced-motion support, and a mouse/keyboard fallback that keeps the ocean alive without a camera.

## 🖐️ Gesture Guide

| Gesture | Action |
|---|---|
| **Sweep hand** left / right / up / down | Sends a current through the water — fish, particles and seaweed follow |
| **Push hand toward camera** | Shockwave that scatters the nearest school |
| **Pull hand back** | Gentle recovery — the reef settles |
| **Open palm (hold)** | Attracts nearby fish and plankton |
| **Closed fist (hold)** | Caution mode — fish keep their distance |

### Mouse / Touch / Keyboard fallback

| Input | Action |
|---|---|
| Move / drag the pointer | Directs the ambient current |
| Tap / click | Attract burst |
| Press & hold | Push shockwave |
| `W A S D` / arrows | Swim the current around |
| `Space` | Continuous push |
| `X` | Scatter pulse |
| `G` / pellets HUD button | Scatter food — schools race in to eat |

### Free-swim exploration (`F`)

| Input | Action |
|---|---|
| `F` / waves HUD button | Toggle free swim |
| Drag (mouse or touch) | Look around |
| `W` / `S` or `↑` / `↓` | Glide forward / back |
| `A` / `D` or `←` / `→` | **Turn left / right** |
| `Q` / `E` | Strafe left / right |
| `Space` / `C` or `Shift` | Ascend / descend |
| **Open palm** (camera on) | Steers: left / right of center turns, up / down pitches |
| **Fist** (camera on) | Forward fin-kick burst |
| `▲ GLIDE` paddle (touch) | Hold to swim forward |
| `Esc` | Return to the cinematic drift |

## 🚀 Quick Start

```bash
# 1. clone
git clone https://github.com/Muh-Adib/ocean-camera.git
cd ocean-camera

# 2. install
npm install        # or: bun install

# 3. run
npm run dev        # http://localhost:3000

# 4. production
npm run build
npm start
```

> **Requirements:** Node.js 18+ (or Bun). A webcam is optional — the experience boots straight into mouse mode if you skip the camera prompt.

## 📷 Camera Troubleshooting

The experience never shows raw browser errors — it diagnoses camera problems and tells you exactly how to fix them:

| On-screen message | Cause & fix |
|---|---|
| **CAMERA BLOCKED BY THE PREVIEW** | You're viewing the page inside an embedded iframe (preview pane) that forbids camera access. Use the **OPEN IN NEW TAB** button, then allow the camera there. |
| **CAMERA PERMISSION NEEDED** | The browser prompt was denied. Click the padlock icon in the address bar → allow Camera → **TRY AGAIN**. |
| **NO CAMERA FOUND** | No camera hardware detected, or it's disabled in system settings. |
| **CAMERA IN USE** | Another app (Zoom, Meet, OBS…) is holding the camera. Close it and retry. |
| **SECURE CONNECTION NEEDED** | `getUserMedia` requires HTTPS or `localhost`. Serve the page securely. |
| **HAND MODEL NOT LOADED** | The MediaPipe hand model couldn't be fetched (network hiccup). Wait a moment and **TRY AGAIN**. Model loading is time-boxed, so the button never spins forever. |
| **CAMERA DISCONNECTED** | The camera vanished mid-session — unplugged, switched off, or permission revoked. Reconnect and retry. |

Hand tracking also degrades gracefully: **GPU inference falls back to CPU** automatically on devices whose drivers reject WebGL delegates.

## 🧱 Tech Stack

| Layer | Tool |
|---|---|
| 3D rendering | [Three.js](https://threejs.org) (WebGL, InstancedMesh, custom shaders) |
| Animation / sequencing | [GSAP](https://gsap.com) |
| Hand tracking | [MediaPipe Hand Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker) — bundled locally (npm JS + `/public/mediapipe` WASM & model), WASM inference on-device, **zero CDN** |
| Framework | [Next.js](https://nextjs.org) (App Router) — React only mounts the container; the entire experience is framework-free TypeScript in `src/experience/` |
| Audio | Procedural WebAudio (no audio files) |

## 📁 Project Structure

```
src/experience/
├── core/          SceneManager, CameraRig, Lighting, PerformanceManager, sharedUniforms
├── environment/   Seabed, Rocks, CoralSystem, Seaweed, WaterSurface, ReefDecor, Biomes (kelp forest · rock arches · spires)
├── particles/     ParticleField, Bubbles, GestureBurst
├── fish/          FishGeometryFactory (procedural species), Boids, FishManager, SpecialCreatures
├── interaction/   HandTracker, GestureEngine, InteractionField, PointerFallback, SwimController
├── audio/         AudioManager (procedural WebAudio)
├── ui/            UI (intro, HUD, guide, toasts, camera help)
└── utils/         math helpers
```

## ⚡ Performance & Accessibility

- **Three quality tiers** detected at boot (mobile / integrated / discrete GPU) controlling pixel ratio, particle counts, coral density, light-ray count and fish population — with live adaptive degradation if the frame rate dips.
- **One instanced draw call per school** keeps the whole reef in ~20 draw calls.
- Honors `prefers-reduced-motion`: intro descent and drift are dampened.
- Safe-area aware HUD for notched phones.

## 🔒 Privacy

- Camera frames are processed **entirely on-device** via WASM.
- The whole tracking engine is served with the app — no CDN requests, so hand tracking keeps working offline and on restricted networks.
- The video element is never rendered to the page — nothing is recorded, stored or uploaded.
- Only derived, anonymous hand geometry (palm position, openness, scale) is used, and only to drive forces inside the scene.

## 📄 License

Released under the [MIT License](LICENSE) — © 2026 Muh-Adib.
