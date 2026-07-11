# Procedural Monster Lab

A fully keyframe-free 3D creature in a single HTML file — no mesh, no rig, no 3D library.
The monster is a raymarched **Signed Distance Field**: every frame, ~400 lines of JavaScript
compute a skeleton (gait, IK, dynamics, actions) and a fragment shader renders it as
smoothly-blended capsules.

| Skink (reptile) | Beast (mammal) | Bug (invertebrate) |
|---|---|---|
| ![skink](docs/skink.png) | ![beast](docs/beast.png) | ![bug](docs/bug.png) |

| Rex (theropod biped) | Wyvern (in flight) |
|---|---|
| ![rex](docs/rex.png) | ![wyvern](docs/wyvern.png) |

## Run it

Open `index.html` in any browser with WebGL2 — no build step, no dependencies.

- **Click the ground** to call the monster somewhere — winged specimens **fly** to far calls
- **A** attack · **space** jump · **D** dash · **R** rest (or use the panel buttons)
- **Drag** to orbit, **scroll / pinch** to zoom
- Panel: five specimens, dynamics tuning (f / ζ / r), morphs (leg length, plumpness,
  **leg pairs 1–4**, **posture** sprawl↔upright), dress-up (spikes, hat, **wings**)

## How it works

Built following "The Procedural Monster Manual" playbook:

- **Animal groups** — five presets share one *Universal Limb Class*: the skink's 2-bone
  sprawled legs, the beast's 3-bone "Mammal Problem" zigzag (solved by IK-ing hip→ankle and
  hanging the metatarsal below), the bug's six spider legs / antennae / pedipalps, the
  **rex** (biped gait on one leg pair, tiny 2-bone arms, hinged jaw with teeth, counterweight
  tail), and the **wyvern** (bird group: biped plus wings).
- **Wings & flight** — wings fold flush along the body on the ground and flap open in the
  air, per the guide's bird-group note. Flight is a locomotion mode: far target → take off,
  climb to cruise height with a wingbeat heave, tuck the feet, and land near the call.
  The wings toggle bolts them onto *any* specimen.
- **Morph sliders** — *leg pairs* re-instantiates 1–4 pairs from the limb class with
  stance/lead sampled along the spine; *posture* morphs joint positions continuously:
  pole vectors, hip sockets and stance width slide from sprawled reptile to upright mammal.
- **Actions** — attack (wind-up recoil → lunge, jaw gapes), jump (squash → ballistic arc →
  landing squash), dash (impulse burst), rest (settle to the ground, legs folded, slow
  breathing, half-lidded eyes) — all procedural overlays on the dynamics, zero keyframes.
- **SDF tube method** — the body is 20–50 tapered capsules (`sdRoundCone`) joined with a
  polynomial smooth-min, so it reads as one organic mass with no joint pinching. A *jelly
  wobble* slider adds sinusoidal displacement.
- **Gait stepper** — feet plant in world space and only step when stretched past a threshold,
  diagonal pairs alternating: biped walk, quadruped trot, or tripod scuttle — same rule.
- **Second-order dynamics** — body and head follow their targets through the
  f / ζ / r system, integrated with semi-implicit Euler. `k2` is clamped every step so the
  timestep never exceeds `T_critical` — lag spikes can't launch the monster to infinity.
  Set **r < 0** and it leans away before moving (anticipation); drop **ζ** and it gets bouncy.
- **Personality layer** — gait-synced bob, follow-chain tail, blinking, idle look-arounds
  (it occasionally looks straight at the camera), breathing, and dress-up.

The renderer marches 150 steps against the capsule list with a bounding-sphere early-out,
then shades with a soft sun shadow, 5-tap AO, sky/bounce fill, and distance fog. Resolution
auto-scales to hold frame rate.

## Test

```
node test/smoke.js
```

Runs the page's script headlessly with a stubbed DOM/WebGL and drives every preset through
walking, all four actions, a full flight (take-off → cruise → landing), an 8-legged winged
bug, and posture morphs — asserting the packed segment data stays finite and behaviors
actually happen (jaw opens, jump lifts, rest settles, wyvern reaches altitude and lands).
