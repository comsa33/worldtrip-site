/**
 * One hand for both blocks — the opening and the finale write the same way.
 *
 * The words are all in the document; only their paint waits. The hand is quick
 * when it is sure — each word gets its own pace — and it stops to think once
 * per paragraph, somewhere past the middle, where a person would. Commas,
 * full stops, line breaks and paragraph ends get their own breaths.
 */
export const CHAR_MS = 38;
export const JITTER_MS = 16;
export const PAUSE: Record<string, number> = {
  ' ': 30,
  ',': 220,
  '.': 560,
  '!': 560,
  '?': 560,
  '\n': 340,
  '"': 70,
};
export const BLOCK_PAUSE_MS = 720;
/** The cursor stands at the head of the first line this long before it writes. */
export const LEAD_MS = 1100;
const THINK_MS: [number, number] = [600, 1000];

/**
 * How fast this particular hand is.
 *
 * The opening is read by someone who has just arrived and has time; a city's
 * note is read in the pause between two scrolls, and the reader has already
 * waited a beat for it to appear. `pace` scales every duration below — a
 * smaller number is a quicker hand — and `lead` is how long the cursor stands
 * there before starting.
 */
export type Pace = { pace?: number; lead?: number };

export type Hooks = {
  /** the cursor is waiting (blinking) or writing (steady) */
  blink: (on: boolean) => void;
  /** the cursor now stands after this character (or before the first) */
  at: (el: HTMLElement, after: boolean) => void;
  done: () => void;
};

const between = (a: number, b: number) => a + Math.random() * (b - a);

/** Runs the hand over `chars`; returns a stop function. */
export function typewrite(chars: HTMLElement[], hooks: Hooks, opts: Pace = {}): () => void {
  const rate = opts.pace ?? 1;
  const lead = opts.lead ?? LEAD_MS;
  const timers: number[] = [];
  const wait = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, ms));

  // one thought per paragraph, at a word start somewhere past the middle
  const thinkAt = new Set<number>();
  let blockStart = 0;
  for (let i = 0; i <= chars.length; i++) {
    const end =
      i === chars.length || (i > 0 && chars[i].parentElement !== chars[i - 1].parentElement);
    if (!end) continue;
    const starts: number[] = [];
    for (let k = blockStart; k < i; k++) {
      const ch = chars[k].textContent ?? '';
      const prev = k > blockStart ? (chars[k - 1].textContent ?? '') : ' ';
      if (ch !== ' ' && ch !== '\n' && (prev === ' ' || prev === '\n') && k > blockStart)
        starts.push(k);
    }
    if (starts.length >= 3) {
      const lo = Math.floor(starts.length * 0.35);
      const hi = Math.floor(starts.length * 0.85);
      thinkAt.add(starts[Math.floor(between(lo, hi))]);
    }
    blockStart = i;
  }

  let i = 0;
  let pace = 1;
  let thought = false;
  const step = () => {
    if (i >= chars.length) {
      hooks.done();
      return;
    }
    const el = chars[i];
    const ch = el.textContent ?? '';
    const prev = i > 0 ? (chars[i - 1].textContent ?? '') : ' ';
    const startsWord = ch !== ' ' && ch !== '\n' && (prev === ' ' || prev === '\n');
    if (startsWord) {
      if (thinkAt.has(i) && !thought) {
        thought = true;
        hooks.blink(true);
        wait(between(THINK_MS[0], THINK_MS[1]) * rate, step);
        return;
      }
      thought = false;
      pace = between(0.6, 1.3);
    }
    el.classList.add('is-on');
    hooks.at(el, true);
    const next = chars[i + 1];
    const blockChange = next && next.parentElement !== el.parentElement;
    const pause = ((PAUSE[ch] ?? 0) + (blockChange ? BLOCK_PAUSE_MS : 0)) * rate;
    hooks.blink(pause > 200);
    i += 1;
    wait(Math.max(8, (CHAR_MS * pace + (Math.random() * 2 - 1) * JITTER_MS) * rate + pause), step);
  };

  hooks.at(chars[0], false);
  hooks.blink(true);
  wait(lead, step);
  return () => timers.forEach((t) => window.clearTimeout(t));
}
