import { useRef } from 'react';
import { useI18n } from '../../i18n';
import { NoteCard, type Note } from './NoteCard';
import { useSelfTyped } from './useSelfTyped';
import { useDotAnchor, useLinger, type Side } from './useDotAnchor';
import type { Pace } from './typewriter';
import notesData from '../../data/cityNotes.json';
import './AboutOverlay.css';

type Written = { title?: string; story: string; quote?: string };
// the file leads with a `_형식` block so the shape is visible when you open it
// to write; only numeric stop ids are ever looked up
const notes = notesData as unknown as Record<string, { ko: Written; en?: Written }>;

const QUICK: Pace = { pace: 0.45, lead: 300 };

/** Cities read once stay read: coming back to one does not retype it. */
const seen = new Set<string>();

/**
 * What a city has to say, once the journey has actually stopped there.
 *
 * The same block as the opening and the closing, written by its own cursor.
 * Cities with nothing written for them stay quiet — most of them, at first.
 */
export default function StopNote({
  stopId,
  city,
  startDate,
  visible,
  side = 'below',
}: {
  stopId: number;
  city: string;
  startDate: string;
  visible: boolean;
  /** which side of the dot the words sit on — above when the next leg heads down */
  side?: Side;
}) {
  const { language } = useI18n();
  const lang = language as 'ko' | 'en';
  const ref = useRef<HTMLDivElement>(null);
  const entry = notes[String(stopId)];
  const written = entry ? (entry[lang] ?? entry.ko) : null;
  const key = `${stopId}:${lang}`;
  const active = visible && Boolean(written);
  // gone means fading, not vanishing: a beat in the document on the way out
  const { mounted, leaving } = useLinger(active, 240);

  // a note is read in the gap between two scrolls, and the reader has already
  // waited out the dwell — this hand moves at about twice the opening's
  useSelfTyped(ref, active, key, seen, QUICK);
  // on a wide screen the note hangs off the dot, where the reader is looking
  useDotAnchor(ref, active, side);

  if (!mounted || !written) return null;

  const [y, m] = startDate.split('-');
  const note: Note = {
    // the eyebrow writes itself from the journey — only the words are yours
    subtitle:
      lang === 'ko' ? `${y}년 ${Number(m)}월, ${city}` : `${MONTHS[Number(m) - 1]} ${y}, ${city}`,
    title: written.title,
    story: written.story,
    quote: written.quote,
  };

  return (
    <div className={`about-overlay${leaving ? ' is-away' : ''}`} ref={ref}>
      <NoteCard note={note} />
    </div>
  );
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
