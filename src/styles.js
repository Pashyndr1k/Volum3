import * as THREE from 'three';

/*
  Shader styles: how the cubes and the indicator are drawn, chosen like a colour profile. A
  style lives on each cube, not on the frame: the background, the orbit, the trail and the marks
  stay clean. Its strength is per cube — 0 while a cube sits in its place in the block,
  rising to 1 as it is thrown to its furthest (`aState.z`) — so a resting block looks plain and the effect
  blooms out of it with every hit, strongest on the cubes that fly furthest. The indicator
  always carries it.

    CLEAN     plain cubes
    PRISM     white light split into its spectrum, from the block's centre outward: the surface
              carries rainbow bands running out from the centre, and every thrown cube casts a
              fan of spectral copies of itself along its own line from the centre — red nearest,
              violet furthest — so the rainbows radiate in every direction at once. c13, p19.
    GLITCH    a damaged digital signal on each cube: its face torn into sideways-shifted slices,
              its print split R / B, its colours rotated in torn rows, scanlines, and a red and a
              cyan copy of it jumping about its line from the centre in bursts. p14, p19, c27.
    HALFTONE  the cube's own shading re-drawn as rotated red, green and blue dot screens on its
              faces. c06, c12, c29.
    DITHER    the cube's shading as ordered 4 × 4 dither per channel on a coarse pixel grid —
              eight colours. p04, the flower video.

  The surface part is in the cube shader (`src/cubes.js`); the copies are `Ghosts` below, drawn
  from the same instanced geometry, so each cube's copies move and turn with it.
*/

export const STYLES = [
  { id: 'clean', label: 'CLEAN' },
  { id: 'prism', label: 'PRISM' },
  { id: 'glitch', label: 'GLITCH' },
  { id: 'halftone', label: 'HALFTONE' },
  { id: 'dither', label: 'DITHER' },
];
export const STYLE_INDEX = Object.fromEntries(STYLES.map((s, i) => [s.id, i]));

// Shared by every cube material and every ghost: which style, the clock and the beat pulse.
export const STYLE_UNIFORMS = {
  uStyle: { value: 0 },
  uTime: { value: 0 },
  uPulse: { value: 0 },
  uPx: { value: 3 }, // DITHER's pixel, in device pixels
};

export function setStyle(id) {
  STYLE_UNIFORMS.uStyle.value = STYLE_INDEX[id] ?? 0;
}

export function updateStyle(time, pulse, pixelRatio, height) {
  STYLE_UNIFORMS.uTime.value = time;
  STYLE_UNIFORMS.uPulse.value = pulse;
  STYLE_UNIFORMS.uPx.value = Math.max(2, Math.floor((height * pixelRatio) / 300));
}

export const STYLE_GLSL = /* glsl */ `
uniform float uStyle;
uniform float uPulse;
uniform float uPx;
vec3 spectrum(float t) { // red → violet across 0…1
  t = clamp(t, 0.0, 1.0) * 0.83;
  return clamp(vec3(abs(t * 6.0 - 3.0) - 1.0, 2.0 - abs(t * 6.0 - 2.0), 2.0 - abs(t * 6.0 - 4.0)), 0.0, 1.0);
}
float styleHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
`;

/*
  The copies. Each band is the whole instanced block drawn again, additive and a little larger,
  pushed out along each cube's line from the centre (and, for GLITCH, jolted sideways) by its
  own strength (`aState.z`). A cube at rest has no copies; a thrown one trails a spectrum outward.
*/
const PRISM_BANDS = 6;

const GHOST_VERT = /* glsl */ `
  attribute vec3 aState; // glow, white, fx
  attribute vec4 aSpec; // …, seed
  uniform vec3 uCentre;
  uniform float uBand;
  uniform float uSpread;
  uniform float uTime;
  uniform float uPulse;
  uniform float uStyle;
  varying float vAlpha;
  varying float vFacing;
  float gh(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  void main() {
    vec3 c = instanceMatrix[3].xyz;
    vec3 rad = c - uCentre;
    float rl = length(rad);
    rad = rl > 1e-4 ? rad / rl : vec3(0.0, 1.0, 0.0);
    // Each copy a touch larger than the cube, so it shows round its edges as well as beyond it.
    vec4 p = instanceMatrix * vec4(position * (1.0 + 0.1 * uBand), 1.0);
    float fx = aState.z;
    float aSeed = aSpec.w;
    vAlpha = fx * (0.45 + 0.9 * min(1.0, aState.x + uPulse * 0.4));
    if (uStyle < 1.5) {
      // PRISM: out along the cube's own line from the centre, the further bands further out.
      p.xyz += rad * fx * uSpread * (0.2 + 0.8 * uBand) * (1.0 + 0.35 * uPulse);
    } else {
      // GLITCH: the copy jumps about in bursts, along the line from the centre and across it.
      float t = floor(uTime * 12.0 + aSeed);
      float burst = clamp(step(0.72, gh(vec2(t, aSeed))) + uPulse * 0.8, 0.0, 1.0);
      vec3 side = normalize(cross(rad, vec3(0.0, 1.0, 0.0)) + vec3(1e-4));
      float jr = gh(vec2(t * 1.7, aSeed + uBand * 9.0)) - 0.5;
      float js = gh(vec2(t * 3.1, aSeed * 2.0 + uBand)) - 0.5;
      p.xyz += (rad * (0.25 + jr) + side * js * 1.4) * fx * uSpread * (0.35 + burst);
      vAlpha *= 0.55 + 0.9 * burst;
    }
    vec4 mv = modelViewMatrix * p;
    vec3 n = normalize(normalMatrix * mat3(instanceMatrix) * normal);
    vFacing = abs(dot(n, normalize(-mv.xyz)));
    gl_Position = projectionMatrix * mv;
  }`;

const GHOST_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uGain;
  uniform float uStyle;
  uniform float uTime;
  varying float vAlpha;
  varying float vFacing;
  float gh(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  void main() {
    if (vAlpha < 0.003) discard;
    // Mostly at the silhouette, so the copies read as coloured edges, not a wash of light.
    float a = vAlpha * uGain * (0.15 + 0.85 * pow(1.0 - vFacing, 1.5));
    if (uStyle > 1.5) {
      // GLITCH copies arrive in torn horizontal rows, with scanlines.
      float row = floor(gl_FragCoord.y / 6.0);
      a *= step(0.35, gh(vec2(row, floor(uTime * 14.0)))) * (0.75 + 0.25 * sin(gl_FragCoord.y * 3.14159));
    }
    gl_FragColor = vec4(uColor * a, 1.0);
  }`;

function spectrumColor(t) {
  const s = Math.min(1, Math.max(0, t)) * 0.83;
  const c = (v) => Math.min(1, Math.max(0, v));
  return new THREE.Color(c(Math.abs(s * 6 - 3) - 1), c(2 - Math.abs(s * 6 - 2)), c(2 - Math.abs(s * 6 - 4)));
}

export class Ghosts {
  // `source` is the InstancedMesh to copy: its geometry and matrices are shared, not duplicated.
  constructor(source, { spread = 2.4, gain = 1 } = {}) {
    this.source = source;
    this.meshes = [];
    for (let b = 0; b < PRISM_BANDS; b++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uCentre: { value: new THREE.Vector3() },
          uBand: { value: b / (PRISM_BANDS - 1) },
          uSpread: { value: spread },
          uColor: { value: new THREE.Color() },
          uGain: { value: gain },
          uTime: STYLE_UNIFORMS.uTime,
          uPulse: STYLE_UNIFORMS.uPulse,
          uStyle: STYLE_UNIFORMS.uStyle,
        },
        vertexShader: GHOST_VERT,
        fragmentShader: GHOST_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      });
      const mesh = new THREE.InstancedMesh(source.geometry, mat, source.count);
      mesh.instanceMatrix = source.instanceMatrix;
      mesh.frustumCulled = false;
      mesh.renderOrder = 2;
      mesh.visible = false;
      source.parent.add(mesh);
      this.meshes.push(mesh);
    }
  }

  // Which copies a style shows, and in what colours. PRISM's six bands add up to about white.
  sync() {
    const style = STYLES[STYLE_UNIFORMS.uStyle.value].id;
    const shown = this.source.visible;
    this.meshes.forEach((m, b) => {
      const u = m.material.uniforms;
      m.visible = false;
      if (!shown) return;
      if (style === 'prism') {
        m.visible = true;
        u.uColor.value.copy(spectrumColor(b / (PRISM_BANDS - 1))).multiplyScalar(0.3);
      } else if (style === 'glitch' && b < 2) {
        m.visible = true;
        u.uColor.value.set(b === 0 ? '#ff1830' : '#00e8ff').multiplyScalar(0.5);
      }
    });
  }

  dispose() {
    for (const m of this.meshes) {
      m.parent?.remove(m);
      m.material.dispose();
    }
  }
}
