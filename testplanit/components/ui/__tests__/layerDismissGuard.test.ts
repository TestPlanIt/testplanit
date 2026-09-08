import { describe, expect, it } from "vitest";

import { preventDismissFromInsideContent } from "~/components/ui/layerDismissGuard";

function pointerDownOutsideEvent(target: Node | null) {
  return new CustomEvent("dismissableLayer.pointerDownOutside", {
    cancelable: true,
    detail: { originalEvent: { target } as unknown as PointerEvent },
  });
}

describe("preventDismissFromInsideContent", () => {
  it("cancels the dismissal when the press landed inside the content", () => {
    const content = document.createElement("div");
    const handle = document.createElement("div");
    content.appendChild(handle);
    const event = pointerDownOutsideEvent(handle);

    preventDismissFromInsideContent(content, event);

    expect(event.defaultPrevented).toBe(true);
  });

  it("leaves a press on the content itself dismissing nothing", () => {
    const content = document.createElement("div");
    const event = pointerDownOutsideEvent(content);

    preventDismissFromInsideContent(content, event);

    expect(event.defaultPrevented).toBe(true);
  });

  it("keeps dismissing when the press landed outside the content", () => {
    const content = document.createElement("div");
    const overlay = document.createElement("div");
    const event = pointerDownOutsideEvent(overlay);

    preventDismissFromInsideContent(content, event);

    expect(event.defaultPrevented).toBe(false);
  });

  it("keeps dismissing when the content is not mounted or the target is gone", () => {
    const unmounted = pointerDownOutsideEvent(document.createElement("div"));
    preventDismissFromInsideContent(null, unmounted);
    expect(unmounted.defaultPrevented).toBe(false);

    const noTarget = pointerDownOutsideEvent(null);
    preventDismissFromInsideContent(document.createElement("div"), noTarget);
    expect(noTarget.defaultPrevented).toBe(false);
  });
});
