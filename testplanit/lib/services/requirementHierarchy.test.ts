// Unit-lane scaffold for requirementHierarchy's app-layer cycle/project
// guards (HIER-03). These guards are pure enough to prove against a mocked
// $queryRaw-shaped db object, so they live here rather than under
// __tests__/integration/ — the recursive ancestor/subtree CTEs they build on
// execute real recursive SQL inside Postgres and can only be proven against
// a live database (see requirement-hierarchy.integration.test.ts for that
// half). No top-level import of the not-yet-created
// ~/lib/services/requirementHierarchy module: a missing-module import fails
// at transform time and reds the whole unit lane for every parallel plan.
//
// Run via:
//   cd testplanit && pnpm exec vitest run lib/services/requirementHierarchy.test.ts

import { describe, it } from "vitest";

describe("requirementHierarchy guards (HIER-03, app layer)", () => {
  it.todo("assertNoCycle rejects making an issue its own parent");
  it.todo(
    "assertNoCycle rejects reparenting an issue under its own descendant"
  );
  it.todo("assertNoCycle resolves when the new parent is not an ancestor");
  it.todo("assertNoCycle resolves immediately when the new parent is null");
  it.todo(
    "assertSameProject rejects a parent that belongs to a different project"
  );
});
