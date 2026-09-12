import { useSyncExternalStore } from 'react';
import { GLOBE, type Theme } from '../../theme';
import { ZOOM_DEFAULTS } from './cityZoom';

/**
 * A bench for the route's two tenses. Dev only — `?tune=1` — and not shipped.
 *
 * It exists because the thing that matters is not the colour written in the
 * source but the colour that lands on the screen: a warm brown at 45% over a
 * near-black globe arrives as #493e38, which no one reads as brown. The panel
 * shows the mixed value next to what it has to be told apart from, and the
 * globe follows the sliders, so a value is chosen by looking rather than by
 * arithmetic and a screenshot.
 */
export type Tuning = {
  pastLand: number;
  pastAir: number;
  pastLandOpacity: number;
  pastAirOpacity: number;
  aheadLand: number;
  aheadAir: number;
  aheadColor: string;
  aheadOpacity: number;
  borderBase: number;
  borderActive: number;
  /** a place glyph, the one city mark that is still a line */
  glyph: number;
  /** the wash a city's ground carries — been to, still ahead, under the hand */
  cityFill: number;
  cityFillAhead: number;
  cityFillHover: number;
  /** the camera's distance curve — see cityZoom.ts */
  zMax: number;
  zMin: number;
  zSlope: number;
  zNear: number;
  zHold: number;
};

export const TUNE_ON =
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('tune');

export function defaults(theme: Theme): Tuning {
  return {
    pastLand: 3,
    pastAir: 0.85,
    pastLandOpacity: 0.95,
    pastAirOpacity: 0.75,
    // a line receding towards white has to be wider than one receding towards
    // black to stay a line at all, so this is the theme's too
    aheadLand: theme === 'light' ? 0.85 : 0.4,
    aheadAir: theme === 'light' ? 0.45 : 0.25,
    aheadColor: GLOBE[theme].routeAhead,
    aheadOpacity: GLOBE[theme].routeAheadOpacity,
    borderBase: 1.5,
    borderActive: 2.2,
    glyph: 1.5,
    cityFill: 0.2,
    cityFillAhead: 0.075,
    cityFillHover: 0.34,
    zMax: ZOOM_DEFAULTS.zMax,
    zMin: ZOOM_DEFAULTS.zMin,
    zSlope: ZOOM_DEFAULTS.slope,
    zNear: ZOOM_DEFAULTS.near,
    zHold: ZOOM_DEFAULTS.hold,
  };
}

let state: Tuning = defaults('dark');
const listeners = new Set<() => void>();

export function setTuning(patch: Partial<Tuning>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function resetTuning(theme: Theme) {
  state = defaults(theme);
  listeners.forEach((l) => l());
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const snapshot = () => state;

export function useTuning(): Tuning {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** What a colour at an opacity actually becomes over the globe. */
export function mix(color: string, opacity: number, over: string): string {
  const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  const a = hex(color);
  const b = hex(over);
  const out = a.map((v, i) => Math.round(v * opacity + b[i] * (1 - opacity)));
  return '#' + out.map((v) => v.toString(16).padStart(2, '0')).join('');
}

/** How far apart the darkest and lightest channel are — under ~25 a hue stops reading. */
export function chroma(color: string): number {
  const v = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  return Math.max(...v) - Math.min(...v);
}
