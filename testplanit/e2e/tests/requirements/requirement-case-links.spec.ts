import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../../fixtures";

/**
 * Requirement <-> test case links, from both sides.
 *
 * A requirement's Linked Cases panel adds and removes links from the
 * requirements workspace; a case's Linked Requirements panel does the same
 * from the repository case page. Both dialogs pick through the shared
 * AsyncCombobox, which exposes no test id on its trigger or options, so the
 * picker is driven by role and text.
 */
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function pickFromCombobox(
  dialog: Locator,
  page: Page,
  search: string
): Promise<void> {
  await dialog.getByRole("combobox").click();
  const input = page.locator("[cmdk-input]").last();
  await expect(input).toBeVisible({ timeout: 10000 });
  await input.fill(search);
  const option = page.getByRole("option", { name: new RegExp(search) }).first();
  await expect(option).toBeVisible({ timeout: 15000 });
  await option.click();
}

test.describe("Requirement case links", () => {
  let projectId: number;
  let folderId: number;

  test.beforeEach(async ({ api }) => {
    projectId = await api.createProject(`E2E Req Links ${uid()}`);
    await api.enableRequirements(projectId);
    folderId = await api.getRootFolderId(projectId);
  });

  test("links and unlinks a case from the requirement's panel", async ({
    api,
    page,
  }) => {
    const ts = uid();
    const caseName = `Linkable case ${ts}`;
    const caseId = await api.createTestCase(projectId, folderId, caseName);
    const requirementId = await api.createRequirement(
      projectId,
      `REQ-${ts}`,
      `Requirement with links ${ts}`
    );

    await test.step("Open the requirement and add the case through the dialog", async () => {
      await page.goto(
        `/en-US/projects/requirements/${projectId}?requirement=${requirementId}`
      );
      const linkedCases = page.getByTestId("requirement-linked-cases");
      await expect(linkedCases).toBeVisible({ timeout: 15000 });
      await linkedCases.getByTestId("requirement-linked-cases-add").click();

      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible({ timeout: 10000 });
      await pickFromCombobox(dialog, page, caseName);
      await dialog.getByTestId("requirement-linked-cases-submit").click();
      await expect(dialog).toBeHidden({ timeout: 15000 });
    });

    await test.step("The link shows in the Linked Cases table and the coverage panel", async () => {
      await expect(
        page.getByTestId("requirement-linked-cases").getByText(caseName)
      ).toBeVisible({ timeout: 15000 });
      await expect(
        page.getByTestId(`requirement-covering-case-${caseId}`)
      ).toBeVisible({ timeout: 15000 });
    });

    await test.step("Remove the link and confirm", async () => {
      await page
        .getByTestId(`requirement-linked-case-remove-${caseId}`)
        .click();
      await page
        .getByTestId(`requirement-linked-case-remove-confirm-${caseId}`)
        .click();
      await expect(
        page.getByTestId("requirement-linked-cases").getByText(caseName)
      ).toBeHidden({ timeout: 15000 });
      await expect(
        page.getByTestId(`requirement-covering-case-${caseId}`)
      ).toHaveCount(0);
    });
  });

  test("shows, adds and removes requirements from the case's panel", async ({
    api,
    page,
  }) => {
    const ts = uid();
    const caseId = await api.createTestCase(
      projectId,
      folderId,
      `Case with requirements ${ts}`
    );
    const linkedName = `REQ-L-${ts}`;
    const linkedId = await api.createRequirement(
      projectId,
      linkedName,
      `Already linked ${ts}`
    );
    const extraName = `REQ-X-${ts}`;
    const extraId = await api.createRequirement(
      projectId,
      extraName,
      `Added from case ${ts}`
    );
    await api.linkIssueToTestCase(linkedId, caseId);

    await test.step("The case page lists the requirement linked through the API", async () => {
      await page.goto(`/en-US/projects/repository/${projectId}/${caseId}`);
      const panel = page.getByTestId("case-linked-requirements");
      await expect(panel).toBeVisible({ timeout: 20000 });
      await expect(
        panel.getByTestId(`linked-requirement-name-${linkedId}`)
      ).toContainText(linkedName, { timeout: 15000 });
    });

    await test.step("Add a second requirement through the dialog", async () => {
      await page.getByTestId("case-linked-requirements-add").click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible({ timeout: 10000 });
      await pickFromCombobox(dialog, page, extraName);
      await dialog.getByTestId("case-linked-requirements-submit").click();
      await expect(dialog).toBeHidden({ timeout: 15000 });
      await expect(
        page.getByTestId(`linked-requirement-name-${extraId}`)
      ).toContainText(extraName, { timeout: 15000 });
    });

    await test.step("Remove the first link and confirm", async () => {
      await page
        .getByTestId(`case-linked-requirement-remove-${linkedId}`)
        .click();
      await page
        .getByTestId(`case-linked-requirement-remove-confirm-${linkedId}`)
        .click();
      await expect(
        page.getByTestId(`linked-requirement-name-${linkedId}`)
      ).toBeHidden({ timeout: 15000 });
      await expect(
        page.getByTestId(`linked-requirement-name-${extraId}`)
      ).toBeVisible();
    });
  });
});
