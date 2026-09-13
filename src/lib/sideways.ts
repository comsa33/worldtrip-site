import { useSyncExternalStore } from 'react';

/**
 * A phone on its side: a touch screen, wider than tall, under 500px of height.
 * Three hundred and ninety pixels leave no room for the journey's HUD or the
 * photo book's strip, so both lay themselves out differently here. A tablet
 * or a desktop window is not this. Keep in step with the same query in
 * PhotoGallery.css.
 */
export const SIDEWAYS =
  '(hover: none) and (pointer: coarse) and (orientation: landscape) and (max-height: 500px)';

export const isSideways = () =>
  typeof window !== 'undefined' && window.matchMedia(SIDEWAYS).matches;

function subscribe(onChange: () => void) {
  const mq = window.matchMedia(SIDEWAYS);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

export function useSideways() {
  return useSyncExternalStore(subscribe, isSideways, () => false);
}
