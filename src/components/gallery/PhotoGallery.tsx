import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import { useI18n } from '../../i18n';
import cityPhotosData from '../../data/cityPhotos.json';
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
}

interface CityPhotoData {
  cityCode: string;
  photos: Photo[];
}

interface PhotoGalleryProps {
  cityName: string | null;
  photoIds?: string[] | null;
  initialPhotoId?: string | null;
  onClose: () => void;
}

/** Widths worth asking Cloudinary for. Anything between rounds up to the next one. */
const STEPS = [480, 640, 800, 1000, 1280, 1600, 2048, 2560];

const DEFAULT_AR = 4 / 3;
const arOf = (p: Photo) => (p.w && p.h ? p.w / p.h : DEFAULT_AR);

/**
 * One source at the size it will actually be drawn, capped at the original.
 * Asking for a single 1600px file meant every phone paid for pixels it threw
 * away, and every retina desktop got less than it needed.
 */
function srcFor(p: Photo, cssWidth: number): string {
  if (!p.url) return '';
  const want = cssWidth * (typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1);
  const step = STEPS.find((s) => s >= want) ?? STEPS[STEPS.length - 1];
  const w = p.w ? Math.min(step, p.w) : step;
  return p.url.replace('/f_auto,q_auto/', `/f_auto,q_auto:good,w_${w}/`);
}

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
  photoIds,
  initialPhotoId,
  onClose,
}: PhotoGalleryProps) {
  const { language } = useI18n();
  const lang = language as 'ko' | 'en';
  const cityPhotos = cityPhotosData as Record<string, CityPhotoData>;

  const photos = useMemo(() => {
    if (!cityName || !cityPhotos[cityName]) return [] as Photo[];
    let list = cityPhotos[cityName].photos;
    if (photoIds && photoIds.length > 0) {
      const ids = new Set(photoIds);
      list = list.filter((p) => ids.has(p.id));
    }
    return [...list].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [cityName, photoIds, cityPhotos]);

  const [index, setIndex] = useState(0);
  const openKey = `${cityName}:${initialPhotoId ?? ''}:${photoIds?.join(',') ?? ''}`;
  const [lastKey, setLastKey] = useState(openKey);
  if (openKey !== lastKey) {
    // a new open: start at the requested photo (state reset during render, per React guidance)
    setLastKey(openKey);
    const i = initialPhotoId ? photos.findIndex((p) => p.id === initialPhotoId) : 0;
    setIndex(i >= 0 ? i : 0);
  }

  const count = photos.length;
  const safeIndex = count ? Math.min(index, count - 1) : 0;
  const photo: Photo | undefined = photos[safeIndex];
  const atEnd = count > 0 && safeIndex === count - 1;

  const go = useCallback(
    (d: number) => setIndex((i) => Math.max(0, Math.min(count - 1, i + d))),
    [count]
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

  /* ── the outgoing photo keeps its place until the new one has decoded ── */
  const [holding, setHolding] = useState<Photo | null>(null);
  const [shownId, setShownId] = useState<string | undefined>(photo?.id);
  const [dir, setDir] = useState(1);
  if (photo && shownId !== photo.id) {
    // the photo changed this render: keep the old one on screen until the new
    // one reports it has decoded (state reset during render, per React guidance)
    const prevIdx = photos.findIndex((p) => p.id === shownId);
    setDir(prevIdx >= 0 && prevIdx > safeIndex ? -1 : 1);
    setHolding(photos.find((p) => p.id === shownId) ?? null);
    setShownId(photo.id);
  }

  // the whole city at once, as a contact sheet — G toggles, a tile opens it there
  const [sheet, setSheet] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // where the tile was, relative to where the frame will be — measured in the
  // click, so the render only reads state
  const [zoomFrom, setZoomFrom] = useState<{ zx: number; zy: number; zs: number } | null>(null);
  const openFromTile = (i: number, el: HTMLElement) => {
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
    setIndex(i);
    setSheet(false);
  };
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
    const y = window.scrollY;
    const keep = () => {
      if (window.scrollY !== y) window.scrollTo(0, y);
    };
    // The strip does its own horizontal scrolling; everything else would move
    // the globe behind the lightbox, which is how the wheel "stopped working".
    const block = (e: Event) => {
      const t = e.target;
      if (t instanceof Node && (stripRef.current?.contains(t) || sheetRef.current?.contains(t)))
        return;
      e.preventDefault();
    };
    window.addEventListener('wheel', block, { passive: false });
    window.addEventListener('touchmove', block, { passive: false });
    window.addEventListener('scroll', keep, { passive: true });
    return () => {
      window.removeEventListener('wheel', block);
      window.removeEventListener('touchmove', block);
      window.removeEventListener('scroll', keep);
      window.scrollTo(0, y);
    };
  }, [cityName]);

  /* ── keys ────────────────────────────────────────────────────────────── */
  useEffect(() => {
    if (!cityName) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (sheet) setSheet(false);
        else onClose();
      } else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'g' || e.key === 'G') setSheet((v) => !v);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [cityName, onClose, go, sheet]);

  /* ── the wheel over the picture: down is out (the sheet), up is back in ── */
  const wheelAcc = useRef(0);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const t = e.target as Node;
      if (stripRef.current?.contains(t)) return; // the strip scrolls itself
      const inSheet = sheetRef.current?.contains(t) ?? false;
      if (inSheet) {
        // at the top of the sheet, a further push up goes back into the photo
        if (sheetRef.current!.scrollTop <= 0 && e.deltaY < 0) {
          wheelAcc.current += e.deltaY;
          if (wheelAcc.current < -160) {
            wheelAcc.current = 0;
            setSheet(false);
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
    return () => el.removeEventListener('wheel', onWheel);
  }, [cityName]);

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

  /* keep the current thumbnail in view without yanking the strip around */
  useEffect(() => {
    const strip = stripRef.current;
    const el = strip?.querySelector<HTMLElement>('.pb__thumb.is-current');
    if (!strip || !el) return;
    strip.scrollTo({
      left: el.offsetLeft - strip.clientWidth / 2 + el.offsetWidth / 2,
      behavior: 'smooth',
    });
  }, [safeIndex, cityName]);

  /* ── touch: swipe across, pull down to close ─────────────────────────── */
  const gesture = useRef({ down: false, sx: 0, sy: 0, axis: '' as '' | 'x' | 'y', dy: 0, t0: 0 });
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') return;
    gesture.current = { down: true, sx: e.clientX, sy: e.clientY, axis: '', dy: 0, t0: Date.now() };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g.down) return;
    const dx = e.clientX - g.sx;
    const dy = e.clientY - g.sy;
    if (!g.axis) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      g.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    }
    if (g.axis === 'x') {
      const slotEl = slotRef.current;
      if (!slotEl) return;
      const atEnd = (dx > 0 && safeIndex === 0) || (dx < 0 && safeIndex === count - 1);
      slotEl.style.transition = 'none';
      slotEl.style.transform = `translateX(${atEnd ? dx * 0.32 : dx * 0.9}px)`;
      return;
    }
    g.dy = Math.max(0, dy);
    const k = Math.min(g.dy / 700, 1);
    const el = rootRef.current;
    if (!el) return;
    el.style.transform = `translateY(${g.dy}px) scale(${1 - k * 0.1})`;
    el.style.opacity = String(1 - k * 0.45);
  };
  const endGesture = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g.down) return;
    g.down = false;
    const el = rootRef.current;
    const dx = e.clientX - g.sx;
    const ms = Date.now() - g.t0;
    if (g.axis === 'x') {
      const slotEl = slotRef.current;
      if (slotEl) {
        slotEl.style.transition = 'transform 320ms var(--ease)';
        slotEl.style.transform = '';
        window.setTimeout(() => {
          slotEl.style.transition = '';
        }, 340);
      }
      const fling = Math.abs(dx) / Math.max(ms, 1) > 0.45;
      const moved = Math.abs(dx) > 60 || fling;
      const next = safeIndex + (dx < 0 ? 1 : -1);
      if (moved && next >= 0 && next < count) {
        go(dx < 0 ? 1 : -1);
        if (navigator.vibrate) {
          try {
            navigator.vibrate(8);
          } catch {
            /* no haptics here */
          }
        }
      }
    } else if (g.axis === 'y') {
      if (g.dy > 150) {
        onClose();
      } else if (el) {
        el.style.transition = 'transform 320ms var(--ease), opacity 320ms var(--ease)';
        el.style.transform = '';
        el.style.opacity = '';
        window.setTimeout(() => {
          if (el) el.style.transition = '';
        }, 340);
      }
    }
    g.axis = '';
  };

  /* ── the cursor is the accent dot, stretched by its own speed ────────── */
  const figRef = useRef<HTMLElement>(null);
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
    const r = fig.getBoundingClientRect();
    go(e.clientX - r.left < r.width / 2 ? -1 : 1);
  };

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
  const text = photo.caption[lang]?.trim() ?? '';

  // The last photo of a city is where the dot comes to rest: it sits on the
  // full stop of the line that ends the city, stands up into a caret, and
  // folds back down. The seat goes on whichever line actually ends the block.
  const seat = (
    <span
      className="pb__seat"
      data-dot-end=""
      data-dot-active={atEnd && !sheet ? '' : undefined}
      aria-hidden="true"
    />
  );

  return (
    <div
      className="pb"
      role="dialog"
      aria-modal="true"
      aria-label={cityName}
      ref={rootRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endGesture}
      onPointerCancel={endGesture}
    >
      <div className="pb__backdrop" onClick={onClose} />

      <div className="pb__top mono">
        <span className="pb__city">{cityName}</span>
        <span className="pb__counter">
          <span className="pb__roll" aria-live="polite">
            <b key={safeIndex} className={dir > 0 ? 'is-up' : 'is-down'}>
              {String(safeIndex + 1).padStart(2, '0')}
            </b>
          </span>
          &nbsp;/&nbsp;
          <button
            type="button"
            className={`pb__all${sheet ? ' is-on' : ''}`}
            onClick={() => setSheet((v) => !v)}
            aria-pressed={sheet}
            title={lang === 'ko' ? '전부 보기 (G)' : 'See them all (G)'}
          >
            {String(count).padStart(2, '0')}
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
          onClick={() => setSheet((v) => !v)}
          aria-pressed={sheet}
        >
          {lang === 'ko' ? '전체' : 'all'}
        </button>
        <button type="button" className="pb__btn" onClick={onClose} aria-label="Close">
          <X size={16} strokeWidth={1.5} />
        </button>
      </div>

      <div className="pb__stage">
        <div className="pb__slot" ref={slotRef}>
          <figure
            className={`pb__frame${zoomFrom ? ' is-zooming' : ''}`}
            ref={figRef}
            style={
              box
                ? ({
                    width: box.w,
                    height: box.h,
                    ...(zoomFrom
                      ? {
                          '--zx': `${zoomFrom.zx}px`,
                          '--zy': `${zoomFrom.zy}px`,
                          '--zs': String(zoomFrom.zs),
                        }
                      : {}),
                  } as React.CSSProperties)
                : undefined
            }
            onPointerMove={onFigureMove}
            onClick={onFigureClick}
          >
            {holding && box && (
              <img
                key={holding.id}
                className="pb__img is-out"
                src={srcFor(holding, box.w)}
                alt=""
                aria-hidden="true"
              />
            )}
            <img
              key={photo.id}
              className="pb__img"
              src={srcFor(photo, box?.w ?? 800)}
              alt={text}
              decoding="async"
              fetchPriority="high"
              onLoad={() => setHolding(null)}
              onError={() => setHolding(null)}
            />
            <span className="pb__cursor" ref={curRef} aria-hidden="true" />
          </figure>
        </div>

        <figcaption className="pb__cap" key={photo.id}>
          {text && (
            <span className="pb__text">
              {text}
              {seat}
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

      {sheet && (
        <div
          className="pb__sheet"
          ref={sheetRef}
          role="grid"
          aria-label={`${cityName} — all photos`}
        >
          {(() => {
            const perRow = typeof window !== 'undefined' && window.innerWidth < 768 ? 3 : 6;
            const rows: Photo[][] = [];
            for (let i = 0; i < photos.length; i += perRow) rows.push(photos.slice(i, i + perRow));
            return rows.map((row, r) => (
              <div className="pb__sheetrow" role="row" key={r}>
                {row.map((p, j) => {
                  const i = r * perRow + j;
                  return (
                    <button
                      type="button"
                      key={p.id}
                      role="gridcell"
                      className={`pb__cell${i === safeIndex ? ' is-current' : ''}`}
                      style={{ '--ar': String(arOf(p)) } as React.CSSProperties}
                      data-dot-active={i === safeIndex ? '' : undefined}
                      onClick={(e) => openFromTile(i, e.currentTarget)}
                      aria-label={`${i + 1}`}
                    >
                      <img src={srcFor(p, 320)} alt="" loading="lazy" decoding="async" />
                      <span className="pb__cellno mono">{String(i + 1).padStart(2, '0')}</span>
                    </button>
                  );
                })}
              </div>
            ));
          })()}
        </div>
      )}

      <span className={`pb__touchhint mono${hintGone ? ' is-gone' : ''}`} aria-hidden="true">
        {lang === 'ko' ? '← 쓸어 넘기기 · 아래로 당겨 닫기 ↓' : '← swipe · pull down to close ↓'}
      </span>

      <div className="pb__strip" ref={stripRef}>
        {photos.map((p, i) => {
          const d = Math.abs(i - safeIndex);
          return (
            <button
              key={p.id}
              type="button"
              className={`pb__thumb${i === safeIndex ? ' is-current' : ''}`}
              style={{ opacity: d === 0 ? 1 : d === 1 ? 0.72 : d === 2 ? 0.55 : 0.38 }}
              data-dot-active={!sheet && !atEnd && i === safeIndex ? '' : undefined}
              onClick={() => {
                if (stripRef.current?.dataset.moved) return;
                setIndex(i);
              }}
              aria-label={`${i + 1}`}
              aria-current={i === safeIndex}
            >
              <img src={thumbFor(p)} alt="" loading="lazy" decoding="async" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
