
import { expect, test } from "../../fixtures";
import { createRawDbClient } from "~/lib/rawDbClient";
import { getProjectWorkflowIds } from "../reviews/helpers";

/**
 * End-to-end coverage for GET /api/milestones/{id}/export — the data source
 * behind the milestone PDF. Seeds a milestone tree with every section the
 * report renders (nested milestones, runs with varied statuses, a session,
 * a linked issue, and review decisions) and asserts the aggregated snapshot
 * covers all of them.
 *
 * ReviewRequest rows are written directly via Prisma: seeding a decided
 * request keeps the test independent of the decision endpoint's
 * eligibility/gate logic (covered by the reviews specs).
 */
test.describe("Milestone Export API", () => {
  let prisma: PrismaClient;

  test.beforeAll(() => {
    prisma = createRawDbClient();
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test("aggregates the full milestone tree across every section", async ({
    api,
    request,
    baseURL,
  }) => {
    const ts = Date.now();
    let projectId: number | undefined;
    let parentId: number | undefined;
    let childId: number | undefined;
    let folderId: number | undefined;
    let runId: number | undefined;
    let childRunId: number | undefined;
    let sessionId: number | undefined;
    let data: any;

    await test.step("Create the grandparent -> parent -> child milestone tree", async () => {
      projectId = await api.createProject(`MilestoneExport ${ts}`);

      // grandparent -> parent (the one we export) -> child
      const grandparentId = await api.createMilestone(projectId, `GP ${ts}`);
      parentId = await api.createMilestone(projectId, `Parent ${ts}`, {
        parentId: grandparentId,
        isStarted: true,
      });
      childId = await api.createMilestone(projectId, `Child ${ts}`, {
        parentId,
      });

      folderId = await api.getRootFolderId(projectId);
    });

    await test.step("Execute the parent milestone run with three distinct statuses", async () => {
      const [passed, failed, blocked] = await Promise.all([
        api.getStatusId("passed"),
        api.getStatusId("failed"),
        api.getStatusId("blocked"),
      ]);

      // Parent milestone run: three cases executed with distinct statuses.
      const caseIds = await api.createTestCasesBatch(projectId!, folderId!, [
        `Case A ${ts}`,
        `Case B ${ts}`,
        `Case C ${ts}`,
      ]);
      runId = await api.createTestRun(projectId!, `Run ${ts}`, {
        milestoneId: parentId,
      });
      const trcIds = await api.addTestCasesToTestRun(runId, caseIds);
      const runStatuses = [passed, failed, blocked];
      for (let i = 0; i < trcIds.length; i++) {
        // Set the case status (drives the per-status grouping) AND record a
        // result (so the case counts as executed, not pending).
        await api.setTestRunCaseStatus(trcIds[i], runStatuses[i]);
        await api.createTestResult(runId, trcIds[i], runStatuses[i], {
          elapsed: 1000 * (i + 1),
        });
      }

      // Child milestone run: proves descendant roll-up reaches the parent export.
      const childCaseId = await api.createTestCase(
        projectId!,
        folderId!,
        `Child Case ${ts}`
      );
      childRunId = await api.createTestRun(projectId!, `Child Run ${ts}`, {
        milestoneId: childId,
      });
      const [childTrc] = await api.addTestCasesToTestRun(childRunId, [
        childCaseId,
      ]);
      await api.setTestRunCaseStatus(childTrc, passed);
      await api.createTestResult(childRunId, childTrc, passed, {
        elapsed: 800,
      });
    });

    await test.step("Add a session and a linked issue under the parent", async () => {
      // Session under the parent.
      sessionId = await api.createSession(projectId!, `Session ${ts}`, {
        milestoneId: parentId,
      });

      // Linked issue on the run.
      const issueId = await api.createIssue(
        projectId!,
        `BUG-${ts}`,
        "Something broke"
      );
      const linkRes = await request.patch(`/api/model/testRuns/update`, {
        data: {
          where: { id: runId },
          data: { issues: { connect: { id: issueId } } },
        },
      });
      expect(linkRes.ok()).toBeTruthy();
    });

    await test.step("Seed an approved run review and a pending session review", async () => {
      // Review decisions: an approved RUN and a pending SESSION.
      const adminId = await api.getCurrentUserId();
      const runWf = await getProjectWorkflowIds(
        request,
        baseURL!,
        projectId!,
        "RUNS",
        2
      );
      const sessWf = await getProjectWorkflowIds(
        request,
        baseURL!,
        projectId!,
        "SESSIONS",
        2
      );
      expect(runWf.length).toBeGreaterThanOrEqual(2);
      expect(sessWf.length).toBeGreaterThanOrEqual(2);

      await prisma.reviewRequest.create({
        data: {
          projectId: projectId!,
          entityType: "RUN",
          entityId: runId!,
          fromStateId: runWf[0],
          toStateId: runWf[1],
          requestedByUserId: adminId,
          // v3 enforces the assignee XOR @@validate (v2 raw Prisma bypassed it);
          // exactly one of assigneeUserId / assigneeRoleId must be set.
          assigneeUserId: adminId,
          status: "APPROVED",
          decidedByUserId: adminId,
          decidedAt: new Date(),
          decisionComment: "Ship it",
        },
      });
      await prisma.reviewRequest.create({
        data: {
          projectId: projectId!,
          entityType: "SESSION",
          entityId: sessionId!,
          fromStateId: sessWf[0],
          toStateId: sessWf[1],
          requestedByUserId: adminId,
          assigneeUserId: adminId,
          status: "PENDING",
        },
      });
    });

    await test.step("Call the export endpoint for the parent milestone", async () => {
      // --- Call the export endpoint for the PARENT milestone ---
      const res = await request.get(`/api/milestones/${parentId}/export`);
      expect(res.ok()).toBeTruthy();
      data = await res.json();
    });

    await test.step("Verify milestone metadata and nesting path", async () => {
      // Milestone metadata + nesting path.
      expect(data.milestone.id).toBe(parentId);
      expect(data.milestone.status).toBe("In Progress");
      expect(data.milestone.parentPath).toEqual([`GP ${ts}`]);
      expect(data.milestone.ownerName).toBeTruthy();
      expect(data.milestone.typeName).toBeTruthy();
      expect(data.projectId).toBe(projectId);
      expect(data.generatedAt).toBeTruthy();
    });

    await test.step("Verify the roll-up spans the parent run, child run, and session", async () => {
      // Roll-up spans the parent run (3 cases) + descendant child run (1 case)
      // + the contributing session (1 item). The session is pending, so it adds
      // to total but not executed.
      expect(data.rollup.totalItems).toBe(5);
      expect(data.rollup.executedItems).toBe(4);
      expect(data.rollup.completionRate).toBeGreaterThan(0);
      const rollupTotal = data.rollup.statusCounts.reduce(
        (sum: number, s: { count: number }) => sum + s.count,
        0
      );
      expect(rollupTotal).toBe(5);
      expect(data.rollup.statusCounts.length).toBeGreaterThanOrEqual(3);
    });

    await test.step("Verify contributing test runs and per-run breakdown", async () => {
      // Contributing test runs (parent + child), with per-run breakdown.
      const runIds = data.testRuns.map((r: { id: number }) => r.id);
      expect(runIds).toContain(runId);
      expect(runIds).toContain(childRunId);
      const parentRun = data.testRuns.find(
        (r: { id: number }) => r.id === runId
      );
      expect(parentRun.totalItems).toBe(3);
      expect(parentRun.executedItems).toBe(3);
      expect(parentRun.statusCounts.length).toBe(3);
    });

    await test.step("Verify sessions, descendants, and issues sections", async () => {
      // Sessions, descendants, issues.
      expect(data.sessions.map((s: { id: number }) => s.id)).toContain(
        sessionId
      );
      expect(data.descendants.map((d: { id: number }) => d.id)).toContain(
        childId
      );
      expect(
        data.issues.some(
          (i: { title: string }) => i.title === "Something broke"
        )
      ).toBe(true);
    });

    await test.step("Verify review decisions for the approved run and pending session", async () => {
      // Review & Approval decisions: approved run (with decider) + pending session.
      const runDecision = data.reviewDecisions.find(
        (d: { entityType: string; entityId: number }) =>
          d.entityType === "RUN" && d.entityId === runId
      );
      expect(runDecision).toBeTruthy();
      expect(runDecision.status).toBe("APPROVED");
      expect(runDecision.decidedByName).toBeTruthy();
      expect(runDecision.entityName).toBe(`Run ${ts}`);

      const sessionDecision = data.reviewDecisions.find(
        (d: { entityType: string; entityId: number }) =>
          d.entityType === "SESSION" && d.entityId === sessionId
      );
      expect(sessionDecision).toBeTruthy();
      expect(sessionDecision.status).toBe("PENDING");
      expect(sessionDecision.decidedByName).toBeNull();
    });
  });

  test("returns empty sections for a milestone with no data", async ({
    api,
    request,
  }) => {
    const ts = Date.now();
    let milestoneId: number | undefined;
    let data: any;

    await test.step("Create a milestone with no data and export it", async () => {
      const projectId = await api.createProject(`MilestoneExportEmpty ${ts}`);
      milestoneId = await api.createMilestone(projectId, `Empty ${ts}`);

      const res = await request.get(`/api/milestones/${milestoneId}/export`);
      expect(res.ok()).toBeTruthy();
      data = await res.json();
    });

    await test.step("Verify every section is empty", async () => {
      expect(data.milestone.id).toBe(milestoneId);
      expect(data.milestone.status).toBe("Not Started");
      expect(data.milestone.parentPath).toEqual([]);
      expect(data.rollup.totalItems).toBe(0);
      expect(data.testRuns).toEqual([]);
      expect(data.sessions).toEqual([]);
      expect(data.descendants).toEqual([]);
      expect(data.issues).toEqual([]);
      expect(data.reviewDecisions).toEqual([]);
    });
  });

  test("returns 404 for a non-existent milestone", async ({ request }) => {
    const res = await request.get(`/api/milestones/99999999/export`);
    expect(res.status()).toBe(404);
  });
});
