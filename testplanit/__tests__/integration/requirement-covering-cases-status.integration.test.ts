// Live-DB integration proof for the covering-cases drill-down's
// latest-result extension (COV-04). "Latest" is global across runs, across
// manual and automated results, and must agree byte-for-byte with the
// rollup's own counters — none of that can be proven against a mocked
// query client, only against real Postgres recursion and real joined rows.
//
// Run via (never against the default .env DATABASE_URL — that resolves to
// `ew`; always pass the scratch tpi_req20 URL explicitly):
//   BASE = .env DATABASE_URL with /ew?schema=public replaced by
//   /tpi_req20?schema=public
//   DATABASE_URL="$BASE" RUN_DB_INTEGRATION=1 pnpm exec vitest run \
//     __tests__/integration/requirement-covering-cases-status.integration.test.ts
//
// This suite must never inherit the worktree's own .env: that file's
// DATABASE_URL resolves to the real, shared dev database. The
// current_database() guard in beforeAll below refuses to proceed against
// anything but the scratch database, whatever DATABASE_URL a caller
// supplies.
//
// PROOF DESIGN — why a fixture with one execution per case would prove
// nothing: a query that ignores every prior run, that only ever looks at
// the manual side, or that only ever looks at the automated side, would all
// pass under a fixture where each case has exactly one result. Every case
// below carries either two competing executions (to force a real "which one
// is newer" decision) or, for the never-executed and de-dup cases, a
// deliberately absent or doubled link row.

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
const STAMP = `rcs-${Date.now()}`;

describeIntegration(
  "requirement covering-cases latest-result extension (live DB, converted by 26-03)",
  () => {
    let adminUserId: string;
    let projectId: number;
    let repositoryId: number;
    let folderId: number;

    let templateId: number;
    let caseStateId: number;
    let runStateId: number;
    let passingStatusId: number;
    let failingStatusId: number;
    let passingStatusName: string;
    let failingStatusName: string;

    // root -> child -> grandchild, every node a requirement — deep enough
    // that the whole-subtree bound (rootIds: [reqRootId]) has to reach all
    // three levels to pick up every fixture case below.
    let reqRootId: number;
    let reqChildId: number;
    let reqGrandchildId: number;

    let caseLatestId: number;
    let caseJunitNewerId: number;
    let caseManualNewerId: number;
    let caseNeverId: number;
    let caseDupId: number;

    const allIssueIds: number[] = [];
    const allCaseIds: number[] = [];
    const allRunIds: number[] = [];
    const allSuiteIds: number[] = [];

    let executedAtOld: Date;
    let executedAtNew: Date;

    let rootCoverage: Awaited<ReturnType<typeof getRequirementCoverage>>;
    let rootCovering: Awaited<ReturnType<typeof getRequirementCoveringCases>>;

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
          name: `Covering Cases Status Admin ${STAMP}`,
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
        data: { name: `${STAMP}-project`, createdBy: adminUserId },
        select: { id: true },
      });
      projectId = project.id;

      const repository = await db.repositories.create({
        data: { projectId },
        select: { id: true },
      });
      repositoryId = repository.id;

      const folder = await db.repositoryFolders.create({
        data: {
          name: `${STAMP}-folder`,
          repositoryId,
          projectId,
          creatorId: adminUserId,
        },
        select: { id: true },
      });
      folderId = folder.id;

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
        select: { id: true, name: true },
      });
      if (!passingStatus)
        throw new Error(
          "Test prerequisite: no Status row with isSuccess = true"
        );
      const failingStatus = await db.status.findFirst({
        where: { isFailure: true, isDeleted: false },
        select: { id: true, name: true },
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
      passingStatusName = passingStatus.name;
      failingStatusName = failingStatus.name;

      async function createNode(name: string, parentId: number | null) {
        const issue = await db.issue.create({
          data: {
            name: `${STAMP}-${name}`,
            title: `${STAMP}-${name}`,
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

      async function createCase(name: string) {
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
        return testCase.id;
      }

      async function createRun(name: string) {
        const run = await db.testRuns.create({
          data: {
            projectId,
            name: `${STAMP}-${name}`,
            stateId: runStateId,
            createdById: adminUserId,
          },
          select: { id: true },
        });
        allRunIds.push(run.id);
        return run.id;
      }

      async function recordManualExecution(
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

      async function recordJunitExecution(
        runId: number,
        repositoryCaseId: number,
        statusId: number,
        resultType: "PASSED" | "FAILURE",
        executedAt: Date
      ) {
        const suite = await db.jUnitTestSuite.create({
          data: {
            name: `${STAMP}-suite`,
            testRunId: runId,
            createdById: adminUserId,
          },
          select: { id: true },
        });
        allSuiteIds.push(suite.id);
        await db.jUnitTestResult.create({
          data: {
            type: resultType,
            repositoryCaseId,
            testSuiteId: suite.id,
            createdById: adminUserId,
            statusId,
            executedAt,
            time: 1.5,
          },
        });
      }

      reqRootId = await createNode("req-root", null);
      reqChildId = await createNode("req-child", reqRootId);
      reqGrandchildId = await createNode("req-grandchild", reqChildId);

      caseLatestId = await createCase("case-latest");
      caseJunitNewerId = await createCase("case-junit-newer");
      caseManualNewerId = await createCase("case-manual-newer");
      caseNeverId = await createCase("case-never");
      caseDupId = await createCase("case-dup");

      await db.repositoryCaseIssue.createMany({
        data: [
          { caseId: caseLatestId, issueId: reqGrandchildId },
          { caseId: caseJunitNewerId, issueId: reqChildId },
          { caseId: caseManualNewerId, issueId: reqChildId },
          { caseId: caseNeverId, issueId: reqRootId },
          // caseDup: linked at BOTH the root and its own grandchild — the
          // de-dup proof.
          { caseId: caseDupId, issueId: reqRootId },
          { caseId: caseDupId, issueId: reqGrandchildId },
        ],
      });

      const runOld = await createRun("run-old");
      const runNew = await createRun("run-new");
      const runManualSide = await createRun("run-manual-side");
      const runJunitSide = await createRun("run-junit-side");

      const now = new Date();
      executedAtOld = new Date(now.getTime() - 5 * 60 * 1000);
      executedAtNew = now;

      // caseLatest: two executions in TWO DIFFERENT runs, older FAILED and
      // newer PASSED — "latest" must be global across runs (decision P5),
      // not scoped to whichever run a caller happens to look at.
      await recordManualExecution(
        runOld,
        caseLatestId,
        failingStatusId,
        executedAtOld
      );
      await recordManualExecution(
        runNew,
        caseLatestId,
        passingStatusId,
        executedAtNew
      );

      // caseJunitNewer: manual result older (FAILED), JUnit result newer
      // (PASSED) — the drill-down must report the JUnit one.
      await recordManualExecution(
        runManualSide,
        caseJunitNewerId,
        failingStatusId,
        executedAtOld
      );
      await recordJunitExecution(
        runJunitSide,
        caseJunitNewerId,
        passingStatusId,
        "PASSED",
        executedAtNew
      );

      // caseManualNewer: JUnit result older (FAILED), manual result newer
      // (PASSED) — the drill-down must report the manual one. The mirror
      // image of caseJunitNewer, so "the JUnit source wins" above cannot be
      // a coincidence of source ordering rather than of recency.
      await recordJunitExecution(
        runJunitSide,
        caseManualNewerId,
        failingStatusId,
        "FAILURE",
        executedAtOld
      );
      await recordManualExecution(
        runManualSide,
        caseManualNewerId,
        passingStatusId,
        executedAtNew
      );

      // caseNever and caseDup deliberately carry zero executions.

      rootCoverage = await getRequirementCoverage(
        projectId,
        { accessibleProjectIds: null },
        { rootIds: [reqRootId] },
        db
      );
      rootCovering = await getRequirementCoveringCases(
        projectId,
        [reqRootId],
        { accessibleProjectIds: null },
        db
      );
    });

    afterAll(async () => {
      await db.jUnitTestResult.deleteMany({
        where: { testSuite: { id: { in: allSuiteIds } } },
      });
      await db.jUnitTestSuite.deleteMany({
        where: { id: { in: allSuiteIds } },
      });
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
      await db.repositoryFolders.delete({ where: { id: folderId } });
      await db.repositories.delete({ where: { id: repositoryId } });
      await db.projects.delete({ where: { id: projectId } });
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
      const remainingRuns = await db.testRuns.count({
        where: { name: { startsWith: STAMP } },
      });
      console.log(
        `post-teardown stamp check (${STAMP}): issues=${remainingIssues}, ` +
          `cases=${remainingCases}, projects=${remainingProjects}, runs=${remainingRuns}`
      );
      expect(remainingIssues).toBe(0);
      expect(remainingCases).toBe(0);
      expect(remainingProjects).toBe(0);
      expect(remainingRuns).toBe(0);

      await db.$disconnect();
    });

    it("returns the latest result for each covering case against real Postgres", async () => {
      // Fixture-not-vacuous proof: caseLatest really has two distinct
      // executions, in different runs, with different timestamps and
      // different statuses — a single-execution fixture would make the
      // "latest wins" assertion below pass for the wrong reason.
      const latestExecutions = await db.testRunResults.findMany({
        where: { testRunCase: { repositoryCaseId: caseLatestId } },
        select: { executedAt: true, statusId: true, testRunId: true },
      });
      expect(latestExecutions).toHaveLength(2);
      const distinctTimestamps = new Set(
        latestExecutions.map((e) => e.executedAt?.getTime())
      );
      const distinctStatuses = new Set(latestExecutions.map((e) => e.statusId));
      const distinctRuns = new Set(latestExecutions.map((e) => e.testRunId));
      expect(
        distinctTimestamps.size,
        "caseLatest's two executions must carry distinct timestamps"
      ).toBe(2);
      expect(
        distinctStatuses.size,
        "caseLatest's two executions must carry distinct statuses"
      ).toBe(2);
      expect(
        distinctRuns.size,
        "caseLatest's two executions must live in two different runs"
      ).toBe(2);

      const entries = rootCovering.get(reqRootId) ?? [];
      const latestEntry = entries.find((e) => e.caseId === caseLatestId);
      expect(latestEntry).toBeDefined();
      expect(latestEntry?.lastStatusName).toBe(passingStatusName);
      expect(latestEntry?.lastStatusIsSuccess).toBe(true);
      expect(latestEntry?.lastStatusIsFailure).toBe(false);
      expect(latestEntry?.lastExecutedAt).toBe(executedAtNew.toISOString());
    });

    it("prefers the newest execution across runs and across manual and automated results", async () => {
      const entries = rootCovering.get(reqRootId) ?? [];

      const junitNewerEntry = entries.find(
        (e) => e.caseId === caseJunitNewerId
      );
      expect(junitNewerEntry).toBeDefined();
      expect(junitNewerEntry?.lastStatusName).toBe(passingStatusName);
      expect(junitNewerEntry?.lastStatusIsSuccess).toBe(true);
      expect(junitNewerEntry?.lastExecutedAt).toBe(executedAtNew.toISOString());

      const manualNewerEntry = entries.find(
        (e) => e.caseId === caseManualNewerId
      );
      expect(manualNewerEntry).toBeDefined();
      expect(manualNewerEntry?.lastStatusName).toBe(passingStatusName);
      expect(manualNewerEntry?.lastStatusIsSuccess).toBe(true);
      expect(manualNewerEntry?.lastExecutedAt).toBe(
        executedAtNew.toISOString()
      );

      // Neither entry reports the OLDER, failing source — proving this is a
      // recency decision, not "manual always wins" or "automated always
      // wins" by source-type precedence.
      expect(junitNewerEntry?.lastStatusName).not.toBe(failingStatusName);
      expect(manualNewerEntry?.lastStatusName).not.toBe(failingStatusName);
    });

    it("returns a null status for a covering case that has never been executed", async () => {
      // Fixture-not-vacuous proof: caseNever really is linked (a real
      // RepositoryCaseIssue row exists) and really has zero recorded
      // results — a case that was simply never linked would also come back
      // "absent," which would make the null-status assertion pass without
      // proving the no-drop guarantee at all.
      const link = await db.repositoryCaseIssue.findFirst({
        where: { caseId: caseNeverId, issueId: reqRootId },
      });
      expect(link).not.toBeNull();
      const resultCount = await db.testRunResults.count({
        where: { testRunCase: { repositoryCaseId: caseNeverId } },
      });
      expect(resultCount).toBe(0);

      const entries = rootCovering.get(reqRootId) ?? [];
      const neverEntry = entries.find((e) => e.caseId === caseNeverId);
      expect(
        neverEntry,
        "a never-executed covering case must still be present in the list, not dropped"
      ).toBeDefined();
      expect(neverEntry?.lastStatusName).toBeNull();
      expect(neverEntry?.lastStatusColor).toBeNull();
      expect(neverEntry?.lastStatusIsSuccess).toBeNull();
      expect(neverEntry?.lastStatusIsFailure).toBeNull();
      expect(neverEntry?.lastExecutedAt).toBeNull();
    });

    it("still agrees with the rollup linked-case count after the extension", async () => {
      const rollupCount = rootCoverage.get(reqRootId)?.linkedCaseCount;
      const drillDownCount = (rootCovering.get(reqRootId) ?? []).length;
      expect(rollupCount).toBeDefined();
      expect(
        drillDownCount,
        `rollup linkedCaseCount (${rollupCount}) must equal the number of rows ` +
          `the drill-down returns for the same requirement (${drillDownCount})`
      ).toBe(rollupCount);
    });

    it("keeps a case linked at two levels de-duplicated to one row", async () => {
      const subtreeNodeIds = [reqRootId, reqChildId, reqGrandchildId];
      const links = await db.repositoryCaseIssue.findMany({
        where: { issueId: { in: subtreeNodeIds } },
        select: { caseId: true },
      });
      const rawLinkRowCount = links.length;
      const distinctCaseCount = new Set(links.map((l) => l.caseId)).size;
      expect(
        rawLinkRowCount,
        `raw link-row count beneath reqRoot (${rawLinkRowCount}) must exceed the ` +
          `distinct case count (${distinctCaseCount}) — otherwise a passing de-dup ` +
          "assertion below would be a coincidence, not proof"
      ).toBeGreaterThan(distinctCaseCount);

      const entries = rootCovering.get(reqRootId) ?? [];
      const dupEntries = entries.filter((e) => e.caseId === caseDupId);
      expect(
        dupEntries,
        "caseDup is linked at both reqRoot and reqGrandchild but must appear exactly once for reqRoot"
      ).toHaveLength(1);
    });
  }
);

// Todo-only scaffold, owner 27-05. Proves COV-05's data-delivery seam
// (CONTEXT.md/UI-SPEC.md): the suspect predicate composes this helper's
// per-case executed_at rather than re-deriving "latest execution" itself,
// agreeing byte-for-byte with the rollup and the drill-down's own
// latest-result extension above.
describeIntegration("getCaseLatestExecutedAt", () => {
  it.todo(
    "returns the manual execution timestamp for a case whose latest result is a run result"
  );
  it.todo(
    "returns the JUnit execution timestamp for a case whose latest result is automated"
  );
  it.todo("returns null for a case that has never been executed");
  it.todo(
    "returns one entry per requested case id, including the never-executed ones"
  );
});
