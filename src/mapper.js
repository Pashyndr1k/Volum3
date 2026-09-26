/*
  Hands every note of the pattern to a cube. The orbit is the clock, so a note at step s wants a
  cube whose azimuth is at s — then the cube is struck exactly as the indicator passes it. The
  lattice leaves some steps crowded and some empty, so the search widens a step at a time
  (±1, ±2, ±3; about 6° each) and only then settles for the nearest cube anywhere.

  Which cube within the window depends on the lane: kick and bass sink to the low, heavy cubes,
  hats rise to the top, and the melody climbs the block with its pitch — a high note lands high.
  Free cubes are preferred; when a busy pattern has more notes than cubes, a cube takes several
  nearby notes and is simply struck several times as the indicator goes by.
*/

const PRIORITY = ['kick', 'bass', 'snare', 'chord', 'melody', 'perc', 'open', 'hat'];
const WINDOW = [0, 1, -1, 2, -2, 3, -3];

export function mapPattern(pattern, pieces, steps) {
  const buckets = Array.from({ length: steps }, () => []);
  pieces.forEach((p, i) => buckets[p.step].push(i));

  const melody = pattern.events.filter((e) => e.lane === 'melody');
  const lo = Math.min(...melody.map((e) => e.midi), 60);
  const hi = Math.max(...melody.map((e) => e.midi), lo + 12);

  const score = (e, p) => {
    switch (e.lane) {
      case 'kick':
      case 'bass':
        return p.height - 0.3 * p.size;
      case 'snare':
      case 'chord':
        return Math.abs(p.height - 0.45) - 0.1 * p.size;
      case 'hat':
      case 'open':
        return 1 - p.height;
      case 'perc':
        return Math.abs(p.height - 0.6);
      case 'melody':
        return Math.abs(p.height - (e.midi - lo) / (hi - lo));
      default:
        return 0;
    }
  };

  const load = new Int32Array(pieces.length);
  const byStep = Array.from({ length: steps }, () => []);
  const cubeEvents = pieces.map(() => []);
  const order = [...pattern.events].sort((a, b) => PRIORITY.indexOf(a.lane) - PRIORITY.indexOf(b.lane) || a.step - b.step);

  for (const e of order) {
    let best = -1;
    // Pass 1: a free cube near the note. Pass 2: the least-used cube near it.
    for (const allowBusy of [false, true]) {
      for (const w of WINDOW) {
        const s = (((e.step + w) % steps) + steps) % steps;
        let bestScore = Infinity;
        for (const i of buckets[s]) {
          if (!allowBusy && load[i] > 0) continue;
          const sc = score(e, pieces[i]) + load[i] * 0.5;
          if (sc < bestScore) {
            bestScore = sc;
            best = i;
          }
        }
        if (best >= 0) break;
      }
      if (best >= 0) break;
    }
    if (best < 0) {
      // No cube within ±3 steps: the nearest one in azimuth, wherever it is.
      let bestD = Infinity;
      pieces.forEach((p, i) => {
        const d = Math.min(Math.abs(p.step - e.step), steps - Math.abs(p.step - e.step));
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
    }
    load[best]++;
    byStep[e.step].push({ event: e, cube: best });
    cubeEvents[best].push(e);
  }
  const idle = pieces.map((_, i) => i).filter((i) => load[i] === 0);
  return { byStep, cubeEvents, idle };
}
