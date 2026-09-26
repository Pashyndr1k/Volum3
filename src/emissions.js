import * as THREE from 'three';

/*
  SQNCR's emissions (`Nl`) in three dimensions. A struck cube throws marks onto the shells
  around it: ring 1 just off its faces, ring 2 one step further, and so on. Each ring is born
  70 ms after the last, so the throw reads as a pulse expanding outward. A mark holds, then fades
  — same timings as SQNCR. Most marks are small dots; with EMISSION ≥ 2 a third are blocks.

  Drawn additively, so fading a mark's colour to black is the same as fading it out.
*/

const POOL = 900;
const RING_GAP = 0.55;
const BLOCKS = [0.18, 0.18, 0.28, 0.28, 0.38, 0.5];
const DOT = 0.1;

export class Emissions {
  constructor(parent) {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, POOL);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.setColorAt(0, new THREE.Color());
    parent.add(this.mesh);
    this.marks = [];
    this.m = new THREE.Matrix4();
    this.c = new THREE.Color();
    this.q = new THREE.Quaternion();
    this.s = new THREE.Vector3();
    this.p = new THREE.Vector3();
  }

  /**
   * @param centre  cube centre in the cluster frame
   * @param size    cube edge length
   * @param color   THREE.Color of the cube
   * @param energy  0…1
   * @param grain   EMISSION 1…5
   * @param at      clock time of the strike
   */
  throw(centre, size, color, energy, grain, at, rand = Math.random) {
    if (this.marks.length > POOL - 40) return;
    const rings = 1 + Math.round(energy * 2) + Math.max(0, grain - 3);
    const blockSizes = grain <= 1 ? 0 : grain === 2 ? 4 : BLOCKS.length;
    for (let r = 1; r <= rings; r++) {
      const count = Math.max(2, Math.round(2 + energy * 3.2));
      const half = size / 2 + r * RING_GAP;
      for (let k = 0; k < count; k++) {
        // A random point on the shell cube of half-size `half`, snapped to a half-unit lattice.
        const axis = Math.floor(rand() * 3);
        const pos = [0, 0, 0];
        for (let a = 0; a < 3; a++)
          pos[a] = a === axis ? (rand() < 0.5 ? -half : half) : Math.round(((rand() * 2 - 1) * half) / 0.5) * 0.5;
        const block = blockSizes > 0 && rand() < 0.32;
        const born = at + (r - 1) * 0.07;
        const fadeAt = born + 0.35 + rand() * 0.55;
        this.marks.push({
          x: centre.x + pos[0],
          y: centre.y + pos[1],
          z: centre.z + pos[2],
          size: block ? BLOCKS[Math.floor(rand() * blockSizes)] : DOT,
          color: color.clone(),
          born,
          fadeAt,
          deadAt: fadeAt + 0.3 + rand() * 0.5,
        });
      }
    }
  }

  update(t) {
    this.marks = this.marks.filter((m) => m.deadAt > t);
    let n = 0;
    for (const m of this.marks) {
      if (t < m.born || n >= POOL) continue;
      const alpha = t <= m.fadeAt ? 1 : 1 - (t - m.fadeAt) / Math.max(0.001, m.deadAt - m.fadeAt);
      // Marks pop in at full size and fade; a slight scale-in over the first 40 ms keeps it from flickering.
      const grow = Math.min(1, (t - m.born) / 0.04);
      this.s.setScalar(m.size * grow);
      this.p.set(m.x, m.y, m.z);
      this.m.compose(this.p, this.q, this.s);
      this.mesh.setMatrixAt(n, this.m);
      this.c.copy(m.color).multiplyScalar(alpha * 0.85);
      this.mesh.setColorAt(n, this.c);
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  clear() {
    this.marks.length = 0;
  }
}
