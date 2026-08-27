// Live-DB integration proof for requirementTree's roots-window/children
// primitives (SCALE-02), converted from the Wave 0 scaffold (phase 28-01).
// The unit lane (requirementTree.test.ts) proves the built statement's
// SHAPE against a mocked client; this file proves real Postgres BEHAVIOR --
// exhaustive keyset paging over a 1,200-row forest, a row inserted mid-walk,
// server-computed hasChildren, and cross-project/soft-delete/non-requirement
// exclusion. A mocked client cannot validate any of these against a real
// index scan under concurrent writes.
//
// Run via (never against the default .env DATABASE_URL -- that resolves to
// `ew`; always pass the scratch tpi_req20 URL explicitly):
//   cd testplanit && DATABASE_URL=<scratch tpi_req20 URL> RUN_DB_INTEGRATION=1 \
//     pnpm exec vitest run __tests__/integration/requirements-tree-lazy.integration.test.ts

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createRawDbClient } from "~/lib/rawDbClient";
import {
  countProjectRequirements,
  getRequirementChildren,
  getRequirementRootsPage,
  type RequirementRootsCursor,
} from "~/lib/services/requirementTree";

import {
  REQUIREMENT_SCALE_SIZES,
  seedRequirementForest,
  tearDownRequirementForest,
} from "./requirementScaleFixture";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

const db = createRawDbClient();
const STAMP = `rtl-${Date.now()}`;

describeIntegration("requirements tree lazy loading (live DB)", () => {
  beforeAll(async () => {
    // Refuse to run against anything but a scratch database, on this
    // file's OWN connection -- `seedRequirementForest`/
    // `tearDownRequirementForest` already guard themselves internally, but
    // this file also holds its own separate client (`db`, used to call the
    // service functions under test) and must never trust a callee's guard
    // as its only line of defense.
    const [{ current_database: dbName }] = await db.$queryRaw<
      Array<{ current_database: string }>
    >`SELECT current_database()`;
    if (dbName !== "tpi_req20" && dbName !== "tpi_test") {
      throw new Error(
        `refusing to run against database "${dbName}" -- this suite only runs against the tpi_req20 scratch DB (or tpi_test in CI)`
      );
    }
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it("pages the roots window by keyset without skipping or repeating a row", async () => {
    const forest = await seedRequirementForest({
      size: REQUIREMENT_SCALE_SIZES.large,
      namePrefix: `${STAMP}-exhaustive`,
      rootCount: 1100,
    });
    try {
      const seenIds: number[] = [];
      let cursor: RequirementRootsCursor | null = null;
      let pageCount = 0;

      for (;;) {
        const page = await getRequirementRootsPage(
          { projectId: forest.projectId, limit: 97, cursor },
          db
        );
        seenIds.push(...page.rows.map((row) => row.id));
        cursor = page.nextCursor;
        pageCount++;
        if (pageCount > 50) {
          throw new Error(
            "requirements-tree-lazy: exhaustive paging did not terminate within 50 pages"
          );
        }
        if (cursor === null) break;
      }

      // Concatenating every page reproduces the full root set EXACTLY
      // ONCE, IN ORDER -- an ordered array comparison, not a set
      // comparison, so a reorder or a duplicate would also fail this.
      // `forest.rootIds` is itself already in (name, id) order: the
      // fixture assigns ordinals 1..rootCount in that exact sequence.
      expect(seenIds).toEqual(forest.rootIds);
      expect(new Set(seenIds).size).toBe(forest.rootIds.length);
    } finally {
      await tearDownRequirementForest(forest);
    }
  }, 120_000);

  it("a row inserted mid-walk, after page 1 and before page 2, is neither skipped nor duplicated", async () => {
    const forest = await seedRequirementForest({
      size: 10,
      namePrefix: `${STAMP}-concurrent`,
      rootCount: 10,
    });
    try {
      const page1 = await getRequirementRootsPage(
        { projectId: forest.projectId, limit: 4 },
        db
      );
      expect(page1.rows).toHaveLength(4);
      expect(page1.nextCursor).not.toBeNull();

      // Insert a new root whose name sorts BEFORE page 1's cursor (i.e.
      // before the 4th already-returned root) -- the exact shape that
      // would shift an OFFSET-based page 2 and duplicate a row page 1
      // already returned (OFFSET counts ROWS from the start of the
      // CURRENT result set, so an insert ahead of the cursor position
      // shifts every subsequent page by one).
      const creator = await db.issue.findFirstOrThrow({
        where: { id: forest.rootIds[0] },
        select: { createdById: true },
      });
      const insertedName = `${forest.namePrefix}-002-inserted`;
      const inserted = await db.issue.create({
        data: {
          name: insertedName,
          title: insertedName,
          createdById: creator.createdById,
          projectId: forest.projectId,
          isRequirement: true,
          parentId: null,
        },
        select: { id: true },
      });

      try {
        const page2 = await getRequirementRootsPage(
          { projectId: forest.projectId, limit: 20, cursor: page1.nextCursor },
          db
        );

        const page1Ids = new Set(page1.rows.map((row) => row.id));
        const page2Ids = page2.rows.map((row) => row.id);

        // No previously returned root reappears.
        for (const id of page2Ids) {
          expect(page1Ids.has(id)).toBe(false);
        }
        // None of the remaining ORIGINAL roots is missing.
        const remainingOriginalIds = forest.rootIds.slice(4);
        for (const id of remainingOriginalIds) {
          expect(page2Ids).toContain(id);
        }
        // The mid-walk insert sorts before the cursor, so it is invisible
        // to THIS walk by construction -- the accepted trade-off of a
        // keyset cursor over a strict total order, and the opposite of
        // what OFFSET would have done here (silently duplicated the 4th
        // root instead of simply never surfacing the new row).
        expect(page2Ids).not.toContain(inserted.id);
      } finally {
        await db.issue.delete({ where: { id: inserted.id } });
      }
    } finally {
      await tearDownRequirementForest(forest);
    }
  }, 60_000);

  it("carries a server-computed hasChildren on every root, and returns exactly a node's direct children on expand", async () => {
    const forest = await seedRequirementForest({
      size: 10,
      namePrefix: `${STAMP}-expand`,
      rootCount: 4,
      depth: 3,
    });
    try {
      const page = await getRequirementRootsPage(
        { projectId: forest.projectId, limit: 20 },
        db
      );
      // 4 original roots + 2 overflow roots (depth exhausted before size
      // did -- see requirementScaleFixture.ts's own doc comment).
      expect(page.rows).toHaveLength(6);
      expect(page.nextCursor).toBeNull();

      const withChildren = page.rows
        .filter((row) => row.hasChildren)
        .map((row) => row.id)
        .sort((a, b) => a - b);
      const expectedParents = [forest.rootIds[0], forest.rootIds[1]].sort(
        (a, b) => a - b
      );
      expect(withChildren).toEqual(expectedParents);
      expect(page.rows.filter((row) => !row.hasChildren)).toHaveLength(4);

      const children = await getRequirementChildren(
        { projectId: forest.projectId, parentId: forest.rootIds[0] },
        db
      );
      expect(children).toHaveLength(1);
      expect(children[0].parentId).toBe(forest.rootIds[0]);
      // This child itself has a grandchild (depth=2) -- its own
      // hasChildren must be true, proving the probe is scoped per row,
      // not inherited from the roots query that fetched its parent.
      expect(children[0].hasChildren).toBe(true);

      const grandchildren = await getRequirementChildren(
        { projectId: forest.projectId, parentId: children[0].id },
        db
      );
      expect(grandchildren).toHaveLength(1);
      expect(grandchildren[0].hasChildren).toBe(false);

      const noChildren = await getRequirementChildren(
        { projectId: forest.projectId, parentId: forest.rootIds[2] },
        db
      );
      expect(noChildren).toEqual([]);
    } finally {
      await tearDownRequirementForest(forest);
    }
  }, 60_000);

  it("never returns a row from another project, and excludes soft-deleted and non-requirement rows", async () => {
    const forestA = await seedRequirementForest({
      size: 5,
      namePrefix: `${STAMP}-projA`,
      rootCount: 5,
    });
    const forestB = await seedRequirementForest({
      size: 5,
      namePrefix: `${STAMP}-projB`,
      rootCount: 5,
    });
    try {
      const pageA = await getRequirementRootsPage(
        { projectId: forestA.projectId, limit: 50 },
        db
      );
      expect(pageA.rows.map((row) => row.id).sort((a, b) => a - b)).toEqual(
        [...forestA.rootIds].sort((a, b) => a - b)
      );

      const countA = await countProjectRequirements(forestA.projectId, db);
      expect(countA).toBe(5);

      for (const row of pageA.rows) {
        expect(row.projectId).toBe(forestA.projectId);
        expect(forestB.allIds).not.toContain(row.id);
      }

      // `forestA.allIds` carries exactly 2 rows beyond its live roots:
      // one soft-deleted, one non-requirement (28-01's fixture seeds one
      // of each deliberately) -- neither may appear in the roots page.
      const extraIds = forestA.allIds.filter(
        (id) => !forestA.rootIds.includes(id)
      );
      expect(extraIds).toHaveLength(2);
      const returnedIds = new Set(pageA.rows.map((row) => row.id));
      for (const id of extraIds) {
        expect(returnedIds.has(id)).toBe(false);
      }
    } finally {
      await tearDownRequirementForest(forestA);
      await tearDownRequirementForest(forestB);
    }
  }, 60_000);

  // 28-09's own scope (D-04/D-05: server-side filtering and the pruned
  // ancestor-chain response) -- left as it.todo per this plan's own
  // acceptance criteria ("the ones 28-09 owns may remain").
  it.todo(
    "matches computeVisibleRequirementIds for every filter-axis combination"
  );
  it.todo("returns each match's ancestor chain and never a partial chain");
});
