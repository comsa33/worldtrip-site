import journeyData from '../data/journey.json';
import citiesData from '../data/cities.json';
import { composeJourney, type ScoreNote } from './journeyScore';
import { photosForStop, type VisitPhoto } from './visitPhotos';

interface RollStop {
  id: number;
  city: string;
  country: string;
  transport: string;
  startDate: string;
  endDate: string;
}

export interface RollBlock {
  stop: RollStop;
  /** the stop before it on the journey, photographed or not — the seam says how it was left */
  prev: RollStop | null;
  /** index of this block's first photo in the roll */
  start: number;
  count: number;
  /** which time the journey came to this city, counting from 1 */
  visit: number;
}

const stops = journeyData.stops as RollStop[];

/** First day of the journey, as a timestamp at midnight UTC. */
const D0 = Date.parse(journeyData.startDate);
export const JOURNEY_DAYS: number = journeyData.totalDays;

/** Day 1 is the day the journey left Gwangju. */
export const dayOf = (iso: string) =>
  Math.floor((Date.parse(iso.slice(0, 10)) - D0) / 86400000) + 1;

/**
 * The whole journey's photos as one roll, in the order it was walked.
 *
 * The photo book used to be a city's; this is the same book with its walls
 * taken down. Each stop is a block, and a block begins with the seam that says
 * how the journey got there. A photo belongs to exactly one stop (see
 * visitPhotos), so nothing is shown twice.
 */
export const journeyRoll: { photos: VisitPhoto[]; blocks: RollBlock[]; blockOf: number[] } =
  (() => {
    const photos: VisitPhoto[] = [];
    const blocks: RollBlock[] = [];
    const blockOf: number[] = [];
    const seen = new Map<string, number>();
    stops.forEach((stop, i) => {
      const visit = (seen.get(stop.city) ?? 0) + 1;
      seen.set(stop.city, visit);
      const mine = photosForStop(stop.id);
      if (!mine.length) return;
      blocks.push({
        stop,
        prev: stops[i - 1] ?? null,
        start: photos.length,
        count: mine.length,
        visit,
      });
      for (const p of mine) {
        blockOf.push(blocks.length - 1);
        photos.push(p);
      }
    });
    return { photos, blocks, blockOf };
  })();

/** How many photos each day of the journey left, index 1..JOURNEY_DAYS; and the first photo of each day. */
export const rollDays: { count: number[]; first: number[] } = (() => {
  const count = new Array<number>(JOURNEY_DAYS + 2).fill(0);
  const first = new Array<number>(JOURNEY_DAYS + 2).fill(-1);
  journeyRoll.photos.forEach((p, i) => {
    if (!p.date) return;
    const d = dayOf(p.date);
    if (d < 1 || d > JOURNEY_DAYS) return;
    count[d]++;
    if (first[d] < 0) first[d] = i;
  });
  return { count, first };
})();

/** The roll index where a stop's photos begin, or the nearest photographed stop before it. */
export function rollIndexForStop(stopId: number | null | undefined): number {
  if (stopId == null) return 0;
  const order = stops.findIndex((s) => s.id === stopId);
  let best = 0;
  for (const b of journeyRoll.blocks) {
    if (stops.findIndex((s) => s.id === b.stop.id) <= order) best = b.start;
    else break;
  }
  return best;
}

/** The stop's position on the journey (0-based), for the locator's route tenses. */
export const stopOrder = (stopId: number) => stops.findIndex((s) => s.id === stopId);

/** A photo's number in the roll, as the counter spells it. */
export const rollNo = (i: number) => String(i + 1).padStart(4, '0');
export const TOTAL_LABEL = journeyRoll.photos.length.toLocaleString('en-US');

const CITY_NAMES = citiesData.cities as Record<string, { ko: string; en: string }>;
export const cityLabel = (city: string, lang: 'ko' | 'en') => CITY_NAMES[city]?.[lang] ?? city;

/** Put roll photo `i` at the top of the sheet — the seam first if it begins a stop. */
export function jumpTo(sheet: HTMLElement | null, i: number, where: 'top' | 'focus' = 'top') {
  if (!sheet) return;
  const block = journeyRoll.blocks[journeyRoll.blockOf[i]];
  const el =
    (block && block.start === i && sheet.querySelector<HTMLElement>(`[data-seam="${i}"]`)) ||
    sheet.querySelector<HTMLElement>(`[data-i="${i}"]`);
  if (!el) return;
  sheet.scrollTop = where === 'top' ? el.offsetTop : el.offsetTop - sheet.clientHeight * 0.3; // exactly at the seam: a few pixels above it showed the last row's edges as a stray line
}

/** The journey's tune, a note for every stop — the same one the globe plays on landing. */
const SCORE: ScoreNote[] = composeJourney(
  stops,
  citiesData.cities as Record<string, { lat: number; lng: number }>
);
export const noteForStop = (stopId: number): ScoreNote | undefined => SCORE[stopOrder(stopId)];
