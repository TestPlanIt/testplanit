// Live-DB integration proof for HYG-03 — the issue-test-coverage report
// stops counting requirement rows, in both its project-scoped and
// cross-project forms.
//
// Run via (never against the default .env DATABASE_URL — that resolves to
// `ew`; always pass the scratch tpi_req20 URL explicitly):
//   BASE = .env DATABASE_URL with /ew?schema=public replaced by
//   /tpi_req20?schema=public
//   DATABASE_URL="$BASE" RUN_DB_INTEGRATION=1 pnpm exec vitest run \
//     __tests__/integration/issue-test-coverage-requirement-exclusion.integration.test.ts
//
// PROOF DESIGN — why the obvious cheap fixture proves nothing: the
// coverage report's query joins Issue to RepositoryCaseIssue with an INNER
// JOIN, so a requirement row with no case links can never appear in the
// report at all, before or after reclassification. Asserting "unchanged
// counts" against an unlinked row would pass trivially and prove nothing
// about the real risk. The real risk is an issue that already carried case
// links and contributed real coverage rows and results under the old
// undifferentiated model, and is only later reclassified when an admin
// enables its issue type as a requirement type through the config
// recompute path. That is exactly the fixture this suite builds: a
// defect issue WITH linked cases and results, reclassified through the
// real production recompute function, proving the coverage count drops by
// exactly its own contribution with zero effect on sibling defect issues.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Only the auth boundary is stubbed — every other export, and the entire
// query path below it, stays real. This is what makes the proof mean
// something: the real kysely query runs against the real scratch database.
vi.mock("~/utils/reportApiUtils", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~/utils/reportApiUtils")>();
  return {
    ...actual,
    authorizeReportRequest: vi.fn(async () => ({
      ok: true as const,
      bypass: true,
    })),
  };
});

import type { NextRequest } from "next/server";

import { createRawDbClient } from "~/lib/rawDbClient";
import { recomputeRequirementClassification } from "~/lib/services/requirementHierarchy";
import { handleIssueTestCoveragePOST } from "~/utils/issueTestCoverageUtils";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

const db = createRawDbClient();
// Exported so a sibling suite in this phase can share this run-scoped
// stamp instead of redeclaring it.
export const STAMP = `ic-${Date.now()}`;

const TARGET_TYPE_ID = "10001";
const SIBLING_TYPE_ID = "10002";

interface CoverageRow {
  id: number;
  issueId: number;
  linkedTestCases: number;
  passedTestCases: number;
  failedTestCases: number;
  untestedTestCases: number;
  passRate: number;
  [key: string]: unknown;
}

interface CoverageResponse {
  data: CoverageRow[];
  total: number;
}

function buildRequest(body: Record<string, unknown>): NextRequest {
  // handleIssueTestCoveragePOST only touches req.json() and req.headers —
  // a hand-built stub avoids dragging in NextRequest's runtime plumbing.
  return {
    json: async () => body,
    headers: new Headers(),
  } as unknown as NextRequest;
}

async function callCoverageReport(
  projectId: number,
  isCrossProject: boolean
): Promise<CoverageResponse> {
  const response = await handleIssueTestCoveragePOST(
    buildRequest({ projectId }),
    isCrossProject
  );
  return (await (response as Response).json()) as CoverageResponse;
}

// The `id` field is a positional counter assigned during the flat-row
// build (utils/issueTestCoverageUtils.ts), not stable across runs — it
// necessarily shifts once earlier rows (the target's) disappear, so
// comparing it would fail for a reason unrelated to this proof. Strip it
// before any deep-equal.
function stripId(row: CoverageRow): Omit<CoverageRow, "id"> {
  const { id: _id, ...rest } = row;
  return rest;
}

describeIntegration(
  "issue test-coverage requirement exclusion (live DB, HYG-03)",
  () => {
    let adminUserId: string;
    let projectId: number;
    let integrationId: number;
    let repositoryId: number;
    let folderId: number;
    let targetIssueId: number;
    let siblingIssueId: number;
    let targetCase1Id: number;
    let targetCase2Id: number;
    let siblingCaseId: number;
    let testRunId: number;

    let baselineTotal: number;
    let baselineTargetRows: CoverageRow[];
    let baselineSiblingRows: CoverageRow[];
    let recomputeResult: { classified: number; declassified: number };
    let afterRows: CoverageRow[];
    let afterTotal: number;

    beforeAll(async () => {
      // Refuse to run against anything but a scratch database — the
      // worktree .env DATABASE_URL resolves to `ew`, and this suite
      // reclassifies a live issue through the real recompute path.
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
          name: `Coverage Exclusion Admin ${STAMP}`,
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

      const integration = await db.integration.create({
        data: {
          name: `${STAMP}-jira`,
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
          name: `${STAMP}-folder`,
          repositoryId,
          projectId,
          creatorId: adminUserId,
        },
        select: { id: true },
      });
      folderId = folder.id;

      // Templates and Workflows are global catalogs (no projectId FK), so
      // reuse rather than create — matches
      // issue-raw-write-containment.test.ts's fixture convention.
      const template = await db.templates.findFirst({ select: { id: true } });
      if (!template)
        throw new Error("Test prerequisite: no Templates row available");
      const caseState = await db.workflows.findFirst({
        where: { scope: "CASES", isDeleted: false, isEnabled: true },
        select: { id: true },
      });
      if (!caseState)
        throw new Error(
          "Test prerequisite: no CASES-scoped Workflows row available"
        );
      const runState = await db.workflows.findFirst({
        where: { scope: "RUNS", isDeleted: false, isEnabled: true },
        select: { id: true },
      });
      if (!runState)
        throw new Error(
          "Test prerequisite: no RUNS-scoped Workflows row available"
        );
      const passingStatus = await db.status.findFirst({
        where: { isSuccess: true, isDeleted: false },
        select: { id: true },
      });
      if (!passingStatus)
        throw new Error(
          "Test prerequisite: no Status row with isSuccess = true"
        );

      // TARGET — a defect issue (a tracker Epic linked to cases under the
      // old undifferentiated model, in spirit) that is later reclassified
      // as a requirement. Carries TWO linked cases so "drops by exactly
      // its contribution" is a real number, not just 1.
      const targetIssue = await db.issue.create({
        data: {
          name: `${STAMP}-target`,
          title: `${STAMP}-target`,
          createdById: adminUserId,
          projectId,
          integrationId,
          issueTypeId: TARGET_TYPE_ID,
          isRequirement: false,
        },
        select: { id: true },
      });
      targetIssueId = targetIssue.id;

      // SIBLING — a defect issue on a different issue type, never
      // reclassified. Every row this suite reads for it must stay
      // byte-identical across the recompute.
      const siblingIssue = await db.issue.create({
        data: {
          name: `${STAMP}-sibling`,
          title: `${STAMP}-sibling`,
          createdById: adminUserId,
          projectId,
          integrationId,
          issueTypeId: SIBLING_TYPE_ID,
          isRequirement: false,
        },
        select: { id: true },
      });
      siblingIssueId = siblingIssue.id;

      // TS can't narrow `template`/`caseState` across the closure below, so
      // capture their ids into plain, definitely-non-null locals first.
      const templateId = template.id;
      const caseStateId = caseState.id;

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
        return testCase.id;
      }

      targetCase1Id = await createCase("target-case-1");
      targetCase2Id = await createCase("target-case-2");
      siblingCaseId = await createCase("sibling-case");

      await db.repositoryCaseIssue.createMany({
        data: [
          { caseId: targetCase1Id, issueId: targetIssueId },
          { caseId: targetCase2Id, issueId: targetIssueId },
          { caseId: siblingCaseId, issueId: siblingIssueId },
        ],
      });

      const testRun = await db.testRuns.create({
        data: {
          projectId,
          name: `${STAMP}-run`,
          stateId: runState.id,
          createdById: adminUserId,
        },
        select: { id: true },
      });
      testRunId = testRun.id;

      // Only targetCase1 and siblingCase get an executed result — the
      // second target case (targetCase2) is deliberately left untested. It
      // still counts toward the target's linkedTestCases as an untested
      // row, which is what makes the target's baseline contribution TWO
      // rows rather than one.
      const targetRunCase1 = await db.testRunCases.create({
        data: { testRunId, repositoryCaseId: targetCase1Id },
        select: { id: true },
      });
      const siblingRunCase = await db.testRunCases.create({
        data: { testRunId, repositoryCaseId: siblingCaseId },
        select: { id: true },
      });

      await db.testRunResults.create({
        data: {
          testRunId,
          testRunCaseId: targetRunCase1.id,
          statusId: passingStatus.id,
          executedById: adminUserId,
          executedAt: new Date(),
        },
      });
      await db.testRunResults.create({
        data: {
          testRunId,
          testRunCaseId: siblingRunCase.id,
          statusId: passingStatus.id,
          executedById: adminUserId,
          executedAt: new Date(),
        },
      });
    });

    afterAll(async () => {
      await db.testRunResults.deleteMany({ where: { testRunId } });
      await db.testRunCases.deleteMany({ where: { testRunId } });
      await db.testRuns.delete({ where: { id: testRunId } });
      await db.repositoryCaseIssue.deleteMany({
        where: {
          caseId: { in: [targetCase1Id, targetCase2Id, siblingCaseId] },
        },
      });
      await db.repositoryCases.deleteMany({
        where: { id: { in: [targetCase1Id, targetCase2Id, siblingCaseId] } },
      });
      await db.issue.deleteMany({
        where: { id: { in: [targetIssueId, siblingIssueId] } },
      });
      await db.repositoryFolders.delete({ where: { id: folderId } });
      await db.repositories.delete({ where: { id: repositoryId } });
      await db.integration.delete({ where: { id: integrationId } });
      await db.projects.delete({ where: { id: projectId } });
      await db.user.delete({ where: { id: adminUserId } });
      await db.$disconnect();
    });

    it("a defect issue with linked cases appears in the coverage report before reclassification", async () => {
      const baseline = await callCoverageReport(projectId, false);
      baselineTotal = baseline.total;
      baselineTargetRows = baseline.data.filter(
        (row) => row.issueId === targetIssueId
      );
      baselineSiblingRows = baseline.data.filter(
        (row) => row.issueId === siblingIssueId
      );

      expect(baselineTargetRows.length).toBe(2);
      expect(baselineTargetRows.every((row) => row.linkedTestCases === 2)).toBe(
        true
      );
      expect(baselineSiblingRows.length).toBe(1);
      expect(baselineSiblingRows[0].linkedTestCases).toBe(1);
    });

    it("reclassifying that issue as a requirement removes exactly its contribution", async () => {
      recomputeResult = await recomputeRequirementClassification(
        projectId,
        [TARGET_TYPE_ID],
        []
      );
      expect(recomputeResult.classified).toBeGreaterThanOrEqual(1);

      const after = await callCoverageReport(projectId, false);
      afterRows = after.data;
      afterTotal = after.total;

      // The exact arithmetic this proof exists to demonstrate: total drops
      // by precisely the number of rows the target contributed, no more,
      // no less.
      expect(afterTotal).toBe(baselineTotal - baselineTargetRows.length);
      expect(
        afterRows.filter((row) => row.issueId === targetIssueId)
      ).toHaveLength(0);
    });

    it("sibling defect issues keep byte-identical coverage rows across the reclassification", async () => {
      const afterSiblingRows = afterRows.filter(
        (row) => row.issueId === siblingIssueId
      );
      expect(afterSiblingRows.length).toBe(baselineSiblingRows.length);
      expect(afterSiblingRows.map(stripId)).toEqual(
        baselineSiblingRows.map(stripId)
      );

      // Named per-field assertions so a future refactor that silently
      // reshapes the summary object can't hide behind the deep-equal above.
      expect(afterSiblingRows[0].linkedTestCases).toBe(
        baselineSiblingRows[0].linkedTestCases
      );
      expect(afterSiblingRows[0].passedTestCases).toBe(
        baselineSiblingRows[0].passedTestCases
      );
      expect(afterSiblingRows[0].failedTestCases).toBe(
        baselineSiblingRows[0].failedTestCases
      );
      expect(afterSiblingRows[0].untestedTestCases).toBe(
        baselineSiblingRows[0].untestedTestCases
      );
      expect(afterSiblingRows[0].passRate).toBe(
        baselineSiblingRows[0].passRate
      );
    });

    it("the cross-project coverage variant excludes the reclassified issue too", async () => {
      const crossProject = await callCoverageReport(projectId, true);
      const crossProjectTargetRows = crossProject.data.filter(
        (row) => row.issueId === targetIssueId
      );
      expect(crossProjectTargetRows).toHaveLength(0);
    });
  }
);
