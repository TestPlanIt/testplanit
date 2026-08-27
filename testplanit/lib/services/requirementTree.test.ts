// Unit-lane proof for requirementTree's roots-window primitives (SCALE-02).
// Two techniques, mirroring this file family's own established split
// (requirementCoverage.test.ts): behavioral tests against a mocked Kysely
// executor (the same $qb.getExecutor() shape matrixCellCount.test.ts and
// requirementCoverage.test.ts already use) prove the pagination LOGIC --
// dropping the extra row, deriving nextCursor from the last KEPT row, and
// coercing a count to a JS number -- while source-text assertions prove the
// SQL SHAPE: the project/role/soft-delete predicates repeated in both the
// outer query and the EXISTS child-presence subquery, no OFFSET, and the
// limit+1 fetch. The live-DB half (real recursive/keyset correctness under
// concurrent inserts) can only be proven against real Postgres -- see
// requirements-tree-lazy.integration.test.ts and
// requirements-tree-threshold.integration.test.ts for that half.
//
// Run via:
//   cd testplanit && pnpm exec vitest run lib/services/requirementTree.test.ts

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  countProjectRequirements,
  getRequirementChildren,
  getRequirementRootsPage,
  REQUIREMENT_LAZY_THRESHOLD,
  type RequirementTreeRow,
} from "./requirementTree";

const FILE_PATH = "lib/services/requirementTree.ts";

function makeMockDb(rows: unknown[]) {
  return {
    $qb: {
      getExecutor: () => ({
        transformQuery: (n: unknown) => n,
        compileQuery: (n: unknown) => n,
        executeQuery: async () => ({ rows }),
      }),
    },
  };
}

function makeRow(overrides: Partial<RequirementTreeRow>): RequirementTreeRow {
  return {
    id: 1,
    name: "a",
    title: "a",
    status: null,
    externalStatus: null,
    priority: null,
    externalId: null,
    externalKey: null,
    externalUrl: null,
    issueTypeId: null,
    issueTypeName: null,
    issueTypeIconUrl: null,
    contentUpdatedAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    projectId: 1,
    integrationId: null,
    parentId: null,
    isRequirement: true,
    requirementDetachedAt: null,
    isDeleted: false,
    hasChildren: false,
    ...overrides,
  };
}

describe("REQUIREMENT_LAZY_THRESHOLD", () => {
  it("is fixed at 500 with no configuration knob (28-CONTEXT D-01)", () => {
    expect(REQUIREMENT_LAZY_THRESHOLD).toBe(500);
  });
});

describe("countProjectRequirements (unit, mocked $qb)", () => {
  it("returns a JS number even when the driver hands back a BigInt", async () => {
    const db = makeMockDb([{ count: 500n }]);
    const result = await countProjectRequirements(1, db as never);
    expect(result).toBe(500);
    expect(typeof result).toBe("number");
  });

  it("returns 0 when the project has no rows at all", async () => {
    const db = makeMockDb([]);
    const result = await countProjectRequirements(1, db as never);
    expect(result).toBe(0);
  });
});

describe("getRequirementRootsPage (unit, mocked $qb)", () => {
  it("returns nextCursor: null when exactly `limit` rows come back (no extra row)", async () => {
    const rows = [makeRow({ id: 1, name: "a" }), makeRow({ id: 2, name: "b" })];
    const db = makeMockDb(rows);
    const page = await getRequirementRootsPage(
      { projectId: 1, limit: 2 },
      db as never
    );
    expect(page.rows).toHaveLength(2);
    expect(page.nextCursor).toBeNull();
  });

  it("drops the limit+1th row and derives nextCursor from the LAST KEPT row, not the dropped one", async () => {
    // limit=2, three rows returned (the limit+1 fetch) -- the third exists
    // ONLY to signal "is there more". Using ITS (name, id) as the cursor
    // would make the next page's strict `>` comparison skip it entirely,
    // since it was never returned on THIS page either -- a lost row.
    const rows = [
      makeRow({ id: 1, name: "a" }),
      makeRow({ id: 2, name: "b" }),
      makeRow({ id: 3, name: "c" }),
    ];
    const db = makeMockDb(rows);
    const page = await getRequirementRootsPage(
      { projectId: 1, limit: 2 },
      db as never
    );
    expect(page.rows).toHaveLength(2);
    expect(page.rows.map((r) => r.id)).toEqual([1, 2]);
    expect(page.nextCursor).toEqual({ name: "b", id: 2 });
  });

  it("accepts a hostile cursor value without throwing (T-28-08-03) -- real injection immunity comes from parameterization, proven structurally below", async () => {
    const rows = [makeRow({ id: 5, name: "z" })];
    const db = makeMockDb(rows);
    await expect(
      getRequirementRootsPage(
        {
          projectId: 1,
          limit: 10,
          cursor: { name: '\'); DROP TABLE "Issue"; --', id: 999 },
        },
        db as never
      )
    ).resolves.toEqual({ rows, nextCursor: null });
  });
});

describe("getRequirementChildren (unit, mocked $qb)", () => {
  it("returns the mocked rows unmodified, each carrying its own hasChildren", async () => {
    const rows = [
      makeRow({ id: 10, name: "child-a", parentId: 1, hasChildren: false }),
      makeRow({ id: 11, name: "child-b", parentId: 1, hasChildren: true }),
    ];
    const db = makeMockDb(rows);
    const children = await getRequirementChildren(
      { projectId: 1, parentId: 1 },
      db as never
    );
    expect(children).toEqual(rows);
  });

  it("returns an empty array when the mocked executor reports no rows", async () => {
    const db = makeMockDb([]);
    const children = await getRequirementChildren(
      { projectId: 1, parentId: 999 },
      db as never
    );
    expect(children).toEqual([]);
  });
});

// Strips comment-prefixed lines before the OFFSET/SELECT-star checks below --
// this file's own prose (this doc comment included) legitimately explains
// why OFFSET is avoided and why no column list uses `SELECT *`, which would
// otherwise trip the very regex meant to catch the CODE doing either. Same
// technique the plan's own inline verification script uses, and the same
// comment-text trap issueRoleScope.containment.test.ts documents for itself.
function stripComments(source: string): string {
  return source
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return (
        !trimmed.startsWith("//") &&
        !trimmed.startsWith("*") &&
        !trimmed.startsWith("/*")
      );
    })
    .join("\n");
}

// Anchored slice of a named function's own body, from its `export async
// function <name>` declaration up to the NEXT such declaration (or end of
// file) -- scoped this way so a predicate that exists ELSEWHERE in the file
// (e.g. countProjectRequirements's own, unrelated "isDeleted" = false) can
// never stand in for one that was removed from the function actually under
// test. A whole-file substring check cannot tell those apart; this can.
function extractFunctionBody(content: string, functionName: string): string {
  const startMarker = `export async function ${functionName}`;
  const start = content.indexOf(startMarker);
  if (start === -1) {
    throw new Error(`extractFunctionBody: ${startMarker} not found`);
  }
  const nextFunction = content.indexOf(
    "export async function",
    start + startMarker.length
  );
  return nextFunction === -1
    ? content.slice(start)
    : content.slice(start, nextFunction);
}

describe("requirementTree.ts source shape (structural, mutation-provable)", () => {
  const content = readFileSync(FILE_PATH, "utf8");
  const code = stripComments(content);
  const rootsPageBody = extractFunctionBody(content, "getRequirementRootsPage");
  const hasChildrenFragmentBody = (() => {
    const start = content.indexOf("function requirementHasChildrenFragment");
    const end = content.indexOf(
      "export async function countProjectRequirements",
      start
    );
    return content.slice(start, end);
  })();

  it("never uses OFFSET pagination", () => {
    expect(code).not.toMatch(/OFFSET/i);
  });

  it("never selects *", () => {
    expect(code).not.toMatch(/SELECT\s+\*/i);
  });

  it("requests limit + 1 rows in the roots window, one query instead of a separate count", () => {
    expect(rootsPageBody).toContain("LIMIT ${limit + 1}");
  });

  it("the outer roots query repeats projectId, the role predicate, isDeleted, and parentId IS NULL", () => {
    expect(rootsPageBody).toContain('i."projectId" = ${projectId}');
    expect(rootsPageBody).toContain('i."isRequirement" = true');
    expect(rootsPageBody).toContain('i."isDeleted" = false');
    expect(rootsPageBody).toContain('i."parentId" IS NULL');
  });

  it("the child-presence EXISTS subquery repeats projectId, the role predicate, and isDeleted", () => {
    expect(hasChildrenFragmentBody).toContain('c."projectId" = ${projectId}');
    expect(hasChildrenFragmentBody).toContain('c."isRequirement" = true');
    expect(hasChildrenFragmentBody).toContain('c."isDeleted" = false');
  });

  it("the cursor comparison is a keyset tuple, never OFFSET", () => {
    expect(content).toContain(
      "(i.name, i.id) > (${cursor.name}, ${cursor.id})"
    );
  });

  it("no ORM issue.findMany/findFirst/count/groupBy read appears in this file", () => {
    expect(content).not.toMatch(
      /\.issue\.(findMany|findFirst|count|groupBy)\(/
    );
  });

  it("getRequirementChildren repeats projectId, parentId, the role predicate and isDeleted, with no cursor and no LIMIT", () => {
    const childrenBody = extractFunctionBody(content, "getRequirementChildren");
    expect(childrenBody).toContain('i."projectId" = ${projectId}');
    expect(childrenBody).toContain('i."parentId" = ${parentId}');
    expect(childrenBody).toContain('i."isRequirement" = true');
    expect(childrenBody).toContain('i."isDeleted" = false');
    expect(childrenBody).not.toMatch(/LIMIT/i);
  });

  it("the roots window and the children query share ONE column projection and ONE hasChildren fragment, never two copies", () => {
    // REQUIREMENT_TREE_COLUMNS is declared exactly once (the shared
    // fragment) and referenced by both queries via interpolation --
    // asserting the DECLARATION count stays at 1 is what would catch a
    // future edit that retyped the column list a second time instead of
    // reusing this one.
    const declarationCount = (
      content.match(/const REQUIREMENT_TREE_COLUMNS = sql`/g) ?? []
    ).length;
    expect(declarationCount).toBe(1);
    const usageCount = (content.match(/\$\{REQUIREMENT_TREE_COLUMNS\}/g) ?? [])
      .length;
    expect(usageCount).toBe(2);

    const fragmentDeclarationCount = (
      content.match(/function requirementHasChildrenFragment/g) ?? []
    ).length;
    expect(fragmentDeclarationCount).toBe(1);
    const fragmentUsageCount = (
      content.match(/\$\{requirementHasChildrenFragment\(projectId\)\}/g) ?? []
    ).length;
    expect(fragmentUsageCount).toBe(2);
  });
});
