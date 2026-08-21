// Live-DB integration proof for the requirement coverage rollup
// (COV-01/COV-02/COV-03). The rollup's recursive walk through a
// requirement's whole subtree, its case-linking dedup, and its
// accessible-project scope gating can only be proven against real
// Postgres recursion and real joined rows — a mocked query client would
// prove nothing about the actual SQL shape.
//
// Run via (never against the default .env DATABASE_URL — that resolves to
// `ew`; always pass the scratch tpi_req20 URL explicitly):
//   BASE = .env DATABASE_URL with /ew?schema=public replaced by
//   /tpi_req20?schema=public
//   DATABASE_URL="$BASE" RUN_DB_INTEGRATION=1 pnpm exec vitest run \
//     __tests__/integration/requirement-coverage-rollup.integration.test.ts
//
// This suite must never inherit the worktree's own .env: that file's
// DATABASE_URL resolves to the real, shared dev database, which holds
// real classified requirement rows and may back a running dev server —
// running fixture writes and a rollup proof against it would corrupt
// live data and produce results that don't reflect a clean scratch state.
// The current_database() guard in beforeAll below refuses to proceed
// against anything but the scratch database, whatever DATABASE_URL a
// caller supplies.
//
// PROOF DESIGN — why an obvious, symmetric fixture would prove nothing: a
// tree where every case is linked directly to the requirement that covers
// it would pass under a query that double-counts, one that stops
// descending at the first node without the shared role, one that patches
// missing rows in application code, and one that forgets the viewer's
// project boundary — every broken variant looks identical on a fixture
// with no ancestor/descendant overlap, no non-requirement node sitting
// between two requirements, no requirement that is absent everywhere, no
// soft-deleted or archived-only case, no cross-run "latest", and no
// cross-project link. Each node and case below exists to make exactly one
// of those mistakes produce its own distinct, wrong number.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createRawDbClient } from "~/lib/rawDbClient";
import {
  getRequirementCoverage,
  getRequirementCoveringCases,
} from "~/lib/services/requirementCoverage";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

const db = createRawDbClient();
// Run-scoped stamp for fixture naming, keeping concurrent runs' rows
// distinguishable and scoping the post-teardown cleanliness check below.
const STAMP = `rc-${Date.now()}`;

describeIntegration(
  "requirement coverage rollup (live DB, COV-01/COV-02/COV-03)",
  () => {
    let adminUserId: string;
    let projectOneId: number;
    let projectTwoId: number;
    let projectTwoName: string;

    let repositoryOneId: number;
    let folderOneId: number;
    let repositoryTwoId: number;
    let folderTwoId: number;

    let templateId: number;
    let caseStateId: number;
    let runStateId: number;
    let passingStatusId: number;
    let failingStatusId: number;

    // The primary tree: a requirement whose own child is also a
    // requirement, reached only through an intermediate node that
    // deliberately does not carry the shared role — plus four standalone
    // requirements, each built to expose one specific way the rollup could
    // be wrong.
    let reqRootId: number;
    let storyMidId: number;
    let reqChildId: number;
    let reqGapId: number;
    let reqDeletedId: number;
    let reqArchivedId: number;
    let reqLatestId: number;

    let caseSharedId: number;
    let caseUnderStoryId: number;
    let casePassingId: number;
    let caseFailingId: number;
    let caseDeletedId: number;
    let caseArchivedId: number;
    let caseTwoRunsId: number;

    // The second project: a requirement of its own (the isolation control)
    // plus a case that lives here but is linked back into reqRoot in the
    // first project — nothing in the link table forbids that pairing, so
    // enforcing the boundary is entirely on the query.
    let reqOtherProjectId: number;
    let caseOtherProjectId: number;
    let caseOwnProjectTwoId: number;

    const allIssueIds: number[] = [];
    const allCaseIds: number[] = [];
    const allRunIds: number[] = [];

    let unrestrictedCoverage: Awaited<
      ReturnType<typeof getRequirementCoverage>
    >;
    let scopedCoverage: Awaited<ReturnType<typeof getRequirementCoverage>>;
    let projectTwoCoverage: Awaited<ReturnType<typeof getRequirementCoverage>>;
    let unrestrictedCovering: Awaited<
      ReturnType<typeof getRequirementCoveringCases>
    >;
    let scopedCovering: Awaited<ReturnType<typeof getRequirementCoveringCases>>;

    beforeAll(async () => {
      // Refuse to run against anything but a scratch database — the
      // worktree .env DATABASE_URL resolves to the real, shared dev
      // database, and this suite's converting plan will write and tear
      // down fixture rows.
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
          name: `Coverage Rollup Admin ${STAMP}`,
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
        select: { id: true, name: true },
      });
      projectTwoId = projectTwo.id;
      projectTwoName = projectTwo.name;

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
      // repository's other fixture chains.
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
      const runWorkflow = await db.workflows.findFirst({
        where: { scope: "RUNS", isDeleted: false, isEnabled: true },
        select: { id: true },
      });
      if (!runWorkflow)
        throw new Error(
          "Test prerequisite: no RUNS-scoped Workflows row available"
        );
      // Looked up by their boolean columns, never by name or system name —
      // these are admin-configurable rows, not a hardcoded enum.
      const passingStatus = await db.status.findFirst({
        where: { isSuccess: true, isDeleted: false },
        select: { id: true },
      });
      if (!passingStatus)
        throw new Error(
          "Test prerequisite: no Status row with isSuccess = true"
        );
      const failingStatus = await db.status.findFirst({
        where: { isFailure: true, isDeleted: false },
        select: { id: true },
      });
      if (!failingStatus)
        throw new Error(
          "Test prerequisite: no Status row with isFailure = true"
        );

      templateId = template.id;
      caseStateId = caseWorkflow.id;
      runStateId = runWorkflow.id;
      passingStatusId = passingStatus.id;
      failingStatusId = failingStatus.id;

      async function createNode(
        name: string,
        projectId: number,
        parentId: number | null,
        hasSharedRole: boolean
      ) {
        const issue = await db.issue.create({
          data: {
            name: `${STAMP}-${name}`,
            title: `${STAMP}-${name}`,
            createdById: adminUserId,
            projectId,
            parentId,
            isRequirement: hasSharedRole,
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

      async function recordExecution(
        runId: number,
        repositoryCaseId: number,
        statusId: number,
        executedAt: Date
      ) {
        const runCase = await db.testRunCases.create({
          data: { testRunId: runId, repositoryCaseId },
          select: { id: true },
        });
        await db.testRunResults.create({
          data: {
            testRunId: runId,
            testRunCaseId: runCase.id,
            statusId,
            executedById: adminUserId,
            executedAt,
          },
        });
      }

      // The primary tree. reqChild is reached only through storyMid, a
      // node that deliberately does not carry the shared role — the
      // asymmetry a rollup that scopes its descendant walk the same way as
      // its anchor would silently break through.
      reqRootId = await createNode("req-root", projectOneId, null, true);
      storyMidId = await createNode(
        "story-mid",
        projectOneId,
        reqRootId,
        false
      );
      reqChildId = await createNode(
        "req-child",
        projectOneId,
        storyMidId,
        true
      );
      reqGapId = await createNode("req-gap", projectOneId, null, true);
      reqDeletedId = await createNode("req-deleted", projectOneId, null, true);
      reqArchivedId = await createNode(
        "req-archived",
        projectOneId,
        null,
        true
      );
      reqLatestId = await createNode("req-latest", projectOneId, null, true);

      // caseShared is linked at both reqRoot AND reqChild — the same case,
      // two link rows, one ancestor total if de-duplication is real.
      caseSharedId = await createCase(
        "case-shared",
        projectOneId,
        repositoryOneId,
        folderOneId
      );
      // caseUnderStory is linked ONLY to the intermediate node — it must
      // still roll up to reqRoot.
      caseUnderStoryId = await createCase(
        "case-under-story",
        projectOneId,
        repositoryOneId,
        folderOneId
      );
      casePassingId = await createCase(
        "case-passing",
        projectOneId,
        repositoryOneId,
        folderOneId
      );
      caseFailingId = await createCase(
        "case-failing",
        projectOneId,
        repositoryOneId,
        folderOneId
      );
      caseDeletedId = await createCase(
        "case-deleted",
        projectOneId,
        repositoryOneId,
        folderOneId,
        { isDeleted: true, deletedAt: new Date() }
      );
      caseArchivedId = await createCase(
        "case-archived",
        projectOneId,
        repositoryOneId,
        folderOneId,
        { isArchived: true }
      );
      caseTwoRunsId = await createCase(
        "case-two-runs",
        projectOneId,
        repositoryOneId,
        folderOneId
      );

      await db.repositoryCaseIssue.createMany({
        data: [
          { caseId: caseSharedId, issueId: reqRootId },
          { caseId: caseSharedId, issueId: reqChildId },
          { caseId: caseUnderStoryId, issueId: storyMidId },
          { caseId: casePassingId, issueId: reqChildId },
          { caseId: caseFailingId, issueId: reqChildId },
          { caseId: caseDeletedId, issueId: reqDeletedId },
          { caseId: caseArchivedId, issueId: reqArchivedId },
          { caseId: caseTwoRunsId, issueId: reqLatestId },
        ],
      });

      const runMain = await db.testRuns.create({
        data: {
          projectId: projectOneId,
          name: `${STAMP}-run-main`,
          stateId: runStateId,
          createdById: adminUserId,
        },
        select: { id: true },
      });
      allRunIds.push(runMain.id);

      const now = new Date();
      await recordExecution(runMain.id, caseSharedId, passingStatusId, now);
      await recordExecution(runMain.id, caseUnderStoryId, passingStatusId, now);
      await recordExecution(runMain.id, casePassingId, passingStatusId, now);
      await recordExecution(runMain.id, caseFailingId, failingStatusId, now);

      // caseTwoRuns: an older execution that failed, in one run, and a
      // newer one that passed, in a different run — the case's single
      // latest result must be the newer, passing one.
      const runOld = await db.testRuns.create({
        data: {
          projectId: projectOneId,
          name: `${STAMP}-run-old`,
          stateId: runStateId,
          createdById: adminUserId,
        },
        select: { id: true },
      });
      allRunIds.push(runOld.id);
      const runNew = await db.testRuns.create({
        data: {
          projectId: projectOneId,
          name: `${STAMP}-run-new`,
          stateId: runStateId,
          createdById: adminUserId,
        },
        select: { id: true },
      });
      allRunIds.push(runNew.id);

      const executedAtOld = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const executedAtNew = now;
      await recordExecution(
        runOld.id,
        caseTwoRunsId,
        failingStatusId,
        executedAtOld
      );
      await recordExecution(
        runNew.id,
        caseTwoRunsId,
        passingStatusId,
        executedAtNew
      );

      // The second project. reqOtherProject is its own independent
      // requirement (the isolation control); caseOtherProject lives here
      // too but its ONE link is back into reqRoot in the first project.
      reqOtherProjectId = await createNode(
        "req-other-project",
        projectTwoId,
        null,
        true
      );
      caseOtherProjectId = await createCase(
        "case-other-project",
        projectTwoId,
        repositoryTwoId,
        folderTwoId
      );
      caseOwnProjectTwoId = await createCase(
        "case-own-project-two",
        projectTwoId,
        repositoryTwoId,
        folderTwoId
      );

      await db.repositoryCaseIssue.createMany({
        data: [
          { caseId: caseOtherProjectId, issueId: reqRootId },
          { caseId: caseOwnProjectTwoId, issueId: reqOtherProjectId },
        ],
      });

      const runProjectTwo = await db.testRuns.create({
        data: {
          projectId: projectTwoId,
          name: `${STAMP}-run-project-two`,
          stateId: runStateId,
          createdById: adminUserId,
        },
        select: { id: true },
      });
      allRunIds.push(runProjectTwo.id);

      // caseOtherProject's own execution fails — the viewer's visibility
      // scope has a consequence on the failed count, not only on the total.
      await recordExecution(
        runProjectTwo.id,
        caseOtherProjectId,
        failingStatusId,
        now
      );
      await recordExecution(
        runProjectTwo.id,
        caseOwnProjectTwoId,
        passingStatusId,
        now
      );

      unrestrictedCoverage = await getRequirementCoverage(
        projectOneId,
        { accessibleProjectIds: null },
        undefined,
        db
      );
      scopedCoverage = await getRequirementCoverage(
        projectOneId,
        { accessibleProjectIds: [projectOneId] },
        undefined,
        db
      );
      projectTwoCoverage = await getRequirementCoverage(
        projectTwoId,
        { accessibleProjectIds: null },
        undefined,
        db
      );
      unrestrictedCovering = await getRequirementCoveringCases(
        projectOneId,
        [reqRootId],
        { accessibleProjectIds: null },
        db
      );
      scopedCovering = await getRequirementCoveringCases(
        projectOneId,
        [reqRootId],
        { accessibleProjectIds: [projectOneId] },
        db
      );
    });

    afterAll(async () => {
      await db.testRunResults.deleteMany({
        where: { testRunId: { in: allRunIds } },
      });
      await db.testRunCases.deleteMany({
        where: { testRunId: { in: allRunIds } },
      });
      await db.testRuns.deleteMany({ where: { id: { in: allRunIds } } });
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
      console.log(
        `post-teardown stamp check (${STAMP}): issues=${remainingIssues}, cases=${remainingCases}`
      );

      await db.$disconnect();
    });

    it("a case linked at both a parent and a descendant counts once toward the parent", async () => {
      const subtreeNodeIds = [reqRootId, storyMidId, reqChildId];
      const links = await db.repositoryCaseIssue.findMany({
        where: { issueId: { in: subtreeNodeIds } },
        select: { caseId: true },
      });
      const rawLinkRowCount = links.length;
      const distinctCaseCount = new Set(links.map((link) => link.caseId)).size;
      const rollupLinkedCount =
        unrestrictedCoverage.get(reqRootId)?.linkedCaseCount;

      expect(
        rollupLinkedCount,
        `reqRoot's linkedCaseCount (${rollupLinkedCount}) must equal the distinct covering-case count (${distinctCaseCount}) computed directly from the link table; raw link rows beneath it = ${rawLinkRowCount}`
      ).toBe(distinctCaseCount);
      expect(
        rawLinkRowCount,
        `raw link-row count beneath reqRoot (${rawLinkRowCount}) must exceed the distinct case count (${distinctCaseCount}) — otherwise the two matching would be a coincidence, not proof of de-duplication`
      ).toBeGreaterThan(distinctCaseCount);
    });

    it("a requirement with no linked cases anywhere in its subtree returns as an explicit gap row", async () => {
      expect(
        unrestrictedCoverage.has(reqGapId),
        "reqGap must be a present key in the coverage map, not an absent one"
      ).toBe(true);
      const gap = unrestrictedCoverage.get(reqGapId)!;
      expect(gap.linkedCaseCount).toBe(0);
      expect(gap.uncovered).toBe(true);
      expect(gap.status).toBe("UNCOVERED");
    });

    it("one failed covering case makes the whole requirement FAILED", async () => {
      const child = unrestrictedCoverage.get(reqChildId)!;
      expect(child.linkedCaseCount).toBe(3);
      expect(child.failed).toBe(1);
      expect(child.passed).toBeGreaterThan(0);
      expect(child.status).toBe("FAILED");
    });

    it("a case linked only to a non-requirement intermediate node still rolls up to the ancestor requirement", async () => {
      const rootCovering = unrestrictedCovering.get(reqRootId) ?? [];
      expect(
        rootCovering.some((entry) => entry.caseId === caseUnderStoryId)
      ).toBe(true);
      expect(unrestrictedCoverage.has(storyMidId)).toBe(false);
    });

    it("a soft-deleted or archived case does not cover a requirement", async () => {
      const deleted = unrestrictedCoverage.get(reqDeletedId)!;
      expect(deleted.linkedCaseCount).toBe(0);
      expect(deleted.uncovered).toBe(true);
      expect(deleted.status).toBe("UNCOVERED");

      const archived = unrestrictedCoverage.get(reqArchivedId)!;
      expect(archived.linkedCaseCount).toBe(0);
      expect(archived.uncovered).toBe(true);
      expect(archived.status).toBe("UNCOVERED");
    });

    it("the latest result is the most recent execution across every run", async () => {
      const latest = unrestrictedCoverage.get(reqLatestId)!;
      expect(latest.linkedCaseCount).toBe(1);
      expect(latest.passed).toBe(1);
      expect(latest.failed).toBe(0);
      expect(latest.status).toBe("PASSED");
    });

    it("cases in another project count and are reported separately as cross-project", async () => {
      const root = unrestrictedCoverage.get(reqRootId)!;
      expect(root.crossProjectCaseCount).toBe(1);
      expect(root.linkedCaseCount).toBeGreaterThan(root.crossProjectCaseCount);

      // A requirement whose covering cases are all local proves the counter
      // discriminates rather than being a constant.
      const child = unrestrictedCoverage.get(reqChildId)!;
      expect(child.linkedCaseCount).toBeGreaterThan(0);
      expect(child.crossProjectCaseCount).toBe(0);
    });

    it("a viewer's accessible project scope excludes cases from projects they cannot read", async () => {
      const rootUnrestricted = unrestrictedCoverage.get(reqRootId)!;
      const rootScoped = scopedCoverage.get(reqRootId)!;

      expect(
        rootUnrestricted.linkedCaseCount - rootScoped.linkedCaseCount,
        `unrestricted total (${rootUnrestricted.linkedCaseCount}) minus scoped total (${rootScoped.linkedCaseCount}) must be exactly 1 — the one case living outside the viewer's accessible projects`
      ).toBe(1);
      expect(rootScoped.crossProjectCaseCount).toBe(0);
      expect(
        rootUnrestricted.failed - rootScoped.failed,
        `unrestricted failed (${rootUnrestricted.failed}) minus scoped failed (${rootScoped.failed}) must be exactly 1 — the excluded case's own execution failed`
      ).toBe(1);
      // The excluded case's failure was never the requirement's ONLY
      // failure — an independent, same-project failing case (proven by
      // "one failed covering case makes the whole requirement FAILED"
      // above) already holds this requirement at FAILED before and after
      // the scope narrows. Asserting the status stays FAILED here, with
      // the failed counter dropping by exactly one and not two, is a
      // stronger correctness proof than a bare status flip would be: an
      // implementation that over-filters and also drops the in-project
      // failing case would move failed from 2 to 0 and incorrectly report
      // PASSED, which this assertion would catch.
      expect(rootUnrestricted.status).toBe("FAILED");
      expect(rootScoped.status).toBe("FAILED");

      // Every OTHER requirement's breakdown must be byte-identical between
      // the two calls — a scope that changes anything beyond the
      // cross-project contribution is over-filtering.
      for (const id of [
        reqChildId,
        reqGapId,
        reqDeletedId,
        reqArchivedId,
        reqLatestId,
      ]) {
        expect(scopedCoverage.get(id)).toEqual(unrestrictedCoverage.get(id));
      }
    });

    it("a requirement in another project never appears in a project-scoped rollup", async () => {
      expect(unrestrictedCoverage.has(reqOtherProjectId)).toBe(false);
      expect(scopedCoverage.has(reqOtherProjectId)).toBe(false);

      const other = projectTwoCoverage.get(reqOtherProjectId)!;
      expect(other.linkedCaseCount).toBe(1);
      expect(other.crossProjectCaseCount).toBe(0);
      expect(other.passed).toBe(1);
      expect(other.failed).toBe(0);
      expect(other.status).toBe("PASSED");
    });

    it("covering-case drill-down returns each case's project so a cross-project case can be badged", async () => {
      const rootUnrestricted = unrestrictedCovering.get(reqRootId) ?? [];
      const crossEntry = rootUnrestricted.find(
        (entry) => entry.caseId === caseOtherProjectId
      );
      expect(crossEntry).toBeDefined();
      expect(crossEntry?.projectId).toBe(projectTwoId);
      expect(crossEntry?.projectName).toBe(projectTwoName);
      expect(rootUnrestricted.length).toBe(
        unrestrictedCoverage.get(reqRootId)!.linkedCaseCount
      );

      const rootScoped = scopedCovering.get(reqRootId) ?? [];
      expect(
        rootScoped.some((entry) => entry.caseId === caseOtherProjectId)
      ).toBe(false);
      expect(rootScoped.length).toBe(
        scopedCoverage.get(reqRootId)!.linkedCaseCount
      );
    });
  }
);
