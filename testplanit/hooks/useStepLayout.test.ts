import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let currentSession: unknown = null;
const update = vi.fn();
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: currentSession, update }),
}));

// The hook keeps the chosen layout in module state so every steps component
// on a page agrees; a fresh module per test keeps the tests independent.
async function loadHook() {
  vi.resetModules();
  const mod = await import("./useStepLayout");
  return mod.useStepLayout;
}

const okResponse = () => ({ ok: true, status: 200 }) as Response;

describe("useStepLayout", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    currentSession = null;
    update.mockReset();
    update.mockResolvedValue(null);
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(okResponse());
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults to stacked with no session", async () => {
    const useStepLayout = await loadHook();
    const { result } = renderHook(() => useStepLayout());
    expect(result.current.layout).toBe("STACKED");
    expect(result.current.isSideBySide).toBe(false);
  });

  it("reads the saved preference from the session", async () => {
    currentSession = {
      user: { id: "u1", preferences: { stepLayout: "SIDE_BY_SIDE" } },
    };
    const useStepLayout = await loadHook();
    const { result } = renderHook(() => useStepLayout());
    expect(result.current.layout).toBe("SIDE_BY_SIDE");
    expect(result.current.isSideBySide).toBe(true);
  });

  it("flips immediately and saves through the user route without touching the session", async () => {
    currentSession = {
      user: { id: "u1", preferences: { stepLayout: "STACKED" } },
    };
    const useStepLayout = await loadHook();
    const { result } = renderHook(() => useStepLayout());

    await act(async () => {
      await result.current.toggleLayout();
    });

    expect(result.current.layout).toBe("SIDE_BY_SIDE");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/users/u1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          userPreferences: { stepLayout: "SIDE_BY_SIDE" },
        }),
      })
    );
    // A session refresh would re-render every session reader on the page.
    expect(update).not.toHaveBeenCalled();
  });

  it("is shared by every instance on the page", async () => {
    currentSession = {
      user: { id: "u1", preferences: { stepLayout: "STACKED" } },
    };
    const useStepLayout = await loadHook();
    const first = renderHook(() => useStepLayout());
    const second = renderHook(() => useStepLayout());

    await act(async () => {
      await first.result.current.setLayout("SIDE_BY_SIDE");
    });

    expect(second.result.current.layout).toBe("SIDE_BY_SIDE");
  });

  it("reverts when the save fails", async () => {
    currentSession = {
      user: { id: "u1", preferences: { stepLayout: "STACKED" } },
    };
    fetchMock.mockResolvedValue({ ok: false, status: 500 } as Response);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const useStepLayout = await loadHook();
    const { result } = renderHook(() => useStepLayout());

    await act(async () => {
      await result.current.toggleLayout();
    });

    await waitFor(() => expect(result.current.layout).toBe("STACKED"));
    expect(update).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("does nothing without a signed-in user", async () => {
    const useStepLayout = await loadHook();
    const { result } = renderHook(() => useStepLayout());

    await act(async () => {
      await result.current.toggleLayout();
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.layout).toBe("STACKED");
  });

  it("ignores a choice made by a different user", async () => {
    currentSession = {
      user: { id: "u1", preferences: { stepLayout: "STACKED" } },
    };
    const useStepLayout = await loadHook();
    const { result, rerender } = renderHook(() => useStepLayout());

    await act(async () => {
      await result.current.setLayout("SIDE_BY_SIDE");
    });
    expect(result.current.layout).toBe("SIDE_BY_SIDE");

    currentSession = {
      user: { id: "u2", preferences: { stepLayout: "STACKED" } },
    };
    rerender();
    expect(result.current.layout).toBe("STACKED");
  });
});
