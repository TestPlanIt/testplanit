import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetForTesting,
  isUpdateBannerVisible,
  reportPossibleSkew,
} from "~/lib/deploymentSkew";
import {
  useDeploymentWatcher,
  VERSION_CONFIRM_DELAY_MS,
  VERSION_POLL_INTERVAL_MS,
} from "./useDeploymentWatcher";

const CLIENT_BUILD = "build-a";

let visibility: DocumentVisibilityState = "visible";
let serverBuilds: string[] = [];
const fetchMock = vi.fn();

const named = (name: string, message: string) =>
  Object.assign(new Error(message), { name });

/** Runs timers and lets the fetch → json → report chain settle. */
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

const setVisibility = async (next: DocumentVisibilityState) => {
  visibility = next;
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
  });
};

const fireRejection = (reason: unknown) => {
  const event = Object.assign(new Event("unhandledrejection"), { reason });
  window.dispatchEvent(event);
};

describe("useDeploymentWatcher", () => {
  beforeEach(() => {
    _resetForTesting();
    vi.useFakeTimers();
    vi.stubEnv("NEXT_PUBLIC_BUILD_ID", CLIENT_BUILD);
    visibility = "visible";
    serverBuilds = [];
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibility,
    });
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => ({
      ok: true,
      json: async () => ({ buildId: serverBuilds.shift() ?? CLIENT_BUILD }),
    }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("does not check on mount", () => {
    renderHook(() => useDeploymentWatcher());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("polls while visible and shows after a confirmed mismatch", async () => {
    serverBuilds = ["build-b", "build-b"];
    const { result } = renderHook(() => useDeploymentWatcher());

    await advance(VERSION_POLL_INTERVAL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/version", {
      cache: "no-store",
    });
    expect(result.current.updateAvailable).toBe(false);

    await advance(VERSION_CONFIRM_DELAY_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.updateAvailable).toBe(true);
  });

  it("does not show when the confirming check matches", async () => {
    serverBuilds = ["build-b", CLIENT_BUILD];
    const { result } = renderHook(() => useDeploymentWatcher());

    await advance(VERSION_POLL_INTERVAL_MS + VERSION_CONFIRM_DELAY_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.updateAvailable).toBe(false);
  });

  it("checks when the tab becomes visible and pauses polling while hidden", async () => {
    renderHook(() => useDeploymentWatcher());

    await setVisibility("hidden");
    await advance(VERSION_POLL_INTERVAL_MS * 3);
    expect(fetchMock).not.toHaveBeenCalled();

    await setVisibility("visible");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await advance(VERSION_POLL_INTERVAL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("shows within the confirm delay after returning to a stale tab", async () => {
    serverBuilds = ["build-b", "build-b"];
    const { result } = renderHook(() => useDeploymentWatcher());

    await setVisibility("hidden");
    await setVisibility("visible");
    await advance(VERSION_CONFIRM_DELAY_MS);
    expect(result.current.updateAvailable).toBe(true);
  });

  it("checks when the browser comes back online", async () => {
    renderHook(() => useDeploymentWatcher());
    await act(async () => {
      window.dispatchEvent(new Event("online"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("treats a failed version request as no answer", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const { result } = renderHook(() => useDeploymentWatcher());

    await advance(VERSION_POLL_INTERVAL_MS * 2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.updateAvailable).toBe(false);
  });

  it("never polls when the bundle has no build ID", async () => {
    vi.stubEnv("NEXT_PUBLIC_BUILD_ID", "");
    renderHook(() => useDeploymentWatcher());
    await advance(VERSION_POLL_INTERVAL_MS * 2);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stops polling once an update is detected", async () => {
    renderHook(() => useDeploymentWatcher());
    act(() => reportPossibleSkew(named("UnrecognizedActionError", "x")));

    await advance(VERSION_POLL_INTERVAL_MS * 2);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows at once on an unhandled server-action skew rejection", () => {
    const { result } = renderHook(() => useDeploymentWatcher());
    act(() =>
      fireRejection(
        named(
          "UnrecognizedActionError",
          'Server Action "abc" was not found on the server.'
        )
      )
    );
    expect(result.current.updateAvailable).toBe(true);
  });

  it("ignores unrelated unhandled rejections", () => {
    const { result } = renderHook(() => useDeploymentWatcher());
    act(() => fireRejection(new Error("boom")));
    expect(result.current.updateAvailable).toBe(false);
  });

  it("checks at once on a chunk error and shows if the build changed", async () => {
    serverBuilds = ["build-b"];
    const { result } = renderHook(() => useDeploymentWatcher());

    await act(async () => {
      fireRejection(named("ChunkLoadError", "Failed to load chunk /x.js"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.updateAvailable).toBe(true);
  });

  it("dismiss hides the banner", () => {
    const { result } = renderHook(() => useDeploymentWatcher());
    act(() => reportPossibleSkew(named("UnrecognizedActionError", "x")));
    act(() => result.current.dismiss());
    expect(result.current.updateAvailable).toBe(false);
    expect(isUpdateBannerVisible()).toBe(false);
  });

  it("removes its listeners on unmount", async () => {
    const { unmount } = renderHook(() => useDeploymentWatcher());
    unmount();

    act(() => fireRejection(named("UnrecognizedActionError", "x")));
    await setVisibility("visible");
    await advance(VERSION_POLL_INTERVAL_MS);
    expect(isUpdateBannerVisible()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
