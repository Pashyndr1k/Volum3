# Volum3 prototype: how it works

This is the first build of the design in [SQNCR_MECHANICS.md](SQNCR_MECHANICS.md) Part II:
about 100 cubes packed into one large cube, an indicator orbiting it that plays each cube as it
passes, spring physics that make the block ripple, and a touch mode.

## Run it

```sh
npm install
npm run dev      # http://localhost:5173
npm run build    # static site in dist/
```

Click anywhere once to enable sound, since browsers block audio until the page gets a gesture.

| Input | Action |
|---|---|
| **Space** / PLAY | Start or stop the orbit |
| **T** / MODE | Switch between ORBIT and TOUCH |
| **G** / GENERATE | New seed: a new cluster, new voices, and a new piece |
| Hover over a cube | Touch it. It plays and gets knocked the same way the indicator knocks it. |
| Click a cube | Also touches it, for trackpads that never hover |
| Drag | ORBIT mode: move the camera. TOUCH mode: spin the block, which keeps its momentum. |
| BPM, EMISSION | Tempo 60–140, and how much a strike throws (1 = dots only … 5 = everything, furthest) |

The URL carries `seed`, `mode`, `bpm` and `grain`, so the same URL always rebuilds the same block.

## Files

| File | Role |
|---|---|
| `src/cluster.js` | Packs the block: an 8×8×8 occupancy grid, cubes of size 4, 2 and 1 on an even lattice, stopping near 100 cubes, with ~6 % holes, jitter and tilt. Also builds the contact graph. |
| `src/music.js` | SQNCR's 16-voice table. Picks a voice for each cube from **when** it plays (its azimuth step), its size and its height. Also CITY harmony: F major, an 8-chord loop, and the chord-tone ladder, so tuned cubes stay consonant. |
| `src/audio.js` | Port of SQNCR's synthesis: master compressor, procedural plate reverb, dotted-8th delay, all 16 voice recipes, ombak detune and tremolo. No samples. |
| `src/transport.js` | SQNCR's "two clocks" scheduler: a 20 ms timer looking 140 ms ahead on the audio clock. One orbit = 64 sixteenths (9.6 s at 100 BPM). |
| `src/physics.js` | The spring lattice (see below) |
| `src/cubes.js` | One `InstancedMesh` of rounded boxes. A per-instance `aGlow` attribute pulls the colour toward white and adds it as emission. |
| `src/emissions.js` | SQNCR's emission rings in 3D: marks on expanding shells, one ring every 70 ms, SQNCR's hold and fade timings, drawn additively |
| `src/main.js` | Scene, bloom, the orbit and indicator, strike routing, touch, the frame loop |
| `src/ui.js`, `src/style.css` | The panel of words, in the style of SQNCR |

## Timing: sound and picture on one clock

Each cube's azimuth around the orbit axis is snapped to one of 64 steps. The transport books
the step's sounds ahead of time on the `AudioContext` clock and queues a *strike* for the same
timestamp. The frame loop applies each strike when `audioCtx.currentTime` reaches it. So the push,
the flash and the note are phase-locked even though the frame rate varies. The indicator's angle is
also derived from the audio clock.

Cubes that share a step are deduplicated by voice and pitch, capped at 5 voices, and scaled by
`1/√n`. Each cube also has a 4-orbit mask (SQNCR's variation). On a silent orbit it still gets a
soft visual knock (energy 0.3) but makes no sound.

## Physics

State is each cube's displacement and rotation from its rest pose, in the block's own frame.
Integration is semi-implicit Euler at a fixed 240 Hz.

* **Anchor spring** to rest: `k = 150·m^0.75`, damping ratio 0.2. Mass = volume (1, 8 or 64), so
  the big blocks lag.
* **Contact springs** between touching cubes (face, edge or corner), acting on the *difference* of
  displacements. Each cube's total coupling (500) is **shared across its contacts**. Without that,
  a small cube with 12 neighbours is pinned and nothing propagates.
* **Strike**: impulse `14·energy·m^0.75` toward the indicator's position (orbit mode) or along the
  pointer ray (touch mode), applied at an off-centre point. 30 % of the torque becomes spin.
* **Glow** = heat (set to the strike energy, decaying with τ = 0.3 s) plus a small term for
  displacement. That way cubes the wave passes through warm up as well.

Measured with `node` on seed 1595866095:

| | Value |
|---|---|
| Peak displacement, small cube, full-energy hit | 0.42 units |
| Touching neighbours | about 0.065 (≈15 %) |
| Wave front | about 55 ms to the first ring |
| Settle (all < 0.01) | 0.4–1.2 s depending on size |
| 60 s of continuous strikes at 140 BPM | max offset 0.56, mean 0.03, max tilt 9.8°, stable |

The tuning constants live together in `TUNING` at the top of `src/physics.js`.

## What's next

* **Glyphs on faces.** SQNCR's 16 pattern SVGs (§11.1) as face decals, with their per-shape reveal
  animations replayed on each strike.
* **Quarter-roll** on some cubes (SQNCR's clip flip, §11.4).
* **Intro.** Assemble, then a first silent orbit that strikes everything (SQNCR §11.6). A gentle
  version already exists: every new block springs together from an exploded start.
* **Styles.** GAGAKU, KOTO and MA placement and harmony as alternatives to CITY. The pillar and
  rook strategies map naturally to 3D stacks and face-sharing clusters.
* **Box–box contact** with Rapier, if the soft spring model ever looks too forgiving under heavy hits.
* **Recordings.** SQNCR's analysis and slicing pipeline (§8) on a dropped audio file, cast onto
  white cubes.
