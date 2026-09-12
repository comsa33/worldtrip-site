import { useCallback, useMemo, useRef } from 'react';
import { Kbd } from './FirstStep';
import { useI18n } from '../../i18n';

interface ScrubberStop {
  id: number;
  city: string;
  country: string;
  transport: string;
  startDate?: string;
  endDate?: string;
}

interface Tick {
  progress: number;
  label?: string;
  kind: 'month' | 'country';
}

const MONTHS = [
  '2016-08',
  '2016-09',
  '2016-10',
  '2016-11',
  '2016-12',
  '2017-01',
  '2017-02',
  '2017-03',
  '2017-04',
  '2017-05',
  '2017-06',
  '2017-07',
];

const knownDate = (d?: string) => (d && !d.includes('?') ? d : null);

/**
 * Bottom timeline. Drag, click or key through the 135 stops; every move goes back
 * through `onSeek` so the page scroll stays the single source of `progress`.
 */
export function Scrubber({
  stops,
  stopProgress,
  progress,
  currentStopIdx,
  cityName,
  countryName,
  playing,
  onSeek,
  onTogglePlay,
}: {
  stops: ScrubberStop[];
  stopProgress: number[];
  progress: number;
  currentStopIdx: number;
  cityName: string;
  countryName: string;
  playing: boolean;
  onSeek: (progress: number, mode: 'drag' | 'jump') => void;
  onTogglePlay: () => void;
}) {
  const { language } = useI18n();
  const hitRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const ticks = useMemo<Tick[]>(() => {
    const out: Tick[] = [];
    MONTHS.forEach((m, i) => {
      const idx = stops.findIndex((s) => {
        const d = knownDate(s.startDate) ?? knownDate(s.endDate);
        return d !== null && d.slice(0, 7) >= m;
      });
      if (idx < 0) return;
      const label = i === 0 || m.endsWith('-01') ? m.replace('-', '.') : m.slice(5);
      out.push({ progress: i === 0 ? 0 : stopProgress[idx], label, kind: 'month' });
    });
    stops.forEach((s, i) => {
      if (i > 0 && s.country !== stops[i - 1].country) {
        out.push({ progress: stopProgress[i], kind: 'country' });
      }
    });
    return out;
  }, [stops, stopProgress]);

  const progressFromEvent = useCallback((clientX: number) => {
    const el = hitRef.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width));
  }, []);

  const snap = useCallback(
    (p: number) => {
      let best = 0;
      let bestD = Infinity;
      stopProgress.forEach((sp, i) => {
        const d = Math.abs(sp - p);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      return stopProgress[best];
    },
    [stopProgress]
  );

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    onSeek(progressFromEvent(e.clientX), 'drag');
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    onSeek(progressFromEvent(e.clientX), 'drag');
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
    onSeek(snap(progressFromEvent(e.clientX)), 'jump');
  };

  const stop = stops[currentStopIdx];
  const date = knownDate(stop?.startDate) ?? knownDate(stop?.endDate);
  const pct = progress * 100;
  const countries = useMemo(() => new Set(stops.map((s) => s.country)).size, [stops]);
  // 여정 일수: 첫 출발일 ~ 마지막 도착일 (stops가 바뀌면 같이 따라간다)
  const totalDays = useMemo(() => {
    const first = stops[0]?.startDate;
    const last = stops[stops.length - 1]?.endDate ?? stops[stops.length - 1]?.startDate;
    if (!first || !last) return 0;
    const ms = new Date(last).getTime() - new Date(first).getTime();
    return Math.round(ms / 86400000) + 1;
  }, [stops]);

  const ko = language === 'ko';

  return (
    <div className="scrubber" role="group" aria-label="Timeline">
      <div
        className={`scrubber__label mono${pct < 10 ? ' is-start' : pct > 90 ? ' is-end' : ''}`}
        style={{ left: `${pct}%` }}
      >
        {date && <span className="scrubber__date">{date.replaceAll('-', '.')}</span>}
        <span className="scrubber__place">
          {cityName} · {countryName}
        </span>
      </div>

      <div
        ref={hitRef}
        className="scrubber__hit"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="scrubber__track" />
        <div className="scrubber__fill" style={{ width: `${pct}%` }} />
        {ticks.map((t, i) => (
          <span
            key={i}
            className={`scrubber__tick scrubber__tick--${t.kind}${t.progress <= progress ? ' is-past' : ''}`}
            style={{ left: `${t.progress * 100}%` }}
          >
            {t.label && <em className="scrubber__month mono">{t.label}</em>}
          </span>
        ))}
        <input
          type="range"
          className="scrubber__range"
          min={0}
          max={stops.length - 1}
          step={1}
          value={currentStopIdx}
          onChange={(e) => onSeek(stopProgress[Number(e.target.value)], 'jump')}
          aria-label={language === 'ko' ? '여정 위치' : 'Journey position'}
        />
        <div className="scrubber__head" style={{ left: `${pct}%` }} />
      </div>

      <div className="scrubber__foot mono">
        <button
          type="button"
          className="scrubber__play"
          onClick={onTogglePlay}
          aria-pressed={playing}
        >
          {playing ? (language === 'ko' ? '정지' : 'Stop') : language === 'ko' ? '재생' : 'Play'}
        </button>
        <span className="scrubber__hint">
          <Kbd>space</Kbd>
          <span>{ko ? '자동 재생' : 'play'}</span>
          <span className="scrubber__hint-sep">·</span>
          <Kbd>←</Kbd>
          <Kbd>→</Kbd>
          <span>{ko ? '이동' : 'move'}</span>
          <span className="scrubber__hint-sep">·</span>
          <span>{ko ? '드래그로 스크럽' : 'drag to scrub'}</span>
        </span>
        <span className="scrubber__stats">
          <span>
            <b>{totalDays}</b> days
          </span>
          <span>
            <b>{countries}</b> countries
          </span>
          <span>
            <b>{stops.length}</b> stops
          </span>
          <span>
            <b>82,100</b> km
          </span>
          <a className="scrubber__credit" href="https://www.openstreetmap.org/copyright">
            © OpenStreetMap
          </a>
        </span>
      </div>
    </div>
  );
}
