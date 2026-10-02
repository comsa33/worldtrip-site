/**
 * The one place a theme is chosen (H2′ + H2″): a line of words under the top
 * bar, with no plate under it. The photo book and the globe both put it there,
 * and both read the same choice (lib/photoThemes).
 *
 * - While the hand is busy elsewhere (a drag, autoplay, a scrub) the row steps
 *   back to 0.12 and comes back 300ms after it stops. The fade is a CSS
 *   transition, so a change halfway carries on from wherever it is. A mouse on
 *   the row, or on the area it belongs to (the top bar), brings it back at once.
 * - A theme chosen, the other words go to 42%; left alone for two seconds they
 *   fold into 3px dots, one dot a word, and open again under the hand.
 * - On a phone the row runs sideways and the chosen word comes to the second
 *   place from the left, so the word before it still says there are more.
 */
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { THEMES, THEME_TOTAL, setPhotoTheme, usePhotoTheme } from '../../lib/photoThemes';
import './ThemeRow.css';

type Lang = 'ko' | 'en';

const FOLD_AFTER_MS = 2000;

export function ThemeRow({
  lang,
  moving = false,
  halo = false,
  wake,
  className = '',
}: {
  lang: Lang;
  /** the hand is busy elsewhere: step back */
  moving?: boolean;
  /** over the globe: letters carry a halo of the ground (--ground) instead of a plate */
  halo?: boolean;
  /** a mouse over this (the top bar) brings the row back at once, like a mouse over the row */
  wake?: RefObject<HTMLElement | null>;
  className?: string;
}) {
  const theme = usePhotoTheme();
  const rowRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  const [touchedAt, setTouchedAt] = useState(0);
  /** which (theme, touch) the fold timer last ran out for — a new touch or theme unfolds by itself */
  const [foldedFor, setFoldedFor] = useState<string | null>(null);
  const foldKey = `${theme}:${touchedAt}`;
  const folded = Boolean(theme) && !hovered && foldedFor === foldKey;

  // a mouse over the top bar wakes the row too
  useEffect(() => {
    const el = wake?.current;
    if (!el) return;
    const on = (e: PointerEvent) => e.pointerType === 'mouse' && setHovered(true);
    const off = (e: PointerEvent) => e.pointerType === 'mouse' && setHovered(false);
    el.addEventListener('pointerenter', on);
    el.addEventListener('pointerleave', off);
    return () => {
      el.removeEventListener('pointerenter', on);
      el.removeEventListener('pointerleave', off);
    };
  }, [wake]);

  // fold two seconds after the last touch, only while a theme is chosen and nothing is over the row
  useEffect(() => {
    if (!theme || hovered) return;
    const t = window.setTimeout(() => setFoldedFor(foldKey), FOLD_AFTER_MS);
    return () => window.clearTimeout(t);
  }, [theme, hovered, foldKey]);

  // phone: the chosen word to the second place from the left
  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row || row.scrollWidth <= row.clientWidth + 1) return;
    const items = Array.from(row.querySelectorAll<HTMLElement>('[data-w]'));
    const at = items.findIndex((el) => el.dataset.w === (theme ?? ''));
    const pad = parseFloat(getComputedStyle(row).paddingLeft) || 0;
    const left = at > 0 ? items[at - 1].offsetLeft - pad : 0;
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // after the fold has changed the widths
    const t = window.setTimeout(
      () => row.scrollTo({ left, behavior: smooth ? 'smooth' : 'auto' }),
      folded ? 260 : 0
    );
    return () => window.clearTimeout(t);
  }, [theme, folded]);

  const touch = () => setTouchedAt((n) => n + 1);
  const away = moving && !hovered;

  return (
    <div
      ref={rowRef}
      className={`theme-row${halo ? ' is-halo' : ''}${away ? ' is-away' : ''}${hovered ? ' is-woken' : ''}${theme ? ' is-picked' : ''}${folded ? ' is-folded' : ''} ${className}`}
      role="group"
      aria-label={lang === 'ko' ? '사진 주제' : 'Photo themes'}
      // the row is not a swipe of the photo or a drag of the globe
      onPointerDown={(e) => {
        e.stopPropagation();
        touch();
      }}
      onPointerEnter={(e) => e.pointerType === 'mouse' && setHovered(true)}
      onPointerLeave={(e) => e.pointerType === 'mouse' && setHovered(false)}
      onFocus={touch}
      // folded, the first tap only opens the row: a dot is too small to aim at
      onClickCapture={(e) => {
        if (!folded) return;
        e.preventDefault();
        e.stopPropagation();
        touch();
      }}
    >
      <button
        type="button"
        data-w=""
        className={`theme-row__w theme-row__all${theme ? '' : ' is-on'}`}
        aria-pressed={!theme}
        onClick={() => setPhotoTheme(null)}
      >
        <span className="theme-row__label">{lang === 'ko' ? '전체' : 'All'}</span>
      </button>
      {THEMES.map((t) => {
        const on = t.id === theme;
        return (
          <button
            type="button"
            key={t.id}
            data-w={t.id}
            className={`theme-row__w${on ? ' is-on' : ''}`}
            aria-pressed={on}
            aria-label={folded && !on ? t[lang] : undefined}
            onClick={() => {
              setPhotoTheme(on ? null : t.id);
              touch();
            }}
          >
            <span className="theme-row__dot" aria-hidden="true" />
            <span className="theme-row__label">
              {t[lang]}
              {on && <span className="theme-row__n">{THEME_TOTAL[t.id]}</span>}
            </span>
          </button>
        );
      })}
      <span className="theme-row__keys" aria-hidden="true">
        <kbd>←</kbd>
        <kbd>→</kbd>
        <span>{lang === 'ko' ? '켜진 곳' : 'lit'}</span>
      </span>
    </div>
  );
}
