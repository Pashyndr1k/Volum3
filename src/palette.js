// SQNCR's five hues, each expanded into three (bg, fg) pairs — fifteen two-tone combinations.
// A voice takes pair `index mod 15`, exactly as SQNCR's `d0` does.
export const PAIRS = [
  { bg: '#DDDACC', fg: '#000000' },
  { bg: '#9F967E', fg: '#000000' },
  { bg: '#9F967E', fg: '#3F4336' },
  { bg: '#79AFB4', fg: '#3B5657' },
  { bg: '#3D5B5D', fg: '#95BFC2' },
  { bg: '#79AFB4', fg: '#000000' },
  { bg: '#4E5635', fg: '#9BAC5B' },
  { bg: '#9BAC5B', fg: '#000000' },
  { bg: '#7D7735', fg: '#9BAC5B' },
  { bg: '#D7A45A', fg: '#8B632A' },
  { bg: '#8C6A34', fg: '#E0A85A' },
  { bg: '#79592B', fg: '#000000' },
  { bg: '#E45237', fg: '#000000' },
  { bg: '#8B655B', fg: '#B1A588' },
  { bg: '#836C5D', fg: '#FF4A2E' },
];

export const INK = '#DDDACA';
export const ACCENT = '#F74227';

export function pairFor(index) {
  return PAIRS[((index % PAIRS.length) + PAIRS.length) % PAIRS.length];
}
