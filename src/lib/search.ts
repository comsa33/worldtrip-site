/**
 * Asking the dot — the one search of the site (K2).
 *
 * The dot leaves the globe and stands up as the caret of a large field in the
 * middle of the screen; the words go to /api/search, which ranks the
 * journey's stops against them; the answer stands under the words, and on
 * Enter the dot flies to it. This is the state of that, one for the whole
 * site, the way the theme choice is.
 *
 * Two things are held apart: what the field is doing (`mode`) and what is lit
 * on the globe (`lit`). An answer taken lights its stops and closes the
 * field; the field opens again over them with the same words, and only a new
 * answer taken puts new stops in their place.
 */
import { useSyncExternalStore } from 'react';

/** A stop and how well it answered, 0 to 1, best first. */
export type Ranked = { id: number; score: number };

export type SearchFault = 'fail' | 'timeout' | 'rate' | 'offline';

/** A theme and how near the words came to it, on the server's 0–3 scale (already over its line). */
export type NearTheme = { id: string; score: number };

/** An answer: the stops, best first, the theme when the words were one, and the themes nearest the words. */
export type Answer = { stops: Ranked[]; theme?: string; themes?: NearTheme[] };

export type SearchField =
  | { mode: 'closed' }
  /** the field is up and the dot is its caret; the hand writes */
  | { mode: 'open'; text: string }
  /** sent at `since`; the dot lies down and breathes until the answer, the spark runs the route */
  | { mode: 'waiting'; text: string; since: number }
  /** the answer stands under the words: `pick` is the one previewed, the list open or not */
  | ({ mode: 'answer'; text: string; pick: number; expanded: boolean } & Answer)
  /** nothing answered (at `at`): the dot sits as a full stop; the line says so and offers what is near */
  | { mode: 'none'; text: string; since: number; at: number; themes?: NearTheme[] }
  /** no answer could come: the dot goes faint, one line says so, 「다시」. `since` is 0 when it never set off (offline on opening) */
  | { mode: 'error'; text: string; fault: SearchFault; retryAt: number; since: number; at: number };

export type SearchState = SearchField & {
  /** the answer taken last — its stops are lit on the globe — with its words */
  lit: (Answer & { text: string }) | null;
};

export const MAX_QUERY_CHARS = 80;
/** Longer than this without an answer is no answer. */
const TIMEOUT_MS = 8000;
/** After the rate limit, no retry sooner than this. */
const RATE_RETRY_MS = 3000;
/** How many of the answer's stops are listed at first, and at most. */
export const LIST_FIRST = 5;
export const LIST_MOST = 12;

let state: SearchState = { mode: 'closed', lit: null };
const listeners = new Set<() => void>();
let seq = 0;
/* The same words asked again this visit are answered from here, not Jev. */
const remembered = new Map<string, Answer>();

function set(next: SearchField) {
  state = { ...next, lit: state.lit };
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/* The page is told when an answer is taken — Enter on the answer — so it can
   act on it (go to the first stop, light the rest) the once, as on a press. */
const answerListeners = new Set<(s: SearchState) => void>();
export function onAnswer(l: (s: SearchState) => void) {
  answerListeners.add(l);
  return () => {
    answerListeners.delete(l);
  };
}

/* Whether a question has ever been asked here — once one has, the door no
   longer darkens when the dot sits down; it only rests. Kept across visits. */
const LEARNED_KEY = 'searchLearned';
let learned = (() => {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(LEARNED_KEY) === '1';
  } catch {
    return false;
  }
})();
function noteLearned() {
  if (learned) return;
  learned = true;
  try {
    localStorage.setItem(LEARNED_KEY, '1');
  } catch {
    /* no storage */
  }
  listeners.forEach((l) => l());
}
export function useLearned(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => learned,
    () => false
  );
}

export function useSearch(): SearchState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => state
  );
}

/* Opened over a lit answer from its chip: the rank the journey is on, so the
   same answer comes back with that row picked. */
let reopenAt: number | null = null;

/** The field is up — the dot comes to it; over a lit answer, with its words
 *  (and, from the chip, the rank the journey stands on). Off the net, the line says so instead. */
export function openSearch(atRank?: number) {
  if (state.mode !== 'closed') return;
  reopenAt = atRank ?? null;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    set({ mode: 'error', text: '', fault: 'offline', retryAt: 0, since: 0, at: Date.now() });
    return;
  }
  set({ mode: 'open', text: state.lit?.text ?? '' });
}

export function setSearchText(text: string) {
  if (state.mode === 'closed') return;
  seq += 1; // words changed: an answer on its way is to the old ones
  set({ mode: 'open', text: text.slice(0, MAX_QUERY_CHARS) });
}

/** The field goes; what was lit stays lit. */
export function closeSearch() {
  seq += 1;
  set({ mode: 'closed' });
}

/** Esc over a lit answer: the lights go out too. */
export function clearSearch() {
  seq += 1;
  state = { mode: 'closed', lit: null };
  listeners.forEach((l) => l());
}

function answerOf(text: string, a: Answer, pick = 0): SearchField {
  return {
    mode: 'answer',
    text,
    pick,
    expanded: pick >= LIST_FIRST,
    stops: a.stops,
    theme: a.theme,
  };
}
function noneOf(text: string, a: Answer, since: number): SearchField {
  return { mode: 'none', text, since, at: Date.now(), themes: a.themes };
}

/* The words asked this visit, oldest first — so what is offered instead of a
   word that found nothing is not one already tried. */
const ASKED_KEY = 'asked-words';
export function askedWords(): string[] {
  try {
    return JSON.parse(sessionStorage.getItem(ASKED_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}
function noteAsked(text: string) {
  try {
    const list = askedWords().filter((w) => w !== text);
    list.push(text);
    sessionStorage.setItem(ASKED_KEY, JSON.stringify(list.slice(-20)));
  } catch {
    /* no storage: nothing to remember by */
  }
}

/** Enter: the words go, and what comes back is an answer, none, or a fault. */
export async function submitSearch(words?: string) {
  if (state.mode === 'closed' || state.mode === 'waiting') return;
  if (state.mode === 'error' && Date.now() < state.retryAt) return;
  const text = (words ?? state.text).trim();
  if (!text) return;
  noteAsked(text);
  noteLearned();
  const since = Date.now();
  const known = remembered.get(text.toLowerCase());
  if (known) {
    seq += 1;
    // the same words over their lit answer: the row the journey stands on is the one picked
    let pick = 0;
    if (reopenAt !== null && state.lit && state.lit.text === text) {
      const id = state.lit.stops[reopenAt - 1]?.id;
      pick = Math.max(
        0,
        known.stops.findIndex((r) => r.id === id)
      );
    }
    reopenAt = null;
    set(known.stops.length ? answerOf(text, known, pick) : noneOf(text, known, since));
    return;
  }
  const mine = ++seq;
  set({ mode: 'waiting', text, since });
  let stops: Ranked[] = [];
  let theme: string | undefined;
  let themes: NearTheme[] | undefined;
  let fault: SearchFault | null = null;
  try {
    const res = await fetch('/api/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ q: text }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.ok) {
      const data = (await res.json()) as {
        stops?: Ranked[];
        theme?: string;
        themes?: NearTheme[];
      };
      stops = data.stops ?? [];
      theme = data.theme;
      themes = data.themes;
    } else if (res.status === 429) fault = 'rate';
    else if (res.status === 400 || res.status === 413)
      stops = []; // not a question
    else fault = 'fail';
  } catch (e) {
    fault =
      typeof navigator !== 'undefined' && navigator.onLine === false
        ? 'offline'
        : e instanceof Error && e.name === 'TimeoutError'
          ? 'timeout'
          : 'fail';
  }
  if (mine !== seq) return; // the hand moved on meanwhile
  if (fault) {
    set({
      mode: 'error',
      text,
      fault,
      retryAt: Date.now() + (fault === 'rate' ? RATE_RETRY_MS : 0),
      since,
      at: Date.now(),
    });
    return;
  }
  const a: Answer = { stops, theme, themes };
  remembered.set(text.toLowerCase(), a);
  if (remembered.size > 40) {
    const oldest = remembered.keys().next().value;
    if (oldest !== undefined) remembered.delete(oldest);
  }
  set(stops.length ? answerOf(text, a) : noneOf(text, a, since));
}

/** Another of the answer's stops previewed — ↑ ↓, a hover, a first tap. */
export function pickAnswer(i: number) {
  if (state.mode !== 'answer') return;
  const last = Math.min(state.stops.length, state.expanded ? LIST_MOST : LIST_FIRST) - 1;
  const pick = Math.max(0, Math.min(last, i));
  if (pick === state.pick) return;
  set({ ...state, pick });
}

/** 「외 n곳」: the list opens out to LIST_MOST. */
export function expandAnswer() {
  if (state.mode !== 'answer' || state.expanded) return;
  set({ ...state, expanded: true });
}

/** Enter on the answer, or a press on the preview: the dot goes to the one picked. */
export function confirmAnswer(stopId?: number) {
  if (state.mode !== 'answer') return;
  const { text, theme } = state;
  const first = stopId ?? state.stops[state.pick]?.id ?? state.stops[0].id;
  const stops = [...state.stops].sort((a, b) => (a.id === first ? -1 : b.id === first ? 1 : 0));
  state = { mode: 'closed', lit: theme ? { text, stops, theme } : { text, stops } };
  listeners.forEach((l) => l());
  answerListeners.forEach((l) => l(state));
}

/** 「다시」 — the same words again. */
export function retrySearch() {
  if (state.mode !== 'error') return;
  void submitSearch(state.text);
}
