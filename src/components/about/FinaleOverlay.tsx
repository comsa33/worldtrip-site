import { useI18n } from '../../i18n';
import './AboutOverlay.css';

/**
 * The last stop, back in Gwangju. Same block as the opening, but this one is
 * written by the travelling dot itself: it leaves the globe, stands up into a
 * cursor at the head of the eyebrow, writes the lines, and folds down into the
 * full stop of the last one — and stays there, in accent. The words are all in
 * the document from the first byte; only their paint waits for the hand.
 * TravelingDot does the writing; this component only lays the paper.
 */
export default function FinaleOverlay({ visible }: { visible: boolean }) {
  const { language } = useI18n();
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
    <div className="about-overlay about-overlay--finale">
      {/* the dot's host: it flies here, writes, and sits down at the end */}
      <div className="about-overlay__card" data-dot-active="" data-dot-write="">
        <h2 className="about-overlay__title">{typed(t.title)}</h2>
        <p className="about-overlay__subtitle">{typed(t.subtitle)}</p>
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
