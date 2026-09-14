import { memo, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import minimap from '../../data/minimap.json';
import citiesData from '../../data/cities.json';
import countriesData from '../../data/countries.json';
import { srcFor } from '../../lib/photoSrc';
import {
  JOURNEY_DAYS,
  cityLabel,
  dayOf,
  journeyRoll,
  jumpTo,
  rollNo,
  rollDays,
  stopOrder,
  type RollBlock,
} from '../../lib/journeyRoll';

/*
 * The photo book with its walls taken down: every stop's photos, one after
 * another, in the order the journey walked them. Three pieces live here and
 * PhotoGallery places them — the sheet itself, the small map in the top bar
 * that says where the reading is, and the year under the sheet that says when.
 * Each fact has one place: the city is the top bar's name, the where is the
 * map, the day is the head of the year, the change of place is a seam.
 */

type Lang = 'ko' | 'en';

const CITIES = citiesData.cities as Record<
  string,
  { ko: string; en: string; lat: number; lng: number }
>;
const COUNTRY = Object.fromEntries(
  (
    countriesData as { countries: { code: string; name: { ko: string; en: string } }[] }
  ).countries.map((c) => [c.code, c.name])
);
const HOW: Record<string, { ko: string; en: string }> = {
  start: { ko: '출발', en: 'start' },
  bus: { ko: '버스', en: 'bus' },
  train: { ko: '기차', en: 'train' },
  flight: { ko: '비행기', en: 'flight' },
  boat: { ko: '보트', en: 'boat' },
  trek: { ko: '걸어서', en: 'on foot' },
};

const MD = (d: string) => d.slice(5, 10).replace('-', '.');

/** The seam at the head of a stop: the day, a rule, and how the journey got here. */
function seamText(b: RollBlock, lang: Lang) {
  const crossed = b.prev && b.prev.country !== b.stop.country;
  const how = HOW[b.stop.transport]?.[lang] ?? '';
  const where = cityLabel(b.stop.city, lang);
  const border = crossed
    ? `${COUNTRY[b.prev!.country]?.[lang] ?? b.prev!.country} → ${COUNTRY[b.stop.country]?.[lang] ?? b.stop.country} · `
    : '';
  return {
    crossed: Boolean(crossed),
    text: `${border}${how ? `${how} · ` : ''}${where}${b.visit > 1 ? ` ×${b.visit}` : ''}`,
  };
}

// =============================================================================
// the sheet
// =============================================================================

interface SheetProps {
  scroller: RefObject<HTMLDivElement | null>;
  current: number;
  perRow: number;
  lang: Lang;
  onOpen: (i: number, el: HTMLElement) => void;
  /** the first and last photo in view, whenever either changes */
  onRead: (top: number, bottom: number) => void;
  onHover: (i: number | null) => void;
}

/**
 * Memoised on purpose: 2,303 tiles are drawn once, and the reading position,
 * the hover and the year beside them change without touching a single tile.
 */
export const JourneySheet = memo(function JourneySheet({
  scroller,
  current,
  perRow,
  lang,
  onOpen,
  onRead,
  onHover,
}: SheetProps) {
  const { photos, blocks } = journeyRoll;

  // open on the photo that was being looked at, a third of the way down
  useLayoutEffect(() => {
    // a stop opened from its start (the header's door) begins at its seam;
    // a photo opened from inside a stop keeps some of what came before it
    const block = journeyRoll.blocks[journeyRoll.blockOf[current]];
    jumpTo(scroller.current, current, block?.start === current ? 'top' : 'focus');
    // only on arrival: after that the scroll belongs to the reader
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // what is under the top and the bottom edge, read once a frame at most
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let raf = 0;
    let last = '';
    const at = (x: number, y: number) => {
      for (const dy of [0, 8, -8, 16]) {
        const hit = document
          .elementFromPoint(x, y + dy)
          ?.closest<HTMLElement>('[data-i],[data-seam]');
        const v = hit?.dataset.i ?? hit?.dataset.seam;
        if (v !== undefined) return Number(v);
      }
      return -1;
    };
    const read = () => {
      raf = 0;
      const r = el.getBoundingClientRect();
      const x = r.left + Math.min(60, r.width / 2);
      const top = at(x, r.top + 30);
      const bottom = at(x, r.bottom - 30);
      if (top < 0) return;
      const key = `${top}:${bottom}`;
      if (key === last) return;
      last = key;
      onRead(top, Math.max(top, bottom));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(read);
    };
    read();
    el.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      el.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      cancelAnimationFrame(raf);
    };
  }, [scroller, onRead]);

  return (
    <div
      className="pb__sheet pb__sheet--roll"
      ref={scroller}
      role="grid"
      aria-label={lang === 'ko' ? '여정의 모든 사진' : 'Every photo of the journey'}
      onPointerOver={(e) => {
        if (e.pointerType !== 'mouse') return;
        const hit = (e.target as HTMLElement).closest<HTMLElement>('[data-i]');
        onHover(hit ? Number(hit.dataset.i) : null);
      }}
      onPointerLeave={() => onHover(null)}
    >
      {blocks.map((b) => {
        const seam = seamText(b, lang);
        const rows: number[][] = [];
        for (let i = 0; i < b.count; i += perRow) {
          rows.push(
            Array.from({ length: Math.min(perRow, b.count - i) }, (_, k) => b.start + i + k)
          );
        }
        return (
          <section className="pb__stop" key={b.stop.id}>
            <div className={`pb__stopseam${seam.crossed ? ' is-border' : ''}`} data-seam={b.start}>
              <span className="pb__seamdate mono">{MD(b.stop.startDate)}</span>
              <span className="pb__seamrule" />
              <span className="pb__seamsum mono">{seam.text}</span>
            </div>
            {rows.map((row, r) => {
              // a short last row keeps the sheet's height instead of blowing
              // one photo up to the full width: the missing places stay empty
              const rest = perRow - row.length;
              return (
                <div className="pb__sheetrow" role="row" key={r}>
                  {row.map((i) => {
                    const p = photos[i];
                    const ar = p.w && p.h ? p.w / p.h : 4 / 3;
                    return (
                      <button
                        type="button"
                        key={p.id}
                        role="gridcell"
                        data-i={i}
                        className={`pb__cell${i === current ? ' is-current' : ''}`}
                        style={{ '--ar': String(ar) } as React.CSSProperties}
                        onClick={(e) => onOpen(i, e.currentTarget)}
                        aria-label={`${rollNo(i)} · ${cityLabel(b.stop.city, lang)}`}
                      >
                        <img src={srcFor(p, 320)} alt="" loading="lazy" decoding="async" />
                        <span className="pb__cellno mono">{rollNo(i)}</span>
                      </button>
                    );
                  })}
                  {rest > 0 && (
                    <span
                      className="pb__cellgap"
                      style={{ '--ar': String(rest * (4 / 3)) } as React.CSSProperties}
                      aria-hidden="true"
                    />
                  )}
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
});

// =============================================================================
// where — the site's minimap, drawn small in the top bar
// =============================================================================

const MAP = minimap as { scale: number; translate: number[]; land: string; legs: string[] };

function project(lat: number, lng: number): [number, number] {
  const phi = (lat * Math.PI) / 180;
  const lambda = (lng * Math.PI) / 180;
  const p2 = phi * phi;
  const p4 = p2 * p2;
  const x =
    lambda * (0.8707 - 0.131979 * p2 + p4 * (-0.013791 + p4 * (0.003971 * p2 - 0.001529 * p4)));
  const y = phi * (1.007226 + p2 * (0.015085 + p4 * (-0.044475 + 0.028874 * p2 - 0.005916 * p4)));
  return [MAP.translate[0] + MAP.scale * x, MAP.translate[1] - MAP.scale * y];
}

const Land = memo(function Land({ order }: { order: number }) {
  return (
    <>
      <path d={MAP.land} className="minimap__land" />
      {MAP.legs.map((d, i) => (
        <path key={i} d={d} className={`minimap__leg${i + 1 <= order ? ' is-past' : ''}`} />
      ))}
    </>
  );
});

/**
 * The world, the route in its two tenses up to the stop being read, and a seat
 * for the dot there. The seat moves when the reading crosses into another stop
 * and the dot, following it, slides rather than jumps.
 */
export function RollLocator({ index, dot }: { index: number; dot: boolean }) {
  const block = journeyRoll.blocks[journeyRoll.blockOf[index]];
  const city = block ? CITIES[block.stop.city] : null;
  const order = block ? stopOrder(block.stop.id) : 0;
  const [x, y] = city ? project(city.lat, city.lng) : [500, 250];
  return (
    <span className="pb__locator" aria-hidden="true">
      <svg viewBox="0 0 1000 500" preserveAspectRatio="xMidYMid meet">
        <Land order={order} />
      </svg>
      <span
        className="pb__locseat"
        style={{ left: `${x / 10}%`, top: `${y / 5}%` }}
        data-dot-active={dot ? '' : undefined}
        data-dot-follow={dot ? '' : undefined}
      />
    </span>
  );
}

// =============================================================================
// when — the year, one bar a day, as tall as the photos it left
// =============================================================================

const WAVE_H = 40;
const wavePath = (from: number, to: number, inside: boolean) => {
  let d = '';
  for (let day = 1; day <= JOURNEY_DAYS; day++) {
    if (day >= from && day <= to ? !inside : inside) continue;
    const n = rollDays.count[day];
    const h = n ? Math.min(WAVE_H, 2 + Math.sqrt(n) * 6) : 1;
    d += `M${day - 0.5} ${WAVE_H}V${WAVE_H - h}`;
  }
  return d;
};

const MONTHS = (() => {
  const out: { day: number; label: string }[] = [];
  const d0 = Date.parse(journeyRoll.photos[0]?.date.slice(0, 10) ?? '2016-08-13');
  const start = new Date(d0);
  for (let m = 0; m < 12; m++) {
    const at = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + m, 1));
    const day = Math.max(1, dayOf(at.toISOString()));
    const mm = at.getUTCMonth() + 1;
    out.push({ day, label: mm === 1 ? String(at.getUTCFullYear()) : String(mm).padStart(2, '0') });
  }
  return out;
})();

/**
 * The scrollbar is the year. Dragging it does not glide the sheet through two
 * thousand rows — that would be motion sickness — it puts the first photo of
 * the day under the pointer at the top, row by row as the hand moves.
 */
export function YearWave({
  top,
  bottom,
  hover,
  lang,
  onScrub,
}: {
  top: number;
  bottom: number;
  hover: number | null;
  lang: Lang;
  onScrub: (i: number) => void;
}) {
  const photos = journeyRoll.photos;
  const readDay = photos[top]?.date ? dayOf(photos[top].date) : 1;
  const endDay = photos[bottom]?.date ? dayOf(photos[bottom].date) : readDay;
  const hoverPhoto = hover !== null ? photos[hover] : null;
  const hoverDay = hoverPhoto?.date ? dayOf(hoverPhoto.date) : null;
  const ref = useRef<HTMLDivElement>(null);
  const [scrubbing, setScrubbing] = useState(false);

  const pct = (day: number) => `${((day - 0.5) / JOURNEY_DAYS) * 100}%`;

  const scrubTo = (clientX: number) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const day = Math.min(
      JOURNEY_DAYS,
      Math.max(1, Math.ceil(((clientX - r.left) / r.width) * JOURNEY_DAYS))
    );
    // a day without photos gives the next day that has some
    for (let d = day; d <= JOURNEY_DAYS; d++) {
      if (rollDays.first[d] >= 0) return onScrub(rollDays.first[d]);
    }
  };

  const block = journeyRoll.blocks[journeyRoll.blockOf[top]];
  const readCity = block ? cityLabel(block.stop.city, lang) : '';

  return (
    <div
      className={`pb__wave${scrubbing ? ' is-scrub' : ''}`}
      ref={ref}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        setScrubbing(true);
        scrubTo(e.clientX);
      }}
      onPointerMove={(e) => {
        if (scrubbing) scrubTo(e.clientX);
      }}
      onPointerUp={() => setScrubbing(false)}
      onPointerCancel={() => setScrubbing(false)}
      role="slider"
      aria-label={lang === 'ko' ? '여정의 날' : 'Day of the journey'}
      aria-valuemin={1}
      aria-valuemax={JOURNEY_DAYS}
      aria-valuenow={readDay}
    >
      <div className="pb__waveplot">
        <svg
          viewBox={`0 0 ${JOURNEY_DAYS} ${WAVE_H}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path className="pb__wavebars" d={wavePath(readDay, endDay, false)} />
          <path className="pb__wavebars is-in" d={wavePath(readDay, endDay, true)} />
        </svg>
        {hoverDay !== null && hoverPhoto && !scrubbing && (
          <span className="pb__wavehover mono" style={{ left: pct(hoverDay) }}>
            <span>{`${MD(hoverPhoto.date)} ${hoverPhoto.date.slice(11, 16)}`}</span>
          </span>
        )}
        <span
          className={`pb__wavehead mono${readDay > JOURNEY_DAYS * 0.12 ? '' : ' is-right'}`}
          style={{ left: pct(readDay) }}
        >
          <span>{scrubbing ? `DAY ${readDay} · ${readCity}` : `DAY ${readDay}`}</span>
        </span>
        <span className="pb__wavemonths mono" aria-hidden="true">
          {MONTHS.map((m) => (
            <span key={m.day} style={{ left: pct(m.day) }}>
              {m.label}
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}
