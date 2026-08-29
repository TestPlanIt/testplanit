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

import { coverageFor } from "~/hooks/useRequirementCoverage";
import { createRawDbClient } from "~/lib/rawDbClient";
import { getRequirementCoverage } from "~/lib/services/requirementCoverage";
import {
  countProjectRequirements,
  getRequirementChildren,
  getRequirementFilterFacets,
  getRequirementRootsPage,
  resolveRequirementMatches,
  type RequirementRootsCursor,
  type RequirementTreeFilterAxes,
} from "~/lib/services/requirementTree";
import type { Issue } from "~/zenstack/models";

// The oracle (28-CONTEXT D-04's own executable specification): this phase
// must NEVER edit computeVisibleRequirementIds or its tests -- only compare
// against it. Importing it from `__tests__/integration/` resolves fine
// (proven before writing this suite; the bracketed-segment path is not an
// import-resolution obstacle here), so the parity proof stays in the live-DB
// lane per <interfaces>'s own fallback instruction.
import {
  buildRequirementMaps,
  computeVisibleRequirementIds,
  matchesRequirementCoverageFilter,
} from "~/app/[locale]/projects/requirements/[projectId]/requirementsListRows";
import type { RequirementCoverageResponse } from "~/app/api/projects/[projectId]/requirements/coverage/route";

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

  // 28-09 (D-04/D-05: server-side filtering and the pruned ancestor-chain
  // response). PROOF DESIGN, mirroring requirement-coverage-rollup's own
  // documented reasoning: an obvious fixture where every "widget" node
  // shares identical status/source would pass under a query that
  // accidentally unions instead of intersects, one that drags in a
  // non-requirement ancestor, or one whose ancestor walk stops one level
  // too early -- every broken variant looks identical on a fixture with no
  // status divergence along a chain and no match that is uniquely
  // identifiable by name alone. c2 alone in the six-level chain below
  // carries a different status for exactly this reason, and c5's name
  // carries a token ("target") no other node shares, so its own 5-ancestor
  // chain can be isolated and asserted whole rather than merely "at least
  // the immediate parent."
  describe("server filter parity with computeVisibleRequirementIds (D-04/D-05)", () => {
    let projectId: number;
    let adminUserId: string;
    let integrationId: number;
    let repositoryId: number;
    let folderId: number;
    let templateId: number;
    let caseStateId: number;

    let c0Id: number;
    let c1Id: number;
    let c2Id: number;
    let c3Id: number;
    let c4Id: number;
    let c5Id: number;
    let sideEId: number;
    let sideFId: number;
    const allIssueIds: number[] = [];
    const allCaseIds: number[] = [];

    let allRequirements: Issue[];
    let requirementMap: Map<number, Issue>;
    let childrenMap: Map<number | null, Issue[]>;
    let coverageResponse: RequirementCoverageResponse;

    beforeAll(async () => {
      const [{ current_database: dbName }] = await db.$queryRaw<
        Array<{ current_database: string }>
      >`SELECT current_database()`;
      if (dbName !== "tpi_req20" && dbName !== "tpi_test") {
        throw new Error(
          `refusing to run against database "${dbName}" -- this suite only runs against the tpi_req20 scratch DB (or tpi_test in CI)`
        );
      }

      const role = await db.roles.findFirst({
        where: { isDefault: true, isDeleted: false },
        select: { id: true },
      });
      if (!role) throw new Error("Test prerequisite: no default Roles row");

      const admin = await db.user.create({
        data: {
          email: `${STAMP}-parity-admin@example.com`,
          name: `Parity Admin ${STAMP}`,
          authMethod: "INTERNAL",
          access: "ADMIN",
          accessSource: "MANUAL",
          roleId: role.id,
          password: "$2a$10$placeholderplaceholderplaceholderplaceholder",
        },
        select: { id: true },
      });
      adminUserId = admin.id;

      const project = await db.projects.create({
        data: { name: `${STAMP}-parity-project`, createdBy: adminUserId },
        select: { id: true },
      });
      projectId = project.id;

      const integration = await db.integration.create({
        data: {
          name: `${STAMP}-parity-jira`,
          provider: "JIRA",
          authType: "OAUTH2",
          status: "ACTIVE",
          credentials: {},
          settings: {},
        },
        select: { id: true },
      });
      integrationId = integration.id;

      const repository = await db.repositories.create({
        data: { projectId },
        select: { id: true },
      });
      repositoryId = repository.id;

      const folder = await db.repositoryFolders.create({
        data: {
          name: `${STAMP}-parity-folder`,
          repositoryId,
          projectId,
          creatorId: adminUserId,
        },
        select: { id: true },
      });
      folderId = folder.id;

      const template = await db.templates.findFirst({ select: { id: true } });
      if (!template) throw new Error("Test prerequisite: no Templates row");
      templateId = template.id;

      const caseWorkflow = await db.workflows.findFirst({
        where: { scope: "CASES", isDeleted: false, isEnabled: true },
        select: { id: true },
      });
      if (!caseWorkflow) {
        throw new Error("Test prerequisite: no CASES-scoped Workflows row");
      }
      caseStateId = caseWorkflow.id;

      async function createNode(
        name: string,
        parentId: number | null,
        overrides: Record<string, unknown> = {}
      ): Promise<number> {
        const issue = await db.issue.create({
          data: {
            name: `${STAMP}-${name}`,
            title: `${STAMP}-${name}`,
            createdById: adminUserId,
            projectId,
            parentId,
            isRequirement: true,
            status: "Open",
            ...overrides,
          },
          select: { id: true },
        });
        allIssueIds.push(issue.id);
        return issue.id;
      }

      // The chain: c0 -> c1 -> c2 -> c3 -> c4 -> c5, every node's name
      // containing "widget". c2 alone carries status "Blocked" -- any
      // status-active combo below therefore produces at least one
      // ancestor-only (non-matching) row, the property that makes this
      // fixture able to catch a union-instead-of-intersection mistake. c5's
      // name additionally carries "target", a token no other node shares,
      // isolating it as the SOLE match for the dedicated ancestor-chain
      // test further down.
      c0Id = await createNode("chain-0-widget", null);
      c1Id = await createNode("chain-1-widget", c0Id);
      c2Id = await createNode("chain-2-widget", c1Id, { status: "Blocked" });
      c3Id = await createNode("chain-3-widget", c2Id);
      c4Id = await createNode("chain-4-widget", c3Id);
      c5Id = await createNode("chain-5-widget-target", c4Id);

      await createNode("side-widget-a", null);
      await createNode("side-gadget-b", null);
      await createNode("side-widget-c", null, { status: "Closed" });
      await createNode("side-widget-d", null, {
        integrationId,
        externalId: `${STAMP}-ext-sideD`,
        externalStatus: "Open",
        status: "Closed",
      });
      sideEId = await createNode("side-widget-e", null);
      sideFId = await createNode("side-nomatch-f", null, {
        integrationId,
        externalId: `${STAMP}-ext-sideF`,
        requirementDetachedAt: new Date(),
        status: "Blocked",
      });

      async function createCoveredCase(
        name: string,
        issueId: number
      ): Promise<void> {
        const testCase = await db.repositoryCases.create({
          data: {
            projectId,
            repositoryId,
            folderId,
            templateId,
            name: `${STAMP}-${name}`,
            stateId: caseStateId,
            creatorId: adminUserId,
          },
          select: { id: true },
        });
        allCaseIds.push(testCase.id);
        await db.repositoryCaseIssue.create({
          data: { caseId: testCase.id, issueId },
        });
      }

      // sideE and sideF are the ONLY covered rows in this fixture -- every
      // other node has zero linked cases (UNCOVERED).
      await createCoveredCase("case-e", sideEId);
      await createCoveredCase("case-f", sideFId);

      allRequirements = await db.issue.findMany({
        where: { projectId, isDeleted: false, isRequirement: true },
      });
      ({ requirementMap, childrenMap } = buildRequirementMaps(allRequirements));

      const coverageMap = await getRequirementCoverage(projectId, {
        accessibleProjectIds: null,
      });
      coverageResponse = {
        projectId,
        coverage: Object.fromEntries(coverageMap),
      };
    });

    afterAll(async () => {
      await db.repositoryCaseIssue.deleteMany({
        where: { caseId: { in: allCaseIds } },
      });
      await db.repositoryCases.deleteMany({
        where: { id: { in: allCaseIds } },
      });
      await db.issue.deleteMany({ where: { id: { in: allIssueIds } } });
      await db.repositoryFolders.delete({ where: { id: folderId } });
      await db.repositories.delete({ where: { id: repositoryId } });
      await db.integration.delete({ where: { id: integrationId } });
      await db.projects.delete({ where: { id: projectId } });
      await db.user.delete({ where: { id: adminUserId } });

      const remaining = await db.issue.count({
        where: { id: { in: allIssueIds } },
      });
      if (remaining !== 0) {
        throw new Error(
          `server filter parity fixture: ${remaining} issue row(s) left behind`
        );
      }
    });

    // Computed in the test from the fixture's OWN parent map, per
    // <interfaces>'s own instruction -- never re-derived from a second
    // service call, so this cannot silently agree with a buggy
    // expandMatchedSubtrees by construction.
    function descendantsOf(seedIds: number[]): number[] {
      const seen = new Set(seedIds);
      const queue = [...seedIds];
      const result: number[] = [];
      while (queue.length > 0) {
        const parentId = queue.shift()!;
        for (const child of childrenMap.get(parentId) ?? []) {
          if (!seen.has(child.id)) {
            seen.add(child.id);
            result.push(child.id);
            queue.push(child.id);
          }
        }
      }
      return result;
    }

    // Computed from the SAME getRequirementCoverage result the oracle call
    // below reads -- a coverage difference can never masquerade as a
    // filter difference (this plan's own instruction).
    function coverageMatchIdsFor(active: boolean): number[] | null {
      if (!active) return null;
      return allRequirements
        .filter((requirement) =>
          matchesRequirementCoverageFilter(
            "UNCOVERED",
            coverageFor(coverageResponse, requirement.id)
          )
        )
        .map((requirement) => requirement.id);
    }

    const BOOL = [false, true];
    const combos: Array<{
      search: boolean;
      status: boolean;
      source: boolean;
      coverage: boolean;
    }> = [];
    for (const search of BOOL) {
      for (const status of BOOL) {
        for (const source of BOOL) {
          for (const coverage of BOOL) {
            combos.push({ search, status, source, coverage });
          }
        }
      }
    }
    // Sixteen entries: every on/off combination of the four axes, built
    // programmatically rather than hand-picked -- the intersection rule is
    // exactly the kind of thing that is right for one pair and wrong for
    // another (this plan's own instruction). A plain throw, not `expect`,
    // since this runs at collection time outside any `it` block.
    if (combos.length !== 16) {
      throw new Error(
        `requirements-tree-lazy: expected 16 axis combinations, built ${combos.length}`
      );
    }

    for (const combo of combos) {
      const label = `search=${combo.search} status=${combo.status} source=${combo.source} coverage=${combo.coverage}`;
      it(`matches computeVisibleRequirementIds for every filter-axis combination (${label})`, async () => {
        const axes: RequirementTreeFilterAxes = {
          search: combo.search ? "widget" : "",
          status: combo.status ? ["Open"] : [],
          source: combo.source ? ["MANUAL"] : [],
        };
        const coverageMatchIds = coverageMatchIdsFor(combo.coverage);
        const anyAxisActive =
          combo.search || combo.status || combo.source || combo.coverage;

        const oracleVisible = computeVisibleRequirementIds({
          requirements: allRequirements,
          requirementMap,
          childrenMap,
          normalizedFilter: axes.search.toLowerCase(),
          filters: {
            coverage: combo.coverage ? ["UNCOVERED"] : [],
            status: axes.status,
            source: axes.source,
          },
          coverage: coverageResponse,
          coverageError: false,
        });

        if (!anyAxisActive) {
          // The oracle's own "no filtering at all" case is deliberately
          // NOT resolveRequirementMatches's job -- Task 1's caller-error
          // guard: an unfiltered read belongs to getRequirementRootsPage.
          expect(oracleVisible, `combination ${label}`).toBeNull();
          await expect(
            resolveRequirementMatches(
              {
                projectId,
                axes,
                coverageMatchIds,
                limit: 100,
                include: "ids",
              },
              db
            )
          ).rejects.toThrow();
          return;
        }

        expect(oracleVisible, `combination ${label}`).not.toBeNull();

        const page = await resolveRequirementMatches(
          { projectId, axes, coverageMatchIds, limit: 100, include: "ids" },
          db
        );
        const descendantIds = page.expandMatchedSubtrees
          ? descendantsOf(page.matchedIds)
          : [];
        const serverVisible = new Set([
          ...page.matchedIds,
          ...page.ancestorIds,
          ...descendantIds,
        ]);

        expect(serverVisible, `combination ${label} disagreed`).toEqual(
          new Set(oracleVisible)
        );
      });
    }

    // The 16 combinations above each activate an axis with ONE value. This
    // pair proves the multi-select semantics against the same oracle: the
    // `= ANY(...)` translation must union within an axis and still AND
    // across them. A `= ANY(...)` that quietly became an OR between axes,
    // or an axis that kept only its last value, agrees with the oracle on
    // every single-valued combination and disagrees only here.
    const MULTI_VALUE_CASES: Array<{
      label: string;
      status: string[];
      source: ("MANUAL" | "SYNCED" | "DETACHED")[];
    }> = [
      { label: "two statuses", status: ["Open", "Blocked"], source: [] },
      {
        label: "two statuses AND two sources",
        status: ["Open", "Blocked"],
        source: ["MANUAL", "DETACHED"],
      },
    ];

    for (const testCase of MULTI_VALUE_CASES) {
      it(`matches computeVisibleRequirementIds for a multi-valued selection (${testCase.label})`, async () => {
        const axes: RequirementTreeFilterAxes = {
          search: "",
          status: testCase.status,
          source: testCase.source,
        };

        const oracleVisible = computeVisibleRequirementIds({
          requirements: allRequirements,
          requirementMap,
          childrenMap,
          normalizedFilter: "",
          filters: {
            coverage: [],
            status: testCase.status,
            source: testCase.source,
          },
          coverage: coverageResponse,
          coverageError: false,
        });
        expect(oracleVisible, testCase.label).not.toBeNull();

        const page = await resolveRequirementMatches(
          {
            projectId,
            axes,
            coverageMatchIds: null,
            limit: 100,
            include: "ids",
          },
          db
        );
        const descendantIds = page.expandMatchedSubtrees
          ? descendantsOf(page.matchedIds)
          : [];
        const serverVisible = new Set([
          ...page.matchedIds,
          ...page.ancestorIds,
          ...descendantIds,
        ]);

        expect(serverVisible, `${testCase.label} disagreed`).toEqual(
          new Set(oracleVisible)
        );
        // Guards against the oracle and the SQL agreeing because BOTH
        // matched nothing -- a vacuous pass this fixture is rich enough to
        // rule out (it carries Open, Blocked and Closed rows).
        expect(page.matchedIds.length).toBeGreaterThan(0);
      });
    }

    it("returns each match's ancestor chain and never a partial chain", async () => {
      // "target" uniquely identifies c5 -- no other node's name contains
      // it -- isolating it as the SOLE match, so its whole 5-level
      // ancestor chain (c4, c3, c2, c1, c0) can be asserted complete
      // rather than merely "at least the immediate parent."
      const page = await resolveRequirementMatches(
        {
          projectId,
          axes: { search: "target", status: [], source: [] },
          coverageMatchIds: null,
          limit: 100,
          include: "ids",
        },
        db
      );

      expect(page.matchedIds).toEqual([c5Id]);

      const expectedAncestors = [c0Id, c1Id, c2Id, c3Id, c4Id];
      expect(new Set(page.ancestorIds)).toEqual(new Set(expectedAncestors));

      // Disjoint: the match itself is never also reported as its own
      // ancestor.
      for (const id of page.ancestorIds) {
        expect(page.matchedIds).not.toContain(id);
      }
    });

    it("keeps ancestorIds and matchedIds disjoint even when an ancestor-context row (c2) sits between two matches", async () => {
      // status="Open" alone: c2's own status is "Blocked", so it fails the
      // active axis itself while sitting between two matches (c1 and c3)
      // in the chain -- exactly the "ancestor renders even though it does
      // not match" property, proven live rather than only structurally.
      const page = await resolveRequirementMatches(
        {
          projectId,
          axes: { search: "", status: ["Open"], source: [] },
          coverageMatchIds: null,
          limit: 100,
          include: "ids",
        },
        db
      );

      expect(page.matchedIds).not.toContain(c2Id);
      expect(page.ancestorIds).toContain(c2Id);
      for (const id of page.ancestorIds) {
        expect(page.matchedIds).not.toContain(id);
      }
    });

    it("pages the match set to exhaustion with a stable matchedTotal, no row skipped or repeated", async () => {
      const axes: RequirementTreeFilterAxes = {
        search: "widget",
        status: [],
        source: [],
      };
      const seenIds: number[] = [];
      let cursor: RequirementRootsCursor | null = null;
      let matchedTotal: number | null = null;
      let pageCount = 0;

      for (;;) {
        const page = await resolveRequirementMatches(
          {
            projectId,
            axes,
            coverageMatchIds: null,
            limit: 3,
            cursor,
            include: "ids",
          },
          db
        );
        if (matchedTotal === null) matchedTotal = page.matchedTotal;
        expect(page.matchedTotal).toBe(matchedTotal);
        seenIds.push(...page.matchedIds);
        cursor = page.nextCursor;
        pageCount += 1;
        if (pageCount > 20) {
          throw new Error(
            "requirements-tree-lazy: match paging did not terminate within 20 pages"
          );
        }
        if (cursor === null) break;
      }

      expect(new Set(seenIds).size).toBe(seenIds.length);
      expect(seenIds.length).toBe(matchedTotal);
    });

    it("a coverage outage (coverageMatchIds: null) never blanks the other active axes' results", async () => {
      const page = await resolveRequirementMatches(
        {
          projectId,
          axes: { search: "widget", status: [], source: [] },
          coverageMatchIds: null,
          limit: 100,
          include: "ids",
        },
        db
      );
      expect(page.matchedIds.length).toBeGreaterThan(0);
    });
  });

  // 28-19 (gap closure): `getRequirementFilterFacets`'s status axis proof.
  // Live Postgres, not the unit lane's mocked $qb, is what can actually
  // prove the lock-aware precedence CASE expression picks the right column
  // per row shape (native / synced-and-not-detached / detached) and that
  // the project/role/soft-delete scoping predicates genuinely exclude the
  // rows they claim to -- a mocked executor only ever returns canned rows
  // regardless of what the compiled SQL text says.
  describe("requirement filter facets (28-19)", () => {
    let projectId: number;
    let otherProjectId: number;
    let adminUserId: string;
    let integrationId: number;
    const allIssueIds: number[] = [];
    const otherProjectIssueIds: number[] = [];

    const nativeStatus = `${STAMP}-facet-native-status`;
    const syncedLocalHidden = `${STAMP}-facet-synced-local-hidden`;
    const syncedExternalVisible = `${STAMP}-facet-synced-external-visible`;
    const detachedLocalVisible = `${STAMP}-facet-detached-local-visible`;
    const detachedExternalHidden = `${STAMP}-facet-detached-external-hidden`;
    const deletedGhost = `${STAMP}-facet-deleted-ghost`;
    const nonReqGhost = `${STAMP}-facet-nonreq-ghost`;
    const otherProjectGhost = `${STAMP}-facet-other-project-ghost`;

    beforeAll(async () => {
      const [{ current_database: dbName }] = await db.$queryRaw<
        Array<{ current_database: string }>
      >`SELECT current_database()`;
      if (dbName !== "tpi_req20" && dbName !== "tpi_test") {
        throw new Error(
          `refusing to run against database "${dbName}" -- this suite only runs against the tpi_req20 scratch DB (or tpi_test in CI)`
        );
      }

      const role = await db.roles.findFirst({
        where: { isDefault: true, isDeleted: false },
        select: { id: true },
      });
      if (!role) throw new Error("Test prerequisite: no default Roles row");

      const admin = await db.user.create({
        data: {
          email: `${STAMP}-facets-admin@example.com`,
          name: `Facets Admin ${STAMP}`,
          authMethod: "INTERNAL",
          access: "ADMIN",
          accessSource: "MANUAL",
          roleId: role.id,
          password: "$2a$10$placeholderplaceholderplaceholderplaceholder",
        },
        select: { id: true },
      });
      adminUserId = admin.id;

      const project = await db.projects.create({
        data: { name: `${STAMP}-facets-project`, createdBy: adminUserId },
        select: { id: true },
      });
      projectId = project.id;

      const otherProject = await db.projects.create({
        data: {
          name: `${STAMP}-facets-other-project`,
          createdBy: adminUserId,
        },
        select: { id: true },
      });
      otherProjectId = otherProject.id;

      const integration = await db.integration.create({
        data: {
          name: `${STAMP}-facets-jira`,
          provider: "JIRA",
          authType: "OAUTH2",
          status: "ACTIVE",
          credentials: {},
          settings: {},
        },
        select: { id: true },
      });
      integrationId = integration.id;

      async function createNode(
        name: string,
        overrides: Record<string, unknown> = {}
      ): Promise<number> {
        const issue = await db.issue.create({
          data: {
            name: `${STAMP}-${name}`,
            title: `${STAMP}-${name}`,
            createdById: adminUserId,
            projectId,
            isRequirement: true,
            status: "Open",
            ...overrides,
          },
          select: { id: true },
        });
        allIssueIds.push(issue.id);
        return issue.id;
      }

      await createNode("native", { status: nativeStatus });
      // Synced, not detached -- locked (isRequirementLocked): the display
      // status must resolve to externalStatus. The local `status` column
      // is deliberately a DIFFERENT string so a query that read the wrong
      // column would be caught, not merely one that read no column at all.
      await createNode("synced", {
        integrationId,
        externalId: `${STAMP}-ext-synced`,
        status: syncedLocalHidden,
        externalStatus: syncedExternalVisible,
      });
      // Synced AND detached -- not locked: the display status must resolve
      // to the LOCAL status column, never externalStatus.
      await createNode("detached", {
        integrationId,
        externalId: `${STAMP}-ext-detached`,
        requirementDetachedAt: new Date(),
        status: detachedLocalVisible,
        externalStatus: detachedExternalHidden,
      });
      await createNode("deleted", {
        status: deletedGhost,
        isDeleted: true,
      });
      await createNode("nonreq", {
        status: nonReqGhost,
        isRequirement: false,
      });

      const otherIssue = await db.issue.create({
        data: {
          name: `${STAMP}-other-project-row`,
          title: `${STAMP}-other-project-row`,
          createdById: adminUserId,
          projectId: otherProjectId,
          isRequirement: true,
          status: otherProjectGhost,
        },
        select: { id: true },
      });
      otherProjectIssueIds.push(otherIssue.id);
    });

    afterAll(async () => {
      await db.issue.deleteMany({
        where: { id: { in: [...allIssueIds, ...otherProjectIssueIds] } },
      });
      await db.integration.delete({ where: { id: integrationId } });
      await db.projects.delete({ where: { id: projectId } });
      await db.projects.delete({ where: { id: otherProjectId } });
      await db.user.delete({ where: { id: adminUserId } });

      const remaining = await db.issue.count({
        where: { id: { in: [...allIssueIds, ...otherProjectIssueIds] } },
      });
      if (remaining !== 0) {
        throw new Error(
          `requirement filter facets fixture: ${remaining} issue row(s) left behind`
        );
      }
    });

    it("returns the project's distinct statuses under the lock-aware display-status precedence -- a synced, non-detached row contributes its externalStatus; a detached row contributes its local status", async () => {
      const facets = await getRequirementFilterFacets(
        { projectId, coverageScope: { accessibleProjectIds: null } },
        db
      );

      expect(facets.statuses).toContain(nativeStatus);
      expect(facets.statuses).toContain(syncedExternalVisible);
      expect(facets.statuses).not.toContain(syncedLocalHidden);
      expect(facets.statuses).toContain(detachedLocalVisible);
      expect(facets.statuses).not.toContain(detachedExternalHidden);
    });

    it("never contributes a status from a soft-deleted row, a non-requirement row, or another project's row", async () => {
      const facets = await getRequirementFilterFacets(
        { projectId, coverageScope: { accessibleProjectIds: null } },
        db
      );

      expect(facets.statuses).not.toContain(deletedGhost);
      expect(facets.statuses).not.toContain(nonReqGhost);
      expect(facets.statuses).not.toContain(otherProjectGhost);
    });

    it("resolves an empty coverage facet against this fixture's uncovered rows, rather than throwing", async () => {
      const facets = await getRequirementFilterFacets(
        { projectId, coverageScope: { accessibleProjectIds: null } },
        db
      );

      expect(facets.coverageStatuses).toEqual([]);
    });
  });
});
