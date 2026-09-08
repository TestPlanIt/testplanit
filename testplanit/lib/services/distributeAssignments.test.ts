import { describe, it, expect } from "vitest";

import {
  buildDistributionPlan,
  type AssignableUnit,
  type DistributeOptions,
} from "./distributeAssignments";

/**
 * Helper to build a single-config run of N cases spread over folders/tags.
 * runId defaults to 1 (single configuration).
 */
function makeUnit(overrides: Partial<AssignableUnit> = {}): AssignableUnit {
  return {
    testRunCaseId: overrides.testRunCaseId ?? 1,
    repositoryCaseId:
      overrides.repositoryCaseId ?? overrides.testRunCaseId ?? 1,
    runId: overrides.runId ?? 1,
    folderId: overrides.folderId ?? 1,
    folderOrderPath: overrides.folderOrderPath ?? [1, overrides.folderId ?? 1],
    caseOrder: overrides.caseOrder ?? 0,
    estimate: overrides.estimate ?? null,
    tagIds: overrides.tagIds ?? [],
    isCaseCompleted: overrides.isCaseCompleted ?? false,
    currentAssigneeId: overrides.currentAssigneeId ?? null,
  };
}

/** N cases, one per repository case, single folder, single config. */
function makeCases(
  n: number,
  opts: {
    folderId?: number;
    estimate?: number | null;
    startId?: number;
    runId?: number;
  } = {}
): AssignableUnit[] {
  const start = opts.startId ?? 1;
  return Array.from({ length: n }, (_, i) =>
    makeUnit({
      testRunCaseId: start + i,
      repositoryCaseId: start + i,
      folderId: opts.folderId ?? 1,
      caseOrder: i,
      estimate: opts.estimate ?? null,
      runId: opts.runId ?? 1,
    })
  );
}

const KEEP: Pick<DistributeOptions, "strategy"> = {
  strategy: "KEEP_CONFIGS_TOGETHER",
};

function baseOptions(over: Partial<DistributeOptions>): DistributeOptions {
  return {
    userIds: over.userIds ?? ["a", "b", "c"],
    strategy: over.strategy ?? "KEEP_CONFIGS_TOGETHER",
    groupBySections: over.groupBySections ?? false,
    reassignMode: over.reassignMode ?? "REASSIGN_ALL",
    includeCompleted: over.includeCompleted,
    weightBy: over.weightBy ?? "COUNT",
    splitThreshold: over.splitThreshold,
  };
}

function countsByUser(
  plan: ReturnType<typeof buildDistributionPlan>
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const a of plan.assignments) {
    out[a.assignedToId] = (out[a.assignedToId] ?? 0) + 1;
  }
  return out;
}

describe("buildDistributionPlan", () => {
  it("splits evenly by count (max-min <= 1) with grouping off", () => {
    const plan = buildDistributionPlan(
      makeCases(30),
      baseOptions({ userIds: ["a", "b", "c"], weightBy: "COUNT" })
    );
    const counts = Object.values(countsByUser(plan));
    expect(plan.assignments.length).toBe(30);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
  });

  it("balances by effort, not count, when weighting by estimate", () => {
    // 3 long cases (100) + 6 short cases (10). Count-fair would be 3 each;
    // effort-fair puts one long case per user and balances the rest.
    const long = makeCases(3, { estimate: 100, startId: 1 });
    const short = makeCases(6, { estimate: 10, startId: 100 });
    const plan = buildDistributionPlan(
      [...long, ...short],
      baseOptions({ userIds: ["a", "b", "c"], weightBy: "ESTIMATE" })
    );
    expect(plan.weightByUsed).toBe("ESTIMATE");
    const effort: Record<string, number> = {};
    for (const p of plan.perUser) effort[p.userId] = p.weight;
    const efforts = Object.values(effort);
    // Each user should carry exactly one long case → ~equal effort (~120 each).
    expect(Math.max(...efforts) - Math.min(...efforts)).toBeLessThanOrEqual(10);
  });

  it("falls back to the median estimate for cases missing one", () => {
    const withEst = makeCases(2, { estimate: 10, startId: 1 });
    const missing = makeCases(1, { estimate: null, startId: 100 });
    const plan = buildDistributionPlan(
      [...withEst, ...missing],
      baseOptions({ userIds: ["a"], weightBy: "ESTIMATE" })
    );
    expect(plan.weightByUsed).toBe("ESTIMATE");
    // median of [10,10] = 10; total effort = 30 to the single user.
    expect(plan.perUser[0].weight).toBe(30);
  });

  it("degrades to count when no case has an estimate", () => {
    const plan = buildDistributionPlan(
      makeCases(4),
      baseOptions({ userIds: ["a", "b"], weightBy: "ESTIMATE" })
    );
    expect(plan.weightByUsed).toBe("COUNT");
    expect(plan.hasEstimates).toBe(false);
  });

  it("reports effort even when balancing by case count", () => {
    // Balance by COUNT but cases carry estimates → effort should be populated.
    const plan = buildDistributionPlan(
      makeCases(4, { estimate: 600 }),
      baseOptions({ userIds: ["a", "b"], weightBy: "COUNT" })
    );
    expect(plan.weightByUsed).toBe("COUNT");
    expect(plan.hasEstimates).toBe(true);
    const totalEffort = plan.perUser.reduce((s, p) => s + p.effort, 0);
    expect(totalEffort).toBe(4 * 600);
    // Weight is the count (1 per case); effort is the summed estimate.
    for (const p of plan.perUser) {
      expect(p.weight).toBe(p.caseCount);
      expect(p.effort).toBe(p.caseCount * 600);
    }
  });

  it("keeps a small folder section whole with one user", () => {
    // Folder 1 has 3 cases; folder 2 has 3 cases; 2 users. With grouping on and
    // small sections, each folder should go entirely to one user.
    const f1 = makeCases(3, { folderId: 1, startId: 1 });
    const f2 = makeCases(3, { folderId: 2, startId: 100 });
    const plan = buildDistributionPlan(
      [...f1, ...f2],
      baseOptions({
        userIds: ["a", "b"],
        groupBySections: true,
        weightBy: "COUNT",
      })
    );
    const ownerOf = (id: number) =>
      plan.assignments.find((x) => x.testRunCaseId === id)?.assignedToId;
    // All of folder 1 share an owner; all of folder 2 share an owner.
    expect(new Set([ownerOf(1), ownerOf(2), ownerOf(3)]).size).toBe(1);
    expect(new Set([ownerOf(100), ownerOf(101), ownerOf(102)]).size).toBe(1);
  });

  it("splits an oversized section along tag-cluster boundaries", () => {
    // One folder, 10 cases, 2 users → fairShare 5, splitCap 7.5 < 10 so it
    // splits. Two tag clusters (tag 1 vs tag 2) must each stay whole.
    const clusterA = Array.from({ length: 5 }, (_, i) =>
      makeUnit({
        testRunCaseId: i + 1,
        repositoryCaseId: i + 1,
        folderId: 1,
        caseOrder: i,
        tagIds: [1],
      })
    );
    const clusterB = Array.from({ length: 5 }, (_, i) =>
      makeUnit({
        testRunCaseId: i + 100,
        repositoryCaseId: i + 100,
        folderId: 1,
        caseOrder: i + 5,
        tagIds: [2],
      })
    );
    const plan = buildDistributionPlan(
      [...clusterA, ...clusterB],
      baseOptions({
        userIds: ["a", "b"],
        groupBySections: true,
        weightBy: "COUNT",
      })
    );
    const ownerOf = (id: number) =>
      plan.assignments.find((x) => x.testRunCaseId === id)?.assignedToId;
    const ownersA = new Set([1, 2, 3, 4, 5].map(ownerOf));
    const ownersB = new Set([100, 101, 102, 103, 104].map(ownerOf));
    expect(ownersA.size).toBe(1);
    expect(ownersB.size).toBe(1);
    // Different clusters → different users (balanced).
    expect([...ownersA][0]).not.toBe([...ownersB][0]);
  });

  it("KEEP: a case's config rows all go to one user", () => {
    // 6 cases × 3 configs (runs 1,2,3). Each repository case shares an id across
    // the three sibling runs.
    const units: AssignableUnit[] = [];
    for (let c = 1; c <= 6; c++) {
      for (const runId of [1, 2, 3]) {
        units.push(
          makeUnit({
            testRunCaseId: c * 10 + runId,
            repositoryCaseId: c,
            runId,
            caseOrder: c,
          })
        );
      }
    }
    const plan = buildDistributionPlan(
      units,
      baseOptions({ userIds: ["a", "b", "c"], strategy: KEEP.strategy })
    );
    for (let c = 1; c <= 6; c++) {
      const owners = new Set(
        plan.assignments
          .filter((x) =>
            [c * 10 + 1, c * 10 + 2, c * 10 + 3].includes(x.testRunCaseId)
          )
          .map((x) => x.assignedToId)
      );
      expect(owners.size).toBe(1);
    }
  });

  it("SPLIT: users >= configs → each config to a distinct user, extras empty", () => {
    // 3 configs, 4 users.
    const units: AssignableUnit[] = [];
    for (const runId of [1, 2, 3]) {
      for (let c = 1; c <= 5; c++) {
        units.push(
          makeUnit({
            testRunCaseId: runId * 100 + c,
            repositoryCaseId: c,
            runId,
          })
        );
      }
    }
    const plan = buildDistributionPlan(
      units,
      baseOptions({
        userIds: ["a", "b", "c", "d"],
        strategy: "SPLIT_BY_CONFIG",
        weightBy: "COUNT",
      })
    );
    // Each run should be owned by exactly one user.
    const ownerByRun = new Map<number, Set<string>>();
    for (const a of plan.assignments) {
      const runId = Math.floor(a.testRunCaseId / 100);
      const set = ownerByRun.get(runId) ?? new Set();
      set.add(a.assignedToId);
      ownerByRun.set(runId, set);
    }
    for (const set of ownerByRun.values()) expect(set.size).toBe(1);
    // 3 configs → at most 3 distinct owners; one of the 4 users is empty.
    const distinctOwners = new Set(plan.assignments.map((a) => a.assignedToId));
    expect(distinctOwners.size).toBe(3);
  });

  it("ONLY_UNASSIGNED skips already-assigned cases and keeps them", () => {
    const cases = makeCases(4);
    cases[0].currentAssigneeId = "z";
    const plan = buildDistributionPlan(
      cases,
      baseOptions({
        userIds: ["a", "b"],
        reassignMode: "ONLY_UNASSIGNED",
        weightBy: "COUNT",
      })
    );
    expect(plan.assignments.length).toBe(3);
    expect(plan.skipped).toContainEqual({
      testRunCaseId: 1,
      reason: "kept-assigned",
    });
    expect(plan.assignments.find((a) => a.testRunCaseId === 1)).toBeUndefined();
  });

  it("skips completed cases unless includeCompleted", () => {
    const cases = makeCases(4);
    cases[0].isCaseCompleted = true;
    const plan = buildDistributionPlan(
      cases,
      baseOptions({ userIds: ["a", "b"], weightBy: "COUNT" })
    );
    expect(plan.assignments.length).toBe(3);
    expect(plan.skipped).toContainEqual({
      testRunCaseId: 1,
      reason: "completed",
    });
  });

  it("returns an empty plan with zero users", () => {
    const plan = buildDistributionPlan(
      makeCases(4),
      baseOptions({ userIds: [], weightBy: "COUNT" })
    );
    expect(plan.assignments).toHaveLength(0);
    expect(plan.fairShare).toBe(0);
  });

  it("assigns everything to a single user", () => {
    const plan = buildDistributionPlan(
      makeCases(5),
      baseOptions({ userIds: ["solo"], weightBy: "COUNT" })
    );
    expect(plan.assignments.length).toBe(5);
    expect(new Set(plan.assignments.map((a) => a.assignedToId))).toEqual(
      new Set(["solo"])
    );
  });

  it("is deterministic — identical input yields identical output", () => {
    const build = () =>
      buildDistributionPlan(
        makeCases(17, { estimate: 5 }),
        baseOptions({
          userIds: ["a", "b", "c"],
          groupBySections: true,
          weightBy: "ESTIMATE",
        })
      );
    expect(build()).toEqual(build());
  });
});
