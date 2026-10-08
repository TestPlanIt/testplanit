import { describe, expect, it } from "vitest";
import {
  isBlockedByDependencies,
  resolveDependencyState,
} from "./caseDependencies";

// Links read "caseA depends on caseB": 2 depends on 1, 3 depends on 1 and 2.
const links = [
  { caseAId: 2, caseBId: 1, caseBName: "Create order" },
  { caseAId: 3, caseBId: 1, caseBName: "Create order" },
  { caseAId: 3, caseBId: 2, caseBName: "Verify provisioning" },
];

describe("resolveDependencyState", () => {
  it("blocks a case while a prerequisite in the run has not passed", () => {
    const state = resolveDependencyState({
      caseIds: [1, 2, 3],
      links,
      prerequisiteRunCases: [
        { id: 10, repositoryCaseId: 1, passed: false },
        { id: 20, repositoryCaseId: 2, passed: false },
        { id: 30, repositoryCaseId: 3, passed: false },
      ],
    });

    expect(state.has(1)).toBe(false);
    expect(state.get(2)?.blockedBy).toEqual([
      { testRunCaseId: 10, repositoryCaseId: 1, name: "Create order" },
    ]);
    expect(state.get(3)?.blockedBy.map((b) => b.repositoryCaseId)).toEqual([
      1, 2,
    ]);
    expect(isBlockedByDependencies(state.get(3))).toBe(true);
  });

  it("opens the gate once every prerequisite in the run has passed", () => {
    const state = resolveDependencyState({
      caseIds: [2, 3],
      links,
      prerequisiteRunCases: [
        { id: 10, repositoryCaseId: 1, passed: true },
        { id: 20, repositoryCaseId: 2, passed: false },
      ],
    });

    expect(state.get(2)?.blockedBy).toEqual([]);
    expect(isBlockedByDependencies(state.get(2))).toBe(false);
    // 3 still waits on 2.
    expect(state.get(3)?.blockedBy.map((b) => b.repositoryCaseId)).toEqual([2]);
  });

  it("never blocks on a prerequisite that is not in the run, but reports it", () => {
    const state = resolveDependencyState({
      caseIds: [3],
      links,
      prerequisiteRunCases: [{ id: 20, repositoryCaseId: 2, passed: true }],
    });

    expect(state.get(3)).toEqual({
      blockedBy: [],
      notInRun: [{ repositoryCaseId: 1, name: "Create order" }],
    });
    expect(isBlockedByDependencies(state.get(3))).toBe(false);
  });

  it("treats a failed or untested prerequisite the same: not passed", () => {
    const state = resolveDependencyState({
      caseIds: [2],
      links,
      prerequisiteRunCases: [{ id: 10, repositoryCaseId: 1, passed: false }],
    });
    expect(isBlockedByDependencies(state.get(2))).toBe(true);
  });

  it("ignores links that point back at the same prerequisite twice", () => {
    const state = resolveDependencyState({
      caseIds: [2],
      links: [
        { caseAId: 2, caseBId: 1 },
        { caseAId: 2, caseBId: 1 },
      ],
      prerequisiteRunCases: [{ id: 10, repositoryCaseId: 1, passed: false }],
    });
    expect(state.get(2)?.blockedBy).toHaveLength(1);
    expect(state.get(2)?.blockedBy[0]?.name).toBeNull();
  });

  it("returns no entry for a case without dependency links", () => {
    const state = resolveDependencyState({
      caseIds: [1],
      links,
      prerequisiteRunCases: [],
    });
    expect(state.size).toBe(0);
    expect(isBlockedByDependencies(undefined)).toBe(false);
  });
});
