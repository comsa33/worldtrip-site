/**
 * Asking the dot (K2). The dot is the "me" of the site: pressed, it leaves the
 * globe and stands up as the caret of a large field in the middle of the
 * screen, the page dimming behind. Examples write themselves in the field
 * until a hand does. Sent, the dot lies down and breathes while a spark runs
 * the route (RouteScan). The answer stands under the words — the city, the
 * month, a picture, the next few — and the dot moves to sit by the city's
 * name. Enter, and it flies there.
 *
 * Under the drawing is a real <input> with its own caret hidden (the dot is
 * the caret, pinned to a seat after the words). The field is always mounted,
 * so a press on the door can focus it in the same gesture — which is what the
 * phone's keyboard needs — and it steps aside for the keyboard with the
 * visual viewport.
 */
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import journeyData from '../../data/journey.json';
import citiesData from '../../data/cities.json';
import { useI18n } from '../../i18n';
import { photosForStop } from '../../lib/visitPhotos';
import { srcFor } from '../../lib/photoSrc';
import { cityLabel } from '../../lib/journeyRoll';
import { hasTheme, usePhotoTheme } from '../../lib/photoThemes';
import { focusAskField, setAskField } from '../../lib/askField';
import { AskStatus } from './AskStatus';
import {
  closeSearch,
  confirmAnswer,
  expandAnswer,
  LIST_FIRST,
  LIST_MOST,
  MAX_QUERY_CHARS,
  openSearch,
  pickAnswer,
  setSearchText,
  submitSearch,
  useLearned,
  useSearch,
} from '../../lib/search';
import './AskDot.css';

const stops = journeyData.stops;
const stopById = new Map(stops.map((s) => [s.id, s]));
const countries = (citiesData as { countries: Record<string, { ko: string; en: string }> })
  .countries;
/** the journey, as the thinking line counts it — from the data, never typed in */
const DAYS = journeyData.totalDays;
const STOPS = stops.length;

/** The examples, in this order always — the same gesture must look the same. */
const EXAMPLES: Record<'ko' | 'en', string[]> = {
  ko: ['밤기차', '피라미드', '폭포 앞에서', '눈 덮인 마을', '시장의 아침'],
  en: ['night train', 'pyramids', 'in front of a waterfall', 'a snowy village', 'market morning'],
};
const TYPE_MS = 90;
const HOLD_MS = 1600;
const ERASE_MS = 40;
const GAP_MS = 300;
const ROUNDS = 2;

/** After a keystroke the caret stands still this long before it blinks again. */
const STILL_MS = 480;
/** The page's own dim comes off over this; the overlay stays until it has. */
const LEAVE_MS = 240;

/**
 * The examples writing themselves: letter by letter, a hold, erased backwards,
 * a breath, the next. Two rounds, then an empty field; emptied again by a
 * hand, they start over.
 */
function useGhost(active: boolean, words: string[]): string {
  const [ghost, setGhost] = useState('');
  useEffect(() => {
    let timer = 0;
    let alive = true;
    const at = (ms: number) => new Promise<void>((r) => (timer = window.setTimeout(r, ms)));
    (async () => {
      // the field is being written in: nothing to show (set after a tick, not in the effect itself)
      await at(0);
      if (!alive) return;
      if (!active) {
        setGhost('');
        return;
      }
      for (let round = 0; round < ROUNDS && alive; round++) {
        for (const w of words) {
          const letters = Array.from(w);
          for (let i = 1; i <= letters.length && alive; i++) {
            setGhost(letters.slice(0, i).join(''));
            await at(TYPE_MS);
          }
          if (!alive) return;
          await at(HOLD_MS);
          for (let i = letters.length - 1; i >= 0 && alive; i--) {
            setGhost(letters.slice(0, i).join(''));
            await at(ERASE_MS);
          }
          if (!alive) return;
          await at(GAP_MS);
        }
      }
    })();
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [active, words]);
  return ghost;
}

/** The stop's picture for the answer: the first lit one with a theme on, else the first. */
function pictureOf(stopId: number, theme: string | null) {
  const roll = photosForStop(stopId);
  return (theme && roll.find((p) => hasTheme(p.id, theme))) || roll[0];
}

const ym = (iso: string, lang: 'ko' | 'en') => {
  const y = iso.slice(0, 4);
  const m = Number(iso.slice(5, 7));
  if (lang === 'ko') return `${y}년 ${m}월`;
  return new Date(Number(y), m - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
};

export function AskDot({ phone }: { phone: boolean }) {
  const { language } = useI18n();
  const lang = language as 'ko' | 'en';
  const search = useSearch();
  const theme = usePhotoTheme();
  // up from the first press until the dot has gone or the hand left
  const open = search.mode !== 'closed';
  const text = 'text' in search ? search.text : '';
  // the overlay stays up while the dim comes off
  const [visible, setVisible] = useState(open);
  // opened: up at once (state reset during render, per React guidance)
  if (open && !visible) setVisible(true);
  useEffect(() => {
    if (open) return;
    const t = window.setTimeout(() => setVisible(false), LEAVE_MS);
    return () => window.clearTimeout(t);
  }, [open]);

  const inputRef = useRef<HTMLInputElement>(null);
  const mirrorRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = inputRef.current;
    setAskField(el);
    return () => setAskField(null);
  });

  /* Where the input's own caret is (its selection's focus end), so the dot
     can stand there — between letters, after ← →, Home, a click, a drag —
     and not only at the end. Read whenever the selection changes. */
  const [caretAt, setCaretAt] = useState(0);
  const readCaret = () => {
    const input = inputRef.current;
    if (!input) return;
    const at =
      input.selectionDirection === 'backward'
        ? (input.selectionStart ?? 0)
        : (input.selectionEnd ?? input.value.length);
    setCaretAt(at);
  };
  useEffect(() => {
    if (!open) return;
    document.addEventListener('selectionchange', readCaret);
    return () => document.removeEventListener('selectionchange', readCaret);
  }, [open]);
  // the font arriving late: what was measured in the stand-in is measured again
  const [fontsIn, setFontsIn] = useState(0);
  useEffect(() => {
    let alive = true;
    document.fonts?.ready.then(() => alive && setFontsIn((n) => n + 1));
    return () => {
      alive = false;
    };
  }, []);

  /* The input is as wide as its words, and the seat stands after the words
     up to the caret — measured in the same font, size and spacing, by two
     stand-ins — with its foot a little under the baseline, where a caret's
     is. The seat is 8px; the dot stands up from its foot to 1.1em above. */
  const toRef = useRef<HTMLSpanElement>(null);
  const seatRef = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const input = inputRef.current;
    const mirror = mirrorRef.current;
    const to = toRef.current;
    const seat = seatRef.current;
    if (!input || !mirror) return;
    if (!open) {
      input.style.width = '';
      return;
    }
    input.style.width = `${Math.ceil(mirror.offsetWidth) + 2}px`;
    if (!seat || !to) return;
    const field = mirror.parentElement!;
    const fr = field.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(mirror);
    const gr = range.getBoundingClientRect();
    const fs = parseFloat(getComputedStyle(field).fontSize) || 34;
    // the bar stands in the middle of the 8px seat: 2px after the last letter;
    // on a fault the dot lies a little apart — not the sentence's full stop
    const apart = search.mode === 'error' ? 6 : 0;
    seat.style.left = `${Math.ceil(to.offsetWidth) - 1 + apart}px`;
    seat.style.top = `${Math.round(gr.bottom - fr.top - fs * 0.12 - 8)}px`;
  }, [text, caretAt, open, fontsIn, search.mode]);

  // opened from a key (/) or the ring: the focus has to follow — and over a
  // lit answer the field opens with its words all selected: type to replace,
  // Enter to see the same answer again
  const wasOpen = useRef(false);
  useEffect(() => {
    const input = inputRef.current;
    const opening = open && !wasOpen.current;
    wasOpen.current = open;
    if (!input) return;
    if (search.mode === 'open' && document.activeElement !== input) input.focus();
    if (opening && search.mode === 'open' && text) input.select();
  }, [open, search.mode, text]);

  // a cursor stands still while the hand writes and blinks when it pauses
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    if (!typing) return;
    const t = window.setTimeout(() => setTyping(false), STILL_MS);
    return () => window.clearTimeout(t);
  }, [typing, text]);

  /* A phone's keyboard: the block goes to 38% of what is left above it. */
  const [top, setTop] = useState<number | null>(null);
  useEffect(() => {
    if (!phone || !open) return;
    const vv = window.visualViewport;
    if (!vv) return;
    const sync = () => {
      const up = vv.height < window.innerHeight - 100;
      setTop(up ? Math.round(vv.offsetTop + vv.height * 0.38) : null);
    };
    sync();
    vv.addEventListener('resize', sync);
    vv.addEventListener('scroll', sync);
    return () => {
      vv.removeEventListener('resize', sync);
      vv.removeEventListener('scroll', sync);
      setTop(null);
    };
  }, [phone, open]);

  const ghostOn = (search.mode === 'open' || search.mode === 'none') && text === '';
  const ghost = useGhost(ghostOn, EXAMPLES[lang]);

  const carry =
    search.mode === 'open'
      ? typing
        ? 'caret'
        : 'caret-blink'
      : search.mode === 'waiting'
        ? 'wait'
        : search.mode === 'error'
          ? 'fade'
          : '';
  // the dot is on the field's seat until the answer stands; then by the city
  const seated =
    search.mode === 'open' ||
    search.mode === 'waiting' ||
    search.mode === 'none' ||
    search.mode === 'error';

  const label = lang === 'ko' ? '여정에서 찾기' : 'Ask the journey';
  const answer = search.mode === 'answer' ? search : null;
  const shown = answer
    ? Math.min(answer.stops.length, answer.expanded ? LIST_MOST : LIST_FIRST)
    : 0;
  const picked = answer ? answer.stops[answer.pick] : undefined;
  const listed = answer ? answer.stops.slice(0, shown) : [];
  const beyond = answer ? Math.min(answer.stops.length, LIST_MOST) - shown : 0;
  /* The row picked opens out in its place (its picture, the month, the
     country, the photos); the others stay one line. Keys pressed in a run
     move the mark at once, but a row opens only once it has been stayed on
     for 120ms — and its picture is asked for then, with the next one's. */
  const [settledPick, setSettledPick] = useState(0);
  // a new answer: its first row is the one stayed on, at once (state reset during render)
  const [answerKey, setAnswerKey] = useState<string | null>(null);
  const key = answer ? answer.text : null;
  if (key !== answerKey) {
    setAnswerKey(key);
    if (answer) setSettledPick(answer.pick);
  }
  useEffect(() => {
    if (!answer) return;
    const t = window.setTimeout(() => setSettledPick(answer.pick), 120);
    return () => window.clearTimeout(t);
  }, [answer]);
  const opened = answer && answer.pick === settledPick ? answer.pick : -1;
  /* The dot sits by the name of the row stayed on — and stays there while the
     mark runs on ahead, hopping (200ms) to the next row only once it has been
     stayed on too. It never leaves the field while the field is up. */
  const seatRow = answer ? (settledPick < listed.length ? settledPick : answer.pick) : -1;
  useEffect(() => {
    if (!answer || opened < 0) return;
    const next = answer.stops[opened + 1];
    const p = next && pictureOf(next.id, theme);
    if (p) new Image().src = srcFor(p, 480, { exact: true });
  }, [answer, opened, theme]);
  // the row picked kept in view, within the list
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!answer) return;
    const el = listRef.current?.querySelector<HTMLElement>('.askdot__row.is-picked');
    el?.scrollIntoView({ block: 'nearest' });
  }, [answer]);
  /* A touch on a closed row only opens it; on the open row it goes. A mouse click goes. */
  const lastPointer = useRef<string>('mouse');

  if (!visible && !open) {
    // still mounted: the field, for a door's press to focus (hidden)
    return (
      <input
        ref={inputRef}
        className="askdot__input askdot__input--away"
        type="search"
        aria-hidden="true"
        tabIndex={-1}
        onFocus={() => openSearch()}
      />
    );
  }

  return (
    <div
      className="askdot"
      data-mode={search.mode}
      data-leaving={open ? undefined : ''}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      data-dot-stay=""
    >
      {/* the page steps back; a tap on it is a way out */}
      <div className="askdot__scrim" onClick={closeSearch} />
      <div
        className="askdot__centre"
        style={top !== null ? ({ '--ask-top': `${top}px` } as React.CSSProperties) : undefined}
      >
        <div className="askdot__field">
          {
            <>
              <span ref={mirrorRef} className="askdot__mirror" aria-hidden="true">
                {text || '\u200b'}
              </span>
              <span ref={toRef} className="askdot__mirror" aria-hidden="true">
                {text.slice(0, caretAt)}
              </span>
              {ghostOn && ghost && (
                <button
                  type="button"
                  className="askdot__ghost"
                  tabIndex={-1}
                  onClick={() => void submitSearch(ghost)}
                  aria-hidden="true"
                >
                  {ghost}
                </button>
              )}
              <input
                ref={inputRef}
                className="askdot__input"
                type="search"
                value={text}
                maxLength={MAX_QUERY_CHARS}
                aria-label={label}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                enterKeyHint="search"
                onFocus={() => openSearch()}
                role="combobox"
                aria-expanded={Boolean(answer)}
                aria-controls="askdot-list"
                aria-activedescendant={picked ? `askdot-opt-${picked.id}` : undefined}
                onChange={(e) => {
                  setTyping(true);
                  setSearchText(e.target.value);
                  readCaret();
                }}
                onSelect={readCaret}
                onKeyUp={readCaret}
                onClick={readCaret}
                onCompositionUpdate={readCaret}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.nativeEvent.isComposing) return;
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (search.mode === 'answer') confirmAnswer();
                    else if (search.mode === 'open' && !text.trim() && ghost)
                      void submitSearch(ghost);
                    else void submitSearch();
                    if (search.mode !== 'open') inputRef.current?.blur();
                  } else if (e.key === 'ArrowDown' && search.mode === 'none') {
                    // down into what is offered instead
                    e.preventDefault();
                    document.querySelector<HTMLElement>('.askdot__word')?.focus();
                  } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && answer) {
                    // ↑ ↓ walk the list, the preview following; ↓ past the end opens it out
                    e.preventDefault();
                    const d = e.key === 'ArrowDown' ? 1 : -1;
                    if (d > 0 && answer.pick + 1 >= shown && beyond > 0) expandAnswer();
                    pickAnswer(answer.pick + d);
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    closeSearch();
                    inputRef.current?.blur();
                  }
                }}
              />
              {seated && (
                <span
                  ref={seatRef}
                  className="askdot__seat"
                  data-dot-follow=""
                  data-dot-active=""
                  data-dot-rank="2"
                  data-dot-carry={carry}
                  aria-hidden="true"
                />
              )}
            </>
          }
        </div>

        {/* what became of the words: thinking, nothing found (and what is near), a fault */}
        <AskStatus
          search={search}
          lang={lang}
          days={DAYS}
          stops={STOPS}
          examples={EXAMPLES[lang]}
        />

        {answer && picked && (
          <div
            className={`askdot__answer${answer.expanded ? ' is-open' : ''}`}
            role="listbox"
            id="askdot-list"
            aria-label={label}
            ref={listRef}
          >
            {listed.map((r, at) => {
              const st = stopById.get(r.id);
              if (!st) return null;
              const isPicked = answer.pick === at;
              const isOpen = opened === at;
              const picture = isOpen ? pictureOf(st.id, theme) : undefined;
              const tone = picture?.tone?.split(',');
              return (
                <button
                  type="button"
                  key={r.id}
                  id={`askdot-opt-${r.id}`}
                  role="option"
                  aria-selected={isPicked}
                  className={`askdot__row${isPicked ? ' is-picked' : ''}${isOpen ? ' is-open' : ''}`}
                  onPointerDown={(e) => {
                    lastPointer.current = e.pointerType;
                  }}
                  onPointerEnter={(e) => {
                    // a mouse over a row opens it; a finger's tap is not a hover
                    if (e.pointerType === 'mouse') pickAnswer(at);
                  }}
                  onClick={() => {
                    // a finger opens a closed row and goes from the open one; a mouse goes
                    if (lastPointer.current === 'touch' && !isPicked) pickAnswer(at);
                    else confirmAnswer(r.id);
                  }}
                >
                  <span className="askdot__line1">
                    <span className="askdot__rank mono">{at + 1}</span>
                    <span className="askdot__city">
                      {cityLabel(st.city, lang)}
                      {/* the dot sits by the name of the one stayed on: this is the answer */}
                      {seatRow === at && (
                        <span
                          className="askdot__seat askdot__seat--city"
                          data-dot-active=""
                          data-dot-rank="2"
                          aria-hidden="true"
                        />
                      )}
                    </span>
                    <span className="askdot__when mono">
                      {st.startDate.slice(0, 7).replace('-', '.')}
                    </span>
                  </span>
                  {/* the row opened out: its picture, the month, the country, the photos */}
                  <span className={`askdot__more${isOpen ? ' is-on' : ''}`} aria-hidden={!isOpen}>
                    <span className="askdot__more-in">
                      <span
                        className="askdot__picture"
                        style={
                          tone?.length === 2
                            ? { background: `linear-gradient(#${tone[0]}, #${tone[1]})` }
                            : undefined
                        }
                      >
                        {picture && (
                          <img
                            src={srcFor(picture, 480, { exact: true })}
                            alt=""
                            decoding="async"
                            draggable={false}
                          />
                        )}
                      </span>
                      <span className="askdot__words">
                        <span className="askdot__title">{ym(st.startDate, lang)}</span>
                        <span className="askdot__meta mono">
                          {countries[st.countryCode]?.[lang] ?? st.countryCode}
                          <span className="askdot__sep">·</span>
                          {lang === 'ko'
                            ? `사진 ${photosForStop(st.id).length}장`
                            : `${photosForStop(st.id).length} photos`}
                          <span className="askdot__sep">·</span>
                          {lang === 'ko' ? 'Enter 로 가기' : 'Enter to go'}
                        </span>
                      </span>
                    </span>
                  </span>
                </button>
              );
            })}
            {beyond > 0 && (
              <button type="button" className="askdot__beyond mono" onClick={expandAnswer}>
                {lang === 'ko' ? `외 ${beyond}곳` : `and ${beyond} more`}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The door: one word hung on the dot — 「물어보기」 — wherever the dot is, the
 * journey or looking around (Q2). To the dot's right, on its centre line,
 * 14px off; flipped to its left at the edge of the screen. On a desktop the
 * `/` key follows the word, 8px after its last letter, in the line (no room
 * kept for it). Faint (0.7, ink-3) at rest; when the dot sits down on a stop
 * it goes dark for 1.6s and fades back — until a question has been asked,
 * after which it only rests. Looking around, the same 1.2s after the hand
 * lets go and the globe has stopped. Hidden while the globe moves. On the
 * first visit, once the opening is over, the word writes itself, letter by
 * letter, then the key comes.
 */
const DOOR_GAP_PX = 14;
const DOOR_EDGE_PX = 16;
/** looking around: the globe has stopped, and this much later the word comes */
const DOOR_SETTLE_GLOBE_MS = 1200;
/** the dark moment: in, held, out */
const DOOR_UP_IN_MS = 240;
const DOOR_UP_HOLD_MS = 1600; // and 600ms back down (AskDot.css)
/** the first visit: a pause after the dot sits, then the letters, then the key */
const DOOR_WRITE_WAIT_MS = 400;
const DOOR_LETTER_MS = 90;
const DOOR_KEY_WAIT_MS = 120;
const INTRO_KEY = 'askIntroSeen';
const seenIntro = () => {
  try {
    return localStorage.getItem(INTRO_KEY) === '1';
  } catch {
    return true;
  }
};
const noteIntro = () => {
  try {
    localStorage.setItem(INTRO_KEY, '1');
  } catch {
    /* no storage */
  }
};
const reduced = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function AskDoor({
  seat,
  active,
  moving,
  globe,
  phone,
  ground,
}: {
  seat: RefObject<HTMLElement | null>;
  /** the globe's ground colour, for the word's halo */
  ground: string;
  /** the dot is on the globe's seat and the page could ask */
  active: boolean;
  /** the hand has the globe, or it is still turning */
  moving: boolean;
  /** looking around (the globe view), where the word waits 1.2s after the hand lets go */
  globe: boolean;
  phone: boolean;
}) {
  const { language } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const wordRef = useRef<HTMLSpanElement>(null);
  const search = useSearch();
  const [settled, setSettled] = useState(!moving);
  // the hand has the globe: gone at once (state reset during render)
  if (moving && settled) setSettled(false);
  useEffect(() => {
    if (moving) return;
    const t = window.setTimeout(() => setSettled(true), globe ? DOOR_SETTLE_GLOBE_MS : 0);
    return () => window.clearTimeout(t);
  }, [moving, globe]);
  const on = active && settled && search.mode === 'closed';

  // the word, letter by letter, the first time; then simply there
  const [writing, setWriting] = useState<'wait' | 'letters' | 'done'>(() =>
    seenIntro() || reduced() ? 'done' : 'wait'
  );
  const [letters, setLetters] = useState(0);
  const [keyIn, setKeyIn] = useState(writing === 'done');
  // dark for a moment: 'in' then 'out'
  const [up, setUp] = useState(false);
  const learned = useLearned();

  const label = language === 'ko' ? '물어보기' : 'Ask';
  const count = Array.from(label).length;

  /* On coming up (the dot has sat down; looking around, the globe has stopped):
     the first time, the word writes itself and the key follows; every time,
     until a question has been asked, the word goes dark and fades back. */
  useEffect(() => {
    if (!on) {
      setUp(false);
      return;
    }
    const timers: number[] = [];
    const at = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, ms));
    const dark = (from: number) => {
      if (learned || reduced()) return;
      at(from, () => setUp(true));
      at(from + DOOR_UP_IN_MS + DOOR_UP_HOLD_MS, () => setUp(false));
    };
    if (writing === 'wait') {
      at(DOOR_WRITE_WAIT_MS, () => setWriting('letters'));
      for (let i = 1; i <= count; i++)
        at(DOOR_WRITE_WAIT_MS + i * DOOR_LETTER_MS, () => setLetters(i));
      const written = DOOR_WRITE_WAIT_MS + count * DOOR_LETTER_MS;
      at(written, () => {
        setWriting('done');
        noteIntro();
      });
      at(written + DOOR_KEY_WAIT_MS, () => setKeyIn(true));
      dark(written);
    } else dark(0);
    return () => timers.forEach((t) => window.clearTimeout(t));
    // the first appearance runs its course; a later `on` only darkens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on]);

  // pinned to the dot's seat every frame it is up, as the swipe hint is
  useEffect(() => {
    const el = ref.current;
    if (!el || !on) return;
    let raf = 0;
    const tick = () => {
      const s = seat.current;
      if (s) {
        const r = s.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const w = el.offsetWidth;
        // to the right of the dot; at the edge of the screen, to its left
        let x = cx + r.width / 2 + DOOR_GAP_PX;
        const flip = x + w > window.innerWidth - DOOR_EDGE_PX;
        if (flip) x = cx - r.width / 2 - DOOR_GAP_PX - w;
        el.toggleAttribute('data-flip', flip);
        el.style.transform = `translate(${x.toFixed(1)}px, ${(cy - el.offsetHeight / 2).toFixed(1)}px)`;
        // round the back of the world with the dot
        const carry = s.getAttribute('data-dot-carry') ?? '';
        el.toggleAttribute('data-hidden', carry === 'hidden' || carry === 'ribbon');
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [on, seat]);

  // the letters shown so far, by clipping — the word's box is always the word's own width
  const shown = writing === 'done' ? 1 : writing === 'wait' ? 0 : letters / count;
  return (
    <div
      ref={ref}
      className={`ask-door${on ? ' is-on' : ''}${up ? ' is-up' : ''}`}
      style={{ '--globe-ground': ground } as React.CSSProperties}
      aria-hidden={on ? undefined : true}
    >
      <button
        type="button"
        className="ask-door__word"
        tabIndex={on ? 0 : -1}
        aria-label={language === 'ko' ? '여정에서 묻기 (/)' : 'Ask the journey (/)'}
        onClick={() => {
          openSearch();
          // in the gesture itself, so the phone brings its keyboard
          focusAskField();
        }}
      >
        <span
          ref={wordRef}
          className="ask-door__text"
          style={{ clipPath: `inset(0 ${((1 - shown) * 100).toFixed(2)}% 0 0)` }}
        >
          {label}
        </span>
        {!phone && (
          <kbd className={`key ask-door__key${keyIn ? ' is-in' : ''}`} aria-hidden="true">
            /
          </kbd>
        )}
      </button>
    </div>
  );
}
