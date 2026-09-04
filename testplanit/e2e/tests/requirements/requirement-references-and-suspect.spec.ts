import { expect, test } from "../../fixtures";

/**
 * Requirement references (related issues) and suspect links: a linked case
 * executed before the requirement's content changed is flagged suspect on
 * both panels until it is dismissed.
 */
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

test.describe("Requirement references and suspect links", () => {
  let projectId: number;
  let folderId: number;

  test.beforeEach(async ({ api }) => {
    projectId = await api.createProject(`E2E Req References ${uid()}`);
    await api.enableRequirements(projectId);
    folderId = await api.getRootFolderId(projectId);
  });

  test("adds and removes an internal issue reference", async ({
    api,
    page,
  }) => {
    const ts = uid();
    const requirementId = await api.createRequirement(
      projectId,
      `REQ-${ts}`,
      `Referencing requirement ${ts}`
    );
    const issueName = `REL-${ts}`;
    // The reference search matches title, description and external key, not
    // the internal name, so the dialog is searched by title.
    const issueTitle = `Related issue ${ts}`;
    const issueId = await api.createIssue(projectId, issueName, issueTitle);

    await page.goto(
      `/en-US/projects/requirements/${projectId}?requirement=${requirementId}`
    );
    const references = page.getByTestId("requirement-references");
    await expect(references).toBeVisible({ timeout: 15000 });
    await references.getByTestId("requirement-references-add").click();
    // The reference search dialog carries no root test id; it is the only
    // dialog open at this point.
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 10000 });
    // The search is index-backed, so a just-created issue can take a moment
    // to appear; retype until it does.
    const searchBox = dialog.getByRole("textbox").first();
    // Results are labelled by the issue's name, while the search matches its title.
    const result = dialog.getByText(issueName, { exact: false }).first();
    await expect(async () => {
      await searchBox.fill("");
      await searchBox.fill(issueTitle);
      await expect(result).toBeVisible({ timeout: 3000 });
    }).toPass({ timeout: 45000, intervals: [1000, 2000, 3000] });
    await result.click();
    await dialog.getByRole("button", { name: "Confirm Selection" }).click();
    await expect(dialog).toBeHidden({ timeout: 15000 });

    await expect(
      references.getByTestId(`requirement-reference-link-${issueId}`).first()
    ).toBeVisible({ timeout: 15000 });

    await references
      .getByTestId(`requirement-reference-remove-${issueId}`)
      .click();
    await page
      .getByTestId(`requirement-reference-remove-confirm-${issueId}`)
      .click();
    await expect(
      references.getByTestId(`requirement-reference-link-${issueId}`)
    ).toHaveCount(0, { timeout: 15000 });
  });

  test("flags a link as suspect after the requirement changes and dismisses it", async ({
    api,
    page,
    request,
    baseURL,
  }) => {
    const ts = uid();
    const requirementId = await api.createRequirement(
      projectId,
      `REQ-S-${ts}`,
      `Suspect requirement ${ts}`
    );
    const caseId = await api.createTestCase(
      projectId,
      folderId,
      `Executed case ${ts}`
    );
    await api.linkIssueToTestCase(requirementId, caseId);

    await test.step("Execute the case, then change the requirement's title", async () => {
      const runId = await api.createTestRun(projectId, `Suspect run ${ts}`);
      const runCaseId = await api.addTestCaseToTestRun(runId, caseId);
      await api.createTestResult(
        runId,
        runCaseId,
        await api.getStatusId("passed")
      );
      // The content trigger compares timestamps, so make sure the edit is later.
      await new Promise((resolve) => setTimeout(resolve, 1100));
      const res = await request.patch(`${baseURL}/api/model/issue/update`, {
        data: {
          where: { id: requirementId },
          data: { title: `Suspect requirement ${ts} (changed)` },
        },
      });
      expect(res.ok()).toBeTruthy();
    });

    await test.step("The requirement's linked-cases panel flags the case and can dismiss it", async () => {
      await page.goto(
        `/en-US/projects/requirements/${projectId}?requirement=${requirementId}`
      );
      const badge = page.getByTestId(
        `requirement-linked-case-suspect-${caseId}`
      );
      await expect(badge).toBeVisible({ timeout: 20000 });
      await badge.click();
      await page
        .getByTestId(`requirement-linked-case-suspect-confirm-${caseId}`)
        .click();
      await expect(badge).toBeHidden({ timeout: 15000 });
    });

    await test.step("The dismissal is stored on the link", async () => {
      const res = await request.get(
        `${baseURL}/api/model/repositoryCaseIssue/findFirst`,
        {
          params: {
            q: JSON.stringify({
              where: { caseId, issueId: requirementId },
              select: { suspectDismissedAt: true },
            }),
          },
        }
      );
      expect((await res.json()).data?.suspectDismissedAt).toBeTruthy();
    });
  });
});
