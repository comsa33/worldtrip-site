export interface Note {
  subtitle: string;
  title?: string;
  story: string;
  quote?: string;
}

/** Every glyph is in the document from the first byte — only its paint waits. */
function Typed({ text }: { text: string }) {
  return (
    <>
      {Array.from(text).map((ch, i) => (
        <span key={i} data-ch="">
          {ch}
        </span>
      ))}
    </>
  );
}

/**
 * The block beside the globe: eyebrow, title, story, quote. No box, no
 * centring. Three places wear it — the opening, a city the dot is resting in,
 * and the closing — so it lives here rather than in any one of them.
 */
/**
 * The last line's full stop is not typed: the cursor folds down into it. So
 * whatever block comes last gives up the period it was written with, and a
 * stand-in takes the same place for a block that is not being typed this time.
 */
const unstopped = (text: string) => text.replace(/[.。]\s*$/, '');

export function NoteCard({ note }: { note: Note }) {
  const period = <span className="about-overlay__period" aria-hidden="true" />;
  return (
    <div className="about-overlay__card">
      {/* in reading order — the hand writes the document top to bottom */}
      <p className="about-overlay__subtitle">
        <Typed text={note.subtitle} />
      </p>
      {note.title && (
        <h2 className="about-overlay__title">
          <Typed text={note.title} />
        </h2>
      )}
      <p className="about-overlay__story">
        <Typed text={note.quote ? note.story : unstopped(note.story)} />
        {!note.quote && period}
      </p>
      {note.quote && (
        <blockquote className="about-overlay__quote">
          <Typed text={`"${unstopped(note.quote)}"`} />
          {period}
        </blockquote>
      )}
    </div>
  );
}
