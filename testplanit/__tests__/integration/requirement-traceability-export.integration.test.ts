// Live-DB integration proof for the requirement traceability matrix
// (COV-04). Converted from the it.todo scaffold by 26-08. Guard copied
// verbatim from
// __tests__/integration/requirement-coverage-rollup.integration.test.ts:121-129.
//
// Run via (never against the default .env DATABASE_URL — that resolves to
// `ew`; always pass the scratch tpi_req20 URL explicitly):
//   BASE = .env DATABASE_URL with /ew?schema=public replaced by
//   /tpi_req20?schema=public
//   DATABASE_URL="$BASE" RUN_DB_INTEGRATION=1 pnpm exec vitest run \
//     __tests__/integration/requirement-traceability-export.integration.test.ts
//
// This suite must never inherit the worktree's own .env DATABASE_URL,
// which resolves to the real, shared dev database. The current_database()
// guard in beforeAll below refuses to proceed against anything but the
// scratch database, whatever DATABASE_URL a caller supplies. In the unit
// lane (RUN_DB_INTEGRATION unset), describeIntegration resolves to
// describe.skip, so beforeAll never runs and no connection is attempted.
//
// PROOF DESIGN — why an obvious, symmetric fixture would prove nothing:
// see requirement-coverage-rollup.integration.test.ts's own note. This
// fixture reuses that reasoning for the traceability matrix specifically:
// reqA has THREE covering cases so a single-row-per-requirement bug shows
// up immediately; reqB and reqC are both uncovered but for DIFFERENT
// reasons (zero links vs. a soft-deleted-only link), proving the gap
// emission is not merely "the requirement I happened to leave empty"; the
// reqRoot/reqMid/reqLeaf chain gives a real depth-2 nested requirement
// whose path names every ancestor; and one of reqA's three cases lives in
// a second project, so the cross-project exclusion assertion is real
// rather than hypothetical.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createRawDbClient } from "~/lib/rawDbClient";
import { getRequirementCoverage } from "~/lib/services/requirementCoverage";
import { loadRequirementTraceability } from "~/lib/services/requirementTraceability";

import type { RequirementTraceabilityData } from "~/lib/services/requirementTraceability";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

const db = createRawDbClient();
// Run-scoped stamp for fixture naming, keeping concurrent runs' rows
// distinguishable and scoping the post-teardown cleanliness check below.
const STAMP = `rte-${Date.now()}`;

describeIntegration(
  "requirement traceability export (live DB, converted by 26-08)",
  () => {
    let adminUserId: string;
    let projectOneId: number;
    let projectTwoId: number;

    let repositoryOneId: number;
    let folderOneId: number;
    let repositoryTwoId: number;
    let folderTwoId: number;

    let templateId: number;
    let caseStateId: number;

    // reqA: standalone, three covering cases (two in-project, one in a
    // second project). reqB: standalone, zero links — a real gap.
    // reqC: standalone, one link but the linked case is soft-deleted —
    // uncovered for a DIFFERENT reason than reqB, proving the gap
    // emission is not keyed off "no link row exists" alone. reqRoot ->
    // reqMid -> reqLeaf: a real depth-2 nested chain, with the only case
    // linked at the leaf, inherited by both ancestors through the
    // subtree walk.
    let reqAId: number;
    let reqBId: number;
    let reqCId: number;
    let reqRootId: number;
    let reqMidId: number;
    let reqLeafId: number;

    let caseA1Id: number;
    let caseA2Id: number;
    let caseOtherProjectId: number;
    let caseDeletedId: number;
    let caseLeafId: number;

    const allIssueIds: number[] = [];
    const allCaseIds: number[] = [];
    let repositoryCaseIssueLinkCount = 0;

    let unrestricted: RequirementTraceabilityData;
    let restricted: RequirementTraceabilityData;
    let scopedToMid: RequirementTraceabilityData;
    let coverageIndependent: Awaited<ReturnType<typeof getRequirementCoverage>>;

    beforeAll(async () => {
      // Refuse to run against anything but a scratch database — the
      // worktree .env DATABASE_URL resolves to the real, shared dev
      // database, and this suite writes and tears down fixture rows.
      const [{ current_database: dbName }] = await db.$queryRaw<
        Array<{ current_database: string }>
      >`SELECT current_database()`;
      if (dbName !== "tpi_req20" && dbName !== "tpi_test") {
        throw new Error(
          `refusing to run against database "${dbName}" — this suite only runs against the tpi_req20 scratch DB (or tpi_test in CI)`
        );
      }

      const role = await db.roles.findFirst({
        where: { isDefault: true, isDeleted: false },
      });
      if (!role) throw new Error("Test prerequisite: no default role row");

      const admin = await db.user.create({
        data: {
          email: `${STAMP}-admin@example.com`,
          name: `Traceability Export Admin ${STAMP}`,
          authMethod: "INTERNAL",
          access: "ADMIN",
          accessSource: "MANUAL",
          roleId: role.id,
          password: "$2a$10$placeholderplaceholderplaceholderplaceholder",
        },
        select: { id: true },
      });
      adminUserId = admin.id;

      const projectOne = await db.projects.create({
        data: { name: `${STAMP}-project-one`, createdBy: adminUserId },
        select: { id: true },
      });
      projectOneId = projectOne.id;

      const repositoryOne = await db.repositories.create({
        data: { projectId: projectOneId },
        select: { id: true },
      });
      repositoryOneId = repositoryOne.id;

      const folderOne = await db.repositoryFolders.create({
        data: {
          name: `${STAMP}-folder-one`,
          repositoryId: repositoryOneId,
          projectId: projectOneId,
          creatorId: adminUserId,
        },
        select: { id: true },
      });
      folderOneId = folderOne.id;

      const projectTwo = await db.projects.create({
        data: { name: `${STAMP}-project-two`, createdBy: adminUserId },
        select: { id: true },
      });
      projectTwoId = projectTwo.id;

      const repositoryTwo = await db.repositories.create({
        data: { projectId: projectTwoId },
        select: { id: true },
      });
      repositoryTwoId = repositoryTwo.id;

      const folderTwo = await db.repositoryFolders.create({
        data: {
          name: `${STAMP}-folder-two`,
          repositoryId: repositoryTwoId,
          projectId: projectTwoId,
          creatorId: adminUserId,
        },
        select: { id: true },
      });
      folderTwoId = folderTwo.id;

      // Global catalogs — reused rather than created, matching this
      // repository's other fixture chains. No test-run/result rows are
      // needed here: this plan's behaviors are about row counts, gap
      // rows, cross-project exclusion, and path hierarchy — never about
      // a case's latest execution status (that is 26-03's own suite).
      const template = await db.templates.findFirst({ select: { id: true } });
      if (!template)
        throw new Error("Test prerequisite: no Templates row available");
      const caseWorkflow = await db.workflows.findFirst({
        where: { scope: "CASES", isDeleted: false, isEnabled: true },
        select: { id: true },
      });
      if (!caseWorkflow)
        throw new Error(
          "Test prerequisite: no CASES-scoped Workflows row available"
        );

      templateId = template.id;
      caseStateId = caseWorkflow.id;

      async function createNode(
        name: string,
        projectId: number,
        parentId: number | null
      ) {
        const issue = await db.issue.create({
          data: {
            name: `${STAMP}-${name}`,
            title: `${STAMP}-${name} title`,
            createdById: adminUserId,
            projectId,
            parentId,
            isRequirement: true,
          },
          select: { id: true },
        });
        allIssueIds.push(issue.id);
        return issue.id;
      }

      async function createCase(
        name: string,
        projectId: number,
        repositoryId: number,
        folderId: number,
        overrides: Record<string, unknown> = {}
      ) {
        const testCase = await db.repositoryCases.create({
          data: {
            projectId,
            repositoryId,
            folderId,
            templateId,
            name: `${STAMP}-${name}`,
            stateId: caseStateId,
            creatorId: adminUserId,
            ...overrides,
          },
          select: { id: true },
        });
        allCaseIds.push(testCase.id);
        return testCase.id;
      }

      reqAId = await createNode("req-a", projectOneId, null);
      reqBId = await createNode("req-b", projectOneId, null);
      reqCId = await createNode("req-c", projectOneId, null);
      reqRootId = await createNode("req-root", projectOneId, null);
      reqMidId = await createNode("req-mid", projectOneId, reqRootId);
      reqLeafId = await createNode("req-leaf", projectOneId, reqMidId);

      caseA1Id = await createCase(
        "case-a1",
        projectOneId,
        repositoryOneId,
        folderOneId
      );
      caseA2Id = await createCase(
        "case-a2",
        projectOneId,
        repositoryOneId,
        folderOneId
      );
      caseOtherProjectId = await createCase(
        "case-other-project",
        projectTwoId,
        repositoryTwoId,
        folderTwoId
      );
      caseDeletedId = await createCase(
        "case-deleted",
        projectOneId,
        repositoryOneId,
        folderOneId,
        { isDeleted: true, deletedAt: new Date() }
      );
      caseLeafId = await createCase(
        "case-leaf",
        projectOneId,
        repositoryOneId,
        folderOneId
      );

      const links = [
        { caseId: caseA1Id, issueId: reqAId },
        { caseId: caseA2Id, issueId: reqAId },
        // The cross-project link: caseOtherProject lives in projectTwo but
        // covers reqA in projectOne. Nothing in the link table forbids
        // this pairing — enforcing the boundary is entirely on the query.
        { caseId: caseOtherProjectId, issueId: reqAId },
        // reqC's only link is to a soft-deleted case — it must still read
        // as uncovered, not merely "has no link row at all" like reqB.
        { caseId: caseDeletedId, issueId: reqCId },
        { caseId: caseLeafId, issueId: reqLeafId },
      ];
      await db.repositoryCaseIssue.createMany({ data: links });
      repositoryCaseIssueLinkCount = links.length;

      unrestricted = await loadRequirementTraceability(
        projectOneId,
        { accessibleProjectIds: null },
        db
      );
      restricted = await loadRequirementTraceability(
        projectOneId,
        { accessibleProjectIds: [projectOneId] },
        db
      );
      // The root-scoped variant, anchored mid-chain: membership must be
      // reqMid + reqLeaf only, and the scoped rollup must still inherit
      // reqLeaf's case up to reqMid through the bounded closure.
      scopedToMid = await loadRequirementTraceability(
        projectOneId,
        { accessibleProjectIds: null },
        db,
        { rootIds: [reqMidId] }
      );
      coverageIndependent = await getRequirementCoverage(
        projectOneId,
        { accessibleProjectIds: null },
        undefined,
        db
      );
    });

    afterAll(async () => {
      await db.repositoryCaseIssue.deleteMany({
        where: { caseId: { in: allCaseIds } },
      });
      await db.repositoryCases.deleteMany({
        where: { id: { in: allCaseIds } },
      });
      await db.issue.deleteMany({ where: { id: { in: allIssueIds } } });
      await db.repositoryFolders.delete({ where: { id: folderOneId } });
      await db.repositoryFolders.delete({ where: { id: folderTwoId } });
      await db.repositories.delete({ where: { id: repositoryOneId } });
      await db.repositories.delete({ where: { id: repositoryTwoId } });
      await db.projects.delete({ where: { id: projectOneId } });
      await db.projects.delete({ where: { id: projectTwoId } });
      await db.user.delete({ where: { id: adminUserId } });

      const remainingIssues = await db.issue.count({
        where: { name: { startsWith: STAMP } },
      });
      const remainingCases = await db.repositoryCases.count({
        where: { name: { startsWith: STAMP } },
      });
      const remainingProjects = await db.projects.count({
        where: { name: { startsWith: STAMP } },
      });
      expect(remainingIssues).toBe(0);
      expect(remainingCases).toBe(0);
      expect(remainingProjects).toBe(0);
      console.log(
        `post-teardown stamp check (${STAMP}): issues=${remainingIssues}, cases=${remainingCases}, projects=${remainingProjects}`
      );

      await db.$disconnect();
    });

    it("the fixture is not vacuous", async () => {
      // Assert the fixture BEFORE asserting behaviour: the requirements
      // created, the RepositoryCaseIssue rows created, and the uncovered
      // set independently via getRequirementCoverage — each checked
      // against the number this suite intended, not merely against
      // whatever the loader under test happens to report.
      expect(allIssueIds).toHaveLength(6);
      expect(repositoryCaseIssueLinkCount).toBe(5);

      const directLinkCount = await db.repositoryCaseIssue.count({
        where: { issueId: { in: allIssueIds } },
      });
      expect(directLinkCount).toBe(5);

      expect(coverageIndependent.get(reqAId)?.linkedCaseCount).toBe(3);
      expect(coverageIndependent.get(reqBId)?.linkedCaseCount).toBe(0);
      expect(coverageIndependent.get(reqCId)?.linkedCaseCount).toBe(0);
      expect(coverageIndependent.get(reqLeafId)?.linkedCaseCount).toBe(1);
      // reqMid and reqRoot inherit reqLeaf's one case through the subtree
      // walk — a real depth-2 nested requirement whose path names every
      // ancestor, not a synthetic id with no data beneath it.
      expect(coverageIndependent.get(reqMidId)?.linkedCaseCount).toBe(1);
      expect(coverageIndependent.get(reqRootId)?.linkedCaseCount).toBe(1);

      const uncoveredIds = [...coverageIndependent.entries()]
        .filter(([, breakdown]) => breakdown.uncovered)
        .map(([id]) => id)
        .sort((a, b) => a - b);
      expect(uncoveredIds).toEqual([reqBId, reqCId].sort((a, b) => a - b));
    });

    it("produces one row per requirement and covering case for a real hierarchy", async () => {
      // reqA: 3 rows (caseA1, caseA2, caseOtherProject). reqB: 1 gap row.
      // reqC: 1 gap row (soft-deleted link excluded). reqRoot/reqMid/reqLeaf:
      // 1 row each (the single inherited/leaf case). Total = 3+1+1+1+1+1 = 8.
      expect(unrestricted.rows).toHaveLength(8);

      const rowsByRequirement = new Map<number, number>();
      for (const row of unrestricted.rows) {
        rowsByRequirement.set(
          row.requirementId,
          (rowsByRequirement.get(row.requirementId) ?? 0) + 1
        );
      }
      expect(rowsByRequirement.get(reqAId)).toBe(3);
      expect(rowsByRequirement.get(reqBId)).toBe(1);
      expect(rowsByRequirement.get(reqCId)).toBe(1);
      expect(rowsByRequirement.get(reqRootId)).toBe(1);
      expect(rowsByRequirement.get(reqMidId)).toBe(1);
      expect(rowsByRequirement.get(reqLeafId)).toBe(1);

      // Every requirement in the project appears at least once, including
      // leaves with nothing beneath them (reqLeaf, reqA, reqB, reqC all
      // have no children).
      const distinctRequirementIds = new Set(rowsByRequirement.keys());
      for (const id of allIssueIds) {
        expect(distinctRequirementIds.has(id)).toBe(true);
      }

      // The nested chain's path names every ancestor in order.
      const leafRow = unrestricted.rows.find(
        (row) => row.requirementId === reqLeafId
      );
      expect(leafRow?.requirementPath.split(" > ")).toHaveLength(3);
    });

    it("confines a root-scoped load to the subtree, with paths and rollup intact", async () => {
      // Membership: reqMid and reqLeaf only. reqRoot (the scoped root's
      // own parent) and the three standalone requirements must not appear.
      const scopedIds = new Set(
        scopedToMid.rows.map((row) => row.requirementId)
      );
      expect([...scopedIds].sort((a, b) => a - b)).toEqual(
        [reqMidId, reqLeafId].sort((a, b) => a - b)
      );

      // One covering-case row each: reqLeaf's direct link, inherited by
      // reqMid through the bounded closure — proving the scoped rollup
      // still walks the subtree rather than counting only direct links.
      expect(scopedToMid.rows).toHaveLength(2);
      const midRow = scopedToMid.rows.find(
        (row) => row.requirementId === reqMidId
      );
      expect(midRow?.linkedCaseCount).toBe(1);
      expect(midRow?.caseId).not.toBeNull();

      // Paths are relative to the scoped root: the excluded ancestor
      // (reqRoot) contributes no segment.
      const leafRow = scopedToMid.rows.find(
        (row) => row.requirementId === reqLeafId
      );
      expect(midRow?.requirementPath.split(" > ")).toHaveLength(1);
      expect(leafRow?.requirementPath.split(" > ")).toHaveLength(2);

      // A scope list resolving to nothing produces an empty matrix, not an
      // error and not a whole-project fallback.
      const scopedToNothing = await loadRequirementTraceability(
        projectOneId,
        { accessibleProjectIds: null },
        db,
        { rootIds: [999999999] }
      );
      expect(scopedToNothing.rows).toEqual([]);
    });

    it("produces exactly one null-case row per uncovered requirement", async () => {
      const nullCaseRows = unrestricted.rows.filter(
        (row) => row.caseId === null
      );
      expect(nullCaseRows).toHaveLength(2);
      const nullCaseRequirementIds = nullCaseRows
        .map((row) => row.requirementId)
        .sort((a, b) => a - b);
      expect(nullCaseRequirementIds).toEqual(
        [reqBId, reqCId].sort((a, b) => a - b)
      );
      // Both are greater than zero as a set, i.e. not a vacuous fixture
      // where every requirement happens to be covered.
      expect(nullCaseRows.length).toBeGreaterThan(0);
    });

    it("excludes cases in projects outside the viewer scope", async () => {
      const crossProjectRowUnrestricted = unrestricted.rows.find(
        (row) => row.caseId === caseOtherProjectId
      );
      expect(crossProjectRowUnrestricted).toBeDefined();
      expect(crossProjectRowUnrestricted?.caseProjectId).toBe(projectTwoId);

      const crossProjectRowRestricted = restricted.rows.find(
        (row) => row.caseId === caseOtherProjectId
      );
      expect(crossProjectRowRestricted).toBeUndefined();

      const restrictedReqARows = restricted.rows.filter(
        (row) => row.requirementId === reqAId
      );
      expect(restrictedReqARows).toHaveLength(2);
      expect(restricted.rows).toHaveLength(7);
    });

    it("agrees with getRequirementCoverage on which requirements are uncovered", async () => {
      const nullCaseRequirementIds = new Set(
        unrestricted.rows
          .filter((row) => row.caseId === null)
          .map((row) => row.requirementId)
      );
      const rollupUncoveredIds = new Set(
        [...coverageIndependent.entries()]
          .filter(([, breakdown]) => breakdown.uncovered)
          .map(([id]) => id)
      );

      expect(nullCaseRequirementIds).toEqual(rollupUncoveredIds);
      expect(nullCaseRequirementIds.size).toBeGreaterThan(0);
    });
  }
);
