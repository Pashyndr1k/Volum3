import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

/*
  Visual styles: how the finished frame is shown, chosen like a colour profile. Each is one
  full-screen shader on the final image, fed the time and a `pulse` that jumps to 1 on every
  kick and snare and falls away, so the look can move with the music.

    CLEAN     the frame as rendered
    PRISM     light split into its spectrum: every colour is sampled a dozen times along a line
              from the centre, each sample tinted by a band of the rainbow, so white edges fan
              out into red-to-violet; bright spots also throw short rainbow streaks. c13, p19.
    GLITCH    a damaged digital video signal: horizontal slices torn sideways, macroblocks,
              RGB split, chroma smeared along the line, scanlines, noise lines and crushed
              colour — steady low damage, with bursts at random and on the beat. p14, p19, c27.
    HALFTONE  an LED dot screen: three rotated grids of red, green and blue dots sized by the
              colour underneath. c06, c12, c29.
    DITHER    ordered 1-bit dither per channel on a coarse pixel grid — eight colours, like the
              flower video and the pixel boards. p04, the video.
*/

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const HEAD = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform float uTime;
  uniform float uPulse;
  uniform vec2 uRes;
  varying vec2 vUv;
  float hash(float n) { return fract(sin(n) * 43758.5453); }
  float hash2(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  vec3 spectrum(float t) { // red → violet across 0…1
    t = clamp(t, 0.0, 1.0) * 0.83;
    return clamp(vec3(abs(t * 6.0 - 3.0) - 1.0, 2.0 - abs(t * 6.0 - 2.0), 2.0 - abs(t * 6.0 - 4.0)), 0.0, 1.0);
  }`;

const SHADERS = {
  prism: /* glsl */ `
    void main() {
      vec2 d = vUv - 0.5;
      float r = length(d);
      float amount = 0.055 * (0.35 + 1.65 * r) * (1.0 + uPulse * 0.8);
      vec3 acc = vec3(0.0), wsum = vec3(0.0);
      for (int i = 0; i < 16; i++) {
        float t = float(i) / 15.0;
        vec3 w = spectrum(1.0 - t);
        acc += texture2D(tDiffuse, vUv + d * (t - 0.5) * amount).rgb * w;
        wsum += w;
      }
      vec3 col = acc / wsum;
      // Bright light passing through: a short rainbow streak thrown down and to the right.
      // Like a beam through a prism: each bright point fans a spectrum out beside it.
      vec2 dir = normalize(vec2(0.7, -0.45)) / uRes * (9.0 + 6.0 * uPulse);
      for (int k = 1; k <= 14; k++) {
        vec3 s = texture2D(tDiffuse, vUv - dir * float(k)).rgb;
        float lum = max(0.0, dot(s, vec3(0.299, 0.587, 0.114)) - 0.6);
        col += spectrum(float(k) / 14.0) * lum * 0.5;
      }
      gl_FragColor = vec4(col, 1.0);
    }`,
  glitch: /* glsl */ `
    void main() {
      float t = floor(uTime * 14.0);
      float burst = clamp(step(0.86, hash(t * 0.37)) + uPulse * 0.9, 0.0, 1.0);
      vec2 uv = vUv;
      // Vertical roll, now and then.
      uv.y = fract(uv.y + step(0.97, hash(floor(uTime * 3.0))) * 0.08 * hash(t));
      // Torn slices: rows of varying height shifted sideways.
      float rows = 18.0 + floor(hash(t * 1.3) * 50.0);
      float row = floor(uv.y * rows);
      float tear = step(1.0 - 0.06 - 0.3 * burst, hash(row + t * 13.1));
      uv.x += tear * (hash(row * 7.1 + t) - 0.5) * (0.02 + 0.14 * burst);
      // Macroblocks: a few squares of the picture drop to low resolution.
      vec2 blk = floor(vUv * vec2(16.0, 9.0));
      if (hash2(blk + t) > 1.0 - 0.12 * burst) uv = (floor(uv * vec2(64.0, 36.0)) + 0.5) / vec2(64.0, 36.0);
      // RGB split along the line, and chroma smeared (as a narrow-band signal would).
      float split = (0.002 + 0.012 * burst) * (0.5 + hash(row + t));
      vec3 c;
      c.r = texture2D(tDiffuse, uv + vec2(split, 0.0)).r;
      c.g = texture2D(tDiffuse, uv).g;
      c.b = texture2D(tDiffuse, uv - vec2(split, 0.0)).b;
      vec3 smear = (texture2D(tDiffuse, uv - vec2(0.006, 0.0)).rgb + texture2D(tDiffuse, uv - vec2(0.012, 0.0)).rgb) * 0.5;
      float luma = dot(c, vec3(0.299, 0.587, 0.114));
      c = mix(c, luma + (smear - dot(smear, vec3(0.299, 0.587, 0.114))), 0.35);
      // Scanlines, noise lines, crushed colour in bursts.
      c *= 0.9 + 0.1 * sin(vUv.y * uRes.y * 3.14159);
      float line = step(0.996 - 0.03 * burst, hash(floor(vUv.y * uRes.y * 0.5) + t * 3.3));
      c += line * 0.35 * hash2(vUv * 100.0 + t);
      c = mix(c, floor(c * 5.0) / 5.0, burst * 0.6);
      c += (hash2(vUv * uRes + t) - 0.5) * 0.06;
      gl_FragColor = vec4(c, 1.0);
    }`,
  halftone: /* glsl */ `
    float screen(vec2 px, float angle, float cell, int ch) {
      mat2 rot = mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
      vec2 q = rot * px;
      vec2 centre = (floor(q / cell) + 0.5) * cell;
      vec2 back = transpose(rot) * centre;
      vec3 s = texture2D(tDiffuse, back / uRes).rgb;
      float v = ch == 0 ? s.r : ch == 1 ? s.g : s.b;
      float r = sqrt(clamp(v, 0.0, 1.0)) * cell * 0.62 * (1.0 + uPulse * 0.1);
      return 1.0 - smoothstep(r - 0.8, r + 0.8, length(q - centre));
    }
    void main() {
      vec2 px = vUv * uRes;
      float cell = max(5.0, uRes.y / 150.0);
      gl_FragColor = vec4(screen(px, 0.26, cell, 0), screen(px, 0.79, cell, 1), screen(px, 1.31, cell, 2), 1.0);
    }`,
  dither: /* glsl */ `
    float bayer(vec2 p) {
      vec2 q = mod(floor(p), 4.0);
      int i = int(q.x + q.y * 4.0);
      float m[16];
      m[0]=0.0; m[1]=8.0; m[2]=2.0; m[3]=10.0; m[4]=12.0; m[5]=4.0; m[6]=14.0; m[7]=6.0;
      m[8]=3.0; m[9]=11.0; m[10]=1.0; m[11]=9.0; m[12]=15.0; m[13]=7.0; m[14]=13.0; m[15]=5.0;
      for (int k = 0; k < 16; k++) if (k == i) return (m[k] + 0.5) / 16.0;
      return 0.5;
    }
    void main() {
      float px = max(2.0, floor(uRes.y / 300.0));
      vec2 cell = floor(vUv * uRes / px);
      vec3 c = texture2D(tDiffuse, (cell + 0.5) * px / uRes).rgb;
      c = pow(max(c - 0.035, 0.0) / 0.965, vec3(0.8)); // near-black stays black
      float b = bayer(cell);
      gl_FragColor = vec4(step(b, c.r), step(b, c.g), step(b, c.b), 1.0);
    }`,
};

export const STYLES = [
  { id: 'clean', label: 'CLEAN' },
  { id: 'prism', label: 'PRISM' },
  { id: 'glitch', label: 'GLITCH' },
  { id: 'halftone', label: 'HALFTONE' },
  { id: 'dither', label: 'DITHER' },
];

export class StylePasses {
  constructor(composer) {
    this.passes = {};
    for (const [id, frag] of Object.entries(SHADERS)) {
      const pass = new ShaderPass({
        uniforms: {
          tDiffuse: { value: null },
          uTime: { value: 0 },
          uPulse: { value: 0 },
          uRes: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
        },
        vertexShader: VERT,
        fragmentShader: HEAD + frag,
      });
      pass.enabled = false;
      composer.addPass(pass);
      this.passes[id] = pass;
    }
    this.current = 'clean';
  }

  set(id) {
    this.current = id;
    for (const [k, p] of Object.entries(this.passes)) p.enabled = k === id;
  }

  resize(w, h, dpr) {
    for (const p of Object.values(this.passes)) p.uniforms.uRes.value.set(w * dpr, h * dpr);
  }

  update(time, pulse) {
    const p = this.passes[this.current];
    if (!p) return;
    p.uniforms.uTime.value = time;
    p.uniforms.uPulse.value = pulse;
  }
}
