/*
  Every cube is a rigid body on a spring to its place in the block, and on springs to the cubes
  it touches. A strike is an impulse. The anchor spring brings the cube home with one visible
  overshoot; the neighbour springs hand part of the push on, cube to cube, so a single hit
  travels through the whole block as a wave — SQNCR's emission rings, done with mass instead of
  timers. Mass is volume, so the big blocks lag and the small ones rattle.

  State is displacement from rest, in the cluster's own frame. Semi-implicit Euler at a fixed
  240 Hz, which is stable here by a wide margin (ω·dt ≈ 0.1 for the stiffest cube).

  Tuned by measurement (see docs/PROTOTYPE.md): a full-energy hit moves a small cube ~0.4 units,
  its neighbours ~15 % of that, the front travels ~40 ms per unit, and it settles within ~1 s.
*/

export const DT = 1 / 240;

export const TUNING = {
  anchor: 150, // N/m for a unit cube — about 2 Hz, a floating rather than bolted feel
  anchorDamping: 0.2, // damping ratio: a clear overshoot and two smaller wobbles
  neighbour: 500, // total coupling per cube, shared among the cubes it touches — sets how far the wave carries
  neighbourDamping: 0.04,
  spin: 400, // angular stiffness, as ω² for the cube's own inertia
  spinDamping: 0.3,
  impulse: 14, // m/s given to a unit cube at energy 1
  twist: 0.3, // share of an off-centre hit that turns into spin; enough to read as a knock, not a tumble
  maxOffset: 1.2,
};

export class ClusterPhysics {
  constructor(pieces, edges) {
    const n = pieces.length;
    this.n = n;
    this.edges = edges;
    this.u = new Float32Array(n * 3); // displacement
    this.v = new Float32Array(n * 3); // velocity
    this.th = new Float32Array(n * 3); // small-angle rotation vector
    this.w = new Float32Array(n * 3); // angular velocity
    this.mass = new Float32Array(n);
    this.kA = new Float32Array(n);
    this.cA = new Float32Array(n);
    this.inertia = new Float32Array(n);
    this.f = new Float32Array(n * 3);
    this.acc = 0;
    // Split each cube's coupling over its contacts, so a small cube wedged among twelve others
    // isn't twelve times stiffer than a big one with four.
    const degree = new Float32Array(n);
    for (const [a, b] of edges) {
      degree[a]++;
      degree[b]++;
    }
    this.share = edges.map(([a, b]) => 2 / (degree[a] + degree[b]));
    pieces.forEach((p, i) => {
      const m = p.size ** 3;
      this.mass[i] = m;
      this.kA[i] = TUNING.anchor * Math.pow(m, 0.75);
      this.cA[i] = 2 * TUNING.anchorDamping * Math.sqrt(this.kA[i] * m);
      this.inertia[i] = (m * p.size * p.size) / 6;
    });
  }

  /**
   * Push cube i. `dir` is a unit vector in the cluster frame, `arm` the point of contact
   * relative to the cube's centre (for the torque), `energy` 0…1.
   */
  strike(i, dir, arm, energy) {
    const m = this.mass[i];
    const j = TUNING.impulse * energy * Math.pow(m, 0.75);
    const o = i * 3;
    this.v[o] += (dir[0] * j) / m;
    this.v[o + 1] += (dir[1] * j) / m;
    this.v[o + 2] += (dir[2] * j) / m;
    // τ = r × J
    const I = this.inertia[i] / TUNING.twist;
    this.w[o] += ((arm[1] * dir[2] - arm[2] * dir[1]) * j) / I;
    this.w[o + 1] += ((arm[2] * dir[0] - arm[0] * dir[2]) * j) / I;
    this.w[o + 2] += ((arm[0] * dir[1] - arm[1] * dir[0]) * j) / I;
  }

  advance(dt) {
    this.acc = Math.min(this.acc + dt, 0.1);
    while (this.acc >= DT) {
      this.step(DT);
      this.acc -= DT;
    }
  }

  step(dt) {
    const { n, u, v, th, w, f, mass, kA, cA, inertia } = this;
    for (let i = 0; i < n; i++) {
      const o = i * 3;
      for (let k = 0; k < 3; k++) f[o + k] = -kA[i] * u[o + k] - cA[i] * v[o + k];
    }
    for (let e = 0; e < this.edges.length; e++) {
      const [a, b] = this.edges[e];
      const oa = a * 3, ob = b * 3;
      const kN = TUNING.neighbour * this.share[e];
      const cN = 2 * TUNING.neighbourDamping * Math.sqrt(kN * Math.min(mass[a], mass[b]));
      for (let k = 0; k < 3; k++) {
        const force = -kN * (u[oa + k] - u[ob + k]) - cN * (v[oa + k] - v[ob + k]);
        f[oa + k] += force;
        f[ob + k] -= force;
      }
    }
    const lim = TUNING.maxOffset;
    for (let i = 0; i < n; i++) {
      const o = i * 3;
      const m = mass[i];
      const kR = TUNING.spin * inertia[i];
      const cR = 2 * TUNING.spinDamping * Math.sqrt(kR * inertia[i]);
      for (let k = 0; k < 3; k++) {
        v[o + k] += (f[o + k] / m) * dt;
        u[o + k] = Math.max(-lim, Math.min(lim, u[o + k] + v[o + k] * dt));
        w[o + k] += ((-kR * th[o + k] - cR * w[o + k]) / inertia[i]) * dt;
        th[o + k] += w[o + k] * dt;
      }
    }
  }

  offset(i) {
    const o = i * 3;
    return Math.hypot(this.u[o], this.u[o + 1], this.u[o + 2]);
  }
}
