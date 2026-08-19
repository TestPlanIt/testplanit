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

import { describe, expect, it, vi } from "vitest";

import { assertNoCycle, assertSameProject } from "./requirementHierarchy";

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
