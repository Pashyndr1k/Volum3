import { mulberry32 } from './rng.js';

/*
  A pattern is one orbit of music: 64 sixteenths, four bars of 16. It is written the way a
  drummer and a songwriter would sketch a groove — lanes of hits for the kit, a bass line that
  locks to the kick, a chord per bar, and a simple melody on top — and then the mapper hands
  every note to a cube whose place around the orbit matches the note's moment.

  Each style below is a probability grid per lane (one 16-step bar), a tempo range, a key and a
  few chord progressions. Generating a pattern rolls those dice: bar A, a varied bar B, A again,
  then A with a fill — the A A' A fill shape of almost every loop. The default preset is CITY with
  the dice replaced by a threshold (every step at ≥ 50 % plays) and a hand-written melody.
*/

export const STEPS = 64;
export const BAR = 16;

export const LANES = [
  { id: 'melody', label: 'MELODY', pitched: true },
  { id: 'chord', label: 'CHORD', pitched: true },
  { id: 'bass', label: 'BASS', pitched: true },
  { id: 'perc', label: 'PERC' },
  { id: 'open', label: 'OPEN' },
  { id: 'hat', label: 'HAT' },
  { id: 'snare', label: 'SNARE' },
  { id: 'kick', label: 'KICK' },
];

export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  majpent: [0, 2, 4, 7, 9],
  minpent: [0, 3, 5, 7, 10],
};

export const NOTE_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];

const EIGHTHS = [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0];
const OFFBEATS = [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0];

export const STYLES = [
  {
    id: 'city',
    label: 'CITY POP',
    bpm: [96, 108],
    swing: 0.06,
    roots: [5, 0, 2, 7],
    scale: 'major',
    melodyScale: 'major',
    progressions: [[3, 4, 2, 5], [0, 5, 3, 4], [3, 4, 0, 5], [1, 4, 0, 5]],
    seventh: true,
    voices: { kick: 'kick', snare: 'snare', hat: 'hat', open: 'ohat', perc: 'conga', bass: 'bass', chord: 'chord', melody: 'bell' },
    drums: {
      kick: [1, 0, 0, 0, 0, 0, 0.35, 0, 0.85, 0, 0.4, 0, 0, 0, 0.2, 0],
      snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0.12],
      hat: [0.95, 0.45, 0.95, 0.45, 0.95, 0.45, 0.95, 0.45, 0.95, 0.45, 0.95, 0.45, 0.95, 0.45, 0.95, 0.45],
      open: [0, 0, 0, 0, 0, 0, 0, 0.15, 0, 0, 0, 0, 0, 0, 0, 0.35],
      perc: [0, 0, 0.2, 0, 0, 0.15, 0, 0.25, 0, 0, 0.2, 0, 0, 0.15, 0.2, 0],
    },
    bass: { rule: 'kick', extra: [3, 7, 11, 14], extraProb: 0.35, len: 2 },
    chord: { steps: [0, 10], len: [8, 6] },
    melody: { density: 0.55, maxLen: 4 },
  },
  {
    id: 'house',
    label: 'HOUSE',
    bpm: [120, 126],
    swing: 0,
    roots: [9, 2, 5, 7],
    scale: 'dorian',
    melodyScale: 'minpent',
    progressions: [[0, 3, 0, 4], [0, 6, 5, 4], [0, 0, 3, 4]],
    seventh: true,
    voices: { kick: 'kick', snare: 'clap', hat: 'hat', open: 'ohat', perc: 'rim', bass: 'bass', chord: 'chord', melody: 'lead' },
    drums: {
      kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
      snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
      hat: [0, 0.25, 1, 0.25, 0, 0.25, 1, 0.25, 0, 0.25, 1, 0.25, 0, 0.25, 1, 0.25],
      open: OFFBEATS.map((v) => v * 0.55),
      perc: [0, 0.2, 0, 0.3, 0, 0, 0, 0.3, 0, 0.2, 0, 0.3, 0, 0, 0.4, 0],
    },
    bass: { rule: 'steps', steps: [2, 6, 10, 14], prob: 0.9, extra: [3, 7, 11, 15], extraProb: 0.2, len: 1 },
    chord: { steps: [3, 10], len: [2, 2] },
    melody: { density: 0.45, maxLen: 3 },
  },
  {
    id: 'boombap',
    label: 'BOOM BAP',
    bpm: [84, 94],
    swing: 0.16,
    roots: [2, 4, 9, 0],
    scale: 'minor',
    melodyScale: 'minpent',
    progressions: [[0, 0, 5, 4], [0, 3, 6, 4], [0, 5, 3, 4]],
    seventh: true,
    voices: { kick: 'kick', snare: 'snare', hat: 'hat', open: 'ohat', perc: 'tom', bass: 'bass', chord: 'chord', melody: 'bell' },
    drums: {
      kick: [1, 0, 0, 0, 0, 0, 0, 0.55, 0, 0, 1, 0, 0, 0.3, 0, 0],
      snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
      hat: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0.3],
      open: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.2, 0],
      perc: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.15, 0.25],
    },
    bass: { rule: 'kick', extra: [3, 11], extraProb: 0.2, len: 3 },
    chord: { steps: [0], len: [12] },
    melody: { density: 0.4, maxLen: 4 },
  },
  {
    id: 'bossa',
    label: 'BOSSA',
    bpm: [124, 140],
    swing: 0,
    roots: [2, 7, 0, 5],
    scale: 'major',
    melodyScale: 'major',
    progressions: [[1, 4, 0, 0], [0, 5, 1, 4], [3, 4, 2, 5]],
    seventh: true,
    voices: { kick: 'kick', snare: 'rim', hat: 'shaker', open: 'ohat', perc: 'conga', bass: 'bass', chord: 'chord', melody: 'bell' },
    drums: {
      kick: [1, 0, 0, 0.9, 1, 0, 0, 0.9, 1, 0, 0, 0.9, 1, 0, 0, 0.9],
      snare: [1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 0], // son clave, 3-2
      hat: [1, 0.6, 1, 0.6, 1, 0.6, 1, 0.6, 1, 0.6, 1, 0.6, 1, 0.6, 1, 0.6],
      open: new Array(16).fill(0),
      perc: [0, 0, 0.3, 0, 0, 0, 0.3, 0, 0, 0, 0.3, 0, 0, 0, 0.3, 0],
    },
    bass: { rule: 'bossa', len: 3 },
    chord: { steps: [0, 6, 10], len: [3, 3, 4] },
    melody: { density: 0.5, maxLen: 4 },
  },
  {
    id: 'trap',
    label: 'TRAP',
    bpm: [136, 150],
    swing: 0,
    roots: [1, 3, 6, 8],
    scale: 'minor',
    melodyScale: 'minor',
    progressions: [[0, 5, 3, 4], [0, 0, 5, 6], [0, 3, 0, 4]],
    seventh: false,
    voices: { kick: 'kick', snare: 'clap', hat: 'hat', open: 'ohat', perc: 'rim', bass: 'sub', chord: 'chord', melody: 'lead' },
    drums: {
      kick: [1, 0, 0, 0.3, 0, 0, 0.6, 0, 0, 0.45, 0, 0.3, 0, 0, 0.35, 0],
      snare: [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
      hat: [1, 0.7, 1, 0.7, 1, 0.7, 1, 0.7, 1, 0.7, 1, 0.7, 1, 0.7, 1, 0.7],
      open: new Array(16).fill(0),
      perc: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.3, 0, 0.3],
    },
    bass: { rule: 'kick', extra: [], extraProb: 0, len: 6 },
    chord: { steps: [0], len: [16] },
    melody: { density: 0.35, maxLen: 4 },
  },
  {
    id: 'ambient',
    label: 'AMBIENT',
    bpm: [60, 72],
    swing: 0,
    roots: [2, 4, 7, 9],
    scale: 'major',
    melodyScale: 'majpent',
    progressions: [[0, 3, 0, 4], [0, 5, 3, 0], [0, 0, 3, 3]],
    seventh: true,
    voices: { kick: 'kick', snare: 'rim', hat: 'shaker', open: 'ohat', perc: 'conga', bass: 'sub', chord: 'chord', melody: 'bell' },
    drums: {
      kick: [0.8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.2, 0, 0, 0, 0, 0],
      snare: [0, 0, 0, 0, 0, 0, 0, 0, 0.25, 0, 0, 0, 0, 0, 0, 0],
      hat: EIGHTHS.map((v) => v * 0.3),
      open: [0, 0, 0, 0, 0, 0, 0, 0, 0.25, 0, 0, 0, 0, 0, 0, 0],
      perc: new Array(16).fill(0.06),
    },
    bass: { rule: 'steps', steps: [0], prob: 1, extra: [], extraProb: 0, len: 16 },
    chord: { steps: [0], len: [16] },
    melody: { density: 0.22, maxLen: 8 },
  },
  {
    id: 'dnb',
    label: 'DRUM & BASS',
    bpm: [170, 176],
    swing: 0,
    roots: [2, 5, 9, 11],
    scale: 'minor',
    melodyScale: 'minpent',
    progressions: [[0, 5, 6, 4], [0, 0, 3, 4]],
    seventh: false,
    voices: { kick: 'kick', snare: 'snare', hat: 'hat', open: 'ohat', perc: 'rim', bass: 'sub', chord: 'chord', melody: 'lead' },
    drums: {
      kick: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0],
      snare: [0, 0, 0, 0, 1, 0, 0, 0.15, 0, 0.2, 0, 0, 1, 0, 0, 0.2],
      hat: EIGHTHS,
      open: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.3, 0],
      perc: [0, 0, 0, 0.2, 0, 0, 0, 0.2, 0, 0, 0, 0.2, 0, 0, 0, 0.2],
    },
    bass: { rule: 'kick', extra: [], extraProb: 0, len: 8 },
    chord: { steps: [0], len: [16] },
    melody: { density: 0.4, maxLen: 4 },
  },
];

export const STYLE = new Map(STYLES.map((s) => [s.id, s]));

// ---- Harmony ------------------------------------------------------------------------------

export function scaleMidi(root, scale, base, degree) {
  const st = SCALES[scale];
  const n = st.length;
  const o = Math.floor(degree / n);
  const d = ((degree % n) + n) % n;
  return base + root + st[d] + 12 * o;
}

// Chord on a diatonic degree: root MIDI in the given register, plus its intervals.
export function chordOf(p, degree, low, seventh = p.seventh) {
  let root = scaleMidi(p.root, p.scale, 0, degree);
  while (root < low) root += 12;
  while (root >= low + 12) root -= 12;
  const r0 = scaleMidi(p.root, p.scale, 0, degree);
  const tones = [0, 2, 4, ...(seventh ? [6] : [])].map((k) => scaleMidi(p.root, p.scale, 0, degree + k) - r0);
  return { root, tones };
}

export function chordPcs(p, degree) {
  const { root, tones } = chordOf(p, degree, 48, false);
  return tones.map((t) => (root + t) % 12);
}

// Every MIDI note of the pattern's melody scale in [lo, hi].
export function melodyNotes(p, lo, hi) {
  const out = [];
  for (let m = lo; m <= hi; m++) {
    const pc = (((m - p.root) % 12) + 12) % 12;
    if (SCALES[p.melodyScale].includes(pc)) out.push(m);
  }
  return out;
}

export function chordName(p, degree) {
  const { root, tones } = chordOf(p, degree, 48, false);
  const quality = tones[1] === 3 ? (tones[2] === 6 ? 'DIM' : 'MIN') : '';
  return `${NOTE_NAMES[root % 12]}${quality}`;
}

// ---- Building patterns --------------------------------------------------------------------

function accent(i) {
  return i % 4 === 0 ? 0.25 : i % 2 === 0 ? 0.12 : 0;
}

function drumBars(style, rand) {
  // Bar A, a varied A', A again, and A with a fill: the shape of almost every loop.
  const lanes = ['kick', 'snare', 'hat', 'open', 'perc'];
  const A = {};
  for (const lane of lanes) A[lane] = style.drums[lane].map((p) => (rand ? rand() < p : p >= 0.5));
  const vary = (bar, amount) => {
    const out = {};
    for (const lane of lanes)
      out[lane] = bar[lane].map((on, i) => {
        if (!rand || i === 0) return on;
        const flip = lane === 'kick' || lane === 'snare' ? amount * 0.4 : amount;
        return rand() < flip * style.drums[lane][i] ? !on : on;
      });
    return out;
  };
  const fill = (bar) => {
    const out = vary(bar, 0.15);
    if (!rand) return out;
    for (let i = 12; i < 16; i++) {
      if (rand() < 0.45) out.snare[i] = true;
      if (rand() < 0.35) out.perc[i] = true;
    }
    return out;
  };
  return [A, vary(A, 0.2), A, fill(A)];
}

function drumEvents(style, rand) {
  const events = [];
  drumBars(style, rand).forEach((bar, b) => {
    for (const lane of Object.keys(bar))
      bar[lane].forEach((on, i) => {
        if (!on) return;
        const jitter = rand ? rand() * 0.08 : 0.04;
        const base = lane === 'kick' ? 0.8 : lane === 'snare' ? 0.78 : lane === 'hat' ? 0.5 : 0.6;
        events.push({ lane, step: b * BAR + i, vel: Math.min(1, base + accent(i) + jitter) });
      });
  });
  return events;
}

function bassEvents(p, style, kicks, rand) {
  const rule = style.bass;
  const steps = new Set();
  for (let b = 0; b < 4; b++) {
    if (rule.rule === 'kick') {
      for (const k of kicks) if (Math.floor(k / BAR) === b) steps.add(k);
      for (const e of rule.extra) if ((rand ? rand() : 0.5) < rule.extraProb) steps.add(b * BAR + e);
    } else if (rule.rule === 'steps') {
      for (const s of rule.steps) if (!rand || rand() < rule.prob) steps.add(b * BAR + s);
      for (const e of rule.extra) if ((rand ? rand() : 0.5) < rule.extraProb) steps.add(b * BAR + e);
    } else if (rule.rule === 'bossa') {
      for (const s of [0, 6, 8, 14]) steps.add(b * BAR + s);
    }
  }
  const sorted = [...steps].sort((a, b) => a - b);
  return sorted.map((step, k) => {
    const deg = p.progression[Math.floor(step / BAR)];
    let { root } = chordOf(p, deg, 36);
    // Bossa walks root–fifth; elsewhere an occasional octave on the offbeats.
    if (rule.rule === 'bossa' && (step % BAR === 6 || step % BAR === 14)) root += 7;
    else if (rand && step % 4 !== 0 && rand() < 0.2) root += 12;
    const next = sorted[k + 1] ?? STEPS;
    return { lane: 'bass', step, vel: step % 4 === 0 ? 0.85 : 0.7, midi: root, len: Math.max(1, Math.min(rule.len, next - step)) };
  });
}

function chordEvents(p, style) {
  const out = [];
  for (let b = 0; b < 4; b++)
    style.chord.steps.forEach((s, k) => {
      const deg = p.progression[b];
      const { root, tones } = chordOf(p, deg, 55);
      out.push({ lane: 'chord', step: b * BAR + s, vel: k === 0 ? 0.75 : 0.6, midi: root, spread: tones, len: style.chord.len[k] });
    });
  return out;
}

/*
  A melody in four bars: a phrase, a variation of it, the phrase again, and an answer that comes
  home. Rhythm favours the beats; pitch walks the scale in small steps, lands on a chord tone
  on each strong beat, and the last note is the tonic.
*/
function melodyEvents(p, style, rand) {
  const pool = melodyNotes(p, 62, 84);
  const nearestIn = (list, m) => list.reduce((a, b) => (Math.abs(b - m) < Math.abs(a - m) ? b : a));
  const chordTone = (bar, m) => nearestIn(pool.filter((n) => chordPcs(p, p.progression[bar]).includes(n % 12)), m);

  const rhythm = () => {
    const steps = [];
    for (let i = 0; i < BAR; i++) {
      const w = style.melody.density * (i % 4 === 0 ? 1 : i % 2 === 0 ? 0.55 : 0.25);
      if (rand() < w) steps.push(i);
    }
    if (!steps.includes(0) && rand() < 0.7) steps.unshift(0);
    while (steps.length < 2) {
      const s = [0, 4, 8, 12][Math.floor(rand() * 4)];
      if (!steps.includes(s)) steps.push(s);
    }
    return steps.sort((a, b) => a - b);
  };
  let cur = chordTone(0, 72);
  const phrase = (bar, steps) =>
    steps.map((i) => {
      const r = rand();
      const move = r < 0.1 ? 0 : r < 0.65 ? 1 : r < 0.9 ? 2 : 3 + Math.floor(rand() * 2);
      let idx = pool.indexOf(cur) + (rand() < 0.5 ? -move : move);
      idx = Math.max(0, Math.min(pool.length - 1, idx));
      cur = pool[idx];
      if (i % 8 === 0) cur = chordTone(bar, cur);
      return { i, midi: cur };
    });

  const a = phrase(0, rhythm());
  const b = phrase(1, rhythm());
  const a2 = a.map((n, k) => (k === a.length - 1 && rand() < 0.6 ? { ...n, midi: chordTone(2, n.midi + 2) } : n));
  const d = phrase(3, rhythm());
  const tonic = nearestIn(pool.filter((n) => (n - p.root) % 12 === 0), d[d.length - 1].midi);
  d[d.length - 1] = { ...d[d.length - 1], midi: tonic };

  const out = [];
  [a, b, a2, d].forEach((notes, bar) =>
    notes.forEach((n, k) => {
      const next = k + 1 < notes.length ? notes[k + 1].i : BAR;
      out.push({ lane: 'melody', step: bar * BAR + n.i, vel: 0.7 + accent(n.i), midi: n.midi, len: Math.max(1, Math.min(style.melody.maxLen, next - n.i)) });
    }),
  );
  return out;
}

function assemble(style, rand, head) {
  const p = {
    style: style.id,
    swing: style.swing,
    scale: style.scale,
    melodyScale: style.melodyScale,
    seventh: style.seventh,
    voices: { ...style.voices },
    ...head,
  };
  const drums = drumEvents(style, rand);
  const kicks = drums.filter((e) => e.lane === 'kick').map((e) => e.step);
  p.events = [...drums, ...bassEvents(p, style, kicks, rand), ...chordEvents(p, style)];
  return p;
}

export function generatePattern(styleId, seed) {
  const style = STYLE.get(styleId) ?? STYLES[0];
  const rand = mulberry32(seed ^ 0x2545f491);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const p = assemble(style, rand, {
    name: `${style.label} ${seed.toString(36).toUpperCase()}`,
    seed,
    bpm: style.bpm[0] + Math.floor(rand() * (style.bpm[1] - style.bpm[0] + 1)),
    root: pick(style.roots),
    progression: [...pick(style.progressions)],
  });
  p.events.push(...melodyEvents(p, style, rand));
  return p;
}

// The default: CITY in F, IV–V–iii–vi (B♭ C Am Dm), the style's grid at its likeliest, and a tune.
export function presetPattern() {
  const style = STYLE.get('city');
  const p = assemble(style, null, { name: 'CITY POP PRESET', seed: 0, bpm: 100, root: 5, progression: [3, 4, 2, 5] });
  // [step, scale degree above F4, length] — degree 0 = F4, 7 = F5.
  const tune = [
    [0, 5, 2], [2, 4, 2], [4, 3, 3], [7, 4, 1], [8, 5, 4], [12, 7, 2], [14, 6, 2],
    [16, 6, 3], [19, 5, 1], [20, 4, 4], [26, 1, 2], [28, 4, 4],
    [32, 4, 2], [34, 2, 2], [36, 6, 3], [39, 5, 1], [40, 4, 4], [44, 2, 4],
    [48, 5, 3], [51, 7, 1], [52, 6, 2], [54, 5, 2], [56, 2, 6], [62, 4, 2],
  ];
  for (const [step, deg, len] of tune)
    p.events.push({ lane: 'melody', step, vel: 0.72 + accent(step % BAR), midi: scaleMidi(5, 'major', 60, deg), len });
  return p;
}

// ---- Accompanying a hummed melody -------------------------------------------------------

/*
  Chords for a melody that already exists: one per bar, the diatonic triad that best agrees with
  what is sung over it. A note counts for the time it is held in that bar, and more when it
  lands on a strong beat; a strong-beat note outside the chord counts against it. Small nudges
  make the line sound like a song: start at home, and prefer a V (or IV) before the end.
*/
export function harmonize(melody, root, scale) {
  const p = { root, scale, seventh: false };
  const progression = [];
  for (let b = 0; b < 4; b++) {
    const lo = b * BAR, hi = lo + BAR;
    let best = 0;
    let bestScore = -Infinity;
    for (let deg = 0; deg < 7; deg++) {
      // Skip the diminished triad; it rarely sounds like home in a simple song.
      const { tones } = chordOf(p, deg, 48, false);
      if (tones[1] === 3 && tones[2] === 6) continue;
      const pcs = chordPcs(p, deg);
      let score = 0;
      for (const e of melody) {
        const overlap = Math.min(hi, e.step + e.len) - Math.max(lo, e.step);
        if (overlap <= 0) continue;
        const strong = e.step >= lo && e.step % 8 === 0 ? 1.6 : e.step >= lo && e.step % 4 === 0 ? 1.25 : 1;
        const inChord = pcs.includes(((e.midi % 12) + 12) % 12);
        score += inChord ? overlap * strong : strong > 1 ? -0.5 * overlap : -0.1 * overlap;
      }
      if (deg === 0 || deg === 3 || deg === 4) score += 0.25; // I, IV and V win ties
      if (b === 0 && deg === 0) score += 1.5;
      if (b === 2 && (deg === 4 || deg === 3)) score += 0.6;
      if (b === 3 && (deg === 4 || deg === 0)) score += 1;
      if (b > 0 && deg === progression[b - 1]) score -= 0.4; // keep it moving if it can
      if (score > bestScore) {
        bestScore = score;
        best = deg;
      }
    }
    progression.push(best);
  }
  return progression;
}

/*
  The band around a hummed melody. The melody is kept exactly as sung; everything else is
  written in the chosen style, over chords picked to fit the tune, in the tune's key. Where the
  singer rests for a beat or more, the percussion answers in the gap — the kit follows the
  phrasing rather than playing over it.
*/
export function accompany(melody, { root, scale, bpm }, styleId, seed) {
  const style = STYLE.get(styleId) ?? STYLES[0];
  const rand = mulberry32(seed ^ 0x6c8e9cf5);
  const head = {
    name: `HUMMED · ${style.label}`,
    seed: 0,
    bpm,
    root,
    progression: harmonize(melody, root, scale),
  };
  const p = assemble(style, rand, head);
  p.style = 'hum';
  p.accomp = style.id;
  p.scale = scale;
  p.melodyScale = scale;
  p.swing = 0;
  p.voices.melody = 'lead';
  // The chords and bass were built with the style's scale in `assemble`; rebuild them in the tune's.
  const drums = p.events.filter((e) => e.lane !== 'bass' && e.lane !== 'chord');
  const kicks = drums.filter((e) => e.lane === 'kick').map((e) => e.step);
  p.events = [...drums, ...bassEvents(p, style, kicks, rand), ...chordEvents(p, style)];

  // Answer the gaps: a rest of a beat or more gets a couple of percussion hits and an open hat.
  const sorted = [...melody].sort((a, b) => a.step - b.step);
  sorted.forEach((e, k) => {
    const end = e.step + e.len;
    const next = k + 1 < sorted.length ? sorted[k + 1].step : STEPS + (sorted[0]?.step ?? 0);
    const gap = next - end;
    if (gap < 4) return;
    for (let s = end + 1; s < Math.min(next, end + 8); s += 2)
      if (rand() < 0.45) p.events.push({ lane: 'perc', step: s % STEPS, vel: 0.55 + rand() * 0.2 });
    if (rand() < 0.6) p.events.push({ lane: 'open', step: (next - 2 + STEPS) % STEPS, vel: 0.5 });
  });
  p.events.push(...melody.map((e) => ({ ...e })));
  return p;
}
