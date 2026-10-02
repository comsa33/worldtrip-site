/**
 * Finding a stop by saying it — the one search of the site.
 *
 * The dot in the header stands up as the caret after the site's name; the
 * words go to /api/search, which ranks the journey's stops against them; the
 * dot flies to the first. This is the state of that, one for the whole site,
 * the way the theme choice is.
 */
import { useSyncExternalStore } from 'react';

/** A stop and how well it answered, 0 to 1, best first. */
export type Ranked = { id: number; score: number };

export type SearchState =
  | { mode: 'closed'; text: '' }
  /** the caret stands after the name; the hand writes */
  | { mode: 'open'; text: string }
  /** sent; the dot lies down and breathes until the answer */
  | { mode: 'waiting'; text: string }
  /** the stops that answered, best first; `theme` when the words were one */
  | { mode: 'result'; text: string; stops: Ranked[]; theme?: string }
  /** nothing answered: the dot sits as a full stop, then the words go */
  | { mode: 'none'; text: string };

export const MAX_QUERY_CHARS = 80;
/** How long the full stop sits after nothing was found. */
const NONE_MS = 2000;

let state: SearchState = { mode: 'closed', text: '' };
const listeners = new Set<() => void>();
let noneTimer = 0;
let seq = 0;

function set(next: SearchState) {
  state = next;
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useSearch(): SearchState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => state
  );
}

export function openSearch() {
  if (state.mode !== 'closed') return;
  window.clearTimeout(noneTimer);
  set({ mode: 'open', text: '' });
}

export function setSearchText(text: string) {
  if (state.mode === 'closed') return;
  seq += 1; // words changed: an answer on its way is to the old ones
  window.clearTimeout(noneTimer);
  set({ mode: 'open', text: text.slice(0, MAX_QUERY_CHARS) });
}

export function closeSearch() {
  window.clearTimeout(noneTimer);
  seq += 1;
  set({ mode: 'closed', text: '' });
}

/** Enter: the words go, and the answer comes back as a result or as none. */
export async function submitSearch() {
  if (state.mode !== 'open' && state.mode !== 'result' && state.mode !== 'none') return;
  const text = state.text.trim();
  if (!text) return;
  const mine = ++seq;
  window.clearTimeout(noneTimer);
  set({ mode: 'waiting', text });
  let stops: Ranked[] = [];
  let theme: string | undefined;
  try {
    const res = await fetch('/api/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ q: text }),
    });
    if (res.ok) {
      const data = (await res.json()) as { stops?: Ranked[]; theme?: string };
      stops = data.stops ?? [];
      theme = data.theme;
    }
    // any refusal (rate, length, the key away) reads as nothing found: the
    // page has no words for it, and the dot sitting down says enough
  } catch {
    stops = [];
  }
  if (mine !== seq) return; // the hand moved on meanwhile
  if (stops.length) {
    set(theme ? { mode: 'result', text, stops, theme } : { mode: 'result', text, stops });
  } else {
    set({ mode: 'none', text });
    noneTimer = window.setTimeout(() => {
      if (state.mode === 'none') closeSearch();
    }, NONE_MS);
  }
}
