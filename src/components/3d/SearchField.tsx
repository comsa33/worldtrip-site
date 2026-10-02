/**
 * The site's name in the header, and the search that comes out of it: the
 * dot stands up as the caret after the name, and the words are written there.
 *
 * Under the drawing there is a real <input type="search"> with its own caret
 * hidden: the dot is pinned (data-dot-follow) to a seat right after the
 * typed text, and what the hand is doing is said through data-dot-carry —
 * a caret while writing, blinking when the hand pauses, lying down and
 * breathing once the words have gone, a full stop when nothing answered.
 * The input stays mounted (a sliver, when closed) so that a press on the
 * mark can focus it in the same gesture, which is what the phone's keyboard
 * needs. The mark itself is the home of the dot: while the dot is away it
 * is a ring, and the ring is the door.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useI18n } from '../../i18n';
import {
  closeSearch,
  MAX_QUERY_CHARS,
  openSearch,
  setSearchText,
  submitSearch,
  useSearch,
} from '../../lib/search';
import './SearchField.css';

/** After a keystroke the caret stands still this long before it blinks again. */
const STILL_MS = 480;

export function SearchField({ brand }: { brand: string }) {
  const { language } = useI18n();
  const search = useSearch();
  const open = search.mode !== 'closed';
  // the dot is here while the words are written and until they are answered;
  // with an answer it is back on the globe, and the words stay as they were
  const seated = search.mode === 'open' || search.mode === 'waiting' || search.mode === 'none';
  const inputRef = useRef<HTMLInputElement>(null);
  const mirrorRef = useRef<HTMLSpanElement>(null);
  const [typing, setTyping] = useState(false);

  // the input is as wide as its words: the seat after it is where they end
  useLayoutEffect(() => {
    const input = inputRef.current;
    const mirror = mirrorRef.current;
    if (!input || !mirror) return;
    if (!open) {
      input.style.width = '';
      input.style.marginRight = '';
      return;
    }
    // On a touch screen the input is set in 16px, which is the size under
    // which iOS zooms the page to it, and drawn scaled down to the brand's
    // size (--q-scale, SearchField.css). Its box is still the unscaled width,
    // so it is laid out wider and pulled back by the difference, and the seat
    // after it stays right after the words as they are seen.
    const k = parseFloat(getComputedStyle(input).getPropertyValue('--q-scale')) || 1;
    const w = Math.ceil(mirror.offsetWidth) + 2;
    input.style.width = `${w / k}px`;
    input.style.marginRight = k < 1 ? `${w - w / k}px` : '';
  }, [search.text, open]);

  // opened from the keyboard (/): the focus has to follow
  useEffect(() => {
    if (search.mode === 'open' && document.activeElement !== inputRef.current) {
      inputRef.current?.focus();
    }
  }, [search.mode]);

  // a cursor stands still while the hand writes and blinks when it pauses
  useEffect(() => {
    if (!typing) return;
    const t = window.setTimeout(() => setTyping(false), STILL_MS);
    return () => window.clearTimeout(t);
  }, [typing, search.text]);

  const carry =
    search.mode === 'open'
      ? typing
        ? 'caret'
        : 'caret-blink'
      : search.mode === 'waiting'
        ? 'wait'
        : '';

  const label = language === 'ko' ? '여정에서 찾기' : 'Search the journey';
  return (
    <div className="journey-header__brand search-field" data-mode={search.mode}>
      <button
        type="button"
        className="search-field__mark"
        aria-label={label}
        title={open ? undefined : `${label} (/)`}
        onClick={() => {
          // in the gesture itself, so the phone brings its keyboard
          openSearch();
          inputRef.current?.focus();
        }}
      >
        <span className="journey-header__dot" data-dot-home aria-hidden="true" />
      </button>
      <span className="search-field__name">{brand}</span>
      <span ref={mirrorRef} className="search-field__mirror" aria-hidden="true">
        {search.text}
      </span>
      <input
        ref={inputRef}
        className="search-field__input"
        type="search"
        value={search.text}
        maxLength={MAX_QUERY_CHARS}
        aria-label={label}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        enterKeyHint="search"
        tabIndex={open ? 0 : -1}
        onFocus={openSearch}
        onChange={(e) => {
          setTyping(true);
          setSearchText(e.target.value);
        }}
        onKeyDown={(e) => {
          // the journey's own keys (← → space) are letters here
          e.stopPropagation();
          if (e.nativeEvent.isComposing) return;
          if (e.key === 'Enter') {
            e.preventDefault();
            void submitSearch();
            // the words are sent: the keys are the journey's again (and the
            // phone's keyboard goes)
            inputRef.current?.blur();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            closeSearch();
            inputRef.current?.blur();
          }
        }}
        onBlur={() => {
          // a tap elsewhere with nothing written is the same as Esc
          if (search.mode === 'open' && !search.text.trim()) closeSearch();
        }}
      />
      {seated && (
        <span
          className="search-field__seat"
          data-dot-follow=""
          data-dot-active=""
          data-dot-carry={carry}
          aria-hidden="true"
        />
      )}
    </div>
  );
}
