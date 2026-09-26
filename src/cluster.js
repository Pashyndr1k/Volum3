import * as THREE from 'three';
import { mulberry32, shuffle } from './rng.js';

/*
  The large cube is packed like SQNCR packs its field: an occupancy grid, big blocks first,
  greedy over a shuffled candidate list, then single cells fill what is left. Sizes are 1, 2 and
  4 cells — SQNCR's and PatternGen's 20/40/80 ladder — and the big ones sit on the even lattice,
  so they tile without stranding odd gaps. Medium blocks keep going until the estimated total
  reaches about a hundred cubes. A few cells stay empty and every cube is shrunk, nudged and
  tilted a little, which is what makes the cluster irregular rather than a Rubik's cube.
*/

export const GRID = 8;
const BIG = 2;
const TARGET = 104;
const HOLE_CHANCE = 0.06;

export function generateCluster(seed) {
  const rand = mulberry32(seed ^ 0x51ed);
  const occ = new Uint8Array(GRID * GRID * GRID);
  const at = (x, y, z) => (z * GRID + y) * GRID + x;
  const free = (x, y, z, s) => {
    for (let k = z; k < z + s; k++)
      for (let j = y; j < y + s; j++)
        for (let i = x; i < x + s; i++) if (occ[at(i, j, k)]) return false;
    return true;
  };
  const mark = (x, y, z, s) => {
    for (let k = z; k < z + s; k++)
      for (let j = y; j < y + s; j++) for (let i = x; i < x + s; i++) occ[at(i, j, k)] = 1;
  };

  const blocks = [];
  let used = 0;
  let big = 0;
  for (const size of [4, 2]) {
    const origins = [];
    for (let z = 0; z <= GRID - size; z += 2)
      for (let y = 0; y <= GRID - size; y += 2)
        for (let x = 0; x <= GRID - size; x += 2) origins.push([x, y, z]);
    shuffle(origins, rand);
    for (const [x, y, z] of origins) {
      if (size === 4 && big >= BIG) break;
      if (blocks.length + (GRID ** 3 - used) * (1 - HOLE_CHANCE) <= TARGET) break;
      if (!free(x, y, z, size)) continue;
      mark(x, y, z, size);
      blocks.push({ cell: [x, y, z], size });
      used += size ** 3;
      if (size === 4) big++;
    }
  }
  for (let z = 0; z < GRID; z++)
    for (let y = 0; y < GRID; y++)
      for (let x = 0; x < GRID; x++) {
        if (occ[at(x, y, z)]) continue;
        occ[at(x, y, z)] = 1;
        if (rand() < HOLE_CHANCE) continue;
        blocks.push({ cell: [x, y, z], size: 1 });
      }

  const half = GRID / 2;
  const pieces = blocks.map((b, index) => {
    const [x, y, z] = b.cell;
    const s = b.size;
    const jitter = () => (rand() - 0.5) * 0.1;
    const rest = new THREE.Vector3(x + s / 2 - half + jitter(), y + s / 2 - half + jitter(), z + s / 2 - half + jitter());
    const tilt = new THREE.Euler((rand() - 0.5) * 0.08, (rand() - 0.5) * 0.08, (rand() - 0.5) * 0.08);
    return {
      index,
      size: s,
      cell: b.cell,
      rest,
      restQuat: new THREE.Quaternion().setFromEuler(tilt),
      scale: s - 0.1 - rand() * 0.1,
      // Height through the block, 0 at the bottom and 1 at the top — this is SQNCR's row, i.e. pitch.
      height: (y + s / 2) / GRID,
      salt: rand(),
    };
  });

  return { pieces, edges: neighbours(pieces), half };
}

// Two cubes are neighbours when their grid boxes touch on a face, edge or corner.
function neighbours(pieces) {
  const edges = [];
  for (let a = 0; a < pieces.length; a++)
    for (let b = a + 1; b < pieces.length; b++) {
      const A = pieces[a], B = pieces[b];
      let touching = true;
      for (let k = 0; k < 3; k++) {
        const gap = Math.max(A.cell[k] - (B.cell[k] + B.size), B.cell[k] - (A.cell[k] + A.size));
        if (gap > 0) { touching = false; break; }
      }
      if (touching) edges.push([a, b]);
    }
  return edges;
}
