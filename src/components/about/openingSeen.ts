/** What the reader has already watched being written, once per load. */
export const seen = new Set<string>();

/** The opening is skipped to its end: the page has been asked for something
 *  else (the question field) while it was still being written. The block is
 *  simply there from now on, and is not written again this visit. */
export function markOpeningSeen() {
  seen.add('about');
}
