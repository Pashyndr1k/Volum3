import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { generateCluster } from './cluster.js';
import { assignVoices, noteFor, chordAt, chordSpread, setHarmony, VOICE } from './music.js';
import { presetPattern, generatePattern, accompany, SCALES, STYLE, STYLES } from './patterns.js';
import { mapPattern } from './mapper.js';
import { Timeline } from './timeline.js';
import { openMic, analyzeHum, humToMelody } from './hum.js';
import { INK } from './palette.js';
import { PROFILES, PROFILE, VOICE_LANE, inkFor } from './profiles.js';
import { TEXTURE_SETS, TEXTURE_SET, PATTERNS, LANE_LETTER, GLYPHS, glyphIndex, buildGlyphAtlas } from './textures.js';
import { STYLES as SHADER_STYLES, StylePasses } from './styles.js';
import { createFxPass } from './fxpass.js';
import { ClusterPhysics, TUNING } from './physics.js';
import { Cubes } from './cubes.js';
import { Emissions } from './emissions.js';
import { Transport } from './transport.js';
import { unlock, audioReady, play, now, ctx as audioCtx } from './audio.js';
import { randomSeed } from './rng.js';
import { renderPanel, renderHint } from './ui.js';

// ---- Settings, from the URL like SQNCR ------------------------------------------------------

const params = new URLSearchParams(location.search);
const intParam = (k, lo, hi, dflt) => {
  const v = Number(params.get(k));
  return params.has(k) && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : dflt;
};

const STEPS = 64; // one orbit = four bars of sixteenths
const ORBIT_RADIUS = 8.8;
const ORBIT_TILT = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.22, 0, 0.1));
const ORBIT_TILT_INV = ORBIT_TILT.clone().invert();
const READ_LATENCY = 0.04; // a still pointer's notes are scheduled this far ahead, for steady timing
const HEAT_TAU = 0.3; // seconds; a struck cube is back to its colour in about 4–6 steps
const RETOUCH = 0.25; // a cube can't be touched again sooner than this, even at the edge between two
const GHOST = 0.14; // how hard the indicator brushes a cube that has no note this orbit
const BPM_STEPS = [70, 85, 100, 115, 130, 145]; // the BPM switch cycles through these

// Panel levels → physical values. Level 0/1 is the first entry.
const ZONE_RADIUS = [0, 1.2, 2, 3, 4.2]; // ZONE 0…4: touch radius in cube units (0 = one cube)
const FORCE_MULT = [1, 2, 3.5, 5, 7]; // FORCE 1…5
const SPIN_KICK = [0, 3, 6, 10, 15]; // SPIN 0…4: rad/s about a random axis
const LOOSENESS = [0.3, 0.55, 1, 1.7, 2.8]; // RETURN 1…5: slow and floaty → quick and tight
const OUTWARD = 0.75; // how much of every push points away from the block's centre

const state = {
  seed: intParam('seed', 0, 2147483647, randomSeed()),
  mode: params.get('mode') === 'touch' ? 'touch' : 'orbit',
  bpm: intParam('bpm', 50, 180, 100),
  grain: intParam('grain', 1, 5, 3),
  zone: intParam('zone', 0, 4, 1),
  force: intParam('force', 1, 5, 3),
  spin: intParam('spin', 0, 4, 2),
  ret: intParam('return', 1, 5, 3),
  caves: intParam('caves', 1, 3, 2),
  timeline: params.get('timeline') !== '0',
  look: params.get('look') === 'dark' ? 'dark' : 'painted',
  profile: PROFILE.has(params.get('profile')) ? params.get('profile') : 'halfof8',
  textureSet: TEXTURE_SET.has(params.get('texture')) ? params.get('texture') : params.get('texture') === '0' ? 'none' : 'graphic',
  shader: SHADER_STYLES.some((st) => st.id === params.get('shader')) ? params.get('shader') : 'clean',
  keys: false,
  playing: false,
  unlocked: false,
};

// The pattern: the preset, or a generated one if the URL names a style and pattern seed.
let pattern = (() => {
  const style = params.get('style');
  const seed = intParam('pattern', 1, 2147483647, 0);
  const p = style && STYLE.has(style) && seed ? generatePattern(style, seed) : presetPattern();
  p.naturalBpm = p.bpm;
  if (params.has('bpm')) p.bpm = state.bpm;
  return p;
})();
state.bpm = pattern.bpm;
setHarmony(pattern.root, SCALES[pattern.scale], pattern.progression);

function syncUrl() {
  const q = new URLSearchParams({ seed: String(state.seed) });
  if (state.mode !== 'orbit') q.set('mode', state.mode);
  if (pattern.seed) {
    q.set('style', pattern.style);
    q.set('pattern', String(pattern.seed));
  }
  if (state.bpm !== pattern.naturalBpm) q.set('bpm', String(state.bpm));
  if (!state.timeline) q.set('timeline', '0');
  if (state.look !== 'painted') q.set('look', state.look);
  if (state.profile !== 'halfof8') q.set('profile', state.profile);
  if (state.textureSet !== 'graphic') q.set('texture', state.textureSet);
  if (state.shader !== 'clean') q.set('shader', state.shader);
  if (state.grain !== 3) q.set('grain', String(state.grain));
  if (state.zone !== 1) q.set('zone', String(state.zone));
  if (state.force !== 3) q.set('force', String(state.force));
  if (state.spin !== 2) q.set('spin', String(state.spin));
  if (state.ret !== 3) q.set('return', String(state.ret));
  if (state.caves !== 2) q.set('caves', String(state.caves));
  history.replaceState(null, '', `${location.pathname}?${q}`);
}

// ---- Renderer and scene ---------------------------------------------------------------------

const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);

const camera = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.1, 200);
camera.position.set(19.5, 12.5, 24);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.enablePan = false;
controls.minDistance = 14;
controls.maxDistance = 45;

scene.add(new THREE.HemisphereLight(0xdddaca, 0x080808, 0.5));
const key = new THREE.DirectionalLight(0xfff6ea, 1.5);
key.position.set(8, 12, 9);
scene.add(key);
const rim = new THREE.DirectionalLight(0x9fc4ff, 0.55);
rim.position.set(-10, -3, -8);
scene.add(rim);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.5, 0.45, 0.86);
composer.addPass(bloom);
composer.addPass(new OutputPass());
// Fringe and grain work on the finished, display-ready image, so their amounts read as they look.
const fxPass = createFxPass();
composer.addPass(fxPass);
// The shader style comes last: it is how the finished frame is shown.
const stylePasses = new StylePasses(composer);
stylePasses.set(state.shader);
stylePasses.resize(window.innerWidth, window.innerHeight, renderer.getPixelRatio());

// `stage` floats; `cluster` is the big cube and is what spins in touch mode. The orbit belongs to
// the stage, so in orbit mode the cluster is held still relative to it and every cube keeps its step.
const stage = new THREE.Group();
scene.add(stage);
const cluster = new THREE.Group();
stage.add(cluster);

// ---- Indicator and its orbit ----------------------------------------------------------------

function orbitPoint(theta, out = new THREE.Vector3()) {
  return out.set(ORBIT_RADIUS * Math.cos(theta), 0, -ORBIT_RADIUS * Math.sin(theta)).applyQuaternion(ORBIT_TILT);
}

const ring = (() => {
  const pts = [];
  for (let i = 0; i < 256; i++) pts.push(orbitPoint((i / 256) * Math.PI * 2));
  const line = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0.16 }),
  );
  stage.add(line);
  return line;
})();

const TRAIL = 64;
const trail = (() => {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL * 3), 3));
  const col = new Float32Array(TRAIL * 3);
  for (let i = 0; i < TRAIL; i++) {
    const a = Math.pow(i / (TRAIL - 1), 2) * 0.7;
    col.set([a, a * 0.98, a * 0.93], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const line = new THREE.Line(
    geo,
    new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, toneMapped: false }),
  );
  line.frustumCulled = false;
  stage.add(line);
  return line;
})();

const indicator = new THREE.Mesh(
  new THREE.BoxGeometry(0.46, 0.46, 0.46),
  new THREE.MeshBasicMaterial({ color: new THREE.Color(INK).multiplyScalar(1.05), toneMapped: false }),
);
stage.add(indicator);
const indicatorLight = new THREE.PointLight(0xfff1dc, 40, 13, 2);

// A soft halo round the indicator: a sprite, not bloom, so the glow stays its own size and colour.
const halo = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.18, 'rgba(255,255,255,0.45)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.12)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
  );
  sprite.scale.setScalar(2.4);
  return sprite;
})();
const profile = () => PROFILE.get(state.profile);
indicator.add(indicatorLight);
indicator.add(halo);

function placeIndicator(theta) {
  orbitPoint(theta, indicator.position);
  indicator.rotation.set(theta * 2, theta * 3, 0);
  const arr = trail.geometry.attributes.position.array;
  const v = new THREE.Vector3();
  for (let i = 0; i < TRAIL; i++) {
    orbitPoint(theta - ((TRAIL - 1 - i) / TRAIL) * 0.9, v);
    arr[i * 3] = v.x;
    arr[i * 3 + 1] = v.y;
    arr[i * 3 + 2] = v.z;
  }
  trail.geometry.attributes.position.needsUpdate = true;
}

// ---- The cluster ----------------------------------------------------------------------------

let world = null; // { pieces, physics, cubes, heat, buckets, lastTouch }
const emissions = new Emissions(cluster);

function stepOf(rest) {
  const p = rest.clone().applyQuaternion(ORBIT_TILT.clone().invert());
  let phi = Math.atan2(-p.z, p.x);
  if (phi < 0) phi += Math.PI * 2;
  return Math.round((phi / (Math.PI * 2)) * STEPS) % STEPS;
}

/*
  Touches are tested against every cube at its home position, not where it is now. A touched
  cube flies off; if the pointer then found the cube behind it, that one would fly too, and the
  next — one touch would become a chain. The block as built is what the pointer touches.
*/
function restProxy(pieces) {
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), pieces.length);
  const m = new THREE.Matrix4();
  pieces.forEach((p, i) => mesh.setMatrixAt(i, m.compose(p.rest, p.restQuat, new THREE.Vector3().setScalar(p.scale))));
  mesh.visible = false;
  mesh.computeBoundingSphere();
  cluster.add(mesh);
  return mesh;
}

function build(seed) {
  if (world) {
    world.cubes.dispose();
    cluster.remove(world.proxy);
    world.proxy.geometry.dispose();
    world.proxy.dispose();
  }
  emissions.clear();
  const { pieces, edges } = generateCluster(seed, state.caves);
  for (const p of pieces) p.step = stepOf(p.rest);
  // A fallback voice per cube, for touching cubes that carry no note of the pattern.
  assignVoices(pieces, STEPS, seed);
  const mapping = mapPattern(pattern, pieces, STEPS);
  pieces.forEach((p, i) => (p.color = colorOf(mapping, i)));

  const physics = new ClusterPhysics(pieces, edges);
  // Arrive assembling: every cube starts pushed outward and the springs pull the block together.
  pieces.forEach((p, i) => {
    const out = p.rest.clone().normalize().multiplyScalar(0.6 + Math.random() * 0.6);
    physics.u.set([out.x, out.y, out.z], i * 3);
  });

  const cubes = new Cubes(pieces, cluster);
  const buckets = Array.from({ length: STEPS }, () => []);
  pieces.forEach((p, i) => buckets[p.step].push(i));
  world = {
    pieces,
    physics,
    cubes,
    proxy: restProxy(pieces),
    buckets,
    mapping,
    idleByStep: idleBuckets(pieces, mapping),
    heat: new Float32Array(pieces.length),
    glow: new Float32Array(pieces.length),
    white: new Float32Array(pieces.length),
    display: pieces.map(() => new THREE.Color()),
    lastTouch: new Float64Array(pieces.length).fill(-1),
  };
  dressCubes();
  cubes.update(pieces, physics, world.glow, world.white);
  cubes.mesh.computeBoundingSphere();
  cubes.mesh.boundingSphere.radius += TUNING.maxOffset; // cubes fly; keep raycasts from being culled early
}

// The lane a cube belongs to: the part of its first note, or none for a cube with nothing to play.
function laneOf(mapping, i) {
  return mapping.cubeEvents[i][0]?.lane ?? null;
}

// A cube takes its profile's colour for the part it plays; a cube with nothing to play stays dim.
function colorOf(mapping, i) {
  const lane = laneOf(mapping, i);
  return lane ? profile().lanes[lane] : profile().idle;
}

/*
  The DARK look's colours: each cube's part colour, pushed brighter and more saturated so it reads
  as light against the dark block. A cube with no note borrows the lane of its fallback voice, so
  even a brushed one shows a hue. Near-neutral colours (BONE, PRISM) stay as they are.
*/
function vividColors(w) {
  const hsl = {};
  return w.pieces.map((p, i) => {
    const lane = laneOf(w.mapping, i) ?? VOICE_LANE[p.voice.id] ?? 'melody';
    const c = new THREE.Color(profile().lanes[lane]);
    c.getHSL(hsl);
    if (hsl.s < 0.2) return c;
    return c.setHSL(hsl.h, Math.min(1, hsl.s * 1.4 + 0.15), Math.max(0.5, Math.min(0.64, hsl.l * 1.05 + 0.06)));
  });
}

// The colour a cube's thrown marks take: its own when struck, or one of the profile's mark inks.
function markColor(i) {
  const marks = profile().marks;
  if (Array.isArray(marks)) return new THREE.Color(marks[Math.floor(Math.random() * marks.length)]);
  return state.look === 'dark' ? world.vivid[i] : world.cubes.base[i];
}

/*
  Dress the cubes for the current profile: colour per part, the pattern for its kind (texture),
  the ink it's printed in, and the surface finish. The DARK look keeps its own per-frame colours
  and ink; these are its targets.
*/
function dressCubes() {
  const pr = profile();
  const { pieces, mapping, cubes } = world;
  cubes.setColors(pieces.map((_, i) => colorOf(mapping, i)));
  world.vivid = vividColors(world);
  world.ink = pieces.map((_, i) => new THREE.Color(inkFor(pr, laneOf(mapping, i) ?? 'kick')));
  world.restInk = new THREE.Color(pr.rest).lerp(new THREE.Color('#ffffff'), 0.08);
  world.rest = new THREE.Color(pr.rest);
  cubes.setPatterns(pieces.map((_, i) => textureSpec(i)), world.ink);
  if (atlas) cubes.setAtlas(atlas.texture);
  cubes.setLook({ ...pr.material, peak: pr.peak, texture: state.textureSet !== 'none', emit: pr.fx.glow });
  if (state.look === 'dark') cubes.restore();
}

/*
  What the current texture set prints on cube i: the pattern and scale for its part, and for the
  type sets its two glyphs — the part's letter for the sides, and a number for the top: the beat
  a drum lands on (1–4), or the scale degree a tuned part plays (1–7).
*/
function textureSpec(i) {
  const lane = laneOf(world.mapping, i);
  const spec = TEXTURE_SET.get(state.textureSet).lanes[lane ?? 'idle'];
  const ev = world.mapping.cubeEvents[i][0];
  let number = world.pieces[i].step % 10;
  if (ev && ev.midi !== undefined) {
    const deg = SCALES[pattern.scale].indexOf((((ev.midi - pattern.root) % 12) + 12) % 12);
    if (deg >= 0) number = deg + 1;
  } else if (ev) number = Math.floor((ev.step % 16) / 4) + 1;
  const letter = LANE_LETTER[lane] ?? GLYPHS[(i * 7) % 26];
  return {
    pattern: PATTERNS[spec.pattern],
    density: spec.fit ? -spec.density : spec.density,
    fill: spec.fill ?? 0,
    glyph: [glyphIndex(letter), glyphIndex(String(number))],
  };
}

// The glyph atlas is drawn once the type face has loaded, so the letters are in it.
let atlas = null;
(document.fonts?.load('500 100px "DM Mono"') ?? Promise.resolve())
  .catch(() => {})
  .then(() => {
    atlas = buildGlyphAtlas();
    world?.cubes.setAtlas(atlas.texture);
  });

// The rest of the frame for the current profile: background, light, bloom, fringe, grain.
function applyProfile() {
  const pr = profile();
  scene.background.set(pr.bg);
  bloom.strength = pr.fx.bloom[0];
  bloom.radius = pr.fx.bloom[1];
  bloom.threshold = pr.fx.bloom[2];
  fxPass.uniforms.uFringe.value = pr.fx.fringe;
  fxPass.uniforms.uGrain.value = pr.fx.grain;
  const accent = new THREE.Color(pr.accent);
  indicator.material.color.copy(accent).multiplyScalar(1.05);
  indicatorLight.color.copy(accent).lerp(new THREE.Color('#ffffff'), 0.5);
  ring.material.color.copy(accent);
  trail.material.color.copy(accent);
  cursor.material.color.copy(accent);
  halo.material.color.copy(accent);
  if (world) dressCubes();
}

function idleBuckets(pieces, mapping) {
  const out = Array.from({ length: STEPS }, () => []);
  for (const i of mapping.idle) out[pieces[i].step].push(i);
  return out;
}

// Hand the current pattern to the cubes again, after it changed.
function remap() {
  world.mapping = mapPattern(pattern, world.pieces, STEPS);
  world.idleByStep = idleBuckets(world.pieces, world.mapping);
  dressCubes();
}

function setPattern(p) {
  pattern = p;
  setHarmony(p.root, SCALES[p.scale], p.progression);
  state.bpm = p.bpm;
  transport.setBpm(p.bpm);
  transport.swing = p.swing;
  if (world) remap();
  timeline.setPattern(p);
  frameView(); // the timeline's height follows the lanes in use
  syncUrl();
  refreshUi();
}

function applyTuning() {
  TUNING.force = FORCE_MULT[state.force - 1];
  TUNING.spinKick = SPIN_KICK[state.spin];
  TUNING.looseness = LOOSENESS[state.ret - 1];
  world?.physics.retune();
}

/*
  Where a struck cube goes: mostly straight out from the block's centre, bent toward the thing
  that hit it — the indicator, or the pointer's ray. Cubes in the hollow core, which have no
  clear "out", just follow the hit.
*/
function pushDir(i, toward) {
  const p = world.pieces[i];
  const o = i * 3;
  const out = new THREE.Vector3(p.rest.x + world.physics.u[o], p.rest.y + world.physics.u[o + 1], p.rest.z + world.physics.u[o + 2]);
  if (out.length() < 0.8) return toward.clone().normalize();
  return out.normalize().multiplyScalar(OUTWARD).addScaledVector(toward, 1 - OUTWARD * 0.6).normalize();
}

// ---- Striking -------------------------------------------------------------------------------

const pending = []; // strikes booked on the audio clock, applied when their time comes
const pulses = []; // kick and snare times: the shader styles and the indicator's halo pulse on them
let pulse = 0;
const tmpV = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const camRight = new THREE.Vector3();

function panOf(i) {
  const p = world.pieces[i];
  tmpV.copy(p.rest);
  cluster.localToWorld(tmpV);
  camRight.setFromMatrixColumn(camera.matrixWorld, 0);
  return Math.max(-0.6, Math.min(0.6, (tmpV.dot(camRight) / 6) * 0.6));
}

// What a cube sounds like when touched: its first note in the pattern, or its fallback voice.
function noteOf(i, absStep) {
  const ev = world.mapping.cubeEvents[i][0];
  if (ev) return { voice: VOICE.get(pattern.voices[ev.lane]), midi: ev.midi, spread: ev.spread, len: ev.len ?? 1 };
  const p = world.pieces[i];
  return {
    voice: p.voice,
    midi: noteFor(p.voice, p, absStep),
    spread: p.voice.id === 'chord' ? chordSpread(chordAt(absStep)) : undefined,
    len: 1,
  };
}

function soundPiece(i, at, absStep, velocity) {
  const n = noteOf(i, absStep);
  play(n.voice, { at, velocity, pan: panOf(i), midi: n.midi, spread: n.spread, dur: n.len * transport.stepSec() });
}

// Apply a strike now: impulse, heat, and (unless quiet) the emission throw. `dir` is in the
// cluster's frame.
function strike(i, dir, arm, energy, t, quiet = false) {
  const { pieces, physics, heat } = world;
  physics.strike(i, [dir.x, dir.y, dir.z], [arm.x, arm.y, arm.z], energy);
  heat[i] = Math.max(heat[i], energy);
  const p = pieces[i];
  const o = i * 3;
  tmpV.set(p.rest.x + physics.u[o], p.rest.y + physics.u[o + 1], p.rest.z + physics.u[o + 2]);
  if (!quiet) emissions.throw(tmpV, p.scale, markColor(i), energy, state.grain, t);
}

// Called by the transport for every step, ahead of time. Sound is booked now; the picture waits.
// Each note of the pattern at this step strikes its cube; cubes with no note get a light brush.
function onStep(absStep, time) {
  if (!world || state.mode !== 'orbit') return;
  const s = absStep % STEPS;
  if (hum.active) {
    // While recording, the guide is a plain click on every beat — nothing of the old tune.
    if (s % 4 === 0) play(VOICE.get('rim'), { at: time, velocity: s % 16 === 0 ? 0.55 : 0.3 });
    return;
  }
  playStep(s, time);
}

// Everything that happens at one step: each note strikes its cube and sounds; empty cubes get a brush.
function playStep(s, time) {
  debug.trace?.push([s, time]);
  const sec = transport.stepSec();
  const heard = new Set();
  for (const { event, cube } of world.mapping.byStep[s]) {
    const silent = timeline.muted.has(event.lane);
    if (!silent && (event.lane === 'kick' || event.lane === 'snare')) pulses.push(time);
    pending.push({ time, i: cube, energy: silent ? GHOST : Math.min(1, (event.vel ?? 0.8) * 1.1), gen: world });
    if (silent) continue;
    const voice = VOICE.get(pattern.voices[event.lane]);
    const key = `${voice.id}:${event.midi}`;
    if (heard.has(key)) continue;
    heard.add(key);
    play(voice, { at: time, velocity: event.vel ?? 0.8, pan: panOf(cube), midi: event.midi, spread: event.spread, dur: (event.len ?? 1) * sec * 0.95 });
  }
  for (const i of world.idleByStep[s]) pending.push({ time, i, energy: GHOST, gen: world });
}

function applyPending(t) {
  const inv = tmpQ.copy(cluster.quaternion).invert();
  for (let k = pending.length - 1; k >= 0; k--) {
    const s = pending[k];
    if (s.time > t) continue;
    pending.splice(k, 1);
    if (s.gen !== world) continue;
    const p = world.pieces[s.i];
    let dir = s.dir;
    if (!dir) {
      // Toward the indicator, where it was at the moment of the strike.
      const target = orbitPoint(transport.angle(s.time)).applyQuaternion(inv);
      dir = pushDir(s.i, target.sub(p.rest).normalize());
    }
    const arm = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(p.scale * 0.5);
    strike(s.i, dir, arm, s.energy, s.time);
  }
}

const transport = new Transport({ bpm: state.bpm, steps: STEPS, swing: pattern.swing, onStep });

// Set `volum3.debug.trace = []` in the console to log every step played as [step, audio time].
const debug = { trace: null };

// ---- Touch ----------------------------------------------------------------------------------

const raycaster = new THREE.Raycaster();
const pointer = { lastX: 0, lastY: 0, lastT: 0, speed: 0, down: false, dragged: false, inside: false, cube: -1 };
const spin = { vel: new THREE.Vector3() };

// The touch zone, drawn as a faint circle facing the camera wherever the pointer meets the block.
const cursor = (() => {
  const pts = [];
  for (let i = 0; i < 64; i++) pts.push(new THREE.Vector3(Math.cos((i / 64) * Math.PI * 2), Math.sin((i / 64) * Math.PI * 2), 0));
  const line = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0.45, depthTest: false }),
  );
  line.renderOrder = 10;
  line.visible = false;
  scene.add(line);
  return line;
})();

function hover(clientX, clientY) {
  if (!world) return null;
  const ndc = new THREE.Vector2((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.intersectObject(world.proxy, false)[0];
  cursor.visible = !!hit;
  if (hit) {
    cursor.position.copy(hit.point);
    cursor.quaternion.copy(camera.quaternion);
    cursor.scale.setScalar(Math.max(0.35, ZONE_RADIUS[state.zone]));
  }
  return hit && hit.instanceId !== undefined ? hit : null;
}

/*
  One touch, one trigger. The cube under the pointer plays its note once, when the pointer
  arrives on it; staying on it does nothing more, and only arriving on another cube (or clicking)
  plays again. This runs every frame, not only when the mouse moves — in TOUCH mode the block
  turns under a still pointer, so the cubes come to it, one after another, in time.

  ZONE widens the push, not the sound: every cube within the radius is thrown at the same moment,
  harder near the centre, but only the touched cube sounds and throws its marks.
*/
function touchAt(clientX, clientY, force = false) {
  const hit = hover(clientX, clientY);
  if (!hit) {
    pointer.cube = -1;
    return;
  }
  const i0 = hit.instanceId;
  if (i0 === pointer.cube && !force) return;
  pointer.cube = i0;
  const t = now();
  const { pieces, physics, lastTouch } = world;
  if (t - lastTouch[i0] < RETOUCH && !force) return;
  lastTouch[i0] = t;

  const inv = tmpQ.copy(cluster.getWorldQuaternion(new THREE.Quaternion())).invert();
  const ray = raycaster.ray.direction.clone().applyQuaternion(inv);
  const contact = cluster.worldToLocal(hit.point.clone());
  const energy = Math.min(1, 0.65 + pointer.speed / 2500);
  strike(i0, pushDir(i0, ray), contact.clone().sub(pieces[i0].rest).clampLength(0, pieces[i0].scale / 2), energy, t);
  if (audioReady()) {
    const absStep = Math.floor(transport.playing ? transport.position(t) : t / transport.stepSec());
    soundPiece(i0, t + 0.01, absStep, energy);
  }

  const radius = ZONE_RADIUS[state.zone];
  if (radius === 0) return;
  for (let i = 0; i < pieces.length; i++) {
    if (i === i0) continue;
    const o = i * 3;
    const d = Math.max(0, Math.hypot(
      pieces[i].rest.x + physics.u[o] - contact.x,
      pieces[i].rest.y + physics.u[o + 1] - contact.y,
      pieces[i].rest.z + physics.u[o + 2] - contact.z,
    ) - pieces[i].scale / 2);
    if (d > radius) continue;
    const e = energy * Math.pow(1 - d / (radius + 0.5), 0.7);
    const arm = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(pieces[i].scale * 0.4);
    strike(i, pushDir(i, ray), arm, e, t, true);
  }
}

/*
  TOUCH mode: the pointer is a stationary indicator. Where it rests on the block it reads the
  block's own angle there — the step under it — and the block turns at the orbit's speed, so that
  step advances exactly as the indicator would. Each step boundary it passes plays that step of
  the pattern, the same notes and the same cubes the indicator would strike. Moving the pointer
  around the block scrubs through the steps; taking it off the block stops the reading.
*/
const reader = { phi: null, t: 0, anchor: null };
let blockTurn = 0; // radians the block has turned about the orbit axis in TOUCH mode

function readAt(clientX, clientY, t) {
  const hit = hover(clientX, clientY);
  // Over a cavern a still pointer hits nothing for a moment; it keeps reading all the same.
  // Only a pointer that has moved off the block stops.
  if (!hit && !reader.anchor) {
    reader.phi = null;
    return;
  }
  // Where the pointer comes to rest, note the block's angle under it once. From then on the
  // reading advances only by how far the block has turned — exactly the orbit's speed — not by
  // the ins and outs of the surface the pointer happens to be over.
  if (reader.anchor === null) {
    const local = cluster.worldToLocal(hit.point.clone()).applyQuaternion(ORBIT_TILT_INV);
    let a = (Math.atan2(-local.z, local.x) / (Math.PI * 2)) * STEPS;
    if (a < 0) a += STEPS;
    reader.anchor = { phi: a, turn: blockTurn };
  }
  let phi = reader.anchor.phi + ((reader.anchor.turn - blockTurn) / (Math.PI * 2)) * STEPS;
  phi = ((phi % STEPS) + STEPS) % STEPS;
  if (reader.phi === null) {
    reader.phi = phi;
    reader.t = t;
    return;
  }
  let d = phi - reader.phi;
  if (d > STEPS / 2) d -= STEPS;
  if (d < -STEPS / 2) d += STEPS;
  const from = reader.phi;
  const to = from + d;
  // Step boundaries crossed since the last frame, each at its interpolated moment. A small move
  // of the pointer scrubs through the steps it passes; a jump to another part of the block just
  // moves the reading there without playing everything in between.
  if (Math.abs(d) <= 8) {
    const crossings = [];
    if (d > 0) for (let k = Math.floor(from) + 1; k <= Math.floor(to); k++) crossings.push(k);
    else if (d < 0) for (let k = Math.floor(from); k > Math.floor(to); k--) crossings.push(k);
    for (const k of crossings) {
      const at = reader.t + ((k - from) / (to - from)) * (t - reader.t) + READ_LATENCY;
      playStep(((k % STEPS) + STEPS) % STEPS, Math.max(at, t + 0.005));
    }
  }
  reader.phi = phi;
  reader.t = t;
}

canvas.addEventListener('pointerdown', (e) => {
  pointer.down = true;
  pointer.dragged = false;
  pointer.lastX = e.clientX;
  pointer.lastY = e.clientY;
  if (!state.unlocked) {
    unlock().then(() => {
      state.unlocked = true;
      refreshUi();
    });
  }
  if (state.mode === 'touch') canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener('pointermove', (e) => {
  const t = performance.now();
  const dx = e.clientX - pointer.lastX;
  const dy = e.clientY - pointer.lastY;
  const dt = Math.max(1, t - pointer.lastT);
  pointer.speed = pointer.speed * 0.6 + (Math.hypot(dx, dy) / dt) * 1000 * 0.4;
  pointer.lastX = e.clientX;
  pointer.lastY = e.clientY;
  pointer.lastT = t;
  pointer.inside = true;
  if (Math.abs(dx) + Math.abs(dy) > 0) reader.anchor = null; // the pointer moved: read from where it is now
  if (pointer.down) {
    if (Math.abs(dx) + Math.abs(dy) > 0) pointer.dragged = true;
    cursor.visible = false;
    if (state.mode === 'touch') {
      // Drag adds a spin of its own on top of the steady turn; it fades once let go.
      spin.vel.x = dy * 0.25;
      spin.vel.y = dx * 0.25;
    }
  }
});

const release = () => {
  // A click without a drag always plays the cube under the pointer, even the one already touched.
  if (pointer.down && !pointer.dragged) touchAt(pointer.lastX, pointer.lastY, true);
  pointer.down = false;
};
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', () => (pointer.down = false));
canvas.addEventListener('pointerenter', () => (pointer.inside = true));
canvas.addEventListener('pointerleave', () => {
  pointer.inside = false;
  pointer.cube = -1;
  reader.phi = null;
  reader.anchor = null;
  cursor.visible = false;
});

// ---- Actions and UI -------------------------------------------------------------------------

const panel = document.getElementById('panel');
const hint = document.getElementById('hint');

const act = {
  async togglePlay() {
    if (!state.unlocked) {
      await unlock();
      state.unlocked = true;
    }
    if (state.mode !== 'orbit') act.setMode('orbit');
    if (transport.playing) transport.stop();
    else transport.start();
    state.playing = transport.playing;
    refreshUi();
  },
  setMode(mode) {
    if (mode === state.mode) return;
    state.mode = mode;
    controls.enabled = mode === 'orbit';
    if (mode === 'touch') {
      transport.stop();
      state.playing = false;
      pending.length = 0;
    }
    ring.visible = trail.visible = indicator.visible = mode === 'orbit';
    syncUrl();
    refreshUi();
  },
  generate() {
    state.seed = randomSeed();
    pending.length = 0;
    build(state.seed);
    syncUrl();
    refreshUi();
  },
  cycleProfile() {
    const ids = PROFILES.map((p) => p.id);
    state.profile = ids[(ids.indexOf(state.profile) + 1) % ids.length];
    applyProfile();
    syncUrl();
    refreshUi();
  },
  cycleTexture() {
    const ids = TEXTURE_SETS.map((t) => t.id);
    state.textureSet = ids[(ids.indexOf(state.textureSet) + 1) % ids.length];
    if (world) dressCubes();
    syncUrl();
    refreshUi();
  },
  cycleShader() {
    const ids = SHADER_STYLES.map((st) => st.id);
    state.shader = ids[(ids.indexOf(state.shader) + 1) % ids.length];
    stylePasses.set(state.shader);
    syncUrl();
    refreshUi();
  },
  toggleKeys() {
    state.keys = !state.keys;
    refreshUi();
  },
  setLook(look) {
    state.look = look;
    if (look === 'painted' && world) dressCubes();
    syncUrl();
    refreshUi();
  },
  // BPM is a switch: each press moves to the next of six tempos, and wraps around.
  cycleBpm() {
    act.setBpm(BPM_STEPS.find((b) => b > state.bpm) ?? BPM_STEPS[0]);
  },
  nextStyle() {
    const ids = STYLES.map((s) => s.id);
    const cur = pattern.style === 'hum' ? pattern.accomp : pattern.style;
    const next = ids[(ids.indexOf(cur) + 1) % ids.length];
    if (pattern.style === 'hum') act.rearrange(next);
    else act.randomPattern(next);
  },
  // A hummed melody keeps its notes; only the band around it is written again, in `styleId`.
  rearrange(styleId) {
    const melody = pattern.events.filter((e) => e.lane === 'melody');
    const p = accompany(melody, { root: pattern.root, scale: pattern.scale, bpm: pattern.bpm }, styleId, randomSeed());
    p.naturalBpm = pattern.naturalBpm;
    setPattern(p);
  },
  setBpm(bpm) {
    state.bpm = Math.max(50, Math.min(180, bpm));
    pattern.bpm = state.bpm;
    transport.setBpm(state.bpm);
    timeline.setPattern(pattern);
    syncUrl();
    refreshUi();
  },
  randomPattern(styleId = pattern.style) {
    if (pattern.style === 'hum') return act.rearrange(STYLE.has(styleId) ? styleId : pattern.accomp);
    const p = generatePattern(STYLE.has(styleId) ? styleId : STYLES[0].id, randomSeed());
    p.naturalBpm = p.bpm;
    setPattern(p);
    timeline.setStatus('');
  },
  presetPattern() {
    const p = presetPattern();
    p.naturalBpm = p.bpm;
    setPattern(p);
    timeline.setStatus('');
  },
  toggleTimeline() {
    state.timeline = !state.timeline;
    timelineEl.hidden = !state.timeline;
    timeline.resize();
    frameView();
    syncUrl();
    refreshUi();
  },
  hum() {
    if (hum.active) stopHum('CANCELLED');
    else startHum();
  },
  setGrain(g) {
    state.grain = g;
    syncUrl();
    refreshUi();
  },
  set(key, value) {
    state[key] = value;
    if (key === 'caves') {
      pending.length = 0;
      build(state.seed);
    }
    applyTuning();
    syncUrl();
    refreshUi();
  },
};

function refreshUi() {
  renderPanel(
    panel,
    {
      ...state,
      profileLabel: profile().label,
      textureLabel: TEXTURE_SET.get(state.textureSet).label,
      shaderLabel: SHADER_STYLES.find((st) => st.id === state.shader).label,
    },
    act,
  );
  renderHint(hint, state, world ? world.pieces.length : 0);
}

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    e.preventDefault();
    act.togglePlay();
  } else if (e.key === 't' || e.key === 'T') act.setMode(state.mode === 'orbit' ? 'touch' : 'orbit');
  else if (e.key === 'g' || e.key === 'G') act.generate();
  else if (e.key === 'r' || e.key === 'R') act.randomPattern();
  else if (e.key === 'l' || e.key === 'L') act.toggleTimeline();
  else if (e.key === 'h' || e.key === 'H') act.hum();
  else if (e.key === 'b' || e.key === 'B') act.cycleBpm();
  else if (e.key === 'v' || e.key === 'V') act.setLook(state.look === 'dark' ? 'painted' : 'dark');
  else if (e.key === 'p' || e.key === 'P') act.cycleProfile();
  else if (e.key === 'x' || e.key === 'X') act.cycleTexture();
  else if (e.key === 's' || e.key === 'S') act.cycleShader();
  else if (e.key === '?' || e.key === '/') act.toggleKeys();
  else if (e.key === 'Escape' && hum.active) stopHum('CANCELLED');
});

// Keep the block centred in the space above the timeline: shift the view, not the camera.
function frameView() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.setViewOffset(w, h, 0, state.timeline ? timeline.height / 2 : 0, w, h);
  camera.updateProjectionMatrix();
}

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  stylePasses.resize(window.innerWidth, window.innerHeight, renderer.getPixelRatio());
  frameView();
});

// ---- Timeline and humming -------------------------------------------------------------------

const timelineEl = document.getElementById('timeline');
timelineEl.hidden = !state.timeline;
const timeline = new Timeline(timelineEl, {
  onNextStyle: () => act.nextStyle(),
  onRandom: () => act.randomPattern(),
  onPreset: () => act.presetPattern(),
  onHum: () => act.hum(),
  onEdit: (p) => setPattern(p),
  laneColor: (lane) => profile().lanes[lane],
});

/*
  Humming: open the microphone, count one bar in on the rim, then keep a plain click on every
  beat while four bars are recorded. When the window closes the take is analysed and becomes the
  whole composition — just the hummed melody, in the key it was hummed in, played by the
  sustained LEAD voice — and the cubes are re-dealt to its notes. It starts playing from bar one.
*/
const hum = { active: false, mic: null, t0: 0, dur: 0, countAt: 0, timer: 0, shown: '' };

async function startHum() {
  if (!state.unlocked) {
    await unlock();
    state.unlocked = true;
  }
  if (state.mode !== 'orbit') act.setMode('orbit');
  transport.stop();
  pending.length = 0;
  timeline.setStatus('ALLOW THE MICROPHONE');
  try {
    hum.mic = await openMic(audioCtx());
  } catch (err) {
    timeline.setStatus(`NO MICROPHONE · ${String(err.message || err).toUpperCase()}`);
    return;
  }
  const c = audioCtx();
  const beat = 60 / pattern.bpm;
  hum.countAt = c.currentTime + 0.4;
  for (let k = 0; k < 4; k++) play(VOICE.get('rim'), { at: hum.countAt + k * beat, velocity: k === 0 ? 1 : 0.7 });
  hum.t0 = hum.countAt + 4 * beat;
  hum.dur = STEPS * transport.stepSec();
  hum.active = true;
  hum.shown = '';
  timeline.rec = { phase: 'count', count: 4, level: 0 };
  transport.startAt(hum.t0);
  state.playing = true;
  refreshUi();
  hum.timer = setTimeout(finishHum, (hum.t0 + hum.dur + hum.mic.latency - c.currentTime + 0.25) * 1000);
}

function stopHum(message) {
  clearTimeout(hum.timer);
  hum.mic?.close();
  hum.mic = null;
  hum.active = false;
  timeline.rec = null;
  timeline.setStatus(message);
}

function finishHum() {
  if (!hum.active) return;
  // The microphone hears everything a little late; take the window that late too.
  const lag = hum.mic.latency;
  const samples = hum.mic.take(hum.t0 + lag, hum.t0 + lag + hum.dur);
  const sampleRate = audioCtx().sampleRate;
  stopHum('ANALYSING');
  transport.stop();
  const tune = humToMelody(analyzeHum(samples, sampleRate), transport.stepSec(), STEPS);
  if (!tune || tune.events.length === 0) {
    state.playing = false;
    refreshUi();
    timeline.setStatus('HEARD NOTHING · HUM LOUDER, CLOSER TO THE MIC');
    return;
  }
  // Keep the tune exactly as hummed and write the band around it, in the style that was playing.
  const style = pattern.style === 'hum' ? pattern.accomp : pattern.style;
  const p = accompany(tune.events, { root: tune.root, scale: tune.scale, bpm: pattern.bpm }, style, randomSeed());
  p.naturalBpm = pattern.naturalBpm;
  setPattern(p);
  timeline.setStatus(`HEARD ${tune.events.length} NOTES · BAND ADDED`);
  transport.pos = 0;
  transport.startAt(audioCtx().currentTime + 0.15);
  state.playing = true;
  refreshUi();
}

function updateHum(t) {
  if (!hum.active) return;
  const beat = 60 / pattern.bpm;
  const counting = t < hum.t0;
  const count = Math.max(1, Math.min(4, 4 - Math.floor((t - hum.countAt) / beat)));
  const bar = Math.min(4, 1 + Math.floor((t - hum.t0) / (beat * 4)));
  timeline.rec = { phase: counting ? 'count' : 'rec', count, level: hum.mic ? hum.mic.level() : 0 };
  const text = counting ? `COUNT-IN · ${count}` : `LISTENING · BAR ${bar} OF 4 · ESC CANCELS`;
  if (text !== hum.shown) {
    hum.shown = text;
    timeline.setStatus(text);
  }
}

// ---- Frame loop -----------------------------------------------------------------------------

const timer = new THREE.Timer();
const up = new THREE.Vector3();
const right = new THREE.Vector3();
const qStep = new THREE.Quaternion();
const orbitAxis = new THREE.Vector3();
const tmpC = new THREE.Color();

let lastT = now();
const smoothstep = (a, b, x) => {
  const k = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
};

function frame(stamp) {
  timer.update(stamp);
  const dt = Math.min(0.05, timer.getDelta());
  const t = now();
  const wall = timer.getElapsed();

  // Float: a slow bob and sway, so the block hangs in space even between hits.
  stage.position.y = Math.sin(wall * 0.45) * 0.14;
  stage.rotation.z = Math.sin(wall * 0.23) * 0.018;

  if (state.mode === 'touch') {
    // The block turns about the orbit's axis at the indicator's speed, the other way round — so a
    // still pointer meets the cubes in the same order, at the same tempo, as the indicator does.
    orbitAxis.set(0, 1, 0).applyQuaternion(ORBIT_TILT);
    // Timed on the audio clock, unclamped, so the turn stays locked to the tempo even if frames drop.
    const turn = (-2 * Math.PI * Math.min(0.5, Math.max(0, t - lastT))) / transport.orbitSec();
    blockTurn += turn;
    qStep.setFromAxisAngle(orbitAxis, turn);
    cluster.quaternion.premultiply(qStep);
    // A drag adds its own spin about the camera's axes, which dies away after release.
    if (!pointer.down) spin.vel.multiplyScalar(Math.exp(-dt * 1.5));
    up.setFromMatrixColumn(camera.matrixWorld, 1);
    right.setFromMatrixColumn(camera.matrixWorld, 0);
    qStep.setFromAxisAngle(up, spin.vel.y * dt);
    cluster.quaternion.premultiply(qStep);
    qStep.setFromAxisAngle(right, spin.vel.x * dt);
    cluster.quaternion.premultiply(qStep);
    if (pointer.down) spin.vel.multiplyScalar(Math.exp(-dt * 10));
  } else {
    // Back to the orbit's frame, so each cube is where its step says it is.
    cluster.quaternion.slerp(new THREE.Quaternion(), 1 - Math.exp(-dt * 3));
  }

  // Touch runs every frame at the pointer's last position, so a still pointer still plays.
  pointer.speed *= Math.exp(-dt * 6);
  if (world && pointer.inside && !pointer.down) {
    if (state.mode === 'touch') readAt(pointer.lastX, pointer.lastY, t);
    else touchAt(pointer.lastX, pointer.lastY);
  } else {
    reader.phi = null;
    reader.anchor = null;
  }

  if (world) {
    applyPending(t);
    world.physics.advance(dt);
    const { heat, glow, white, physics, display, vivid, rest, ink, restInk } = world;
    const decay = Math.exp(-dt / HEAT_TAU);
    const dark = state.look === 'dark';
    // How far a hard hit usually throws a cube at this FORCE; DARK is fully white out there.
    const reach = 0.6 + 0.35 * FORCE_MULT[state.force - 1];
    for (let i = 0; i < heat.length; i++) {
      heat[i] *= decay;
      const off = physics.offset(i);
      if (dark) {
        // DARK: grey and colourless at rest; struck, it lights up in its colour, and the further
        // it is thrown from its place in the block the closer it gets to white.
        // Small wobbles from a neighbour's hit don't count; only a real strike or throw lights it.
        const active = Math.min(1, heat[i] * 1.1 + Math.max(0, off - 0.2) * 0.6);
        display[i].copy(rest).lerp(vivid[i], active);
        // The pattern is there at rest, faint and colourless; it takes its ink as the cube lights.
        tmpC.copy(restInk).lerp(ink[i], active);
        world.cubes.setInk(i, tmpC);
        white[i] = smoothstep(0.5, reach, off);
        glow[i] = active * 0.4 + white[i] * 0.4;
      } else {
        // PAINTED: cubes the wave is passing through warm up with their displacement.
        glow[i] = Math.min(1, heat[i] + Math.min(0.3, Math.max(0, off - 0.05) * 0.2));
        white[i] = glow[i] * 0.7;
      }
    }
    world.cubes.update(world.pieces, physics, glow, white, dark ? display : null);
  }
  emissions.update(t);
  placeIndicator(transport.angle(t));
  updateHum(t);
  if (state.timeline) timeline.draw(Math.max(0, transport.position(t)), transport.playing);

  if (state.mode === 'orbit') controls.update();
  fxPass.uniforms.uTime.value = (t % 100) * 13.7;
  // The beat pulse: up to 1 on each kick and snare as it sounds, then falling away.
  for (let k = pulses.length - 1; k >= 0; k--)
    if (pulses[k] <= t) {
      pulse = 1;
      pulses.splice(k, 1);
    }
  pulse *= Math.exp(-dt * 7);
  stylePasses.update(t % 1000, pulse);
  halo.scale.setScalar(2.4 * (1 + 0.28 * pulse));
  world?.cubes.setTime(t % 1000);
  composer.render();
  lastT = t;
  requestAnimationFrame(frame);
}

timeline.setPattern(pattern);
frameView();
applyProfile();
build(state.seed);
applyTuning();
controls.enabled = state.mode === 'orbit';
ring.visible = trail.visible = indicator.visible = state.mode === 'orbit';
syncUrl();
refreshUi();
requestAnimationFrame(frame);

// For poking at it from the console.
window.volum3 = { state, act, transport, timeline, debug, get world() { return world; }, get pattern() { return pattern; } };
