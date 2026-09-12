import { useCallback, useSyncExternalStore } from 'react';

export type Theme = 'dark' | 'light';

/** Colours the WebGL layer cannot read from CSS. Keep in step with src/styles/index.css. */
export const GLOBE: Record<
  Theme,
  {
    sphere: string;
    ink: string;
    ink2: string;
    dotBase: string;
    dotVisited: string;
    dotCurrent: string;
    /** The line a leg left behind. Orange loses contrast on a light ground, so
        light mode gets a deeper one — the same colour, further down. */
    routePast: string;
    /**
     * A leg not yet walked. Warm, so it belongs to the journey rather than the
     * map, and dull, so it reads as not yet rather than been — neutral ink put it
     * in the same material as the borders, which is what made it confusing.
     *
     * These are the colours BEFORE the opacity below, so they say little on
     * their own. What lands on the screen is #6f5641 in the dark and #b39f8c in
     * the light, and both follow one rule: the line already walked steps away
     * from the ground, the line not yet walked steps back towards it. Which
     * direction that is flips with the theme — towards black in the dark,
     * towards white in the light — and getting it the same way round in both is
     * how the light one came to look like a road already travelled.
     *
     * Against the borders (#6f6f6f dark, #757575 light) it is told apart by
     * warmth, not by weight, so keep some chroma in the mixed value: at 45% the
     * dark one once landed on #493e38, and a brown with 17 between its channels
     * is not a brown a person can see. `?tune=1` shows the mixed value and
     * warns below 25.
     */
    routeAhead: string;
    routeAheadOpacity: number;
  }
> = {
  dark: {
    sphere: '#111111',
    ink: '#f2f2f2',
    ink2: '#9a9a9a',
    dotBase: '#5a5a5a',
    dotVisited: '#8c8c8c',
    dotCurrent: '#b4b4b4',
    routePast: '#ff670d',
    routeAhead: '#926f53',
    routeAheadOpacity: 0.73,
  },
  light: {
    sphere: '#f3f3f3',
    ink: '#0f0f0f',
    ink2: '#6b6b6b',
    dotBase: '#b4b4b4',
    dotVisited: '#8a8a8a',
    dotCurrent: '#5c5c5c',
    routePast: '#e2560a',
    routeAhead: '#987b60',
    routeAheadOpacity: 0.7,
  },
};

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => observer.disconnect();
}

const getSnapshot = (): Theme =>
  document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';

/** Resolved theme. index.html sets data-theme before paint (stored choice, else the OS). */
export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, getSnapshot, () => 'dark');
}

export function useToggleTheme() {
  return useCallback((origin?: DOMRect) => {
    const root = document.documentElement;
    const next: Theme = root.dataset.theme === 'dark' ? 'light' : 'dark';

    // The new theme spreads out from the control that was pressed (see
    // themeSpread in styles/index.css), as it does on the sibling sites — so
    // the transition needs to know where that was and how far the farthest
    // corner of the viewport is from it.
    if (origin) {
      const x = origin.left + origin.width / 2;
      const y = origin.top + origin.height / 2;
      const far = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
      root.style.setProperty('--theme-x', `${Math.round(x)}px`);
      root.style.setProperty('--theme-y', `${Math.round(y)}px`);
      root.style.setProperty('--theme-r', `${Math.ceil(far)}px`);
    }

    // Hold hover transitions while the document switches, as the sibling sites do
    root.setAttribute('data-theme-switching', '');
    const commit = () => {
      root.dataset.theme = next;
      try {
        localStorage.setItem('theme', next);
      } catch {
        /* private mode */
      }
    };
    if (document.startViewTransition) {
      document.startViewTransition(commit).finished.finally(() => {
        root.removeAttribute('data-theme-switching');
      });
    } else {
      commit();
      requestAnimationFrame(() => root.removeAttribute('data-theme-switching'));
    }
  }, []);
}
