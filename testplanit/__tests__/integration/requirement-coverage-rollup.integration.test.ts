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
import { getAuthDb } from "~/lib/zenstack";

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
    let passingStatusName: string;
    let passingStatusColor: string | null;
    let failingStatusId: number;
    let failingStatusName: string;
    let failingStatusColor: string | null;
    // A neutral COMPLETED status (isSuccess = false, isFailure = false) —
    // used ONLY by a cross-project case (caseSkippedCrossId below) so its
    // whole status entry, not merely its count, must vanish from a
    // project-scoped rollup (COV-07 item 6's strongest disclosure proof).
    let skippedStatusId: number;
    let skippedStatusName: string;
    let skippedStatusColor: string | null;
    // The shipped system "Untested" status. Ships with isCompleted = false,
    // under which it is already excluded from status_rollup via the
    // is_completed filter alone — see the beforeAll comment at the flip
    // site below for why this suite temporarily marks it completed anyway.
    let untestedStatusId: number;
    let untestedStatusOriginalIsCompleted: boolean;

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
    // COV-07 item 4: a requirement whose ONLY covering cases are a
    // system-"untested"-status case and a never-executed case — neither
    // may appear in statuses[], both must land in the explicit `untested`
    // aggregate instead.
    let reqUntestedMixId: number;

    let caseSharedId: number;
    let caseUnderStoryId: number;
    let casePassingId: number;
    let caseFailingId: number;
    let caseDeletedId: number;
    let caseArchivedId: number;
    let caseTwoRunsId: number;
    let caseSystemUntestedId: number;
    let caseNoResultId: number;
    // Linked directly to storyMid (an INHERITED node for reqRoot, not
    // itself a requirement) rather than reqChild, so this case deepens
    // reqRoot's direct/inherited and same/cross-project split without
    // touching reqChild's own anchor closure at all — reqChild's closure
    // never walks upward through its own ancestor storyMid.
    let caseSkippedCrossId: number;

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
      // these are admin-configurable rows, not a hardcoded enum. Name and
      // color are selected too so the statuses[] assertions below can
      // compare against the REAL joined values, not a name this suite
      // invented.
      const passingStatus = await db.status.findFirst({
        where: { isSuccess: true, isDeleted: false },
        select: { id: true, name: true, color: { select: { value: true } } },
      });
      if (!passingStatus)
        throw new Error(
          "Test prerequisite: no Status row with isSuccess = true"
        );
      const failingStatus = await db.status.findFirst({
        where: { isFailure: true, isDeleted: false },
        select: { id: true, name: true, color: { select: { value: true } } },
      });
      if (!failingStatus)
        throw new Error(
          "Test prerequisite: no Status row with isFailure = true"
        );
      // A completed, neutral (neither success nor failure) status — the
      // shipped "Skipped" status fits (isCompleted = true, isSuccess =
      // false, isFailure = false). Looked up by its three booleans plus
      // systemName as a last-resort discriminator only because no single
      // boolean combination is otherwise unique among shipped statuses.
      const skippedStatus = await db.status.findFirst({
        where: {
          isCompleted: true,
          isSuccess: false,
          isFailure: false,
          isDeleted: false,
        },
        select: { id: true, name: true, color: { select: { value: true } } },
      });
      if (!skippedStatus)
        throw new Error(
          "Test prerequisite: no completed, neutral (non-success, non-failure) Status row available"
        );
      // The shipped system "untested" status — looked up by its unique
      // systemName since, unlike the others above, this test specifically
      // needs THIS row (see the beforeAll comment at the flip site below).
      const untestedStatus = await db.status.findFirst({
        where: { systemName: "untested", isDeleted: false },
        select: { id: true, isCompleted: true },
      });
      if (!untestedStatus)
        throw new Error(
          'Test prerequisite: no Status row with systemName "untested"'
        );

      templateId = template.id;
      caseStateId = caseWorkflow.id;
      runStateId = runWorkflow.id;
      passingStatusId = passingStatus.id;
      passingStatusName = passingStatus.name;
      passingStatusColor = passingStatus.color?.value ?? null;
      failingStatusId = failingStatus.id;
      failingStatusName = failingStatus.name;
      failingStatusColor = failingStatus.color?.value ?? null;
      skippedStatusId = skippedStatus.id;
      skippedStatusName = skippedStatus.name;
      skippedStatusColor = skippedStatus.color?.value ?? null;
      untestedStatusId = untestedStatus.id;
      untestedStatusOriginalIsCompleted = untestedStatus.isCompleted;

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

      // caseSkippedCross lives in project two and is linked directly to
      // storyMid — an INHERITED node from reqRoot's own perspective (depth
      // 1), never touching reqChild's anchor closure. This is what makes
      // reqRoot's direct links "span both projects" (caseShared local,
      // caseOtherProject cross-project) WHILE also inheriting a second,
      // DIFFERENT cross-project case from a descendant — the fixture shape
      // items 1 and 2 below need to tell direct from inherited and total
      // cross-project from direct-cross-project apart. Its status
      // ("Skipped": completed, neither success nor failure) is also the
      // ONLY contributor to that status entry anywhere in the fixture, so
      // excluding project two must make that whole entry vanish, not just
      // shrink (item 6's strongest disclosure proof).
      caseSkippedCrossId = await createCase(
        "case-skipped-cross",
        projectTwoId,
        repositoryTwoId,
        folderTwoId
      );

      // reqUntestedMix: a requirement whose only two covering cases are
      // deliberately unclassifiable — one whose latest result IS the
      // system "untested" status, one with no result at all. Neither may
      // ever appear in statuses[]; both must land in the explicit
      // `untested` aggregate instead (item 4).
      reqUntestedMixId = await createNode(
        "req-untested-mix",
        projectOneId,
        null,
        true
      );
      caseSystemUntestedId = await createCase(
        "case-system-untested",
        projectOneId,
        repositoryOneId,
        folderOneId
      );
      caseNoResultId = await createCase(
        "case-no-result",
        projectOneId,
        repositoryOneId,
        folderOneId
      );

      await db.repositoryCaseIssue.createMany({
        data: [
          { caseId: caseSkippedCrossId, issueId: storyMidId },
          { caseId: caseSystemUntestedId, issueId: reqUntestedMixId },
          { caseId: caseNoResultId, issueId: reqUntestedMixId },
        ],
      });

      await recordExecution(
        runProjectTwo.id,
        caseSkippedCrossId,
        skippedStatusId,
        now
      );
      // caseSystemUntested's own execution is recorded here, using the
      // shipped system "untested" status — the isCompleted flip below only
      // needs to be in effect for the QUERIES, not for this insert.
      await recordExecution(
        runMain.id,
        caseSystemUntestedId,
        untestedStatusId,
        now
      );

      // The shipped "Untested" status ships with isCompleted = false, under
      // which caseSystemUntested's row is ALREADY excluded from
      // status_rollup via the `lr.is_completed = true` half of that CTE's
      // WHERE clause alone — making the systemName='untested' exclusion
      // clause unreachable, and therefore unprovable, with the shipped
      // default. To make that second clause's own contribution to the
      // disclosure boundary independently observable (a mutation to it
      // must be able to fail a test on its own), this globally-shared
      // status row is marked completed for the exact duration of the
      // coverage queries below, then restored immediately after — the
      // ONLY window in this suite where that shared row's isCompleted flag
      // differs from its shipped default.
      await db.status.update({
        where: { id: untestedStatusId },
        data: { isCompleted: true },
      });
      try {
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
      } finally {
        await db.status.update({
          where: { id: untestedStatusId },
          data: { isCompleted: untestedStatusOriginalIsCompleted },
        });
      }
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
      const remainingProjects = await db.projects.count({
        where: { name: { startsWith: STAMP } },
      });
      console.log(
        `post-teardown stamp check (${STAMP}): issues=${remainingIssues}, cases=${remainingCases}, projects=${remainingProjects}`
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
      // Two cross-project cases: caseOtherProject (direct) and
      // caseSkippedCross (inherited via storyMid) — see the item 1/2 tests
      // below for the direct-vs-total split this pair exists to prove.
      expect(root.crossProjectCaseCount).toBe(2);
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
        `unrestricted total (${rootUnrestricted.linkedCaseCount}) minus scoped total (${rootScoped.linkedCaseCount}) must be exactly 2 — the two cases (caseOtherProject, caseSkippedCross) living outside the viewer's accessible projects`
      ).toBe(2);
      expect(rootScoped.crossProjectCaseCount).toBe(0);
      expect(rootScoped.directCrossProjectCaseCount).toBe(0);
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
        reqUntestedMixId,
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

    it("anchors one rollup across several projects, and keeps each subtree inside its own", async () => {
      // The cross-project reports' anchor. Phase 26 carved these out
      // because the closure took a single project id; it now takes a list,
      // and the two properties that make that safe are proven here against
      // real Postgres recursion rather than argued.
      // Both rollups are computed HERE, at the same instant, rather than
      // comparing against a map captured in beforeAll: this file's later
      // blocks attach and detach links, so a stored snapshot would make
      // this test read a mutation as an anchor-width effect.
      const [single, singleTwo, multi] = await Promise.all([
        getRequirementCoverage(projectOneId, { accessibleProjectIds: null }),
        getRequirementCoverage(projectTwoId, { accessibleProjectIds: null }),
        getRequirementCoverage([projectOneId, projectTwoId], {
          accessibleProjectIds: null,
        }),
      ]);

      // 1. Both projects' requirements come back from ONE statement —
      //    neither list is the other's.
      expect(multi.has(reqRootId)).toBe(true);
      expect(multi.has(reqOtherProjectId)).toBe(true);

      // 2. Every requirement still carries its OWN project.
      expect(multi.get(reqRootId)!.projectId).toBe(projectOneId);
      expect(multi.get(reqOtherProjectId)!.projectId).toBe(projectTwoId);

      // 3. Widening the anchor changes no requirement's numbers: a subtree
      //    walk still cannot wander into a project that merely happens to
      //    be in scope now, and "cross-project" is still judged against the
      //    requirement's own project.
      for (const id of [
        reqRootId,
        reqChildId,
        reqGapId,
        reqLatestId,
        reqUntestedMixId,
      ]) {
        expect(multi.get(id)).toEqual(single.get(id));
      }
      expect(multi.get(reqOtherProjectId)).toEqual(
        singleTwo.get(reqOtherProjectId)
      );
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

    // COV-07 (gap-closure plan 26.2-07): statuses[], untested, directCaseCount
    // and directCrossProjectCaseCount, all produced by the same statement
    // the tests above already exercise.

    it("[reqRootId] directCaseCount counts only cases linked directly to the anchor itself, distinct from linkedCaseCount's whole-subtree total", async () => {
      const root = unrestrictedCoverage.get(reqRootId)!;
      // Direct: caseShared and caseOtherProject, both linked straight to
      // reqRoot. Inherited (NOT direct): caseUnderStory (via storyMid),
      // casePassing/caseFailing (via reqChild), caseSkippedCross (via
      // storyMid) — five inherited cases the confused query in the plan's
      // own framing ("min_depth >= 0") would wrongly fold into direct too.
      expect(root.directCaseCount).toBe(2);
      expect(root.linkedCaseCount).toBe(6);
      expect(root.linkedCaseCount).toBeGreaterThan(root.directCaseCount);
    });

    it("[reqRootId] directCrossProjectCaseCount counts only the DIRECT cross-project links, strictly less than the whole-subtree crossProjectCaseCount", async () => {
      const root = unrestrictedCoverage.get(reqRootId)!;
      // caseOtherProject is both direct AND cross-project.
      // caseSkippedCross is cross-project but INHERITED (via storyMid) —
      // it must count toward crossProjectCaseCount but NOT
      // directCrossProjectCaseCount.
      expect(root.directCrossProjectCaseCount).toBe(1);
      expect(root.crossProjectCaseCount).toBe(2);
      expect(root.directCrossProjectCaseCount).toBeLessThan(
        root.crossProjectCaseCount
      );
    });

    it("[reqRootId] statuses[] carries one entry per distinct completed status, with the real Status name/color, ordered by count descending", async () => {
      const root = unrestrictedCoverage.get(reqRootId)!;
      // Passed (3): caseShared, caseUnderStory, casePassing.
      // Failed (2): caseOtherProject, caseFailing.
      // Skipped (1): caseSkippedCross — three distinct statuses, so
      // ordering (3 > 2 > 1) is observable, not a two-item coincidence.
      expect(root.statuses).toEqual([
        {
          statusId: passingStatusId,
          name: passingStatusName,
          color: passingStatusColor,
          count: 3,
        },
        {
          statusId: failingStatusId,
          name: failingStatusName,
          color: failingStatusColor,
          count: 2,
        },
        {
          statusId: skippedStatusId,
          name: skippedStatusName,
          color: skippedStatusColor,
          count: 1,
        },
      ]);
    });

    it("[reqUntestedMixId] a system-untested-status case and a never-executed case both land in `untested`, neither appears in statuses[]", async () => {
      const untestedMix = unrestrictedCoverage.get(reqUntestedMixId)!;
      expect(untestedMix.linkedCaseCount).toBe(2);
      expect(untestedMix.statuses).toEqual([]);
      expect(untestedMix.untested).toBe(2);
      // Neither case's status carries a name equal to the shipped
      // "Untested" status's own name anywhere in statuses[] — belt and
      // suspenders alongside the empty-array check above.
      expect(
        untestedMix.statuses.some(
          (entry) => entry.statusId === untestedStatusId
        )
      ).toBe(false);
    });

    it("untested + sum(statuses[].count) equals linkedCaseCount for every requirement in the fixture", async () => {
      for (const [id, breakdown] of unrestrictedCoverage) {
        const statusesTotal = breakdown.statuses.reduce(
          (sum, entry) => sum + entry.count,
          0
        );
        expect(
          breakdown.untested + statusesTotal,
          `requirement ${id}: untested (${breakdown.untested}) + sum(statuses[].count) (${statusesTotal}) must equal linkedCaseCount (${breakdown.linkedCaseCount})`
        ).toBe(breakdown.linkedCaseCount);
      }
      for (const [id, breakdown] of scopedCoverage) {
        const statusesTotal = breakdown.statuses.reduce(
          (sum, entry) => sum + entry.count,
          0
        );
        expect(
          breakdown.untested + statusesTotal,
          `(scoped) requirement ${id}: untested (${breakdown.untested}) + sum(statuses[].count) (${statusesTotal}) must equal linkedCaseCount (${breakdown.linkedCaseCount})`
        ).toBe(breakdown.linkedCaseCount);
      }
    });

    it("[reqRootId] excluding project two zeroes both cross-project counters and removes every status entry sourced only from that project", async () => {
      const rootUnrestricted = unrestrictedCoverage.get(reqRootId)!;
      const rootScoped = scopedCoverage.get(reqRootId)!;

      expect(rootUnrestricted.crossProjectCaseCount).toBe(2);
      expect(rootUnrestricted.directCrossProjectCaseCount).toBe(1);
      expect(rootScoped.crossProjectCaseCount).toBe(0);
      expect(rootScoped.directCrossProjectCaseCount).toBe(0);

      // Skipped is contributed ONLY by caseSkippedCross (project two) — its
      // whole entry must disappear, not merely shrink, once project two is
      // excluded. A status NAME surviving here from an unreadable project
      // would itself be the disclosure (T-26.2G-07-01).
      const scopedSkipped = rootScoped.statuses.find(
        (entry) => entry.statusId === skippedStatusId
      );
      expect(
        scopedSkipped,
        `scoped statuses[] must not contain the Skipped entry at all, found: ${JSON.stringify(rootScoped.statuses)}`
      ).toBeUndefined();

      // Passed is contributed ONLY by project-one cases (caseShared,
      // caseUnderStory, casePassing) — scoping must leave it byte-identical,
      // proving the scope discriminates per contributing case rather than
      // shrinking every status entry indiscriminately once ANY cross-project
      // case exists on the requirement.
      const unrestrictedPassed = rootUnrestricted.statuses.find(
        (entry) => entry.statusId === passingStatusId
      )!;
      const scopedPassed = rootScoped.statuses.find(
        (entry) => entry.statusId === passingStatusId
      )!;
      expect(unrestrictedPassed.count - scopedPassed.count).toBe(0);

      // Failed is contributed by BOTH projects (caseFailing local,
      // caseOtherProject cross-project) — scoping must shrink it by exactly
      // the one project-two contributor, not zero it and not leave it
      // unchanged.
      const unrestrictedFailed = rootUnrestricted.statuses.find(
        (entry) => entry.statusId === failingStatusId
      )!;
      const scopedFailed = rootScoped.statuses.find(
        (entry) => entry.statusId === failingStatusId
      )!;
      expect(unrestrictedFailed.count - scopedFailed.count).toBe(1);
    });
  }
);

/** Sorted `[id, breakdown]` pairs for a coverage map — used instead of a
 * bare `expect(mapA).toEqual(mapB)` so the whole-map comparisons below are
 * unambiguously structural (every requirement, every counter, key order
 * irrelevant) rather than resting on `Map` equality semantics. */
function sortedCoverageEntries<V>(map: Map<number, V>): Array<[number, V]> {
  return [...map.entries()].sort(([a], [b]) => a - b);
}

// LINK-03 non-interference (owner 27-08, converting the it.todo scaffold
// plan 27-01 left behind). Proves the roadmap's recorded trap stays closed:
// a manual traceability reference is a RequirementIssueReference join row,
// attached and detached through the SAME enhanced-client statements plan
// 27-07's POST/DELETE routes issue, never a parentId edge — and the two
// coverage entry points above compose the same closure walk that trap
// would corrupt. This block seeds its own isolated project rather than
// reusing the fixture above: the scenario here is orthogonal to every
// COV-01/02/03 case shape already covered above, and the mutation check
// documented in the SUMMARY (a temporary parentId corruption) is safer to
// run against a fixture nothing else in this file depends on.
// A DEDICATED raw client, independent of the shared module-level `db`
// above: the outer describe block's own `afterAll` calls `db.$disconnect()`
// on that shared pool, and top-level `describe` blocks in this file run
// sequentially — by the time THIS block's `beforeAll` runs, the outer
// block's `afterAll` has already destroyed it. A fresh pool here is the
// only thing that keeps this block runnable on its own, regardless of the
// outer block's lifecycle.
const linkDb = createRawDbClient();

describeIntegration("LINK-03 non-interference", () => {
  let adminUserId: string;
  let projectId: number;
  let repositoryId: number;
  let folderId: number;
  let templateId: number;
  let caseStateId: number;
  let runStateId: number;
  let passingStatusId: number;
  let failingStatusId: number;

  // reqUnderTest: two PASSED-latest-result cases, giving it a PASSED
  // rollup before the reference below ever touches it. reqControl: an
  // unrelated requirement with its own PASSED case, present solely so the
  // whole-map comparisons below compare MORE than one entry — a
  // single-key map could pass the same assertion for a much weaker
  // reason. referencedIssue: NOT a requirement (isRequirement false),
  // carrying its OWN linked case whose latest result is FAILED — the
  // exact bait the role-unscoped recursive descendant arm would harvest
  // if a reference were ever routed through parentId instead of the join
  // table.
  let reqUnderTestId: number;
  let reqControlId: number;
  let referencedIssueId: number;

  let caseUnderTestOneId: number;
  let caseUnderTestTwoId: number;
  let caseControlId: number;
  let caseReferencedFailingId: number;

  const allIssueIds: number[] = [];
  const allCaseIds: number[] = [];
  const allRunIds: number[] = [];

  let mapBeforeAttach: Awaited<ReturnType<typeof getRequirementCoverage>>;
  let mapAfterAttach: Awaited<ReturnType<typeof getRequirementCoverage>>;
  let mapAfterDetach: Awaited<ReturnType<typeof getRequirementCoverage>>;
  let coveringBeforeAttach: Awaited<
    ReturnType<typeof getRequirementCoveringCases>
  >;
  let coveringAfterAttach: Awaited<
    ReturnType<typeof getRequirementCoveringCases>
  >;
  let coveringAfterDetach: Awaited<
    ReturnType<typeof getRequirementCoveringCases>
  >;

  async function authDbFor(userId: string) {
    const user = await linkDb.user.findUnique({
      where: { id: userId },
      include: { role: { include: { rolePermissions: true } } },
    });
    if (!user) throw new Error(`Test setup: user ${userId} not found`);
    return getAuthDb(user as never);
  }

  beforeAll(async () => {
    const [{ current_database: dbName }] = await linkDb.$queryRaw<
      Array<{ current_database: string }>
    >`SELECT current_database()`;
    if (dbName !== "tpi_req20" && dbName !== "tpi_test") {
      throw new Error(
        `refusing to run against database "${dbName}" — this suite only runs against the tpi_req20 scratch DB (or tpi_test in CI)`
      );
    }

    const role = await linkDb.roles.findFirst({
      where: { isDefault: true, isDeleted: false },
    });
    if (!role) throw new Error("Test prerequisite: no default role row");

    const admin = await linkDb.user.create({
      data: {
        email: `${STAMP}-link03-admin@example.com`,
        name: `LINK-03 Coverage Admin ${STAMP}`,
        authMethod: "INTERNAL",
        access: "ADMIN",
        accessSource: "MANUAL",
        roleId: role.id,
        password: "$2a$10$placeholderplaceholderplaceholderplaceholder",
      },
      select: { id: true },
    });
    adminUserId = admin.id;

    const project = await linkDb.projects.create({
      data: { name: `${STAMP}-link03-project`, createdBy: adminUserId },
      select: { id: true },
    });
    projectId = project.id;

    const repository = await linkDb.repositories.create({
      data: { projectId },
      select: { id: true },
    });
    repositoryId = repository.id;

    const folder = await linkDb.repositoryFolders.create({
      data: {
        name: `${STAMP}-link03-folder`,
        repositoryId,
        projectId,
        creatorId: adminUserId,
      },
      select: { id: true },
    });
    folderId = folder.id;

    const template = await linkDb.templates.findFirst({
      select: { id: true },
    });
    if (!template)
      throw new Error("Test prerequisite: no Templates row available");
    const caseWorkflow = await linkDb.workflows.findFirst({
      where: { scope: "CASES", isDeleted: false, isEnabled: true },
      select: { id: true },
    });
    if (!caseWorkflow)
      throw new Error(
        "Test prerequisite: no CASES-scoped Workflows row available"
      );
    const runWorkflow = await linkDb.workflows.findFirst({
      where: { scope: "RUNS", isDeleted: false, isEnabled: true },
      select: { id: true },
    });
    if (!runWorkflow)
      throw new Error(
        "Test prerequisite: no RUNS-scoped Workflows row available"
      );
    const passingStatus = await linkDb.status.findFirst({
      where: { isSuccess: true, isDeleted: false },
      select: { id: true },
    });
    if (!passingStatus)
      throw new Error("Test prerequisite: no Status row with isSuccess = true");
    const failingStatus = await linkDb.status.findFirst({
      where: { isFailure: true, isDeleted: false },
      select: { id: true },
    });
    if (!failingStatus)
      throw new Error("Test prerequisite: no Status row with isFailure = true");

    templateId = template.id;
    caseStateId = caseWorkflow.id;
    runStateId = runWorkflow.id;
    passingStatusId = passingStatus.id;
    failingStatusId = failingStatus.id;

    async function createNode(name: string, hasSharedRole: boolean) {
      const issue = await linkDb.issue.create({
        data: {
          name: `${STAMP}-link03-${name}`,
          title: `${STAMP}-link03-${name}`,
          createdById: adminUserId,
          projectId,
          isRequirement: hasSharedRole,
        },
        select: { id: true },
      });
      allIssueIds.push(issue.id);
      return issue.id;
    }

    async function createCase(name: string) {
      const testCase = await linkDb.repositoryCases.create({
        data: {
          projectId,
          repositoryId,
          folderId,
          templateId,
          name: `${STAMP}-link03-${name}`,
          stateId: caseStateId,
          creatorId: adminUserId,
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
      const runCase = await linkDb.testRunCases.create({
        data: { testRunId: runId, repositoryCaseId },
        select: { id: true },
      });
      await linkDb.testRunResults.create({
        data: {
          testRunId: runId,
          testRunCaseId: runCase.id,
          statusId,
          executedById: adminUserId,
          executedAt,
        },
      });
    }

    reqUnderTestId = await createNode("req-under-test", true);
    reqControlId = await createNode("req-control", true);
    referencedIssueId = await createNode("referenced-issue", false);

    caseUnderTestOneId = await createCase("case-under-test-one");
    caseUnderTestTwoId = await createCase("case-under-test-two");
    caseControlId = await createCase("case-control");
    caseReferencedFailingId = await createCase("case-referenced-failing");

    await linkDb.repositoryCaseIssue.createMany({
      data: [
        { caseId: caseUnderTestOneId, issueId: reqUnderTestId },
        { caseId: caseUnderTestTwoId, issueId: reqUnderTestId },
        { caseId: caseControlId, issueId: reqControlId },
        { caseId: caseReferencedFailingId, issueId: referencedIssueId },
      ],
    });

    const run = await linkDb.testRuns.create({
      data: {
        projectId,
        name: `${STAMP}-link03-run`,
        stateId: runStateId,
        createdById: adminUserId,
      },
      select: { id: true },
    });
    allRunIds.push(run.id);

    const now = new Date();
    await recordExecution(run.id, caseUnderTestOneId, passingStatusId, now);
    await recordExecution(run.id, caseUnderTestTwoId, passingStatusId, now);
    await recordExecution(run.id, caseControlId, passingStatusId, now);
    await recordExecution(
      run.id,
      caseReferencedFailingId,
      failingStatusId,
      now
    );

    const scope = { accessibleProjectIds: null };
    mapBeforeAttach = await getRequirementCoverage(
      projectId,
      scope,
      undefined,
      linkDb
    );
    coveringBeforeAttach = await getRequirementCoveringCases(
      projectId,
      [reqUnderTestId],
      scope,
      linkDb
    );

    // Attach through the ENHANCED client's join create — the exact
    // statement plan 27-07's POST route issues, never a raw parentId
    // write. This is the "attaches references the same way production
    // does" the plan calls for.
    const edb = await authDbFor(adminUserId);
    await edb.requirementIssueReference.create({
      data: {
        requirementId: reqUnderTestId,
        referencedIssueId,
        createdById: adminUserId,
      },
    });

    mapAfterAttach = await getRequirementCoverage(
      projectId,
      scope,
      undefined,
      linkDb
    );
    coveringAfterAttach = await getRequirementCoveringCases(
      projectId,
      [reqUnderTestId],
      scope,
      linkDb
    );

    // Detach through the same enhanced client's deleteMany plan 27-07's
    // DELETE route issues.
    await edb.requirementIssueReference.deleteMany({
      where: { requirementId: reqUnderTestId, referencedIssueId },
    });

    mapAfterDetach = await getRequirementCoverage(
      projectId,
      scope,
      undefined,
      linkDb
    );
    coveringAfterDetach = await getRequirementCoveringCases(
      projectId,
      [reqUnderTestId],
      scope,
      linkDb
    );
  });

  afterAll(async () => {
    // Safety net in case a test above ever left the join row behind.
    await linkDb.requirementIssueReference.deleteMany({
      where: { requirementId: reqUnderTestId },
    });
    await linkDb.testRunResults.deleteMany({
      where: { testRunId: { in: allRunIds } },
    });
    await linkDb.testRunCases.deleteMany({
      where: { testRunId: { in: allRunIds } },
    });
    await linkDb.testRuns.deleteMany({ where: { id: { in: allRunIds } } });
    await linkDb.repositoryCaseIssue.deleteMany({
      where: { caseId: { in: allCaseIds } },
    });
    await linkDb.repositoryCases.deleteMany({
      where: { id: { in: allCaseIds } },
    });
    await linkDb.issue.deleteMany({ where: { id: { in: allIssueIds } } });
    await linkDb.repositoryFolders.delete({ where: { id: folderId } });
    await linkDb.repositories.delete({ where: { id: repositoryId } });
    await linkDb.projects.delete({ where: { id: projectId } });
    await linkDb.user.delete({ where: { id: adminUserId } });
    await linkDb.$disconnect();
  });

  it("leaves every coverage counter byte-identical after a reference is attached", () => {
    // Whole-map comparison (reqUnderTest AND reqControl, every counter on
    // each) — not a single counter pulled off one requirement. A rollup
    // that gained a case on one entry while losing one on another would
    // still pass a narrower, single-counter assertion.
    expect(sortedCoverageEntries(mapAfterAttach)).toEqual(
      sortedCoverageEntries(mapBeforeAttach)
    );
  });

  it("leaves every coverage counter byte-identical after a reference is removed", () => {
    expect(sortedCoverageEntries(mapAfterDetach)).toEqual(
      sortedCoverageEntries(mapBeforeAttach)
    );
  });

  it("does not harvest the referenced issue's own linked cases into the requirement's rollup", async () => {
    // Prove the bait is real: the referenced issue's own case's latest
    // result IS a failure, read back directly rather than trusted from
    // fixture setup — a fixture that silently failed to record this
    // execution would make every assertion below vacuously pass.
    const referencedRunCase = await linkDb.testRunCases.findFirst({
      where: { repositoryCaseId: caseReferencedFailingId },
      select: { id: true },
    });
    const referencedResult = await linkDb.testRunResults.findFirst({
      where: { testRunCaseId: referencedRunCase?.id ?? -1 },
      select: { status: { select: { isFailure: true, isSuccess: true } } },
    });
    expect(
      referencedResult?.status.isFailure,
      "fixture defect: the referenced issue's own case must carry a FAILED latest result for this test to mean anything"
    ).toBe(true);

    const reqAfterAttach = mapAfterAttach.get(reqUnderTestId)!;
    expect(reqAfterAttach.status).toBe("PASSED");
    expect(reqAfterAttach.linkedCaseCount).toBe(2);
    expect(reqAfterAttach.failed).toBe(0);

    const coveringCaseIdsAfterAttach = (
      coveringAfterAttach.get(reqUnderTestId) ?? []
    )
      .map((entry) => entry.caseId)
      .sort((a, b) => a - b);
    expect(coveringCaseIdsAfterAttach).not.toContain(caseReferencedFailingId);
    expect(coveringCaseIdsAfterAttach).toEqual(
      [caseUnderTestOneId, caseUnderTestTwoId].sort((a, b) => a - b)
    );
  });

  it("the covering-case drill-down for the requirement is unaffected by attach or detach", () => {
    expect(coveringAfterAttach.get(reqUnderTestId)).toEqual(
      coveringBeforeAttach.get(reqUnderTestId)
    );
    expect(coveringAfterDetach.get(reqUnderTestId)).toEqual(
      coveringBeforeAttach.get(reqUnderTestId)
    );
  });
});
