# SQNCR (seq.halfof8.com): every mechanic, reverse-engineered

> Source: the production bundle `https://seq.halfof8.com/assets/index-h8KNsbwh.js` (≈300 KB,
> React 18 + Zustand, Canvas 2D, Web Audio). I de-minified it and read every line of the
> application code, from the voice tables and synthesis to the renderer and UI. Minified identifiers
> are given in `code` so each claim can be checked against the bundle. The URL studied was
> `?style=city&seed=1595866095&fx=8`.
>
> Part II (§14–§16) turns these mechanics into a design for **Volum3**, the 3D cube-cluster version.

---

## Contents

**Part I — What SQNCR does**

1. [Concept in one paragraph](#1-concept-in-one-paragraph)
2. [URL parameters and the example URL decoded](#2-url-parameters-and-the-example-url-decoded)
3. [World, grid and time](#3-world-grid-and-time)
4. [The four styles](#4-the-four-styles)
5. [The sixteen voices](#5-the-sixteen-voices)
6. [Composition engine (how a seed becomes a piece)](#6-composition-engine)
7. [Harmony: keys, scales, chords, melody](#7-harmony)
8. [Recordings: analysis, slicing, casting](#8-recordings-analysis-slicing-casting)
9. [Transport and scheduler](#9-transport-and-scheduler)
10. [Audio engine: buses, synthesis, effects](#10-audio-engine)
11. [Visual system](#11-visual-system)
12. [Interaction](#12-interaction)
13. [Persistence, sharing, UI shell](#13-persistence-sharing-ui-shell)

**Part II — Visual DNA and the 3D translation**

14. [PatternGen: the shared visual DNA](#14-patterngen-the-shared-visual-dna)
15. [Mapping SQNCR → the 3D cube sequencer](#15-mapping-sqncr--the-3d-cube-sequencer)
16. [Physics and rendering spec for Volum3](#16-physics-and-rendering-spec-for-volum3)

---

# Part I — What SQNCR does

## 1. Concept in one paragraph

SQNCR ("A/V exp by ½8") is a one-screen generative instrument. **The canvas is the score**:
a 1920×1080 field divided into 20 px cells, where **columns are time, rows are pitch**, and
every coloured 40×40 tile is one sound. A 32-bit seed plus a style deterministically writes
the whole piece: rhythm, harmony, placement and colours. A vertical playhead sweeps left to
right. When it crosses a tile, the tile's sound fires and the tile *re-draws itself* with a
pattern-specific animation. The tile also **throws "emissions"**: rings of dots and blocks that
bloom outward cell by cell and fade. If you drop in an audio recording, it is analysed, chopped
into slices, cast as "lead" and "hit" parts, and scattered on the grid as white letter tiles.
Those tiles do a 3D quarter-turn each time they play.

## 2. URL parameters and the example URL decoded

Parsing is in `QS`/`KS`. Every parameter is clamped:

| Param | Range | Meaning |
|---|---|---|
| `style` | `city` \| `gagaku` \| `koto` \| `ma` | The style. It sets music, looks, placement and effect. |
| `seed` | 0 … 2 147 483 647 | Seed of the voice/placement PRNG |
| `bpm` | 50 … 180 | Tempo |
| `swing` | −50 … 50 (÷100) | Delay of odd 16ths |
| `density` | 0 … 20 | "HOW MUCH PLAYS AT ONCE" |
| `variation` | 0 … 20 | "HOW FAR EACH REPEAT DRIFTS" |
| `takes` | 1 … 4 | Number of recording slots ("SLOTS") |
| `blend` | 0 … 20 | How far the recording sits in the band (saturation, glue, ducking) |
| `repeats` | 3 \| 4 | Number of sections the 96 columns are split into |
| `key` | 0 … 11 | Root pitch class (0 = C) |
| `fx` | 0 … 8 | Style amplifier ("STYLE AMPLIFIER"). 4 = as written, 0 = none, 8 = double |
| `grain` | 1 … 5 | EMISSION level (what a sound throws) |
| `hand` | base36 string | Hand-placed voices, 3 chars each (see §13) |
| `debris` | flag | Hidden look: fading blocks dissolve into pattern mosaics |

The URL only records values that differ from the style preset. It updates itself through
`history.replaceState`, debounced to 500 ms (`e2`/`tm`).

**Decoded `?style=city&seed=1595866095&fx=8`:** CITY style (街), preset BPM 100, swing 0.11,
key F (root 5), mood *bright* → **major** scale (city's melody mode is `changes`), density 20
(the maximum), variation 6, grain 3, repeats 4. `fx=8` drives CHORUS to full: detune ("ombak")
is 13 × 2 = **26 cents**, tremolo depth 0.16 × 2 = 0.32, and delay sends × 1.5.

## 3. World, grid and time

Constants (bundle top): `M=20` (cell px), field `Ve=1920 × gt=1080` → **96 columns × 54 rows**.
The panel sits in 280 px above the field and 160 px below it (`af`, `Um`).

* **Step** = one 16th note: `stepSec = 60 / bpm / 4`. The whole loop is **96 steps**.
* **Sections** ("repeats"): the 96 columns are split into `repeats` equal sections of
  `patternSteps = 96 / repeats` steps. 4 repeats gives 24 steps, 3 repeats gives 32.
* **Bars**: every section is **2 bars**, with `barSteps = patternSteps / 2` and `barBeats = barSteps / 4`.
  So `repeats=4` gives **3/4 bars** (12 steps each) and `repeats=3` gives 4/4 bars (16 steps each).
* At 100 BPM a step lasts 0.15 s and the loop lasts 14.4 s.
* **Swing**: odd steps are delayed by `swing × 1.2 × stepSec` (`timeOf`).
* **Tiles**: a voice event is 2×2 cells (40×40 px). A recording clip is 4 columns × 2 rows (`bt=2`, `Ps=4`, `be=2`).
  Rows snap to even values (`mf(2)` → rows 0, 2, …, 52).
* **Occupancy** (`hf`): a `Uint8Array(96×54)` collision grid, so tiles never overlap.
  A tile that plays in several sections books every copy (`kw.copies`).
* **Masks**: every event carries a bitmask of the sections it sounds in (`mask`). One
  written event is drawn and played once per set bit, at `step + section × patternSteps`
  (`Cn`). This is how a pattern *repeats* with *variation*.

## 4. The four styles

Each style (`br`) bundles music, looks, placement, rhythm engine, effect and a sound
("tone") profile:

| | CITY 街 | GAGAKU 雅 | KOTO 箏 | MA 間 |
|---|---|---|---|---|
| Music (author's words) | City pop out of every café | Court music at New Year | A station as the train arrives | The pause, hotel lobbies |
| Looks | "Scattered and hectic, never still" | "Marks meet straight up or across, like a crossword" | "Diagonal runs (escalators) and dots coming off them" | "Tall stacks, far apart, throwing big blocks" |
| Placement | `scatter` | `rook` | `bishop` | `pillar` |
| Beat engine | `city` | `ring` | `weave` | `breath` |
| Grid quantise | 1 | 2 | 1 | 2 |
| Chords / section | 2 | 1 | 2 | 1 |
| Voicing | seventh | pad | pad | pad |
| Melody contour | `hook` | `core` | `interlock` | `float` |
| Melody mode | `changes` (major/minor) | `modal` (pentatonic) | modal | modal |
| Effect (fx knob) | CHORUS | METAL | SHIMMER | DISTANCE |
| Preset BPM / swing | 100 / .11 | 80 / 0 | 120 / .04 | 60 / 0 |
| Root / mood | F / bright | D / dark | A / dark | D / dark |
| Grain / density / variation | 3 / 20 / 6 | 2 / 20 / 0 | 1 / 20 / 0 | 5 / 7 / 6 |
| Tone decay / hold / reverb / space(s) | 1 / 1 / 1.25 / 2.2 | 2.4 / 1.6 / 2.3 / 4.6 | 1.3 / 2.2 / 1.6 / 3.2 | 3.2 / 1.4 / 2.8 / 6.4 |
| LFO Hz / depth, ombak (cents), shimmer | .9/.16, 13, 0 | .16/.3, 9, 0 | .28/.2, 6, .45 | .09/.42, 12, 0 |

**Group weights** (`weight`) scale how many notes each family keeps (via `zh` thinning) and
their velocity. For example, city has `perc 0.8`, and ma has `back 0.15, low 0.35`.

**Chord turns** (`turn` for minor, `turnMajor` for major): lists of candidate scale degrees,
one per chord slot. City major is `[[0],[3],[4],[2,4],[5,3],[3],[1,3],[4]]`
(I–IV–V–iii–vi–IV–ii–V, the "royal road" family). The picker `j1` keeps only candidates that
form a triad with a perfect fifth and a major or minor third, and avoids repeating the previous chord.

**Effect knob** (`oc` → `effect.at(tone, fx/8)`):
* CHORUS: `ombak × 2r`, `lfoDepth × 2r`, `delay × (0.5 + r)`
* METAL: `strike = 0.1 + 1.1r`, hold/reverb/space scaled. This moves drums from "skin" to "bronze".
* SHIMMER: `shimmer = min(1, shimmer × 2r)`, which is the octave-up reverb feedback
* DISTANCE: interpolates along the "warmth ladder" AS IS → SOFT → WARM → HAZE → FAR. Each step
  multiplies decay, hold, reverb, space and ombak, and adds a `soften` attack (up to 40 ms).

## 5. The sixteen voices

Four groups: BEAT, TOP, COLOUR and TUNED (`fr`). Each voice has a pattern glyph, base MIDI note,
decay, gain, reverb send, delay send and rhythmic grid:

| Voice | Group | Glyph (40×40 SVG) | MIDI | Decay | Gain | Rev / Dly | Blurb |
|---|---|---|---|---|---|---|---|
| KICK | beat | circle_fill | 36 | .34 | 1 | .05/0 | Short tuned thump |
| SUB | beat | circle_stroked | 31 (pitched) | .6 | .85 | .08/0 | Long low sine, follows the key |
| SNARE | beat | square | 62 | .2 | .8 | .14/.05 | Tone plus a band of noise |
| CLAP | beat | dots_dice | 66 | .26 | .72 | .22/.08 | Three noise bursts |
| RIM | top | dots_cross | 78 | .09 | .62 | .1/.16 | Dry click, pitched edge |
| HAT | top | dots_6x5 | 84 | .06 | .5 | .04/.04 | Closed, on the offbeats |
| OPEN | top | dots_diagonal | 84 | .34 | .44 | .14/.1 | Open hat |
| SHAKE | top | stripes_diagonal | 90 | .11 | .4 | .08/.04 | Soft noise sweep |
| TOM | colour | capsule_eight | 48 | .3 | .7 | .14/.06 | Falling skin |
| CONGA | colour | capsules_H | 57 | .22 | .62 | .12/.1 | Hand-drum attack |
| NOISE | colour | capsule_diagonal | 70 | .55 | .34 | .26/.1 | Filtered noise rise |
| COW | colour | cross_rotated_45 | 74 | .24 | .44 | .12/.14 | Two detuned squares |
| BASS | tuned | capsule_H_extended | 43 | .42 | .78 | .06/.05 | Plucked bass in key |
| CHORD | tuned | capsules_horizontal | 64 | .7 | .4 | .3/.12 | Three-note stab |
| ZAP | tuned | arrow | 72 | .18 | .42 | .14/.26 | Fast downward sweep |
| BELL | tuned | cross | 79 | 1.1 | .42 | .34/.22 | Struck bell, long tail |

**Colour**: voice *i* takes pair `i mod 15` from the palette (§11.1). Every tile has a
**background colour** and a **foreground (glyph) colour**.

## 6. Composition engine

Entry point: `_w(sources, settings, {voices: seed, slices: sliceSeed}, handEvents)`.

**PRNG**: `_n(seed)` is **mulberry32** (`+0x6D2B79F5`, `imul` xor-shift), returning [0,1). This
is the same generator PatternGen uses.
Three streams are used: `voices`, `slices`, and `voices ^ 23407` (placement). String hashing is FNV-1a (`Yv`).

Order of operations:
1. Hand-placed events (from the URL or the user) are re-placed first (`Cw`).
2. Recording clips are placed (`Ow`, §8).
3. For every enabled voice, in table order (`Mw`):
   1. **Rhythm figure** (`Q1`). City uses `q1`; the other styles use `X1` with their own beat mode.
      The result is `figure` (bar 1) and `fill` (bar 2), in beats, converted to steps (`Te`, ×4).
      * `low` (kick): one pick from `$h` (e.g. `[0,2.5]`, `[0,1.75,2.5]`) limited to 2–4 hits by
        density. The fill is a pickup at `beats − 0.5`. SUB plays beat 0 with a fill at `beats − 1.5`.
      * `back` (snare/clap/rim): the backbeats (beats 2, 4, … counting from 1). A heavy groove (`amount > .55`) adds `beats − 1.25`.
        The fill is `beats − .75, beats − .25`.
      * `tick`: HAT evenly divides the bar (`Ll`) into `lerp(density, beats, 2·beats)` hits.
        Others use half that, offset by ¼.
      * `perc`: **Euclidean** distribution (`i0`, a Bresenham rhythm) of `lerp(density, 2, 6)` hits,
        rotated by 1–3 steps.
      * `bass`: one of six syncopated figures (`Y1`). `tone`: CHORD uses figures `K1`, BELL hits beat 1.
        `colour` (zap/noise) only plays fills.
   2. **Thinning** by group weight (`zh`), with a **minimum gap of 2 steps** between hits (`Fh`, `G1`),
      then quantised to the style grid (`Bh`).
   3. **Section mask** (`V1`): which sections a voice may play in. For example, OPEN plays only the 2nd and 4th sections, SHAKE
      the 1st and 3rd, ZAP only the 2nd, and NOISE only the last (a lift into the loop point). SUB
      skips alternate sections except in the ring and breath styles. The snare/clap/rim family and the perc family *rotate* sections between members.
   4. **Variation mask** (`m0`): after the voice's first note, each further section is dropped with
      probability `(variation/20) × 0.4`.
   5. **Melody contour** for pitched voices (`t0`): `hook`, `core`, `interlock` or `float` walks
      over degree offsets clamped to ±range. `na` keeps the last note from repeating the one before.
      The contour value is an **octave band** (−3…+3).
   6. **Placement** (`Sw`), as a row choice for a column fixed by time:
      * `scatter` (city): a shuffle bag of all even rows, nearest allowed.
      * `rook` (gagaku): prefers the free row that **touches the most existing tiles**, scored
        by `holding`: 1 for a corner, 2 for an edge, 3 for a full shared edge. This is why marks meet
        "like a crossword".
      * `bishop` (koto): `row = start + dir × column`, reflected at the top and bottom. The result is
        diagonal zig-zags ("escalators").
      * `pillar` (ma): prefers rows with free neighbours above and below, so tiles build tall stacks.
      * `rook` and `pillar` then run a `settle` pass (`h0`, 3 iterations) that nudges tiles toward
        shared edges.
      * Collisions: `placeAtColumn` takes the nearest free row. `placeNear` searches ±2, ±4 … columns.
   7. **Event record**: `{step,row,span:2,rows:2,mask,patternId,colors,clipSide,velocity,voiceId,midi,salt}`.
      * `clipSide` is a random edge (top, bottom, left or right). The background wipes in from that side.
      * **Velocity** = `(0.46 + accent·0.09 + rand·0.06) × (0.5 + weight·0.5)`, where accent is
        5 on a bar downbeat, 3 on a beat, 2 on an even step and 1 otherwise (`f0`).
      * **Pitch**: rows map to an octave band via `Ef(row) = round((0.5 − row/54)·6)` (−3…+3,
        with the **top of the screen being higher**). BASS, SUB and CHORD use a chord-tone ladder (`wf`).
        The other voices use the scale degree (`e0`).
4. `chords` holds labels for display, such as `FMAJ` or `DMIN`. `z1` builds them per section and slot.

**Generate** keeps the settings and draws new `seed` and `sliceSeed` values. **CUT UPLOADED
AUDIO** changes only `sliceSeed` ("chop it again, music untouched").

## 7. Harmony

* Scales (`yf`): MIN PENT, MINOR, MAJ PENT and MAJOR. Style mood plus melody mode picks
  the scale (`Al`). Modal styles use pentatonic scales. `changes` (city) uses the full diatonic scale.
* `dr(key, base, degree)`: scale degree → MIDI note, wrapping octaves. `ho` converts MIDI to Hz
  with A4 = 440.
* **Chord progression** (`vf`): the degree for (section, bar) comes from the style turn list,
  with 1 or 2 chords per section.
* **Voicings** (`D1`): `triad`, `pad` (triad + octave) or `seventh` (triad + 7th degree).
* **Bass, sub and chord follow the changes** at play time (`noteOf` → `Ew`). Their pitch is
  recomputed from the *current* chord and the tile's row, so moving a tile vertically changes its
  inversion or register. Notes below MIDI 28 are raised an octave.
* **Strong-beat snapping** (`sung`/`b1`): in `changes` mode, melodic notes that land on the bar
  downbeat or the half-bar are pulled to the nearest chord tone within ±6 semitones.
* The on-screen **KEY keyboard** (one octave) lights each pitch class *while it is sounding*.
  `notes` holds pitch class → release time, and each note stays lit for `clamp(decay, .12, .66)` s.

## 8. Recordings: analysis, slicing, casting

The panel says "DROP AUDIO — one only. Chopped and scattered". A test set also exists at
`/mock/manifest.json`: water, steam, valve, machinery and bell `.wav` files.

1. **Decode** the file and mix it down to mono (`mS`).
2. **Features** (`SS`):
   * RMS envelope in 512-sample frames.
   * **Onsets**: a frame counts when it exceeds 1.8× the mean of the previous 0.12 s, is above 8 %
     of the peak, and is rising, with a ≥ 40 ms gap between onsets.
   * **Spectral centroid and flatness** (noisiness) from up to 96 Hann-windowed 2048-point FFT frames
     (a custom radix-2 FFT, `hS`), weighted by energy.
   * **Pitch** by normalised autocorrelation at the loudest point, searching 55–1200 Hz, accepted
     when the correlation is ≥ 0.4.
3. **Slicing** (`OS` + `CS`): cuts at onsets, filling gaps with a regular grid of `dur/20`
   (clamped). Each slice lasts `clamp((next − start) × ratio, minSec, maxSec)`, with defaults
   **0.6–5.0 s** and ratio 1.3. The cap is 96 slices, plus 1/3/5 "long" slices for longer files.
   Each slice is re-analysed (`_S`) for RMS, peak, crest (transient), zero-crossing brightness,
   pitch, noisiness and score. Quiet slices (< 3.5 % of the loudest) are dropped.
4. **Key suggestion** (`em`): a pitch-class histogram (weighted by `min(4,dur)·(0.35+rms)`) is
   cosine-matched against a template: root 3, fifth 2.2, third 1.6, other scale tones 1.
   A score ≥ 0.55 marks the key with a **red outline** on the keyboard, and the key is auto-applied
   unless the user has pinned one.
5. **Casting** (`R1`): the pattern `lead, hit, hit, hit, hit` fills up to `takes` slots.
   *Lead fitness* favours pitched, tonal, loud, short slices. *Hit fitness* favours transient
   score. Picks are biased toward the best with `pow(rand, 2.2)` over the top 6.
6. **Clip rhythms**: lead uses `Iw` phrase shapes (a denser list for non-city styles). Hits use
   `Rw` (two hits per bar, such as `[1,3]` or `[0.5,2.5]`) with ≥ 4-step spacing. Lead rows follow a
   contour. Hit rows come from a shuffle bag.
7. **Playback** (`tS`): the buffer is played through a 38 Hz high-pass. Gain is normalised to
   `clamp(min(.085/loudness, .85/peak), .2, 8)`. The envelope has an 8 ms attack (90 ms for long
   slices), then a hold, then a release of up to 110 ms (400 ms long). The window is 4 steps for a
   lead and 2 for a hit. Clips go to the *material bus* (§10.2).
8. **Waveform strip** under the grid: the source label, a peak-envelope bar graph, and the slice
   spans in the source colour. Each span **flashes** when its clip plays: attack over 4 steps
   (easeOutCubic), decay over 6 steps (`D2`). You can drag slice start, end or body. On release
   the slice is re-analysed (`settleSlice`).

## 9. Transport and scheduler

`dS` (singleton `Le`) uses the classic *"two clocks"* design:

* A `setInterval` runs every **20 ms**. It schedules every step whose time is less than
  `audioCtx.currentTime + 140 ms`, so sound is sample-accurate while visuals run on rAF.
* `fire(step)` does three things for each occurrence at that column: it sets `hitAt[key] = audioTime`,
  throws emissions, and calls `sound()`. For clips it also increments `turns[key]`, which drives the
  3D letter flip.
* The runtime publishes `position` (fractional step), `section`, `hitAt`, `emissions` and `notes`.
  The renderer reads these every frame against `audioCtx.currentTime`. **All visual timing is on
  the audio clock.**
* `flash(ids)` handles drop, add and move: the affected tiles re-strike, staggered **18 ms** apart,
  and the grabbed tile auditions once. `burst(ids)` does the same for deletes, visuals only.
  `sweepPast(x0,x1)` makes the style-swap wipe throw emissions without sound.
* Audio unlock (`m1`): the first pointerdown, touchend or keydown resumes the context and plays a
  1-sample silent buffer. This is the iOS/Safari workaround.

## 10. Audio engine

### 10.1 Master

`master gain 0.72 → DynamicsCompressor(−14 dB, knee 18, ratio 3, 18 ms / 500 ms) → out`.

### 10.2 Shared buses (`vt`)

| Bus | Chain |
|---|---|
| **Plate reverb** | `plateIn → Convolver(IR) → HP 240 Hz → ×0.55 → master`. The IR is **procedural**: stereo noise, one-pole smoothed (`y = .55y + .45n`), shaped by `(1−x)^2.6`, with the first 12 ms at 15 %, from a fixed seed. Length = the style's `space` (2.2 s for city). The IR regenerates when `space` changes, and the output is compensated by `0.55·min(1, 1.9/space + .45)`. |
| **Delay** | `delayIn → Delay(= min(1.8 s, ¾ beat), a dotted 8th) → LP 2600 → feedback 0.34`. Output ×0.42 to master. |
| **Shimmer** (koto) | The plate feeds a **delay-line pitch shifter** (two sawtooth-swept taps, raised-cosine crossfade, 80 ms grain) shifting **+1 octave**. Then a 5.2 s convolver, HP 400, LP 3200, and ×0.35 out. A 0.34 feedback loop returns into the shifter, so the tail keeps climbing. Send = `shimmer × 0.6`. |
| **Material** (recordings) | `materialIn → HP (40 + 180·blend) → tanh WaveShaper (drive .05 + 3.4·blend, 4× oversampled) → makeup → duck gain → Compressor "glue" (−22 − 8·blend dB, ratio 2.6 + 1.9·blend)`. The **kick and sub duck this bus** (sidechain-like): depth `0.42·blend`, 6 ms in, 0.13 s hold, 80 ms release. LEVEL sets the input gain `0.25 + 1.25·level`. |

Every note gets its own `Gain → StereoPanner`, plus send gains to the plate and delay (`Uw`).
They are disposed 220 ms after the note ends.

**Pan = `(row/(54−rows) − 0.5) × 0.5`**, so vertical position also places the sound in the
stereo image (±0.25).

### 10.3 Envelope and modifiers (`T0`)

* `pt`: linear attack (base + `soften`) to the peak, then an exponential decay to 1e-4 over `h`.
* The decay stretch comes from the style tone. *Sustained* voices (sub, bell, chord, noise, cow)
  take `decay` directly. Drums take `1 + (decay − 1)·strike`, which is the METAL knob.
* Loudness compensation: `1/√stretch` for sustained voices, `^0.35` for drums.
* **Velocity curve**: `gain × 0.5 × (0.45 + 0.55·velocity) × comp`.
* **Tremolo** (`jw`) on sustained voices: a sine LFO at `lfoHz × U(0.72, 1.28)` with depth `lfoDepth`.
* **Ombak** (the Balinese "beating"): sub, bass, bell, chord and cow are doubled at ±ombak/2 cents.

### 10.4 Synthesis per voice

| Voice | Recipe |
|---|---|
| KICK | Sine 130 → 46 Hz exponential over 70 ms. Plus a 20 ms noise click, HP 1400, ×0.35. |
| SUB | Sine at the note ×1.04 gliding to the note over 90 ms (per detune). |
| SNARE | Triangle 196 → 150 Hz (half decay) + noise → BP 1900 Hz Q .9. |
| CLAP | Three noise bursts at 0 / 9 / 19 ms (×.7/.85/1) → BP 1250 Q 1.3. |
| RIM | Squares at 1720 + 2540 Hz → BP 2100 Q 3.5, 0.5 ms attack. |
| HAT / OPEN | Noise → HP 7200 → BP 10.5 kHz Q 1.2 (the decay alone sets closed vs open). |
| SHAKE | Noise → BP 6200 Q .7 with a 16 ms attack. |
| TOM / CONGA | Sine at 2× the base note ×1.35 falling to 2× over 70 % of the decay. Plus a 30 ms LP-3200 noise tick. |
| BELL | Additive partials **1, 2.76, 5.4, 8.9** × f, amplitudes 1/.5/.28/.14, decays 1/.62/.36/.2 × h. |
| COW | Squares 562 + 845 Hz → BP 2400 Q 2.2. |
| BASS | Saw (per detune) + sine one octave down ×.6 → LP Q 6 sweeping from min(5200, 9f) to max(120, 2f). |
| CHORD | Triangles at every voicing tone → LP 2400. The attack grows with decay² (a softer pad). |
| ZAP | Saw 4f → f/2 sweep → LP 4200 Q 4. |
| NOISE | Noise → BP 320 → 4600 Hz sweep, Q 1.4. The gain *rises* over 70 % of the note, then cuts (a "lift"). |

While the long-press menu is open (§12), hovering over a voice auditions it immediately.

## 11. Visual system

### 11.1 Palette and type

* Background `#101010`. Grid lines `#181818` (1 px every cell). Ink `#DDDACA`. Dim `#323232`,
  `#62615A`, `#9E9B92`. **Accent red `#F74227`**, used for hover, the selected key and the "live" title.
* Five hues `#DDD9C7, #67B1B5, #97AD4E, #E1A14B, #F74227`. Each expands to three (bg, fg) pairs
  (`t1`), giving 15 two-tone combinations. Examples: bone `#DDDACC`/black, teal `#3D5B5D`/`#95BFC2`,
  ochre `#8C6A34`/`#E0A85A`, olive `#4E5635`/`#9BAC5B`, brick `#E45237`/black.
* Recording clips are **pure white `#FFFFFF`** with black letters. White is reserved for
  recordings.
* Typeface: DM Mono 400/500, uppercase, tracking .04–.08 em. Style names are shown as kanji from a
  1.6 KB subset of Noto Sans JP (街 雅 箏 間).
* **Glyphs**: 16 hand-drawn 40×40 SVGs, recoloured by string replacement (`black` → fg,
  `white` → none) and rasterised once per colour. The shapes are also parsed into primitives
  (rect or circle, rotation, stroke) so they can be animated per shape. Examples: `circle_fill` is a
  13 px-radius disc; `square` is a 28 px frame with a rounded 12 px hole; `cross` is a plus
  with concave rounded inner corners.

### 11.2 Tile draw and the "strike" animation (`Zl`)

Every tile is drawn at a **progress `u ∈ [0,1]`**. At `u = 1` it is fully drawn.

1. **Background wipe** from the tile's `clipSide`: a rectangle growing to `u` of the tile.
2. **Glyph animation**, chosen by the pattern family:
   * `dots`: each dot fades in with its own seeded stagger: `α = clamp((u − s·0.6)/0.4)`.
   * `capsule`: each capsule **grows from its centre along its long axis**: `clamp((u − s·.3)/.7)`.
   * `stripes`: stripes sorted by x each **drop in from above**, staggered by index.
   * `circle`: a **clockwise pie reveal** from 12 o'clock.
   * `arrow`: **slides up** from below.
   * `square` / `cross`: **zoom in** from 1.6× to 1×.

**On every hit** (`P2`), the tile's progress snaps to **0.06** and eases back to 1 over
**4 steps** with easeOutCubic. So each note visibly *collapses and redraws* its tile. This is the
core "it reacts when played" mechanic.

### 11.3 Emissions: the ripple (`Nl`), the most important mechanic for Volum3

When a tile fires, it throws particles onto the **grid cells in concentric rectangular rings
around itself**:

* `energy = min(1, velocity × 0.85)`. Clips use ×1.25 and are always ink-coloured.
* **Number of rings** = `1 + round(energy·2) + max(0, grain − 3)`. That is 1–3 rings, and 5 at grain 5.
* **Per ring**: `max(2, round(2 + energy·3.2))` random distinct cells on that ring's perimeter
  (`u1`: cells at Chebyshev distance *p* from the tile's cell box).
* Each particle is either a **dot** (an 8 px circle centred in the cell) or, with **32 %** chance
  when grain ≥ 2, a **block** (a square of 20/20/40/40/60/80 px, `jh`). Grain 2 allows the
  first four sizes. Grain ≥ 3 allows all six.
* **Timing (the travelling wave)**: `bornAt = hit + (ring−1) × 0.07 s`, so the ripple expands
  outward at one ring per 70 ms. Each particle holds full opacity until
  `fadeAt = born + 0.35 + rand·0.55`, then fades linearly until `deadAt = fade + 0.3 + rand·0.5`.
* Particles take the **tile's background colour**, so a chord throws teal and a kick throws bone.
* Budget: during playback, new throws are skipped while more than 300 particles are alive. Mass
  events (the intro and swaps) subsample to `max(2, 600/n)` particles per tile.
* EMISSION knob descriptions from the help page: 1 "dots only", 2 "dots and the smaller blocks",
  3 "dots and blocks of every size", 4 "every mark, thrown further", 5 "every mark, thrown
  furthest".
* `?debris`: while fading, a block dissolves into a shuffled mosaic of 10 px pattern thumbnails
  (`Q2`/`G2`).

### 11.4 Recording clips flip like cubes (`F2`/`$2`)

A clip shows two letter squares: the first letter of the file name and the take number. Each
square is rendered as a **square rotating about its vertical axis in 3D**, projected
orthographically. The four corners rotate by θ, back-facing faces are culled, and each visible
face is shaded with brightness **`190 + 65 × (face width / size)`**, which is a Lambert-like term.
As the playhead crosses a letter, θ advances **exactly 90°** (`turns + easeInOutCubic(progress)`),
timed to the playhead passing that letter. So every loop the clip visibly *rolls* like a die.

### 11.5 Playhead, score furniture, layout

* **Playhead**: a 2 px vertical line from 40 px above the field to 40 px below, with a 20×20 cap
  square. It is ink while playing and 45 % while stopped. `x = position/96 × 1920`.
* **Section dividers**: dashed `[10,10]` lines. Chord-change dividers are dotted `[2,8]`. Section
  numbers and **chord names** sit above the field, and the current ones light up.
* **Corner brackets**: four 80×4 px L-marks frame the field.
* **Layout**: the field is scaled to fit (`pc`), centred, and scrolls with the wheel if the window
  is short. Device pixel ratio is capped at 2.
* **Highlight**: hovering a clip draws a 55 % line joining every placement of the same slice,
  in the source colour.
* **View modes** (two dots right of the field): *PANEL BACK* (panel at 10 %) and *PANEL AND SCORE
  BACK, GRID FORWARD* (score at 22 %, grid lines brightened to `#3a3a3a`).

### 11.6 Intro sequence (`U0`, `x2`, `m2`), about 3.7 s

| t (s) | Event |
|---|---|
| 0 – 0.5 | An 80 px square grows from the centre (easeOutCubic), shown as corner brackets |
| 0.5 – 1.2 | Height opens to 1080 (easeInOutCubic) |
| 1.2 – 2.1 | Width opens to 1920 |
| 0.08 – 1.88 | **26 "flying" tiles** (one per voice, the last four being white label bars such as "KICK") are born, hop 1–2 times inside the growing frame, and die. A booking table prevents overlaps in space and time. Each birth and death throws an emission burst. |
| 2.1 | The panel starts its **scramble-text** reveal. |
| 2.1 – 3.7 | **Sweep reveal**: a soft edge 120 px wide travels left→right (`om`). Every tile is *struck* as the edge passes, at `2.1 + 1.6·(x+240)/2160` s, throwing its emissions. The result is a **wave of ripples crossing the score**. |

A click or Space skips the intro.

### 11.7 Generate / style swap (`y2`, `X0`)

A **1.6 s wipe** runs. The old composition is erased (`1 − om`) while the new one is revealed
(`om`) behind the same moving edge. `sweepPast` makes each new tile throw emissions as the edge
crosses it. The result is a travelling wavefront.

### 11.8 Text reveal

Panel labels type in at 38 ms per character, followed by 1–2 random glyphs from
`A–Z0–9/\|<>=+*·` that re-roll every 44 ms, plus a block cursor. Rows are revealed in staggered
"parts".

## 12. Interaction

| Gesture | Effect |
|---|---|
| **Space** | Play / stop. It also skips the intro. |
| **Press and hold 180 ms** on an empty cell | A **radial menu** opens: four panels (BEAT / TOP / COLOUR / TUNED) fly out around the pointer (150 ms in, 130 ms out). Hovering an entry **auditions** it. Releasing places it (snapped to even cells, collision-resolved) and strikes it. Moving more than 20 px cancels. |
| **Drag a tile** | Moves it, and **every copy across sections moves with it**. It snaps to 2-cell steps, collisions are resolved by spiral search (`Uc`), and pitch is re-derived from the new row. On release it re-strikes. |
| **Cmd/Ctrl + drag** | Duplicates, then drags the copy. |
| **Right-click** | Deletes the tile under the pointer (with an emission burst). **Cmd + right-click** deletes the whole recording and all its cuts. |
| **Drop an audio file** | The drop overlay says "DROP RECORDINGS — THEY BECOME A SEQUENCE". Only the last file is used, and it replaces the previous source. |
| **Drag slice edges** in the waveform strip | Trims the slice start or end, or moves the slice body. The cursor changes to `ew-resize` or `grab`. |
| **Panel dials** | Every control is a *word followed by a row of cells*. Click or drag across the cells to set a value. BPM and EMISSION numbers also accept **horizontal scrubbing** (6 px per unit). SWING is five tick marks whose odd ticks slide. The style amplifier is a **fan of 9 needles** (−45° … +45°). |
| **Esc** | "Out to the shelf": the app window shrinks into a diagonal **stack of framed windows** (each deeper one scaled ×0.88 and offset +40 px, −40 px) showing the author's other projects as videos. Wheel or arrows browse them, Enter or a click returns. The easing lasts 460 ms (or 1900 ms). |
| Touch-only device | "OPEN ON A DESKTOP" screen, with an option to continue without sound. |

## 13. Persistence, sharing, UI shell

* **Shareable URL** (COPY URL, plus X / Threads / Telegram / LINE): only non-default values are
  written. Hand-placed voices are packed **3 base36 chars each**: voice id (4 bits), step/2 (4),
  row/2 (5) and clip side (2).
* **SAVE / LOAD**: a `*.synthgen.json` file (`format:"synth-gen"`, version 5) holding every setting
  plus the recordings embedded as base64, so a project is self-contained.
* **Panel layout** (three rows above the field):
  * Row 0: SQNCR · PLAY · REWIND · STYLE (kanji + effect needle) · KEY (keyboard) · HELP · SAVE · LOAD
  * Row 1: GENERATE · CLEAR · DENSITY · VARIATION · EMISSION · BPM · SWING
  * Row 2: CUT UPLOADED AUDIO · SLOTS · LENGTH · BLEND · LEVEL · DELETE
  * **HELP** explains every control in one terse line. Examples: "GENERATE — a new piece, same
    sounds"; "BLEND — how far it sits in the band".

---

# Part II — Visual DNA and the 3D translation

## 14. PatternGen: the shared visual DNA

[halfof8/patterngen-oss](https://github.com/halfof8/patterngen-oss) is the author's motion-graphics
generator (React + Zustand + Canvas 2D, a Figma plugin and a Blender add-on). SQNCR reuses its code
almost line for line. The tile animator `Zl`, the SVG shape parser, the `clipSide` wipes, the
easing table and mulberry32 are all copied from it. Knowing PatternGen explains *why* SQNCR looks
the way it does.

**Shared grammar**

* **A 20-unit lattice.** The canvas is 1920×1080 = 96×54 cells. Elements come in 1, 2 and 4 cells
  and are aligned to their own size: 2×2 blocks start on even cells and 4×4 blocks on multiples
  of 4. Tiles butt against each other with **no gutter**, which gives the tight mosaic look.
* **An occupancy grid with greedy, shuffled placement.** The generator shuffles candidates and takes
  the first that are still free, placing by layer in priority order: pattern tiles, then 80 px,
  40 px and 20 px squares, then dots.
* **Clustering by distance.** A multi-source BFS computes the Manhattan distance from the title
  shapes. Tiles must lie within `maxRadius = 2 + floor(proximity × 2.5)` cells. Dots reach 3 cells
  further, forming a **halo of dots around a dense core**. SQNCR's emission rings are the same idea
  applied in time instead of space: blocks near the source, dots further out.
* **Counts grow with density²**: patterns `3 + 40d²`, dots `5 + 50d²`, where `d = density/10`.
* **Colour pairs**: each palette colour P yields three pairs: (P, black or white), (P shaded 55 %
  or tinted 35 %, P), and (P, the shade or tint). Everything is flat and two-tone. There are no
  gradients, blur, shadow or blend modes, and opacity is used only for dots.
* **Motion vocabulary**: a one-sided clip wipe from a random side, capsules growing from the centre,
  stripes dropping in, a clockwise pie, an arrow sliding up, a 1.6×→1× zoom, and dots fading in with
  a per-shape stagger. The default easing is **easeOutCubic**.
* **Stagger**: `start = animDelay × window × dur` with `window = min(.85, stagger/5 × .8)`. It is
  random per element, not spatial. SQNCR *adds* the spatial wave (rings, sweeps).
* **Rhythm**: reveal 1× duration, then hold 3× with dots **breathing** at `0.15 + 0.85·(½ + ½ sin)`
  opacity, 0.15–0.4 Hz each with a random phase.
* **Blender bridge**: PNG sequences are mapped onto stacked planes 0.1 m apart. The texture colour
  also drives **Emission at strength 1.0**, so the patterns are "self-lit" flat colour in 3D. This is
  the author's own precedent for how the style should look in 3D: *unlit, emissive, flat*.
* **No physics anywhere.** Motion is a pure function of time. The only overshoot is in the UI CSS:
  `cubic-bezier(0.34, 1.56, 0.64, 1)`, a back-out curve used on the bar-slider steps and swatches.
* **UI tone**: single UPPERCASE words, discrete **bar sliders** (one segment per integer), values
  shown muted beside the label, 40 px gutters, and terse code comments that explain *why*.
* **Palette**: the thumbnail's teal `#68B4B2`, olive `#97AF51`, orange `#E5A14C`, red-orange
  `#F9402B` and beige `#E0D9C7` are the same family as SQNCR's `Pr`. PatternGen's canvas is
  `#323232`, which SQNCR uses as its "dim" ink.

**What this means for Volum3.** Keep the flat two-tone faces, 1/2/4-unit sizes aligned to a
lattice, the dense-core/dot-halo composition, the wipe and zoom vocabulary for idle or reveal
animations, easeOutCubic, and emissive self-lit colour. The *physics* (springs, overshoot, wave
propagation) is the new ingredient Volum3 brings. Its tuning should borrow the back-out overshoot
`(0.34, 1.56, …)` as the target feel: one visible overshoot, then settle.

## 15. Mapping SQNCR → the 3D cube sequencer

| SQNCR (2D) | Volum3 (3D) |
|---|---|
| 1920×1080 field, 20 px cells | One large cube, about 100 small cubes on an irregular lattice inside it, floating on black |
| Columns = time | **Azimuth around the orbit axis** = time. The indicator's angle is the playhead. |
| Rows = pitch (top = high), also pan | **Height (y) = pitch**, higher cubes sound higher. **Stereo pan** comes from the cube's screen-space x, or from azimuth relative to the camera. |
| Vertical playhead line | **Orbiting indicator** at constant angular velocity ω. It strikes every cube whose azimuth it crosses: a rotating half-plane, like a radar sweep. |
| 2×2 tile, 16 voice glyphs | A cube per note. Voice family → **size, material and colour pair**; glyph → a pattern decal or emissive texture on its faces. |
| Tile collapses to 6 % and redraws over 4 steps | Cube **flashes to white, gets pushed toward the orbit, springs back**, and its colour relaxes over the same 4-step window. |
| Emission rings (1 ring / 70 ms) | **Neighbour propagation**: the impulse reaches lattice neighbours ring by ring (graph distance) through springs, and optional particles spawn on the shell around the struck cube. |
| Clip flips 90° per pass | A cube does a **quarter-roll** about the axis tangent to the orbit each time it is struck. SQNCR already fakes this in 2D with Lambert shading. |
| Occupancy grid, placement styles | Irregular lattice generation: *scatter* (jittered Poisson), *rook* (face-sharing clusters), *bishop* (diagonal chains), *pillar* (vertical stacks). |
| Section masks and variation | Each cube can be **silent on some orbits** (bitmask per revolution) so repetitions drift. |
| Intro sweep with struck tiles | Opening: the cluster assembles, then the first orbit strikes everything with visuals only. |
| Long-press menu / drag / right-click | Pointer "touch": a raycast hit strikes the cube (same reaction as the indicator). Hover auditions. Drag rotates the whole cluster with inertia. |

**Timing**: SQNCR's `stepSec = 60/bpm/4` and 96-step loop map to **one orbit = 96 steps**
(14.4 s at 100 BPM, `ω = 2π / (96 · stepSec)`). The cube's azimuth φ gives its step,
`step = φ/(2π) × 96`, and can be quantised to the 16th-note grid for musical timing or left free
for an "irregular" feel.

## 16. Physics and rendering spec for Volum3

### 16.1 Clock and scheduling (copy SQNCR exactly)

* The **audio clock is master**. A 20 ms scheduler with 140 ms lookahead computes, for every cube,
  the next time the indicator crosses its azimuth: `t = t0 + ((φ_i − θ(t0)) mod 2π)/ω`. The sound
  is scheduled at that exact `AudioContext` time.
* Record `hitAt[i] = t` and read it in rAF against `ctx.currentTime` (not `performance.now()`), so
  the wave is phase-locked to the sound.

### 16.2 Body model

* Each small cube is a rigid body with a **rest position `r0`** in the lattice, position `x`,
  velocity `v`, orientation `q`, angular velocity `w`, and **mass ∝ volume** (so big cubes lag,
  which sells the realism).
* **Anchor spring** to the rest position: `F = −k(x − r0) − c·v`. Use damping ratio ζ ≈ 0.3–0.45
  (visible overshoot and one or two wobbles), with a natural frequency of 3–5 Hz for small cubes,
  scaled by `1/√mass`.
* **Neighbour springs**: connect each cube to its 6–12 nearest neighbours at their rest distance.
  This is what turns a single strike into a **wave through the whole block**, the 3D version of the
  emission rings. Wave speed is roughly `√(k_n/m) × spacing`. Tune it so the front moves about one
  cube per 60–80 ms, matching SQNCR's 70 ms per ring.
* **Strike impulse**: `J = A · energy · n̂`, where `n̂` points from the cube toward the nearest
  point on the indicator's orbit circle ("shift toward the orbital path"). `energy` uses SQNCR's
  velocity formula. Applying J off-centre adds a small torque (`τ = r × J`) for a natural tumble.
  Optionally add the quarter-roll from §11.4.
* **Soft collision**: sphere–sphere or OBB push-apart between neighbours with restitution of about 0.2,
  so displaced cubes jostle instead of passing through each other.
* **Integrator**: semi-implicit Euler or Verlet at a **fixed 120–240 Hz** substep. With about 100
  bodies and about 600 springs this is trivial on the CPU. A physics engine (Rapier/cannon) is
  only needed if you want true box–box contact. A hand-written spring lattice gives more musical
  control.
* **Global float**: a slow idle drift (Perlin, less than 1 % amplitude) and a gentle whole-cluster bob,
  so it "floats in space" even between hits.

### 16.3 Colour and light

* Idle: the base colour from a SQNCR (bg, fg) pair, dim, with physically-based metal/roughness
  on black.
* On strike, **emissive intensity follows SQNCR's envelopes**: attack is instant (or easeOutCubic
  over about 30 ms) to **white**; release blends the colour back through the voice hue over
  4–6 steps (`D2`: 4 steps up, 6 steps down). Interpolate in **linear or OKLab space** so the
  ramp stays clean on its way to white.
* Neighbours woken by the wave get a weaker glow ∝ their displacement, so the travelling
  distortion is also a travelling light.
* Post-processing: **bloom** (UnrealBloomPass) with a threshold just below white, tone mapping
  ACES or AgX, and optionally a faint trail on the indicator.

### 16.4 Rendering

* Three.js `InstancedMesh` of rounded boxes (one draw call). Store per-instance colour, emissive
  and pattern index in instanced attributes, and put the SQNCR glyph as a mask texture on each face.
* The indicator is a small emissive sphere or cube on a thin orbit ring (the ring at about 20 %
  alpha, like SQNCR's stopped playhead), plus a point light that travels with it so faces near
  it catch light.
* The camera is slightly above the orbit plane. Interactive mode uses OrbitControls-style damped
  rotation with inertia.

### 16.5 Interactive mode

* The cluster auto-rotates with a slow constant ω_view, and the user can drag it (inertial).
* Raycast the pointer every frame. On **enter or press** over a cube, apply the same strike as the
  indicator: the impulse points along the ray direction (the cube is "pushed" away from the
  finger). Schedule the sound at `ctx.currentTime + 10 ms`, as SQNCR does for hover auditions.
* **Brush**: strike every cube within a screen-space radius, staggered by distance
  (SQNCR's 18 ms per item for `flash`) so a swipe produces a sweep.
* Debounce each cube (for example, ≥ 1 step between re-strikes) to avoid machine-gunning.

### 16.6 Audio

* Port SQNCR's `T0` voice recipes and its bus graph (§10) as they are. They are small,
  sample-free, and already tuned.
* Assign voices by cluster position: bottom layer BEAT (kick/sub), outer shell TOP (hats),
  middle COLOUR, inner TUNED (bass/chord/bell). Height sets pitch through `Ef` and the scale.
* Distance from the camera can scale the reverb send (the DISTANCE ladder) for depth.
