import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../i18n';
import { setSound, soundAnalyser, useSoundMood, useSoundOn, type Mood } from '../../lib/sound';

const N = 25;
/** calm is one slow wave; bright, two quick ones; orbit, one tall wave barely moving */
const SHAPE: Record<Mood, { periods: number; amp: number; run: number }> = {
  calm: { periods: 1, amp: 2.2, run: 5 },
  bright: { periods: 2, amp: 2.6, run: 11 },
  orbit: { periods: 1, amp: 3.2, run: 1.6 },
};

const wavePoints = (periods: number, amp: number, phase: number) =>
  Array.from({ length: N }, (_, i) => {
    const x = 1 + (16 * i) / (N - 1);
    const y = 7 + Math.sin((i / (N - 1)) * Math.PI * 2 * periods + phase) * amp;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ');

const REST = wavePoints(1, SHAPE.calm.amp, 0);

/**
 * The sound's switch, among the header's marks: a wave, which is what sound is
 * drawn as on every map legend and mixing desk — not a speaker. Silent, the wave
 * holds still. On, it runs, and it swells with how loud the sound is right now,
 * read from the same analyser the speakers are fed from. Its speed comes up and
 * goes down on a curve, so switching off lets the wave coast to a stop where it
 * is rather than snapping back. Under the hand a still wave stirs, once. And
 * it has the song's shape: one slow wave for the calm song, two quick ones for
 * the bright song the autoplay brings in, drawn out from one into the other.
 */
export function SoundToggle() {
  const { language } = useI18n();
  const on = useSoundOn();
  const mood = useSoundMood();
  const moodRef = useRef(mood);
  const line = useRef<SVGPolylineElement>(null);
  const [reduce] = useState(
    () =>
      typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
  const onRef = useRef(on);
  const stir = useRef(0);
  const raf = useRef(0);
  const state = useRef({ phase: 0, speed: 0, amp: SHAPE.calm.amp, periods: 1, last: 0 });

  // draws while the wave is moving, and stops once it has coasted to rest
  const run = () => {
    if (raf.current || reduce) return;
    const td = new Uint8Array(256);
    state.current.last = performance.now();
    const tick = (now: number) => {
      const el = line.current;
      const s = state.current;
      if (!el) {
        raf.current = 0;
        return;
      }
      const dt = Math.min(0.05, (now - s.last) / 1000);
      s.last = now;
      stir.current = Math.max(0, stir.current - dt * 1.6);
      const shape = SHAPE[moodRef.current];
      const wantSpeed = onRef.current ? shape.run : stir.current * shape.run * 0.6;
      s.speed += (wantSpeed - s.speed) * Math.min(1, dt * 3);
      s.phase += s.speed * dt;
      s.periods += (shape.periods - s.periods) * Math.min(1, dt * 5);
      let wantAmp = shape.amp;
      const analyser = onRef.current ? soundAnalyser() : null;
      if (analyser) {
        analyser.getByteTimeDomainData(td);
        let sum = 0;
        for (let i = 0; i < td.length; i++) {
          const v = (td[i] - 128) / 128;
          sum += v * v;
        }
        wantAmp = Math.min(3.4, shape.amp + Math.sqrt(sum / td.length) * 8);
      }
      s.amp += (wantAmp - s.amp) * Math.min(1, dt * 8);
      el.setAttribute('points', wavePoints(s.periods, s.amp, s.phase));
      const resting =
        !onRef.current &&
        stir.current === 0 &&
        s.speed < 0.02 &&
        Math.abs(s.amp - shape.amp) < 0.02 &&
        Math.abs(s.periods - shape.periods) < 0.01;
      raf.current = resting ? 0 : requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  };

  useEffect(() => {
    onRef.current = on;
    moodRef.current = mood;
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, mood]);
  useEffect(
    () => () => {
      cancelAnimationFrame(raf.current);
      raf.current = 0;
    },
    []
  );

  // M, anywhere on the page but a field being typed in
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'm' && e.key !== 'M') return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      const target = e.target as HTMLElement | null;
      if (target && (['INPUT', 'TEXTAREA'].includes(target.tagName) || target.isContentEditable))
        return;
      setSound(!onRef.current);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const label =
    language === 'ko'
      ? on
        ? '배경 소리 끄기'
        : '배경 소리 켜기'
      : on
        ? 'Turn sound off'
        : 'Turn sound on';

  return (
    <button
      type="button"
      className="sound-toggle"
      onClick={() => setSound(!on)}
      onPointerEnter={() => {
        if (onRef.current) return;
        stir.current = 1;
        run();
      }}
      aria-label={label}
      aria-pressed={on}
      title={label}
    >
      <svg width="18" height="14" viewBox="0 0 18 14" aria-hidden="true">
        <polyline
          ref={line}
          points={REST}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.25"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <kbd className="key sound-toggle__key">M</kbd>
    </button>
  );
}
