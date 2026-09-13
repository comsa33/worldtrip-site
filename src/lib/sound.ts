import { useSyncExternalStore } from 'react';

import type { ScoreNote } from './journeyScore';

/**
 * The page's sound, made here in Web Audio rather than played from a file: a
 * low chord held under the whole journey, and one note each time the dot lands
 * on a stop. The notes are the journey's own tune (journeyScore.ts) — a stop
 * always sounds its note, and the stops in order make a melody — and the chord
 * under them changes with the country. While the dot is in the air the chord
 * opens and a little air comes in; it closes as the dot lands.
 *
 * Nothing plays until the reader turns it on, and a reader who did is
 * remembered in this browser; the sound then waits for their first touch or
 * key, since a browser will not let a page make sound before one. A photo book
 * open over the globe takes it down to half; a hidden tab takes it away.
 */

const KEY = 'sound';
/** in and out, never a cut */
const IN_S = 0.8;
const OUT_S = 0.6;
const LEVEL = 0.7;
/** the chord's filter, at rest and in the air */
const CUTOFF = { rest: 620, flying: 2200 };
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

const readOn = () => {
  try {
    return localStorage.getItem(KEY) === 'on';
  } catch {
    return false;
  }
};

let wanted = readOn();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

type Engine = {
  ctx: AudioContext;
  master: GainNode;
  duck: GainNode;
  chord: BiquadFilterNode;
  layer: { gain: GainNode; oscs: OscillatorNode[]; index: number };
  air: GainNode;
  echo: GainNode;
  analyser: AnalyserNode;
};
let engine: Engine | null = null;
let flying = false;
let ducked = false;
let offTimer = 0;
let lastNote = -1;
let chordIndex = 0;

/** one chord's voices, each a pair a few cents apart, into the chord's filter */
function chordLayer(ctx: AudioContext, into: AudioNode, index: number) {
  const gain = ctx.createGain();
  gain.gain.value = 0;
  gain.connect(into);
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

  // one echo the notes share, so a landing has somewhere to go
  const echo = ctx.createGain();
  const delay = ctx.createDelay(1);
  delay.delayTime.value = 0.38;
  const feedback = ctx.createGain();
  feedback.gain.value = 0.33;
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = 2400;
  const wet = ctx.createGain();
  wet.gain.value = 0.4;
  echo.connect(delay);
  delay.connect(tone);
  tone.connect(feedback);
  feedback.connect(delay);
  tone.connect(wet);
  wet.connect(master);

  // the chord, under a filter that breathes
  const chord = ctx.createBiquadFilter();
  chord.type = 'lowpass';
  chord.frequency.value = flying ? CUTOFF.flying : CUTOFF.rest;
  chord.Q.value = 0.6;
  const chordGain = ctx.createGain();
  chordGain.gain.value = 0.05;
  chord.connect(chordGain);
  chordGain.connect(master);
  const breath = ctx.createOscillator();
  breath.frequency.value = 0.06;
  const breathAmt = ctx.createGain();
  breathAmt.gain.value = 220;
  breath.connect(breathAmt);
  breathAmt.connect(chord.frequency);
  // the air in flight: noise through a wide band, silent on the ground
  const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const noise = ctx.createBufferSource();
  noise.buffer = buf;
  noise.loop = true;
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 900;
  band.Q.value = 0.7;
  const air = ctx.createGain();
  air.gain.value = flying ? 0.02 : 0;
  noise.connect(band);
  band.connect(air);
  air.connect(master);

  [breath, noise].forEach((n) => n.start());
  const layer = chordLayer(ctx, chord, chordIndex);
  layer.gain.gain.value = 1;
  return { ctx, master, duck, chord, layer, air, echo, analyser };
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

/** the dot is in the air */
export function setFlying(next: boolean) {
  if (next === flying) return;
  flying = next;
  if (!engine) return;
  const t = engine.ctx.currentTime;
  engine.chord.frequency.setTargetAtTime(next ? CUTOFF.flying : CUTOFF.rest, t, next ? 0.3 : 0.5);
  engine.air.gain.setTargetAtTime(next ? 0.02 : 0, t, next ? 0.3 : 0.25);
}

/** a chord crossfades into the next one rather than jumping */
function setChord(e: Engine, index: number) {
  chordIndex = index;
  if (e.layer.index === index) return;
  const t = e.ctx.currentTime;
  const old = e.layer;
  old.gain.gain.setTargetAtTime(0, t, 0.6);
  window.setTimeout(() => {
    old.oscs.forEach((o) => o.stop());
    old.gain.disconnect();
  }, 4000);
  e.layer = chordLayer(e.ctx, e.chord, index);
  e.layer.gain.gain.setTargetAtTime(1, t, 0.6);
}

function strike(e: Engine, freq: number, peak: number, len: number) {
  const { ctx, master, echo } = e;
  const t = ctx.currentTime;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(peak, t + 0.012);
  env.gain.exponentialRampToValueAtTime(0.0001, t + len);
  const body = ctx.createOscillator();
  body.frequency.value = freq;
  const shine = ctx.createOscillator();
  shine.type = 'triangle';
  shine.frequency.value = freq * 2;
  const shineGain = ctx.createGain();
  shineGain.gain.value = 0.18;
  body.connect(env);
  shine.connect(shineGain);
  shineGain.connect(env);
  env.connect(master);
  env.connect(echo);
  body.start(t);
  shine.start(t);
  body.stop(t + len + 0.05);
  shine.stop(t + len + 0.05);
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
  setChord(engine, note.chord);
  strike(engine, SCALE[note.step], 0.16, 2.6);
  if (note.downbeat) strike(engine, CHORDS[note.chord][1] * 2, 0.07, 3.4);
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

/** whether the reader has the sound on (it may still be waiting for their first touch) */
export function useSoundOn(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
