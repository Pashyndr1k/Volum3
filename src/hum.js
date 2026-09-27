import { SCALES } from './patterns.js';

/*
  Hum a tune, get a melody lane.

  Capture: an AudioWorklet copies the microphone into 1024-sample chunks, each stamped with the
  audio-clock time of its first sample. The recording window is known on that same clock (it
  starts after a one-bar count-in, while the drums play as a guide), so every chunk lands at the
  right place in a buffer that starts exactly on the downbeat. No MediaRecorder: its start
  latency is unknown, and a hum is only useful if it lines up with the grid.

  Analysis (analyzeHum), at 16 kHz:
    1. Every 10 ms: loudness (RMS) and pitch by YIN, 75–1000 Hz.
    2. A frame is voiced when it is loud enough above the room and YIN is confident.
    3. Notes start when the voice starts, when the pitch moves by more than ~a semitone and
       stays there, or when the loudness dips and rises again on the same pitch ("da-da").
    4. Each note: onset, length, median pitch.

  Conversion (humToMelody): the hum becomes the whole composition, so nothing is bent to fit an
  existing key. The key is read from the hum itself — the major or minor scale that holds the
  most of it, weighted by how long each note is held — and each note is rounded to the nearest
  semitone and, only if it falls outside that scale, nudged to its neighbour in it. The line is
  moved by whole octaves into a comfortable register; its pitches and intervals are the singer's.
  Onsets round to the nearest sixteenth, lengths to whole steps.
*/

const WORKLET = `
class Volum3Recorder extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(1024); this.n = 0; this.t = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      if (this.n === 0) this.t = currentTime + i / sampleRate;
      this.buf[this.n++] = ch[i];
      if (this.n === this.buf.length) {
        this.port.postMessage({ t: this.t, d: this.buf });
        this.buf = new Float32Array(1024);
        this.n = 0;
      }
    }
    return true;
  }
}
registerProcessor('volum3-recorder', Volum3Recorder);
`;

let workletReady = null;

export async function openMic(ctx) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser cannot record audio here (it needs https or localhost).');
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false },
  });
  if (!workletReady) {
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
    workletReady = ctx.audioWorklet.addModule(url);
  }
  await workletReady;
  const source = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, 'volum3-recorder');
  const sink = ctx.createGain();
  sink.gain.value = 0; // keeps the node pulled by the graph without making it audible
  source.connect(node).connect(sink).connect(ctx.destination);
  const chunks = [];
  let level = 0;
  node.port.onmessage = (e) => {
    chunks.push(e.data);
    let s = 0;
    for (let i = 0; i < e.data.d.length; i++) s += e.data.d[i] * e.data.d[i];
    level = Math.sqrt(s / e.data.d.length);
  };
  // What the browser says the input path delays the signal by; used to pull the take back in time.
  const track = stream.getAudioTracks()[0];
  const latency = Math.min(0.2, track?.getSettings?.().latency ?? 0.02);
  return {
    latency,
    level: () => level,
    // Samples between two audio-clock times, placed by each chunk's own timestamp.
    take(t0, t1) {
      const sr = ctx.sampleRate;
      const out = new Float32Array(Math.max(0, Math.round((t1 - t0) * sr)));
      for (const { t, d } of chunks) {
        const at = Math.round((t - t0) * sr);
        for (let i = 0; i < d.length; i++) {
          const k = at + i;
          if (k >= 0 && k < out.length) out[k] = d[i];
        }
      }
      return out;
    },
    close() {
      node.port.onmessage = null;
      source.disconnect();
      node.disconnect();
      sink.disconnect();
      for (const tr of stream.getTracks()) tr.stop();
    },
  };
}

// ---- Analysis -----------------------------------------------------------------------------

const RATE = 16000;
const HOP = 160; // 10 ms
const WIN = 400; // 25 ms YIN integration window
const TAU_MIN = Math.floor(RATE / 1000);
const TAU_MAX = Math.ceil(RATE / 75);

function resample(x, from) {
  // Two one-pole low-passes at ~5 kHz against aliasing, then linear interpolation.
  const a = Math.exp((-2 * Math.PI * 5000) / from);
  const y = new Float32Array(x.length);
  let s1 = 0, s2 = 0;
  for (let i = 0; i < x.length; i++) {
    s1 = (1 - a) * x[i] + a * s1;
    s2 = (1 - a) * s1 + a * s2;
    y[i] = s2;
  }
  const n = Math.floor((x.length * RATE) / from);
  const out = new Float32Array(n);
  const r = from / RATE;
  for (let i = 0; i < n; i++) {
    const p = i * r;
    const k = Math.floor(p);
    const f = p - k;
    out[i] = (y[k] ?? 0) * (1 - f) + (y[k + 1] ?? 0) * f;
  }
  return out;
}

function yin(x, start, d) {
  // Difference function, cumulative-mean normalised; first dip under 0.12, refined by parabola.
  for (let tau = 1; tau <= TAU_MAX; tau++) {
    let s = 0;
    for (let j = 0; j < WIN; j++) {
      const v = x[start + j] - x[start + j + tau];
      s += v * v;
    }
    d[tau] = s;
  }
  let run = 0;
  d[0] = 1;
  for (let tau = 1; tau <= TAU_MAX; tau++) {
    run += d[tau];
    d[tau] = run > 0 ? (d[tau] * tau) / run : 1;
  }
  let tau = -1;
  for (let t = TAU_MIN; t < TAU_MAX; t++)
    if (d[t] < 0.12) {
      while (t + 1 < TAU_MAX && d[t + 1] < d[t]) t++;
      tau = t;
      break;
    }
  if (tau < 0) {
    let best = TAU_MIN;
    for (let t = TAU_MIN; t < TAU_MAX; t++) if (d[t] < d[best]) best = t;
    if (d[best] > 0.25) return 0;
    tau = best;
  }
  const a = d[tau - 1], b = d[tau], c = d[tau + 1] ?? b;
  const shift = (a - c) / (2 * (a - 2 * b + c) || 1);
  return RATE / (tau + (Math.abs(shift) < 1 ? shift : 0));
}

const median = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

export function analyzeHum(input, sampleRate) {
  const x = resample(input, sampleRate);
  const frames = Math.max(0, Math.floor((x.length - WIN - TAU_MAX) / HOP));
  const rms = new Float32Array(frames);
  const pitch = new Float32Array(frames); // MIDI, 0 = unvoiced
  const d = new Float32Array(TAU_MAX + 2);
  for (let f = 0; f < frames; f++) {
    const s0 = f * HOP;
    let e = 0;
    for (let j = 0; j < WIN; j++) e += x[s0 + j] * x[s0 + j];
    rms[f] = Math.sqrt(e / WIN);
    const hz = yin(x, s0, d);
    pitch[f] = hz > 0 ? 69 + 12 * Math.log2(hz / 440) : 0;
  }
  if (frames === 0) return [];

  const sorted = [...rms].sort((a, b) => a - b);
  const floor = sorted[Math.floor(frames * 0.2)];
  const peak = sorted[Math.floor(frames * 0.98)];
  const gate = Math.max(floor * 3.5, peak * 0.1, 0.004);
  const voiced = (f) => pitch[f] > 0 && rms[f] > gate;

  // Median-smooth the pitch over voiced neighbours, to drop octave slips and glitches.
  const smooth = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    if (!voiced(f)) continue;
    const win = [];
    for (let k = f - 2; k <= f + 2; k++) if (k >= 0 && k < frames && voiced(k)) win.push(pitch[k]);
    smooth[f] = median(win);
  }

  const notes = [];
  let cur = null;
  let silent = 0;
  let drift = 0;
  let dip = -1;
  const close = (endFrame) => {
    if (cur && endFrame - cur.start >= 7) {
      notes.push({
        t: (cur.start * HOP) / RATE,
        dur: ((endFrame - cur.start) * HOP) / RATE,
        midi: median(cur.pitches),
        level: Math.min(1, cur.loud / peak),
      });
    }
    cur = null;
    drift = 0;
    dip = -1;
  };
  const open = (f) => {
    cur = { start: f, pitches: [smooth[f]], loud: rms[f], max: rms[f] };
  };

  for (let f = 0; f < frames; f++) {
    if (!voiced(f)) {
      if (cur) {
        if (dip < 0) dip = f; // a gap too short to end the note still counts as a dip
        if (++silent >= 4) close(f - silent + 1);
      }
      continue;
    }
    silent = 0;
    if (!cur) {
      open(f);
      continue;
    }
    const ref = median(cur.pitches.slice(-12));
    // A held change of more than ~a semitone starts a new note where the change began.
    if (Math.abs(smooth[f] - ref) > 0.9) {
      if (++drift >= 4) {
        const at = f - drift + 1;
        close(at);
        open(at);
        for (let k = at + 1; k <= f; k++) if (voiced(k)) cur.pitches.push(smooth[k]);
      }
      continue;
    }
    drift = 0;
    // Re-articulation on the same pitch: loudness falls to half and comes back.
    cur.max = Math.max(cur.max, rms[f]);
    if (rms[f] < cur.max * 0.5 && dip < 0) dip = f;
    if (dip >= 0 && rms[f] > cur.max * 0.8 && f - cur.start >= 8) {
      close(dip);
      open(f);
      continue;
    }
    cur.pitches.push(smooth[f]);
    cur.loud = Math.max(cur.loud, rms[f]);
  }
  close(frames - silent);
  return notes;
}

export function humToMelody(notes, stepSec, steps) {
  if (notes.length === 0) return null;
  const rounded = notes.map((n) => Math.round(n.midi));

  // The key: the major or minor scale that holds the most of the hum, weighted by duration, with
  // a nudge toward the root the tune starts or ends on.
  let best = { root: 0, scale: 'major', fit: -1 };
  for (const scale of ['major', 'minor'])
    for (let root = 0; root < 12; root++) {
      const steps7 = SCALES[scale];
      let fit = 0;
      rounded.forEach((m, k) => {
        const pc = (((m - root) % 12) + 12) % 12;
        if (steps7.includes(pc)) fit += notes[k].dur;
        if (pc === 0 && (k === 0 || k === rounded.length - 1)) fit += 0.15;
      });
      if (fit > best.fit + 1e-6) best = { root, scale, fit };
    }
  const inKey = (m) => SCALES[best.scale].includes((((m - best.root) % 12) + 12) % 12);
  const fitted = rounded.map((m, k) => {
    if (inKey(m)) return m;
    // Out of key: go to the in-key neighbour on the side the sung pitch leaned toward.
    const up = inKey(m + 1), down = inKey(m - 1);
    if (up && down) return notes[k].midi >= m ? m + 1 : m - 1;
    return up ? m + 1 : down ? m - 1 : m;
  });

  const med = median(fitted);
  const octave = Math.round((67 - med) / 12) * 12;

  const byStep = new Map();
  notes.forEach((n, k) => {
    const step = Math.round(n.t / stepSec);
    if (step < 0 || step >= steps) return;
    const len = Math.max(1, Math.min(steps - step, Math.round(n.dur / stepSec)));
    const e = { lane: 'melody', step, len, midi: fitted[k] + octave, vel: 0.55 + 0.4 * n.level };
    const prev = byStep.get(step);
    if (!prev || prev.len < e.len) byStep.set(step, e);
  });
  const events = [...byStep.values()].sort((a, b) => a.step - b.step);
  events.forEach((e, k) => {
    const next = events[k + 1];
    if (next) e.len = Math.max(1, Math.min(e.len, next.step - e.step));
  });
  return { root: best.root, scale: best.scale, events };
}
