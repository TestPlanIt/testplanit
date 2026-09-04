import { expect, test } from "../../fixtures";

/**
 * Coverage execution scoping: the coverage rollup counts only executions
 * inside the chosen milestone, and the requirements page exposes the pickers.
 */
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

test.describe("Requirement coverage scoping", () => {
  test("scopes the coverage rollup to a milestone", async ({
    api,
    page,
    request,
    baseURL,
  }) => {
    const ts = uid();
    const projectId = await api.createProject(`E2E Req Scope ${ts}`);
    await api.enableRequirements(projectId);
    const folderId = await api.getRootFolderId(projectId);
    const caseId = await api.createTestCase(
      projectId,
      folderId,
      `Scoped case ${ts}`
    );
    const requirementId = await api.createRequirement(
      projectId,
      `SCOPE-${ts}`,
      `Scoped ${ts}`
    );
    await api.linkIssueToTestCase(requirementId, caseId);

    const passedMilestone = await api.createMilestone(
      projectId,
      `Passed sprint ${ts}`
    );
    const failedMilestone = await api.createMilestone(
      projectId,
      `Failed sprint ${ts}`
    );
    const emptyMilestone = await api.createMilestone(
      projectId,
      `Empty sprint ${ts}`
    );
    const passedRun = await api.createTestRun(projectId, `Passed run ${ts}`, {
      milestoneId: passedMilestone,
    });
    await api.createTestResult(
      passedRun,
      await api.addTestCaseToTestRun(passedRun, caseId),
      await api.getStatusId("passed")
    );
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const failedRun = await api.createTestRun(projectId, `Failed run ${ts}`, {
      milestoneId: failedMilestone,
    });
    await api.createTestResult(
      failedRun,
      await api.addTestCaseToTestRun(failedRun, caseId),
      await api.getStatusId("failed")
    );

    const coverage = async (milestoneIds?: number[]) => {
      const params: Record<string, string> = {
        requirementIds: String(requirementId),
      };
      if (milestoneIds) params.milestoneIds = milestoneIds.join(",");
      const res = await request.get(
        `${baseURL}/api/projects/${projectId}/requirements/coverage`,
        { params }
      );
      expect(res.ok()).toBeTruthy();
      return (await res.json()).coverage[String(requirementId)];
    };

    await test.step("Each milestone scope yields a different rollup", async () => {
      const latest = await coverage();
      const passed = await coverage([passedMilestone]);
      const failed = await coverage([failedMilestone]);
      const empty = await coverage([emptyMilestone]);
      expect(latest.directCaseCount).toBe(1);
      expect(JSON.stringify(passed)).not.toBe(JSON.stringify(failed));
      expect(JSON.stringify(latest)).toBe(JSON.stringify(failed));
      expect(empty.untested).toBeGreaterThanOrEqual(1);
    });

    await test.step("The requirements page offers the scope pickers", async () => {
      await page.goto(`/en-US/projects/requirements/${projectId}`);
      await expect(
        page.getByTestId(`requirement-row-${requirementId}`)
      ).toBeVisible({
        timeout: 15000,
      });
      await expect(
        page.getByTestId("requirements-scope-milestone")
      ).toBeVisible();
      await expect(
        page.getByTestId("requirements-scope-configuration")
      ).toBeVisible();
    });
  });
});
