import { expect, test } from "../../fixtures";

test.describe("Milestone Summary API – statusOrder field", () => {
  test("milestone summary includes statusOrder in test-run segments", async ({
    api,
    request,
  }) => {
    const ts = Date.now();

    let milestoneId:
      Awaited<ReturnType<typeof api.createMilestone>> | undefined;

    await test.step("Create project, milestone, and a passed test run case", async () => {
      const projectId = await api.createProject(`MilestoneSummary ${ts}`);
      milestoneId = await api.createMilestone(
        projectId,
        `Sort Test Milestone ${ts}`
      );

      const folderId = await api.getRootFolderId(projectId);
      const caseId = await api.createTestCase(
        projectId,
        folderId,
        `Sort Case ${ts}`
      );
      const testRunId = await api.createTestRun(projectId, `Sort Run ${ts}`, {
        milestoneId,
      });
      const [testRunCaseId] = await api.addTestCasesToTestRun(testRunId, [
        caseId,
      ]);
      const passedStatusId = await api.getStatusId("passed");
      await api.setTestRunCaseStatus(testRunCaseId, passedStatusId);
    });

    let summary: any;

    await test.step("Fetch the milestone summary", async () => {
      const summaryResponse = await request.get(
        `/api/milestones/${milestoneId}/summary`
      );
      expect(summaryResponse.ok()).toBeTruthy();

      summary = await summaryResponse.json();
      expect(summary.segments.length).toBeGreaterThan(0);
    });

    await test.step("Verify every segment exposes a valid statusOrder", async () => {
      for (const segment of summary.segments) {
        expect(segment).toHaveProperty("statusOrder");
        expect(
          segment.statusOrder === null ||
            typeof segment.statusOrder === "number"
        ).toBe(true);
      }
    });
  });

  test("milestone summary includes statusOrder in session segments", async ({
    api,
    request,
  }) => {
    const ts = Date.now();

    let milestoneId:
      Awaited<ReturnType<typeof api.createMilestone>> | undefined;

    await test.step("Create project, milestone, and a session", async () => {
      const projectId = await api.createProject(
        `MilestoneSummarySession ${ts}`
      );
      milestoneId = await api.createMilestone(
        projectId,
        `Session Sort Milestone ${ts}`
      );
      await api.createSession(projectId, `Sort Session ${ts}`, { milestoneId });
    });

    let summary: any;

    await test.step("Fetch the milestone summary", async () => {
      const summaryResponse = await request.get(
        `/api/milestones/${milestoneId}/summary`
      );
      expect(summaryResponse.ok()).toBeTruthy();

      summary = await summaryResponse.json();
      expect(summary.segments.length).toBeGreaterThan(0);
    });

    await test.step("Verify every segment exposes a valid statusOrder", async () => {
      for (const segment of summary.segments) {
        expect(segment).toHaveProperty("statusOrder");
        expect(
          segment.statusOrder === null ||
            typeof segment.statusOrder === "number"
        ).toBe(true);
      }
    });
  });
});
