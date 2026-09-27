import * as THREE from 'three';

/*
  Texture sets: what is printed on the cubes, the way colour profiles set what colour they are.
  A set gives each part of the pattern (kick, snare, hat, …) a pattern and a scale:

    pattern  one of PATTERNS below
    density  marks per unit of cube (a medium cube carries twice what a small one does) —
             or, with `fit`, marks per face, whatever the cube's size (one big X on every face)

  The vocabulary comes from the pattern boards in references.zip (see docs/VISUAL_PROFILES.md):
  1-bit marks — targets, crosses, dots, rings, checkers, bars, plus signs, hatching — and type,
  each blown up to fill a face and run off it.
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
  glyph: 10, // a letter or number — c09, p02, p04
};

const set = (id, label, from, lanes) => ({ id, label, from, lanes });
const all = (spec) => ({ kick: spec, snare: spec, hat: spec, open: spec, perc: spec, bass: spec, chord: spec, melody: spec, idle: spec });

/*
  Every set is per face (`fit`): one mark per face, and `density` below 1 makes the mark bigger
  than the face, so it runs off the edges and is cropped — a supergraphic, as on the posters.
  For glyphs, `scale` is the letter's size against the face: above 1 it is cropped too.
*/
export const TEXTURE_SETS = [
  set('none', 'NONE', 'plain cubes', all({ pattern: 'none', density: 1, fit: true })),
  set('macro', 'MACRO', 'one oversized mark per face, cropped by its edges — p07, p16, p17, p02', {
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
  set('macrotype', 'MACRO TYPE', 'oversized letters and numbers, cropped by the face — c09, p02', all({ pattern: 'glyph', density: 1, fit: true, scale: 1.8 })),
];

export const TEXTURE_SET = new Map(TEXTURE_SETS.map((t) => [t.id, t]));

// ---- Glyphs ---------------------------------------------------------------------------------

export const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+×#%&@*/=<>?!$♯♭●■▲◆';
export const LANE_LETTER = { kick: 'K', snare: 'S', hat: 'H', open: 'O', perc: 'P', bass: 'B', chord: 'C', melody: 'M' };
const COLS = 16;
const ROWS = 4;
const CELL = 128;

export function glyphIndex(ch) {
  const k = GLYPHS.indexOf(ch);
  return k < 0 ? 0 : k;
}

/*
  One texture holds every glyph, drawn once on a canvas in DM Mono.
*/
export function buildGlyphAtlas() {
  const canvas = document.createElement('canvas');
  canvas.width = COLS * CELL;
  canvas.height = ROWS * CELL;
  const c = canvas.getContext('2d');
  c.fillStyle = '#000';
  c.fillRect(0, 0, canvas.width, canvas.height);
  const tmp = document.createElement('canvas');
  tmp.width = tmp.height = CELL;
  const t = tmp.getContext('2d');
  const font = `500 ${CELL * 0.86}px "DM Mono", ui-monospace, Menlo, monospace`;
  [...GLYPHS].slice(0, 64).forEach((ch, k) => {
    t.fillStyle = '#000';
    t.fillRect(0, 0, CELL, CELL);
    t.fillStyle = '#fff';
    t.font = font;
    t.textAlign = 'center';
    t.textBaseline = 'middle';
    t.fillText(ch, CELL / 2, CELL / 2 + CELL * 0.04);
    const x = (k % COLS) * CELL;
    const y = Math.floor(k / COLS) * CELL;
    c.drawImage(tmp, x, y);
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 4;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return { texture: tex, cols: COLS, rows: ROWS };
}
