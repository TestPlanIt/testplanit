import { expect, test } from "../../fixtures";

/**
 * Milestone detail: the member issues card (selection, unlink) and the test
 * runs card, seeded through the model API.
 */
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

test.describe("Milestone member issues", () => {
  test("lists member issues, offers a run from a selection, and unlinks one", async ({
    api,
    page,
    request,
    baseURL,
  }) => {
    const ts = uid();
    const projectId = await api.createProject(`E2E Milestone Issues ${ts}`);
    const milestoneId = await api.createMilestone(projectId, `Sprint ${ts}`);
    const issueA = await api.createIssue(
      projectId,
      `MI-A-${ts}`,
      `Member A ${ts}`
    );
    const issueB = await api.createIssue(
      projectId,
      `MI-B-${ts}`,
      `Member B ${ts}`
    );
    for (const issueId of [issueA, issueB]) {
      const res = await request.post(
        `${baseURL}/api/model/milestoneIssue/create`,
        {
          data: { data: { milestoneId, issueId, source: "MANUAL" } },
        }
      );
      expect(res.ok()).toBeTruthy();
    }
    const runId = await api.createTestRun(projectId, `Milestone run ${ts}`, {
      milestoneId,
    });

    await test.step("The card lists both issues and the milestone's run", async () => {
      await page.goto(`/en-US/projects/milestones/${projectId}/${milestoneId}`);
      const section = page.getByTestId("member-issues-section");
      await expect(section).toBeVisible({ timeout: 15000 });
      await expect(section.getByText(`MI-A-${ts}`)).toBeVisible({
        timeout: 15000,
      });
      await expect(section.getByText(`MI-B-${ts}`)).toBeVisible();
      await expect(page.getByTestId("milestone-test-runs-card")).toBeVisible();
      await expect(
        page
          .getByTestId("milestone-test-runs-list")
          .locator(`#testrun-${runId}`)
      ).toBeVisible({ timeout: 15000 });
    });

    await test.step("Selecting a row offers to create a run from it", async () => {
      const section = page.getByTestId("member-issues-section");
      // Rows are virtualized; scope by the row that names the issue.
      const selectA = section
        .getByRole("row")
        .filter({ hasText: `MI-A-${ts}` })
        .getByRole("checkbox", { name: "Select row" });
      await selectA.click();
      await expect(section.getByTestId("member-issues-create-run")).toBeVisible(
        {
          timeout: 10000,
        }
      );
      await selectA.click();
    });

    await test.step("Unlinking a manual member removes it", async () => {
      const section = page.getByTestId("member-issues-section");
      const rowA = section.getByRole("row").filter({ hasText: `MI-A-${ts}` });
      await rowA.hover();
      await rowA.getByTestId("member-issue-row-actions").click();
      await page.getByTestId("member-issue-unlink").click();
      await page.getByTestId("member-issue-unlink-confirm").click();
      await expect(section.getByText(`MI-A-${ts}`)).toBeHidden({
        timeout: 15000,
      });
      await expect(section.getByText(`MI-B-${ts}`)).toBeVisible();

      const res = await request.get(
        `${baseURL}/api/model/milestoneIssue/count`,
        {
          params: { q: JSON.stringify({ where: { milestoneId } }) },
        }
      );
      expect((await res.json()).data).toBe(1);
    });

    await test.step("The found-in-testing card collapses and expands", async () => {
      const toggle = page.getByTestId("found-in-testing-collapse-toggle");
      await expect(toggle).toBeVisible();
      const before = await toggle.getAttribute("aria-expanded");
      await toggle.click();
      await expect(toggle).not.toHaveAttribute("aria-expanded", before ?? "");
    });
  });
});
