import { mulberry32 } from './rng.js';

// SQNCR's voice table (§5 of docs/SQNCR_MECHANICS.md), unchanged.
export const VOICES = [
  { id: 'kick', group: 'beat', pitched: false, baseMidi: 36, decay: 0.34, gain: 1, reverb: 0.05, delay: 0 },
  { id: 'sub', group: 'beat', pitched: true, baseMidi: 31, decay: 0.6, gain: 0.85, reverb: 0.08, delay: 0 },
  { id: 'snare', group: 'beat', pitched: false, baseMidi: 62, decay: 0.2, gain: 0.8, reverb: 0.14, delay: 0.05 },
  { id: 'clap', group: 'beat', pitched: false, baseMidi: 66, decay: 0.26, gain: 0.72, reverb: 0.22, delay: 0.08 },
  { id: 'rim', group: 'top', pitched: false, baseMidi: 78, decay: 0.09, gain: 0.62, reverb: 0.1, delay: 0.16 },
  { id: 'hat', group: 'top', pitched: false, baseMidi: 84, decay: 0.06, gain: 0.5, reverb: 0.04, delay: 0.04 },
  { id: 'ohat', group: 'top', pitched: false, baseMidi: 84, decay: 0.34, gain: 0.44, reverb: 0.14, delay: 0.1 },
  { id: 'shaker', group: 'top', pitched: false, baseMidi: 90, decay: 0.11, gain: 0.4, reverb: 0.08, delay: 0.04 },
  { id: 'tom', group: 'colour', pitched: false, baseMidi: 48, decay: 0.3, gain: 0.7, reverb: 0.14, delay: 0.06 },
  { id: 'conga', group: 'colour', pitched: false, baseMidi: 57, decay: 0.22, gain: 0.62, reverb: 0.12, delay: 0.1 },
  { id: 'noise', group: 'colour', pitched: false, baseMidi: 70, decay: 0.55, gain: 0.34, reverb: 0.26, delay: 0.1 },
  { id: 'cowbell', group: 'colour', pitched: false, baseMidi: 74, decay: 0.24, gain: 0.44, reverb: 0.12, delay: 0.14 },
  { id: 'bass', group: 'tuned', pitched: true, baseMidi: 43, decay: 0.42, gain: 0.78, reverb: 0.06, delay: 0.05 },
  { id: 'chord', group: 'tuned', pitched: true, baseMidi: 64, decay: 0.7, gain: 0.4, reverb: 0.3, delay: 0.12 },
  { id: 'zap', group: 'tuned', pitched: true, baseMidi: 72, decay: 0.18, gain: 0.42, reverb: 0.14, delay: 0.26 },
  { id: 'bell', group: 'tuned', pitched: true, baseMidi: 79, decay: 1.1, gain: 0.42, reverb: 0.34, delay: 0.22 },
];
export const VOICE = new Map(VOICES.map((v, i) => [v.id, { ...v, index: i }]));

// CITY, as the example URL plays it: F major, the royal-road family, seventh voicing.
export const KEY = { root: 5, steps: [0, 2, 4, 5, 7, 9, 11] };
const PROGRESSION = [0, 3, 4, 2, 5, 3, 1, 4];
export const STEPS_PER_BAR = 16;

export function degreeToMidi(base, degree) {
  const n = KEY.steps.length;
  const oct = Math.floor(degree / n);
  const d = ((degree % n) + n) % n;
  return base + KEY.root + KEY.steps[d] + oct * 12;
}

export function midiToHz(m) {
  return 440 * Math.pow(2, (m - 69) / 12);
}

export function chordAt(absStep) {
  const bar = Math.floor(absStep / STEPS_PER_BAR);
  return PROGRESSION[((bar % PROGRESSION.length) + PROGRESSION.length) % PROGRESSION.length];
}

// Seventh voicing as semitone offsets from the chord root.
export function chordSpread(degree) {
  const r = degreeToMidi(0, degree);
  return [0, 2, 4, 6].map((d) => degreeToMidi(0, degree + d) - r);
}

/*
  SQNCR's chord-tone ladder (`wf`): every tone of the current chord across seven octaves,
  sorted, and the one `band` places above the root nearest the voice's home note. Height in
  the cube picks the band, so a cube near the top plays higher in the same chord — the tuned
  voices can never clash with the harmony.
*/
export function ladderNote(baseMidi, degree, band) {
  const ladder = [];
  for (let h = -3; h <= 3; h++)
    for (const y of [0, 2, 4]) ladder.push(degreeToMidi(0, degree + y) + (Math.floor(baseMidi / 12) + h) * 12);
  ladder.sort((a, b) => a - b);
  const rootPc = ((degreeToMidi(0, degree) % 12) + 12) % 12;
  let p = 0;
  let best = Infinity;
  ladder.forEach((m, i) => {
    if (((m % 12) + 12) % 12 === rootPc && Math.abs(m - baseMidi) < best) {
      best = Math.abs(m - baseMidi);
      p = i;
    }
  });
  return ladder[Math.max(0, Math.min(ladder.length - 1, p + band))];
}

// SQNCR's `Ef`: height → an octave band of −3…+3, higher is higher.
export function bandOf(height) {
  return Math.round((height - 0.5) * 6);
}

export function noteFor(voice, piece, absStep) {
  if (!voice.pitched) return undefined;
  const band = bandOf(piece.height);
  const reach = voice.id === 'sub' || voice.id === 'chord' ? 0 : voice.id === 'bass' ? 2 : 3;
  return ladderNote(voice.baseMidi, chordAt(absStep), Math.max(-2, Math.min(reach, band)));
}

// Accent by position in the bar (SQNCR's `f0`).
function accent(step) {
  return step % STEPS_PER_BAR === 0 ? 5 : step % 4 === 0 ? 3 : step % 2 === 0 ? 2 : 1;
}

/*
  The orbit fixes *when* each cube plays (its azimuth), so the voice is chosen to suit that
  moment — the reverse of SQNCR, which picks a time for each voice. Downbeats get the low end,
  backbeats the snare family, offbeats the ticks, and big cubes the heavy, pitched parts. Height
  leans the choice: low in the block is bass and kick, high is bells and hats.

  A lattice lines its cubes up along a few directions, so several often share a step. Only the
  lead cube of a step (biggest, then lowest) takes the beat role, the next one doubles it (sub
  under a kick, clap or rim on a snare), and the rest become tuned and colour voices — so a
  crowded step plays as a chord over a kick, not ten kicks.
*/
export function assignVoices(pieces, stepsPerOrbit, seed, variation = 0.3) {
  const rand = mulberry32(seed ^ 0x9e37);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const byStep = new Map();
  for (const p of pieces) {
    if (!byStep.has(p.step)) byStep.set(p.step, []);
    byStep.get(p.step).push(p);
  }
  for (const group of byStep.values()) group.sort((a, b) => b.size - a.size || a.height - b.height);

  for (const p of pieces) {
    const s = p.step;
    const rank = byStep.get(s).indexOf(p);
    const low = p.height < 0.35;
    const high = p.height > 0.7;
    let id;
    if (s % 8 === 0 && rank === 0) id = 'kick';
    else if (s % 8 === 0 && rank === 1 && p.size >= 2) id = 'sub';
    else if (s % 8 === 4 && rank === 0) id = p.size === 1 ? pick(['clap', 'snare']) : 'snare';
    else if (s % 8 === 4 && rank === 1) id = pick(['clap', 'rim']);
    else if (p.size >= 4) id = low ? 'bass' : pick(['chord', 'bass', 'sub']);
    else if (p.size === 2) id = low ? pick(['bass', 'tom']) : high ? pick(['chord', 'bell']) : pick(['chord', 'conga', 'bass', 'tom']);
    else if (s % 2 === 1) id = high ? pick(['hat', 'shaker']) : pick(['hat', 'shaker', 'rim', 'conga']);
    else id = high ? pick(['bell', 'zap', 'ohat']) : pick(['ohat', 'cowbell', 'zap', 'bell', 'noise', 'hat']);

    const v = VOICE.get(id);
    p.voice = v;
    p.velocity = 0.46 + accent(s) * 0.09 + rand() * 0.06;
    // Which of four consecutive orbits the cube sounds on (SQNCR's section mask + `m0`).
    let mask = 0b1111;
    if (v.group !== 'beat') for (let o = 1; o < 4; o++) if (rand() < variation * 0.4) mask &= ~(1 << o);
    p.mask = mask;
  }
}
