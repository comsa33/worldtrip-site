import { useEffect, useRef, type RefObject } from 'react';
import { BOOKEND, typewrite } from './typewriter';

/** How long the dot sits as the full stop before it gets up and goes. */
const HOLD_MS = 800;

/**
 * The hand that writes a card with the travelling dot itself — the opening's
 * hand, and the finale's in mirror. The moment it is active the dot comes
 * (from wherever it is — the first stop, on the opening) into a seat at the
 * head of the text, stands up into a cursor, writes, folds down into the full
 * stop of the last line, and after a beat lets go of the seat: the sentence
 * keeps its own period, and the dot is free to fly on.
 *
 * `seen` is what the reader has already watched: a block in it is simply
 * there, unwritten, and `onDone` fires at once so the page can move on.
 */
export function useDotTyped(
  ref: RefObject<HTMLDivElement | null>,
  active: boolean,
  key: string,
  seen: Set<string>,
  onDone?: () => void
) {
  const doneRef = useRef(onDone);
  useEffect(() => {
    doneRef.current = onDone;
  }, [onDone]);
  useEffect(() => {
    const root = ref.current;
    if (!root || !active) return;
    const chars = Array.from(root.querySelectorAll<HTMLElement>('[data-ch]'));
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (seen.has(key) || reduced || chars.length === 0) {
      root.classList.add('is-done');
      doneRef.current?.();
      return;
    }
    // the seat: in the flow of the line, the size and place of a period; the
    // dot is pinned to it from the moment it is made active
    const seat = document.createElement('span');
    seat.className = 'about-overlay__seat';
    seat.setAttribute('data-dot-follow', '');
    seat.setAttribute('aria-hidden', 'true');
    chars[0].before(seat);

    let leave = 0;
    seat.setAttribute('data-dot-active', '');
    seat.setAttribute('data-dot-carry', 'caret-blink');
    // the dot arrives first; the hand starts once it is standing (the lead)
    const stop = typewrite(
      chars,
      {
        at: (el, after) => (after ? el.after(seat) : el.before(seat)),
        blink: (on) => seat.setAttribute('data-dot-carry', on ? 'caret-blink' : 'caret'),
        done: () => {
          seen.add(key);
          // fold down into the full stop of the last line
          chars[chars.length - 1].after(seat);
          seat.setAttribute('data-dot-carry', 'land:1');
          // Then let go. The page is told, and takes this hand away (the
          // cleanup below removes the seat); the dot's other seat is already
          // there for it to fly straight back to, and the sentence's own
          // period shows in the dot's place.
          leave = window.setTimeout(() => doneRef.current?.(), HOLD_MS);
        },
      },
      BOOKEND
    );

    return () => {
      window.clearTimeout(leave);
      stop();
      seat.remove();
      if (seen.has(key)) root.classList.add('is-done');
    };
  }, [ref, active, key, seen]);
}
