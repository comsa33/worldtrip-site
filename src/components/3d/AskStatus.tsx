/**
 * Under the words, what became of them (K2 · N1): one line — a 15px ring,
 * then the state's name, then what can be done — and, when nothing was found,
 * the themes that came near and other words to try.
 *
 * The ring ends the way the orange spark on the globe ends, at the same
 * moment (scanClock): drawn shut when the spark reached the end of the route
 * and found nothing; broken where the spark stopped on a fault; broken with a
 * waiting dot while the rate limit counts down; dotted when it never set off
 * (offline). While the words are out it is a small orange arc going round.
 * The ring is the same stroke as the city rings on the globe — not a glyph.
 */
import { useEffect, useRef, useState } from 'react';
import { ASK_COPY } from '../../lib/askCopy';
import { THEMES, THEME_TOTAL, setPhotoTheme } from '../../lib/photoThemes';
import { scanEnding } from '../../lib/scanClock';
import { WORDS_ALONE, WORDS_WITH_THEMES, wordsToTry } from '../../lib/askWords';
import {
  askedWords,
  clearSearch,
  retrySearch,
  setSearchText,
  submitSearch,
  type SearchState,
} from '../../lib/search';

type Lang = 'ko' | 'en';

/** Seconds left until `until`, counting down live. */
function useCountdown(until: number): number {
  const [now, setNow] = useState(() => Date.now());
  const left = Math.max(0, Math.ceil((until - now) / 1000));
  useEffect(() => {
    if (left <= 0) return;
    const t = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(t);
  }, [until, left]);
  return left;
}

/** True once `at` (ms epoch) has passed — re-rendering at that moment. */
function useAfter(at: number): boolean {
  const [now, setNow] = useState(() => Date.now());
  const past = now >= at;
  useEffect(() => {
    if (past || !Number.isFinite(at)) return;
    // measured now, in the effect: `now` is when this last rendered, not the clock
    const t = window.setTimeout(() => setNow(Date.now()), Math.max(0, at - Date.now()));
    return () => window.clearTimeout(t);
  }, [at, now, past]);
  return past;
}

type Kind = 'arc' | 'closed' | 'broken' | 'broken-dot' | 'dotted';

/** The ring: one circle, drawn four ways. */
function Ring({ kind, on }: { kind: Kind; on: boolean }) {
  return (
    <svg
      className="askring"
      data-kind={kind}
      data-on={on ? '' : undefined}
      viewBox="0 0 16 16"
      aria-hidden="true"
    >
      <circle className="askring__c" cx="8" cy="8" r="6.4" />
      {kind === 'broken-dot' && <circle className="askring__dot" cx="13.2" cy="3.4" r="1.1" />}
    </svg>
  );
}

export function AskStatus({
  search,
  lang,
  days,
  stops,
  examples,
}: {
  search: SearchState;
  lang: Lang;
  days: number;
  stops: number;
  examples: string[];
}) {
  const t = ASK_COPY[lang];
  const groupsRef = useRef<HTMLDivElement>(null);

  // when the spark stops (`hold`) and, finding nothing, reaches the end (`end`)
  const since = 'since' in search ? search.since : 0;
  const at = 'at' in search ? search.at : 0;
  const ending = since ? scanEnding(since, at) : { hold: at, end: at };
  const held = useAfter(search.mode === 'waiting' ? Infinity : ending.hold);
  const ended = useAfter(search.mode === 'none' ? ending.end : Infinity);

  // the rate limit counts down, then 「다시 시도」 can be pressed
  const retryAt = search.mode === 'error' ? search.retryAt : 0;
  const left = useCountdown(retryAt);

  // off the net: the moment it is back, the same words go again, once
  const offline = search.mode === 'error' && search.fault === 'offline';
  const offlineText = offline ? search.text : '';
  useEffect(() => {
    if (!offline || !offlineText) return;
    const again = () => retrySearch();
    window.addEventListener('online', again, { once: true });
    return () => window.removeEventListener('online', again);
  }, [offline, offlineText]);

  if (search.mode === 'waiting') {
    return (
      <div className="askdot__status" data-state="waiting" aria-live="polite">
        <Ring kind="arc" on />
        <span className="askdot__state mono">{t.searching(days, stops)}</span>
      </div>
    );
  }

  if (search.mode === 'error') {
    if (!held) return null;
    const { fault } = search;
    const kind: Kind = fault === 'offline' ? 'dotted' : fault === 'rate' ? 'broken-dot' : 'broken';
    const name =
      fault === 'offline'
        ? t.offline
        : fault === 'rate'
          ? t.tooMany
          : fault === 'timeout'
            ? t.noResponse
            : t.failed;
    const counting = fault === 'rate' && left > 0;
    return (
      <div className="askdot__status is-fault" data-state={fault} aria-live="polite">
        <Ring kind={kind} on />
        <span className="askdot__state">{name}</span>
        <span className="askdot__sep">·</span>
        {fault === 'offline' ? (
          <span className="askdot__state askdot__state--soft">{t.offlineWait}</span>
        ) : counting ? (
          <span className="askdot__state askdot__state--soft mono">{t.retryIn(left)}</span>
        ) : (
          <button type="button" className="askdot__act" onClick={retrySearch}>
            {t.retry}
          </button>
        )}
      </div>
    );
  }

  if (search.mode !== 'none') return null;

  const themes = search.themes ?? [];
  const near = themes
    .map((n) => THEMES.find((th) => th.id === n.id))
    .filter((th): th is (typeof THEMES)[number] => Boolean(th));
  const words = wordsToTry(
    examples,
    search.text,
    near.length ? WORDS_WITH_THEMES : WORDS_ALONE,
    askedWords()
  );

  /* the suggestions as one keyboard: ← → within a group, ↓ ↑ between groups,
     ↑ from the top back to the words */
  const onKeys = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const root = groupsRef.current;
    const el = e.target as HTMLElement;
    if (!root || !el.classList.contains('askdot__word')) return;
    const group = el.closest<HTMLElement>('.askdot__group');
    if (!group) return;
    const groups = Array.from(root.querySelectorAll<HTMLElement>('.askdot__group'));
    const gi = groups.indexOf(group);
    const focusFirst = (g: HTMLElement | undefined) =>
      g?.querySelector<HTMLElement>('.askdot__word')?.focus();
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const words = Array.from(group.querySelectorAll<HTMLElement>('.askdot__word'));
      const i = words.indexOf(el) + (e.key === 'ArrowRight' ? 1 : -1);
      words[Math.max(0, Math.min(words.length - 1, i))]?.focus();
    } else if (e.key === 'ArrowDown') {
      focusFirst(groups[gi + 1]);
    } else if (e.key === 'ArrowUp') {
      if (gi > 0) focusFirst(groups[gi - 1]);
      else document.querySelector<HTMLElement>('.askdot__input')?.focus();
    } else return;
    e.preventDefault();
  };

  return (
    <div className="askdot__none" data-on={ended ? '' : undefined}>
      <div className="askdot__status" data-state="none">
        <Ring kind="closed" on={ended} />
        <span className="askdot__state">{t.none}</span>
        <span className="askdot__sep">·</span>
        <span className="askdot__state askdot__state--soft mono">{t.noneCount(days, stops)}</span>
      </div>
      <div className="askdot__groups" ref={groupsRef} onKeyDown={onKeys}>
        {near.length > 0 && (
          <div className="askdot__group">
            <span className="askdot__label mono">{t.nearby}</span>
            {near.map((th, i) => (
              <button
                type="button"
                key={th.id}
                className="askdot__word"
                style={{ '--i': i } as React.CSSProperties}
                onClick={() => {
                  // the theme chosen, as from the row; the field goes
                  setPhotoTheme(th.id);
                  clearSearch();
                }}
              >
                {th[lang]}
                <span className="askdot__count mono">{THEME_TOTAL[th.id] ?? ''}</span>
              </button>
            ))}
          </div>
        )}
        {words.length > 0 && (
          <div className="askdot__group">
            <span className="askdot__label mono">{t.tryInstead}</span>
            {words.map((w, i) => (
              <button
                type="button"
                key={w}
                className="askdot__word"
                style={{ '--i': i + near.length } as React.CSSProperties}
                onClick={() => {
                  // the words become these, and go at once
                  setSearchText(w);
                  void submitSearch(w);
                }}
              >
                {w}
              </button>
            ))}
          </div>
        )}
      </div>
      <span className="sr-only" aria-live="polite">
        {ended
          ? t.saidNone(
              near.map((th) => th[lang]),
              words
            )
          : ''}
      </span>
    </div>
  );
}
