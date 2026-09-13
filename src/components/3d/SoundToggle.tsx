import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../i18n';
import { setSound, soundAnalyser, useSoundOn } from '../../lib/sound';

const N = 21;
/** one full wave across the mark, at rest */
const REST_AMP = 2.2;
/** how fast the wave runs when the sound is on, in radians a second */
const RUN = 5;

const wavePoints = (phase: number, amp: number) =>
  Array.from({ length: N }, (_, i) => {
    const x = 1 + (16 * i) / (N - 1);
    const y = 7 + Math.sin((i / (N - 1)) * Math.PI * 2 + phase) * amp;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ');

const REST = wavePoints(0, REST_AMP);

/**
 * The sound's switch, among the header's marks: a wave, which is what sound is
 * drawn as on every map legend and mixing desk — not a speaker. Silent, the wave
 * holds still. On, it runs, and it swells with how loud the sound is right now,
 * read from the same analyser the speakers are fed from. Its speed comes up and
 * goes down on a curve, so switching off lets the wave coast to a stop where it
 * is rather than snapping back. Under the hand a still wave stirs, once.
 */
export function SoundToggle() {
  const { language } = useI18n();
  const on = useSoundOn();
  const line = useRef<SVGPolylineElement>(null);
  const [reduce] = useState(
    () =>
      typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
  const onRef = useRef(on);
  const stir = useRef(0);
  const raf = useRef(0);
  const state = useRef({ phase: 0, speed: 0, amp: REST_AMP, last: 0 });

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
      const wantSpeed = onRef.current ? RUN : stir.current * RUN * 0.6;
      s.speed += (wantSpeed - s.speed) * Math.min(1, dt * 3);
      s.phase += s.speed * dt;
      let wantAmp = REST_AMP;
      const analyser = onRef.current ? soundAnalyser() : null;
      if (analyser) {
        analyser.getByteTimeDomainData(td);
        let sum = 0;
        for (let i = 0; i < td.length; i++) {
          const v = (td[i] - 128) / 128;
          sum += v * v;
        }
        wantAmp = Math.min(3.4, REST_AMP + Math.sqrt(sum / td.length) * 8);
      }
      s.amp += (wantAmp - s.amp) * Math.min(1, dt * 8);
      el.setAttribute('points', wavePoints(s.phase, s.amp));
      const resting =
        !onRef.current && stir.current === 0 && s.speed < 0.02 && Math.abs(s.amp - REST_AMP) < 0.02;
      raf.current = resting ? 0 : requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  };

  useEffect(() => {
    onRef.current = on;
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on]);
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
