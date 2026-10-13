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

  test("keeps the requirements page working when every milestone and configuration of a large project is selected", async ({
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
    const axisSize = 201;
    const createInBatches = async (
      create: (index: number) => Promise<number>
    ) => {
      const ids: number[] = [];
      for (let start = 0; start < axisSize; start += 20) {
        const size = Math.min(20, axisSize - start);
        ids.push(
          ...(await Promise.all(
            Array.from({ length: size }, (_, offset) => create(start + offset))
          ))
        );
      }
      return ids;
    };
    const milestoneIds = await createInBatches((index) =>
      api.createMilestone(projectId, `Sprint ${index} ${ts}`)
    );
    const configIds = await createInBatches((index) =>
      api.createConfiguration(`zz Scope config ${index} ${ts}`, projectId)
    );

    await test.step("The coverage route accepts both whole selections as a POST body", async () => {
      const res = await request.post(
        `${baseURL}/api/projects/${projectId}/requirements/coverage`,
        { data: { milestoneIds, configIds } }
      );
      expect(res.status()).toBe(200);
      expect((await res.json()).coverage[String(requirementId)]).toBeDefined();
    });

    // Resolves with the next POST to `path` whose body carries a full
    // selection on `axis`.
    const scopedPost = (
      path: string,
      axis: "milestoneIds" | "configIds",
      matchesUrl: (url: string) => boolean = () => true
    ) =>
      page.waitForResponse((response) => {
        const sent = response.request();
        return (
          sent.method() === "POST" &&
          new URL(response.url()).pathname === path &&
          matchesUrl(response.url()) &&
          (sent.postDataJSON()?.[axis]?.length ?? 0) === axisSize
        );
      });
    const requirementsApi = `/api/projects/${projectId}/requirements`;
    // Every scope-aware read the page makes with a requirement open: the
    // list's rollup and roots page, and the detail pane's own breakdown and
    // covering cases.
    const scopedReads = (axis: "milestoneIds" | "configIds") => [
      scopedPost(
        `${requirementsApi}/coverage`,
        axis,
        (url) => !url.includes("requirementIds=")
      ),
      scopedPost(`${requirementsApi}/coverage`, axis, (url) =>
        url.includes(`requirementIds=${requirementId}`)
      ),
      scopedPost(`${requirementsApi}/tree`, axis),
      scopedPost(`${requirementsApi}/${requirementId}/covering-cases`, axis),
    ];
    const selectAll = async (pickerTestId: string) => {
      await page.getByTestId(pickerTestId).getByRole("combobox").click();
      const selectAllButton = page.getByTestId(
        "multi-async-combobox-select-all"
      );
      await selectAllButton.click();
      // Both pickers render the same button, so the next one must not open
      // while this dropdown is still closing.
      await page.keyboard.press("Escape");
      await expect(selectAllButton).toHaveCount(0);
    };
    const expectLoaded = async (reads: Promise<{ status(): number }>[]) => {
      for (const response of await Promise.all(reads)) {
        expect(response.status()).toBe(200);
      }
      await expect(page.getByTestId("requirements-list-error")).toHaveCount(0);
      await expect(
        page.getByTestId(`requirement-row-${requirementId}`)
      ).toBeVisible();
    };

    await page.goto(
      `/en-US/projects/requirements/${projectId}?requirement=${requirementId}`
    );
    await expect(page.getByTestId("requirement-detail-panel")).toBeVisible({
      timeout: 15000,
    });
    await expect(
      page.getByTestId(`requirement-row-${requirementId}`)
    ).toBeVisible({ timeout: 15000 });

    await test.step("Select all in the milestone scope picker leaves the page loaded", async () => {
      const reads = scopedReads("milestoneIds");
      await selectAll("requirements-scope-milestone");
      await expectLoaded(reads);
    });

    await test.step("Select all in the configuration scope picker leaves the page loaded", async () => {
      const reads = scopedReads("configIds");
      await selectAll("requirements-scope-configuration");
      await expectLoaded(reads);
    });
  });
});
