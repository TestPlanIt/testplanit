/**
 * Radix flags a press as "inside a layer" from a handler composed with
 * `checkForDefaultPrevented`, so a pointerdown that something else already
 * cancelled never reaches that flag and the layer reads the press as outside —
 * then dismisses itself. react-resizable-panels cancels the pointerdown on
 * every resize handle it claims, which is enough to close a dialog or sheet that
 * contains resizable panels.
 *
 * A press that landed on the layer's own content is never an outside press, so
 * cancelling the dismissal here restores the intended behavior.
 */
export function preventDismissFromInsideContent(
  content: HTMLElement | null,
  event: CustomEvent<{ originalEvent: PointerEvent }>
) {
  const target = event.detail.originalEvent.target;
  if (target instanceof Node && content?.contains(target)) {
    event.preventDefault();
  }
}
