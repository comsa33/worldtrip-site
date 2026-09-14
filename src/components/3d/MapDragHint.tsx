import { useId, type RefObject } from 'react';
import { TRACK_PX, type HintMode } from './useMapDragHint';

const HALF = TRACK_PX / 2;

/**
 * The slider, drawn in the map's own material: the aim ring on a short track.
 * A ring, not a hand — the thing the reader moves, doing the move. See
 * useMapDragHint for when it demonstrates, rests and follows.
 *
 * Which way is back in time is not what a reader assumes. On a timeline the
 * past is on the left; on these maps the hand pulls right to go back, because
 * the journey leaves Korea westward and the ring goes where the hand goes. So
 * the track says it in the route's own two tenses: from the ring to the right
 * it is the orange of the line already walked, to the left the dull warm tone
 * of the line not yet walked — the same two colours as the route just above
 * it. The right end is a filled point, where it began; the left an open one,
 * not reached. The orange travels with the ring, so dragging grows and shrinks
 * the walked part as the aim moves through the year.
 */
export function MapDragHint({
  mode,
  touch,
  k,
  x,
  y,
  at,
  rootRef,
}: {
  mode: HintMode;
  touch: boolean;
  /** viewBox units per pixel */
  k: number;
  /** where its centre goes, in viewBox units */
  x: number;
  y: number;
  /** where the reader stands along the journey, 0 (the end) – 1 (the start) */
  at: number;
  rootRef: RefObject<SVGGElement | null>;
}) {
  const clip = `map-drag-hint-${useId().replace(/:/g, '')}`;
  const rest = {
    transform: `translateX(${((Math.max(0, Math.min(1, at)) - 0.5) * TRACK_PX).toFixed(1)}px)`,
  };
  return (
    <g
      ref={rootRef}
      className={`map-drag-hint is-${mode}${touch ? ' is-touch' : ''}`}
      transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${k.toFixed(3)})`}
      aria-hidden="true"
    >
      <clipPath id={clip}>
        <rect x={-HALF} y={-3} width={TRACK_PX} height={6} />
      </clipPath>
      <line className="map-drag-hint__halo" x1={-HALF} x2={HALF} y1={0} y2={0} />
      {/* not yet: the whole track, under the walked part */}
      <line className="map-drag-hint__ahead" x1={-HALF} x2={HALF} y1={0} y2={0} />
      {/* walked: from the ring to the right, riding with it, cut to the track */}
      <g clipPath={`url(#${clip})`}>
        <g className="map-drag-hint__hand" style={rest}>
          <line className="map-drag-hint__past" x1={0} x2={TRACK_PX} y1={0} y2={0} />
        </g>
      </g>
      <circle className="map-drag-hint__end is-start" cx={HALF + 2.5} cy={0} r={1.7} />
      <circle className="map-drag-hint__end is-finish" cx={-HALF - 2.5} cy={0} r={1.7} />
      <g className="map-drag-hint__hand" style={rest}>
        <circle className="map-drag-hint__press" r={6} />
        <circle className="map-drag-hint__ring" r={5.5} />
      </g>
    </g>
  );
}
