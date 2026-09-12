import { useEffect, useRef } from 'react';
import { useI18n } from '../../i18n';
import { typewrite } from './typewriter';
import { useDotAnchor } from './useDotAnchor';
import './AboutOverlay.css';

/**
 * The last stop, back in Gwangju. Same block as the opening, but this one is
 * written by the travelling dot itself: it leaves the globe, stands up into a
 * cursor at the head of the eyebrow, writes the lines, and folds down into the
 * full stop of the last one — and stays there, in accent. The words are all in
 * the document from the first byte; only their paint waits for the hand.
 * The hand is the same one the opening uses. What moves through the text is
 * an inline seat — in the flow of the line, so it is exactly where a cursor
 * would be — and the travelling dot is pinned to that seat, shaped as a caret
 * while it writes and as the full stop once it has.
 */
let written = false;

export default function FinaleOverlay({ visible }: { visible: boolean }) {
  const { language } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  // under the dot's last place on the globe — it steps down from there into the words
  useDotAnchor(root, visible);

  useEffect(() => {
    const host = ref.current;
    if (!host || !visible) return;
    const chars = Array.from(host.querySelectorAll<HTMLElement>('[data-ch]'));
    const seat = host.querySelector<HTMLElement>('.about-overlay__seat');
    if (!seat || chars.length === 0) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const sitDown = () => {
      chars[chars.length - 1].after(seat);
      seat.setAttribute('data-dot-carry', 'land:1');
      host.classList.add('is-done');
      host.setAttribute('data-dot-sitting', '');
    };
    if (written || reduced) {
      sitDown();
      return;
    }
    written = true;
    // the dot arrives first; the hand starts once it is standing
    seat.setAttribute('data-dot-carry', 'caret-blink');
    const stop = typewrite(chars, {
      at: (el, after) => (after ? el.after(seat) : el.before(seat)),
      blink: (on) => seat.setAttribute('data-dot-carry', on ? 'caret-blink' : 'caret'),
      done: sitDown,
    });
    return () => {
      stop();
      host.classList.add('is-done');
      host.removeAttribute('data-dot-sitting');
    };
  }, [visible, language]);

  if (!visible) return null;

  const content = {
    ko: {
      subtitle: '2017년 7월, 다시 광주',
      title: '여정의 끝',
      story: `처음엔 그냥 궁금했습니다.
지친 현실에서 좀 벗어나고 싶기도 했고요.
그러다 보니 어느새, 나도 모르게
파라다이스 같은 곳을 찾아다니고 있었습니다.

330일을 돌고 다시 광주에 내렸습니다.
행복은 내가 어디에 있느냐보다
내가 있는 곳을 어떻게 받아들이느냐에
더 가까운 것 같았습니다.`,
      quote: '뭐, 그럴 수도 있겠다 싶었습니다',
    },
    en: {
      subtitle: 'July 2017, Gwangju again',
      title: 'The End',
      story: `At first I was just curious.
Part of it was wanting a break from a life I was tired of.
Somewhere along the way, without quite noticing,
I'd started looking for a paradise.

330 days later I got off in Gwangju again.
Being happy seemed to have less to do with where I was
than with how I took the place I was in.`,
      quote: "Maybe that's how it is, I thought",
    },
  };
  const t = content[language as 'ko' | 'en'] || content.ko;
  const typed = (text: string) =>
    Array.from(text).map((ch, i) => (
      <span key={i} data-ch="">
        {ch}
      </span>
    ));

  return (
    <div className="about-overlay about-overlay--finale" ref={root}>
      <div className="about-overlay__card" ref={ref}>
        {/* the seat: in the flow of the line, moved through the text by the hand.
            The dot is pinned to it. */}
        <span
          className="about-overlay__seat"
          data-dot-active=""
          data-dot-follow=""
          data-dot-carry="caret-blink"
          aria-hidden="true"
        />
        <p className="about-overlay__subtitle">{typed(t.subtitle)}</p>
        <h2 className="about-overlay__title">{typed(t.title)}</h2>
        <p className="about-overlay__story">{typed(t.story)}</p>
        <blockquote className="about-overlay__quote">
          {typed(`"${t.quote}"`)}
          {/* the full stop, for when the dot has gone back to the globe */}
          <span
            className="about-overlay__period about-overlay__period--accent"
            aria-hidden="true"
          />
        </blockquote>
      </div>
    </div>
  );
}
