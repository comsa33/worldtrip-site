import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useI18n } from '../../i18n';
import { LEAN, readMoved } from './useFirstStep';

/**
 * How a newcomer learns to move on. Nothing is added to the page ahead of time:
 * the dot shows the way in its own language, and the keys show up where the
 * hand already is. All of it stops for good at the first real input.
 */

/** A key, drawn the way a keyboard hint is: hairline, mono, no fill. */
export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="key">{children}</kbd>;
}

/**
 * On a desktop, before the first move, the pointer carries the hint over the
 * globe: one mono line beside the cursor, and nothing anywhere else. Where the
 * hand is, it speaks; where it is not, there is nothing.
 */
export function CursorHint({ active, next }: { active: boolean; next: string }) {
  const { language } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const [over, setOver] = useState(false);

  useEffect(() => {
    if (!active) return;
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    const onMove = (e: PointerEvent) => {
      const el = ref.current;
      if (!el) return;
      const target = e.target as Element | null;
      const onGlobe = Boolean(target?.closest?.('.canvas-container'));
      setOver(onGlobe);
      if (onGlobe) el.style.transform = `translate(${e.clientX + 18}px, ${e.clientY + 12}px)`;
    };
    const onLeave = () => setOver(false);
    window.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerleave', onLeave);
    return () => {
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerleave', onLeave);
    };
  }, [active]);

  if (!active) return null;
  return (
    <div ref={ref} className={`first-hint${over ? ' is-on' : ''}`} aria-hidden="true">
      <span>{language === 'ko' ? '스크롤' : 'scroll'}</span>
      <span className="first-hint__sep">·</span>
      <Kbd>→</Kbd>
      <span>{next}</span>
    </div>
  );
}

/** The leading of the words from the dot's centre — the cursor hint's offset. */
const SWIPE_OFFSET = { x: 18, y: 12 };
/**
 * How far the finger has to go up for the swipe to count. Keep in step with
 * swipeThreshold in JourneyExperience's handleTouchEnd: the words are gone at
 * exactly the point where letting go will move the journey.
 */
const SWIPE_PX = 40;

/**
 * On a phone the hand is not over the globe until it swipes, so the words hang
 * on the dot instead: the cursor hint's line, beside the mark, over the middle
 * of the screen where the dot sits. They go out with the dot's first lean —
 * riding the head of the ribbon, which is where they appear from — come back
 * with it, and stay there until the reader swipes.
 *
 * The phone's journey does not follow the finger; it goes when the finger is
 * lifted past the threshold. So the words answer the finger instead: they thin
 * as it climbs and are gone at the threshold — how far, not how long. A finger
 * that comes back down brings them back; one lifted short leaves them as they
 * were, since nothing moved. One lifted past it takes them for good.
 */
export function SwipeHint({
  active,
  seat,
  lean,
  next,
}: {
  active: boolean;
  seat: RefObject<HTMLElement | null>;
  lean: RefObject<number>;
  next: string;
}) {
  const { language } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const [phone, setPhone] = useState(false);
  // already swiped in this tab: nothing, from the start
  const [done, setDone] = useState(readMoved);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px) and (hover: none)');
    const sync = () => setPhone(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  // Swiped while the words were not up — before the opening was written, or
  // away from the first stop and back: they have missed their moment for good.
  // (Mid-swipe they are still up, and leave by the finger instead.)
  const wanted = active && phone;
  if (!wanted && !done && readMoved()) setDone(true);

  const on = wanted && !done;

  useEffect(() => {
    if (!on) return;
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const t0 = performance.now();
    // how much of the first lean has been seen (0..1) — it only ever grows —
    // and how far up the finger is from where it went down
    let seen = 0;
    let fromY: number | null = null;
    let up = 0;
    let leaving = false;
    let raf = 0;
    let timer = 0;

    // a lifted finger hands the opacity to a short transition, either way
    const ease = (to: number, then?: () => void) => {
      el.classList.add('is-easing');
      el.style.opacity = String(to);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        el.classList.remove('is-easing');
        then?.();
      }, 240);
    };

    const tick = (now: number) => {
      const s = seat.current;
      if (s) {
        const r = s.getBoundingClientRect();
        el.style.transform = `translate(${r.left + r.width / 2 + SWIPE_OFFSET.x}px, ${r.top + r.height / 2 + SWIPE_OFFSET.y}px)`;
      }
      if (!leaving && !el.classList.contains('is-easing')) {
        // they arrive with the dot's first lean, at the pace of its going out;
        // with motion reduced there is no lean, so they are simply there
        if (reduce) {
          if (now - t0 > 1200) seen = 1;
        } else if (seen < 1) {
          seen = Math.max(seen, Math.min(1, (lean.current ?? 0) / (LEAN * 0.98)));
        }
        el.style.opacity = String(seen * (1 - Math.min(1, up / SWIPE_PX)));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const onDown = (e: TouchEvent) => {
      fromY = e.touches.length === 1 ? e.touches[0].clientY : null;
      up = 0;
    };
    const onMove = (e: TouchEvent) => {
      if (fromY === null || e.touches.length !== 1) return;
      up = Math.max(0, fromY - e.touches[0].clientY);
      el.classList.remove('is-easing');
    };
    const onLift = () => {
      if (fromY === null) return;
      fromY = null;
      if (up > SWIPE_PX) {
        leaving = true;
        ease(0, () => setDone(true));
      } else if (up > 0) {
        up = 0;
        ease(seen);
      }
    };
    window.addEventListener('touchstart', onDown, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onLift, { passive: true });
    window.addEventListener('touchcancel', onLift, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
      window.removeEventListener('touchstart', onDown);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onLift);
      window.removeEventListener('touchcancel', onLift);
    };
  }, [on, seat, lean]);

  if (!on) return null;
  return (
    <div ref={ref} className="swipe-hint" aria-hidden="true">
      <span>{language === 'ko' ? '스와이프' : 'swipe'}</span>
      <span className="first-hint__sep">·</span>
      <span className="swipe-hint__arrow">↑</span>
      <span>{next}</span>
    </div>
  );
}
