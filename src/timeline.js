import { LANES, STYLES, STEPS, BAR, chordName, chordOf, melodyNotes, NOTE_NAMES } from './patterns.js';
import { VOICE } from './music.js';
import { pairFor } from './palette.js';

/*
  The timeline: one orbit of the pattern laid flat, 64 sixteenths across, one lane per part.
  It reads like a drum machine — a square per hit — with the pitched lanes as bars of their
  length, the melody drawn as a small piano roll. The playhead is the indicator's angle, so what
  crosses the line here is what the indicator is striking on the cube.

  Click a cell to add or remove a hit, click a lane's name to mute it. The header picks a style
  (each click on a style rolls a new pattern in it), RANDOM rolls again, PRESET goes back to the
  default, HUM records a melody from the microphone.
*/

const LABEL_W = 64;
const RULER_H = 16;
const LANE_H = 14;
const MELODY_H = 64;
const INK = '#DDDACA';
const DIM = '#62615A';
const FAINT = '#323232';
const REC = '#F74227';

export class Timeline {
  constructor(root, handlers) {
    this.root = root;
    this.h = handlers;
    this.pattern = null;
    this.muted = new Set();
    this.status = '';
    this.rec = null; // { phase: 'count' | 'rec', count, progress, level }
    this.head = document.createElement('div');
    this.head.className = 'tl-head';
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'tl-canvas';
    root.append(this.head, this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.canvas.addEventListener('pointerdown', (e) => this.click(e));
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  get height() {
    return this.root.hidden ? 0 : this.root.getBoundingClientRect().height + 20;
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = this.canvas.clientWidth || 800;
    const h = RULER_H + MELODY_H + LANE_H * (LANES.length - 1);
    this.canvas.style.height = `${h}px`;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = w;
    this.hpx = h;
  }

  setPattern(p) {
    this.pattern = p;
    this.renderHead();
  }

  setStatus(text) {
    this.status = text;
    this.renderHead();
  }

  renderHead() {
    const p = this.pattern;
    this.head.innerHTML = '';
    const word = (text, cls, onClick, title) => {
      const s = document.createElement('span');
      s.textContent = text;
      s.className = cls;
      if (title) s.title = title;
      if (onClick) s.addEventListener('click', onClick);
      this.head.append(s);
      return s;
    };
    word('TIMELINE', 'brand');
    const styles = document.createElement('span');
    styles.className = 'group';
    for (const s of STYLES) {
      const w = document.createElement('span');
      w.textContent = s.label;
      w.className = `word ${p && p.style === s.id ? 'on' : 'off'}`;
      w.title = `${s.bpm[0]}–${s.bpm[1]} BPM · click for a new ${s.label} pattern`;
      w.addEventListener('click', () => this.h.onStyle(s.id));
      styles.append(w);
    }
    this.head.append(styles);
    word('RANDOM', 'word on', () => this.h.onRandom(), 'A new rhythm and melody in this style, at a new tempo');
    word('PRESET', 'word on', () => this.h.onPreset(), 'Back to the default groove');
    word(this.rec ? 'STOP' : 'HUM', `word ${this.rec ? 'rec' : 'on'}`, () => this.h.onHum(), 'Hum a melody into the microphone: one bar count-in, then four bars');
    if (p) {
      const key = `${NOTE_NAMES[p.root]} ${p.scale.toUpperCase()}`;
      word(`${p.bpm} BPM · ${key}`, 'name');
    }
    if (this.status) word(this.status, this.rec ? 'status rec' : 'status');
  }

  // ---- Geometry ---------------------------------------------------------------------------

  laneY(id) {
    let y = RULER_H;
    for (const l of LANES) {
      if (l.id === id) return y;
      y += l.id === 'melody' ? MELODY_H : LANE_H;
    }
    return y;
  }

  laneH(id) {
    return id === 'melody' ? MELODY_H : LANE_H;
  }

  laneAt(y) {
    for (const l of LANES) {
      const y0 = this.laneY(l.id);
      if (y >= y0 && y < y0 + this.laneH(l.id)) return l.id;
    }
    return null;
  }

  melodyRange() {
    const m = this.pattern.events.filter((e) => e.lane === 'melody').map((e) => e.midi);
    const lo = Math.min(60, ...m) - 1;
    const hi = Math.max(lo + 14, ...m) + 1;
    return [lo, hi];
  }

  // ---- Editing ----------------------------------------------------------------------------

  click(e) {
    if (!this.pattern || this.rec) return;
    const r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const lane = this.laneAt(y);
    if (!lane) return;
    if (x < LABEL_W) {
      this.muted.has(lane) ? this.muted.delete(lane) : this.muted.add(lane);
      this.h.onMute(this.muted);
      return;
    }
    const step = Math.floor(((x - LABEL_W) / (this.w - LABEL_W)) * STEPS);
    if (step < 0 || step >= STEPS) return;
    const p = this.pattern;
    const covering = p.events.findIndex((ev) => ev.lane === lane && step >= ev.step && step < ev.step + (ev.len ?? 1));
    let events;
    if (covering >= 0) events = p.events.filter((_, k) => k !== covering);
    else {
      const bar = Math.floor(step / BAR);
      const deg = p.progression[bar];
      let add;
      if (lane === 'melody') {
        const [lo, hi] = this.melodyRange();
        const y0 = this.laneY('melody');
        const midi = hi - ((y - y0) / MELODY_H) * (hi - lo);
        const pool = melodyNotes(p, lo, hi);
        add = { lane, step, len: 2, vel: 0.8, midi: pool.reduce((a, b) => (Math.abs(b - midi) < Math.abs(a - midi) ? b : a)) };
      } else if (lane === 'bass') add = { lane, step, len: 2, vel: 0.8, midi: chordOf(p, deg, 36).root };
      else if (lane === 'chord') {
        const { root, tones } = chordOf(p, deg, 55);
        add = { lane, step, len: 4, vel: 0.7, midi: root, spread: tones };
      } else add = { lane, step, vel: step % 4 === 0 ? 0.85 : 0.65 };
      events = [...p.events, add];
    }
    this.h.onEdit({ ...p, events });
  }

  // ---- Drawing ----------------------------------------------------------------------------

  draw(position, playing) {
    const p = this.pattern;
    const c = this.ctx;
    const W = this.w;
    const colW = (W - LABEL_W) / STEPS;
    c.clearRect(0, 0, W, this.hpx);
    if (!p) return;
    const pos = ((position % STEPS) + STEPS) % STEPS;
    c.font = '10px "DM Mono", ui-monospace, monospace';
    c.textBaseline = 'middle';

    // Lanes and their names.
    for (const l of LANES) {
      const y = this.laneY(l.id);
      const h = this.laneH(l.id);
      c.fillStyle = LANES.indexOf(l) % 2 ? '#0b0b0b' : '#0e0e0e';
      c.fillRect(LABEL_W, y, W - LABEL_W, h);
      c.fillStyle = this.muted.has(l.id) ? FAINT : DIM;
      c.textAlign = 'left';
      c.fillText(l.label, 0, y + Math.min(h, LANE_H) / 2 + 1);
      if (this.muted.has(l.id)) c.fillText('MUTE', 0, y + LANE_H + 6);
    }

    // Grid: beats faint, bars strong. Ruler: bar numbers and chord names.
    for (let s = 0; s <= STEPS; s++) {
      if (s % 4) continue;
      const x = Math.round(LABEL_W + s * colW) + 0.5;
      c.strokeStyle = s % BAR === 0 ? '#3a3a37' : '#1b1b1a';
      c.beginPath();
      c.moveTo(x, RULER_H);
      c.lineTo(x, this.hpx);
      c.stroke();
    }
    c.textAlign = 'left';
    for (let b = 0; b < 4; b++) {
      const x = LABEL_W + b * BAR * colW + 3;
      const on = playing && Math.floor(pos / BAR) === b;
      c.fillStyle = on ? INK : DIM;
      c.fillText(`${b + 1}  ${chordName(p, p.progression[b])}`, x, RULER_H / 2);
    }

    // Events.
    const [lo, hi] = this.melodyRange();
    for (const e of p.events) {
      const voice = VOICE.get(p.voices[e.lane]);
      const color = pairFor(voice ? voice.index : 0).bg;
      const y0 = this.laneY(e.lane);
      const len = e.len ?? 1;
      const x = LABEL_W + e.step * colW;
      const active = playing && pos >= e.step && pos < e.step + Math.max(0.9, len);
      c.globalAlpha = this.muted.has(e.lane) ? 0.2 : 0.35 + 0.65 * (e.vel ?? 0.8);
      c.fillStyle = active ? '#FFFFFF' : color;
      if (e.lane === 'melody') {
        const y = y0 + (1 - (e.midi - lo) / (hi - lo)) * (MELODY_H - 6);
        c.fillRect(x + 1, y, Math.max(2, len * colW - 2), 5);
      } else if (e.lane === 'bass' || e.lane === 'chord') {
        c.fillRect(x + 1, y0 + 3, Math.max(2, len * colW - 2), LANE_H - 6);
      } else {
        const s = Math.max(3, Math.min(colW - 2, LANE_H - 4));
        c.fillRect(x + (colW - s) / 2, y0 + (LANE_H - s) / 2, s, s);
      }
    }
    c.globalAlpha = 1;

    // Playhead — the indicator's angle. Red while recording.
    const rec = this.rec;
    const px = Math.round(LABEL_W + pos * colW) + 0.5;
    c.strokeStyle = rec ? REC : playing ? INK : DIM;
    c.lineWidth = rec ? 2 : 1;
    c.beginPath();
    c.moveTo(px, 0);
    c.lineTo(px, this.hpx);
    c.stroke();
    c.lineWidth = 1;

    if (rec) {
      if (rec.phase === 'count') {
        c.fillStyle = 'rgba(0,0,0,0.6)';
        c.fillRect(LABEL_W, RULER_H, W - LABEL_W, this.hpx - RULER_H);
        c.fillStyle = REC;
        c.font = '28px "DM Mono", ui-monospace, monospace';
        c.textAlign = 'center';
        c.fillText(String(rec.count), LABEL_W + (W - LABEL_W) / 2, this.hpx / 2);
      }
      // Input level, so the singer can see the microphone hears them.
      const lv = Math.min(1, rec.level * 12);
      c.fillStyle = REC;
      c.fillRect(0, this.hpx - 4, LABEL_W * lv, 3);
    }
  }
}
