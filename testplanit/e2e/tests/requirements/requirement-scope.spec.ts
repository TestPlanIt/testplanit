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

  test("keeps the requirements list working when every milestone of a large project is selected", async ({
    api,
    page,
    request,
    baseURL,
  }) => {
    test.slow();
    const ts = uid();
    const projectId = await api.createProject(`E2E Req Scope All ${ts}`);
    await api.enableRequirements(projectId);
    const requirementId = await api.createRequirement(
      projectId,
      `SCOPEALL-${ts}`,
      `Scoped all ${ts}`
    );

    // One past the most ids a scope carries on a query string.
    const milestoneCount = 201;
    const milestoneIds: number[] = [];
    for (let start = 0; start < milestoneCount; start += 20) {
      const size = Math.min(20, milestoneCount - start);
      milestoneIds.push(
        ...(await Promise.all(
          Array.from({ length: size }, (_, offset) =>
            api.createMilestone(projectId, `Sprint ${start + offset} ${ts}`)
          )
        ))
      );
    }

    await test.step("The coverage route accepts the whole selection as a POST body", async () => {
      const res = await request.post(
        `${baseURL}/api/projects/${projectId}/requirements/coverage`,
        { data: { milestoneIds } }
      );
      expect(res.status()).toBe(200);
      expect((await res.json()).coverage[String(requirementId)]).toBeDefined();
    });

    await test.step("Select all in the milestone scope picker leaves the list loaded", async () => {
      await page.goto(`/en-US/projects/requirements/${projectId}`);
      const row = page.getByTestId(`requirement-row-${requirementId}`);
      await expect(row).toBeVisible({ timeout: 15000 });

      const scopedRequest = (path: string) =>
        page.waitForResponse(
          (response) =>
            response.url().includes(path) &&
            response.request().method() === "POST" &&
            (response.request().postDataJSON()?.milestoneIds?.length ?? 0) ===
              milestoneCount
        );
      const coverageResponse = scopedRequest(
        `/api/projects/${projectId}/requirements/coverage`
      );
      const treeResponse = scopedRequest(
        `/api/projects/${projectId}/requirements/tree`
      );

      await page
        .getByTestId("requirements-scope-milestone")
        .getByRole("combobox")
        .click();
      await page.getByTestId("multi-async-combobox-select-all").click();

      expect((await coverageResponse).status()).toBe(200);
      expect((await treeResponse).status()).toBe(200);
      await expect(page.getByTestId("requirements-list-error")).toHaveCount(0);
      await expect(row).toBeVisible();
    });
  });
});
