import * as THREE from 'three';
import { STYLE_UNIFORMS, STYLE_GLSL, Ghosts } from './styles.js';

/*
  SQNCR's emissions (`Nl`) in three dimensions. A struck cube throws marks onto the shells
  around it: ring 1 just off its faces, ring 2 one step further, and so on. Each ring is born
  70 ms after the last, so the throw reads as a pulse expanding outward. A mark holds, then fades
  — same timings as SQNCR. Most marks are small dots; with EMISSION ≥ 2 a third are blocks.

  Drawn additively, so fading a mark's colour to black is the same as fading it out.

  The marks take the shader style like the cubes do (see styles.js), at full strength while they
  are lit: PRISM and GLITCH throw their copies off them along their line from the block's
  centre, DITHER dithers them, FLAT draws them as solid flat squares and GLASS as small shards of
  glass — those two shrink away instead of fading, since neither is light.
*/

const POOL = 900;
const RING_GAP = 0.55;
const BLOCKS = [0.18, 0.18, 0.28, 0.28, 0.38, 0.5];
const DOT = 0.1;
const WHITE = new THREE.Color('#ffffff');

export class Emissions {
  constructor(parent) {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    // What the style copies read: (glow, white, strength) and (…, seed), as on the cubes.
    this.stateAttr = new THREE.InstancedBufferAttribute(new Float32Array(POOL * 3), 3);
    this.stateAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aState', this.stateAttr);
    const spec = new THREE.InstancedBufferAttribute(new Float32Array(POOL * 4), 4);
    for (let i = 0; i < POOL; i++) spec.array[i * 4 + 3] = (i * 0.754877) % 1 * 89;
    geo.setAttribute('aSpec', spec);
    this.light = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    this.light.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, STYLE_UNIFORMS);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${STYLE_GLSL}`)
        .replace('#include <opaque_fragment>', '#include <opaque_fragment>\nif (styleIs(ST_DITHER)) gl_FragColor.rgb = ditherColor(gl_FragColor.rgb);');
    };
    this.flat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.glass = null; // made on first use, with the glass cubes' reflections
    this.style = 'clean';
    this.mesh = new THREE.InstancedMesh(geo, this.light, POOL);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.setColorAt(0, new THREE.Color());
    parent.add(this.mesh);
    this.ghosts = new Ghosts(this.mesh, { spread: 1.6, gain: 0.8 });
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

  // Which style the marks are drawn in; \`envMap\` is what GLASS marks reflect.
  setStyle(id, envMap = null) {
    this.style = id;
    if (id === 'glass' && !this.glass)
      this.glass = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.05, transmission: 1, ior: 1.5, thickness: 0.3, dispersion: 0.3, envMap, envMapIntensity: 0.8 });
    this.mesh.material = id === 'flat' ? this.flat : id === 'glass' ? this.glass : this.light;
  }

  update(t) {
    // Solid marks (FLAT, GLASS) are not light: they shrink away rather than fade to black.
    const solid = this.style === 'flat' || this.style === 'glass';
    this.marks = this.marks.filter((m) => m.deadAt > t);
    let n = 0;
    for (const m of this.marks) {
      if (t < m.born || n >= POOL) continue;
      const alpha = t <= m.fadeAt ? 1 : 1 - (t - m.fadeAt) / Math.max(0.001, m.deadAt - m.fadeAt);
      // Marks pop in at full size and fade; a slight scale-in over the first 40 ms keeps it from flickering.
      const grow = Math.min(1, (t - m.born) / 0.04);
      this.s.setScalar(m.size * grow * (solid ? Math.sqrt(alpha) : 1));
      this.p.set(m.x, m.y, m.z);
      this.m.compose(this.p, this.q, this.s);
      this.mesh.setMatrixAt(n, this.m);
      this.c.copy(m.color).multiplyScalar(solid ? 1 : alpha * 0.85);
      if (this.style === 'glass') this.c.lerp(WHITE, 0.55);
      this.mesh.setColorAt(n, this.c);
      this.stateAttr.array.set([alpha, 0, alpha * 0.9], n * 3);
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.stateAttr.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.ghosts.sync();
  }

  clear() {
    this.marks.length = 0;
  }
}
