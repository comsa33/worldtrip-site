import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import { useI18n } from '../../i18n';
import cityPhotosData from '../../data/cityPhotos.json';
import { photosForStop, visitsForCity } from '../../lib/visitPhotos';
import {
  TOTAL_LABEL,
  cityLabel,
  journeyRoll,
  jumpTo,
  noteForStop,
  regionForStop,
  rollIndexForStop,
  rollNo,
} from '../../lib/journeyRoll';
import { srcFor } from '../../lib/photoSrc';
import { landOn, setAlbumRegion } from '../../lib/sound';
import { useSideways } from '../../lib/sideways';
import { hasTheme, themesOf, usePhotoTheme } from '../../lib/photoThemes';
import { useCaption } from '../../lib/captions';
import { TUNE_ON, useTuning } from '../3d/routeTuning';
import { RING_MOVE } from '../3d/themeRingScale';
import { stepIndex } from '../../lib/themeStep';
import { ThemeRow } from '../themes/ThemeRow';
import { JourneySheet, RollLocator, YearWave } from './JourneySheet';
import {
  FILM_DEFAULTS,
  Film,
  landing,
  rebase,
  rubber,
  speedOf,
  type Band,
  type FilmParams,
} from './film';
import './PhotoGallery.css';

interface Photo {
  id: string;
  url?: string;
  thumbnail?: string;
  date: string;
  gps?: { lat: number; lng: number } | null;
  caption: { ko: string; en: string };
  location?: string | null;
  /** Baked in by scripts/add-photo-dimensions.js — the frame needs it before the photo arrives. */
  w?: number;
  h?: number;
  /** Two tones, top over bottom, for the tile before the photo arrives (scripts/add-photo-tones.py). */
  tone?: string;
}

interface CityPhotoData {
  cityCode: string;
  photos: Photo[];
}

interface PhotoGalleryProps {
  cityName: string | null;
  initialPhotoId?: string | null;
  /** Open straight into the contact sheet instead of a single photo. */
  initialSheet?: boolean;
  /** Which stay to land on, for a city the journey passed through twice. */
  focusStopId?: number | null;
  /** Open on the whole journey rather than the city — the header's door. */
  initialScope?: 'city' | 'all';
  onClose: () => void;
  /**
   * The book was opened from a lit ring on the globe. Where that city's ring
   * is on the screen now (null if it is not) — the photo opens out of it as a
   * circle and closes back into it, the way a book opened from the filmstrip
   * closes into its frame: the shape it came from.
   */
  ringSpot?: ((city: string) => RingSpot | null) | null;
}

export type RingSpot = { x: number; y: number; r: number };

/** A photo opening out of a ring waits this long, at most, for its picture. */
const RING_WAIT_MS = 120;
/** The slot's centre before any transform, and how much it is scaled now. */
function slotAtRest(slotEl: HTMLElement) {
  const r = slotEl.getBoundingClientRect();
  const t = getComputedStyle(slotEl).transform;
  const m = t && t !== 'none' ? new DOMMatrix(t) : new DOMMatrix();
  return {
    cx: r.left + r.width / 2 - m.e,
    cy: r.top + r.height / 2 - m.f,
    tx: m.e,
    ty: m.f,
    s: m.a || 1,
  };
}

/**
 * The ring's move is one number, --ring: 0 on the ring, 1 open. The slot's
 * place and the frame's circle are both read off it (PhotoGallery.css) — the
 * photo flies as a circle for the first 60% and only then opens to its
 * corners, and closing is the same road backwards. One number, moved by a
 * transition, so a move turned round halfway goes back from where it is.
 */
function setRing(
  root: HTMLElement,
  ring: { x: number; y: number; r: number },
  open: { cx: number; cy: number; tx: number; ty: number; s: number },
  w: number,
  h: number
) {
  const small = Math.min(w, h);
  const set = (k: string, v: string) => root.style.setProperty(k, v);
  set('--ring-ax', `${ring.x - open.cx}px`);
  set('--ring-ay', `${ring.y - open.cy}px`);
  // the circle lands the size the ring is drawn
  set('--ring-as', String((2 * ring.r) / small));
  set('--ring-bx', `${open.tx}px`);
  set('--ring-by', `${open.ty}px`);
  set('--ring-bs', String(open.s));
  set('--ring-r0', `${small / 2}px`);
  set('--ring-r1', `${Math.hypot(w, h) / 2}px`);
}
function clearRing(root: HTMLElement) {
  root.classList.remove('is-ring', 'is-ringed');
  for (const k of ['ax', 'ay', 'as', 'bx', 'by', 'bs', 'r0', 'r1', 'ms', 'hold'])
    root.style.removeProperty(`--ring-${k}`);
  root.style.removeProperty('--ring');
  root.style.removeProperty('--pull');
}

const DEFAULT_AR = 4 / 3;
const PHOTOS_HASH = '#photos';
/** How far a finger lifts the photo before letting go opens the sheet. */
const REACH_PX = 90;
const arOf = (p: Photo) => (p.w && p.h ? p.w / p.h : DEFAULT_AR);

/** Thumbnails are 62x46 CSS px; ask for exactly that at this screen's density. */
function thumbFor(p: Photo): string | undefined {
  if (!p.thumbnail) return undefined;
  const dpr = Math.min(typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1, 3);
  const w = Math.round(62 * dpr);
  const h = Math.round(46 * dpr);
  return p.thumbnail.replace('w_200,h_200,c_fill', `w_${w},h_${h},c_fill`);
}

/** How wide the frame will be for this photo inside a given slot. */
function frameWidth(p: Photo, slotW: number, slotH: number): number {
  const ar = arOf(p);
  return Math.round(Math.min(slotH, slotW / ar) * ar);
}

/**
 * Lightbox: one photo in a frame that is the photo's own shape, a caption
 * underneath, a strip to jump around. ← → move, Esc closes.
 *
 * Three things it is careful about. The neighbours are fetched before they are
 * asked for, because the slow part was never the download — it was Cloudinary
 * building a derived size for the first time (1268ms cold, 23ms warm). The
 * outgoing photo holds its place until the incoming one has actually decoded,
 * so a change never shows a hole. And while it is open it holds the page
 * still: the journey behind it used to keep scrolling under the reader.
 */
export default function PhotoGallery({
  cityName,
  initialPhotoId,
  initialSheet,
  focusStopId,
  initialScope,
  onClose,
  ringSpot = null,
}: PhotoGalleryProps) {
  const { language } = useI18n();
  const lang = language as 'ko' | 'en';
  /** a phone on its side: the photo gets the height, the strip and the caption fold */
  const sideways = useSideways();
  const cityPhotos = cityPhotosData as Record<string, CityPhotoData>;

  /* Opened from a stop, the book is that stay's photos. Standing in Varanasi in
     October and handed November's return as well read as one muddled roll —
     the other stays are one swipe up, in the journey's sheet, in their place. */
  const cityRoll = useMemo(() => {
    if (!cityName || !cityPhotos[cityName]) return [] as Photo[];
    const stay = visitsForCity(cityName).find((v) => v.stopId === focusStopId);
    const list = stay ? stay.photos : cityPhotos[cityName].photos;
    return [...list].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [cityName, cityPhotos, focusStopId]);

  /* ── the scope: one city, or the whole journey ──────────────────────────
     The book opens on a city. Its contact sheet has no walls: asking for all
     of them (the total, G, the wheel) widens the book to every photo of the
     journey, standing on the same photo. From there ← → walk on across
     cities too. The header's door opens straight into the wide book. */
  const [scope, setScope] = useState<'city' | 'all'>(initialScope ?? 'city');
  const photos = scope === 'all' ? (journeyRoll.photos as Photo[]) : cityRoll;

  /* ── the city's stays, in order ─────────────────────────────────────────
     `photos` is already in date order and so are the visits, so each stay is
     a run inside it. A city the journey saw once returns null and the sheet
     renders exactly as it did before. */
  const groups = useMemo(() => {
    const visits = visitsForCity(cityName);
    // a roll that is already one stay has nothing to split
    if (visits.length < 2 || visits.some((v) => v.stopId === focusStopId)) return null;
    const here = new Set(cityRoll.map((p) => p.id));
    const out: { visit: (typeof visits)[number]; start: number; count: number }[] = [];
    let start = 0;
    for (const v of visits) {
      const n = v.photos.filter((p) => here.has(p.id)).length;
      if (!n) continue;
      out.push({ visit: v, start, count: n });
      start += n;
    }
    return out.length > 1 ? out : null;
  }, [cityName, cityRoll, focusStopId]);

  const [index, setIndex] = useState(0);
  // the whole set at once, as a contact sheet — G toggles, a tile opens it there
  const [sheet, setSheet] = useState(Boolean(initialSheet));
  /* Where the open photo came from. Opened from a tile of the sheet, the sheet
     is where it goes back to — pulled up or pulled down, Esc or a tap on the
     dark. Opened from the journey (a filmstrip frame), down goes back to the
     journey and up goes on to the sheet. The ✕ always closes the book. */
  const [fromSheet, setFromSheet] = useState(false);
  /** how far down the sheet was when a tile was opened, to come back to */
  const [sheetMemory, setSheetMemory] = useState<number | null>(null);
  /* Whether the sheet came up out of the open photo (and so should gather
     round it) or was opened straight from a door. */
  const [sheetWas, setSheetWas] = useState(sheet);
  const [arrive, setArrive] = useState(false);
  const openKey = `${cityName}:${initialPhotoId ?? ''}:${initialSheet ? 'sheet' : ''}:${focusStopId ?? ''}:${initialScope ?? ''}`;
  const [lastKey, setLastKey] = useState(openKey);
  const opening = openKey !== lastKey;
  if (opening) {
    // a new open: start at the requested photo (state reset during render, per React guidance)
    setLastKey(openKey);
    const byPhoto = initialPhotoId ? photos.findIndex((p) => p.id === initialPhotoId) : -1;
    const byVisit = focusStopId
      ? (groups?.find((g) => g.visit.stopId === focusStopId)?.start ?? -1)
      : -1;
    const i = byPhoto >= 0 ? byPhoto : byVisit >= 0 ? byVisit : 0;
    setIndex(i);
    setSheet(Boolean(initialSheet));
    setSheetWas(Boolean(initialSheet));
    setArrive(false);
    setFromSheet(false);
    setSheetMemory(null);
    setScope('city');
    if (initialScope === 'all') {
      const inRoll = initialPhotoId
        ? journeyRoll.photos.findIndex((p) => p.id === initialPhotoId)
        : -1;
      setScope('all');
      setIndex(inRoll >= 0 ? inRoll : rollIndexForStop(focusStopId));
    }
  }

  if (!opening && sheet !== sheetWas) {
    setSheetWas(sheet);
    setArrive(sheet);
  }

  // a city's sheet is the journey's sheet, standing on the same photo
  if (!opening && sheet && scope === 'city' && cityName) {
    const here = cityRoll[Math.min(index, cityRoll.length - 1)];
    const inRoll = here ? journeyRoll.photos.findIndex((p) => p.id === here.id) : -1;
    setScope('all');
    setIndex(inRoll >= 0 ? inRoll : 0);
  }

  const count = photos.length;
  const safeIndex = count ? Math.min(index, count - 1) : 0;
  const photo: Photo | undefined = photos[safeIndex];
  const atEnd = count > 0 && safeIndex === count - 1;
  const caption = useCaption(photo?.id, lang);

  /* ── reading the wide sheet: what is at the top, what is at the bottom ── */
  const [read, setRead] = useState({ top: 0, bottom: 0 });
  const [readDir, setReadDir] = useState(1);
  const readTop = useRef(0);
  const onRead = useCallback((top: number, bottom: number) => {
    if (top !== readTop.current) setReadDir(top > readTop.current ? 1 : -1);
    readTop.current = top;
    setRead({ top, bottom });
  }, []);
  const [hover, setHover] = useState<number | null>(null);
  /* The strip in the wide book is the stop being looked at and its two
     neighbours — two thousand thumbnails in a row is no strip at all. */
  const stripRange = useMemo(() => {
    if (scope !== 'all') return photos.map((_, i) => i);
    const b = journeyRoll.blockOf[safeIndex] ?? 0;
    const first = journeyRoll.blocks[Math.max(0, b - 1)];
    const last = journeyRoll.blocks[Math.min(journeyRoll.blocks.length - 1, b + 1)];
    const out: number[] = [];
    for (let i = first.start; i < last.start + last.count; i++) out.push(i);
    return out;
  }, [scope, photos, safeIndex]);
  const wide = scope === 'all';
  const rollSheet = wide && sheet;

  /* ── how many to a row ──────────────────────────────────────────────────
     Three steps, pinched or ⌘-wheeled. At the densest the cities fold into
     their countries and a year is a couple of dozen screens. */
  const [dense, setDense] = useState(0);
  const narrow = typeof window !== 'undefined' && window.innerWidth < 768;
  const perRow = (narrow ? [3, 6, 12] : [6, 12, 24])[dense];
  const onZoom = useCallback((step: 1 | -1) => {
    setDense((d) => Math.max(0, Math.min(2, d + step)));
  }, []);

  /* ── the address ────────────────────────────────────────────────────────
     The wide book is #photos: a link opens it, and the browser's back is a
     way out. Opening pushes an entry; closing from inside pops the one it
     pushed (or, for a book that arrived by the link, just drops the hash). */
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    if (!cityName || !wide) return;
    if (window.location.hash !== PHOTOS_HASH) {
      history.pushState(
        { photos: true },
        '',
        `${window.location.pathname}${window.location.search}${PHOTOS_HASH}`
      );
    }
    const onPop = () => {
      if (window.location.hash !== PHOTOS_HASH) closeRef.current();
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [cityName, wide]);
  const close = useCallback(() => {
    if (window.location.hash === PHOTOS_HASH) {
      if ((history.state as { photos?: boolean } | null)?.photos) history.back();
      else history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    }
    onClose();
  }, [onClose]);

  /* ── closing, back to where it came from ─────────────────────────────────
     The book was opened from a frame of the filmstrip, so that is where it
     goes: the photo shrinks from wherever it is — under a finger pulling it
     down, or at rest when Esc or ✕ closes it — into that frame, while the book
     around it thins away. A photo the strip does not show goes into the strip's
     "+n"; a photo from another stop, or a book the strip did not open, drops
     away downward instead. */
  const liftRef = useRef<{ tx: number; ty: number; s: number } | null>(null);
  const ringRef = useRef(ringSpot);
  useEffect(() => {
    ringRef.current = ringSpot;
  });
  /** set while the book is closing into a ring: call it to open back out */
  const ringClosing = useRef<(() => void) | null>(null);
  const ringTimer = useRef(0);
  const ringCaught = useRef(false);
  /** bumped by every ring move: an opening that was waiting for its picture is off */
  const ringTurn = useRef(0);
  const tuned = useTuning();
  const ringMove = TUNE_ON
    ? { openMs: tuned.ringOpenMs, closeMs: tuned.ringCloseMs, hold: tuned.ringHold }
    : RING_MOVE;
  /** the open this book has already come out of its ring for */
  const ringOpened = useRef('');
  const closeHomeRef = useRef<() => void>(() => {});
  const closeHome = useCallback(() => closeHomeRef.current(), []);

  /** the city the open photo was taken in — whose ring it would close into */
  const photoCity = wide ? journeyRoll.blocks[journeyRoll.blockOf[safeIndex]]?.stop.city : cityName;
  /** the photo the top bar speaks for: the one at the top of the sheet, or the one open */
  const spoken = rollSheet ? Math.min(read.top, count - 1) : safeIndex;
  const spokenCity = wide
    ? cityLabel(journeyRoll.blocks[journeyRoll.blockOf[spoken]]?.stop.city ?? '', lang)
    : cityName;
  /* The book's song belongs to the journey: coming into another stop's photos
     sounds that stop's note, the one the globe plays on landing there. */
  const spokenStop = wide ? journeyRoll.blocks[journeyRoll.blockOf[spoken]]?.stop.id : focusStopId;
  useEffect(() => {
    if (!cityName || spokenStop == null) return;
    setAlbumRegion(regionForStop(spokenStop));
    const note = noteForStop(spokenStop);
    if (note) landOn(note);
  }, [cityName, spokenStop]);

  /* A theme on, the others step back and ← → (a swipe too) go to the next lit
     photo. A roll with nothing lit in it steps as it always has. */
  const theme = usePhotoTheme();
  const lit = useMemo(
    () => (theme ? (i: number) => hasTheme(photos[i]?.id ?? '', theme) : null),
    [theme, photos]
  );
  const anyLit = useMemo(() => (lit ? photos.some((_, i) => lit(i)) : false), [lit, photos]);
  /* A key, a click, a button: the band is set a card over and the spring
     brings it in (the film, below). Pressed again on the way, the target is
     one card further and the speed is kept. */
  const go = useCallback(
    (d: number) => {
      setIndex((i) => stepIndex(count, Math.min(i, count - 1), d > 0 ? 1 : -1, lit));
    },
    [count, lit]
  );

  /* ── the frame is the photo's own shape, known before it arrives ─────── */
  const slotRef = useRef<HTMLDivElement>(null);
  const [slot, setSlot] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = slotRef.current;
    if (!el) return;
    const read = () => setSlot({ w: el.clientWidth, h: el.clientHeight });
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [cityName]);

  const box = useMemo(() => {
    if (!photo || !slot.w || !slot.h) return null;
    const ar = arOf(photo);
    const h = Math.min(slot.h, slot.w / ar);
    return { w: Math.round(h * ar), h: Math.round(h) };
  }, [photo, slot.w, slot.h]);

  /* ── which way the counter rolls ──────────────────────────────────────── */
  const [shownId, setShownId] = useState<string | undefined>(photo?.id);
  const [dir, setDir] = useState(1);
  /* A photo grown out of its tile starts as that tile — the sheet's own
     thumbnail, already in hand — and the full photo comes up over it once it
     has decoded. */
  const [grownFrom, setGrownFrom] = useState<string | null>(null);
  const [sharpId, setSharpId] = useState<string | null>(null);
  // Out of a ring, the frame shows the sheet's tile under the photo until the
  // photo is in, as it does for a photo opened from a tile.
  const [ringKey, setRingKey] = useState('');
  if (!cityName && ringKey) setRingKey('');
  if (ringSpot && cityName && initialPhotoId && ringKey !== openKey) {
    setRingKey(openKey);
    setGrownFrom(initialPhotoId);
  }
  if (photo && shownId !== photo.id) {
    // the photo changed this render (state reset during render, per React guidance)
    const prevIdx = photos.findIndex((p) => p.id === shownId);
    setDir(prevIdx >= 0 && prevIdx > safeIndex ? -1 : 1);
    setShownId(photo.id);
  }
  const growing = Boolean(photo && grownFrom === photo.id && sharpId !== photo.id);
  const mainImgRef = useRef<HTMLImageElement>(null);
  // a photo already in the cache can finish before the load listener is attached
  useEffect(() => {
    const img = mainImgRef.current;
    if (!growing || !img || !photo) return;
    if (!(img.complete && img.naturalWidth > 0)) return;
    const id = photo.id;
    const raf = requestAnimationFrame(() => setSharpId(id));
    return () => cancelAnimationFrame(raf);
  }, [growing, photo]);

  /* ── the strip of film ───────────────────────────────────────────────────
     This photo and its neighbours — the next lit ones, with a theme on — lie
     on one band (G1, film.ts). The hand moves the band 1:1; let go, a spring
     carries it on with the hand's own speed; a key or a click sets the band a
     card over and the same spring brings it in. Each card is its own frame,
     the photo's own shape, so nothing changes shape on the way. */
  const filmParams: FilmParams = TUNE_ON
    ? {
        response: tuned.filmResponse,
        damping: tuned.filmDamping,
        project: tuned.filmProject,
        band: tuned.filmBand,
        gapPhone: tuned.filmGapPhone,
        gapDesk: tuned.filmGapDesk,
      }
    : FILM_DEFAULTS;
  const coarse = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches,
    []
  );
  const reduced = useMemo(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    []
  );
  // the cards: two before, this one, two after — by the same step ← → take
  const cards = useMemo(() => {
    const out: { i: number; k: number }[] = [];
    if (!count) return out;
    let i = safeIndex;
    for (let k = -1; k >= -2; k--) {
      const j = stepIndex(count, i, -1, lit);
      if (j === i) break;
      out.unshift({ i: j, k });
      i = j;
    }
    out.push({ i: safeIndex, k: 0 });
    i = safeIndex;
    for (let k = 1; k <= 2; k++) {
      const j = stepIndex(count, i, 1, lit);
      if (j === i) break;
      out.push({ i: j, k });
      i = j;
    }
    return out;
  }, [safeIndex, count, lit]);
  /* Where each card sits on the band, this one at 0. A phone's card is the
     screen's width and a gap; a desk's frames are set by height and differ
     in width, so there they sit edge to edge with the gap between. */
  const lane = useMemo(() => {
    if (!slot.w || !slot.h || !cards.length) return null;
    const sizes = cards.map(({ i }) => {
      const ar = arOf(photos[i]);
      const h = Math.min(slot.h, slot.w / ar);
      return { w: Math.round(h * ar), h: Math.round(h) };
    });
    const here = cards.findIndex((c) => c.k === 0);
    const centres: number[] = cards.map(() => 0);
    const gap = coarse ? filmParams.gapPhone : filmParams.gapDesk;
    for (let n = here + 1; n < cards.length; n++)
      centres[n] = coarse
        ? centres[n - 1] + slot.w + gap
        : centres[n - 1] + sizes[n - 1].w / 2 + gap + sizes[n].w / 2;
    for (let n = here - 1; n >= 0; n--)
      centres[n] = coarse
        ? centres[n + 1] - slot.w - gap
        : centres[n + 1] - sizes[n + 1].w / 2 - gap - sizes[n].w / 2;
    return { sizes, centres, here };
  }, [cards, photos, slot.w, slot.h, coarse, filmParams.gapPhone, filmParams.gapDesk]);
  const filmRef = useRef<HTMLDivElement>(null);
  const film = useRef(new Film(FILM_DEFAULTS.response, FILM_DEFAULTS.damping)).current;
  useEffect(
    () => film.retune(filmParams.response, filmParams.damping),
    [film, filmParams.response, filmParams.damping]
  );
  const filmRaf = useRef(0);
  const filmAt = useRef(0);
  const drawFilm = useCallback(() => {
    const el = filmRef.current;
    if (el) el.style.transform = `translate3d(${film.x.toFixed(2)}px, 0, 0)`;
  }, [film]);
  const stopFilm = useCallback(() => {
    if (filmRaf.current) cancelAnimationFrame(filmRaf.current);
    filmRaf.current = 0;
  }, []);
  const runFilm = useCallback(() => {
    if (filmRaf.current) return;
    filmAt.current = performance.now();
    const step = (now: number) => {
      const dt = (now - filmAt.current) / 1000;
      filmAt.current = now;
      const done = film.tick(dt);
      drawFilm();
      filmRaf.current = done ? 0 : requestAnimationFrame(step);
    };
    filmRaf.current = requestAnimationFrame(step);
  }, [film, drawFilm]);
  useEffect(() => stopFilm, [stopFilm]);
  /** the band's reach: past the first or last card it is on a rubber band */
  const bandX = useCallback(
    (x: number) => {
      if (!lane) return x;
      const max = -lane.centres[0];
      const min = -lane.centres[lane.centres.length - 1];
      const w = slot.w || 1;
      if (x > max) return max + rubber(x - max, w, filmParams.band);
      if (x < min) return min + rubber(x - min, w, filmParams.band);
      return x;
    },
    [lane, slot.w, filmParams.band]
  );
  const bandXRef = useRef(bandX);
  useEffect(() => {
    bandXRef.current = bandX;
  });
  /* The photo changed: the card now at 0 was at some centre c on the band
     before, so the band moves by c and nothing on screen moves — and the
     spring takes it the rest of the way in, keeping whatever speed it had. A
     photo from elsewhere (the strip, a tile) is simply there. */
  const prevBand = useRef<Band>({ ids: [], here: undefined, centres: null });
  useLayoutEffect(() => {
    const prev = prevBand.current;
    const next: Band = {
      ids: cards.map((c) => photos[c.i]?.id),
      here: photo?.id,
      centres: lane?.centres ?? null,
    };
    prevBand.current = next;
    const shift = rebase(prev, next);
    if (shift === 'same') return;
    film.target = 0;
    if (shift !== null && !reduced) {
      // the band and what is drawn move together, in this frame; the speed stays
      film.x += shift;
      drawFilm();
      runFilm();
    } else {
      film.x = 0;
      film.v = 0;
      stopFilm();
      drawFilm();
    }
  }, [cards, lane, photos, photo?.id, film, reduced, runFilm, stopFilm, drawFilm]);
  /* A band left off its target with no spring running and no hand on it is
     never right: it is sent on. (It should not happen.) */
  const rescue = useCallback(() => {
    requestAnimationFrame(() => {
      if (filmRaf.current || gesture.current.down) return;
      if (Math.abs(film.x - film.target) < 0.4) return;
      runFilm();
    });
  }, [film, runFilm]);
  /** let go (a finger, the trackpad) with this speed: where the band lands */
  const letGo = useCallback(
    (v: number, haptic = false) => {
      if (!lane) return;
      const n = landing(film.x, v, { centres: lane.centres, here: lane.here }, filmParams.project);
      const j = cards[n].i;
      film.release(0, v);
      if (j !== safeIndex) {
        setIndex(j);
        if (haptic && navigator.vibrate) {
          try {
            navigator.vibrate(8);
          } catch {
            /* no haptics here */
          }
        }
      } else if (reduced) {
        film.x = 0;
        film.v = 0;
        drawFilm();
      } else runFilm();
      rescue();
    },
    [lane, cards, film, filmParams.project, safeIndex, reduced, runFilm, drawFilm, rescue]
  );
  const letGoRef = useRef(letGo);
  useEffect(() => {
    letGoRef.current = letGo;
  });
  /** a mouse that dragged the band: the click that follows is not a turn of the page */
  const dragged = useRef(false);

  const sheetRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  /* ── out of the ring ─────────────────────────────────────────────────────
     Opened from a lit ring, the photo starts as a circle the ring's size, on
     the ring, and opens out to its place while the book comes up round it.
     Transitions, not keyframes: closed halfway, it turns round from there. */
  const figRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const root = rootRef.current;
    const slotEl = slotRef.current;
    const fig = figRef.current;
    // closed: the same ring pressed again is a new opening
    if (!cityName) ringOpened.current = '';
    if (!ringSpot || !cityName || !box || sheet || ringOpened.current === openKey) return;
    if (!root || !slotEl || !fig) return;
    ringOpened.current = openKey;
    const spot = ringSpot(cityName);
    if (!spot || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    setRing(root, spot, slotAtRest(slotEl), box.w, box.h);
    root.style.setProperty('--ring-ms', `${ringMove.openMs}ms`);
    root.style.setProperty('--ring-hold', String(ringMove.hold));
    root.style.setProperty('--ring', '0');
    root.style.setProperty('--pull', '1');
    root.classList.add('is-ringed');
    void fig.offsetWidth;
    const turn = ++ringTurn.current;
    const go = () => {
      if (ringTurn.current !== turn) return;
      root.classList.add('is-ring');
      root.style.setProperty('--ring', '1');
      root.style.setProperty('--pull', '0');
      window.clearTimeout(ringTimer.current);
      ringTimer.current = window.setTimeout(() => clearRing(root), ringMove.openMs + 10);
    };
    // The circle should not open on an empty frame: it waits for the picture
    // the ring asked for when it was pressed (the sheet's tile, which this
    // frame shows under the full one) — a moment, and no longer.
    const tile = photo ? new Image() : null;
    if (tile && photo) tile.src = srcFor(photo, 480, { exact: true });
    const ready = tile?.src ? tile.decode().catch(() => {}) : Promise.resolve();
    const wait = window.setTimeout(go, RING_WAIT_MS);
    ready.then(() => {
      window.clearTimeout(wait);
      go();
    });
    // the photo, the move's numbers: read once, when the book opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ringSpot, cityName, box, sheet, openKey]);

  const topRef = useRef<HTMLDivElement>(null);

  /* ── the hand at work: the theme row steps back while it is ───────────────
     A wheel or a finger on the sheet, the year under the hand, the photo
     dragged. Not the sheet's own scroll: ← → move it too, and the row would
     blink at every key. */
  const [busy, setBusy] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  const quiet = useRef(0);
  const nudge = useCallback(() => {
    setBusy(true);
    window.clearTimeout(quiet.current);
    quiet.current = window.setTimeout(() => setBusy(false), 160);
  }, []);
  useEffect(() => () => window.clearTimeout(quiet.current), []);
  useEffect(() => {
    const el = sheetRef.current;
    if (!el) return;
    el.addEventListener('wheel', nudge, { passive: true });
    el.addEventListener('touchmove', nudge, { passive: true });
    return () => {
      el.removeEventListener('wheel', nudge);
      el.removeEventListener('touchmove', nudge);
    };
    // the sheet mounts once the scope has widened
  }, [sheet, scope, nudge]);
  // where the tile was, relative to where the frame will be — measured in the
  // click, so the render only reads state
  const [zoomFrom, setZoomFrom] = useState<{ zx: number; zy: number; zs: number } | null>(null);
  const openFromTile = (i: number, el: HTMLElement) => {
    // the photo came from the sheet: that is where it goes back to, and the
    // sheet comes back to the place it was left at
    setFromSheet(true);
    const sh = sheetRef.current;
    if (sh) setSheetMemory(sh.scrollTop);
    const r = el.getBoundingClientRect();
    const sr = slotRef.current?.getBoundingClientRect();
    const target = photos[i];
    if (sr && target && slot.w && slot.h) {
      const fw = frameWidth(target, slot.w, slot.h);
      setZoomFrom({
        zx: r.left + r.width / 2 - (sr.left + sr.width / 2),
        zy: r.top + r.height / 2 - (sr.top + sr.height / 2),
        zs: Math.max(0.05, r.width / fw),
      });
    }
    setGrownFrom(target?.id ?? null);
    setIndex(i);
    setSheet(false);
  };
  /* Leaving the sheet by key or wheel is the same move as clicking the tile:
     the photo grows out of where its tile is — if that tile is on screen. */
  const leaveSheet = () => {
    const sh = sheetRef.current;
    const el = sh?.querySelector<HTMLElement>(`[data-i="${safeIndex}"]`);
    const r = el?.getBoundingClientRect();
    const sr = sh?.getBoundingClientRect();
    if (el && r && sr && r.bottom > sr.top && r.top < sr.bottom) openFromTile(safeIndex, el);
    else setSheet(false);
  };
  /* The sheet is memoised; a handler made fresh every render would redraw all
     of its tiles every time the reading moved a row. */
  const openTileRef = useRef(openFromTile);
  useEffect(() => {
    openTileRef.current = openFromTile;
  });
  const onOpenTile = useCallback((i: number, el: HTMLElement) => openTileRef.current(i, el), []);
  const leaveRef = useRef(leaveSheet);
  useEffect(() => {
    leaveRef.current = leaveSheet;
  });
  useEffect(() => {
    if (!zoomFrom) return;
    const t = window.setTimeout(() => setZoomFrom(null), 460);
    return () => window.clearTimeout(t);
  }, [zoomFrom]);

  // the key hints show for a moment on each open, then get out of the way
  const [hintGone, setHintGone] = useState(false);
  const [hintFor, setHintFor] = useState(cityName);
  if (hintFor !== cityName) {
    // a new open: the hints come back (state reset during render, per React guidance)
    setHintFor(cityName);
    setHintGone(false);
  }
  useEffect(() => {
    if (!cityName) return;
    const t = window.setTimeout(() => setHintGone(true), 3600);
    return () => window.clearTimeout(t);
  }, [cityName]);

  /* ── fetch the neighbours before they are asked for ──────────────────── */
  useEffect(() => {
    if (!count || !slot.w || !slot.h) return;
    for (const d of [1, -1, 2, -2]) {
      const p = photos[(safeIndex + d + count) % count];
      if (!p || p.id === photo?.id) continue;
      const img = new Image();
      img.decoding = 'async';
      img.src = srcFor(p, frameWidth(p, slot.w, slot.h));
    }
  }, [safeIndex, count, photos, photo?.id, slot.w, slot.h]);

  /* ── hold the journey still while the book is open ───────────────────── */
  const stripRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!cityName) return;
    // Held as a share of the page, not a pixel: turning a phone halves the
    // page's length, and a pixel held from before would put the journey
    // somewhere else — at its end, once the browser clamps it — on closing.
    const maxOf = () => Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    const share = window.scrollY / maxOf();
    const at = () => Math.round(share * maxOf());
    const keep = () => {
      if (Math.abs(window.scrollY - at()) > 1) window.scrollTo(0, at());
    };
    // The strip does its own horizontal scrolling; everything else would move
    // the globe behind the lightbox, which is how the wheel "stopped working".
    const block = (e: Event) => {
      const t = e.target;
      if (t instanceof Node && (stripRef.current?.contains(t) || sheetRef.current?.contains(t)))
        return;
      // the theme row runs sideways on a phone
      if (t instanceof Element && t.closest('.theme-row')) return;
      e.preventDefault();
    };
    window.addEventListener('wheel', block, { passive: false });
    window.addEventListener('touchmove', block, { passive: false });
    window.addEventListener('scroll', keep, { passive: true });
    return () => {
      window.removeEventListener('wheel', block);
      window.removeEventListener('touchmove', block);
      window.removeEventListener('scroll', keep);
      window.scrollTo(0, at());
    };
  }, [cityName]);

  /* ── keys ────────────────────────────────────────────────────────────── */
  useEffect(() => {
    if (!cityName) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (sheet) leaveRef.current();
        else if (fromSheet) setSheet(true);
        else closeHome();
      } else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && sheet && wide && anyLit) {
        // the sheet is read by scrolling, so the step starts from what is in
        // view: the open photo if it still is, else the edge being read towards
        const d = e.key === 'ArrowRight' ? 1 : -1;
        const { top, bottom } = read;
        const from =
          safeIndex >= top && safeIndex <= bottom ? safeIndex : d > 0 ? top - 1 : bottom + 1;
        const j = stepIndex(count, Math.max(-1, Math.min(count, from)), d, lit);
        if (j >= 0 && j < count && lit?.(j)) {
          setIndex(j);
          jumpTo(sheetRef.current, j, 'focus');
        }
      } else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'g' || e.key === 'G') {
        if (sheet) leaveRef.current();
        else setSheet(true);
      } else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [cityName, closeHome, go, sheet, fromSheet, wide, anyLit, count, lit, read, safeIndex]);

  /* ── pulling the sheet shut ─────────────────────────────────────────────
     The picture is closed by the root's pointer gesture, but the sheet is a
     scroller: the browser claimed every downward drag and cancelled the
     pointer after one move, so the sheet could not be pulled away. At the top
     there is nothing left to scroll up into, so the pull is taken here — the
     first move calls preventDefault before any scroll has begun, and the rest
     of the drag stays ours. Anywhere below the top it is a scroll, untouched. */
  useEffect(() => {
    const el = sheetRef.current;
    const root = rootRef.current;
    if (!sheet || !el || !root) return;
    let y0 = 0;
    let dy = 0;
    let mine = false;
    const start = (e: TouchEvent) => {
      y0 = e.touches[0]?.clientY ?? 0;
      dy = 0;
      mine = el.scrollTop <= 0 && e.touches.length === 1;
    };
    const move = (e: TouchEvent) => {
      if (!mine) return;
      if (e.touches.length > 1) {
        mine = false; // a second finger: it was a pinch
        return;
      }
      const d = (e.touches[0]?.clientY ?? 0) - y0;
      if (d <= 0) {
        mine = false; // going up is a scroll after all
        return;
      }
      e.preventDefault();
      dy = d;
      const k = Math.min(dy / 700, 1);
      root.style.transform = `translateY(${dy}px) scale(${1 - k * 0.1})`;
      root.style.opacity = String(1 - k * 0.45);
    };
    const end = () => {
      if (!mine) return;
      mine = false;
      if (dy > 150) {
        close();
        return;
      }
      root.style.transition = 'transform 320ms var(--ease), opacity 320ms var(--ease)';
      root.style.transform = '';
      root.style.opacity = '';
      window.setTimeout(() => {
        root.style.transition = '';
      }, 340);
    };
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
    return () => {
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', end);
      el.removeEventListener('touchcancel', end);
    };
    // the sheet mounts once the scope has widened, so wait for that too
  }, [sheet, scope, close]);

  /* ── the wheel over the picture: down is out (the sheet), up is back in;
        across (two fingers on a trackpad) is the band, 1:1 ───────────────── */
  const wheelAcc = useRef(0);
  const wheelFilm = useRef({ on: false, timer: 0, pts: [] as { x: number; t: number }[] });
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const w = wheelFilm.current;
    const onWheel = (e: WheelEvent) => {
      const t = e.target as Node;
      if (stripRef.current?.contains(t)) return; // the strip scrolls itself
      if (e.ctrlKey || e.metaKey) return; // a pinch: the sheet's own
      const inSheet = sheetRef.current?.contains(t) ?? false;
      if (!inSheet && Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        // the band follows the fingers; 80ms of quiet is the hand lifting
        const now = performance.now();
        if (!w.on) {
          w.on = true;
          stopFilm();
          film.grab();
          w.pts = [{ x: film.x, t: now }];
        }
        film.x = bandXRef.current(film.x - e.deltaX);
        w.pts.push({ x: film.x, t: now });
        if (w.pts.length > 12) w.pts.shift();
        drawFilm();
        window.clearTimeout(w.timer);
        w.timer = window.setTimeout(() => {
          w.on = false;
          letGoRef.current(speedOf(w.pts));
        }, 80);
        return;
      }
      if (inSheet) {
        // at the top of the sheet, a further push up goes back into the photo
        if (sheetRef.current!.scrollTop <= 0 && e.deltaY < 0) {
          wheelAcc.current += e.deltaY;
          if (wheelAcc.current < -160) {
            wheelAcc.current = 0;
            leaveRef.current();
          }
        } else wheelAcc.current = 0;
        return;
      }
      if (e.deltaY > 0) {
        wheelAcc.current += e.deltaY;
        if (wheelAcc.current > 160) {
          wheelAcc.current = 0;
          setSheet(true);
        }
      } else wheelAcc.current = 0;
    };
    el.addEventListener('wheel', onWheel, { passive: true });
    return () => {
      el.removeEventListener('wheel', onWheel);
      window.clearTimeout(w.timer);
    };
  }, [cityName, film, stopFilm, drawFilm]);

  /* ── the strip: a plain wheel moves it sideways, and it can be dragged ── */
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      strip.scrollLeft += Math.abs(e.deltaX) >= Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    };
    strip.addEventListener('wheel', onWheel, { passive: false });

    let down = false;
    let startX = 0;
    let startLeft = 0;
    let vel = 0;
    let raf = 0;
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return; // touch gets the native pan
      down = true;
      startX = e.clientX;
      startLeft = strip.scrollLeft;
      vel = 0;
      cancelAnimationFrame(raf);
      strip.classList.add('is-drag');
      strip.dataset.moved = '';
    };
    const onMove = (e: PointerEvent) => {
      if (!down) return;
      const dx = e.clientX - startX;
      if (Math.abs(dx) > 3) strip.dataset.moved = 'yes';
      const next = startLeft - dx;
      vel = next - strip.scrollLeft;
      strip.scrollLeft = next;
    };
    const glide = () => {
      if (Math.abs(vel) < 0.5) return;
      strip.scrollLeft += vel;
      vel *= 0.93;
      raf = requestAnimationFrame(glide);
    };
    const onUp = () => {
      if (!down) return;
      down = false;
      strip.classList.remove('is-drag');
      glide();
      window.setTimeout(() => {
        delete strip.dataset.moved;
      }, 0);
    };
    strip.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      strip.removeEventListener('wheel', onWheel);
      strip.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      cancelAnimationFrame(raf);
    };
  }, [cityName]);

  /* ── keeping the current frame in view, without moving the strip for nothing ──
     A frame tapped on the strip is already where the finger is: the strip used
     to scroll it to the middle anyway, a slide on every tap. Now the strip moves
     only as far as it must to keep the current frame clear of its edges — which
     for a tap is not at all, and for a swipe through the photos is a frame's
     width at a time. On opening, the frame is simply put in the middle. */
  const stripOpenedFor = useRef<string | null>(null);
  const stripAnchor = useRef<{ id: string; left: number } | null>(null);
  const pickedOnStrip = useRef(false);
  useLayoutEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    // In the wide book the strip holds the stop being looked at and its two
    // neighbours; stepping into a neighbour changes which stops those are, and
    // every frame shifts. The frame that was current is found again and the
    // scroll moved by exactly its shift, so nothing moves under the finger.
    const a = stripAnchor.current;
    if (a) {
      const same = strip.querySelector<HTMLElement>(`[data-id="${a.id}"]`);
      if (same && same.offsetLeft !== a.left) strip.scrollLeft += same.offsetLeft - a.left;
    }
    const cur = strip.querySelector<HTMLElement>('.pb__thumb.is-current');
    stripAnchor.current = cur ? { id: cur.dataset.id ?? '', left: cur.offsetLeft } : null;
  });
  useEffect(() => {
    if (!cityName) {
      // closed: the next open starts centred again
      stripOpenedFor.current = null;
      stripAnchor.current = null;
      return;
    }
    const strip = stripRef.current;
    const el = strip?.querySelector<HTMLElement>('.pb__thumb.is-current');
    if (!strip || !el) return;
    const openKeyNow = `${cityName}:${scope}`;
    if (stripOpenedFor.current !== openKeyNow) {
      stripOpenedFor.current = openKeyNow;
      strip.scrollLeft = el.offsetLeft - strip.clientWidth / 2 + el.offsetWidth / 2;
      return;
    }
    // A frame picked on the strip is where the reader put it: the strip moves only
    // if it is actually cut off by the edge. A photo reached by swiping keeps a
    // margin of air, so the next frames stay in sight.
    const picked = pickedOnStrip.current;
    pickedOnStrip.current = false;
    const margin = picked ? 8 : Math.min(96, strip.clientWidth / 4);
    const left = el.offsetLeft - strip.scrollLeft;
    const right = left + el.offsetWidth;
    if (left < margin) strip.scrollTo({ left: el.offsetLeft - margin, behavior: 'smooth' });
    else if (right > strip.clientWidth - margin)
      strip.scrollTo({
        left: el.offsetLeft + el.offsetWidth - strip.clientWidth + margin,
        behavior: 'smooth',
      });
  }, [safeIndex, cityName, scope]);

  /* ── the hand: across is the band, down (a finger) is out ────────────── */
  const gesture = useRef({
    down: false,
    sx: 0,
    sy: 0,
    axis: '' as '' | 'x' | 'y',
    dy: 0,
    t0: 0,
    mouse: false,
    /** where the band was when the hand took it */
    x0: 0,
    pts: [] as { x: number; t: number }[],
  });
  const onPointerDown = (e: React.PointerEvent) => {
    // closing into its ring and caught again: it opens back out from where it is
    if (ringClosing.current) {
      ringClosing.current();
      // the press that caught it is not also a turn of the page
      ringCaught.current = true;
      return;
    }
    ringCaught.current = false;
    const t = e.target as HTMLElement;
    const mouse = e.pointerType === 'mouse';
    // a mouse takes the band too, on the picture — not the controls round it
    if (mouse && (!slotRef.current?.contains(t) || t.closest('button'))) return;
    // the sheet scrolls and pinches, the strip scrolls, the map aims: none of
    // them is a swipe of the photo. A finger running along the strip used to
    // turn the photo as well, and the strip then pulled itself back to centre
    // the new one against the finger — a scroll that went and came back.
    if (sheetRef.current?.contains(t) || stripRef.current?.contains(t) || t.closest('.pb__locator'))
      return;
    if (mouse) {
      e.preventDefault();
      rootRef.current?.setPointerCapture(e.pointerId);
    }
    // a band in motion is caught where it is
    stopFilm();
    film.grab();
    dragged.current = false;
    gesture.current = {
      down: true,
      sx: e.clientX,
      sy: e.clientY,
      axis: '',
      dy: 0,
      t0: Date.now(),
      mouse,
      x0: film.x,
      pts: [],
    };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g.down) return;
    const dx = e.clientX - g.sx;
    const dy = e.clientY - g.sy;
    if (!g.axis) {
      if (Math.abs(dx) < (g.mouse ? 3 : 8) && Math.abs(dy) < 8) return;
      // a mouse only ever has the band; a finger may be pulling the book away
      g.axis = g.mouse || Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    }
    nudge();
    if (g.axis === 'x') {
      film.x = bandX(g.x0 + dx);
      g.pts.push({ x: film.x, t: performance.now() });
      if (g.pts.length > 12) g.pts.shift();
      if (Math.abs(dx) > 3) dragged.current = true;
      drawFilm();
      return;
    }
    g.dy = dy;
    const el = rootRef.current;
    const slotEl = slotRef.current;
    if (!el || !slotEl) return;
    if (dy >= 0 && !fromSheet) {
      /* down: the same move as up, the other way — the photo follows the finger
         and grows smaller, and the book around it (the bar, the strip, the dark)
         thins out until the journey shows through underneath */
      const k = Math.min(dy / 520, 1);
      const lift = { tx: dx * 0.75, ty: dy, s: 1 - k * 0.45 };
      liftRef.current = lift;
      slotEl.style.transition = 'none';
      slotEl.style.transform = `translate(${lift.tx}px, ${lift.ty}px) scale(${lift.s})`;
      el.style.setProperty('--pull', String(Math.min(dy / 320, 1) * 0.9));
      el.style.setProperty('--reach', '0');
    } else {
      /* up: the photo lifts and grows smaller under the finger, on its way to
         becoming a tile — let go past the line and it goes into the sheet from
         exactly where it was */
      el.style.transform = '';
      el.style.opacity = '';
      const k = Math.min(-dy / 420, 1);
      // the header answers the hand: at REACH_PX the city's total has rolled
      // over to the journey's, which is where letting go opens the sheet
      if (!fromSheet && !sheet) {
        el.classList.add('is-reaching');
        el.style.setProperty('--reach', String(Math.min(-dy / REACH_PX, 1)));
      }
      slotEl.style.transition = 'none';
      slotEl.style.transform = `translateY(${dy * 0.85}px) scale(${1 - k * 0.42})`;
    }
  };
  const endGesture = () => {
    const g = gesture.current;
    if (!g.down) return;
    g.down = false;
    const el = rootRef.current;
    const ms = Date.now() - g.t0;
    if (g.axis === 'x') {
      // the band goes on from where the hand left it, at the hand's last speed
      g.pts.push({ x: film.x, t: performance.now() });
      letGo(speedOf(g.pts), !g.mouse);
    } else if (!g.axis) {
      // a band caught on the way and let go without a move goes on to rest
      if (film.x !== 0) letGo(0);
    } else if (g.axis === 'y') {
      const slotEl = slotRef.current;
      // back to the sheet goes either way for a photo that came from it
      const up = g.dy < 0 || fromSheet;
      const flung = Math.abs(g.dy) / Math.max(ms, 1) > 0.45;
      const far = Math.abs(g.dy) > REACH_PX || (flung && Math.abs(g.dy) > 30);
      el?.classList.remove('is-reaching');
      if (up && far && !sheet) {
        // into the sheet, from where the photo is now; the frame is put back
        // once the sheet has covered it. A fling can let go short of the reach,
        // so the total finishes its roll with the sheet.
        if (el && !fromSheet) {
          el.style.setProperty('--reach', '1');
          el.classList.add('is-reached');
        }
        setSheet(true);
        window.setTimeout(() => {
          if (el) {
            el.classList.remove('is-reached');
            el.style.removeProperty('--reach');
          }
          if (slotEl) {
            slotEl.style.transition = '';
            slotEl.style.transform = '';
          }
        }, 520);
      } else if (up) {
        // short of it: the totals roll back with the photo
        el?.style.setProperty('--reach', '0');
        if (slotEl) {
          slotEl.style.transition = 'transform 320ms var(--ease)';
          slotEl.style.transform = '';
          window.setTimeout(() => {
            slotEl.style.transition = '';
          }, 340);
        }
      } else if (g.dy > 110 || (flung && g.dy > 30)) {
        closeHome();
      } else if (el && slotEl) {
        // not far enough: everything goes back where it was
        el.classList.add('is-releasing');
        el.style.setProperty('--pull', '0');
        slotEl.style.transition = 'transform 320ms var(--ease)';
        slotEl.style.transform = '';
        liftRef.current = null;
        window.setTimeout(() => {
          el.classList.remove('is-releasing');
          slotEl.style.transition = '';
        }, 340);
      }
    }
    g.axis = '';
  };

  /* A lift the root never hears — the pointer gone off the book, a cancel
     from the browser taking the gesture — still lets the band go. */
  const endRef = useRef(endGesture);
  endRef.current = endGesture;
  useEffect(() => {
    const end = () => endRef.current();
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  }, []);
  /* the cards' pictures are decoded as soon as they are in, off the band's
     way: a picture decoded on its first paint stalls the hand on a phone */
  useEffect(() => {
    const el = filmRef.current;
    if (!el) return;
    for (const img of Array.from(el.querySelectorAll('img'))) {
      if (!img.complete) img.decode().catch(() => {});
    }
  }, [cards]);

  /* ── the cursor is the accent dot, stretched by its own speed ────────── */
  const originOf = useCallback(() => figRef.current?.getBoundingClientRect() ?? null, []);
  const curRef = useRef<HTMLSpanElement>(null);
  const cursor = useRef({ x: 0, y: 0, vx: 0, vy: 0, raf: 0 });
  const onFigureMove = (e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    const fig = figRef.current;
    const cur = curRef.current;
    if (!fig || !cur) return;
    const r = fig.getBoundingClientRect();
    const c = cursor.current;
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    c.vx = x - c.x;
    c.vy = y - c.y;
    c.x = x;
    c.y = y;
    fig.dataset.side = x < r.width / 2 ? 'l' : 'r';
    if (c.raf) return;
    const tick = () => {
      c.vx *= 0.82;
      c.vy *= 0.82;
      const sp = Math.min(Math.hypot(c.vx, c.vy) / 26, 1);
      const ang = Math.abs(c.vx) + Math.abs(c.vy) > 0.4 ? Math.atan2(c.vy, c.vx) : 0;
      cur.style.transform = `translate(${c.x}px, ${c.y}px) rotate(${ang}rad) scale(${(1 + sp * 0.85).toFixed(3)}, ${(1 - sp * 0.32).toFixed(3)})`;
      c.raf = sp > 0.004 ? requestAnimationFrame(tick) : 0;
    };
    c.raf = requestAnimationFrame(tick);
  };
  const onFigureClick = (e: React.MouseEvent) => {
    const fig = figRef.current;
    if (!fig) return;
    // the band was dragged here: letting go is not also a click
    if (dragged.current) {
      dragged.current = false;
      return;
    }
    const r = fig.getBoundingClientRect();
    go(e.clientX - r.left < r.width / 2 ? -1 : 1);
  };

  useEffect(() => {
    closeHomeRef.current = () => {
      const root = rootRef.current;
      const slotEl = slotRef.current;
      const fig = figRef.current;
      if (!root || !slotEl || !fig || sheet || !photo) {
        close();
        return;
      }
      const spot = ringRef.current?.(photoCity ?? '') ?? null;
      if (spot && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        // back into the ring it came from (or the ring of the stop it has been
        // paged on to): the photo goes over to it, closing to a circle its size
        const tidy = () => {
          ringClosing.current = null;
          liftRef.current = null;
          clearRing(root);
        };
        // an opening turned round keeps the road it is on; otherwise the road
        // runs from where the photo is now (under a finger, or at rest)
        ringTurn.current += 1;
        root.style.setProperty('--ring-ms', `${ringMove.closeMs}ms`);
        root.style.setProperty('--ring-hold', String(ringMove.hold));
        if (!root.classList.contains('is-ringed')) {
          const at = slotAtRest(slotEl);
          const f = fig.getBoundingClientRect();
          setRing(root, spot, at, f.width / at.s, f.height / at.s);
          root.style.setProperty('--ring', '1');
          root.classList.add('is-ringed');
          slotEl.style.transition = '';
          slotEl.style.transform = '';
          void fig.offsetWidth;
        }
        root.classList.add('is-ring');
        root.style.setProperty('--ring', '0');
        root.style.setProperty('--pull', '1');
        window.clearTimeout(ringTimer.current);
        ringTimer.current = window.setTimeout(() => {
          tidy();
          close();
        }, ringMove.closeMs + 10);
        ringClosing.current = () => {
          window.clearTimeout(ringTimer.current);
          root.style.setProperty('--ring', '1');
          root.style.setProperty('--pull', '0');
          ringClosing.current = null;
          ringTimer.current = window.setTimeout(tidy, ringMove.closeMs + 10);
        };
        return;
      }
      const strip = document.querySelector<HTMLElement>('.filmstrip');
      const ours =
        strip && photosForStop(Number(strip.dataset.stop)).some((p) => p.id === photo.id);
      const frame = ours
        ? (strip.querySelector<HTMLElement>(`[data-photo-id="${photo.id}"]`) ??
          strip.querySelector<HTMLElement>('.filmstrip__more'))
        : null;
      const to = frame?.getBoundingClientRect();
      const lift = liftRef.current ?? { tx: 0, ty: 0, s: 1 };
      const slot = slotEl.getBoundingClientRect();
      const f = fig.getBoundingClientRect();
      // the slot scales about its centre, so its untransformed centre is this
      const cx = slot.left + slot.width / 2 - lift.tx;
      const cy = slot.top + slot.height / 2 - lift.ty;
      const w0 = f.width / lift.s;
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const end =
        to && to.width > 0
          ? {
              tx: to.left + to.width / 2 - cx,
              ty: to.top + to.height / 2 - cy,
              s: to.width / Math.max(1, w0),
            }
          : { tx: lift.tx, ty: lift.ty + window.innerHeight * 0.5, s: lift.s * 0.8 };
      const ms = reduce ? 0 : 340;
      root.classList.add('is-releasing');
      root.style.setProperty('--pull', '1');
      slotEl.style.transition = `transform ${ms}ms cubic-bezier(0.32, 0.72, 0, 1)`;
      slotEl.style.transform = `translate(${end.tx}px, ${end.ty}px) scale(${end.s})`;
      fig.style.transition = `opacity ${ms ? 120 : 0}ms ease ${ms ? 230 : 0}ms`;
      fig.style.opacity = to ? '0' : '0.4';
      window.setTimeout(() => {
        liftRef.current = null;
        root.classList.remove('is-releasing');
        root.style.removeProperty('--pull');
        slotEl.style.transition = '';
        slotEl.style.transform = '';
        fig.style.transition = '';
        fig.style.opacity = '';
        close();
      }, ms + 10);
    };
  });

  if (!cityName || count === 0 || !photo) return null;

  const date =
    photo.date && photo.date.includes('T')
      ? new Date(photo.date).toLocaleString(lang === 'ko' ? 'ko-KR' : 'en-US', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        })
      : photo.date || '';
  const place =
    photo.location || (photo.gps ? `${photo.gps.lat.toFixed(3)}, ${photo.gps.lng.toFixed(3)}` : '');
  // the words come with the city's caption file; until it is in, their line is kept
  const text = caption ?? '';
  const captionPending = caption === undefined;

  // The last photo of a city is where the dot comes to rest: it sits on the
  // full stop of the line that ends the city, stands up into a caret, and
  // folds back down. The seat goes on whichever line actually ends the block.
  const seat = (
    <span
      className="pb__seat"
      data-dot-end=""
      data-dot-active={atEnd && !sheet && !sideways ? '' : undefined}
      aria-hidden="true"
    />
  );

  return (
    <div
      className={`pb${anyLit ? ' is-lit' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={
        wide ? (lang === 'ko' ? '여정의 모든 사진' : 'Every photo of the journey') : cityName
      }
      ref={rootRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endGesture}
      onPointerCancel={endGesture}
      onLostPointerCapture={endGesture}
      onClickCapture={(e) => {
        if (!ringCaught.current) return;
        ringCaught.current = false;
        e.stopPropagation();
      }}
    >
      {/* The rest step back from the chosen theme. Every tile and thumbnail
          carries its themes once (data-t); choosing is this one rule, so the
          two thousand tiles are never drawn again for it. */}
      {anyLit && theme && (
        <style>{`.pb.is-lit .pb__cell:not([data-t~="${theme}"]),.pb.is-lit .pb__thumb:not([data-t~="${theme}"]){opacity:0.16 !important;filter:grayscale(1)}`}</style>
      )}
      <div
        className="pb__backdrop"
        onClick={() => (fromSheet && !sheet ? setSheet(true) : closeHome())}
      />

      <div className="pb__top mono" ref={topRef}>
        {/* the where: the reading's place on the journey, in the corner, beside its name */}
        {wide && (
          <RollLocator
            index={spoken}
            dot={rollSheet && !sideways}
            lang={lang}
            onPick={(i) => {
              if (rollSheet) jumpTo(sheetRef.current, i);
              else setIndex(i);
            }}
          />
        )}
        <span className="pb__city">
          {wide ? (
            <span className="pb__cityroll" key={spokenCity}>
              <b className={(rollSheet ? readDir : dir) > 0 ? 'is-up' : 'is-down'}>{spokenCity}</b>
            </span>
          ) : (
            cityName
          )}
        </span>
        <span className="pb__counter">
          <span
            className={`pb__roll${wide ? ' is-wide' : ''}`}
            aria-live={rollSheet ? undefined : 'polite'}
            // on its side the strip and the caption fold away, and the dot that
            // stood under the current thumbnail stands under its number instead
            data-dot-active={sideways && !sheet ? '' : undefined}
          >
            <b key={spoken} className={(rollSheet ? readDir : dir) > 0 ? 'is-up' : 'is-down'}>
              {wide ? rollNo(spoken) : String(safeIndex + 1).padStart(2, '0')}
            </b>
          </span>
          &nbsp;/&nbsp;
          <button
            type="button"
            className={`pb__all${sheet ? ' is-on' : ''}`}
            onClick={() => (sheet ? leaveSheet() : setSheet(true))}
            aria-pressed={sheet}
            title={lang === 'ko' ? '전부 보기 (G)' : 'See them all (G)'}
          >
            {/* the total rolls over when the book widens: 47 becomes 2,297 */}
            <span className={`pb__allroll${wide ? '' : ' is-city'}`} key={wide ? 'all' : 'city'}>
              <b className={wide ? 'is-up' : 'is-down'}>
                {wide ? TOTAL_LABEL : String(count).padStart(2, '0')}
              </b>
              {/* the journey's total, waiting under the city's for a finger
                  lifting the photo to roll it in (--reach) */}
              {!wide && <i className="pb__allghost">{TOTAL_LABEL}</i>}
            </span>
          </button>
        </span>
        <span className={`pb__keys${hintGone ? ' is-gone' : ''}`} aria-hidden="true">
          <kbd>←</kbd>
          <kbd>→</kbd>
          <span>{lang === 'ko' ? '넘기기' : 'browse'}</span>
          <kbd>G</kbd>
          <span>{lang === 'ko' ? '전체' : 'all'}</span>
          <kbd>ESC</kbd>
          <span>{lang === 'ko' ? '닫기' : 'close'}</span>
        </span>
        <button
          type="button"
          className={`pb__sheetbtn mono${sheet ? ' is-on' : ''}`}
          onClick={() => (sheet ? leaveSheet() : setSheet(true))}
          aria-pressed={sheet}
        >
          {lang === 'ko' ? '전체' : 'all'}
        </button>
        <button type="button" className="pb__btn" onClick={closeHome} aria-label="Close">
          <X size={16} strokeWidth={1.5} />
        </button>
      </div>

      {/* the one place a theme is chosen — the globe puts the same row under its bar */}
      <ThemeRow className="pb__themerow" lang={lang} moving={busy || scrubbing} wake={topRef} />

      <div className="pb__stage">
        <div className="pb__slot" ref={slotRef}>
          {/* the band: each card its own frame, the photo's shape, its tones
              under it until the picture is in — so a late one moves the same */}
          <div className="pb__film" ref={filmRef}>
            {cards.map(({ i, k }, n) => {
              const p = photos[i];
              const here = k === 0;
              const size = lane?.sizes[n] ?? (here ? box : null);
              const c = lane?.centres[n] ?? 0;
              const tone = p.tone?.split(',');
              return (
                <figure
                  key={p.id}
                  className={`pb__frame${here ? ' is-here' : ''}${here && zoomFrom ? ' is-zooming' : ''}`}
                  ref={here ? figRef : undefined}
                  style={
                    size
                      ? ({
                          width: size.w,
                          height: size.h,
                          left: `calc(50% + ${c - size.w / 2}px)`,
                          top: `calc(50% - ${size.h / 2}px)`,
                          ...(tone?.length === 2
                            ? { background: `linear-gradient(#${tone[0]}, #${tone[1]})` }
                            : {}),
                          ...(here && zoomFrom
                            ? {
                                '--zx': `${zoomFrom.zx}px`,
                                '--zy': `${zoomFrom.zy}px`,
                                '--zs': String(zoomFrom.zs),
                              }
                            : {}),
                        } as React.CSSProperties)
                      : undefined
                  }
                  onPointerMove={here ? onFigureMove : undefined}
                  onClick={here ? onFigureClick : undefined}
                >
                  {here && growing && (
                    <img
                      key={`${p.id}:tile`}
                      className="pb__img is-tile"
                      src={srcFor(p, 480, { exact: true })}
                      alt=""
                      aria-hidden="true"
                      draggable={false}
                    />
                  )}
                  {size && (
                    <img
                      ref={here ? mainImgRef : undefined}
                      className={`pb__img${here && growing ? ' is-waiting' : ''}`}
                      src={srcFor(p, size.w)}
                      alt={here ? text : ''}
                      aria-hidden={here ? undefined : true}
                      decoding="async"
                      fetchPriority={here ? 'high' : undefined}
                      draggable={false}
                      onLoad={here ? () => setSharpId(p.id) : undefined}
                      onError={here ? () => setSharpId(p.id) : undefined}
                    />
                  )}
                  {here && <span className="pb__cursor" ref={curRef} aria-hidden="true" />}
                </figure>
              );
            })}
          </div>
        </div>

        <figcaption className="pb__cap" key={photo.id}>
          {(text || captionPending) && (
            <span className="pb__text">
              {text || '\u00a0'}
              {text && seat}
            </span>
          )}
          <span className="pb__meta mono">
            {date}
            {place ? ` · ${place}` : ''}
            {!text && seat}
          </span>
        </figcaption>

        <button
          type="button"
          className="pb__nav pb__nav--prev"
          onClick={() => go(-1)}
          aria-label="Previous"
        >
          <ChevronLeft size={20} strokeWidth={1.5} />
        </button>
        <button
          type="button"
          className="pb__nav pb__nav--next"
          onClick={() => go(1)}
          aria-label="Next"
        >
          <ChevronRight size={20} strokeWidth={1.5} />
        </button>
      </div>

      {rollSheet && (
        <JourneySheet
          scroller={sheetRef}
          current={safeIndex}
          restoreTop={sheetMemory}
          perRow={perRow}
          fold={dense === 2}
          lang={lang}
          arrive={arrive}
          origin={originOf}
          onZoom={onZoom}
          onOpen={onOpenTile}
          onRead={onRead}
          onHover={setHover}
        />
      )}

      <div className="pb__strip" ref={stripRef}>
        {stripRange.map((i) => {
          const p = photos[i];
          const d = Math.abs(i - safeIndex);
          const seamBefore =
            wide && i > stripRange[0] && journeyRoll.blockOf[i] !== journeyRoll.blockOf[i - 1];
          return (
            <Fragment key={p.id}>
              {seamBefore && (
                <span className="pb__stripseam mono" aria-hidden="true">
                  <span>
                    {cityLabel(journeyRoll.blocks[journeyRoll.blockOf[i]].stop.city, lang)}
                  </span>
                </span>
              )}
              <button
                type="button"
                className={`pb__thumb${i === safeIndex ? ' is-current' : ''}`}
                data-id={p.id}
                data-t={themesOf(p.id).join(' ')}
                style={{ opacity: d === 0 ? 1 : d === 1 ? 0.72 : d === 2 ? 0.55 : 0.38 }}
                data-dot-active={!sheet && !atEnd && !sideways && i === safeIndex ? '' : undefined}
                onClick={() => {
                  if (stripRef.current?.dataset.moved) return;
                  pickedOnStrip.current = true;
                  setIndex(i);
                }}
                aria-label={`${i + 1}`}
                aria-current={i === safeIndex}
              >
                <img src={thumbFor(p)} alt="" loading="lazy" decoding="async" />
              </button>
            </Fragment>
          );
        })}
      </div>

      {/* the when: under the wide sheet the strip gives its place to the year */}
      {rollSheet && (
        <YearWave
          top={read.top}
          bottom={read.bottom}
          hover={hover}
          lang={lang}
          theme={theme}
          onScrub={(i) => jumpTo(sheetRef.current, i)}
          onScrubbing={setScrubbing}
        />
      )}
    </div>
  );
}
