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
 * - orbit, while the reader looks around the globe: no beat and no landings,
 *   an open chord that drifts, and now and then a high note from the scale,
 *   as far apart as stars. Turning the globe by hand stirs it — the faster the
 *   hand, the more often a note glints and the more air comes through.
 *
 * - album, while the reader looks through the photo book: 72 BPM and no drums,
 *   a felt-piano figure turning over the chord in eighths, a warm pad under it,
 *   a low root on each bar and a little tape hiss — music to look at pictures
 *   by. It still belongs to the journey: moving into another stop's photos sounds
 *   that stop's note on the next eighth, and its country's chord takes over at
 *   the next bar. Left on one stop, the chord leans to its neighbour and back
 *   every two bars so it never stands still.
 *
 * Changing how they travel crosses from one song to the next over a bar or so. Nothing plays until the reader turns it on, and a reader who did is
 * remembered in this browser; the sound then waits for their first touch or
 * key, since a browser will not let a page make sound before one. A hidden tab
 * takes it away.
 */

export type Mood = 'calm' | 'bright' | 'orbit' | 'album';

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
  /** how fast the hand is turning the globe, in radians a second */
  turn?(speed: number): void;
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

function orbitSong(e: Engine, out: GainNode): Song {
  const { ctx } = e;
  // D with the fifth and the ninth, spread wide, nothing to resolve
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 900;
  filter.Q.value = 0.5;
  const level = ctx.createGain();
  level.gain.value = 0;
  level.gain.setTargetAtTime(0.045, ctx.currentTime, 1.5);
  filter.connect(level);
  level.connect(out);
  const drift = ctx.createOscillator();
  drift.frequency.value = 0.03;
  const driftAmt = ctx.createGain();
  driftAmt.gain.value = 400;
  drift.connect(driftAmt);
  driftAmt.connect(filter.frequency);
  const oscs = [73.42, 110.0, 164.81, 220.0, 329.63].flatMap((f, i) =>
    [-7, 6].map((cents) => {
      const o = ctx.createOscillator();
      o.type = i < 2 ? 'sine' : 'triangle';
      o.frequency.value = f;
      o.detune.value = cents;
      o.connect(filter);
      return o;
    })
  );
  // the air the hand moves
  const noise = noiseSource(e);
  noise.loop = true;
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 1400;
  band.Q.value = 0.6;
  const air = ctx.createGain();
  air.gain.value = 0;
  noise.connect(band);
  band.connect(air);
  air.connect(out);
  [drift, noise, ...oscs].forEach((n) => n.start());

  // a high note now and then, never the same one twice
  const HIGH = [587.33, 659.25, 739.99, 880.0, 987.77, 1174.66];
  let last = -1;
  let stir = 0;
  let timer = 0;
  const glint = () => {
    let i = Math.floor(Math.random() * HIGH.length);
    if (i === last) i = (i + 1 + Math.floor(Math.random() * (HIGH.length - 1))) % HIGH.length;
    last = i;
    strike(e, out, HIGH[i], 0.05, 3.6);
    const gap = 4200 - 2400 * stir + Math.random() * 1600;
    timer = window.setTimeout(glint, Math.max(500, gap));
  };
  timer = window.setTimeout(glint, 1400);

  return {
    out,
    land() {},
    fly() {},
    turn(speed) {
      stir = Math.min(1, speed / 1.5);
      const t = ctx.currentTime;
      air.gain.setTargetAtTime(0.03 * stir, t, stir > 0 ? 0.12 : 0.6);
      band.frequency.setTargetAtTime(1000 + 1600 * stir, t, 0.2);
    },
    stop() {
      window.clearTimeout(timer);
      [drift, noise, ...oscs].forEach((n) => n.stop());
    },
  };
}

const ALBUM_BPM = 72;
const ALBUM_EIGHTH = 60 / ALBUM_BPM / 2;

function albumSong(e: Engine, out: GainNode): Song {
  const { ctx } = e;
  // the pad: the chord, low and warm, breathing slowly
  const padFilter = ctx.createBiquadFilter();
  padFilter.type = 'lowpass';
  padFilter.frequency.value = 760;
  padFilter.Q.value = 0.4;
  const padLevel = ctx.createGain();
  padLevel.gain.value = 0;
  padLevel.gain.setTargetAtTime(0.032, ctx.currentTime, 1.2);
  padFilter.connect(padLevel);
  padLevel.connect(out);
  const breath = ctx.createOscillator();
  breath.frequency.value = 0.045;
  const breathAmt = ctx.createGain();
  breathAmt.gain.value = 180;
  breath.connect(breathAmt);
  breathAmt.connect(padFilter.frequency);
  breath.start();
  let home = chordIndex;
  let chord = home;
  let layer = chordLayer(ctx, padFilter, chord);
  let pending: number | null = null;

  // the piano's room: everything it plays goes through one soft lowpass
  const keys = ctx.createBiquadFilter();
  keys.type = 'lowpass';
  keys.frequency.value = 1900;
  keys.Q.value = 0.3;
  keys.connect(out);

  // tape: a hiss too quiet to notice until it stops
  const hiss = noiseSource(e);
  hiss.loop = true;
  const hissTone = ctx.createBiquadFilter();
  hissTone.type = 'lowpass';
  hissTone.frequency.value = 2800;
  const hissLevel = ctx.createGain();
  hissLevel.gain.value = 0.0045;
  hiss.connect(hissTone);
  hissTone.connect(hissLevel);
  hissLevel.connect(out);
  hiss.start();

  /** a felt-piano note: soft attack, a long fall, a faint octave */
  const felt = (t: number, f: number, peak: number, len: number) => {
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(peak, t + 0.018);
    env.gain.exponentialRampToValueAtTime(peak * 0.35, t + 0.25);
    env.gain.exponentialRampToValueAtTime(0.0001, t + len);
    const body = ctx.createOscillator();
    body.type = 'sine';
    body.frequency.value = f;
    const edge = ctx.createOscillator();
    edge.type = 'triangle';
    edge.frequency.value = f * 2;
    const edgeLevel = ctx.createGain();
    edgeLevel.gain.value = 0.12;
    body.connect(env);
    edge.connect(edgeLevel);
    edgeLevel.connect(env);
    env.connect(keys);
    env.connect(e.echo);
    body.start(t);
    edge.start(t);
    body.stop(t + len + 0.05);
    edge.stop(t + len + 0.05);
  };

  // the figure: chord tones across two octaves, turning over; some off-beats left out
  const FIGURE = [0, 2, 1, 3, 2, 4, 3, 1];
  const t0 = ctx.currentTime + 0.1;
  let step = 0;
  let next = t0;
  const schedule = () => {
    while (next < ctx.currentTime + 0.2) {
      const s = step % 16;
      if (s === 0) {
        if (pending !== null) {
          home = pending;
          pending = null;
        }
        // two bars on the stop's chord, two leaning to its neighbour
        const lean = step % 32 === 16;
        const want = lean ? (home + 3) % 4 : home;
        if (want !== chord) {
          layer = nextLayer(ctx, padFilter, layer, want);
          chord = want;
        }
        const low = CHORDS[chord][0];
        felt(next, low < 70 ? low * 2 : low, 0.1, 3.2);
      }
      const tones = CHORDS[chord]
        .slice(1)
        .flatMap((f) => [f * 2, f * 4])
        .sort((a, b) => a - b);
      const offBeat = s % 2 === 1;
      if (!offBeat || Math.random() > 0.35) {
        const f = tones[FIGURE[s % 8] % tones.length];
        const human = (Math.random() - 0.5) * 0.016;
        const peak = (offBeat ? 0.028 : 0.042) * (0.85 + Math.random() * 0.3);
        felt(next + human, f, peak, offBeat ? 1.1 : 1.6);
      }
      step++;
      next += ALBUM_EIGHTH;
    }
  };
  const clock = window.setInterval(schedule, 40);
  schedule();

  return {
    out,
    land(note) {
      const now = ctx.currentTime;
      const at = now + (ALBUM_EIGHTH - ((now - t0) % ALBUM_EIGHTH));
      if (note.chord !== home) pending = note.chord;
      felt(at, SCALE[note.step] * 2, 0.075, 2.8);
    },
    fly() {},
    stop() {
      window.clearInterval(clock);
      layer.oscs.forEach((o) => o.stop());
      breath.stop();
      hiss.stop();
    },
  };
}

// =============================================================================
// the album, by region: the same tune, dressed for where the photos were taken
// =============================================================================

export type Region = 'asia' | 'south' | 'europe' | 'mena';
let region: Region = 'asia';

/** a short burst of noise through a filter: shakers, drum skins, breath */
function noiseHit(
  e: Engine,
  into: AudioNode,
  t: number,
  type: BiquadFilterType,
  freq: number,
  peak: number,
  len: number,
  q = 0.8
) {
  const { ctx } = e;
  const src = noiseSource(e);
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(peak, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  src.connect(f);
  f.connect(g);
  g.connect(into);
  src.start(t, Math.random() * 1.5);
  src.stop(t + len + 0.02);
}

/** a plucked string: bright at the attack, closing fast — guitar, oud, harp by the settings */
function pluckString(
  e: Engine,
  into: AudioNode,
  t: number,
  freq: number,
  peak: number,
  len: number,
  { type = 'triangle' as OscillatorType, open = 3200, close = 700, bend = 0 } = {}
) {
  const { ctx } = e;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq * (1 + bend), t);
  if (bend) o.frequency.exponentialRampToValueAtTime(freq, t + 0.06);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(open, t);
  lp.frequency.exponentialRampToValueAtTime(close, t + Math.min(0.4, len));
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  o.connect(lp);
  lp.connect(g);
  g.connect(into);
  o.start(t);
  o.stop(t + len + 0.05);
}

/** a low drum: a sine dropping in pitch, with a little skin */
function lowDrum(
  e: Engine,
  into: AudioNode,
  t: number,
  from: number,
  to: number,
  peak: number,
  len: number
) {
  const { ctx } = e;
  const o = ctx.createOscillator();
  o.frequency.setValueAtTime(from, t);
  o.frequency.exponentialRampToValueAtTime(to, t + len * 0.6);
  const g = ctx.createGain();
  g.gain.setValueAtTime(peak, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  o.connect(g);
  g.connect(into);
  o.start(t);
  o.stop(t + len + 0.05);
  noiseHit(e, into, t, 'lowpass', 900, peak * 0.15, 0.05);
}

/** a clock that puts sixteenths on the audio timeline a little ahead */
function sixteenths(ctx: AudioContext, bpm: number, onStep: (step: number, t: number) => void) {
  const dur = 60 / bpm / 4;
  const t0 = ctx.currentTime + 0.1;
  let step = 0;
  let next = t0;
  const tick = () => {
    while (next < ctx.currentTime + 0.2) {
      onStep(step, next);
      step++;
      next += dur;
    }
  };
  const id = window.setInterval(tick, 30);
  tick();
  return {
    dur,
    /** the next grid line of `every` sixteenths after now */
    nextOn: (every: number) => {
      const now = ctx.currentTime;
      const d = dur * every;
      return now + (d - ((now - t0) % d));
    },
    stop: () => window.clearInterval(id),
  };
}

/** chords with their sevenths, voiced for a guitar: D maj7, Bm7, G maj7, A7 */
const SEVENTHS = [
  [146.83, 185.0, 220.0, 277.18],
  [123.47, 146.83, 185.0, 220.0],
  [98.0, 123.47, 146.83, 185.0],
  [110.0, 138.59, 164.81, 196.0],
];

/**
 * South America — bossa and samba at 104: a surdo answering on two and four,
 * a ganzá in sixteenths, a nylon guitar comping the syncopated bossa figure
 * with the sevenths, a bass that walks root and fifth, a tamborim now and
 * then. Bright, moving, warm.
 */
function southAlbum(e: Engine, out: GainNode): Song {
  const { ctx } = e;
  // the bossa sits lower in level than the other albums; a bus brings it up to them
  const bus = ctx.createGain();
  bus.gain.value = 1.5;
  bus.connect(out);
  let home = chordIndex;
  let pending: number | null = null;
  const guitar = ctx.createGain();
  guitar.gain.value = 0.9;
  guitar.connect(bus);
  guitar.connect(e.echo);
  const COMP = new Set([0, 3, 6, 10, 12]);
  const clock = sixteenths(ctx, 104, (step, t) => {
    const s = step % 16;
    if (s === 0 && pending !== null) {
      home = pending;
      pending = null;
    }
    // two bars home, two bars on the chord a fourth away
    const chord = step % 32 >= 16 ? (home + 2) % 4 : home;
    const v = SEVENTHS[chord];
    // ganzá: every sixteenth, leaning on the off-beat
    noiseHit(e, bus, t, 'highpass', 6000, [0.018, 0.009, 0.013, 0.009][s % 4], 0.05);
    // surdo: soft on one, open on two; soft on three, open on four
    if (s === 0 || s === 8) lowDrum(e, bus, t, 90, 55, 0.07, 0.3);
    if (s === 4 || s === 12) lowDrum(e, bus, t, 80, 48, 0.2, 0.5);
    // tamborim, the syncopation that makes it samba
    if (s === 3 || s === 6 || s === 14) noiseHit(e, bus, t, 'bandpass', 2600, 0.035, 0.06, 2.5);
    // bass: root, fifth
    if (s === 0 || s === 8)
      pluckString(e, bus, t, v[0] / 2, 0.16, 0.45, { type: 'sine', open: 900, close: 300 });
    if (s === 6 || s === 14)
      pluckString(e, bus, t, (v[0] / 2) * 1.5, 0.11, 0.3, { type: 'sine', open: 900, close: 300 });
    // guitar: the chord, brushed a few milliseconds apart
    if (COMP.has(s)) {
      const peak = s === 0 ? 0.05 : 0.035;
      v.forEach((f, i) =>
        pluckString(e, guitar, t + i * 0.008, f * 2, peak, 0.35, { open: 2600, close: 900 })
      );
    }
  });
  return {
    out,
    land(note) {
      if (note.chord !== home) pending = note.chord;
      pluckString(e, guitar, clock.nextOn(2), SCALE[note.step] * 2, 0.11, 1.2, {
        open: 4000,
        close: 1400,
      });
    },
    fly() {},
    stop() {
      clock.stop();
    },
  };
}

/**
 * Europe — grand, at 60: strings that swell over each bar, a horn call on the
 * first beat, the timpani under it and a roll into every fourth bar, a harp
 * climbing the chord, a choir's "ah" high above. The chord walks D, Bm, G, A
 * from the stop's own.
 */
function europeAlbum(e: Engine, out: GainNode): Song {
  const { ctx } = e;
  let home = chordIndex;
  let pending: number | null = null;
  // strings: detuned saws under a lowpass that opens as the bar swells
  const strings = ctx.createBiquadFilter();
  strings.type = 'lowpass';
  strings.frequency.value = 900;
  strings.Q.value = 0.5;
  const stringLevel = ctx.createGain();
  stringLevel.gain.value = 0.02;
  strings.connect(stringLevel);
  stringLevel.connect(out);
  stringLevel.connect(e.echo);
  // choir: a saw through two vowel formants
  const vowelA = ctx.createBiquadFilter();
  vowelA.type = 'bandpass';
  vowelA.frequency.value = 750;
  vowelA.Q.value = 6;
  const vowelB = ctx.createBiquadFilter();
  vowelB.type = 'bandpass';
  vowelB.frequency.value = 1150;
  vowelB.Q.value = 7;
  const choir = ctx.createGain();
  choir.gain.value = 0.05;
  vowelA.connect(choir);
  vowelB.connect(choir);
  choir.connect(out);
  choir.connect(e.echo);

  let voices: OscillatorNode[] = [];
  let voiceGain: GainNode | null = null;
  const setChord = (index: number, t: number) => {
    if (voiceGain) {
      const g = voiceGain;
      const vs = voices;
      g.gain.setTargetAtTime(0, t, 0.5);
      window.setTimeout(() => vs.forEach((o) => o.stop()), 3000);
    }
    const g = ctx.createGain();
    g.gain.value = 0;
    g.gain.setTargetAtTime(1, t, 0.7);
    g.connect(strings);
    const c = CHORDS[index];
    const notes = [c[0], c[1], c[2], c[3], c[2] * 2];
    voices = notes.flatMap((f) =>
      [-9, 8].map((cents) => {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f;
        o.detune.value = cents;
        o.connect(g);
        o.start(t);
        return o;
      })
    );
    // the choir sings the chord's top two an octave up
    [c[2] * 2, c[3] * 2].forEach((f) => {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      const vg = ctx.createGain();
      vg.gain.value = 0;
      vg.gain.setTargetAtTime(0.5, t, 1.2);
      o.connect(vg);
      vg.connect(vowelA);
      vg.connect(vowelB);
      vg.connect(g);
      o.start(t);
      voices.push(o);
    });
    voiceGain = g;
  };

  let bar = 0;
  const clock = sixteenths(ctx, 60, (step, t) => {
    const s = step % 16;
    if (s !== 0 && s % 4 !== 0) return;
    if (s === 0) {
      if (pending !== null) {
        home = pending;
        pending = null;
      }
      const chord = (home + (bar % 4)) % 4;
      setChord(chord, t);
      // the swell
      strings.frequency.cancelScheduledValues(t);
      strings.frequency.setValueAtTime(700, t);
      strings.frequency.linearRampToValueAtTime(1900, t + 2.2);
      strings.frequency.linearRampToValueAtTime(800, t + 3.9);
      // timpani, and a horn on the root and fifth
      const root = CHORDS[chord][0];
      lowDrum(e, out, t, root * 1.2, root, 0.3, 1.6);
      [root * 2, root * 3].forEach((f) =>
        pluckString(e, out, t + 0.02, f, 0.05, 2.6, { type: 'sawtooth', open: 1100, close: 500 })
      );
      bar++;
    }
    // a roll into every fourth bar
    if (bar % 4 === 0 && s === 12) {
      for (let k = 0; k < 10; k++) lowDrum(e, out, t + k * 0.1, 80, 70, 0.04 + k * 0.012, 0.18);
    }
    // the harp climbs the chord on the beats
    const c = CHORDS[(home + ((bar - 1 + 4) % 4)) % 4];
    const harp = [c[1] * 2, c[2] * 2, c[3] * 2, c[1] * 4][(s / 4) | 0];
    pluckString(e, out, t, harp, 0.05, 2.2, { open: 5000, close: 1600 });
  });
  return {
    out,
    land(note) {
      if (note.chord !== home) pending = note.chord;
      // a bell, high over the orchestra
      strike(e, out, SCALE[note.step] * 4, 0.05, 3.4, clock.nextOn(4));
    },
    fly() {},
    stop() {
      clock.stop();
      voices.forEach((o) => o.stop());
    },
  };
}

/** D phrygian dominant over two octaves: D E♭ F♯ G A B♭ C — step for step with SCALE */
const HIJAZ = [146.83, 155.56, 185.0, 196.0, 220.0, 233.08, 261.63, 293.66, 311.13, 369.99, 392.0];

/**
 * The Middle East and North Africa — a mystery, at 84: a drone on D and A that
 * shimmers, a darbuka playing maqsum (dum tek · tek dum · tek), an oud walking
 * the hijaz scale in short phrases with rests between, and each stop's note on
 * a ney — breath and a slow vibrato — over it all.
 */
function menaAlbum(e: Engine, out: GainNode): Song {
  const { ctx } = e;
  const droneFilter = ctx.createBiquadFilter();
  droneFilter.type = 'lowpass';
  droneFilter.frequency.value = 520;
  droneFilter.Q.value = 3;
  const droneLevel = ctx.createGain();
  droneLevel.gain.value = 0;
  droneLevel.gain.setTargetAtTime(0.035, ctx.currentTime, 1.5);
  droneFilter.connect(droneLevel);
  droneLevel.connect(out);
  const sweep = ctx.createOscillator();
  sweep.frequency.value = 0.07;
  const sweepAmt = ctx.createGain();
  sweepAmt.gain.value = 260;
  sweep.connect(sweepAmt);
  sweepAmt.connect(droneFilter.frequency);
  const drone = [73.42, 110.0, 146.83, 220.0].flatMap((f, i) =>
    [-5, 4].map((cents) => {
      const o = ctx.createOscillator();
      o.type = i < 2 ? 'sawtooth' : 'triangle';
      o.frequency.value = f;
      o.detune.value = cents;
      o.connect(droneFilter);
      return o;
    })
  );
  [sweep, ...drone].forEach((n) => n.start());

  const oud = ctx.createGain();
  oud.gain.value = 1;
  oud.connect(out);
  oud.connect(e.echo);
  let pos = 4;
  let phrase = 0;
  const MAQSUM: Record<number, 'dum' | 'tek'> = {
    0: 'dum',
    2: 'tek',
    6: 'tek',
    8: 'dum',
    12: 'tek',
  };
  const clock = sixteenths(ctx, 84, (step, t) => {
    const s = step % 16;
    const hit = MAQSUM[s];
    if (hit === 'dum') lowDrum(e, out, t, 110, 62, 0.16, 0.3);
    if (hit === 'tek') noiseHit(e, out, t, 'bandpass', 3200, 0.05, 0.07, 1.8);
    if (s % 4 === 3 && Math.random() < 0.35) noiseHit(e, out, t, 'bandpass', 4200, 0.018, 0.04, 2);
    // the oud: a phrase of a few notes, then a rest of a bar
    if (s === 0) phrase = (phrase + 1) % 4;
    if (phrase === 3) return;
    if (s % 2 === 0 && Math.random() < 0.72) {
      const move = [-2, -1, -1, 1, 1, 2][Math.floor(Math.random() * 6)];
      pos = Math.max(0, Math.min(HIJAZ.length - 1, pos + move));
      const f = HIJAZ[pos];
      pluckString(e, oud, t, f, 0.06, 0.7, {
        type: 'sawtooth',
        open: 2400,
        close: 600,
        bend: 0.02,
      });
      // the oud's tremolo on a long note, now and then
      if (Math.random() < 0.18) {
        for (let k = 1; k < 4; k++)
          pluckString(e, oud, t + k * 0.045, f, 0.03, 0.2, {
            type: 'sawtooth',
            open: 2000,
            close: 700,
          });
      }
    }
  });
  /** a ney: a sine with breath in it and a slow vibrato */
  const ney = (t: number, f: number) => {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    const vib = ctx.createOscillator();
    vib.frequency.value = 5;
    const vibAmt = ctx.createGain();
    vibAmt.gain.setValueAtTime(0, t);
    vibAmt.gain.linearRampToValueAtTime(f * 0.012, t + 0.8);
    vib.connect(vibAmt);
    vibAmt.connect(o.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.07, t + 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 3.2);
    o.connect(g);
    g.connect(out);
    g.connect(e.echo);
    o.start(t);
    vib.start(t);
    o.stop(t + 3.3);
    vib.stop(t + 3.3);
    noiseHit(e, out, t, 'bandpass', f * 3, 0.012, 1.2, 1.2);
  };
  return {
    out,
    land(note) {
      ney(clock.nextOn(4), HIJAZ[note.step] * 2);
    },
    fly() {},
    stop() {
      clock.stop();
      [sweep, ...drone].forEach((n) => n.stop());
    },
  };
}

function playSong(e: Engine, which: Mood): Song {
  const out = e.ctx.createGain();
  out.gain.value = 0;
  out.connect(e.master);
  out.gain.setTargetAtTime(1, e.ctx.currentTime, 0.5);
  if (which === 'orbit') return orbitSong(e, out);
  if (which === 'album') {
    if (region === 'south') return southAlbum(e, out);
    if (region === 'europe') return europeAlbum(e, out);
    if (region === 'mena') return menaAlbum(e, out);
    return albumSong(e, out);
  }
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
  crossTo(next);
}

/** one song out over a bar or so, the next one in */
function crossTo(next: Mood) {
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

let regionTimer = 0;
/**
 * Where the photos being looked at were taken. The album is dressed for it:
 * Asia keeps the felt piano, South America a bossa, Europe an orchestra, the
 * Middle East and North Africa the oud and the darbuka. A reader scrolling fast
 * through a border does not want the band to change at every stop, so a new
 * region has to hold for a moment before the music follows it.
 */
export function setAlbumRegion(next: Region) {
  window.clearTimeout(regionTimer);
  if (next === region) return;
  if (mood !== 'album' || !engine) {
    region = next;
    return;
  }
  regionTimer = window.setTimeout(() => {
    region = next;
    crossTo('album');
  }, 700);
}

let turnFrom: { x: number; y: number; z: number; t: number } | null = null;
let calmTimer = 0;
/**
 * Where the camera looks from while the hand turns the globe. The speed of the
 * turn is read off successive directions; when they stop coming, it is still.
 */
export function turnedTo(x: number, y: number, z: number) {
  const len = Math.hypot(x, y, z) || 1;
  const now = performance.now();
  const d = { x: x / len, y: y / len, z: z / len, t: now };
  // the controls report several times a frame; a speed read over a few
  // milliseconds is noise, so it is read over 30ms or more
  if (!turnFrom) turnFrom = d;
  else if (now - turnFrom.t >= 30) {
    const dot = Math.max(-1, Math.min(1, d.x * turnFrom.x + d.y * turnFrom.y + d.z * turnFrom.z));
    engine?.song.turn?.(Math.acos(dot) / ((now - turnFrom.t) / 1000));
    turnFrom = d;
  }
  window.clearTimeout(calmTimer);
  calmTimer = window.setTimeout(() => {
    turnFrom = null;
    engine?.song.turn?.(0);
  }, 160);
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
