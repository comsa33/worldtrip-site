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

/**
 * Fade in only the tiles and seams that are actually on the screen.
 *
 * Animating the sheet, or its hundred and forty stops, meant animating eighty
 * thousand pixels of content: a phone gives every animated element a layer of
 * its own, and at 3× that came to about a gigabyte — Safari threw the page
 * away and loaded it again. What is off the screen cannot be seen fading
 * anyway. `except` is the tile that is moving by itself.
 */
function fadeInView(sheet: HTMLElement, except: Element | null, delay: number, from = 0) {
  const view = sheet.getBoundingClientRect();
  sheet.querySelectorAll<HTMLElement>('.pb__cell, .pb__stopseam').forEach((node) => {
    if (node === except) return;
    const r = node.getBoundingClientRect();
    if (r.bottom < view.top || r.top > view.bottom) return;
    node.animate([{ opacity: from }, { opacity: 1 }], {
      duration: 220,
      delay,
      easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
      fill: 'backwards',
    });
  });
}

/**
 * A tile before its photo: the photo's own two tones, top over bottom (baked by
 * scripts/add-photo-tones.py). A fast flick through the year shows the colour
 * of the places going by instead of a column of grey boxes.
 */
function toneStyle(ar: number, tone?: string) {
  const style: Record<string, string> = { '--ar': String(ar) };
  const [a, b] = tone?.split(',') ?? [];
  if (a && b) {
    style['--tone-a'] = `#${a}`;
    style['--tone-b'] = `#${b}`;
  }
  return style as React.CSSProperties;
}
/** The sheet's one thumbnail width, whatever the screen's density. */
/** Faster than this (about four screens a second on a phone) is a throw, not reading. */
const FAST_PX_PER_MS = 3;
/** How long the sheet has to be slow before the photos it is passing are attached. */
const SETTLE_MS = 90;
const SHEET_PX = 480;

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
  /** where the sheet was left when a tile was opened — come back there if that tile is still in view */
  restoreTop?: number | null;
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
  restoreTop,
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
  const runs = fold ? COUNTRY_RUNS : CITY_RUNS;
  const homeBlock = journeyRoll.blockOf[current];

  // open on the photo that was being looked at, a third of the way down
  useLayoutEffect(() => {
    const el = scroller.current;
    // a stop opened from its start (the header's door) begins at its seam;
    // a photo opened from inside a stop keeps some of what came before it
    const block = journeyRoll.blocks[homeBlock];
    let restored = false;
    if (el && restoreTop != null) {
      // back from a photo opened here: the sheet as it was left, as long as the
      // photo now open (it may have been swiped on) has its tile on that screen
      el.scrollTop = restoreTop;
      const cell = el.querySelector<HTMLElement>(`[data-i="${current}"]`);
      const r = cell?.getBoundingClientRect();
      const v = el.getBoundingClientRect();
      restored = Boolean(r && r.top >= v.top && r.bottom <= v.bottom);
    }
    if (!restored) jumpTo(el, current, block?.start === current ? 'top' : 'focus');
    if (!el || !arrive) return;

    /* From the open photo: the picture goes down into its own tile, and the
       sheet gathers round it — its own stop first, the rest of the journey a
       beat later. Nothing jumps: the tile starts where the photo was. */
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const from = origin();
    const cell = el.querySelector<HTMLElement>(`[data-i="${current}"]`);
    // only what is on the screen comes in round it — see fadeInView
    fadeInView(el, cell, 60);
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
    fadeInView(el, cell, 0, 0.55);
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

  /* ── only what is near gets its pictures ────────────────────────────────
     Every tile keeps its place, but a picture is attached only while its stop
     is within a screen and a half of the view, and let go again after. A
     phone holding two thousand decoded photos at once runs out of memory
     and the browser reloads the page — which is what scrolling the whole
     journey used to do. */
  const [live, setLive] = useState<Set<number>>(() => new Set());
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    /* Two edges, so a stop does not flicker in and out at one line: pictures
       are attached a screen ahead and only let go two and a half screens
       behind — scrolling back a little finds them still there. */
    const pendingIn = new Set<number>();
    const pendingOut = new Set<number>();
    let idle = 0;
    let lastY = el.scrollTop;
    let lastT = performance.now();
    let fast = false;
    const flush = () => {
      if (!pendingIn.size && !pendingOut.size) return;
      const add = [...pendingIn];
      const drop = [...pendingOut];
      pendingIn.clear();
      pendingOut.clear();
      setLive((prev) => {
        const next = new Set(prev);
        add.forEach((k) => next.add(k));
        drop.forEach((k) => next.delete(k));
        return next;
      });
    };
    /* While a flick is still fast, nothing new is decoded: the tones fill the
       tiles going by, and the photos are attached the moment the sheet slows
       down. Decoding a screenful of photos every frame of a throw is what
       made it stutter. */
    const onScroll = () => {
      const now = performance.now();
      const v = Math.abs(el.scrollTop - lastY) / Math.max(1, now - lastT);
      lastY = el.scrollTop;
      lastT = now;
      fast = v > FAST_PX_PER_MS;
      window.clearTimeout(idle);
      idle = window.setTimeout(() => {
        fast = false;
        flush();
      }, SETTLE_MS);
    };
    const key = (e: IntersectionObserverEntry) => Number((e.target as HTMLElement).dataset.run);
    const near = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) pendingIn.add(key(e));
        if (!fast) flush();
      },
      { root: el, rootMargin: '100% 0px' }
    );
    const far = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) continue;
          pendingIn.delete(key(e));
          pendingOut.add(key(e));
        }
        if (!fast) flush();
      },
      { root: el, rootMargin: '250% 0px' }
    );
    el.querySelectorAll('[data-run]').forEach((sec) => {
      near.observe(sec);
      far.observe(sec);
    });
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      near.disconnect();
      far.disconnect();
      el.removeEventListener('scroll', onScroll);
      window.clearTimeout(idle);
    };
  }, [scroller, fold]);

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
        const start = run[0].start;
        const home = run.some((x) => journeyRoll.blocks[homeBlock] === x);
        return (
          <StopSection
            key={run[0].stop.id}
            run={run}
            perRow={perRow}
            fold={fold}
            lang={lang}
            home={home}
            current={home ? current : -1}
            live={live.has(start)}
            onOpen={onOpen}
          />
        );
      })}
    </div>
  );
});

/**
 * One stop (or, folded, one country) of the sheet. Memoised so that a stop
 * coming into reach redraws that stop alone, not the other hundred and forty.
 */
const StopSection = memo(function StopSection({
  run,
  perRow,
  fold,
  lang,
  home,
  current,
  live,
  onOpen,
}: {
  run: RollBlock[];
  perRow: number;
  fold: boolean;
  lang: Lang;
  home: boolean;
  current: number;
  live: boolean;
  onOpen: (i: number, el: HTMLElement) => void;
}) {
  const { photos } = journeyRoll;
  const b = run[0];
  const last = run[run.length - 1];
  const start = b.start;
  const count = last.start + last.count - start;
  const seam = fold ? countrySeamText(b, lang) : seamText(b, lang);
  const rows: number[][] = [];
  for (let i = 0; i < count; i += perRow) {
    rows.push(Array.from({ length: Math.min(perRow, count - i) }, (_, k) => start + i + k));
  }
  return (
    <section className={`pb__stop${home ? ' is-home' : ''}`} data-run={start}>
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
                  style={toneStyle(ar, p.tone)}
                  onClick={(e) => onOpen(i, e.currentTarget)}
                  aria-label={`${rollNo(i)} · ${cityLabel(city, lang)}`}
                >
                  {/* One size for every tile and every screen: the one the
                      photo book's sheet already asks for, so no new derived
                      images, and a phone at 3× does not decode a 1000px photo
                      into a 117px tile. */}
                  {live && (
                    <img
                      src={srcFor(p, SHEET_PX, { exact: true })}
                      alt=""
                      decoding="async"
                      // the photo comes up out of its own colours rather than
                      // popping onto grey; set on the node, not in state, so a
                      // hundred arrivals are not a hundred renders
                      onLoad={(e) => e.currentTarget.classList.add('is-in')}
                    />
                  )}
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
/** How close to the route, in screen pixels, the hand has to be for the ring to settle on it. */
const AIM_REACH_PX = 28;
/** How much a pass further along the line costs against one nearer the hand (per rail unit). */
const AIM_KEEP_TO_LINE = 0.02;
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
 * At 88px it is a picture: a mouse resting on it (or a finger tapping it)
 * opens it, the seat grows with the map, and the dot rides the opening instead
 * of waiting for it.
 *
 * Open, it is aimed by POINTING, not by counting. The journey's minimap counts
 * the hand's sideways distance from where it was put down, which works in the
 * middle of a screen; this map lives in the top-left corner, and read that way
 * the whole year from Gwangju onwards lay in the forty pixels between the hand
 * and the edge of the window. In the wide book the year already has its own
 * precise control — the wave under the sheet — so the map answers the other
 * question, where, the way a map is asked it: you point at the place. Near the
 * route (within a finger's width) the ring settles on it and names the stop
 * once the hand is still; away from it there is no ring and the ordinary
 * pointer comes back. Where the route passes a place twice — India in October
 * and in November — the ring keeps to the pass it was already on, so sliding
 * along the line follows the line rather than jumping between visits.
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
  /** the rail sample the ring was last on — the reading's own place until the hand says otherwise */
  const lastRail = useRef(-1);

  const openTimer = useRef(0);
  const labelTimer = useRef(0);
  const moveRaf = useRef(0);
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
      // the dot cursor is put away only while there is a ring to take its place
      svgRef.current?.classList.toggle('is-aiming', Boolean(a));
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
    lastRail.current = -1;
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

  const aimAt = (clientX: number, clientY: number): Aim | null => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r || rail.length < 2 || !r.width) return null;
    const k = 1000 / r.width; // viewBox units per screen pixel
    const vx = (clientX - r.left) * k;
    const vy = (clientY - r.top) * k;
    const reach = AIM_REACH_PX * k;
    const from = lastRail.current >= 0 ? lastRail.current : (mark[order] ?? 0);
    let best = -1;
    let bestScore = Infinity;
    for (let i = 0; i < rail.length; i++) {
      const d = Math.hypot(rail[i].x - vx, rail[i].y - vy);
      if (d > reach) continue;
      // among the passes within reach, the one nearest along the line wins
      const score = d + Math.abs(i - from) * SAMPLE * AIM_KEEP_TO_LINE;
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best < 0) return null;
    lastRail.current = best;
    const { x: ax, y: ay, leg } = rail[best];
    const p0 = stopPoints[leg];
    const p1 = stopPoints[leg + 1] ?? p0;
    const d0 = (p0[0] - ax) ** 2 + (p0[1] - ay) ** 2;
    const d1 = (p1[0] - ax) ** 2 + (p1[1] - ay) ** 2;
    return { x: ax, y: ay, stop: d0 <= d1 ? leg : leg + 1 };
  };

  const commit = (a: Aim | null) => {
    if (byTouch.current) setOpen(false);
    paintAim(null);
    if (a) onPick(landing(a.stop).i);
  };

  return (
    <span className={`pb__locator${open ? ' is-open' : ''}`} ref={boxRef}>
      <span className="pb__locmap">
        {/* the drawing and the seat share one box, the map's own size: the
            seat's percentages were being taken of the plate's padding too,
            which put the dot a few pixels off its city on a 64px map */}
        <span className="pb__locplane">
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
                try {
                  e.currentTarget.setPointerCapture(e.pointerId);
                } catch {
                  /* a pointer already gone */
                }
              }
            }}
            onPointerMove={(e) => {
              if (!open) return;
              const { clientX, clientY } = e;
              if (moveRaf.current) return;
              moveRaf.current = requestAnimationFrame(() => {
                moveRaf.current = 0;
                paintAim(aimAt(clientX, clientY));
              });
            }}
            onPointerUp={(e) => {
              if (e.pointerType !== 'touch') return;
              if (!open) {
                setOpen(true);
                return;
              }
              commit(aimRef.current ?? aimAt(e.clientX, e.clientY));
            }}
            onClick={(e) => {
              if (byTouch.current) return;
              if (!open) {
                window.clearTimeout(openTimer.current);
                setOpen(true);
                return;
              }
              commit(aimRef.current ?? aimAt(e.clientX, e.clientY));
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
  // a photo from the night before the start (the phone's clock, a timezone) is still day 1
  const clampDay = (d: number) => Math.min(JOURNEY_DAYS, Math.max(1, d));
  const readDay = photos[top]?.date ? clampDay(dayOf(photos[top].date)) : 1;
  const endDay = photos[bottom]?.date ? clampDay(dayOf(photos[bottom].date)) : readDay;
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
