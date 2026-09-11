import { useEffect, useRef } from 'react';
import { useI18n } from '../../i18n';
import './AboutOverlay.css';

interface AboutOverlayProps {
  visible: boolean;
}

/* ---- typing, once per load ---------------------------------------------
 * The words are all in the document from the first byte — only their paint
 * waits — so search engines and screen readers see the whole block, and a
 * reader who scrolls back up later finds it simply there. */
let written = false;

const CHAR_MS = 55;
const JITTER_MS = 20;
/** A space is a beat; punctuation is a breath; a new line is a new thought. */
const PAUSE: Record<string, number> = {
  ' ': 40,
  ',': 260,
  '.': 700,
  '!': 700,
  '?': 700,
  '\n': 420,
  '"': 90,
};
const BLOCK_PAUSE_MS = 900;
/** The cursor waits at the start, the way a hand does before the first word. */
const LEAD_MS = 1200;
/** Now and then, at the start of a word, the hand stops to think. */
const THINK_CHANCE = 0.12;
const THINK_MS: [number, number] = [450, 1100];

function Typed({ text }: { text: string }) {
  return (
    <>
      {Array.from(text).map((ch, i) => (
        <span key={i} data-ch="">
          {ch}
        </span>
      ))}
    </>
  );
}

export default function AboutOverlay({ visible }: AboutOverlayProps) {
  const { language } = useI18n();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root || !visible) return;
    const chars = Array.from(root.querySelectorAll<HTMLElement>('[data-ch]'));
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (written || reduced || chars.length === 0) {
      root.classList.add('is-done');
      return;
    }
    written = true;

    const caret = document.createElement('span');
    caret.className = 'about-overlay__caret';
    caret.setAttribute('aria-hidden', 'true');
    const timers: number[] = [];
    const wait = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, ms));

    let i = 0;
    let handSpeed = 1; // this word's pace: some words come easily, some do not
    const between = (a: number, b: number) => a + Math.random() * (b - a);
    const step = () => {
      if (i >= chars.length) {
        // written. The cursor folds down into the full stop of the last line
        // and takes the ink of the type around it — the sentence's own period,
        // left by the hand that wrote it.
        caret.classList.remove('is-blink');
        caret.classList.add('is-period');
        root.classList.add('is-done', 'is-typed');
        return;
      }
      const el = chars[i];
      const ch = el.textContent ?? '';
      const prev = i > 0 ? (chars[i - 1].textContent ?? '') : ' ';
      const startsWord = ch !== ' ' && ch !== '\n' && (prev === ' ' || prev === '\n');
      // a word begins: a new pace, and now and then a moment's thought first
      if (startsWord && el.dataset.thought === undefined) {
        handSpeed = between(0.7, 1.4);
        if (Math.random() < THINK_CHANCE) {
          caret.classList.add('is-blink');
          wait(between(THINK_MS[0], THINK_MS[1]), step);
          // the pause is spent; next tick writes this character
          handSpeed = between(0.85, 1.1);
          chars[i].dataset.thought = '';
          return;
        }
      }
      el.classList.add('is-on');
      delete el.dataset.thought;
      // the caret stands where the next character will go
      el.after(caret);
      const next = chars[i + 1];
      // between blocks (a different parent) the hand lifts for a moment
      const blockChange = next && next.parentElement !== el.parentElement;
      const pause = (PAUSE[ch] ?? 0) + (blockChange ? BLOCK_PAUSE_MS : 0);
      caret.classList.toggle('is-blink', pause > 200);
      i += 1;
      wait(Math.max(8, CHAR_MS * handSpeed + (Math.random() * 2 - 1) * JITTER_MS + pause), step);
    };
    // the cursor comes first: it stands at the head of the eyebrow and blinks,
    // the way a hand waits before the first word
    chars[0].before(caret);
    caret.classList.add('is-blink');
    wait(LEAD_MS, step);

    return () => {
      timers.forEach(clearTimeout);
      caret.remove();
      // leaving mid-sentence: the words are simply there
      root.classList.add('is-done');
    };
  }, [visible, language]);

  if (!visible) return null;

  const content = {
    ko: {
      title: '여정의 시작',
      subtitle: '2016년 7월, 광주',
      story: `18살, 대학 입시를 준비하던 시절 우연히 읽었던 
"바람난 부부의 세계일주"라는 책이 있었습니다.

9년간 운영하던 영어학원과 차를 정리하고,
배낭 하나 메고 무계획으로 떠났습니다.`,
      quote: '지금 아니면 영영 못 갈 것 같았다',
    },
    en: {
      title: 'The Beginning',
      subtitle: 'July 2016, Gwangju',
      story: `At 18, while preparing for college entrance exams,
I came across a book called "Around the World Journey."

After running an English academy for 9 years,
I sold everything and left with just a backpack.`,
      quote: 'If not now, then never',
    },
  };

  const t = content[language as 'ko' | 'en'] || content.ko;

  return (
    <div className="about-overlay" ref={ref}>
      <div className="about-overlay__card">
        <h2 className="about-overlay__title">
          <Typed text={t.title} />
        </h2>
        <p className="about-overlay__subtitle">
          <Typed text={t.subtitle} />
        </p>
        <p className="about-overlay__story">
          <Typed text={t.story} />
        </p>
        <blockquote className="about-overlay__quote">
          <Typed text={`"${t.quote}"`} />
          {/* the full stop, when no cursor is around to leave one */}
          <span className="about-overlay__period" aria-hidden="true" />
        </blockquote>
      </div>
    </div>
  );
}
