import { useEffect, type RefObject } from 'react';
import { typewrite } from './typewriter';

/**
 * The hand that writes a card, with its own cursor.
 *
 * `seen` is what the caller has already watched: a block in it is simply
 * there, unwritten. A reader who scrolls back to a city they have read does
 * not watch it be typed a second time.
 */
export function useSelfTyped(
  ref: RefObject<HTMLDivElement | null>,
  active: boolean,
  key: string,
  seen: Set<string>
) {
  useEffect(() => {
    const root = ref.current;
    if (!root || !active) return;
    const chars = Array.from(root.querySelectorAll<HTMLElement>('[data-ch]'));
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (seen.has(key) || reduced || chars.length === 0) {
      root.classList.add('is-done');
      return;
    }
    seen.add(key);

    const caret = document.createElement('span');
    caret.className = 'about-overlay__caret';
    caret.setAttribute('aria-hidden', 'true');
    const stop = typewrite(chars, {
      at: (el, after) => (after ? el.after(caret) : el.before(caret)),
      blink: (on) => caret.classList.toggle('is-blink', on),
      done: () => {
        // the cursor folds down into the full stop of the last line and takes
        // the ink of the type around it — the sentence's own period
        caret.classList.remove('is-blink');
        caret.classList.add('is-period');
        root.classList.add('is-done', 'is-typed');
      },
    });

    return () => {
      stop();
      caret.remove();
      // leaving mid-sentence: the words are simply there
      root.classList.add('is-done');
    };
  }, [ref, active, key, seen]);
}
