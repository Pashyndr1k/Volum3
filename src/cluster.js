import * as THREE from 'three';
import { mulberry32, shuffle } from './rng.js';

/*
  The large cube is packed like SQNCR packs its field: an occupancy grid, big blocks first,
  greedy over a shuffled candidate list, then single cells fill what is left. Sizes are 1, 2 and
  4 cells — SQNCR's and PatternGen's 20/40/80 ladder — and the big ones sit on the even lattice,
  so they tile without stranding odd gaps. Medium blocks keep going until the estimated total
  reaches about a hundred cubes. Every cube is shrunk, nudged and tilted a little, which is what
  makes the cluster irregular rather than a Rubik's cube.

  Before anything is packed, caverns are carved out: a hollow core, tunnels that wander in from
  the faces to reach it, and small pockets. Carved cells are booked as taken, so nothing is
  placed there — you can look through the block into its middle.
*/

export const GRID = 8;
const BIG = 2;
const TARGET = 96;
const HOLE_CHANCE = 0.04;

// CAVES 1…3: how hollow the block is.
const CAVES = {
  1: { core: 1.3, tunnels: 2, pockets: 2 },
  2: { core: 1.75, tunnels: 4, pockets: 4 },
  3: { core: 2.2, tunnels: 6, pockets: 7 },
};

function carve(rand, level, at) {
  const cfg = CAVES[level] ?? CAVES[2];
  const hollow = new Uint8Array(GRID * GRID * GRID);
  const c = (GRID - 1) / 2;
  const inside = (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < GRID && y < GRID && z < GRID;
  const dig = (x, y, z) => inside(x, y, z) && (hollow[at(x, y, z)] = 1);

  // The core: every cell whose centre is near the middle, with a ragged edge.
  for (let z = 0; z < GRID; z++)
    for (let y = 0; y < GRID; y++)
      for (let x = 0; x < GRID; x++)
        if (Math.hypot(x - c, y - c, z - c) < cfg.core + (rand() - 0.5) * 0.6) dig(x, y, z);

  // Tunnels: 2×2 cells wide and aligned to the even lattice, so the blocks around them still
  // tile cleanly. Start on a random face, walk toward the core, stray sideways now and then.
  const M = GRID / 2;
  const mc = (M - 1) / 2;
  for (let t = 0; t < cfg.tunnels; t++) {
    const axis = Math.floor(rand() * 3);
    const p = [Math.floor(rand() * M), Math.floor(rand() * M), Math.floor(rand() * M)];
    p[axis] = rand() < 0.5 ? 0 : M - 1;
    for (let step = 0; step < M * 3; step++) {
      for (let dz = 0; dz < 2; dz++)
        for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) dig(p[0] * 2 + dx, p[1] * 2 + dy, p[2] * 2 + dz);
      if (Math.hypot(p[0] - mc, p[1] - mc, p[2] - mc) < 1) break;
      const k = rand() < 0.65 ? [0, 1, 2].sort((a, b) => Math.abs(mc - p[b]) - Math.abs(mc - p[a]))[0] : Math.floor(rand() * 3);
      p[k] = Math.max(0, Math.min(M - 1, p[k] + (mc > p[k] ? 1 : -1)));
    }
  }

  // Pockets: small hollows here and there in the walls.
  for (let k = 0; k < cfg.pockets; k++) {
    const x = Math.floor(rand() * GRID), y = Math.floor(rand() * GRID), z = Math.floor(rand() * GRID);
    dig(x, y, z);
    if (rand() < 0.6) dig(x + (rand() < 0.5 ? 1 : -1), y, z);
    if (rand() < 0.4) dig(x, y + 1, z);
  }
  return hollow;
}

export function generateCluster(seed, caves = 2) {
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

  const hollow = carve(rand, caves, at);
  let open = 0;
  for (let i = 0; i < occ.length; i++) {
    occ[i] = hollow[i];
    if (!hollow[i]) open++;
  }

  const blocks = [];
  let big = 0;
  for (const size of [4, 2]) {
    const origins = [];
    for (let z = 0; z <= GRID - size; z += 2)
      for (let y = 0; y <= GRID - size; y += 2)
        for (let x = 0; x <= GRID - size; x += 2) origins.push([x, y, z]);
    shuffle(origins, rand);
    for (const [x, y, z] of origins) {
      if (size === 4 && big >= BIG) break;
      if (blocks.length + open * (1 - HOLE_CHANCE) <= TARGET) break;
      if (!free(x, y, z, size)) continue;
      mark(x, y, z, size);
      blocks.push({ cell: [x, y, z], size });
      open -= size ** 3;
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
      scale: s * (0.84 - rand() * 0.05),
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
