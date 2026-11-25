import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useHasActiveAiModel } from "./useHasActiveAiModel";

const useCount = vi.hoisted(() => vi.fn());
vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({ llmIntegration: { useCount } }),
}));
vi.mock("~/zenstack/schema", () => ({ schema: {} }));

describe("useHasActiveAiModel", () => {
  beforeEach(() => useCount.mockReset());

  it("counts active models that are not deleted", () => {
    useCount.mockReturnValue({ data: 2 });
    expect(renderHook(() => useHasActiveAiModel()).result.current).toBe(true);
    expect(useCount).toHaveBeenCalledWith({
      where: { isDeleted: false, status: "ACTIVE" },
    });
  });

  it("is false when there is none", () => {
    useCount.mockReturnValue({ data: 0 });
    expect(renderHook(() => useHasActiveAiModel()).result.current).toBe(false);
  });

  it("is false while the count loads", () => {
    useCount.mockReturnValue({ data: undefined });
    expect(renderHook(() => useHasActiveAiModel()).result.current).toBe(false);
  });
});
