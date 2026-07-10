# Procedural Monster Lab

A fully keyframe-free 3D creature in a single HTML file — no mesh, no rig, no 3D library.
The monster is a raymarched **Signed Distance Field**: every frame, ~300 lines of JavaScript
compute a skeleton (gait, IK, dynamics) and a fragment shader renders it as smoothly-blended
capsules.

| Skink (reptile) | Beast (mammal) | Bug (invertebrate) |
|---|---|---|
| ![skink](docs/skink.png) | ![beast](docs/beast.png) | ![bug](docs/bug.png) |

## Run it

Open `index.html` in any browser with WebGL2 — no build step, no dependencies.

- **Click the ground** to call the monster somewhere
- **Drag** to orbit, **scroll / pinch** to zoom
- Panel: switch specimens, tune the dynamics (f / ζ / r), morph legs and plumpness,
  toggle spikes and the party hat

## How it works

Built following "The Procedural Monster Manual" playbook:

- **Animal groups** — three presets share one *Universal Limb Class*: the skink's 2-bone
  sprawled legs, the beast's 3-bone "Mammal Problem" zigzag (solved by IK-ing hip→ankle and
  hanging the metatarsal below), and the bug's six spider legs, antennae, and pedipalps —
  identical limb code, different lengths and directional offsets.
- **SDF tube method** — the body is ~25 tapered capsules (`sdRoundCone`) joined with a
  polynomial smooth-min, so it reads as one organic mass with no joint pinching or
  candy-wrapper twisting. A *jelly wobble* slider adds sinusoidal displacement.
- **Gait stepper** — feet plant in world space and only step when stretched past a threshold,
  diagonal pairs alternating: trot for quadrupeds, tripod for the bug.
- **Second-order dynamics** — body and head follow their targets through the
  f / ζ / r system, integrated with semi-implicit Euler. `k2` is clamped every step so the
  timestep never exceeds `T_critical` — lag spikes can't launch the monster to infinity.
  Set **r < 0** and it leans away before moving (anticipation); drop **ζ** and it gets bouncy.
- **Personality layer** — gait-synced head/shoulder bob, a follow-chain tail, idle
  look-arounds (it occasionally looks straight at the camera), breathing, and dress-up
  (spikes, hat, four pigment palettes).

The renderer marches 150 steps against the capsule list with a bounding-sphere early-out,
then shades with a soft sun shadow, 5-tap AO, sky/bounce fill, and distance fog. Resolution
auto-scales to hold frame rate.

## Test

```
node test/smoke.js
```

Runs the page's script headlessly with a stubbed DOM/WebGL, drives ~2,700 frames across all
presets and morph extremes, and asserts the packed segment data never goes non-finite.
