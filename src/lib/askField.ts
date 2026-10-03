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
