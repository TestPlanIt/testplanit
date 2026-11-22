import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  notePendingNavigation,
  resetPendingNavigation,
} from "~/utils/pendingNavigation";
import { resetUrlWriteOverlay } from "~/utils/urlParamWrite";

const { replace, push } = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
}));

vi.mock("~/lib/navigation", () => ({
  usePathname: () => "/projects/repository/1",
  useRouter: () => ({ replace, push }),
}));

import { useUrlParamWriter } from "./useUrlParamWriter";

describe("useUrlParamWriter", () => {
  beforeEach(() => {
    replace.mockClear();
    push.mockClear();
    resetPendingNavigation();
    resetUrlWriteOverlay();
    window.history.replaceState({}, "", "/en-US/projects/repository/1?node=5");
  });

  it("writes a param onto the current page", () => {
    const { result } = renderHook(() => useUrlParamWriter());
    result.current((params) => params.set("view", "folders"));
    expect(replace).toHaveBeenCalledWith(
      "/projects/repository/1?node=5&view=folders",
      { scroll: false }
    );
  });

  it("replaces nothing once a move to another page has started", () => {
    const { result } = renderHook(() => useUrlParamWriter());
    notePendingNavigation("/en-US/projects/shared-steps/1");

    result.current((params) => params.set("view", "folders"));
    expect(replace).not.toHaveBeenCalled();
  });

  it("still pushes while a move to another page is pending", () => {
    const { result } = renderHook(() => useUrlParamWriter());
    notePendingNavigation("/en-US/projects/shared-steps/1");

    result.current((params) => params.set("case", "3"), { history: "push" });
    expect(push).toHaveBeenCalledWith("/projects/repository/1?node=5&case=3", {
      scroll: false,
    });
  });

  it("composes from the real URL again after a skipped write", () => {
    const { result } = renderHook(() => useUrlParamWriter());
    notePendingNavigation("/en-US/projects/shared-steps/1");
    result.current((params) => params.set("view", "folders"));

    resetPendingNavigation();
    result.current((params) => params.set("page", "2"));
    expect(replace).toHaveBeenCalledWith(
      "/projects/repository/1?node=5&page=2",
      { scroll: false }
    );
  });
});
