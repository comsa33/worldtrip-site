import { useSyncExternalStore } from 'react';

/**
 * The page's sound, made here in Web Audio rather than played from a file: a
 * low chord held under the whole journey, and one note each time the dot lands
 * on a stop — pitched by the city's latitude, north higher, the equator low, on
 * a D major pentatonic so no two landings clash. While the dot is in the air
 * the chord opens and a little air comes in; it closes as the dot lands.
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
const SCALE = [146.83, 164.81, 185.0, 220.0, 246.94, 293.66, 329.63, 369.99, 440.0, 493.88, 587.33];
/** 10°S at the bottom of the scale, 40°N at the top */
const noteFor = (lat: number) =>
  SCALE[
    Math.max(0, Math.min(SCALE.length - 1, Math.round(((lat + 10) / 50) * (SCALE.length - 1))))
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
  air: GainNode;
  echo: GainNode;
  analyser: AnalyserNode;
};
let engine: Engine | null = null;
let flying = false;
let ducked = false;
let offTimer = 0;
let lastNote = -1;

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

  // the chord: D, D, A, F♯, each a pair a few cents apart, under a filter that breathes
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
  const voices = [73.42, 146.83, 220.0, 369.99].flatMap((f, i) =>
    [-6, 5].map((cents) => {
      const o = ctx.createOscillator();
      o.type = i === 0 ? 'sine' : 'triangle';
      o.frequency.value = f;
      o.detune.value = cents;
      o.connect(chord);
      return o;
    })
  );

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

  [breath, noise, ...voices].forEach((n) => n.start());
  return { ctx, master, duck, chord, air, echo, analyser };
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

/** the dot has landed on a stop at this latitude */
export function landAt(lat: number) {
  if (!engine || !wanted || engine.master.gain.value === 0) return;
  const { ctx, master, echo } = engine;
  const t = ctx.currentTime;
  if (t - lastNote < NOTE_GAP_S) return;
  lastNote = t;
  const freq = noteFor(lat);
  const len = 2.6;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(0.16, t + 0.012);
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
