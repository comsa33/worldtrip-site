import { useSyncExternalStore } from 'react';

import type { ScoreNote } from './journeyScore';

/**
 * The page's sound, made here in Web Audio rather than played from a file. Two
 * songs share one tune — the journey's own (journeyScore.ts), a note for every
 * stop, under a chord that changes with the country — and the way the reader is
 * travelling picks between them:
 *
 * - calm, while they move by hand: a low chord held, and the stop's note struck
 *   the moment the dot lands. In the air the chord opens and a little air comes in.
 * - bright, while the journey plays itself: 116 BPM, a bass on the chord's root,
 *   hats on the off-beats, the chord running in eighths above; the stop's note
 *   falls on the next eighth, a new country's chord waits for the next bar, and
 *   in the air the hats run in sixteenths.
 *
 * Starting or stopping the autoplay crosses from one to the other over a bar or
 * so. Nothing plays until the reader turns it on, and a reader who did is
 * remembered in this browser; the sound then waits for their first touch or
 * key, since a browser will not let a page make sound before one. A photo book
 * open over the globe takes it down to half; a hidden tab takes it away.
 */

export type Mood = 'calm' | 'bright';

const KEY = 'sound';
/** in and out, never a cut */
const IN_S = 0.8;
const OUT_S = 0.6;
const LEVEL = 0.7;
/** landings closer together than this are one landing — a fast hand is not a chord */
const NOTE_GAP_S = 0.3;
/** D major pentatonic, D3 to D5 — the steps a ScoreNote names */
const SCALE = [146.83, 164.81, 185.0, 220.0, 246.94, 293.66, 329.63, 369.99, 440.0, 493.88, 587.33];
/** D, B minor, G, A — voiced low, each under every note of the scale */
const CHORDS = [
  [73.42, 146.83, 220.0, 369.99],
  [61.74, 123.47, 185.0, 293.66],
  [98.0, 146.83, 246.94, 293.66],
  [55.0, 110.0, 164.81, 277.18],
];
const BPM = 116;
const SIXTEENTH = 60 / BPM / 4;

const readOn = () => {
  try {
    return localStorage.getItem(KEY) === 'on';
  } catch {
    return false;
  }
};

let wanted = readOn();
let mood: Mood = 'calm';
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

type Song = {
  out: GainNode;
  land(note: ScoreNote): void;
  fly(up: boolean): void;
  stop(): void;
};

type Engine = {
  ctx: AudioContext;
  master: GainNode;
  duck: GainNode;
  echo: GainNode;
  analyser: AnalyserNode;
  noise: AudioBuffer;
  song: Song;
};
let engine: Engine | null = null;
let flying = false;
let ducked = false;
let offTimer = 0;
let lastNote = -1;
let chordIndex = 0;

type Layer = { gain: GainNode; oscs: OscillatorNode[]; index: number };

/** one chord's voices, each a pair a few cents apart, faded in */
function chordLayer(ctx: AudioContext, into: AudioNode, index: number): Layer {
  const gain = ctx.createGain();
  gain.gain.value = 0;
  gain.connect(into);
  gain.gain.setTargetAtTime(1, ctx.currentTime, 0.6);
  const oscs = CHORDS[index].flatMap((f, i) =>
    [-6, 5].map((cents) => {
      const o = ctx.createOscillator();
      o.type = i === 0 ? 'sine' : 'triangle';
      o.frequency.value = f;
      o.detune.value = cents;
      o.connect(gain);
      o.start();
      return o;
    })
  );
  return { gain, oscs, index };
}

/** the chord crossfades into the next one rather than jumping */
function nextLayer(ctx: AudioContext, into: AudioNode, old: Layer, index: number): Layer {
  if (old.index === index) return old;
  retire(ctx, old);
  return chordLayer(ctx, into, index);
}

function retire(ctx: AudioContext, layer: Layer) {
  layer.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.6);
  window.setTimeout(() => {
    layer.oscs.forEach((o) => o.stop());
    layer.gain.disconnect();
  }, 4000);
}

function noiseSource(e: { ctx: AudioContext; noise: AudioBuffer }) {
  const src = e.ctx.createBufferSource();
  src.buffer = e.noise;
  return src;
}

/** a struck note: a sine and its octave, into the song and the shared echo */
function strike(
  e: Engine,
  out: AudioNode,
  freq: number,
  peak: number,
  len: number,
  at = 0,
  type: OscillatorType = 'sine'
) {
  const { ctx, echo } = e;
  const t = Math.max(at, ctx.currentTime);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(peak, t + 0.012);
  env.gain.exponentialRampToValueAtTime(0.0001, t + len);
  const body = ctx.createOscillator();
  body.type = type;
  body.frequency.value = freq;
  const shine = ctx.createOscillator();
  shine.type = 'triangle';
  shine.frequency.value = freq * 2;
  const shineGain = ctx.createGain();
  shineGain.gain.value = 0.18;
  body.connect(env);
  shine.connect(shineGain);
  shineGain.connect(env);
  env.connect(out);
  env.connect(echo);
  body.start(t);
  shine.start(t);
  body.stop(t + len + 0.05);
  shine.stop(t + len + 0.05);
}

function calmSong(e: Engine, out: GainNode): Song {
  const { ctx } = e;
  const CUTOFF = { rest: 620, flying: 2200 };
  // the chord, under a filter that breathes
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = flying ? CUTOFF.flying : CUTOFF.rest;
  filter.Q.value = 0.6;
  const level = ctx.createGain();
  level.gain.value = 0.05;
  filter.connect(level);
  level.connect(out);
  const breath = ctx.createOscillator();
  breath.frequency.value = 0.06;
  const breathAmt = ctx.createGain();
  breathAmt.gain.value = 220;
  breath.connect(breathAmt);
  breathAmt.connect(filter.frequency);
  breath.start();
  let layer = chordLayer(ctx, filter, chordIndex);
  // the air in flight: noise through a wide band, silent on the ground
  const noise = noiseSource(e);
  noise.loop = true;
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 900;
  band.Q.value = 0.7;
  const air = ctx.createGain();
  air.gain.value = flying ? 0.02 : 0;
  noise.connect(band);
  band.connect(air);
  air.connect(out);
  noise.start();
  return {
    out,
    land(note) {
      layer = nextLayer(ctx, filter, layer, note.chord);
      strike(e, out, SCALE[note.step], 0.16, 2.6);
      if (note.downbeat) strike(e, out, CHORDS[note.chord][1] * 2, 0.07, 3.4);
    },
    fly(up) {
      const t = ctx.currentTime;
      filter.frequency.setTargetAtTime(up ? CUTOFF.flying : CUTOFF.rest, t, up ? 0.3 : 0.5);
      air.gain.setTargetAtTime(up ? 0.02 : 0, t, up ? 0.3 : 0.25);
    },
    stop() {
      layer.oscs.forEach((o) => o.stop());
      breath.stop();
      noise.stop();
    },
  };
}

function brightSong(e: Engine, out: GainNode): Song {
  const { ctx } = e;
  const padFilter = ctx.createBiquadFilter();
  padFilter.type = 'lowpass';
  padFilter.frequency.value = 620;
  const padLevel = ctx.createGain();
  padLevel.gain.value = 0.025;
  padFilter.connect(padLevel);
  padLevel.connect(out);
  let layer = chordLayer(ctx, padFilter, chordIndex);
  let chord = chordIndex;
  let pending: number | null = null;
  const arpFilter = ctx.createBiquadFilter();
  arpFilter.type = 'lowpass';
  arpFilter.frequency.value = flying ? 4200 : 1800;
  arpFilter.connect(out);
  const ARP = [0, 1, 2, 3, 2, 1, 2, 3];
  const t0 = ctx.currentTime + 0.05;
  let step = 0;
  let next = t0;

  const hat = (t: number, peak: number) => {
    const src = noiseSource(e);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
    src.connect(hp);
    hp.connect(g);
    g.connect(out);
    src.start(t, Math.random());
    src.stop(t + 0.06);
  };
  const kick = (t: number) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.18);
    g.gain.setValueAtTime(0.32, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
    o.connect(g);
    g.connect(out);
    o.start(t);
    o.stop(t + 0.3);
  };
  const pluck = (t: number, f: number, peak: number, len: number, into: AudioNode, cutoff = 0) => {
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = f;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    if (cutoff) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = cutoff;
      o.connect(lp);
      lp.connect(g);
    } else o.connect(g);
    g.connect(into);
    o.start(t);
    o.stop(t + len + 0.02);
  };

  // look a little ahead and put the next sixteenths on the clock
  const schedule = () => {
    while (next < ctx.currentTime + 0.12) {
      const s = step % 16;
      if (s === 0 && pending !== null) {
        layer = nextLayer(ctx, padFilter, layer, pending);
        chord = pending;
        pending = null;
      }
      const low = CHORDS[chord][0];
      const root = low < 70 ? low * 2 : low;
      if (s === 0 || s === 8) kick(next);
      if (s % 4 === 2) hat(next, 0.05);
      if (flying && s % 2 === 1) hat(next, 0.025);
      if (s === 0 || s === 6 || s === 10) pluck(next, root, 0.16, s === 0 ? 0.32 : 0.2, out, 500);
      if (s === 14) pluck(next, root * 1.5, 0.16, 0.12, out, 500);
      if (s % 2 === 0) {
        const tone = CHORDS[chord][1 + (ARP[(s / 2) % 8] % 3)] * 2;
        pluck(next, tone, 0.045, 0.22, arpFilter);
      }
      step++;
      next += SIXTEENTH;
    }
  };
  const clock = window.setInterval(schedule, 25);
  schedule();

  return {
    out,
    land(note) {
      const now = ctx.currentTime;
      const eighth = SIXTEENTH * 2;
      const at = now + (eighth - ((now - t0) % eighth));
      if (note.chord !== chord) pending = note.chord;
      strike(e, out, SCALE[note.step] * 2, 0.12, 1.2, at, 'triangle');
      if (note.downbeat) strike(e, out, CHORDS[note.chord][1] * 2, 0.06, 1.6, at);
    },
    fly(up) {
      arpFilter.frequency.setTargetAtTime(up ? 4200 : 1800, ctx.currentTime, 0.3);
    },
    stop() {
      window.clearInterval(clock);
      layer.oscs.forEach((o) => o.stop());
    },
  };
}

function playSong(e: Engine, which: Mood): Song {
  const out = e.ctx.createGain();
  out.gain.value = 0;
  out.connect(e.master);
  out.gain.setTargetAtTime(1, e.ctx.currentTime, 0.5);
  return which === 'bright' ? brightSong(e, out) : calmSong(e, out);
}

function build(): Engine {
  const Ctx =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  const master = ctx.createGain();
  master.gain.value = 0;
  const duck = ctx.createGain();
  duck.gain.value = ducked ? 0.5 : 1;
  const comp = ctx.createDynamicsCompressor();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  master.connect(duck);
  duck.connect(comp);
  comp.connect(analyser);
  analyser.connect(ctx.destination);

  // one echo the notes share, so a landing has somewhere to go — three sixteenths long
  const echo = ctx.createGain();
  const delay = ctx.createDelay(1);
  delay.delayTime.value = SIXTEENTH * 3;
  const feedback = ctx.createGain();
  feedback.gain.value = 0.32;
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = 2400;
  const wet = ctx.createGain();
  wet.gain.value = 0.38;
  echo.connect(delay);
  delay.connect(tone);
  tone.connect(feedback);
  feedback.connect(delay);
  tone.connect(wet);
  wet.connect(master);

  const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

  const e = { ctx, master, duck, echo, analyser, noise } as Engine;
  e.song = playSong(e, mood);
  return e;
}

function fadeTo(e: Engine, to: number, seconds: number) {
  const t = e.ctx.currentTime;
  e.master.gain.cancelScheduledValues(t);
  e.master.gain.setValueAtTime(e.master.gain.value, t);
  e.master.gain.linearRampToValueAtTime(to, t + seconds);
}

/** Make it sound, if it is wanted and the page may. Must run inside a user gesture the first time. */
function start() {
  if (!wanted || document.hidden) return;
  engine ??= build();
  window.clearTimeout(offTimer);
  void engine.ctx.resume();
  fadeTo(engine, LEVEL, IN_S);
}

function stop() {
  if (!engine) return;
  const e = engine;
  fadeTo(e, 0, OUT_S);
  window.clearTimeout(offTimer);
  offTimer = window.setTimeout(() => void e.ctx.suspend(), OUT_S * 1000 + 100);
}

export function setSound(on: boolean) {
  wanted = on;
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    /* private mode: this visit only */
  }
  if (on) start();
  else stop();
  emit();
}

/** how the reader is travelling: by hand (calm), or letting it play (bright) */
export function setMood(next: Mood) {
  if (next === mood) return;
  mood = next;
  emit();
  if (!engine) return;
  const e = engine;
  const old = e.song;
  old.out.gain.setTargetAtTime(0, e.ctx.currentTime, 0.5);
  window.setTimeout(() => {
    old.stop();
    window.setTimeout(() => old.out.disconnect(), 4500);
  }, 3000);
  e.song = playSong(e, next);
}

/** the dot is in the air */
export function setFlying(next: boolean) {
  if (next === flying) return;
  flying = next;
  engine?.song.fly(next);
}

/**
 * The dot has landed on a stop: its note, over its country's chord. The first
 * stop in a country is a new bar, and the chord's root sounds under the note.
 */
export function landOn(note: ScoreNote) {
  chordIndex = note.chord;
  if (!engine || !wanted || engine.master.gain.value === 0) return;
  const t = engine.ctx.currentTime;
  if (t - lastNote < NOTE_GAP_S) return;
  lastNote = t;
  engine.song.land(note);
}

/** something is laid over the globe that the reader is looking at instead */
export function setDucked(next: boolean) {
  if (next === ducked) return;
  ducked = next;
  if (!engine) return;
  engine.duck.gain.setTargetAtTime(next ? 0.5 : 1, engine.ctx.currentTime, 0.25);
}

/** the sound as it is now, for the mark to draw; null while there is none */
export function soundAnalyser(): AnalyserNode | null {
  return engine && wanted ? engine.analyser : null;
}

if (typeof window !== 'undefined') {
  // remembered on: the first touch or key of this visit brings it in
  const firstGesture = () => {
    if (wanted && !engine) start();
    ['pointerdown', 'keydown', 'touchend'].forEach((t) =>
      window.removeEventListener(t, firstGesture)
    );
  };
  ['pointerdown', 'keydown', 'touchend'].forEach((t) =>
    window.addEventListener(t, firstGesture, { passive: true })
  );
  document.addEventListener('visibilitychange', () => {
    if (!engine || !wanted) return;
    if (document.hidden) stop();
    else start();
  });
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
const snapshot = () => wanted;
const moodSnapshot = () => mood;

/** whether the reader has the sound on (it may still be waiting for their first touch) */
export function useSoundOn(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}

/** which of the two songs is playing, or would be */
export function useSoundMood(): Mood {
  return useSyncExternalStore(subscribe, moodSnapshot, (): Mood => 'calm');
}
