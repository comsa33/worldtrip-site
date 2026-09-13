/**
 * The journey, written out as a tune: one note for every stop, composed once
 * from the route, so the notes the dot lands on make a melody rather than a
 * handful of pitches struck over and over.
 *
 * It is a walk on the D major pentatonic, and the route decides each step:
 * going north the tune goes up, going south it goes down, and how far it moves
 * follows how far the dot went — the next town is the next note, a flight
 * across an ocean is a leap. Along a parallel it keeps the way it was going.
 * It never strikes one note twice in a row, nor swings straight back to the
 * one before, and at the edges of its range it turns around.
 *
 * Under it a chord changes with the country — D, B minor, G, A, round again —
 * so crossing a border is a new bar. Every note of the scale sits well over
 * all four. Because the tune is written from the route and not from the hand,
 * a stop always sounds its own note: scrub back and play it again, and it is
 * the same melody.
 */

export type ScoreNote = {
  /** position on the scale, 0 (D3) … 10 (D5) */
  step: number;
  /** which chord the country is under: 0 D, 1 Bm, 2 G, 3 A */
  chord: number;
  /** the first stop in a new country */
  downbeat: boolean;
};

type Place = { lat: number; lng: number };
type Stop = { city: string; country: string };

const TOP = 10;
const BOTTOM = 1;
const START = 5;

const km = (a: Place, b: Place) => {
  const r = (d: number) => (d * Math.PI) / 180;
  const h =
    Math.sin(r(b.lat - a.lat) / 2) ** 2 +
    Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};

/** how many steps a hop of this length moves the tune */
const reach = (d: number) => (d < 120 ? 1 : d < 700 ? 2 : d < 3000 ? 3 : 4);

export function composeJourney(stops: Stop[], cities: Record<string, Place>): ScoreNote[] {
  const out: ScoreNote[] = [];
  let step = START;
  let before = START;
  let chord = 0;
  let dir = 1;
  const bounce = (n: number) => {
    if (n > TOP) {
      dir = -1;
      return TOP - (n - TOP);
    }
    if (n < BOTTOM) {
      dir = 1;
      return BOTTOM + (BOTTOM - n);
    }
    return n;
  };
  for (let i = 0; i < stops.length; i++) {
    const here = cities[stops[i].city];
    const prev = i > 0 ? cities[stops[i - 1].city] : null;
    const downbeat = i > 0 && stops[i].country !== stops[i - 1].country;
    if (downbeat) chord = (chord + 1) % 4;
    if (here && prev) {
      const dLat = here.lat - prev.lat;
      // north or south sets the way; along a parallel the tune keeps the way it was going
      if (Math.abs(dLat) > 0.25) dir = Math.sign(dLat);
      const by = reach(km(prev, here));
      let next = bounce(step + dir * by);
      // no note twice in a row, and no swinging back to the one before last
      if (next === step || next === before) next = bounce(step + dir * (by + 1));
      if (next === step || next === before) next = bounce(step - dir);
      before = step;
      step = next;
    }
    out.push({ step, chord, downbeat });
  }
  return out;
}
