import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetForTesting,
  classifySkewError,
  dismissUpdateBanner,
  isDeploymentSkewError,
  isUpdateAvailable,
  isUpdateBannerVisible,
  reportPossibleSkew,
  reportServerBuildId,
  setVersionCheckRequester,
  subscribeToUpdateBanner,
} from "./deploymentSkew";

const named = (name: string, message: string) =>
  Object.assign(new Error(message), { name });

// What Next 16 throws when the server answers x-nextjs-action-not-found.
const unrecognizedAction = () =>
  named(
    "UnrecognizedActionError",
    'Server Action "7f3a9c" was not found on the server. \nRead more: https://nextjs.org/docs/messages/failed-to-find-server-action'
  );
// What Turbopack's runtime throws when a chunk script fails to load.
const turbopackChunkError = () =>
  named(
    "ChunkLoadError",
    "Failed to load chunk /_next/static/chunks/0x1f.js from module 4821"
  );

describe("classifySkewError", () => {
  it.each([
    ["Next's UnrecognizedActionError", unrecognizedAction(), "action"],
    [
      "the action-not-found message without the error class",
      new Error('Server Action "abc" was not found on the server.'),
      "action",
    ],
    [
      "the server's log text",
      'Failed to find Server Action "abc". This request might be from an older or newer deployment.',
      "action",
    ],
    ["Turbopack's ChunkLoadError", turbopackChunkError(), "chunk"],
    [
      "webpack's chunk message",
      new Error("Loading chunk 482 failed.\n(error: /_next/static/482.js)"),
      "chunk",
    ],
    [
      "webpack's CSS chunk message",
      new Error("Loading CSS chunk app-layout failed."),
      "chunk",
    ],
  ])("recognizes %s", (_label, error, kind) => {
    expect(classifySkewError(error)).toBe(kind);
    expect(isDeploymentSkewError(error)).toBe(true);
  });

  it.each([
    ["an ordinary error", new Error("Network request failed")],
    ["a fetch TypeError", new TypeError("Failed to fetch")],
    ["a 404 for an unrelated thing", new Error("Project not found")],
    ["undefined", undefined],
    ["null", null],
    ["a number", 42],
    ["an object without a message", { code: "E_STALE" }],
  ])("ignores %s", (_label, error) => {
    expect(classifySkewError(error)).toBeNull();
    expect(isDeploymentSkewError(error)).toBe(false);
  });
});

describe("update flag", () => {
  beforeEach(() => {
    _resetForTesting();
  });

  it("shows at once on an unrecognized server action", () => {
    reportPossibleSkew(unrecognizedAction());
    expect(isUpdateBannerVisible()).toBe(true);
  });

  it("ignores errors that are not skew", () => {
    reportPossibleSkew(new Error("boom"));
    expect(isUpdateBannerVisible()).toBe(false);
  });

  it("needs two consecutive mismatches before showing", () => {
    expect(reportServerBuildId("build-b", "build-a")).toBe(true);
    expect(isUpdateBannerVisible()).toBe(false);
    expect(reportServerBuildId("build-b", "build-a")).toBe(true);
    expect(isUpdateBannerVisible()).toBe(true);
  });

  it("resets the count when a check matches, as a blue-green switch would", () => {
    reportServerBuildId("build-b", "build-a");
    expect(reportServerBuildId("build-a", "build-a")).toBe(false);
    reportServerBuildId("build-b", "build-a");
    expect(isUpdateBannerVisible()).toBe(false);
  });

  it("never compares without a client build ID", () => {
    expect(reportServerBuildId("build-b", undefined)).toBe(false);
    expect(reportServerBuildId("build-b", "")).toBe(false);
    reportServerBuildId("build-b", undefined);
    expect(isUpdateBannerVisible()).toBe(false);
  });

  it("treats a chunk error alone as a reason to check, not to show", () => {
    const request = vi.fn();
    setVersionCheckRequester(request);
    reportPossibleSkew(turbopackChunkError());
    expect(request).toHaveBeenCalledTimes(1);
    expect(isUpdateBannerVisible()).toBe(false);

    reportServerBuildId("build-b", "build-a");
    expect(isUpdateBannerVisible()).toBe(true);
  });

  it("drops a pending chunk error when the check matches", () => {
    setVersionCheckRequester(vi.fn());
    reportPossibleSkew(turbopackChunkError());
    reportServerBuildId("build-a", "build-a");
    reportServerBuildId("build-b", "build-a");
    expect(isUpdateBannerVisible()).toBe(false);
  });

  it("shows on a chunk error that follows a mismatch", () => {
    reportServerBuildId("build-b", "build-a");
    reportPossibleSkew(turbopackChunkError());
    expect(isUpdateBannerVisible()).toBe(true);
  });

  it("stays dismissed through later version checks", () => {
    reportPossibleSkew(unrecognizedAction());
    dismissUpdateBanner();
    expect(isUpdateBannerVisible()).toBe(false);
    expect(isUpdateAvailable()).toBe(true);

    reportServerBuildId("build-b", "build-a");
    reportServerBuildId("build-b", "build-a");
    expect(isUpdateBannerVisible()).toBe(false);
  });

  it.each([
    ["an unrecognized action", unrecognizedAction],
    ["a chunk error", turbopackChunkError],
  ])("comes back after dismissal on %s", (_label, makeError) => {
    reportPossibleSkew(unrecognizedAction());
    dismissUpdateBanner();
    reportPossibleSkew(makeError());
    expect(isUpdateBannerVisible()).toBe(true);
  });

  it("notifies subscribers once per change", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToUpdateBanner(listener);

    reportPossibleSkew(unrecognizedAction());
    reportPossibleSkew(unrecognizedAction());
    expect(listener).toHaveBeenCalledTimes(1);

    dismissUpdateBanner();
    dismissUpdateBanner();
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    reportPossibleSkew(unrecognizedAction());
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("only clears the requester it registered", () => {
    const first = vi.fn();
    const second = vi.fn();
    const releaseFirst = setVersionCheckRequester(first);
    setVersionCheckRequester(second);
    releaseFirst();

    reportPossibleSkew(turbopackChunkError());
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
