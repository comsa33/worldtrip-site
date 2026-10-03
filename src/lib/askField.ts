/**
 * The asking field (AskDot), for a door to focus in its own gesture — which
 * is what the phone's keyboard needs: a focus that comes later, after a
 * render, does not bring it.
 */
let field: HTMLInputElement | null = null;

export function setAskField(el: HTMLInputElement | null) {
  field = el;
}

export function focusAskField() {
  field?.focus();
}

/* The layer the route's spark is drawn on while the words are out: an SVG in
   the asking field's own layer, over the dim — on the globe's canvas it was
   under 82% of dim and could not be seen. RouteScan (in the canvas) writes
   the projected path into it every frame. */
let scan: SVGPathElement | null = null;

export function setScanPath(el: SVGPathElement | null) {
  scan = el;
}

export function scanPath(): SVGPathElement | null {
  return scan;
}
