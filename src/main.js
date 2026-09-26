import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { generateCluster } from './cluster.js';
import { assignVoices, noteFor, chordAt, chordSpread, setHarmony, VOICE } from './music.js';
import { presetPattern, generatePattern, SCALES, STYLE } from './patterns.js';
import { mapPattern } from './mapper.js';
import { Timeline } from './timeline.js';
import { openMic, analyzeHum, humToEvents } from './hum.js';
import { pairFor, INK } from './palette.js';
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
const ORBIT_RADIUS = 7.6;
const ORBIT_TILT = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.22, 0, 0.1));
const HEAT_TAU = 0.3; // seconds; a struck cube is back to its colour in about 4–6 steps
const TOUCH_COOLDOWN = 0.15;
const GHOST = 0.14; // how hard the indicator brushes a cube that has no note this orbit
const IDLE_COLOR = '#2b2a27'; // cubes without a note go dark, so the block shows the pattern
const MAX_VOICES_PER_TOUCH = 4;

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
camera.position.set(18, 11.5, 22);

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
    const a = Math.pow(i / (TRAIL - 1), 2) * 1.6;
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
  new THREE.BoxGeometry(0.3, 0.3, 0.3),
  new THREE.MeshBasicMaterial({ color: new THREE.Color(INK).multiplyScalar(3), toneMapped: false }),
);
stage.add(indicator);
const indicatorLight = new THREE.PointLight(0xfff1dc, 55, 13, 2);
indicator.add(indicatorLight);

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

function build(seed) {
  if (world) world.cubes.dispose();
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
    buckets,
    mapping,
    idleByStep: idleBuckets(pieces, mapping),
    heat: new Float32Array(pieces.length),
    glow: new Float32Array(pieces.length),
    lastTouch: new Float64Array(pieces.length).fill(-1),
  };
  cubes.update(pieces, physics, world.glow);
  cubes.mesh.computeBoundingSphere();
  cubes.mesh.boundingSphere.radius += TUNING.maxOffset; // cubes fly; keep raycasts from being culled early
}

// A cube takes the colour of the first part it plays; a cube with nothing to play goes dark.
function colorOf(mapping, i) {
  const ev = mapping.cubeEvents[i][0];
  return ev ? pairFor(VOICE.get(pattern.voices[ev.lane]).index).bg : IDLE_COLOR;
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
  world.cubes.setColors(world.pieces.map((_, i) => colorOf(world.mapping, i)));
}

function setPattern(p) {
  pattern = p;
  setHarmony(p.root, SCALES[p.scale], p.progression);
  state.bpm = p.bpm;
  transport.setBpm(p.bpm);
  transport.swing = p.swing;
  if (world) remap();
  timeline.setPattern(p);
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

// Apply a strike now: impulse, heat, and the emission throw. `dir` is in the cluster's frame.
function strike(i, dir, arm, energy, t) {
  const { pieces, physics, heat } = world;
  physics.strike(i, [dir.x, dir.y, dir.z], [arm.x, arm.y, arm.z], energy);
  heat[i] = Math.max(heat[i], energy);
  const p = pieces[i];
  const o = i * 3;
  tmpV.set(p.rest.x + physics.u[o], p.rest.y + physics.u[o + 1], p.rest.z + physics.u[o + 2]);
  emissions.throw(tmpV, p.scale, world.cubes.base[i], energy, state.grain, t);
}

// Called by the transport for every step, ahead of time. Sound is booked now; the picture waits.
// Each note of the pattern at this step strikes its cube; cubes with no note get a light brush.
function onStep(absStep, time) {
  if (!world || state.mode !== 'orbit') return;
  const s = absStep % STEPS;
  const sec = transport.stepSec();
  const heard = new Set();
  for (const { event, cube } of world.mapping.byStep[s]) {
    const silent = timeline.muted.has(event.lane) || (hum.active && event.lane === 'melody');
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

// ---- Touch ----------------------------------------------------------------------------------

const raycaster = new THREE.Raycaster();
const pointer = { x: 0, y: 0, lastX: 0, lastY: 0, lastT: 0, speed: 0, down: false, dragged: false };
const spin = { vel: new THREE.Vector3(), auto: new THREE.Vector3(0.06, 0.22, 0) };

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
  const hit = raycaster.intersectObject(world.cubes.mesh, false)[0];
  cursor.visible = !!hit;
  if (hit) {
    cursor.position.copy(hit.point);
    cursor.quaternion.copy(camera.quaternion);
    cursor.scale.setScalar(Math.max(0.35, ZONE_RADIUS[state.zone]));
  }
  return hit && hit.instanceId !== undefined ? hit : null;
}

/*
  A touch strikes every cube within the zone around the point of contact: full strength at the
  centre, fading toward the edge, each one a little later the further out it is (30 ms per
  unit) — so a wide touch lands as a quick ripple, not a slab. Only the nearest few sound.
*/
function touchAt(clientX, clientY) {
  const hit = hover(clientX, clientY);
  if (!hit) return;
  const t = now();
  const radius = ZONE_RADIUS[state.zone];
  const inv = tmpQ.copy(cluster.getWorldQuaternion(new THREE.Quaternion())).invert();
  const ray = raycaster.ray.direction.clone().applyQuaternion(inv);
  const contact = cluster.worldToLocal(hit.point.clone());
  const base = Math.min(1, 0.6 + pointer.speed / 2500);
  const { pieces, physics, lastTouch } = world;

  const touched = [];
  if (radius === 0) touched.push({ i: hit.instanceId, d: 0 });
  else
    for (let i = 0; i < pieces.length; i++) {
      const o = i * 3;
      const d = Math.max(0, Math.hypot(
        pieces[i].rest.x + physics.u[o] - contact.x,
        pieces[i].rest.y + physics.u[o + 1] - contact.y,
        pieces[i].rest.z + physics.u[o + 2] - contact.z,
      ) - pieces[i].scale / 2);
      if (d <= radius) touched.push({ i, d });
    }
  touched.sort((a, b) => a.d - b.d);

  const absStep = Math.floor(transport.playing ? transport.position(t) : t / transport.stepSec());
  const heard = new Set();
  for (const { i, d } of touched) {
    if (t - lastTouch[i] < TOUCH_COOLDOWN) continue;
    lastTouch[i] = t;
    const energy = radius === 0 ? base : base * Math.pow(1 - d / (radius + 0.5), 0.7);
    const delay = d * 0.03;
    const dir = pushDir(i, ray);
    if (delay < 0.004) {
      const arm = contact.clone().sub(pieces[i].rest).clampLength(0, pieces[i].scale / 2);
      strike(i, dir, arm, energy, t);
    } else pending.push({ time: t + delay, i, energy, gen: world, dir });
    if (!audioReady()) continue;
    const n = noteOf(i, absStep);
    const k = `${n.voice.id}:${n.midi}`;
    if (heard.has(k) || heard.size >= MAX_VOICES_PER_TOUCH) continue;
    heard.add(k);
    soundPiece(i, t + 0.01 + delay, absStep, energy);
  }
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
  if (pointer.down) {
    if (Math.abs(dx) + Math.abs(dy) > 0) pointer.dragged = true;
    cursor.visible = false;
    if (state.mode === 'touch') {
      // Drag spins the block about the camera's up and right axes; release keeps the momentum.
      spin.vel.x = dy * 0.25;
      spin.vel.y = dx * 0.25;
    }
    return;
  }
  touchAt(e.clientX, e.clientY);
});

const release = () => {
  // A click without a drag touches the cube under the pointer, for trackpads that never hover.
  if (pointer.down && !pointer.dragged) touchAt(pointer.lastX, pointer.lastY);
  pointer.down = false;
};
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', () => (pointer.down = false));
canvas.addEventListener('pointerleave', () => (cursor.visible = false));

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
  setBpm(bpm) {
    state.bpm = Math.max(50, Math.min(180, bpm));
    pattern.bpm = state.bpm;
    transport.setBpm(state.bpm);
    timeline.setPattern(pattern);
    syncUrl();
    refreshUi();
  },
  randomPattern(styleId = pattern.style) {
    const p = generatePattern(styleId, randomSeed());
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
  renderPanel(panel, state, act);
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
  frameView();
});

// ---- Timeline and humming -------------------------------------------------------------------

const timelineEl = document.getElementById('timeline');
timelineEl.hidden = !state.timeline;
const timeline = new Timeline(timelineEl, {
  onStyle: (id) => act.randomPattern(id),
  onRandom: () => act.randomPattern(),
  onPreset: () => act.presetPattern(),
  onHum: () => act.hum(),
  onMute: () => {},
  onEdit: (p) => setPattern(p),
});

/*
  Humming: open the microphone, count one bar in on the rim, then play the pattern with its
  melody silenced as a guide while four bars are recorded. When the window closes, the take is
  analysed and becomes the melody lane — played by the sustained LEAD voice — and the cubes are
  re-dealt to its notes. The guide keeps going, so the result plays straight away.
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
  hum.timer = setTimeout(finishHum, (hum.t0 + hum.dur - c.currentTime + 0.25) * 1000);
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
  const samples = hum.mic.take(hum.t0, hum.t0 + hum.dur);
  const sampleRate = audioCtx().sampleRate;
  stopHum('ANALYSING');
  const notes = analyzeHum(samples, sampleRate);
  const melody = humToEvents(notes, pattern, transport.stepSec(), STEPS);
  if (melody.length === 0) {
    timeline.setStatus('HEARD NOTHING · HUM LOUDER, CLOSER TO THE MIC');
    return;
  }
  setPattern({
    ...pattern,
    name: 'HUMMED',
    voices: { ...pattern.voices, melody: 'lead' },
    events: [...pattern.events.filter((e) => e.lane !== 'melody'), ...melody],
  });
  timeline.setStatus(`HEARD ${melody.length} NOTES`);
}

function updateHum(t) {
  if (!hum.active) return;
  const beat = 60 / pattern.bpm;
  const counting = t < hum.t0;
  const count = Math.max(1, Math.min(4, 4 - Math.floor((t - hum.countAt) / beat)));
  const bar = Math.min(4, 1 + Math.floor((t - hum.t0) / (beat * 4)));
  timeline.rec = { phase: counting ? 'count' : 'rec', count, level: hum.mic ? hum.mic.level() : 0 };
  const text = counting ? 'COUNT-IN' : `LISTENING · BAR ${bar} OF 4 · ESC TO CANCEL`;
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

function frame(stamp) {
  timer.update(stamp);
  const dt = Math.min(0.05, timer.getDelta());
  const t = now();
  const wall = timer.getElapsed();

  // Float: a slow bob and sway, so the block hangs in space even between hits.
  stage.position.y = Math.sin(wall * 0.45) * 0.14;
  stage.rotation.z = Math.sin(wall * 0.23) * 0.018;

  if (state.mode === 'touch') {
    // Momentum decays toward a slow auto-spin, about axes fixed to the camera.
    if (!pointer.down) spin.vel.lerp(spin.auto, 1 - Math.exp(-dt * 1.2));
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

  if (world) {
    applyPending(t);
    world.physics.advance(dt);
    const { heat, glow, physics } = world;
    const decay = Math.exp(-dt / HEAT_TAU);
    for (let i = 0; i < heat.length; i++) {
      heat[i] *= decay;
      // Cubes the wave is passing through warm up with their displacement — the light travels too.
      glow[i] = Math.min(1, heat[i] + Math.min(0.3, Math.max(0, physics.offset(i) - 0.05) * 0.2));
    }
    world.cubes.update(world.pieces, physics, glow);
  }
  emissions.update(t);
  placeIndicator(transport.angle(t));
  updateHum(t);
  if (state.timeline) timeline.draw(Math.max(0, transport.position(t)), transport.playing);

  if (state.mode === 'orbit') controls.update();
  composer.render();
  requestAnimationFrame(frame);
}

timeline.setPattern(pattern);
frameView();
build(state.seed);
applyTuning();
controls.enabled = state.mode === 'orbit';
ring.visible = trail.visible = indicator.visible = state.mode === 'orbit';
syncUrl();
refreshUi();
requestAnimationFrame(frame);

// For poking at it from the console.
window.volum3 = { state, act, transport, timeline, get world() { return world; }, get pattern() { return pattern; } };
