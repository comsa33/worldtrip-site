/**
 * The words of the asking field's status line (K2 · N1, 2026-10-03 V2): a
 * state's name first, then what can be done, joined by「·」. Notes, not
 * sentences — no 「~다」, no full stop (the dot is the full stop). All of them
 * in one place so a change of wording is one change.
 */
type Lang = 'ko' | 'en';

export const ASK_COPY: Record<
  Lang,
  {
    /** thinking: 330일 · 161곳 훑는 중 */
    searching: (days: number, stops: number) => string;
    /** found nothing: the name, then the numbers */
    none: string;
    noneCount: (days: number, stops: number) => string;
    /** the groups of suggestions under it */
    nearby: string;
    tryInstead: string;
    /** the faults: the name, then the action */
    failed: string;
    noResponse: string;
    tooMany: string;
    retryIn: (s: number) => string;
    retry: string;
    offline: string;
    offlineWait: string;
    /** read out: nothing found, with what is offered */
    saidNone: (nearby: string[], words: string[]) => string;
  }
> = {
  ko: {
    searching: (d, s) => `${d}일 · ${s}곳 훑는 중`,
    none: '결과 없음',
    noneCount: (d, s) => `${d}일 · ${s}곳`,
    nearby: '가까운 주제',
    tryInstead: '다른 말',
    failed: '검색 오류',
    noResponse: '응답 없음',
    tooMany: '요청이 많음',
    retryIn: (s) => `${s}초 후 다시`,
    retry: '다시 시도',
    offline: '오프라인',
    offlineWait: '연결되면 다시 찾음',
    saidNone: (near, words) =>
      [
        '결과 없음',
        near.length ? `가까운 주제 ${near.join(', ')}` : '',
        words.length ? `다른 말 ${words.join(', ')}` : '',
      ]
        .filter(Boolean)
        .join('. '),
  },
  en: {
    searching: (d, s) => `Searching ${d} days · ${s} stops`,
    none: 'No results',
    noneCount: (d, s) => `${d} days · ${s} stops`,
    nearby: 'Nearby themes',
    tryInstead: 'Try instead',
    failed: 'Search failed',
    noResponse: 'No response',
    tooMany: 'Too many requests',
    retryIn: (s) => `Retry in ${s}s`,
    retry: 'Try again',
    offline: 'Offline',
    offlineWait: 'Will retry when connected',
    saidNone: (near, words) =>
      [
        'No results',
        near.length ? `Nearby themes ${near.join(', ')}` : '',
        words.length ? `Try instead ${words.join(', ')}` : '',
      ]
        .filter(Boolean)
        .join('. '),
  },
};
