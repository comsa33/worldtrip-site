/**
 * The gesture, drawn in the map's own material: the aim ring on a short track,
 * sliding one way and back. For a finger it is pressed first — a soft bloom
 * under the ring — because on a phone the ring only moves while held. A ring,
 * not a hand: the thing the reader will move, doing the move.
 */
export function MapDragHint({
  visible,
  touch,
  k,
  x,
  y,
}: {
  visible: boolean;
  touch: boolean;
  /** viewBox units per pixel */
  k: number;
  /** where its centre goes, in viewBox units */
  x: number;
  y: number;
}) {
  return (
    <g
      className={`map-drag-hint${visible ? ' is-on' : ''}${touch ? ' is-touch' : ''}`}
      transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${k.toFixed(3)})`}
      aria-hidden="true"
    >
      <line className="map-drag-hint__halo" x1={-24} x2={24} y1={0} y2={0} />
      <line className="map-drag-hint__track" x1={-24} x2={24} y1={0} y2={0} />
      <circle className="map-drag-hint__end" cx={-24} cy={0} r={1.4} />
      <circle className="map-drag-hint__end" cx={24} cy={0} r={1.4} />
      <g className="map-drag-hint__hand">
        <circle className="map-drag-hint__press" r={6} />
        <circle className="map-drag-hint__ring" r={5.5} />
      </g>
    </g>
  );
}
