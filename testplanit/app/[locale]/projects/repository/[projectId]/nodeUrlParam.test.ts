import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { syncNodeUrlParam } from "./nodeUrlParam";

describe("syncNodeUrlParam", () => {
  const original = window.history.replaceState.bind(window.history);
  let replaceState: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    original({}, "", "/en-US/projects/repository/1?page=1&pageSize=10&node=5");
    replaceState = vi.spyOn(window.history, "replaceState");
  });

  afterEach(() => {
    replaceState.mockRestore();
  });

  it("does not touch history when the URL already carries the folder", () => {
    expect(syncNodeUrlParam(5)).toBe(false);
    expect(replaceState).not.toHaveBeenCalled();
  });

  it("writes a different folder and keeps the other params", () => {
    expect(syncNodeUrlParam(7)).toBe(true);
    expect(replaceState).toHaveBeenCalledTimes(1);
    const params = new URL(window.location.href).searchParams;
    expect(params.get("node")).toBe("7");
    expect(params.get("page")).toBe("1");
    expect(params.get("pageSize")).toBe("10");
  });

  it("removes the param for null and is a no-op once it is gone", () => {
    expect(syncNodeUrlParam(null)).toBe(true);
    expect(new URL(window.location.href).searchParams.has("node")).toBe(false);
    expect(new URL(window.location.href).searchParams.get("page")).toBe("1");

    replaceState.mockClear();
    expect(syncNodeUrlParam(null)).toBe(false);
    expect(replaceState).not.toHaveBeenCalled();
  });
});
