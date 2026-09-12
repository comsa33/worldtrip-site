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
export function NoteCard({ note }: { note: Note }) {
  return (
    <div className="about-overlay__card">
      {note.title && (
        <h2 className="about-overlay__title">
          <Typed text={note.title} />
        </h2>
      )}
      <p className="about-overlay__subtitle">
        <Typed text={note.subtitle} />
      </p>
      <p className="about-overlay__story">
        <Typed text={note.story} />
      </p>
      {note.quote && (
        <blockquote className="about-overlay__quote">
          <Typed text={`"${note.quote}"`} />
          {/* the full stop, when no cursor is around to leave one */}
          <span className="about-overlay__period" aria-hidden="true" />
        </blockquote>
      )}
    </div>
  );
}
