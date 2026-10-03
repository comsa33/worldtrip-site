/**
 * The other words to try when the words asked found nothing (K2 · N1): the
 * examples, in their order, less the words just asked and the ones asked
 * earlier this visit; when those leave too few, the list starts over. Never
 * random — the same situation offers the same words.
 */
/** How many other words are offered: two beside near themes, three alone. */
export const WORDS_WITH_THEMES = 2;
export const WORDS_ALONE = 3;

export function wordsToTry(
  examples: string[],
  text: string,
  count: number,
  /** the words asked earlier this visit (search.ts askedWords) */
  asked: string[]
): string[] {
  const seen = new Set(asked.map((w) => w.toLowerCase()));
  const now = text.trim().toLowerCase();
  const fresh = examples.filter((w) => w.toLowerCase() !== now && !seen.has(w.toLowerCase()));
  const out = fresh.slice(0, count);
  for (const w of examples) {
    if (out.length >= count) break;
    if (w.toLowerCase() !== now && !out.includes(w)) out.push(w);
  }
  return out;
}
