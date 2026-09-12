import { useEffect, useState } from 'react';
import { interludeBetween, type CityVisit, type Leg } from '../../lib/visitPhotos';
import countriesData from '../../data/countries.json';

const NAMES = Object.fromEntries(
  (
    countriesData as { countries: { code: string; name: { ko: string; en: string } }[] }
  ).countries.map((c) => [c.code, c.name])
);
const countryName = (code: string, lang: 'ko' | 'en') => NAMES[code]?.[lang] ?? code;

/** Past this many stops the walk stops being a walk and becomes the journey. */
const TOO_MANY = 12;

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
  /* Gwangju's second and third stays have 257 days, 122 stops and 24 countries
     between them — the whole journey, essentially. Listing those countries ran
     the rule off the screen and took the sheet's rows with it. So past three
     they are counted, not named. */
  const where =
    countries.length > 3
      ? lang === 'ko'
        ? `${countries.length}개 나라`
        : `${countries.length} countries`
      : countries.length
        ? countries.map((c) => countryName(c, lang)).join(', ')
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
  // one mark per country crossed, keeping the order the journey took them in
  const byCountry: Leg[] = [];
  for (const l of legs) {
    const last = byCountry[byCountry.length - 1];
    if (last && last.country === l.country) last.endDate = l.endDate;
    else byCountry.push({ ...l, city: countryName(l.country, lang) });
  }
  const folded = legs.length > TOO_MANY;
  const walk = folded ? byCountry : legs;

  const seenOn: Record<string, number> = {};
  const marks = walk.map((l, i) => {
    const base = ((+new Date(l.startDate) - t0) / 86400000 / span) * 100;
    const n = (seenOn[l.startDate] = (seenOn[l.startDate] ?? -1) + 1);
    return {
      ...l,
      i,
      left: `${Math.min(99, Math.max(1, base + n * 2.6)).toFixed(2)}%`,
      walked: l.transport === 'trek',
      crossed:
        !folded && i > 0 && walk[i - 1].country !== l.country
          ? `${walk[i - 1].country} → ${l.country}`
          : null,
      // the journey turns a year once and turns it mid-stay: Bulgaria's
      // 12.31–01.02 reads backwards unless the year is said somewhere
      turned:
        l.endDate.slice(0, 4) !== (i > 0 ? walk[i - 1].endDate : l.startDate).slice(0, 4)
          ? l.endDate.slice(0, 4)
          : null,
    };
  });

  /* The one stop that explains the detour. Walking is the rare way to arrive,
     so a leg reached on foot wins over a longer one reached by bus — otherwise
     Bhaktapur's four nights outrank the six days of Annapurna. */
  const nights = (l: Leg) => (+new Date(l.endDate) - +new Date(l.startDate)) / 86400000;
  const pool = folded ? walk : walk.filter((l) => l.transport === 'trek');
  const peakIdx = walk.indexOf(
    (pool.length ? pool : walk).reduce((b, l) => (nights(l) > nights(b) ? l : b))
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

      {open && walk.length > 0 && (
        <div className={`pb__way${narrow ? ' is-down' : ''}`}>
          {narrow ? (
            <ol className="pb__waylist">
              {marks.map((m, i) => (
                <li key={`${m.city}-${i}`} className={i === peakIdx ? 'is-peak' : undefined}>
                  <span className="pb__waydot" />
                  <span className="pb__wayname mono">{m.city}</span>
                  <span className="pb__waywhen mono">{MDD(m.startDate, m.endDate)}</span>
                  {m.turned && <span className="pb__wayyear mono">{m.turned}</span>}
                  {!folded && m.walked && (
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
