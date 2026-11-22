import { beforeEach, describe, expect, it } from "vitest";
import {
  isLeavingPage,
  notePendingNavigation,
  resetPendingNavigation,
} from "./pendingNavigation";

describe("pending navigation", () => {
  beforeEach(() => {
    resetPendingNavigation();
    window.history.replaceState({}, "", "/en-US/projects/repository/1?node=5");
  });

  it("reports nothing before any navigation", () => {
    expect(isLeavingPage()).toBe(false);
  });

  it("reports a move to another page until the browser gets there", () => {
    notePendingNavigation("/en-US/projects/shared-steps/1");
    expect(isLeavingPage()).toBe(true);

    window.history.replaceState({}, "", "/en-US/projects/shared-steps/1");
    expect(isLeavingPage()).toBe(false);
  });

  it("ignores a write to the page's own search params", () => {
    notePendingNavigation("/en-US/projects/repository/1?node=6");
    expect(isLeavingPage()).toBe(false);
  });

  it("reads a full URL, as a back or forward step reports it", () => {
    notePendingNavigation(
      `${window.location.origin}/en-US/projects/repository/1?node=5`
    );
    expect(isLeavingPage()).toBe(false);

    notePendingNavigation(`${window.location.origin}/en-US/projects/runs/1`);
    expect(isLeavingPage()).toBe(true);
  });

  it("stops reporting a move that lands somewhere else", () => {
    notePendingNavigation("/en-US/projects/shared-steps/1");
    window.history.replaceState({}, "", "/en-US/signin");
    expect(isLeavingPage()).toBe(false);

    window.history.replaceState({}, "", "/en-US/projects/repository/1");
    expect(isLeavingPage()).toBe(false);
  });

  it("stops reporting a move that never lands", () => {
    notePendingNavigation("/en-US/projects/shared-steps/1", 1_000);
    expect(isLeavingPage(10_000)).toBe(true);
    expect(isLeavingPage(17_000)).toBe(false);
    expect(isLeavingPage(2_000)).toBe(false);
  });
});
