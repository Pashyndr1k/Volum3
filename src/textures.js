import * as THREE from 'three';

/*
  Texture sets: what is printed on the cubes, the way colour profiles set what colour they are.
  A set gives each part of the pattern (kick, snare, hat, …) a pattern and a scale:

    pattern  one of PATTERNS below
    density  marks per unit of cube (a medium cube carries twice what a small one does) —
             or, with `fit`, marks per face, whatever the cube's size (one big X on every face)

  The vocabulary comes from the pattern boards in references.zip (see docs/VISUAL_PROFILES.md):
  1-bit marks on a grid, at every scale from a fine screen to a single glyph per face, plus the
  dot-matrix type and pixel noise of the flower video and the signal bands of p10 and p14.
*/

export const PATTERNS = {
  none: 0,
  dots: 1, // halftone dot grid — p07, p08, p03
  rings: 2, // circle outlines — p07, p17
  cross: 3, // X marks — p15, p12
  plus: 4, // plus signs — p11, p13
  checker: 5, // checkerboard — p16, p00
  stripes: 6, // diagonal hatching — p05, p10
  bars: 7, // horizontal bars — p05, p14, p09
  target: 8, // concentric rings from the face centre — p17, c12, c29
  grid: 9, // hairline grid — p08
  glyph: 10, // a large letter or number from the atlas — c09, p02, p04
  dotglyph: 11, // the same, drawn in dots like a dot-matrix sign — p09, the flower video
  bitmap: 12, // 1-bit pixel noise, reshuffling while struck — p04, the flower video
  signal: 13, // broken horizontal bands — p10, p14
  mixed: 14, // every face picks its own mark and scale — p12, p06
};

const set = (id, label, from, lanes) => ({ id, label, from, lanes });
const all = (spec) => ({ kick: spec, snare: spec, hat: spec, open: spec, perc: spec, bass: spec, chord: spec, melody: spec, idle: spec });
const graphic = (density, fit = false) => ({
  kick: { pattern: 'target', density: fit ? 2.5 : density, fit },
  snare: { pattern: 'cross', density, fit },
  hat: { pattern: 'dots', density, fit },
  open: { pattern: 'rings', density, fit },
  perc: { pattern: 'checker', density, fit },
  bass: { pattern: 'bars', density, fit },
  chord: { pattern: 'plus', density, fit },
  melody: { pattern: 'stripes', density, fit },
  idle: { pattern: 'grid', density, fit },
});

export const TEXTURE_SETS = [
  set('none', 'NONE', 'plain cubes', all({ pattern: 'none', density: 1 })),
  set('graphic', 'GRAPHIC', 'the pattern boards, one mark per part, four to a unit', graphic(4)),
  set('micro', 'MICRO', 'the same marks as a fine screen — p00, p08', graphic(9)),
  set('macro', 'MACRO', 'one big mark per face — p07, p16, p17', graphic(1, true)),
  set('type', 'TYPE', 'large letters and numbers: the part on the sides, the beat or degree on top — c09, p02', all({ pattern: 'glyph', density: 1, fit: true })),
  set('matrix', 'DOT MATRIX', 'the same glyphs in dots — p09, the flower video', all({ pattern: 'dotglyph', density: 1, fit: true })),
  set('bitmap', 'BITMAP', '1-bit pixel noise, denser for the heavy parts — p04, the flower video', {
    kick: { pattern: 'bitmap', density: 7, fill: 0.7 },
    snare: { pattern: 'bitmap', density: 7, fill: 0.55 },
    hat: { pattern: 'bitmap', density: 10, fill: 0.25 },
    open: { pattern: 'bitmap', density: 10, fill: 0.35 },
    perc: { pattern: 'bitmap', density: 7, fill: 0.45 },
    bass: { pattern: 'bitmap', density: 5, fill: 0.65 },
    chord: { pattern: 'bitmap', density: 7, fill: 0.5 },
    melody: { pattern: 'bitmap', density: 7, fill: 0.4 },
    idle: { pattern: 'bitmap', density: 10, fill: 0.08 },
  }),
  set('signal', 'SIGNAL', 'broken bands, like a bad video line — p10, p14', {
    ...all({ pattern: 'signal', density: 6 }),
    bass: { pattern: 'signal', density: 3 },
    hat: { pattern: 'signal', density: 10 },
    idle: { pattern: 'signal', density: 10, fill: 0.15 },
  }),
  set('mixed', 'MIXED', 'every face its own mark and scale, like the tile mosaics — p12, p06', all({ pattern: 'mixed', density: 1 })),
];

export const TEXTURE_SET = new Map(TEXTURE_SETS.map((t) => [t.id, t]));

// ---- Glyphs ---------------------------------------------------------------------------------

export const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+×#%&@*/=<>?!$♯♭●■▲◆';
export const LANE_LETTER = { kick: 'K', snare: 'S', hat: 'H', open: 'O', perc: 'P', bass: 'B', chord: 'C', melody: 'M' };
const COLS = 16;
const ROWS = 8; // two banks of 64: solid glyphs, then the same glyphs in dots
const CELL = 128;

export function glyphIndex(ch) {
  const k = GLYPHS.indexOf(ch);
  return k < 0 ? 0 : k;
}

/*
  One texture holds every glyph twice: solid (TYPE) and as a dot matrix (DOT MATRIX). The dots
  are made from the solid glyph by measuring how much of each cell of a 7 × 9 grid it covers,
  so any font becomes a dot-matrix sign.
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
  const t = tmp.getContext('2d', { willReadFrequently: true });
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
    // Dot-matrix version, in the second bank.
    const img = t.getImageData(0, 0, CELL, CELL).data;
    const gx = 7, gy = 9;
    const x0 = CELL * 0.14, y0 = CELL * 0.08, w = CELL * 0.72, h = CELL * 0.84;
    const dx = x;
    const dy = y + (ROWS / 2) * CELL;
    c.fillStyle = '#fff';
    for (let j = 0; j < gy; j++)
      for (let i = 0; i < gx; i++) {
        let sum = 0, n = 0;
        for (let yy = Math.floor(y0 + (j * h) / gy); yy < y0 + ((j + 1) * h) / gy; yy += 2)
          for (let xx = Math.floor(x0 + (i * w) / gx); xx < x0 + ((i + 1) * w) / gx; xx += 2) {
            sum += img[(yy * CELL + xx) * 4];
            n++;
          }
        if (sum / n / 255 > 0.32) {
          c.beginPath();
          c.arc(dx + x0 + ((i + 0.5) * w) / gx, dy + y0 + ((j + 0.5) * h) / gy, (w / gx) * 0.42, 0, Math.PI * 2);
          c.fill();
        }
      }
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 4;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return { texture: tex, cols: COLS, rows: ROWS };
}
