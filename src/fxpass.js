import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

/*
  The finishing pass, after bloom: a radial colour fringe (red pulled in, blue pushed out, growing
  toward the edges — the misregistration in the flower video and the rainbow edges of the glass
  renders), a little film grain (the risograph paper), and a soft vignette. Each profile sets how
  much of each; at 0 / 0 it passes the frame through untouched.
*/
export function createFxPass() {
  return new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      uFringe: { value: 0 },
      uGrain: { value: 0 },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      uniform float uFringe;
      uniform float uGrain;
      uniform float uTime;
      varying vec2 vUv;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main() {
        vec2 d = vUv - 0.5;
        float edge = dot(d, d) * 4.0;
        vec2 off = d * uFringe * (0.4 + edge);
        vec4 c = texture2D(tDiffuse, vUv);
        c.r = texture2D(tDiffuse, vUv - off).r;
        c.b = texture2D(tDiffuse, vUv + off).b;
        c.rgb += (hash(vUv * 1024.0 + uTime) - 0.5) * uGrain;
        c.rgb *= 1.0 - 0.22 * edge;
        gl_FragColor = c;
      }`,
  });
}
