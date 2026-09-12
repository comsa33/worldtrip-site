import { useEffect, useState } from 'react';
import { interludeBetween, type CityVisit, type Leg } from '../../lib/visitPhotos';

/** The rail's spelling: 10.31, 05.24 — month kept at two digits. */
const MD = (d: string) => d.slice(5).replace('-', '.');
const MDD = (a: string, b: string) => (a === b ? MD(a) : `${MD(a)}–${MD(b)}`);

/** Narrow enough that a horizontal timeline cannot hold a Korean city name. */
function useNarrow() {
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    const on = () => setNarrow(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return narrow;
}

/**
 * The seam between two stays in the same city.
 *
 * A city visited twice is not the same thing twice — there is a reason the
 * journey came back, and the reason is the stops in between. Varanasi's two
 * visits have fifteen days of Nepal and the Annapurna trek between them;
 * Cusco's have Machu Picchu; Abu Dhabi's have an afternoon in Sharjah. So the
 * rule that separates them says what it was, and opens to show the way.
 *
 * Wide: the stops lie along a line, spaced by the days they actually took.
 * Narrow: the same walk runs top to bottom — "싯다르타나가르" alone is a third
 * of a phone's width — and the extra room gives every stop its dates.
 */
export function VisitSeam({
  from,
  to,
  lang,
}: {
  from: CityVisit;
  to: CityVisit;
  lang: 'ko' | 'en';
}) {
  const [open, setOpen] = useState(false);
  const narrow = useNarrow();
  const gap = interludeBetween(from.stopId, to.stopId);
  if (!gap) return null;

  const { days, legs, countries } = gap;
  const spanLabel =
    lang === 'ko'
      ? days === 0
        ? '같은 날'
        : `${days}일`
      : days === 0
        ? 'same day'
        : `${days} ${days === 1 ? 'day' : 'days'}`;
  const where = countries.length
    ? countries.join(', ')
    : legs.length
      ? legs[0].city
      : lang === 'ko'
        ? '바로'
        : 'straight back';
  const summary = legs.length
    ? `${spanLabel} · ${where}${legs.length > 1 ? ` · ${legs.length}${lang === 'ko' ? '곳' : ' stops'}` : ''}`
    : spanLabel;

  /* ── where each stop sits on the line ──────────────────────────────────
     By the day it was reached, not by its position in the list: a border run
     and a week of walking should not get the same width. Stops that share a
     day are nudged apart so they read as separate marks. */
  const t0 = +new Date(from.endDate);
  const span = Math.max(1, (+new Date(to.startDate) - t0) / 86400000);
  const seenOn: Record<string, number> = {};
  const marks = legs.map((l, i) => {
    const base = ((+new Date(l.startDate) - t0) / 86400000 / span) * 100;
    const n = (seenOn[l.startDate] = (seenOn[l.startDate] ?? -1) + 1);
    return {
      ...l,
      i,
      left: `${Math.min(99, Math.max(1, base + n * 2.6)).toFixed(2)}%`,
      walked: l.transport === 'trek',
      crossed:
        i > 0 && legs[i - 1].country !== l.country ? `${legs[i - 1].country} → ${l.country}` : null,
    };
  });

  /* The one stop that explains the detour. Walking is the rare way to arrive,
     so a leg reached on foot wins over a longer one reached by bus — otherwise
     Bhaktapur's four nights outrank the six days of Annapurna. */
  const nights = (l: Leg) => (+new Date(l.endDate) - +new Date(l.startDate)) / 86400000;
  const pool = legs.filter((l) => l.transport === 'trek');
  const peakIdx = legs.indexOf(
    (pool.length ? pool : legs).reduce((b, l) => (nights(l) > nights(b) ? l : b))
  );

  const label = `${MD(from.endDate)} → ${MD(to.startDate)}, ${summary}`;

  return (
    <div className={`pb__seam${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="pb__seambar"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={label}
      >
        <span className="pb__seamdate mono">{MD(from.endDate)}</span>
        <span className="pb__seamrule" />
        <span className="pb__seamsum mono">{summary}</span>
        <span className="pb__seamrule" />
        <span className="pb__seamdate mono">{MD(to.startDate)}</span>
        <span className="pb__seamchev" aria-hidden="true">
          {open ? '⌃' : '⌄'}
        </span>
      </button>

      {open && legs.length > 0 && (
        <div className={`pb__way${narrow ? ' is-down' : ''}`}>
          {narrow ? (
            <ol className="pb__waylist">
              {marks.map((m, i) => (
                <li key={`${m.city}-${i}`} className={i === peakIdx ? 'is-peak' : undefined}>
                  <span className="pb__waydot" />
                  <span className="pb__wayname mono">{m.city}</span>
                  <span className="pb__waywhen mono">{MDD(m.startDate, m.endDate)}</span>
                  {m.walked && (
                    <span className="pb__waywalk mono">{lang === 'ko' ? '걸어서' : 'on foot'}</span>
                  )}
                  {m.crossed && <span className="pb__waywalk mono">{m.crossed}</span>}
                </li>
              ))}
            </ol>
          ) : (
            <div className="pb__wayline">
              <span className="pb__waybase" />
              {marks.map((m, i) => (
                <span
                  key={`${m.city}-${i}`}
                  className={`pb__waystop${i === peakIdx ? ' is-peak' : ''}`}
                  style={{ left: m.left }}
                  title={`${m.city} · ${MDD(m.startDate, m.endDate)}`}
                >
                  {m.crossed && <span className="pb__wayborder mono">{m.crossed}</span>}
                  <span className="pb__waydot" />
                  {/* only the stop that explains the detour is named here —
                      four stops share 10.31 and their names would collide.
                      The rest say who they are on hover, and in full on a
                      phone, where the walk runs down the screen. */}
                  {i === peakIdx && <span className="pb__wayname mono">{m.city}</span>}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
