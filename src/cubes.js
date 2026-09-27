import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/*
  All ~100 cubes are one InstancedMesh: one draw call. Each instance carries:

    colour   what the cube is painted (per profile and part)
    ink      the colour its pattern is printed in
    pattern  which pattern (see PATTERNS in profiles.js) — the kind of cube
    white    how far its colour is pulled toward the profile's peak colour
    glow     how much of that colour it gives off as light

  The pattern is drawn in the shader on each face's own UVs, at a fixed density per unit of cube,
  so a big cube carries more of it rather than a stretched copy. It swells with the glow: dots
  fill in like a halftone darkening, lines thicken — a struck cube's pattern visibly flares.
  Glow makes a cube the light, and bloom picks it up. PRISM adds a thin-film rainbow at grazing
  angles, like the glass renders in the references.
*/

const PATTERN_GLSL = /* glsl */ `
float patternMask(float id, vec2 uv, float size, float act, float density) {
  if (id < 0.5) return 0.0;
  vec2 p = uv * size * density;
  vec2 f = fract(p) - 0.5;
  float aa = max(fwidth(p.x), fwidth(p.y)) * 0.75;
  if (id < 1.5) { // dots
    float r = mix(0.14, 0.44, act);
    return 1.0 - smoothstep(r - aa, r + aa, length(f));
  }
  if (id < 2.5) { // rings
    float w = mix(0.045, 0.13, act);
    return 1.0 - smoothstep(w - aa, w + aa, abs(length(f) - 0.3));
  }
  if (id < 3.5) { // X marks
    vec2 q = abs(f);
    float w = mix(0.05, 0.13, act);
    return (1.0 - smoothstep(w - aa, w + aa, abs(q.x - q.y) * 0.7071)) * step(max(q.x, q.y), 0.36);
  }
  if (id < 4.5) { // plus signs
    vec2 q = abs(f);
    float w = mix(0.05, 0.13, act);
    return (1.0 - smoothstep(w - aa, w + aa, min(q.x, q.y))) * step(max(q.x, q.y), 0.36);
  }
  if (id < 5.5) { // checkerboard, one cell in two filled; struck, the empty cells half-fill
    vec2 c = floor(p);
    float k = mod(c.x + c.y, 2.0);
    return max(k, act * 0.5);
  }
  if (id < 6.5) { // diagonal hatching
    float s = fract((p.x + p.y) * 0.5);
    float w = mix(0.14, 0.36, act);
    return 1.0 - smoothstep(w - aa, w + aa, abs(s - 0.5));
  }
  if (id < 7.5) { // horizontal bars
    float s = fract(p.y * 0.5);
    float w = mix(0.16, 0.36, act);
    return 1.0 - smoothstep(w - aa, w + aa, abs(s - 0.5));
  }
  if (id < 8.5) { // target: rings out from the face centre
    float d = length(uv - 0.5) * size * density * 0.9;
    float w = mix(0.16, 0.34, act);
    return 1.0 - smoothstep(w - aa, w + aa, abs(fract(d) - 0.5));
  }
  // hairline grid
  vec2 q = 0.5 - abs(f);
  float w = 0.035;
  return (1.0 - smoothstep(w - aa, w + aa, min(q.x, q.y))) * 0.6;
}
`;

export class Cubes {
  constructor(pieces, parent) {
    const n = pieces.length;
    const geo = new RoundedBoxGeometry(1, 1, 1, 3, 0.06);
    const attr = (name, size) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(n * size), size);
      a.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute(name, a);
      return a;
    };
    this.glowAttr = attr('aGlow', 1);
    this.whiteAttr = attr('aWhite', 1);
    this.patternAttr = attr('aPattern', 1);
    this.inkAttr = attr('aInk', 3);
    this.glow = this.glowAttr.array;
    this.white = this.whiteAttr.array;

    this.uniforms = {
      uPeak: { value: new THREE.Color('#ffffff') },
      uTexture: { value: 1 },
      uDensity: { value: 4 },
      uIrid: { value: 0 },
      uEmit: { value: 1.5 },
    };
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.62, metalness: 0.05 });
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          attribute float aGlow; attribute float aWhite; attribute float aPattern; attribute vec3 aInk;
          varying float vGlow; varying float vWhite; varying float vPattern; varying vec3 vInk;
          varying vec2 vFaceUv; varying float vSize;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vGlow = aGlow; vWhite = aWhite; vPattern = aPattern; vInk = aInk; vFaceUv = uv;
          vSize = length(instanceMatrix[0].xyz);`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform vec3 uPeak; uniform float uTexture; uniform float uDensity; uniform float uIrid; uniform float uEmit;
          varying float vGlow; varying float vWhite; varying float vPattern; varying vec3 vInk;
          varying vec2 vFaceUv; varying float vSize;
          ${PATTERN_GLSL}`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          float m = patternMask(vPattern, vFaceUv, vSize, clamp(vGlow * 1.4, 0.0, 1.0), uDensity) * uTexture;
          diffuseColor.rgb = mix(diffuseColor.rgb, vInk, m * 0.85);
          diffuseColor.rgb = mix(diffuseColor.rgb, uPeak, vWhite);
          totalEmissiveRadiance += diffuseColor.rgb * vGlow * uEmit;
          if (uIrid > 0.0) {
            // A thin-film rainbow at grazing angles, faint at rest and brighter as the cube lights.
            float fr = pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 3.0);
            vec3 film = 0.5 + 0.5 * cos(6.2831 * (fr * 1.6 + vec3(0.0, 0.33, 0.67)));
            totalEmissiveRadiance += film * fr * uIrid * 0.2 * (0.25 + vGlow);
          }`,
        );
    };

    this.mesh = new THREE.InstancedMesh(geo, mat, n);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.base = pieces.map((p) => new THREE.Color(p.color));
    pieces.forEach((p, i) => this.mesh.setColorAt(i, this.base[i]));
    parent.add(this.mesh);

    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.qd = new THREE.Quaternion();
    this.p = new THREE.Vector3();
    this.s = new THREE.Vector3();
    this.axis = new THREE.Vector3();
  }

  // The surface for a profile: finish, peak colour, iridescence; and whether patterns show.
  setLook({ roughness, metalness, iridescence, peak, texture, emit = 1.5 }) {
    this.uniforms.uEmit.value = emit;
    this.mesh.material.roughness = roughness;
    this.mesh.material.metalness = metalness;
    this.uniforms.uIrid.value = iridescence;
    this.uniforms.uPeak.value.set(peak);
    this.uniforms.uTexture.value = texture ? 1 : 0;
  }

  // Which pattern and ink each cube carries.
  setPatterns(patterns, inks) {
    for (let i = 0; i < patterns.length; i++) {
      this.patternAttr.array[i] = patterns[i];
      inks[i].toArray(this.inkAttr.array, i * 3);
    }
    this.patternAttr.needsUpdate = true;
    this.inkAttr.needsUpdate = true;
  }

  // Per-frame ink (the DARK look fades the ink in with the colour).
  setInk(i, color) {
    color.toArray(this.inkAttr.array, i * 3);
    this.inkAttr.needsUpdate = true;
  }

  // Put the painted colours back (after DARK mode drew its own).
  restore() {
    this.base.forEach((c, i) => this.mesh.setColorAt(i, c));
    this.mesh.instanceColor.needsUpdate = true;
  }

  setColors(colors) {
    colors.forEach((c, i) => {
      this.base[i].set(c);
      this.mesh.setColorAt(i, this.base[i]);
    });
    this.mesh.instanceColor.needsUpdate = true;
  }

  // `display` (optional): per-cube colours for this frame, leaving the painted base untouched.
  update(pieces, physics, glow, white, display = null) {
    const { u, th } = physics;
    for (let i = 0; i < pieces.length; i++) {
      const pc = pieces[i];
      const o = i * 3;
      this.p.set(pc.rest.x + u[o], pc.rest.y + u[o + 1], pc.rest.z + u[o + 2]);
      const angle = Math.hypot(th[o], th[o + 1], th[o + 2]);
      if (angle > 1e-6) {
        this.axis.set(th[o] / angle, th[o + 1] / angle, th[o + 2] / angle);
        this.qd.setFromAxisAngle(this.axis, angle);
        this.q.copy(this.qd).multiply(pc.restQuat);
      } else this.q.copy(pc.restQuat);
      this.s.setScalar(pc.scale);
      this.m.compose(this.p, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
      this.glow[i] = glow[i];
      this.white[i] = white[i];
      if (display) this.mesh.setColorAt(i, display[i]);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.glowAttr.needsUpdate = true;
    this.whiteAttr.needsUpdate = true;
    if (display) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose() {
    this.mesh.parent?.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.dispose();
  }
}
