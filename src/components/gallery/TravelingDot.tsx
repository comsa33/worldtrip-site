import { useEffect, useRef } from 'react';
import './TravelingDot.css';

/** A little over the transform transition, so a return home can settle. */
const FLIGHT_MS = 560;

/** A move shorter than this is a nudge, not a journey — no deformation. */
const JOURNEY_PX = 6;

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
 * A host that carries `data-dot-follow` is one that moves on its own (the
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

    /** The one arrival that is not on the way to somewhere else. */
    const scheduleLand = (host: HTMLElement) => {
      window.clearTimeout(landing);
      ball?.removeAttribute('data-land');
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
        dot.setAttribute('data-ready', 'true');
        currentHost = host;
        scheduleLand(host);
      }
      // while pinned, the frame loop owns the transform
      if (!following) goTo(spotOf(host));
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
      attributeFilter: ['data-dot-active', 'data-dot-end', 'data-dot-follow', 'cx', 'cy', 'class'],
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
