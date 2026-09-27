# Volum3 prototype: how it works

This is the first build of the design in [SQNCR_MECHANICS.md](SQNCR_MECHANICS.md) Part II:
about 100 cubes packed into one large cube, an indicator orbiting it that plays each cube as it
passes, spring physics that make the block ripple, and a touch mode.

## Run it

**Windows:** double-click **`start.bat`** in the project folder. **macOS:** double-click
`start.command`. **Linux:** run `./start.sh`.

The launcher:
1. checks that Node.js 20.19+ is installed, and opens nodejs.org if it isn't;
2. installs dependencies on the first run only;
3. starts the app and opens it in your browser.

Keep its window open while you play, and close it to stop.

Or by hand: `npm install`, then `npm run dev`, and open http://localhost:5173.

Click anywhere once to enable sound, since browsers block audio until the page gets a gesture.

**Top row**

| Input | Action |
|---|---|
| **Space** / PLAY | Start or stop the orbit |
| BPM / **B** | Switch tempo: each press goes to the next of 70 · 85 · 100 · 115 · 130 · 145, and wraps around |
| **T** / MODE | Switch between ORBIT and TOUCH |
| **G** / GENERATE | New seed: a new block. The pattern stays and is re-dealt to the new cubes. |
| EMISSION | How much a strike throws (1 = dots only … 5 = everything, furthest) |
| Hover over a cube (ORBIT mode) | Touch it: it plays its note **once**, when the pointer arrives on it. Staying on it does nothing more; moving onto another cube plays that one. Touches are tested against the block as built, so a cube knocked away never exposes the next one into a chain of triggers. |
| Hold the pointer on the block (TOUCH mode) | The block turns at the indicator's speed and the pointer reads it like a stationary indicator: the pattern plays step by step, in tempo. Moving the pointer scrubs; taking it off the block stops. |
| Click a cube | Always plays it, even the one already touched |
| Drag | ORBIT mode: move the camera. TOUCH mode: spin the block, which keeps its momentum. |

**Second row: the physics**

| Control | Levels | What it does |
|---|---|---|
| ZONE | 0–4 | Touch radius: 0 = only the cube under the pointer; then 1.2, 2, 3 and 4.2 cube-widths. Every cube inside is thrown at the same moment, harder near the centre, but only the touched cube sounds and throws marks. One touch, one trigger. |
| FORCE | 1–5 | Impulse ×1, ×2, ×3.5, ×5, ×7. At the default (3) a small cube flies about 1.4 units out. At 5 it's about 2.9. |
| SPIN | 0–4 | Random-axis spin kick of 0, 3, 6, 10 or 15 rad/s. Small cubes turn about 6° at 0, 14° at the default (2) and 21° at 4. Big cubes turn less. |
| RETURN | 1–5 | Anchor stiffness ×0.3 … ×2.8. 1 is slow and floaty, and drags neighbours along. 5 is quick and tight. |
| CAVES | 1–3 | How hollow the block is (it rebuilds): core size, number of tunnels and pockets |

Every setting is saved in the URL, so a link reproduces the whole setup.

## The timeline

The small frame at the bottom centre is the pattern the indicator plays: one orbit laid flat,
64 sixteenths (4 bars). It shows only the lanes in use (MELODY always; then CHORD, BASS, PERC,
OPEN, HAT, SNARE, KICK as needed). Marks are in one ink, and each lane's letter is in the colour
its cubes take. The playhead is the indicator's angle.

| Input | Action |
|---|---|
| The style name (CITY POP, HOUSE, BOOM BAP, BOSSA, TRAP, AMBIENT, DRUM & BASS) | Next style: a new pattern in it, with its own tempo, key, chords, groove and melody |
| NEW / **R** | A new pattern in the current style |
| HUM / **H** | Record a melody by humming (below) |
| PRESET | Back to the default: CITY POP in F major at 100 BPM, B♭–C–Am–Dm, with a hand-written tune |
| Click the grid | Add or remove a mark. In the melody lane, the height picks the pitch. |
| Click a lane letter | Mute or unmute the lane |
| **L** / TIMELINE | Hide or show the frame |

The URL keeps `style` and `pattern`, so a link brings back the same groove.

**How a pattern is made** (`src/patterns.js`). Each style is a probability grid per drum lane
(one bar), plus a tempo range, keys, 3–4 chord progressions, a bass rule (follow the kick, fixed
steps, or bossa root–fifth) and a chord rhythm. A roll builds bar A, a varied A′, A again, and A
with a fill. The bass follows the kick in the current chord. The melody is a phrase, a variation,
the phrase again, and an answer: it favours the beats, moves mostly by step, lands on a chord
tone on strong beats, and ends on the tonic.

**How notes become cubes** (`src/mapper.js`). A note at step *s* goes to a cube whose angle
around the orbit is at *s*, searching ±1, ±2, ±3 steps if needed. Within that window the lane
decides which cube: kick and bass take low, heavy cubes; hats take high ones; the melody climbs
the block with its pitch. Free cubes are used first, and busy patterns give some cubes several
nearby notes. Each cube takes its part's colour, and cubes with no note go dark and only get a
light brush from the indicator. Measured across all seven styles, notes land on average 0.8–1.3
steps (≈5–8°) from the indicator, and never more than 3.

## Humming a melody

Press **H** (or HUM). The browser asks for the microphone the first time. Then:

1. **Count-in**: four rim clicks.
2. **Record**: four bars, with a quiet click on every beat to keep time and nothing of the
   old song playing.
3. **Result**: the hum **replaces the whole composition**. The pattern becomes just the hummed
   melody, in the key you hummed it in, played by a sustained LEAD voice. Its cubes light up, the
   rest go dark, and it plays from bar one. **Esc** cancels.

**Analysis** (`src/hum.js`):
* Microphone chunks are stamped with the audio-clock time of their first sample (an
  AudioWorklet), so the take lines up with the grid exactly.
* Loudness and pitch (YIN, 75–1000 Hz) every 10 ms.
* A new note starts when the voice starts, when the pitch moves by more than about a semitone
  and stays, or when the loudness dips and rises on the same pitch ("da-da").
* The window is shifted by the microphone's reported input latency (20 ms if the browser doesn't
  say), so onsets aren't late.
* The key comes from the hum: the major or minor scale that holds most of it, weighted by how
  long each note is held. Notes are rounded to the semitone. Only notes outside that key are
  nudged to their nearest neighbour in it, and the line is moved by whole octaves into a
  comfortable register. The pitches and intervals are yours.
* Onsets round to the nearest sixteenth and lengths to whole steps.

**Tested** with synthetic hums (voice-like harmonics, vibrato, timing jitter, room noise), in
`node` and end to end in Chromium through a fake microphone. An 18-note tune came back with every
onset on the right step and every interval exact, and its key was read as G major, which is the
key it was sung in. Analysing 9.6 s takes about 150 ms. Same-pitch re-articulations are found when the voice
dips between them.

## Files

| File | Role |
|---|---|
| `src/cluster.js` | Carves the caverns (a hollow core, 2-cell-wide tunnels in from the faces, pockets), then packs the rest of an 8×8×8 grid with cubes of size 2 and 1 on an even lattice, stopping near 100 cubes. Each cube fills about 82 % of its slot and gets a little jitter and tilt. Also builds the contact graph. |
| `src/patterns.js` | Pattern model, the 7 styles, the generator and the default preset |
| `src/mapper.js` | Deals the pattern's notes to cubes |
| `src/timeline.js` | The timeline frame: drawing, editing, mutes |
| `src/hum.js` | Microphone capture on the audio clock, pitch and onset analysis, hum → melody lane |
| `src/music.js` | SQNCR's 16-voice table plus LEAD. Holds the current harmony, and a fallback voice per cube for touching cubes that carry no note. |
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

At each step every note of the pattern strikes its cube and sounds (notes with the same voice and
pitch are played once). Cubes with no note get a light brush (energy 0.14) as the indicator passes.

## Physics

State is each cube's displacement and rotation from its rest pose, in the block's own frame.
Integration is semi-implicit Euler at a fixed 240 Hz.

* **Anchor spring** to rest: `k = 150·RETURN·m^0.75`, damping ratio 0.2. Mass = volume.
* **Contact springs** between touching cubes (face, edge or corner), acting on the *difference* of
  displacements. Each cube's total coupling (500) is **shared across its contacts**, so a small
  cube wedged among 12 neighbours isn't pinned.
* **Collision**: if two touching cubes' boxes overlap, they are pushed apart along the axis of
  least overlap (stiffness 15000 × the lighter mass). This way a cube thrown out of the core
  shoves the wall aside instead of passing through it.
* **Strike direction**: 75 % straight out from the block's centre, bent toward what hit it (the
  indicator, or the pointer's ray). Cubes in the hollow core just follow the hit.
* **Strike**: impulse `14·FORCE·energy·m^0.75`, plus a random-axis spin kick `SPIN·energy/√size`,
  plus a little torque from the off-centre contact point.
* **Glow** = heat (set to the strike energy, decaying with τ = 0.3 s) plus a small term for
  displacement, capped so flying cubes don't all go white.

Measured with `node` on seed 1595866095 (CAVES 2), for an outward hit at energy 0.9:

| Setting | Small cube: peak / tilt | Touching neighbours | Settles in |
|---|---|---|---|
| Default (FORCE 3, SPIN 2, RETURN 3) | 1.44 u / 14° | 0.44 u | 0.8 s |
| FORCE 1 | 0.41 u / 12° | 0.13 u | 0.6 s |
| FORCE 5 | 2.88 u / 19° | 0.88 u | 1.0 s |
| RETURN 1 (floaty) | 1.70 u / 16° | 0.76 u | 1.0 s (2.3 s for medium cubes) |
| RETURN 5 (tight) | 1.12 u / 14° | 0.21 u | 0.6 s |
| FORCE 5, SPIN 4, RETURN 1 | 3.40 u / 27° | 1.49 u | 2.0 s |

Stability: 60 s of continuous strikes at 140 BPM with CAVES 3 stays finite at both the default
settings (max offset 1.9, mean 0.12) and the most extreme ones (it reaches the 6-unit clamp,
mean 0.46). When every core cube is blasted outward at once, touching cubes still overlap
briefly by up to 0.27 units at the defaults (0.64 at the extremes). Collision is soft, and only
between cubes that touch at rest.

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
