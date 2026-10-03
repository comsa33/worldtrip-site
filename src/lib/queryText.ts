/**
 * The one way the words of a search are normalised — the page and
 * /api/search both, so the same words make the same URL, and the edge cache
 * keyed on it answers the same question once: NFC, one space, trimmed, lower.
 */
export function normalizeQuery(q: string): string {
  return q.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
}
