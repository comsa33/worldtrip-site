import { useRef } from 'react';
import { useI18n } from '../../i18n';
import { NoteCard, type Note } from './NoteCard';
import { useSelfTyped } from './useSelfTyped';
import notesData from '../../data/cityNotes.json';
import './AboutOverlay.css';

type Written = { title?: string; story: string; quote?: string };
// the file leads with a `_형식` block so the shape is visible when you open it
// to write; only numeric stop ids are ever looked up
const notes = notesData as unknown as Record<string, { ko: Written; en?: Written }>;

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
}: {
  stopId: number;
  city: string;
  startDate: string;
  visible: boolean;
}) {
  const { language } = useI18n();
  const lang = language as 'ko' | 'en';
  const ref = useRef<HTMLDivElement>(null);
  const entry = notes[String(stopId)];
  const written = entry ? (entry[lang] ?? entry.ko) : null;
  const key = `${stopId}:${lang}`;
  const active = visible && Boolean(written);

  useSelfTyped(ref, active, key, seen);

  if (!active || !written) return null;

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
    <div className="about-overlay" ref={ref}>
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
