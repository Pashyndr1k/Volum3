import { LANES, STYLES, STEPS, BAR, chordOf, melodyNotes, NOTE_NAMES } from './patterns.js';
import { VOICE } from './music.js';
import { pairFor } from './palette.js';

/*
  The timeline: one orbit of the pattern laid flat — 64 sixteenths across, a thin row per part.
  Kept small and quiet on purpose: marks in one ink, bar lines only, and only the lanes that have
  something in them. The one bit of colour is each lane's letter, in the colour its cubes take.
  The playhead is the indicator's angle.

  Click a mark to remove it, an empty spot to add one, a lane's letter to mute it. The header:
  the style name (click for the next style), NEW rolls a new pattern, HUM records one.
*/

const LABEL_W = 14;
const LANE_H = 7;
const MELODY_H = 28;
const GAP = 2;
const INK = '#DDDACA';
const MARK = '#8a887f';
const FAINT = '#262624';
const REC = '#F74227';
const LETTER = { melody: 'M', chord: 'C', bass: 'B', perc: 'P', open: 'O', hat: 'H', snare: 'S', kick: 'K' };

export class Timeline {
  constructor(root, handlers) {
    this.root = root;
    this.h = handlers;
    this.pattern = null;
    this.muted = new Set();
    this.status = '';
    this.rec = null; // { phase: 'count' | 'rec', count, level }
    this.lanes = [];
    this.head = document.createElement('div');
    this.head.className = 'tl-head';
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'tl-canvas';
    root.append(this.head, this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.canvas.addEventListener('pointerdown', (e) => this.click(e));
    window.addEventListener('resize', () => this.resize());
  }

  get height() {
    return this.root.hidden ? 0 : this.root.getBoundingClientRect().height + 16;
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = this.canvas.clientWidth || 600;
    const h = this.lanes.reduce((sum, id) => sum + this.laneH(id) + GAP, 0);
    this.canvas.style.height = `${h}px`;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = w;
    this.hpx = h;
  }

  setPattern(p) {
    this.pattern = p;
    // Only the lanes in use (the melody always), in the usual order: tune on top, kick at the bottom.
    const used = new Set(p.events.map((e) => e.lane));
    this.lanes = LANES.map((l) => l.id).filter((id) => id === 'melody' || used.has(id));
    this.renderHead();
    this.resize();
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
    };
    const style = STYLES.find((s) => s.id === p?.style);
    word(style ? style.label : 'HUMMED', 'word on', () => this.h.onNextStyle(), 'Next style (a new pattern in it)');
    word('NEW', 'word on', () => this.h.onRandom(), 'A new rhythm and melody in this style');
    word(this.rec ? 'STOP' : 'HUM', `word ${this.rec ? 'rec' : 'on'}`, () => this.h.onHum(), 'Hum a melody: one bar count-in, then four bars');
    word('PRESET', 'word dim', () => this.h.onPreset(), 'Back to the default groove');
    const info = this.status || (p ? `${NOTE_NAMES[p.root]} ${p.scale === 'major' ? 'MAJOR' : p.scale === 'minor' ? 'MINOR' : p.scale.toUpperCase()}` : '');
    word(info, `status${this.rec ? ' rec' : ''}`);
  }

  laneY(id) {
    let y = 0;
    for (const l of this.lanes) {
      if (l === id) return y;
      y += this.laneH(l) + GAP;
    }
    return -1;
  }

  laneH(id) {
    return id === 'melody' ? MELODY_H : LANE_H;
  }

  laneAt(y) {
    for (const id of this.lanes) {
      const y0 = this.laneY(id);
      if (y >= y0 - GAP / 2 && y < y0 + this.laneH(id) + GAP / 2) return id;
    }
    return null;
  }

  melodyRange() {
    const m = this.pattern.events.filter((e) => e.lane === 'melody').map((e) => e.midi);
    const lo = Math.min(60, ...m) - 1;
    const hi = Math.max(lo + 14, ...m) + 1;
    return [lo, hi];
  }

  click(e) {
    if (!this.pattern || this.rec) return;
    const r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const lane = this.laneAt(y);
    if (!lane) return;
    if (x < LABEL_W) {
      this.muted.has(lane) ? this.muted.delete(lane) : this.muted.add(lane);
      return;
    }
    const step = Math.floor(((x - LABEL_W) / (this.w - LABEL_W)) * STEPS);
    if (step < 0 || step >= STEPS) return;
    const p = this.pattern;
    const covering = p.events.findIndex((ev) => ev.lane === lane && step >= ev.step && step < ev.step + (ev.len ?? 1));
    let events;
    if (covering >= 0) events = p.events.filter((_, k) => k !== covering);
    else {
      const deg = p.progression[Math.floor(step / BAR)];
      let add;
      if (lane === 'melody') {
        const [lo, hi] = this.melodyRange();
        const midi = hi - ((y - this.laneY('melody')) / MELODY_H) * (hi - lo);
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

  draw(position, playing) {
    const p = this.pattern;
    const c = this.ctx;
    const W = this.w;
    if (!p || !W) return;
    const colW = (W - LABEL_W) / STEPS;
    c.clearRect(0, 0, W, this.hpx);
    const pos = ((position % STEPS) + STEPS) % STEPS;

    // Bar lines only.
    c.fillStyle = FAINT;
    for (let b = 0; b <= 4; b++) c.fillRect(Math.round(LABEL_W + b * BAR * colW), 0, 1, this.hpx);

    // Lane letters, in the colour of the lane's cubes; dimmed when muted.
    c.font = '9px "DM Mono", ui-monospace, monospace';
    c.textBaseline = 'middle';
    c.textAlign = 'left';
    for (const id of this.lanes) {
      const voice = VOICE.get(p.voices[id]);
      c.fillStyle = this.muted.has(id) ? FAINT : pairFor(voice ? voice.index : 0).bg;
      c.fillText(LETTER[id], 0, this.laneY(id) + (id === 'melody' ? 5 : LANE_H / 2 + 0.5));
    }

    const [lo, hi] = this.melodyRange();
    for (const e of p.events) {
      const y0 = this.laneY(e.lane);
      if (y0 < 0) continue;
      const len = e.len ?? 1;
      const x = LABEL_W + e.step * colW;
      const active = playing && pos >= e.step && pos < e.step + Math.max(0.9, len);
      c.globalAlpha = this.muted.has(e.lane) ? 0.15 : active ? 1 : 0.45 + 0.4 * (e.vel ?? 0.8);
      c.fillStyle = active ? INK : MARK;
      if (e.lane === 'melody') {
        const y = y0 + (1 - (e.midi - lo) / (hi - lo)) * (MELODY_H - 3);
        c.fillRect(x + 0.5, y, Math.max(2, len * colW - 1), 3);
      } else if (e.lane === 'bass' || e.lane === 'chord') {
        c.fillRect(x + 0.5, y0 + 2, Math.max(2, len * colW - 1), LANE_H - 4);
      } else {
        const s = Math.min(colW - 1.5, LANE_H - 2);
        c.fillRect(x + (colW - s) / 2, y0 + (LANE_H - s) / 2, s, s);
      }
    }
    c.globalAlpha = 1;

    c.fillStyle = this.rec ? REC : playing ? INK : MARK;
    c.fillRect(Math.round(LABEL_W + pos * colW), 0, 1, this.hpx);
    if (this.rec) {
      c.fillStyle = REC;
      c.fillRect(LABEL_W, this.hpx - 1, (W - LABEL_W) * Math.min(1, this.rec.level * 12), 1);
    }
  }
}
