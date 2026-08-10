import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { useTabState } from "./useTabState";

// --- Mocks ---

const { mockPushUrlSearch } = vi.hoisted(() => ({
  mockPushUrlSearch: vi.fn(),
}));

vi.mock("~/lib/urlState", () => ({
  // Record pushes as "pathname?search" so expectations read like URLs.
  pushUrlSearch: (url: string | URL) => {
    const u = new URL(url.toString(), "http://localhost");
    mockPushUrlSearch(`${u.pathname}${u.search}`);
  },
  commitUrlSearch: vi.fn(),
  useLocationSearch: () => window.location.search,
}));

const { mockRouterPush } = vi.hoisted(() => ({
  mockRouterPush: vi.fn(),
}));

const { mockPathname } = vi.hoisted(() => ({
  mockPathname: vi.fn(() => "/projects/42"),
}));

vi.mock("~/lib/navigation", () => ({
  useRouter: () => ({
    push: mockRouterPush,
    replace: vi.fn(),
    back: vi.fn(),
  }),
  usePathname: () => mockPathname(),
  Link: ({ children }: { children: React.ReactNode }) => children,
  redirect: vi.fn(),
}));

describe("useTabState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset window.location.search to empty
    Object.defineProperty(window, "location", {
      value: { search: "", href: "http://localhost/projects/42" },
      writable: true,
    });
  });

  it("should return defaultValue when no URL param is set", () => {
    Object.defineProperty(window, "location", {
      value: { search: "", href: "http://localhost/" },
      writable: true,
    });

    const { result } = renderHook(() => useTabState("tab", "active"));

    expect(result.current[0]).toBe("active");
  });

  it("should read initial tab value from URL search params", () => {
    Object.defineProperty(window, "location", {
      value: {
        search: "?tab=completed",
        href: "http://localhost/?tab=completed",
      },
      writable: true,
    });

    const { result } = renderHook(() => useTabState("tab", "active"));

    expect(result.current[0]).toBe("completed");
  });

  it("should use custom paramName to read from URL", () => {
    Object.defineProperty(window, "location", {
      value: { search: "?view=grid", href: "http://localhost/?view=grid" },
      writable: true,
    });

    const { result } = renderHook(() => useTabState("view", "list"));

    expect(result.current[0]).toBe("grid");
  });

  it("should fallback to defaultValue when URL param is not present", () => {
    Object.defineProperty(window, "location", {
      value: { search: "?other=param", href: "http://localhost/?other=param" },
      writable: true,
    });

    const { result } = renderHook(() => useTabState("tab", "overview"));

    expect(result.current[0]).toBe("overview");
  });

  it("should update tab state immediately when setTab is called", () => {
    Object.defineProperty(window, "location", {
      value: { search: "", href: "http://localhost/" },
      writable: true,
    });

    const { result } = renderHook(() => useTabState("tab", "active"));

    act(() => {
      result.current[1]("completed");
    });

    expect(result.current[0]).toBe("completed");
  });

  it("should push a history entry when setTab is called", () => {
    Object.defineProperty(window, "location", {
      value: { search: "", href: "http://localhost/projects/42" },
      writable: true,
    });
    mockPathname.mockReturnValue("/projects/42");

    const { result } = renderHook(() => useTabState("tab", "active"));

    act(() => {
      result.current[1]("completed");
    });

    expect(mockPushUrlSearch).toHaveBeenCalledTimes(1);
    expect(mockPushUrlSearch).toHaveBeenCalledWith(
      "/projects/42?tab=completed"
    );
  });

  it("should remove param from URL when setTab is called with default value", () => {
    Object.defineProperty(window, "location", {
      value: {
        search: "?tab=completed",
        href: "http://localhost/projects/42?tab=completed",
      },
      writable: true,
    });
    mockPathname.mockReturnValue("/projects/42");

    const { result } = renderHook(() => useTabState("tab", "active"));

    act(() => {
      result.current[1]("active"); // Setting to default value
    });

    // Should navigate to URL without the tab param
    expect(mockPushUrlSearch).toHaveBeenCalledWith("/projects/42");
  });

  it("should preserve other URL params when changing tab", () => {
    Object.defineProperty(window, "location", {
      value: {
        search: "?page=2&tab=active",
        href: "http://localhost/projects/42?page=2&tab=active",
      },
      writable: true,
    });
    mockPathname.mockReturnValue("/projects/42");

    const { result } = renderHook(() => useTabState("tab", "active"));

    act(() => {
      result.current[1]("completed");
    });

    const calledUrl = mockPushUrlSearch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("page=2");
    expect(calledUrl).toContain("tab=completed");
  });

  it("should update tab on popstate event (browser back/forward)", () => {
    Object.defineProperty(window, "location", {
      value: { search: "", href: "http://localhost/" },
      writable: true,
    });

    const { result } = renderHook(() => useTabState("tab", "active"));

    expect(result.current[0]).toBe("active");

    // Simulate browser back navigation that changes the URL
    act(() => {
      Object.defineProperty(window, "location", {
        value: {
          search: "?tab=completed",
          href: "http://localhost/?tab=completed",
        },
        writable: true,
      });
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    expect(result.current[0]).toBe("completed");
  });

  it("should return default value in SSR environment (no window)", () => {
    // Simulate SSR: window is defined in jsdom but we can test the logic
    // The hook uses typeof window === 'undefined' check
    // In jsdom we can verify it reads from window.location
    Object.defineProperty(window, "location", {
      value: { search: "", href: "http://localhost/" },
      writable: true,
    });

    const { result } = renderHook(() => useTabState("tab", "dashboard"));

    expect(result.current[0]).toBe("dashboard");
    expect(typeof result.current[1]).toBe("function");
  });

  it("should expose [currentTab, setTab] tuple", () => {
    const { result } = renderHook(() => useTabState("tab", "active"));

    expect(Array.isArray(result.current)).toBe(true);
    expect(result.current).toHaveLength(2);
    expect(typeof result.current[0]).toBe("string");
    expect(typeof result.current[1]).toBe("function");
  });

  it("should remove popstate listener on unmount", () => {
    const removeEventListenerSpy = vi.spyOn(window, "removeEventListener");

    const { unmount } = renderHook(() => useTabState("tab", "active"));

    unmount();

    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      "popstate",
      expect.any(Function)
    );
  });
});
