import { expect, test } from "../../fixtures";

/**
 * Project issues list (/projects/issues/:projectId).
 *
 * Internal issues are created from an entity surface in the app, so the list
 * is seeded through the model API here. Covered: rows render, the name
 * filter narrows them, a deep link lands on its row, and requirements are
 * kept out of the defect list.
 */
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

test.describe("Project issues list", () => {
  let projectId: number;

  test.beforeEach(async ({ api }) => {
    projectId = await api.createProject(`E2E Issues List ${uid()}`);
  });

  test("lists issues, filters by name and deep-links to a row", async ({
    api,
    page,
  }) => {
    const ts = uid();
    const loginId = await api.createIssue(
      projectId,
      `ISS-LOGIN-${ts}`,
      `Login button unresponsive ${ts}`
    );
    const exportId = await api.createIssue(
      projectId,
      `ISS-EXPORT-${ts}`,
      `Export times out ${ts}`
    );

    await test.step("Both issues render as rows", async () => {
      await page.goto(`/en-US/projects/issues/${projectId}`);
      await expect(page.getByTestId(`issue-row-${loginId}`)).toBeVisible({
        timeout: 15000,
      });
      await expect(page.getByTestId(`issue-row-${exportId}`)).toBeVisible();
    });

    await test.step("The name filter narrows the list", async () => {
      await page
        .getByPlaceholder("Filter issues by name...")
        .fill(`ISS-EXPORT-${ts}`);
      await expect(page.getByTestId(`issue-row-${exportId}`)).toBeVisible({
        timeout: 15000,
      });
      await expect(page.getByTestId(`issue-row-${loginId}`)).toBeHidden({
        timeout: 15000,
      });
    });

    await test.step("A deep link opens the list with the issue row present", async () => {
      await page.goto(`/en-US/projects/issues/${projectId}?issueId=${loginId}`);
      await expect(page.getByTestId(`issue-row-${loginId}`)).toBeVisible({
        timeout: 15000,
      });
    });
  });

  test("keeps requirements out of the defect list", async ({ api, page }) => {
    const ts = uid();
    const defectId = await api.createIssue(
      projectId,
      `ISS-${ts}`,
      `A defect ${ts}`
    );
    const requirementId = await api.createRequirement(
      projectId,
      `REQ-${ts}`,
      `A requirement ${ts}`
    );

    await page.goto(`/en-US/projects/issues/${projectId}`);
    await expect(page.getByTestId(`issue-row-${defectId}`)).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByTestId(`issue-row-${requirementId}`)).toHaveCount(0);
  });
});
