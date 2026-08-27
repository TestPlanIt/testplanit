// Wave 0 scaffold (phase 28-01) for the 499/500/501 classified-requirement
// mode-boundary lane (SCALE-01/SCALE-02), converted by 28-08. This plan's
// own Task 2 added one real test to this file earlier -- the roots-query
// EXPLAIN measurement the composite-index decision (28-RESEARCH Open
// Question 3) rests on, resolved no-index (see 28-01-SUMMARY.md).
//
// Run via (never against the default .env DATABASE_URL -- that resolves to
// `ew`; always pass the scratch tpi_req20 URL explicitly):
//   DATABASE_URL=<scratch tpi_req20 URL> RUN_DB_INTEGRATION=1 \
//     pnpm exec vitest run __tests__/integration/requirements-tree-threshold.integration.test.ts

import { existsSync, mkdirSync, statSync, writeFileSync } from "fs";

import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createRawDbClient } from "~/lib/rawDbClient";
import {
  countProjectRequirements,
  REQUIREMENT_LAZY_THRESHOLD,
} from "~/lib/services/requirementTree";

import {
  REQUIREMENT_SCALE_SIZES,
  seedRequirementForest,
  tearDownRequirementForest,
  type SeededForest,
} from "./requirementScaleFixture";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

describeIntegration("requirements tree mode threshold (live DB)", () => {
  const db = createRawDbClient();
  const STAMP = `rtt-mode-${Date.now()}`;
  let belowForest: SeededForest;
  let atForest: SeededForest;
  let aboveForest: SeededForest;

  beforeAll(async () => {
    // Refuse to run against anything but a scratch database, on this
    // file's OWN connection -- same defense-in-depth reasoning as
    // requirements-tree-lazy.integration.test.ts's own guard.
    const [{ current_database: dbName }] = await db.$queryRaw<
      Array<{ current_database: string }>
    >`SELECT current_database()`;
    if (dbName !== "tpi_req20" && dbName !== "tpi_test") {
      throw new Error(
        `refusing to run against database "${dbName}" -- this suite only runs against the tpi_req20 scratch DB (or tpi_test in CI)`
      );
    }

    belowForest = await seedRequirementForest({
      size: REQUIREMENT_SCALE_SIZES.belowThreshold,
      namePrefix: `${STAMP}-below`,
    });
    atForest = await seedRequirementForest({
      size: REQUIREMENT_SCALE_SIZES.atThreshold,
      namePrefix: `${STAMP}-at`,
    });
    aboveForest = await seedRequirementForest({
      size: REQUIREMENT_SCALE_SIZES.aboveThreshold,
      namePrefix: `${STAMP}-above`,
    });
  }, 120_000);

  afterAll(async () => {
    await tearDownRequirementForest(belowForest);
    await tearDownRequirementForest(atForest);
    await tearDownRequirementForest(aboveForest);
    await db.$disconnect();
  }, 120_000);

  it("reports mode 'all' at 499 classified requirements", async () => {
    const count = await countProjectRequirements(belowForest.projectId, db);
    expect(count).toBe(REQUIREMENT_SCALE_SIZES.belowThreshold);
    expect(count > REQUIREMENT_LAZY_THRESHOLD).toBe(false);
  });

  it("reports mode 'all' at exactly 500 classified requirements", async () => {
    const count = await countProjectRequirements(atForest.projectId, db);
    expect(count).toBe(REQUIREMENT_SCALE_SIZES.atThreshold);
    expect(count).toBe(REQUIREMENT_LAZY_THRESHOLD);
    // D-01's boundary is inclusive on the load-all side: exactly the
    // threshold still loads all, only STRICTLY more than it goes lazy.
    expect(count > REQUIREMENT_LAZY_THRESHOLD).toBe(false);
  });

  it("reports mode 'lazy' at 501 classified requirements", async () => {
    const count = await countProjectRequirements(aboveForest.projectId, db);
    expect(count).toBe(REQUIREMENT_SCALE_SIZES.aboveThreshold);
    expect(count > REQUIREMENT_LAZY_THRESHOLD).toBe(true);
  });

  it("counts only live, requirement-role rows toward the threshold", async () => {
    // seedRequirementForest seeds exactly one soft-deleted row and one
    // non-requirement row alongside `size` live classified rows in EVERY
    // forest -- the count must exclude both, or every cohort above would
    // silently read two rows over its named size.
    const count = await countProjectRequirements(belowForest.projectId, db);
    expect(count).toBe(REQUIREMENT_SCALE_SIZES.belowThreshold);
    expect(belowForest.allIds.length).toBe(
      REQUIREMENT_SCALE_SIZES.belowThreshold + 2
    );
  });
});

interface ExplainRow {
  "QUERY PLAN": string;
}

function formatPlan(label: string, rows: ExplainRow[]): string {
  return `--- ${label} ---\n${rows.map((row) => row["QUERY PLAN"]).join("\n")}\n`;
}

describeIntegration("roots-query plan at scale (live DB)", () => {
  it("records the roots-query plan at 1,200 requirements", async () => {
    const db = createRawDbClient();
    let forest: SeededForest | undefined;
    try {
      forest = await seedRequirementForest({
        size: REQUIREMENT_SCALE_SIZES.large,
        namePrefix: `rtt-${Date.now()}`,
        // At least 1,000 roots so the deep-page cursor below (the ~1,000th
        // root) is real, not synthesized -- the fixture's own default
        // rootCount (~half of size) would fall short of 1,000 at size=1,200.
        rootCount: 1100,
      });

      // Candidate roots query, verbatim from 28-RESEARCH Q3(b): the
      // windowed roots-with-child-presence shape.
      const { rows: firstPageRows } = await sql<ExplainRow>`
          EXPLAIN (ANALYZE, BUFFERS)
          SELECT i.id, i.name,
            EXISTS (
              SELECT 1 FROM "Issue" c
              WHERE c."parentId" = i.id AND c."isRequirement" = true AND c."isDeleted" = false
            ) AS "hasChildren"
          FROM "Issue" i
          WHERE i."projectId" = ${forest.projectId} AND i."isRequirement" = true AND i."isDeleted" = false
            AND i."parentId" IS NULL
          ORDER BY i.name, i.id
          LIMIT 50
        `.execute(db.$qb);

      // Not measured: locates the ~1,000th root's (name, id) to seed the
      // deep-page keyset cursor below. A plain, non-EXPLAIN lookup so it
      // doesn't itself pollute the recorded plans.
      const cursorRows = await db.issue.findMany({
        where: {
          projectId: forest.projectId,
          id: { in: forest.rootIds },
          isRequirement: true,
          isDeleted: false,
          parentId: null,
        },
        orderBy: [{ name: "asc" }, { id: "asc" }],
        select: { name: true, id: true },
        skip: 999,
        take: 1,
      });
      const cursor = cursorRows[0];
      if (!cursor) {
        throw new Error(
          "requirements-tree-threshold: expected at least 1,000 roots to establish a deep-page cursor"
        );
      }

      const { rows: deepPageRows } = await sql<ExplainRow>`
          EXPLAIN (ANALYZE, BUFFERS)
          SELECT i.id, i.name,
            EXISTS (
              SELECT 1 FROM "Issue" c
              WHERE c."parentId" = i.id AND c."isRequirement" = true AND c."isDeleted" = false
            ) AS "hasChildren"
          FROM "Issue" i
          WHERE i."projectId" = ${forest.projectId} AND i."isRequirement" = true AND i."isDeleted" = false
            AND i."parentId" IS NULL
            AND (i.name, i.id) > (${cursor.name}, ${cursor.id})
          ORDER BY i.name, i.id
          LIMIT 50
        `.execute(db.$qb);

      const { rows: expandRows } = await sql<ExplainRow>`
          EXPLAIN (ANALYZE, BUFFERS)
          SELECT i.id, i.name,
            EXISTS (
              SELECT 1 FROM "Issue" c
              WHERE c."parentId" = i.id AND c."isRequirement" = true AND c."isDeleted" = false
            ) AS "hasChildren"
          FROM "Issue" i
          WHERE i."projectId" = ${forest.projectId} AND i."parentId" = ${forest.rootIds[0]}
            AND i."isRequirement" = true AND i."isDeleted" = false
          ORDER BY i.name, i.id
          LIMIT 50
        `.execute(db.$qb);

      const output =
        formatPlan("roots first page", firstPageRows) +
        "\n" +
        formatPlan("roots deep page (cursor ~1,000th root)", deepPageRows) +
        "\n" +
        formatPlan("expand (single node's live children)", expandRows);

      const outDir = "/tmp/gsd-phase28";
      mkdirSync(outDir, { recursive: true });
      const outPath = `${outDir}/explain-roots.txt`;
      writeFileSync(outPath, output);

      const executionTimes = output.match(/Execution Time: [\d.]+ ms/g) ?? [];
      // eslint-disable-next-line no-console -- deliberate: carries the
      // three execution times into the run output without opening the file.
      console.log("roots-query EXPLAIN execution times:", executionTimes);

      expect(existsSync(outPath)).toBe(true);
      expect(statSync(outPath).size).toBeGreaterThan(0);
      // Objectively true regardless of verdict -- no plan-node-type
      // assertion here; an index-scan assertion written before the index
      // exists is a test that must be edited to pass, the opposite of
      // evidence.
      expect(executionTimes.length).toBe(3);
    } finally {
      if (forest) await tearDownRequirementForest(forest);
      await db.$disconnect();
    }
  }, 120_000);
});
