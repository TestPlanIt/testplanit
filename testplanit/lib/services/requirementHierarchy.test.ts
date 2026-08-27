// Unit-lane proof for requirementHierarchy's app-layer cycle/project guards
// (HIER-03). These guards are pure enough to prove against a mocked
// $queryRaw-shaped db object, so they live here rather than under
// __tests__/integration/ — the recursive ancestor/subtree CTEs they build on
// execute real recursive SQL inside Postgres and can only be proven against
// a live database (see requirement-hierarchy.integration.test.ts for that
// half).
//
// Run via:
//   cd testplanit && pnpm exec vitest run lib/services/requirementHierarchy.test.ts

import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  assertNoCycle,
  assertSameProject,
  getRequirementSubtreeCount,
  getRequirementSubtreeIds,
} from "./requirementHierarchy";

function makeDb(
  overrides: {
    queryRaw?: unknown[];
    findMany?: unknown[];
  } = {}
) {
  return {
    $queryRaw: vi.fn().mockResolvedValue(overrides.queryRaw ?? []),
    issue: {
      findMany: vi.fn().mockResolvedValue(overrides.findMany ?? []),
    },
  };
}

describe("requirementHierarchy guards (HIER-03, app layer)", () => {
  it("assertNoCycle rejects making an issue its own parent", async () => {
    const db = makeDb();
    await expect(assertNoCycle(db, 7, 7)).rejects.toThrow(/own parent/);
    await expect(assertNoCycle(db, 7, 7)).rejects.toThrow(/7/);
  });

  it("assertNoCycle rejects reparenting an issue under its own descendant", async () => {
    const db = makeDb({ queryRaw: [{ id: 7 }] });
    await expect(assertNoCycle(db, 7, 9)).rejects.toThrow(/cycle/i);
  });

  it("assertNoCycle resolves when the new parent is not an ancestor", async () => {
    const db = makeDb({ queryRaw: [] });
    await expect(assertNoCycle(db, 7, 9)).resolves.toBeUndefined();
  });

  it("assertNoCycle resolves immediately when the new parent is null", async () => {
    const db = makeDb();
    await expect(assertNoCycle(db, 7, null)).resolves.toBeUndefined();
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });

  it("assertSameProject rejects a parent that belongs to a different project", async () => {
    const db = makeDb({
      findMany: [
        { id: 7, projectId: 1 },
        { id: 9, projectId: 2 },
      ],
    });
    await expect(assertSameProject(db, 7, 9)).rejects.toThrow(/project/i);
  });
});

// Unit-lane proof for the two exports 28-08 added: getRequirementSubtreeIds
// (newly exported, body untouched) and getRequirementSubtreeCount (new
// count-only sibling, same CTE body). The live-DB half -- proving the count
// actually agrees with the id list's length over a real recursive walk --
// can only be proven against real Postgres; see
// requirement-hierarchy.integration.test.ts and
// requirements-tree-lazy.integration.test.ts for that half.
describe("requirementTree count/ids exports (SCALE-02, unit)", () => {
  it("getRequirementSubtreeIds is exported and callable directly (28-08)", async () => {
    const db = makeDb({ queryRaw: [{ id: 42 }, { id: 43 }] });
    const ids = await getRequirementSubtreeIds(1, 100, db as never);
    expect(ids).toEqual([42, 43]);
  });

  it("getRequirementSubtreeCount returns a JS number, not a BigInt, even when the driver hands one back", async () => {
    const db = makeDb({ queryRaw: [{ count: 7n }] });
    const count = await getRequirementSubtreeCount(1, 100, db as never);
    expect(count).toBe(7);
    expect(typeof count).toBe("number");
  });

  it("getRequirementSubtreeCount returns 0 for a root with no live requirement descendants", async () => {
    const db = makeDb({ queryRaw: [{ count: 0 }] });
    const count = await getRequirementSubtreeCount(1, 100, db as never);
    expect(count).toBe(0);
  });

  it("casts the count to ::int in source (structural) -- the driver would otherwise hand back a BigInt", () => {
    const content = readFileSync(
      "lib/services/requirementHierarchy.ts",
      "utf8"
    );
    expect(content).toContain("COUNT(*)::int");
  });
});
