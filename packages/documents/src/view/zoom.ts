/**
 * Zoom for content laid out in the DOM: CSS `zoom` relays out at the new
 * size, so text stays sharp and scrolling covers the zoomed size.
 */
export function cssZoom(element: HTMLElement, min = 0.25, max = 5) {
  return {
    min,
    max,
    apply(value: number) {
      element.style.zoom = String(value);
    },
  };
}
