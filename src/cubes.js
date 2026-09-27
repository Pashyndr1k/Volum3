import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { STYLE_UNIFORMS, STYLE_GLSL, STYLE_INDEX, Ghosts } from './styles.js';

/*
  All ~100 cubes are one InstancedMesh: one draw call. Each instance carries:

    colour   what the cube is painted (per profile and part)
    ink      the colour its pattern is printed in
    pattern  which pattern, at what scale (see textures.js) — set by the
             current texture set, per part
    white    how far its colour is pulled toward the profile's peak colour
    glow     how much of that colour it gives off as light
    fx       how strongly the shader style shows on it: 0 at home, 1 thrown to its furthest

  The pattern is drawn in the shader on each face's own UVs: one oversized mark per face,
  centred and cropped by the face's edges. It swells with the glow: dots
  fill in like a halftone darkening, lines thicken — a struck cube's pattern visibly flares.
  Glow makes a cube the light, and bloom picks it up. PRISM adds a thin-film rainbow at grazing
  angles, like the glass renders in the references.
*/

const PATTERN_GLSL = /* glsl */ `
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float patternMask(float id, vec2 uv, float size, float act, float dens) {
  if (id < 0.5) return 0.0;
  float span = dens < 0.0 ? -dens : size * dens; // marks across this face
  // Per face, the marks are centred on the face: under one mark per face, the one mark is larger
  // than the face and runs off its edges.
  vec2 p = dens < 0.0 ? (uv - 0.5) * span + 0.5 : uv * span;
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
  if (id < 5.5) { // checkerboard; struck, the empty cells half-fill
    vec2 c = floor(p);
    return max(mod(c.x + c.y, 2.0), act * 0.5);
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
    float d = length(uv - 0.5) * span * 0.9;
    float w = mix(0.16, 0.34, act);
    return 1.0 - smoothstep(w - aa, w + aa, abs(fract(d) - 0.5));
  }
  // hairline grid
  vec2 q = 0.5 - abs(f);
  return (1.0 - smoothstep(0.035 - aa, 0.035 + aa, min(q.x, q.y))) * 0.6;
}
`;

/*
  The surface side of the shader styles (see styles.js), on each cube by its own \`vFx\`:
  GLITCH moves the face's print before it is drawn; PRISM adds light; FLAT and DITHER re-draw
  the finished shading.
*/
const SURFACE_GLSL = /* glsl */ `
// GLITCH: this cube's face torn into slices shifted sideways, in bursts.
vec2 glitchUv(vec2 uv, float fx, float seed, out float torn) {
  float t = floor(uTime * 14.0 + seed);
  float burst = clamp(step(0.75, styleHash(vec2(t, seed))) + uPulse * 0.8, 0.0, 1.0);
  float amt = fx * (0.3 + 0.7 * burst);
  float rows = 5.0 + floor(styleHash(vec2(t, seed + 1.0)) * 12.0);
  float row = floor(uv.y * rows);
  torn = step(1.0 - amt * 0.75, styleHash(vec2(row, t + seed)));
  uv.x += torn * (styleHash(vec2(row * 7.1, t)) - 0.5) * 1.4 * amt;
  // Now and then the face drops to a few coarse blocks.
  if (styleHash(vec2(t * 0.7, seed * 3.0)) > 1.0 - 0.4 * amt) uv = (floor(uv * 4.0) + 0.5) / 4.0;
  return uv;
}

// The 4 x 4 Bayer threshold, built from the 2 x 2 one: [0 2; 3 1].
float bayer2(vec2 q) { return mod(2.0 * q.x + 3.0 * q.y, 4.0); }
float bayer4(vec2 p) {
  vec2 q = mod(floor(p), 4.0);
  return (4.0 * bayer2(mod(q, 2.0)) + bayer2(floor(q / 2.0)) + 0.5) / 16.0;
}

`;

export class Cubes {
  /*
    \`ghosts\`: whether this block casts the PRISM / GLITCH copies, and how far and how bright.
  */
  constructor(pieces, parent, { ghosts = { spread: 2.4, gain: 1 } } = {}) {
    const n = pieces.length;
    const geo = new RoundedBoxGeometry(1, 1, 1, 3, 0.06);
    const attr = (name, size) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(n * size), size);
      a.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute(name, a);
      return a;
    };
    // Packed to stay inside WebGL's 16 vertex attributes:
    //   aState = (glow, white, fx) per frame;  aSpec = (pattern, density, –, seed) per dressing.
    this.stateAttr = attr('aState', 3);
    this.specAttr = attr('aSpec', 4);
    this.inkAttr = attr('aInk', 3);
    for (let i = 0; i < n; i++) this.specAttr.array[i * 4 + 3] = (i * 0.6180339) % 1 * 97;
    this.state = this.stateAttr.array;

    this.uniforms = {
      uPeak: { value: new THREE.Color('#ffffff') },
      uTexture: { value: 1 },
      uIrid: { value: 0 },
      uEmit: { value: 1.5 },
      uCentre: { value: new THREE.Vector3() }, // the block's centre, in this mesh's space
      ...STYLE_UNIFORMS,
    };
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.62, metalness: 0.05 });
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform vec3 uCentre;
          attribute vec3 aState; attribute vec4 aSpec; attribute vec3 aInk;
          varying float vGlow; varying float vWhite; varying float vPattern; varying vec3 vInk;
          varying vec2 vFaceUv; varying float vSize; varying float vDensity;
          varying float vSeed;
          varying float vFx; varying vec3 vBlock; varying vec3 vRadView;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vGlow = aState.x; vWhite = aState.y; vFx = aState.z;
          vPattern = aSpec.x; vDensity = aSpec.y; vSeed = aSpec.w;
          vInk = aInk; vFaceUv = uv;
          vSize = length(instanceMatrix[0].xyz);
          vBlock = (instanceMatrix * vec4(transformed, 1.0)).xyz - uCentre;
          vec3 radial = instanceMatrix[3].xyz - uCentre;
          vRadView = normalize((modelViewMatrix * vec4(radial + vec3(1e-4), 0.0)).xyz);`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform vec3 uPeak; uniform float uTexture; uniform float uIrid; uniform float uEmit;
          uniform float uTime;
          varying float vGlow; varying float vWhite; varying float vPattern; varying vec3 vInk;
          varying vec2 vFaceUv; varying float vSize; varying float vDensity;
          varying float vSeed;
          varying float vFx; varying vec3 vBlock; varying vec3 vRadView;
          ${PATTERN_GLSL}
          ${STYLE_GLSL}
          ${SURFACE_GLSL}`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          float act = clamp(vGlow * 1.4, 0.0, 1.0);
          vec2 fuv = vFaceUv;
          float torn = 0.0;
          bool glitch = styleIs(ST_GLITCH) && vFx > 0.001;
          if (glitch) fuv = glitchUv(fuv, vFx, vSeed, torn);
          float m = patternMask(vPattern, fuv, vSize, act, vDensity) * uTexture;
          if (glitch) {
            // The print split R / B across the tear.
            float split = (0.04 + 0.12 * torn) * vFx;
            float mr = patternMask(vPattern, fuv + vec2(split, 0.0), vSize, act, vDensity) * uTexture;
            float mb = patternMask(vPattern, fuv - vec2(split, 0.0), vSize, act, vDensity) * uTexture;
            vec3 base = diffuseColor.rgb;
            diffuseColor.r = mix(base.r, vInk.r, mr * 0.85);
            diffuseColor.g = mix(base.g, vInk.g, m * 0.85);
            diffuseColor.b = mix(base.b, vInk.b, mb * 0.85);
          } else diffuseColor.rgb = mix(diffuseColor.rgb, vInk, m * 0.85);
          diffuseColor.rgb = mix(diffuseColor.rgb, uPeak, vWhite);
          // FLAT: the colour as it is, no light on it; a thin darker line round each face.
          vec2 e2 = min(vFaceUv, 1.0 - vFaceUv);
          float edgeD = min(e2.x, e2.y);
          float edgeW = fwidth(edgeD) * 1.2 + 0.012;
          vec3 flatCol = mix(diffuseColor.rgb * 0.38, diffuseColor.rgb, smoothstep(edgeW, edgeW * 1.8, edgeD));
          flatCol *= 1.0 + vGlow * uEmit * 0.5;
          if (glitch) {
            // Torn rows: colours rotated, a flash of signal.
            diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.gbr, torn * vFx);
            totalEmissiveRadiance += diffuseColor.rgb * torn * vFx * 0.6;
          }
          totalEmissiveRadiance += diffuseColor.rgb * vGlow * uEmit;
          if (uIrid > 0.0) {
            // A thin-film rainbow at grazing angles, faint at rest and brighter as the cube lights.
            float fr = pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 3.0);
            vec3 film = 0.5 + 0.5 * cos(6.2831 * (fr * 1.6 + vec3(0.0, 0.33, 0.67)));
            totalEmissiveRadiance += film * fr * uIrid * 0.2 * (0.25 + vGlow);
          }
          if (styleIs(ST_PRISM) && vFx > 0.001) {
            // PRISM: spectral bands running out from the block's centre through the cube, and a
            // stronger spectrum on the faces turned outward, the way light leaves a prism.
            float r = length(vBlock);
            float out_ = max(0.0, dot(normal, vRadView));
            float fr = pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 2.0);
            vec3 band = spectrum(fract(r * 0.55 - uTime * 0.5 + fr * 0.4));
            totalEmissiveRadiance += band * vFx * (0.08 + 0.28 * out_ + 0.25 * fr) * (0.6 + 0.3 * vGlow + 0.4 * uPulse);
          }`,
        )
        .replace(
          '#include <opaque_fragment>',
          `#include <opaque_fragment>
          if (styleIs(ST_FLAT)) gl_FragColor.rgb = flatCol;
          if (styleIs(ST_DITHER) && vFx > 0.001) {
            // DITHER: ordered dither per channel, on a coarse grid of screen pixels.
            vec3 c = gl_FragColor.rgb;
            vec3 s = pow(max(c, 0.0), vec3(1.0 / 2.2));
            float peak = max(1.0, max(s.r, max(s.g, s.b)));
            float b = bayer4(gl_FragCoord.xy / uPx);
            vec3 q = max(s / peak - 0.03, 0.0) / 0.97;
            vec3 styled = vec3(step(b, q.r), step(b, q.g), step(b, q.b)) * peak;
            gl_FragColor.rgb = mix(c, pow(styled, vec3(2.2)), smoothstep(0.0, 0.6, vFx));
          }`,
        );
    };

    this.mesh = new THREE.InstancedMesh(geo, mat, n);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.base = pieces.map((p) => new THREE.Color(p.color));
    pieces.forEach((p, i) => this.mesh.setColorAt(i, this.base[i]));
    parent.add(this.mesh);
    this.ghosts = ghosts ? new Ghosts(this.mesh, ghosts) : null;

    this.glass = null; // { mesh, index: [cube indices], glow } while some cubes are glass
    this.zero = new THREE.Matrix4().makeScale(0, 0, 0);
    this.tint = new THREE.Color();
    this.white1 = new THREE.Color('#ffffff');

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

  /*
    What each cube carries: `specs[i]` = { pattern, density (negative: marks per face) }, and its
    ink colour.
  */
  setPatterns(specs, inks) {
    specs.forEach((sp, i) => {
      this.specAttr.array[i * 4] = sp.pattern;
      this.specAttr.array[i * 4 + 1] = sp.density;
      inks[i].toArray(this.inkAttr.array, i * 3);
    });
    for (const a of [this.specAttr, this.inkAttr]) a.needsUpdate = true;
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

  /*
    \`fx\`: each cube's shader-style strength this frame. \`display\` (optional): per-cube colours
    for this frame, leaving the painted base untouched.
  */
  update(pieces, physics, glow, white, fx, display = null) {
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
      this.state[i * 3] = glow[i];
      this.state[i * 3 + 1] = white[i];
      this.state[i * 3 + 2] = fx[i];
      if (display) this.mesh.setColorAt(i, display[i]);
    }
    this.placeGlass(glow, display);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.stateAttr.needsUpdate = true;
    if (display) this.mesh.instanceColor.needsUpdate = true;
    this.ghosts?.sync();
  }

  /*
    GLASS: which cubes are glass (indices), drawn by their own mesh with a physically based
    transmission material — light through them is refracted (IOR 1.5, over their thickness) and
    split by dispersion, so they bend the block seen behind them. In GLASS the main mesh shrinks
    those instances to nothing; in any other style the glass mesh is hidden.
  */
  setGlass(index, envMap = null) {
    if (this.glass) {
      this.glass.mesh.parent?.remove(this.glass.mesh);
      this.glass.mesh.geometry.dispose();
      this.glass.mesh.material.dispose();
      this.glass = null;
    }
    if (!index?.length) return;
    const geo = new RoundedBoxGeometry(1, 1, 1, 3, 0.06);
    const glow = new THREE.InstancedBufferAttribute(new Float32Array(index.length), 1);
    glow.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aGlassGlow', glow);
    const mat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      metalness: 0,
      roughness: 0.04,
      transmission: 1,
      ior: 1.5,
      thickness: 0.9,
      dispersion: 0.35,
      specularIntensity: 1,
      clearcoat: 0.4,
      clearcoatRoughness: 0.05,
      envMap, // a soft studio to reflect, so the glass shows its edges against the black
      envMapIntensity: 0.7,
    });
    // Struck glass lights up from inside in its tint.
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aGlassGlow; varying float vGlassGlow;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlassGlow = aGlassGlow;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vGlassGlow;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vGlassGlow * 0.45;');
    };
    const mesh = new THREE.InstancedMesh(geo, mat, index.length);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    index.forEach((_, k) => mesh.setColorAt(k, this.white1));
    mesh.frustumCulled = false;
    mesh.visible = false;
    this.mesh.parent.add(mesh);
    this.glass = { mesh, index, glow: glow.array, glowAttr: glow };
  }

  // Glass cubes: out of the main mesh, into the glass one, tinted by how lit they are.
  placeGlass(glow, display) {
    const g = this.glass;
    if (!g) return;
    g.mesh.visible = STYLE_UNIFORMS.uStyle.value === STYLE_INDEX.glass;
    if (!g.mesh.visible) return;
    g.index.forEach((i, k) => {
      this.mesh.getMatrixAt(i, this.m);
      g.mesh.setMatrixAt(k, this.m);
      this.mesh.setMatrixAt(i, this.zero);
      const lit = Math.min(1, glow[i] * 1.6);
      this.tint.copy(this.white1).lerp(display ? display[i] : this.base[i], 0.12 + 0.7 * lit);
      g.mesh.setColorAt(k, this.tint);
      g.glow[k] = glow[i];
    });
    g.mesh.instanceMatrix.needsUpdate = true;
    g.mesh.instanceColor.needsUpdate = true;
    g.glowAttr.needsUpdate = true;
  }

  // One cube placed by hand (the indicator): its matrix, glow, white and style strength.
  set(i, matrix, glow, white, fx) {
    this.mesh.setMatrixAt(i, matrix);
    this.state.set([glow, white, fx], i * 3);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.stateAttr.needsUpdate = true;
    this.ghosts?.sync();
  }

  dispose() {
    this.setGlass(null);
    this.ghosts?.dispose();
    this.mesh.parent?.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.dispose();
  }
}
