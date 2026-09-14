import type { RefObject } from 'react';
import { TRACK_PX, type HintMode } from './useMapDragHint';

const HALF = TRACK_PX / 2;

/**
 * The slider, drawn in the map's own material: the aim ring on a short track.
 * A ring, not a hand — the thing the reader moves, doing the move. See
 * useMapDragHint for when it demonstrates, rests and follows.
 */
export function MapDragHint({
  mode,
  touch,
  k,
  x,
  y,
  at,
  rootRef,
  handRef,
}: {
  mode: HintMode;
  touch: boolean;
  /** viewBox units per pixel */
  k: number;
  /** where its centre goes, in viewBox units */
  x: number;
  y: number;
  /** where the reader stands along the journey, 0–1 */
  at: number;
  rootRef: RefObject<SVGGElement | null>;
  handRef: RefObject<SVGGElement | null>;
}) {
  const rest = (Math.max(0, Math.min(1, at)) - 0.5) * TRACK_PX;
  return (
    <g
      ref={rootRef}
      className={`map-drag-hint is-${mode}${touch ? ' is-touch' : ''}`}
      transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${k.toFixed(3)})`}
      aria-hidden="true"
    >
      <line className="map-drag-hint__halo" x1={-HALF} x2={HALF} y1={0} y2={0} />
      <line className="map-drag-hint__track" x1={-HALF} x2={HALF} y1={0} y2={0} />
      <circle className="map-drag-hint__end" cx={-HALF} cy={0} r={1.4} />
      <circle className="map-drag-hint__end" cx={HALF} cy={0} r={1.4} />
      <g
        className="map-drag-hint__hand"
        ref={handRef}
        style={{ transform: `translateX(${rest.toFixed(1)}px)` }}
      >
        <circle className="map-drag-hint__press" r={6} />
        <circle className="map-drag-hint__ring" r={5.5} />
      </g>
    </g>
  );
}
