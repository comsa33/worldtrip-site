import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';
import journeyData from '../../data/journey.json';
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
  rollIndexForStop,
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

/** The seam of a whole country, when the sheet is at its densest and the cities fold away. */
function countrySeamText(b: RollBlock, lang: Lang) {
  const name = (c: string) => COUNTRY[c]?.[lang] ?? c;
  const crossed = b.prev && b.prev.country !== b.stop.country;
  return {
    crossed: Boolean(crossed),
    text: crossed ? `${name(b.prev!.country)} → ${name(b.stop.country)}` : name(b.stop.country),
  };
}

/** Consecutive stops in one country, as one run — what the densest sheet lays out. */
const COUNTRY_RUNS: RollBlock[][] = (() => {
  const out: RollBlock[][] = [];
  for (const b of journeyRoll.blocks) {
    const last = out[out.length - 1];
    if (last && last[0].stop.country === b.stop.country) last.push(b);
    else out.push([b]);
  }
  return out;
})();
const CITY_RUNS: RollBlock[][] = journeyRoll.blocks.map((b) => [b]);

// =============================================================================
// the sheet
// =============================================================================

interface SheetProps {
  scroller: RefObject<HTMLDivElement | null>;
  current: number;
  perRow: number;
  /** densest: the cities fold and only the countries keep their seams */
  fold: boolean;
  lang: Lang;
  /** arriving from the open photo: the photo shrinks into its tile, the rest come in round it */
  arrive: boolean;
  /** where the open photo is on the screen, read at the moment of arrival */
  origin: () => DOMRect | null;
  /** a pinch or a ⌘ wheel: +1 denser, -1 looser */
  onZoom: (step: 1 | -1) => void;
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
  fold,
  lang,
  arrive,
  origin,
  onZoom,
  onOpen,
  onRead,
  onHover,
}: SheetProps) {
  const { photos } = journeyRoll;
  const runs = fold ? COUNTRY_RUNS : CITY_RUNS;
  const homeBlock = journeyRoll.blockOf[current];

  // open on the photo that was being looked at, a third of the way down
  useLayoutEffect(() => {
    const el = scroller.current;
    // a stop opened from its start (the header's door) begins at its seam;
    // a photo opened from inside a stop keeps some of what came before it
    const block = journeyRoll.blocks[homeBlock];
    jumpTo(el, current, block?.start === current ? 'top' : 'focus');
    if (!el || !arrive) return;

    /* From the open photo: the picture goes down into its own tile, and the
       sheet gathers round it — its own stop first, the rest of the journey a
       beat later. Nothing jumps: the tile starts where the photo was. */
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const from = origin();
    const cell = el.querySelector<HTMLElement>(`[data-i="${current}"]`);
    el.classList.add('is-arriving');
    const done = window.setTimeout(() => el.classList.remove('is-arriving'), 720);
    if (from && cell) {
      const to = cell.getBoundingClientRect();
      const s = from.width / Math.max(1, to.width);
      cell.animate(
        [
          {
            transformOrigin: '0 0',
            transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${s})`,
          },
          { transformOrigin: '0 0', transform: 'none' },
        ],
        { duration: 440, easing: 'cubic-bezier(0.32, 0.72, 0, 1)' }
      );
    }
    return () => window.clearTimeout(done);
    // only on arrival: after that the scroll belongs to the reader
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── denser and looser ─────────────────────────────────────────────────
     The tile under the hand stays under the hand. Before the step, the tile
     at the point and its place on the screen are noted; after the rows have
     been laid out again, the sheet is scrolled by however far that tile moved,
     and the tile itself grows or shrinks from its old size into the new one. */
  const anchor = useRef<{ i: number; top: number; left: number; w: number } | null>(null);
  const readTop = useRef(-1);
  const zoomAt = useCallback(
    (step: 1 | -1, x: number, y: number) => {
      const hit = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-i]');
      const cell =
        hit ??
        scroller.current?.querySelector<HTMLElement>(
          `[data-i="${readTop.current >= 0 ? readTop.current : current}"]`
        );
      if (cell) {
        const r = cell.getBoundingClientRect();
        anchor.current = { i: Number(cell.dataset.i), top: r.top, left: r.left, w: r.width };
      }
      onZoom(step);
    },
    [onZoom, scroller, current]
  );
  const firstLayout = useRef(true);
  useLayoutEffect(() => {
    if (firstLayout.current) {
      firstLayout.current = false;
      return;
    }
    const el = scroller.current;
    const a = anchor.current;
    anchor.current = null;
    if (!el || !a) return;
    const cell = el.querySelector<HTMLElement>(`[data-i="${a.i}"]`);
    if (!cell) return;
    const r = cell.getBoundingClientRect();
    el.scrollTop += r.top - a.top;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const now = cell.getBoundingClientRect();
    cell.animate(
      [
        {
          transformOrigin: '0 0',
          transform: `translate(${a.left - now.left}px, 0) scale(${a.w / Math.max(1, now.width)})`,
        },
        { transformOrigin: '0 0', transform: 'none' },
      ],
      { duration: 260, easing: 'cubic-bezier(0.32, 0.72, 0, 1)' }
    );
    el.animate([{ opacity: 0.55 }, { opacity: 1 }], { duration: 220, easing: 'ease-out' });
  }, [perRow, fold, scroller]);

  // ⌘ / ctrl + wheel, which is also what a trackpad pinch arrives as; two fingers on a phone
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let acc = 0;
    let lockUntil = 0;
    const stepBy = (step: 1 | -1, x: number, y: number) => {
      const now = performance.now();
      if (now < lockUntil) return;
      lockUntil = now + 320;
      zoomAt(step, x, y);
    };
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      acc += e.deltaY;
      if (Math.abs(acc) < 40) return;
      stepBy(acc > 0 ? 1 : -1, e.clientX, e.clientY);
      acc = 0;
    };
    let base = 0;
    const spread = (t: TouchList) =>
      Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const onStart = (e: TouchEvent) => {
      if (e.touches.length === 2) base = spread(e.touches);
    };
    const onMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || !base) return;
      e.preventDefault();
      const d = spread(e.touches);
      const x = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const y = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      // fingers apart is looking closer: fewer to a row
      if (d / base > 1.3) {
        stepBy(-1, x, y);
        base = d;
      } else if (d / base < 0.77) {
        stepBy(1, x, y);
        base = d;
      }
    };
    const onEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) base = 0;
    };
    // + and − from the keyboard, holding on to what is at the top of the sheet
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const step = e.key === '+' || e.key === '=' ? -1 : e.key === '-' || e.key === '_' ? 1 : 0;
      if (!step) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      stepBy(step, r.left + Math.min(60, r.width / 2), r.top + 40);
    };
    window.addEventListener('keydown', onKey);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    return () => {
      window.removeEventListener('keydown', onKey);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, [scroller, zoomAt]);

  /* What is at the top and the bottom edge, read once a frame at most.
     Read off the layout, not off the screen: the map opens over the sheet,
     and a point under it would have said nothing. The seams and rows are
     listed once per layout and found by halving. */
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const marks = Array.from(el.querySelectorAll<HTMLElement>('.pb__stopseam, .pb__sheetrow')).map(
      (m) => ({
        top: m.offsetTop,
        i: Number(m.dataset.seam ?? m.querySelector<HTMLElement>('[data-i]')?.dataset.i ?? 0),
      })
    );
    const at = (y: number) => {
      let lo = 0;
      let hi = marks.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (marks[mid].top <= y) lo = mid;
        else hi = mid - 1;
      }
      return marks[lo]?.i ?? 0;
    };
    let raf = 0;
    let last = '';
    const read = () => {
      raf = 0;
      if (!marks.length) return;
      const top = at(el.scrollTop + 24);
      const bottom = at(el.scrollTop + el.clientHeight - 24);
      const key = `${top}:${bottom}`;
      if (key === last) return;
      last = key;
      readTop.current = top;
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
  }, [scroller, onRead, perRow, fold]);

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
      {runs.map((run) => {
        const b = run[0];
        const last = run[run.length - 1];
        const start = b.start;
        const count = last.start + last.count - start;
        const seam = fold ? countrySeamText(b, lang) : seamText(b, lang);
        const rows: number[][] = [];
        for (let i = 0; i < count; i += perRow) {
          rows.push(Array.from({ length: Math.min(perRow, count - i) }, (_, k) => start + i + k));
        }
        const home = run.some((x) => journeyRoll.blocks[homeBlock] === x);
        return (
          <section className={`pb__stop${home ? ' is-home' : ''}`} key={b.stop.id}>
            <div className={`pb__stopseam${seam.crossed ? ' is-border' : ''}`} data-seam={start}>
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
                    const city = journeyRoll.blocks[journeyRoll.blockOf[i]].stop.city;
                    return (
                      <button
                        type="button"
                        key={p.id}
                        role="gridcell"
                        data-i={i}
                        className={`pb__cell${i === current ? ' is-current' : ''}`}
                        style={{ '--ar': String(ar) } as React.CSSProperties}
                        onClick={(e) => onOpen(i, e.currentTarget)}
                        aria-label={`${rollNo(i)} · ${cityLabel(city, lang)}`}
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

interface JourneyStop {
  id: number;
  city: string;
  startDate: string;
}
const STOPS = journeyData.stops as JourneyStop[];

/** A mouse crossing the corner on its way elsewhere should not open it. */
const OPEN_DELAY_MS = 140;
/** How finely the route is sampled for aiming, in viewBox units. */
const SAMPLE = 3;
/** How long the hand has to be still before the name of the place comes up. */
const LABEL_REST_MS = 180;

/**
 * The route as evenly spaced points along itself, and where each stop stands
 * on it — the same rail the journey's minimap aims along.
 */
function buildRail() {
  const out: { x: number; y: number; leg: number }[] = [];
  const mark: number[] = [];
  if (typeof document === 'undefined') return { rail: out, mark };
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  svg.appendChild(path);
  MAP.legs.forEach((d, leg) => {
    path.setAttribute('d', d);
    const total = path.getTotalLength();
    const steps = Math.max(1, Math.ceil(total / SAMPLE));
    mark[leg] = out.length;
    for (let i = 0; i <= steps; i++) {
      const pt = path.getPointAtLength((total * i) / steps);
      out.push({ x: pt.x, y: pt.y, leg });
    }
    mark[leg + 1] = out.length - 1;
  });
  return { rail: out, mark };
}

type Aim = { x: number; y: number; stop: number };

/**
 * The world, the route in its two tenses up to the stop being read, and a seat
 * for the dot there. The seat moves when the reading crosses into another stop
 * and the dot, following it, slides rather than jumps.
 *
 * It behaves as the journey's minimap does, because it is that map. At 88px it
 * is a picture: a mouse resting on it (or a finger tapping it) opens it, and
 * open it is aimed — the ring slides along the route as the hand moves across,
 * counting from where the reading already is, and names the stop once the hand
 * is still. A click takes the sheet (or the open photo) to that stop. The seat
 * grows with the map, so the dot rides the opening instead of waiting for it.
 */
export function RollLocator({
  index,
  dot,
  lang,
  onPick,
}: {
  index: number;
  dot: boolean;
  lang: Lang;
  onPick: (rollIndex: number) => void;
}) {
  const block = journeyRoll.blocks[journeyRoll.blockOf[index]];
  const city = block ? CITIES[block.stop.city] : null;
  const order = block ? stopOrder(block.stop.id) : 0;
  const [x, y] = city ? project(city.lat, city.lng) : [500, 250];

  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLSpanElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const { rail, mark } = useMemo(() => buildRail(), []);
  const stopPoints = useMemo(
    () =>
      STOPS.map((st) => {
        const c = CITIES[st.city];
        return c ? project(c.lat, c.lng) : ([0, 0] as [number, number]);
      }),
    []
  );
  const anchorAcross =
    rail.length < 2 ? 0.5 : 1 - (mark[order] ?? rail.length - 1) / (rail.length - 1);

  const openTimer = useRef(0);
  const labelTimer = useRef(0);
  const moveRaf = useRef(0);
  const grip = useRef<{ x: number; across: number } | null>(null);
  const byTouch = useRef(false);
  const aimRef = useRef<Aim | null>(null);
  const gRef = useRef<SVGGElement>(null);
  const ringRef = useRef<SVGCircleElement>(null);
  const labelRef = useRef<SVGTextElement>(null);

  const landing = (stop: number) => {
    const i = rollIndexForStop(STOPS[stop]?.id);
    return { i, block: journeyRoll.blocks[journeyRoll.blockOf[i]] };
  };

  // the aim is painted by hand: a pointer moves every frame and React need not hear of it
  const paintAim = useCallback(
    (a: Aim | null) => {
      aimRef.current = a;
      const g = gRef.current;
      const label = labelRef.current;
      window.clearTimeout(labelTimer.current);
      if (!g) return;
      if (!a) {
        g.style.display = 'none';
        if (label) label.style.opacity = '0';
        return;
      }
      g.style.display = '';
      ringRef.current?.setAttribute('cx', String(a.x));
      ringRef.current?.setAttribute('cy', String(a.y));
      if (!label) return;
      label.style.opacity = '0';
      labelTimer.current = window.setTimeout(() => {
        const flip = a.x > 720;
        label.setAttribute('x', String(a.x + (flip ? -15 : 15)));
        label.setAttribute('y', String(a.y + 6));
        label.setAttribute('text-anchor', flip ? 'end' : 'start');
        // named by where the click would land: the nearest photographed stop
        const b = landing(a.stop).block;
        label.textContent = b
          ? `${cityLabel(b.stop.city, lang)}  ${b.stop.startDate.slice(0, 7).replace('-', '.')}`
          : '';
        label.style.opacity = '1';
      }, LABEL_REST_MS);
    },
    [lang]
  );

  const shut = useCallback(() => {
    window.clearTimeout(openTimer.current);
    setOpen(false);
    grip.current = null;
    paintAim(null);
  }, [paintAim]);

  // open, it closes again on the next press anywhere else
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) shut();
    };
    document.addEventListener('pointerdown', away, { passive: true });
    return () => document.removeEventListener('pointerdown', away);
  }, [open, shut]);

  useEffect(
    () => () => {
      window.clearTimeout(openTimer.current);
      window.clearTimeout(labelTimer.current);
      cancelAnimationFrame(moveRaf.current);
    },
    []
  );

  const aimAt = (clientX: number): Aim | null => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r || rail.length < 2) return null;
    const hold = grip.current ?? { x: clientX, across: anchorAcross };
    const across = hold.across + (clientX - hold.x) / r.width;
    const u = 1 - Math.max(0, Math.min(1, across));
    const f = u * (rail.length - 1);
    const i = Math.min(rail.length - 2, Math.floor(f));
    const t = f - i;
    const a = rail[i];
    const b = rail[i + 1];
    const joined = a.leg === b.leg;
    const ax = joined ? a.x + (b.x - a.x) * t : a.x;
    const ay = joined ? a.y + (b.y - a.y) * t : a.y;
    const p0 = stopPoints[a.leg];
    const p1 = stopPoints[a.leg + 1] ?? p0;
    const d0 = (p0[0] - ax) ** 2 + (p0[1] - ay) ** 2;
    const d1 = (p1[0] - ax) ** 2 + (p1[1] - ay) ** 2;
    return { x: ax, y: ay, stop: d0 <= d1 ? a.leg : a.leg + 1 };
  };

  const commit = (a: Aim | null) => {
    if (byTouch.current) setOpen(false);
    grip.current = null;
    paintAim(null);
    if (a) onPick(landing(a.stop).i);
  };

  return (
    <span className={`pb__locator${open ? ' is-open' : ''}`} ref={boxRef}>
      <span className="pb__locmap">
        <svg
          ref={svgRef}
          viewBox="0 0 1000 500"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={lang === 'ko' ? '여정 지도' : 'Route overview'}
          onPointerEnter={(e) => {
            byTouch.current = e.pointerType === 'touch';
            if (byTouch.current) return;
            window.clearTimeout(openTimer.current);
            openTimer.current = window.setTimeout(() => setOpen(true), OPEN_DELAY_MS);
          }}
          onPointerLeave={(e) => {
            if (e.pointerType !== 'touch') shut();
          }}
          onPointerDown={(e) => {
            byTouch.current = e.pointerType === 'touch';
            if (byTouch.current) {
              grip.current = null;
              try {
                e.currentTarget.setPointerCapture(e.pointerId);
              } catch {
                /* a pointer already gone */
              }
            }
          }}
          onPointerMove={(e) => {
            if (!open) return;
            const { clientX } = e;
            if (!grip.current) grip.current = { x: clientX, across: anchorAcross };
            if (moveRaf.current) return;
            moveRaf.current = requestAnimationFrame(() => {
              moveRaf.current = 0;
              paintAim(aimAt(clientX));
            });
          }}
          onPointerUp={(e) => {
            if (e.pointerType !== 'touch') return;
            if (!open) {
              setOpen(true);
              return;
            }
            commit(aimRef.current ?? aimAt(e.clientX));
          }}
          onClick={(e) => {
            if (byTouch.current) return;
            if (!open) {
              window.clearTimeout(openTimer.current);
              setOpen(true);
              return;
            }
            commit(aimRef.current ?? aimAt(e.clientX));
          }}
        >
          <Land order={order} />
          <g className="minimap__aim" ref={gRef} style={{ display: 'none' }}>
            <circle ref={ringRef} r={9} />
            <text ref={labelRef} style={{ opacity: 0 }} />
          </g>
        </svg>
        <span
          className="pb__locseat"
          style={{ left: `${x / 10}%`, top: `${y / 5}%` }}
          data-dot-active={dot ? '' : undefined}
          data-dot-follow={dot ? '' : undefined}
          aria-hidden="true"
        />
      </span>
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
