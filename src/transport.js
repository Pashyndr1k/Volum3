import { now, ctx, setTempo } from './audio.js';

/*
  SQNCR's "two clocks": a 20 ms timer books every step that falls within the next 140 ms on the
  audio clock, so notes land sample-accurately while the picture runs on requestAnimationFrame.
  The orbit is the loop: one revolution of the indicator is `steps` sixteenths.
*/

const TICK_MS = 20;
const LOOKAHEAD = 0.14;

export class Transport {
  constructor({ bpm, steps, swing = 0, onStep }) {
    this.bpm = bpm;
    this.steps = steps;
    this.swing = swing;
    this.onStep = onStep;
    this.playing = false;
    this.startedAt = 0;
    this.nextStep = 0;
    this.pos = 0; // fractional steps since start, frozen while stopped
    this.timer = 0;
  }

  stepSec() {
    return 60 / this.bpm / 4;
  }

  orbitSec() {
    return this.steps * this.stepSec();
  }

  // Swing delays odd sixteenths, as in SQNCR (`timeOf`). The indicator itself never swings.
  timeOf(step) {
    const t = this.startedAt + step * this.stepSec();
    return step % 2 === 1 ? t + this.swing * this.stepSec() * 1.2 : t;
  }

  position(t = now()) {
    return this.playing ? (t - this.startedAt) / this.stepSec() : this.pos;
  }

  // Indicator angle, radians, in [0, 2π).
  angle(t = now()) {
    const p = this.position(t) / this.steps;
    return (p - Math.floor(p)) * Math.PI * 2;
  }

  start() {
    if (this.playing || !ctx()) return;
    setTempo(this.bpm);
    this.startedAt = now() + 0.06 - this.pos * this.stepSec();
    this.nextStep = Math.ceil(this.pos);
    this.playing = true;
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.tick();
  }

  // Start with step 0 landing exactly on `time` (audio clock) — the hum recorder needs the grid
  // to begin precisely when its window does.
  startAt(time) {
    if (!ctx()) return;
    this.stop();
    setTempo(this.bpm);
    this.pos = 0;
    this.startedAt = time;
    this.nextStep = 0;
    this.playing = true;
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.tick();
  }

  stop() {
    if (!this.playing) return;
    this.pos = this.position();
    this.playing = false;
    clearInterval(this.timer);
  }

  setBpm(bpm) {
    const p = this.position();
    this.bpm = bpm;
    setTempo(bpm);
    if (this.playing) {
      this.startedAt = now() - p * this.stepSec();
      this.nextStep = Math.ceil(p);
    } else this.pos = p;
  }

  tick() {
    const horizon = now() + LOOKAHEAD;
    while (this.timeOf(this.nextStep) < horizon) {
      this.onStep(this.nextStep, this.timeOf(this.nextStep));
      this.nextStep++;
    }
  }
}
