import { useEffect, useRef } from 'react';
import './TravelingDot.css';

/** A little over the transform transition, so a return home can settle. */
const FLIGHT_MS = 560;

/** A move shorter than this is a nudge, not a journey — no deformation. */
const JOURNEY_PX = 6;

/* ---- writing: the hand's timing, the same as the opening block's. Unhurried:
   a reader should never feel rushed by it. ---- */
const CHAR_MS = 55;
const JITTER_MS = 20;
const PAUSE: Record<string, number> = {
  ' ': 40,
  ',': 260,
  '.': 700,
  '!': 700,
  '?': 700,
  '\n': 420,
  '"': 90,
};
const BLOCK_PAUSE_MS = 900;
const LEAD_MS = 1100;
const RISE_MS = 460;
const THINK_CHANCE = 0.12;
const THINK_MS: [number, number] = [450, 1100];
/** The hand writes once per load; coming back finds the page written. */
let written = false;

type Spot = { x: number; y: number; size: number };

/**
 * One accent dot for the whole site, the same one the blog and the portfolio
 * use. Its home is the minimap's current position — while it is home it is not
 * drawn at all and that mark stands in for it. When something opens that wants
 * the dot (the photo book), the mark becomes the ring it left behind and the
 * dot flies out of the map and into it.
 *
 * Nothing here knows about the gallery or the globe: whatever element carries
 * `data-dot-active` is where the dot goes, and the host decides the size and
 * the seating by declaring `--dot-size` / `--dot-below`. A host that also
 * carries `data-dot-end` is a final arrival — the dot stands up into a caret
 * there, blinks, and folds back into the full stop it was always going to be.
 * A host that carries `data-dot-write` is a page to be written: the dot flies
 * to the head of its first line, stands up into a cursor, writes the words one
 * by one — thinking now and then — and folds down into the full stop of the
 * last line, where it stays. A host that carries `data-dot-follow` is one that moves on its own (the
 * head of the route on the globe): the dot flies to it once, lands, and from
 * then on is pinned to it every frame with no easing of its own — the motion
 * is the host's. Such a host may also say what the dot should be doing there
 * through `data-dot-carry`: `ribbon` while something else is drawing the mark
 * in motion, `land:<n>` when it has just come to rest, `hidden` when it is
 * round the back of the world.
 */
export function TravelingDot() {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const dot = ref.current;
    if (!dot) return;
    const ball = dot.firstElementChild as HTMLElement | null;

    let frame = 0;
    let ready = false;
    let atHome = true;
    let returning = 0;
    let landing = 0;
    let currentHost: HTMLElement | null = null;
    let lastX = NaN;
    let lastY = NaN;
    let following = 0;
    let followStart = 0;
    let lastCarry = '';
    let writeTimers: number[] = [];
    let writeStart = 0;
    let writingHost: HTMLElement | null = null;

    const homeEl = () => document.querySelector<HTMLElement>('[data-dot-home]');
    const activeEl = () => document.querySelector<HTMLElement>('[data-dot-active]');

    const numVar = (cs: CSSStyleDeclaration, name: string, fallback: number) => {
      const v = parseFloat(cs.getPropertyValue(name));
      return Number.isFinite(v) ? v : fallback;
    };

    /** Where the dot sits on a host, in viewport coordinates. */
    const spotOf = (el: HTMLElement): Spot => {
      const a = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const size = numVar(cs, '--dot-size', 5);
      // A host can ask the dot to stand under it rather than on it — which is
      // what a thumbnail wants, so the dot never covers the picture.
      const below = numVar(cs, '--dot-below', 0);
      return {
        x: Math.round(a.left + (a.width - size) / 2),
        y: Math.round(below ? a.bottom + below : a.top + (a.height - size) / 2),
        size,
      };
    };

    const setTransform = (x: number, y: number) => {
      dot.style.transform = `translate(${x}px, ${y}px)`;
      lastX = x;
      lastY = y;
    };

    /**
     * The ball is a soft body. On a real journey it gathers itself, stretches
     * along the line of travel, lands with a squash and settles. The outer
     * element only ever translates; the inner one only ever deforms, so the
     * two never fight.
     */
    const moveTo = (x: number, y: number) => {
      const dx = x - lastX;
      const dy = y - lastY;
      setTransform(x, y);
      if (!ball || !(Math.hypot(dx, dy) >= JOURNEY_PX)) return;
      ball.style.setProperty('--angle', `${Math.atan2(dy, dx)}rad`);
      ball.removeAttribute('data-squish');
      void ball.offsetWidth; // restart the animation
      ball.setAttribute('data-squish', '');
    };

    /** Land without animating — a first placement, or the start of a flight. */
    const jumpTo = (x: number, y: number) => {
      dot.removeAttribute('data-ready');
      setTransform(x, y);
      void dot.offsetWidth;
      dot.setAttribute('data-ready', 'true');
    };

    /**
     * The caret the mark stands up into, as scale factors on the ball. It has
     * to be as tall as the type it is ending, and the mark is a fixed few
     * pixels while the text it sits in is not — so the seat's own font size is
     * measured and divided by the mark.
     */
    const sizeCaret = (host: HTMLElement, size: number) => {
      if (!ball) return;
      const cs = getComputedStyle(host);
      const fontSize = parseFloat(cs.fontSize) || 16;
      const ratio = numVar(cs, '--caret-height', 1);
      const width = numVar(cs, '--caret-width', 1.4);
      const h = (fontSize * ratio) / size;
      const w = width / size;
      ball.style.setProperty('--caret-y', String(h));
      ball.style.setProperty('--caret-x', String(w));
      // The jump goes well past the caret and recoils back through it before
      // settling — overshoot, undershoot, rest. That three-beat is what makes
      // it read as a spring rather than as a shape growing.
      ball.style.setProperty('--caret-y-over', String(h * 1.5));
      ball.style.setProperty('--caret-x-over', String(w * 0.62));
      ball.style.setProperty('--caret-y-under', String(h * 0.93));
      ball.style.setProperty('--caret-x-under', String(w * 1.14));
      // A period fills its seat and so is centred in it; a caret is a sliver of
      // the same width, hung on the seat's left edge, which is where the text
      // actually ends.
      ball.style.setProperty('--caret-shift', `${((-(size - width) / 2) * 100) / size}%`);
    };

    /** Come to rest with a bounce — flattened, up, down, still. 통 · 통 */
    const bounce = () => {
      if (!ball) return;
      ball.removeAttribute('data-squish');
      ball.removeAttribute('data-drop');
      void ball.offsetWidth;
      ball.setAttribute('data-drop', '');
    };

    /**
     * Pinned to a moving host. One rect read a frame; the transform is written
     * without transition, so the dot is exactly where the host is, not where
     * it was 500ms ago. The host's `data-dot-carry` says whether the dot
     * itself should be drawn right now.
     */
    const stopFollowing = () => {
      if (following) cancelAnimationFrame(following);
      following = 0;
      followStart = 0;
      lastCarry = '';
      dot.removeAttribute('data-hidden');
    };
    const follow = (host: HTMLElement) => {
      stopFollowing();
      const tick = () => {
        if (currentHost !== host || !host.isConnected) {
          stopFollowing();
          return;
        }
        const s = spotOf(host);
        dot.style.setProperty('--size', `${s.size}px`);
        setTransform(s.x, s.y);
        const carry = host.getAttribute('data-dot-carry') ?? '';
        if (carry !== lastCarry) {
          if (carry === 'ribbon' || carry === 'hidden') dot.setAttribute('data-hidden', '');
          else dot.removeAttribute('data-hidden');
          if (carry.startsWith('land')) bounce();
          lastCarry = carry;
        }
        following = requestAnimationFrame(tick);
      };
      following = requestAnimationFrame(tick);
    };

    /* ---- writing ---- */
    const stopWriting = () => {
      writeTimers.forEach((t) => window.clearTimeout(t));
      writeTimers = [];
      window.clearTimeout(writeStart);
      if (writingHost) {
        writingHost.classList.add('is-done');
        writingHost.removeAttribute('data-dot-sitting');
        writingHost = null;
      }
      if (!ball) return;
      ball.removeAttribute('data-caret');
      ball.removeAttribute('data-caret-in');
      ball.removeAttribute('data-blink');
      ['--cx', '--cy', '--cx-over', '--cy-over', '--cx-under', '--cy-under'].forEach((v) =>
        ball.style.removeProperty(v)
      );
    };
    /** Where the hand stands: just past a character, or just before the first. */
    const besideChar = (el: HTMLElement, size: number, after: boolean): Spot => {
      const r = el.getBoundingClientRect();
      const fs = parseFloat(getComputedStyle(el.parentElement ?? el).fontSize) || 13;
      return {
        x: Math.round(after ? r.right + 1 : r.left - 1),
        y: Math.round(r.bottom - size - fs * 0.12),
        size,
      };
    };
    /** The caret is the height of the line it is on, and this thin. */
    const caretVars = (line: HTMLElement, size: number) => {
      if (!ball) return;
      const fontSize = parseFloat(getComputedStyle(line).fontSize) || 13;
      const h = (fontSize * 0.92) / size;
      const w = 1.4 / size;
      ball.style.setProperty('--cx', String(w));
      ball.style.setProperty('--cy', String(h));
      ball.style.setProperty('--cx-over', String(w * 0.62));
      ball.style.setProperty('--cy-over', String(h * 1.5));
      ball.style.setProperty('--cx-under', String(w * 1.14));
      ball.style.setProperty('--cy-under', String(h * 0.93));
    };
    const write = (host: HTMLElement) => {
      const chars = Array.from(host.querySelectorAll<HTMLElement>('[data-ch]'));
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const size = 5;
      const wait = (ms: number, fn: () => void) => writeTimers.push(window.setTimeout(fn, ms));
      const between = (a: number, b: number) => a + Math.random() * (b - a);
      writingHost = host;
      dot.style.setProperty('--size', `${size}px`);
      if (written || reduced || chars.length === 0) {
        // already written this load: the dot simply sits down as the period
        host.classList.add('is-done');
        const last = chars[chars.length - 1];
        if (last) {
          const s = besideChar(last, size, true);
          jumpTo(s.x, s.y);
        }
        host.setAttribute('data-dot-sitting', '');
        return;
      }
      written = true;
      let i = 0;
      let handSpeed = 1;
      const step = () => {
        if (!host.isConnected) return;
        if (i >= chars.length) {
          // written: the cursor folds down into the full stop, and stays
          if (ball) {
            ball.removeAttribute('data-caret');
            ball.removeAttribute('data-blink');
            bounce();
          }
          host.classList.add('is-done');
          host.setAttribute('data-dot-sitting', '');
          return;
        }
        const el = chars[i];
        const ch = el.textContent ?? '';
        const prev = i > 0 ? (chars[i - 1].textContent ?? '') : ' ';
        const startsWord = ch !== ' ' && ch !== '\n' && (prev === ' ' || prev === '\n');
        // a word begins: a new pace, and now and then a moment's thought first
        if (startsWord && el.dataset.thought === undefined) {
          handSpeed = between(0.7, 1.4);
          if (Math.random() < THINK_CHANCE) {
            ball?.setAttribute('data-blink', '');
            el.dataset.thought = '';
            handSpeed = between(0.85, 1.1);
            wait(between(THINK_MS[0], THINK_MS[1]), step);
            return;
          }
        }
        el.classList.add('is-on');
        delete el.dataset.thought;
        if (el.parentElement) caretVars(el.parentElement, size);
        const s = besideChar(el, size, true);
        setTransform(s.x, s.y); // a caret snaps between letters
        const next = chars[i + 1];
        // between blocks (a different parent) the hand lifts for a moment
        const blockChange = next && next.parentElement !== el.parentElement;
        const pause = (PAUSE[ch] ?? 0) + (blockChange ? BLOCK_PAUSE_MS : 0);
        if (ball) {
          if (pause > 200) ball.setAttribute('data-blink', '');
          else ball.removeAttribute('data-blink');
        }
        i += 1;
        wait(Math.max(8, CHAR_MS * handSpeed + (Math.random() * 2 - 1) * JITTER_MS + pause), step);
      };
      // at the head of the first line: stand up into a cursor, wait a moment
      // the way a hand does before the first word, then write
      const first = chars[0];
      if (first.parentElement) caretVars(first.parentElement, size);
      const s0 = besideChar(first, size, false);
      jumpTo(s0.x, s0.y);
      if (ball) {
        ball.removeAttribute('data-squish');
        ball.removeAttribute('data-drop');
        void ball.offsetWidth;
        ball.setAttribute('data-caret-in', '');
      }
      wait(RISE_MS, () => {
        if (ball) {
          ball.removeAttribute('data-caret-in');
          ball.setAttribute('data-caret', '');
          ball.setAttribute('data-blink', '');
        }
        wait(LEAD_MS, step);
      });
    };

    /** The one arrival that is not on the way to somewhere else. */
    const scheduleLand = (host: HTMLElement) => {
      window.clearTimeout(landing);
      ball?.removeAttribute('data-land');
      if (host.hasAttribute('data-dot-write')) {
        // fly to the head of the first line; then the hand takes over
        writeStart = window.setTimeout(() => {
          dot.removeAttribute('data-ready');
          write(host);
        }, FLIGHT_MS);
        return;
      }
      if (host.hasAttribute('data-dot-follow')) {
        // fly there once, land with a bounce, then stay pinned
        followStart = window.setTimeout(() => {
          bounce();
          dot.removeAttribute('data-ready');
          follow(host);
        }, FLIGHT_MS);
        return;
      }
      if (!ball || !host.hasAttribute('data-dot-end')) return;
      sizeCaret(host, spotOf(host).size);
      landing = window.setTimeout(() => {
        ball.removeAttribute('data-squish');
        void ball.offsetWidth;
        ball.setAttribute('data-land', '');
      }, FLIGHT_MS);
    };

    const settleHome = () => {
      returning = 0;
      atHome = true;
      dot.setAttribute('data-home', '');
      homeEl()?.removeAttribute('data-dot-state');
    };

    /** Fly back to the mark in the header, then hand over to it. */
    const goHome = () => {
      if (atHome || returning) return;
      window.clearTimeout(landing);
      window.clearTimeout(followStart);
      stopFollowing();
      stopWriting();
      dot.setAttribute('data-ready', 'true');
      ball?.removeAttribute('data-land');
      currentHost = null;
      const home = homeEl();
      if (!home) {
        settleHome();
        return;
      }
      const s = spotOf(home);
      dot.style.setProperty('--size', `${s.size}px`);
      moveTo(s.x, s.y);
      returning = window.setTimeout(settleHome, FLIGHT_MS);
    };

    /** Go to a host — leaving the mark on the map first if that is where we are. */
    const goTo = (s: Spot) => {
      if (returning) {
        window.clearTimeout(returning);
        returning = 0;
      }
      if (atHome) {
        atHome = false;
        dot.removeAttribute('data-home');
        const home = homeEl();
        home?.setAttribute('data-dot-state', 'away');
        if (!ready) {
          dot.style.setProperty('--size', `${s.size}px`);
          jumpTo(s.x, s.y);
          return;
        }
        if (home) {
          const h = spotOf(home);
          dot.style.setProperty('--size', `${h.size}px`);
          jumpTo(h.x, h.y);
        }
      }
      dot.style.setProperty('--size', `${s.size}px`);
      moveTo(s.x, s.y);
    };

    const place = () => {
      frame = 0;
      const host = activeEl();
      if (!host) {
        currentHost = null;
        goHome();
        ready = true;
        return;
      }
      if (host !== currentHost) {
        window.clearTimeout(followStart);
        stopFollowing();
        stopWriting();
        dot.setAttribute('data-ready', 'true');
        currentHost = host;
        scheduleLand(host);
      }
      // while pinned or writing, the hand owns the transform
      if (!following && !writingHost) {
        const first = host.hasAttribute('data-dot-write')
          ? host.querySelector<HTMLElement>('[data-ch]')
          : null;
        goTo(first ? besideChar(first, 5, false) : spotOf(host));
      }
      ready = true;
    };

    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(place);
    };

    place();

    // The target moves for all sorts of reasons that are none of this file's
    // business: a strip scrolls, the window resizes, the gallery opens. Watch
    // the page rather than any one of them. Scroll is captured so that inner
    // scrollers (the thumbnail strip) are heard too.
    const mo = new MutationObserver(schedule);
    mo.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: [
        'data-dot-active',
        'data-dot-end',
        'data-dot-follow',
        'data-dot-write',
        'cx',
        'cy',
      ],
    });
    const ro = new ResizeObserver(schedule);
    ro.observe(document.documentElement);
    window.addEventListener('resize', schedule);
    document.addEventListener('scroll', schedule, true);
    document.fonts?.ready.then(schedule);

    return () => {
      mo.disconnect();
      ro.disconnect();
      window.removeEventListener('resize', schedule);
      document.removeEventListener('scroll', schedule, true);
      if (frame) cancelAnimationFrame(frame);
      window.clearTimeout(landing);
      window.clearTimeout(followStart);
      stopFollowing();
      stopWriting();
      if (returning) window.clearTimeout(returning);
      homeEl()?.removeAttribute('data-dot-state');
    };
  }, []);

  return (
    <span ref={ref} className="tdot" data-home="" aria-hidden="true">
      <span className="tdot__ball" />
    </span>
  );
}
