/*
  Texture sets: what is printed on the cubes, the way colour profiles set what colour they are.
  A set gives each part of the pattern (kick, snare, hat, …) a pattern and a scale:

    pattern  one of PATTERNS below
    density  marks per unit of cube (a medium cube carries twice what a small one does) —
             or, with `fit`, marks per face, whatever the cube's size (one big X on every face)

  The vocabulary comes from the pattern boards in references.zip (see docs/VISUAL_PROFILES.md):
  1-bit marks — targets, crosses, dots, rings, checkers, bars, plus signs, hatching — each blown
  up to fill a face and run off it.
*/

export const PATTERNS = {
  none: 0,
  dots: 1, // halftone dots — p07, p08, p03
  rings: 2, // circle outlines — p07, p17
  cross: 3, // X marks — p15, p12
  plus: 4, // plus signs — p11, p13
  checker: 5, // checkerboard — p16, p00
  stripes: 6, // diagonal hatching — p05, p10
  bars: 7, // horizontal bars — p05, p14, p09
  target: 8, // concentric rings from the face centre — p17, c12, c29
  grid: 9, // hairline frame — p08
};

const set = (id, label, from, lanes) => ({ id, label, from, lanes });
const all = (spec) => ({ kick: spec, snare: spec, hat: spec, open: spec, perc: spec, bass: spec, chord: spec, melody: spec, idle: spec });

/*
  Every set is per face (`fit`): one mark per face, and `density` below 1 makes the mark bigger
  than the face, so it runs off the edges and is cropped — a supergraphic, as on the posters.
*/
export const TEXTURE_SETS = [
  set('none', 'NONE', 'plain cubes', all({ pattern: 'none', density: 1, fit: true })),
  set('macro', 'MACRO', 'one oversized mark per face, cropped by its edges — p07, p16, p17', {
    kick: { pattern: 'target', density: 1.8, fit: true },
    snare: { pattern: 'cross', density: 0.62, fit: true },
    hat: { pattern: 'dots', density: 0.72, fit: true },
    open: { pattern: 'rings', density: 0.62, fit: true },
    perc: { pattern: 'checker', density: 2, fit: true },
    bass: { pattern: 'bars', density: 1.5, fit: true },
    chord: { pattern: 'plus', density: 0.62, fit: true },
    melody: { pattern: 'stripes', density: 1.2, fit: true },
    idle: { pattern: 'grid', density: 1, fit: true },
  }),
];

export const TEXTURE_SET = new Map(TEXTURE_SETS.map((t) => [t.id, t]));
