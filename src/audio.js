import { midiToHz } from './music.js';
import { mulberry32 } from './rng.js';

/*
  A port of SQNCR's sound: the same master compressor, the same procedural plate and dotted-eighth
  delay, the same sixteen voice recipes. Nothing is sampled. The CITY tone profile is baked in at
  its "as written" setting (fx = 4): 13 cents of ombak detune and a 0.9 Hz tremolo on sustains.
*/

const TONE = { decay: 1, strike: 0.15, hold: 1, reverb: 1.25, delay: 1, space: 2.2, lfoHz: 0.9, lfoDepth: 0.16, ombak: 13 };
const SUSTAINED = new Set(['sub', 'bell', 'chord', 'noise', 'cowbell']);
const SHORT_STRIKE = new Set(['kick', 'bass']);
const DETUNED = new Set(['sub', 'bass', 'bell', 'chord', 'cowbell']);

let bus = null;

export function audioReady() {
  return bus !== null;
}

export function ctx() {
  return bus ? bus.ctx : null;
}

export function now() {
  return bus ? bus.ctx.currentTime : performance.now() / 1000;
}

// Browsers only allow sound after a gesture; the first press anywhere builds and resumes the graph.
export async function unlock() {
  if (!bus) bus = build();
  const c = bus.ctx;
  const b = c.createBufferSource();
  b.buffer = c.createBuffer(1, 1, c.sampleRate);
  b.connect(c.destination);
  b.start(0);
  if (c.state !== 'running') await c.resume();
}

function plateImpulse(c, seconds, curve, seed) {
  const len = Math.max(1, Math.floor(c.sampleRate * seconds));
  const buf = c.createBuffer(2, len, c.sampleRate);
  const rand = mulberry32(seed);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let y = 0;
    for (let i = 0; i < len; i++) {
      y = y * 0.55 + (rand() * 2 - 1) * 0.45;
      const early = i < c.sampleRate * 0.012 ? 0.15 : 1;
      d[i] = y * Math.pow(1 - i / len, curve) * early;
    }
  }
  return buf;
}

function build() {
  const AC = window.AudioContext ?? window.webkitAudioContext;
  const c = new AC({ latencyHint: 'interactive' });

  const master = c.createGain();
  master.gain.value = 0.72;
  const comp = c.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.knee.value = 18;
  comp.ratio.value = 3;
  comp.attack.value = 0.018;
  comp.release.value = 0.5;
  master.connect(comp).connect(c.destination);

  const plateIn = c.createGain();
  const verb = c.createConvolver();
  verb.buffer = plateImpulse(c, TONE.space, 2.6, 9137);
  const verbHp = c.createBiquadFilter();
  verbHp.type = 'highpass';
  verbHp.frequency.value = 240;
  const verbOut = c.createGain();
  verbOut.gain.value = 0.55 * Math.min(1, 1.9 / TONE.space + 0.45);
  plateIn.connect(verb).connect(verbHp).connect(verbOut).connect(master);

  const delayIn = c.createGain();
  const delay = c.createDelay(2);
  delay.delayTime.value = 0.32;
  const delayLp = c.createBiquadFilter();
  delayLp.type = 'lowpass';
  delayLp.frequency.value = 2600;
  const feedback = c.createGain();
  feedback.gain.value = 0.34;
  const delayOut = c.createGain();
  delayOut.gain.value = 0.42;
  delayIn.connect(delay).connect(delayLp).connect(feedback).connect(delay);
  delayLp.connect(delayOut).connect(master);

  const noise = c.createBuffer(1, c.sampleRate, c.sampleRate);
  const nd = noise.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

  return { ctx: c, master, plateIn, delayIn, delay, noise };
}

export function setTempo(bpm) {
  if (!bus) return;
  bus.delay.delayTime.setTargetAtTime(Math.min(1.8, (60 / bpm) * 0.75), bus.ctx.currentTime, 0.05);
}

// One strip per note: gain → pan → master, with sends to the plate and the delay. Torn down after.
function strip(pan, reverb, delay, until) {
  const c = bus.ctx;
  const input = c.createGain();
  const panner = c.createStereoPanner();
  panner.pan.value = Math.max(-1, Math.min(1, pan));
  input.connect(panner).connect(bus.master);
  const sends = [];
  if (reverb > 0.001) {
    const g = c.createGain();
    g.gain.value = Math.min(1, reverb);
    panner.connect(g).connect(bus.plateIn);
    sends.push(g);
  }
  if (delay > 0.001) {
    const g = c.createGain();
    g.gain.value = Math.min(1, delay);
    panner.connect(g).connect(bus.delayIn);
    sends.push(g);
  }
  const ms = Math.max(0, (until - c.currentTime) * 1000) + 220;
  setTimeout(() => {
    input.disconnect();
    panner.disconnect();
    for (const s of sends) s.disconnect();
  }, ms);
  return input;
}

function env(g, at, peak, attack, dur) {
  const a = Math.min(attack, dur * 0.5);
  g.gain.setValueAtTime(1e-4, at);
  g.gain.linearRampToValueAtTime(peak, at + a);
  g.gain.exponentialRampToValueAtTime(1e-4, at + a + dur);
}

function osc(type, hz, at, dur) {
  const o = bus.ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(hz, at);
  o.start(at);
  o.stop(at + dur + 0.05);
  return o;
}

function noiseSrc(at, dur) {
  const s = bus.ctx.createBufferSource();
  s.buffer = bus.noise;
  s.loop = true;
  s.start(at, Math.random() * 0.8);
  s.stop(at + dur + 0.05);
  return s;
}

function filter(type, hz, q) {
  const f = bus.ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = hz;
  if (q !== undefined) f.Q.value = q;
  return f;
}

function tremolo(at, dur) {
  const c = bus.ctx;
  const g = c.createGain();
  g.gain.value = 1 - TONE.lfoDepth / 2;
  const lfo = c.createOscillator();
  lfo.frequency.value = TONE.lfoHz * (0.72 + Math.random() * 0.56);
  const depth = c.createGain();
  depth.gain.value = TONE.lfoDepth / 2;
  lfo.connect(depth).connect(g.gain);
  lfo.start(at);
  lfo.stop(at + dur + 0.1);
  return g;
}

/**
 * Play one SQNCR voice.
 * @param voice  entry from VOICES
 * @param opts   { at, velocity, pan, midi, spread }
 */
export function play(voice, { at, velocity = 0.8, pan = 0, midi, spread }) {
  if (!bus) return;
  const c = bus.ctx;
  const t = Math.max(at, c.currentTime + 0.002);
  const sustained = SUSTAINED.has(voice.id);
  const strike = SHORT_STRIKE.has(voice.id) ? Math.min(TONE.strike, 0.15) : TONE.strike;
  const stretch = sustained ? TONE.decay * (voice.id === 'chord' ? TONE.hold : 1) : 1 + (TONE.decay - 1) * strike;
  const h = voice.decay * stretch;
  const w = voice.gain * 0.5 * (0.45 + velocity * 0.55) / Math.pow(Math.max(1, stretch), sustained ? 0.5 : 0.35);
  const m = midi ?? voice.baseMidi;
  const out = strip(pan, voice.reverb * TONE.reverb, voice.delay * TONE.delay, t + h + 0.4);
  const trem = sustained ? tremolo(t, h) : null;
  const dest = trem ?? out;
  if (trem) trem.connect(out);
  const detune = DETUNED.has(voice.id) ? [-TONE.ombak / 2, TONE.ombak / 2] : [0];
  const cents = (x) => Math.pow(2, x / 1200);

  switch (voice.id) {
    case 'kick': {
      const g = c.createGain();
      const o = osc('sine', 130, t, h);
      o.frequency.exponentialRampToValueAtTime(46, t + 0.07);
      env(g, t, w, 0.002, h);
      o.connect(g).connect(dest);
      const click = c.createGain();
      env(click, t, w * 0.35, 0.001, 0.015);
      noiseSrc(t, 0.02).connect(filter('highpass', 1400)).connect(click).connect(dest);
      break;
    }
    case 'sub': {
      const hz = midiToHz(m);
      for (const d of detune) {
        const g = c.createGain();
        const o = osc('sine', hz * 1.04 * cents(d), t, h);
        o.frequency.exponentialRampToValueAtTime(hz * cents(d), t + 0.09);
        env(g, t, w / detune.length, 0.006, h);
        o.connect(g).connect(dest);
      }
      break;
    }
    case 'snare': {
      const g = c.createGain();
      const o = osc('triangle', 196, t, h);
      o.frequency.exponentialRampToValueAtTime(150, t + 0.08);
      env(g, t, w * 0.5, 0.002, h * 0.5);
      o.connect(g).connect(dest);
      const n = c.createGain();
      env(n, t, w * 0.8, 0.001, h);
      noiseSrc(t, h).connect(filter('bandpass', 1900, 0.9)).connect(n).connect(dest);
      break;
    }
    case 'clap': {
      const bp = filter('bandpass', 1250, 1.3);
      bp.connect(dest);
      for (const [off, amt, len] of [[0, 0.7, 0.012], [0.009, 0.85, 0.012], [0.019, 1, h]]) {
        const g = c.createGain();
        env(g, t + off, w * amt, 0.001, len);
        noiseSrc(t + off, len).connect(g).connect(bp);
      }
      break;
    }
    case 'rim': {
      const bp = filter('bandpass', 2100, 3.5);
      bp.connect(dest);
      for (const hz of [1720, 2540]) {
        const g = c.createGain();
        env(g, t, w * 0.5, 5e-4, h);
        osc('square', hz, t, h).connect(g).connect(bp);
      }
      break;
    }
    case 'hat':
    case 'ohat': {
      const g = c.createGain();
      env(g, t, w, 0.001, h);
      noiseSrc(t, h).connect(filter('highpass', 7200)).connect(filter('bandpass', 10500, 1.2)).connect(g).connect(dest);
      break;
    }
    case 'shaker': {
      const g = c.createGain();
      env(g, t, w, 0.016, h);
      noiseSrc(t, h).connect(filter('bandpass', 6200, 0.7)).connect(g).connect(dest);
      break;
    }
    case 'tom':
    case 'conga': {
      const hz = midiToHz(voice.baseMidi) * 2;
      const g = c.createGain();
      const o = osc('sine', hz * 1.35, t, h);
      o.frequency.exponentialRampToValueAtTime(hz, t + h * 0.7);
      env(g, t, w, 0.003, h);
      o.connect(g).connect(dest);
      const n = c.createGain();
      env(n, t, w * 0.18, 0.001, 0.025);
      noiseSrc(t, 0.03).connect(filter('lowpass', 3200)).connect(n).connect(dest);
      break;
    }
    case 'bell': {
      const hz = midiToHz(m);
      for (const d of detune)
        for (const [ratio, amp, len] of [[1, 1, 1], [2.76, 0.5, 0.62], [5.4, 0.28, 0.36], [8.9, 0.14, 0.2]]) {
          const g = c.createGain();
          env(g, t, (w * amp) / detune.length, 0.002, h * len);
          osc('sine', hz * ratio * cents(d), t, h).connect(g).connect(dest);
        }
      break;
    }
    case 'cowbell': {
      const bp = filter('bandpass', 2400, 2.2);
      bp.connect(dest);
      for (const d of detune)
        for (const hz of [562, 845]) {
          const g = c.createGain();
          env(g, t, (w * 0.5) / detune.length, 0.001, h);
          osc('square', hz * cents(d), t, h).connect(g).connect(bp);
        }
      break;
    }
    case 'bass': {
      const hz = midiToHz(m);
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.value = 6;
      lp.frequency.setValueAtTime(Math.min(5200, hz * 9), t);
      lp.frequency.exponentialRampToValueAtTime(Math.max(120, hz * 2), t + h * 0.8);
      const g = c.createGain();
      env(g, t, w, 0.004, h);
      lp.connect(g).connect(dest);
      for (const d of detune) {
        const k = c.createGain();
        k.gain.value = 1 / detune.length;
        osc('sawtooth', hz * cents(d), t, h).connect(k).connect(lp);
      }
      const subOct = c.createGain();
      subOct.gain.value = 0.6;
      osc('sine', hz / 2, t, h).connect(subOct).connect(lp);
      break;
    }
    case 'chord': {
      const lp = filter('lowpass', 2400);
      lp.connect(dest);
      const tones = spread ?? [0, 4, 7];
      const attack = Math.min(h * 0.4, 0.012 * TONE.decay * TONE.decay);
      for (const iv of tones)
        for (const d of detune) {
          const g = c.createGain();
          env(g, t, (w * 0.4) / (detune.length * Math.max(1, tones.length / 3)), attack, h);
          osc('triangle', midiToHz(m + iv) * cents(d), t, h).connect(g).connect(lp);
        }
      break;
    }
    case 'zap': {
      const hz = midiToHz(m);
      const g = c.createGain();
      const o = osc('sawtooth', hz * 4, t, h);
      o.frequency.exponentialRampToValueAtTime(hz * 0.5, t + h);
      env(g, t, w, 0.001, h);
      o.connect(filter('lowpass', 4200, 4)).connect(g).connect(dest);
      break;
    }
    case 'noise': {
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 1.4;
      bp.frequency.setValueAtTime(320, t);
      bp.frequency.exponentialRampToValueAtTime(4600, t + h);
      const g = c.createGain();
      g.gain.setValueAtTime(1e-4, t);
      g.gain.linearRampToValueAtTime(w, t + h * 0.7);
      g.gain.exponentialRampToValueAtTime(1e-4, t + h);
      noiseSrc(t, h).connect(bp).connect(g).connect(dest);
      break;
    }
  }
}
