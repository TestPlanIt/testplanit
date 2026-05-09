import { expect, test } from "../../fixtures";

test.describe("Milestone Summary API – statusOrder field", () => {
  test("milestone summary includes statusOrder in test-run segments", async ({
    api,
    request,
  }) => {
    const ts = Date.now();
    const projectId = await api.createProject(`MilestoneSummary ${ts}`);
    const milestoneId = await api.createMilestone(
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

    const summaryResponse = await request.get(
      `/api/milestones/${milestoneId}/summary`
    );
    expect(summaryResponse.ok()).toBeTruthy();

    const summary = await summaryResponse.json();
    expect(summary.segments.length).toBeGreaterThan(0);

    for (const segment of summary.segments) {
      expect(segment).toHaveProperty("statusOrder");
      expect(
        segment.statusOrder === null || typeof segment.statusOrder === "number"
      ).toBe(true);
    }
  });

  test("milestone summary includes statusOrder in session segments", async ({
    api,
    request,
  }) => {
    const ts = Date.now();
    const projectId = await api.createProject(`MilestoneSummarySession ${ts}`);
    const milestoneId = await api.createMilestone(
      projectId,
      `Session Sort Milestone ${ts}`
    );
    await api.createSession(projectId, `Sort Session ${ts}`, { milestoneId });

    const summaryResponse = await request.get(
      `/api/milestones/${milestoneId}/summary`
    );
    expect(summaryResponse.ok()).toBeTruthy();

    const summary = await summaryResponse.json();
    expect(summary.segments.length).toBeGreaterThan(0);

    for (const segment of summary.segments) {
      expect(segment).toHaveProperty("statusOrder");
      expect(
        segment.statusOrder === null || typeof segment.statusOrder === "number"
      ).toBe(true);
    }
  });
});
