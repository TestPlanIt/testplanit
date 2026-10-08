import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRunCasesQuery, mockLinksQuery } = vi.hoisted(() => ({
  mockRunCasesQuery: vi.fn(),
  mockLinksQuery: vi.fn(),
}));

vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    testRunCases: { useFindMany: mockRunCasesQuery },
    repositoryCaseLink: { useFindMany: mockLinksQuery },
  }),
}));

vi.mock("~/zenstack/schema", () => ({ schema: {} }));

import { useRunDependencyState } from "./useRunDependencyState";

/**
 * The hook is the client's half of the dependency gate. What matters is
 * that it fetches nothing until the project enforces dependencies, scopes
 * both queries to the run, and resolves the same blocked state the server
 * would.
 */
describe("useRunDependencyState", () => {
  beforeEach(() => {
    mockRunCasesQuery.mockReset();
    mockLinksQuery.mockReset();
    mockRunCasesQuery.mockReturnValue({ data: undefined });
    mockLinksQuery.mockReturnValue({ data: undefined });
  });

  it("leaves both queries disabled and returns an empty map when enforcement is off", () => {
    const { result } = renderHook(() => useRunDependencyState(50, false));

    expect(result.current.size).toBe(0);
    expect(mockRunCasesQuery.mock.calls[0][1]).toEqual({ enabled: false });
    expect(mockLinksQuery.mock.calls[0][1]).toEqual({ enabled: false });
  });

  it("stays disabled without a run id", () => {
    renderHook(() => useRunDependencyState(null, true));
    expect(mockRunCasesQuery.mock.calls[0][1]).toEqual({ enabled: false });
  });

  it("scopes the run cases and the links to the run", () => {
    renderHook(() => useRunDependencyState(50, true));

    expect(mockRunCasesQuery.mock.calls[0][0].where).toEqual({
      testRunId: 50,
      isDeleted: false,
    });
    expect(mockLinksQuery.mock.calls[0][0].where).toEqual({
      type: "DEPENDS_ON",
      isDeleted: false,
      caseA: { testRuns: { some: { testRunId: 50, isDeleted: false } } },
    });
    expect(mockRunCasesQuery.mock.calls[0][1]).toEqual({ enabled: true });
  });

  it("resolves blocked state keyed by repository case id", () => {
    mockRunCasesQuery.mockReturnValue({
      data: [
        { id: 10, repositoryCaseId: 1, status: { isSuccess: false } },
        { id: 20, repositoryCaseId: 2, status: null },
        { id: 30, repositoryCaseId: 3, status: { isSuccess: true } },
      ],
    });
    mockLinksQuery.mockReturnValue({
      data: [
        { caseAId: 2, caseBId: 1, caseB: { name: "Create order" } },
        { caseAId: 2, caseBId: 9, caseB: { name: "Elsewhere" } },
        { caseAId: 3, caseBId: 1, caseB: { name: "Create order" } },
      ],
    });

    const { result } = renderHook(() => useRunDependencyState(50, true));

    expect(result.current.get(2)).toEqual({
      blockedBy: [
        { testRunCaseId: 10, repositoryCaseId: 1, name: "Create order" },
      ],
      notInRun: [{ repositoryCaseId: 9, name: "Elsewhere" }],
    });
    // 3 depends on 1 too, and 1 has not passed — 3's own pass is irrelevant.
    expect(result.current.get(3)?.blockedBy).toHaveLength(1);
    expect(result.current.has(1)).toBe(false);
  });

  it("returns an empty map until both queries have data", () => {
    mockRunCasesQuery.mockReturnValue({
      data: [{ id: 10, repositoryCaseId: 1, status: null }],
    });
    const { result } = renderHook(() => useRunDependencyState(50, true));
    expect(result.current.size).toBe(0);
  });
});
