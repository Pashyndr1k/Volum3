/*
  Colour profiles: a whole look in one object — the cubes' colours per part, the ink their
  patterns are printed in, what they rest as and what they burn to, the marks they throw, the
  indicator's light, and the post effects (bloom, colour fringe, grain) that finish the frame.

  Every profile is drawn from the reference boards in references.zip (see docs/VISUAL_PROFILES.md
  for the image-by-image breakdown). HALFOF8 keeps SQNCR's own palette.

    lanes  one colour per part of the pattern — what a cube wears when it carries that part
    ink    the colour its pattern is printed in (a string, or one per lane)
    rest   a cube at rest in the DARK look, and a cube with no note in PAINTED
    peak   what a cube burns to when thrown hardest (white unless the palette says otherwise)
    accent the indicator, its trail and the orbit ring
    marks  what the thrown marks take: 'lane' (the cube's colour), or a list to pick from
    material  roughness / metalness / iridescence of the cube surface
    fx     bloom [strength, radius, threshold]; glow, how much light a struck cube gives off
           (bright palettes need less, or bloom washes out); fringe (radial RGB split) and grain
           (film grain), applied on the final image
*/

export const LANE_IDS = ['kick', 'snare', 'hat', 'open', 'perc', 'bass', 'chord', 'melody'];

// Which lane a fallback voice belongs to, so a cube without a note can still borrow a lane colour.
export const VOICE_LANE = {
  kick: 'kick', sub: 'bass', snare: 'snare', clap: 'snare', rim: 'perc', hat: 'hat', shaker: 'hat',
  ohat: 'open', tom: 'perc', conga: 'perc', cowbell: 'perc', noise: 'perc', bass: 'bass',
  chord: 'chord', zap: 'melody', bell: 'melody', lead: 'melody',
};

export const PROFILES = [
  {
    id: 'halfof8',
    label: 'HALFOF8',
    from: 'SQNCR itself: bone, teal, olive, ochre, brick',
    bg: '#000000',
    rest: '#1a1a1a',
    idle: '#2b2a27',
    lanes: { kick: '#DDDACC', snare: '#9F967E', hat: '#79AFB4', open: '#3D5B5D', perc: '#4E5635', bass: '#9BAC5B', chord: '#8C6A34', melody: '#E45237' },
    ink: { kick: '#000000', snare: '#3F4336', hat: '#3B5657', open: '#95BFC2', perc: '#9BAC5B', bass: '#000000', chord: '#E0A85A', melody: '#000000' },
    peak: '#FFFFFF',
    accent: '#DDDACA',
    marks: 'lane',
    material: { roughness: 0.62, metalness: 0.05, iridescence: 0 },
    fx: { bloom: [0.5, 0.45, 0.86], glow: 1.5, fringe: 0, grain: 0 },
  },
  {
    id: 'dopamine',
    label: 'DOPAMINE',
    from: 'c05 c08 c09 c10 c17 c25: acid lime, hot magenta, digital violet, electric cobalt on jet black',
    bg: '#040406',
    rest: '#16161A',
    idle: '#1E1E24',
    lanes: { kick: '#7B3FF2', snare: '#FF007F', hat: '#D0F600', open: '#00F5FF', perc: '#FF8F1C', bass: '#3155FF', chord: '#FF4FA3', melody: '#88FF5F' },
    ink: '#0C0D10',
    peak: '#FFFFFF',
    accent: '#D0F600',
    marks: 'lane',
    material: { roughness: 0.45, metalness: 0.0, iridescence: 0 },
    fx: { bloom: [0.4, 0.45, 0.88], glow: 0.7, fringe: 0.0015, grain: 0.035 },
  },
  {
    id: 'fjord',
    label: 'FJORD',
    from: 'c02 c03 c11 c21 c22: midnight fjord, mint cream, teal, pinky, deep ocean, spring light',
    bg: '#01050C',
    rest: '#0B1C33',
    idle: '#0F2340',
    lanes: { kick: '#404D9B', snare: '#FCB3DC', hat: '#CCFFBC', open: '#9AE1E2', perc: '#FFCDF2', bass: '#018081', chord: '#6186E4', melody: '#F1FB99' },
    ink: '#053264',
    peak: '#F4FFF0',
    accent: '#CCFFBC',
    marks: 'lane',
    material: { roughness: 0.7, metalness: 0.0, iridescence: 0 },
    fx: { bloom: [0.35, 0.45, 0.88], glow: 0.65, fringe: 0, grain: 0.03 },
  },
  {
    id: 'candy',
    label: 'CANDY',
    from: 'c00 c01 c20 c28 c29: rose white, candy pink, cerise, emerald, warm honey, sakura halftone',
    bg: '#060304',
    rest: '#1C1016',
    idle: '#24141C',
    lanes: { kick: '#DA2864', snare: '#FF64BE', hat: '#FFF5FA', open: '#FFBEE6', perc: '#FCD581', bass: '#00555F', chord: '#16A5A3', melody: '#FF9AE9' },
    ink: { kick: '#79023E', snare: '#79023E', hat: '#FF64BE', open: '#DA2864', perc: '#0A6470', bass: '#9AE1E2', chord: '#FFF5FA', melody: '#79023E' },
    peak: '#FFF5FA',
    accent: '#FF64BE',
    marks: 'lane',
    material: { roughness: 0.55, metalness: 0.0, iridescence: 0 },
    fx: { bloom: [0.4, 0.45, 0.88], glow: 0.75, fringe: 0.001, grain: 0.03 },
  },
  {
    id: 'afterglow',
    label: 'AFTERGLOW',
    from: 'c07 c16 c23 c26 c27: sunset gradients and line-scan streaks — violet, flamingo, amber, aqua',
    bg: '#07040F',
    rest: '#1F1848',
    idle: '#241C4E',
    lanes: { kick: '#7A00BA', snare: '#FF387F', hat: '#FCBF06', open: '#00FFDB', perc: '#F26F36', bass: '#246BB6', chord: '#B335AD', melody: '#E5A7C1' },
    ink: '#140835',
    peak: '#FFF1D6',
    accent: '#FCBF06',
    marks: 'lane',
    material: { roughness: 0.5, metalness: 0.1, iridescence: 0 },
    fx: { bloom: [0.6, 0.6, 0.84], glow: 0.9, fringe: 0.004, grain: 0.05 },
  },
  {
    id: 'riso',
    label: 'RISO',
    from: 'p06 p10 p11 p12 p15 p16: risograph and signal prints — vermilion, cyan, ochre, magenta, paper',
    bg: '#000000',
    rest: '#1A1414',
    idle: '#221A1A',
    lanes: { kick: '#E74C31', snare: '#DA236C', hat: '#F5E7D9', open: '#36D2D9', perc: '#EAB65A', bass: '#2D82CE', chord: '#8993EF', melody: '#E1F318' },
    ink: '#211718',
    peak: '#F5E7D9',
    accent: '#E74C31',
    marks: ['#E74C31', '#36D2D9', '#EAB65A', '#F5E7D9'],
    material: { roughness: 0.85, metalness: 0.0, iridescence: 0 },
    fx: { bloom: [0.3, 0.4, 0.9], glow: 0.6, fringe: 0.002, grain: 0.07 },
  },
  {
    id: 'bone',
    label: 'BONE',
    from: 'the flower video, p04 p07 p09: bone white on black, red / amber / blue misregistration at the edges',
    bg: '#07070A',
    rest: '#141416',
    idle: '#18181B',
    lanes: { kick: '#EFEEE5', snare: '#E9E8DB', hat: '#DCCBAD', open: '#EFEEE5', perc: '#988A8D', bass: '#DCCBAD', chord: '#E9E8DB', melody: '#EDAE54' },
    ink: '#0B0B0E',
    peak: '#FFFFFF',
    accent: '#EFEEE5',
    marks: ['#E4262C', '#EDAE54', '#1F3FD9', '#EFEEE5'],
    material: { roughness: 0.7, metalness: 0.0, iridescence: 0 },
    fx: { bloom: [0.35, 0.4, 0.88], glow: 0.7, fringe: 0.006, grain: 0.045 },
  },
  {
    id: 'prism',
    label: 'PRISM',
    from: 'c13 p18 p19: white and graphite glass cubes, metal pin-art, rainbow dispersion at the edges',
    bg: '#030405',
    rest: '#2A2C30',
    idle: '#303338',
    lanes: { kick: '#C4CCD8', snare: '#FAF7F1', hat: '#DEDBD5', open: '#BCB7B3', perc: '#999393', bass: '#726D6C', chord: '#E6EAF0', melody: '#FFFFFF' },
    ink: '#463A3A',
    peak: '#FFFFFF',
    accent: '#FAF7F1',
    marks: 'lane',
    material: { roughness: 0.25, metalness: 0.55, iridescence: 1 },
    fx: { bloom: [0.45, 0.5, 0.86], glow: 0.8, fringe: 0.005, grain: 0.02 },
  },
];

export const PROFILE = new Map(PROFILES.map((p) => [p.id, p]));

export function inkFor(profile, lane) {
  return typeof profile.ink === 'string' ? profile.ink : profile.ink[lane] ?? '#000000';
}
