import { renderHook, act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDragModifier } from "./useDragModifier";

const ORIGINAL_USER_AGENT = navigator.userAgent;

function setUserAgent(ua: string): void {
  Object.defineProperty(navigator, "userAgent", {
    value: ua,
    configurable: true,
  });
}

function dispatchDragOver(
  init: {
    altKey?: boolean;
    shiftKey?: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
  } = {}
): void {
  // jsdom's DragEvent constructor is unreliable across versions; synthesize
  // via a base Event with manually-attached modifier flags. The hook only
  // reads e.altKey / e.shiftKey / e.ctrlKey from the event object.
  const ev = new Event("dragover", { bubbles: true }) as Event & {
    altKey: boolean;
    shiftKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
  };
  Object.assign(ev, {
    altKey: !!init.altKey,
    shiftKey: !!init.shiftKey,
    ctrlKey: !!init.ctrlKey,
    metaKey: !!init.metaKey,
  });
  window.dispatchEvent(ev);
}

afterEach(() => {
  setUserAgent(ORIGINAL_USER_AGENT);
});

describe("useDragModifier", () => {
  it("returns { copyHeld:false, moveHeld:false } when not dragging", () => {
    const { result } = renderHook(() => useDragModifier(false));
    expect(result.current).toEqual({ copyHeld: false, moveHeld: false });

    // Dispatching dragover while gate is false must not flip state
    act(() => dispatchDragOver({ altKey: true, shiftKey: true }));
    expect(result.current).toEqual({ copyHeld: false, moveHeld: false });
  });

  it("sets copyHeld=true on dragover with altKey when userAgent matches Mac", () => {
    setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 13_0)");
    const { result } = renderHook(() => useDragModifier(true));
    act(() => dispatchDragOver({ altKey: true }));
    expect(result.current.copyHeld).toBe(true);
    expect(result.current.moveHeld).toBe(false);
  });

  it("sets copyHeld=true on dragover with ctrlKey when userAgent is non-Mac, and ignores altKey on non-Mac", () => {
    setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)");
    const { result } = renderHook(() => useDragModifier(true));
    act(() => dispatchDragOver({ ctrlKey: true }));
    expect(result.current.copyHeld).toBe(true);

    // altKey alone on non-Mac should NOT trigger copyHeld
    act(() => dispatchDragOver({ altKey: true }));
    expect(result.current.copyHeld).toBe(false);
  });

  it("sets moveHeld=true on dragover with shiftKey on any platform", () => {
    setUserAgent("Mozilla/5.0 (X11; Linux x86_64)");
    const { result } = renderHook(() => useDragModifier(true));
    act(() => dispatchDragOver({ shiftKey: true }));
    expect(result.current.moveHeld).toBe(true);
    expect(result.current.copyHeld).toBe(false);
  });

  it("clears state when isDragging flips from true to false", () => {
    setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 13_0)");
    const { result, rerender } = renderHook(
      ({ d }: { d: boolean }) => useDragModifier(d),
      { initialProps: { d: true } }
    );
    act(() => dispatchDragOver({ altKey: true }));
    expect(result.current.copyHeld).toBe(true);

    rerender({ d: false });
    expect(result.current).toEqual({ copyHeld: false, moveHeld: false });
  });

  it("updates state live across successive dragover events with different modifiers", () => {
    setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 13_0)");
    const { result } = renderHook(() => useDragModifier(true));

    act(() => dispatchDragOver({ altKey: true }));
    expect(result.current).toEqual({ copyHeld: true, moveHeld: false });

    act(() => dispatchDragOver({ shiftKey: true }));
    expect(result.current).toEqual({ copyHeld: false, moveHeld: true });

    act(() => dispatchDragOver({}));
    expect(result.current).toEqual({ copyHeld: false, moveHeld: false });
  });

  it("removes the dragover listener on unmount", () => {
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const { unmount } = renderHook(() => useDragModifier(true));
    unmount();
    expect(removeSpy).toHaveBeenCalledWith("dragover", expect.any(Function));
    removeSpy.mockRestore();
  });
});
