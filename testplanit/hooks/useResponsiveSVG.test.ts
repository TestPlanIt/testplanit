import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import useResponsiveSVG from "./useResponsiveSVG";

// --- Helpers ---

/** Creates a mock ResizeObserver using class syntax (required for `new` keyword) */
function createResizeObserverClass() {
  let storedCallback: ResizeObserverCallback | null = null;
  const observeSpy = vi.fn();
  const unobserveSpy = vi.fn();
  const disconnectSpy = vi.fn();

  // Must use class syntax — arrow functions cannot be used as constructors (Phase 22 MEMORY.md)
  class MockResizeObserver {
    constructor(callback: ResizeObserverCallback) {
      storedCallback = callback;
    }
    observe = observeSpy;
    unobserve = unobserveSpy;
    disconnect = disconnectSpy;
  }

  function triggerResize() {
    if (storedCallback) {
      storedCallback([], {} as ResizeObserver);
    }
  }

  return { MockResizeObserver, observeSpy, unobserveSpy, disconnectSpy, triggerResize };
}

function createContainerEl(width = 0, height = 0): HTMLElement {
  return { clientWidth: width, clientHeight: height } as HTMLElement;
}

describe("useResponsiveSVG", () => {
  let originalResizeObserver: typeof ResizeObserver;
  let requestAnimationFrameSpy: ReturnType<typeof vi.spyOn>;
  let cancelAnimationFrameSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    originalResizeObserver = globalThis.ResizeObserver;

    // Default: immediately invoke the rAF callback so measure() runs synchronously
    requestAnimationFrameSpy = vi
      .spyOn(globalThis, "requestAnimationFrame")
      .mockImplementation((cb: FrameRequestCallback) => {
        cb(0);
        return 0;
      });

    cancelAnimationFrameSpy = vi
      .spyOn(globalThis, "cancelAnimationFrame")
      .mockImplementation(() => {});
  });

  afterEach(() => {
    globalThis.ResizeObserver = originalResizeObserver;
    requestAnimationFrameSpy.mockRestore();
    cancelAnimationFrameSpy.mockRestore();
    vi.clearAllMocks();
  });

  it("should initialize with width=0 and height=0", () => {
    const containerRef = { current: null as HTMLElement | null };

    const { result } = renderHook(() => useResponsiveSVG(containerRef));

    expect(result.current.width).toBe(0);
    expect(result.current.height).toBe(0);
  });

  it("should not update dimensions when container ref is null", () => {
    const containerRef = { current: null as HTMLElement | null };

    const { result } = renderHook(() => useResponsiveSVG(containerRef));

    expect(result.current.width).toBe(0);
    expect(result.current.height).toBe(0);
  });

  it("should measure container dimensions on mount when container has size", () => {
    const containerRef = { current: createContainerEl(800, 400) };

    const { MockResizeObserver } = createResizeObserverClass();
    (globalThis as any).ResizeObserver = MockResizeObserver;

    const { result } = renderHook(() => useResponsiveSVG(containerRef));

    expect(result.current.width).toBe(800);
    expect(result.current.height).toBe(400);
  });

  it("should not update dimensions when container has zero width or height", () => {
    const containerRef = { current: createContainerEl(0, 0) };

    const { MockResizeObserver } = createResizeObserverClass();
    (globalThis as any).ResizeObserver = MockResizeObserver;

    const { result } = renderHook(() => useResponsiveSVG(containerRef));

    // Zero dimensions are ignored by the measure() function
    expect(result.current.width).toBe(0);
    expect(result.current.height).toBe(0);
  });

  it("should update dimensions when ResizeObserver triggers with new size", () => {
    const containerEl = createContainerEl(800, 400);
    const containerRef = { current: containerEl };

    const { MockResizeObserver, triggerResize } = createResizeObserverClass();
    (globalThis as any).ResizeObserver = MockResizeObserver;

    const { result } = renderHook(() => useResponsiveSVG(containerRef));

    expect(result.current.width).toBe(800);

    act(() => {
      // Update the element's dimensions
      (containerRef.current as any).clientWidth = 1200;
      (containerRef.current as any).clientHeight = 600;
      triggerResize();
    });

    expect(result.current.width).toBe(1200);
    expect(result.current.height).toBe(600);
  });

  it("should create a ResizeObserver and observe the container element", () => {
    const containerRef = { current: createContainerEl(800, 400) };

    const { MockResizeObserver, observeSpy } = createResizeObserverClass();
    (globalThis as any).ResizeObserver = MockResizeObserver;

    renderHook(() => useResponsiveSVG(containerRef));

    expect(observeSpy).toHaveBeenCalledWith(containerRef.current);
  });

  it("should disconnect ResizeObserver on unmount", () => {
    const containerRef = { current: createContainerEl(800, 400) };

    const { MockResizeObserver, disconnectSpy } = createResizeObserverClass();
    (globalThis as any).ResizeObserver = MockResizeObserver;

    const { unmount } = renderHook(() => useResponsiveSVG(containerRef));

    unmount();

    expect(disconnectSpy).toHaveBeenCalledTimes(1);
  });

  it("should use window.resize event when ResizeObserver is unavailable", () => {
    const containerRef = { current: createContainerEl(800, 400) };

    // Remove ResizeObserver from global scope
    (globalThis as any).ResizeObserver = undefined;

    const addEventListenerSpy = vi.spyOn(window, "addEventListener");
    const removeEventListenerSpy = vi.spyOn(window, "removeEventListener");

    const { unmount } = renderHook(() => useResponsiveSVG(containerRef));

    expect(addEventListenerSpy).toHaveBeenCalledWith("resize", expect.any(Function));

    unmount();

    expect(removeEventListenerSpy).toHaveBeenCalledWith("resize", expect.any(Function));

    addEventListenerSpy.mockRestore();
    removeEventListenerSpy.mockRestore();
  });

  it("should not change state reference when dimensions are unchanged", () => {
    const containerRef = { current: createContainerEl(800, 400) };

    const { MockResizeObserver, triggerResize } = createResizeObserverClass();
    (globalThis as any).ResizeObserver = MockResizeObserver;

    const { result } = renderHook(() => useResponsiveSVG(containerRef));

    const dimensionsBefore = result.current;

    // Trigger resize with same dimensions — setDimensions returns prev (same ref)
    act(() => {
      triggerResize();
    });

    expect(result.current).toBe(dimensionsBefore);
  });

  it("should return Dimensions object with numeric width and height", () => {
    const containerRef = { current: createContainerEl(640, 320) };

    const { MockResizeObserver } = createResizeObserverClass();
    (globalThis as any).ResizeObserver = MockResizeObserver;

    const { result } = renderHook(() => useResponsiveSVG(containerRef));

    expect(result.current).toHaveProperty("width");
    expect(result.current).toHaveProperty("height");
    expect(typeof result.current.width).toBe("number");
    expect(typeof result.current.height).toBe("number");
  });

  it("should handle positive dimensions correctly", () => {
    const containerRef = { current: createContainerEl(1920, 1080) };

    const { MockResizeObserver } = createResizeObserverClass();
    (globalThis as any).ResizeObserver = MockResizeObserver;

    const { result } = renderHook(() => useResponsiveSVG(containerRef));

    expect(result.current.width).toBe(1920);
    expect(result.current.height).toBe(1080);
  });
});
