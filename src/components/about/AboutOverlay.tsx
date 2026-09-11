import { useEffect, useRef } from 'react';
import { useI18n } from '../../i18n';
import { typewrite } from './typewriter';
import './AboutOverlay.css';

interface AboutOverlayProps {
  visible: boolean;
}

/* ---- typing, once per load ---------------------------------------------
 * The words are all in the document from the first byte — only their paint
 * waits — so search engines and screen readers see the whole block, and a
 * reader who scrolls back up later finds it simply there. */
let written = false;

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
