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
  }
> = {
  dark: {
    sphere: '#111111',
    ink: '#f2f2f2',
    ink2: '#9a9a9a',
    dotBase: '#5a5a5a',
    dotVisited: '#8c8c8c',
    dotCurrent: '#b4b4b4',
  },
  light: {
    sphere: '#f3f3f3',
    ink: '#0f0f0f',
    ink2: '#6b6b6b',
    dotBase: '#b4b4b4',
    dotVisited: '#8a8a8a',
    dotCurrent: '#5c5c5c',
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
