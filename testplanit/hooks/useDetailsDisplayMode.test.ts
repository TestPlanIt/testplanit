import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useDetailsDisplayMode } from "./useDetailsDisplayMode";

let currentSession: unknown = null;
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: currentSession }),
}));

describe("useDetailsDisplayMode", () => {
  beforeEach(() => {
    currentSession = null;
  });

  it("defaults to the docked panel with no session", () => {
    const { result } = renderHook(() => useDetailsDisplayMode());
    expect(result.current).toEqual({ mode: "DOCKED", opensInNewWindow: false });
  });

  it("defaults to the docked panel when the session carries no preference", () => {
    currentSession = { user: { id: "u1", preferences: {} } };
    const { result } = renderHook(() => useDetailsDisplayMode());
    expect(result.current).toEqual({ mode: "DOCKED", opensInNewWindow: false });
  });

  it("reports the new-window preference", () => {
    currentSession = {
      user: { id: "u1", preferences: { detailsDisplayMode: "NEW_WINDOW" } },
    };
    const { result } = renderHook(() => useDetailsDisplayMode());
    expect(result.current).toEqual({
      mode: "NEW_WINDOW",
      opensInNewWindow: true,
    });
  });
});
