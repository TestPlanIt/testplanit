import type { Page } from "@playwright/test";
import { createRawDbClient } from "~/lib/rawDbClient";
import type { ApiHelper } from "../../fixtures/api.fixture";
import { expect, test } from "../../fixtures/index";
import { selectRepositoryView } from "../../utils/view-selector";

/**
 * Suggested changes on a test case (projects/repository/[projectId]/[caseId]).
 *
 * A suggestion is written by the webhook worker after a linked issue's text
 * changes; here it is seeded straight to the database, as the worker would
 * leave it.
 *
 * - The case shows the suggestion with its issue, reason and the change.
 *   Apply saves it as an edit; Dismiss leaves the case alone.
 * - A suggestion made for an older version of the case cannot be applied.
 * - A link made by hand starts in line with its issue. Once the issue's text
 *   changes, with no suggestion waiting, the case shows a notice that "Mark
 *   as up to date" clears.
 * - The repository's Suggested Change filter lists only cases with a
 *   suggestion waiting, and its Suggested Change view counts both groups.
 * - The repository list marks a suggestion to decide, an AI draft nobody has
 *   confirmed, and a case behind a changed issue.
 * - A failed check's notification gives the reason and links to the
 *   project's webhooks.
 */

test.use({ storageState: "e2e/.auth/admin.json" });

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

test.describe("Suggested changes on a test case", () => {
  let db: ReturnType<typeof createRawDbClient>;

  test.beforeAll(() => {
    db = createRawDbClient();
  });

  test.afterAll(async () => {
    await db?.$disconnect();
  });

  async function seedLinkedCase(api: ApiHelper, label: string) {
    const projectId = await api.createProject(`E2E Suggestions ${label}`);
    const folderId = await api.getRootFolderId(projectId);
    const caseName = `Totals add up ${label}`;
    const caseId = await api.createTestCase(projectId, folderId, caseName);
    const issueName = `SUG-${label}`;
    const issueId = await api.createIssue(
      projectId,
      issueName,
      `Checkout totals ${label}`
    );
    await api.linkIssueToTestCase(issueId, caseId);
    const { templateId, currentVersion } =
      await db.repositoryCases.findUniqueOrThrow({
        where: { id: caseId },
        select: { templateId: true, currentVersion: true },
      });
    return {
      projectId,
      folderId,
      caseId,
      caseName,
      issueId,
      issueName,
      templateId,
      currentVersion,
    };
  }

  async function seedSuggestion(
    seeded: Awaited<ReturnType<typeof seedLinkedCase>>,
    extra: {
      kind?: "UPDATE" | "RETIRE";
      newName?: string;
      baseCaseVersion?: number;
    } = {}
  ) {
    const kind = extra.kind ?? "UPDATE";
    return db.caseChangeSuggestion.create({
      data: {
        projectId: seeded.projectId,
        caseId: seeded.caseId,
        issueId: seeded.issueId,
        baseCaseVersion: extra.baseCaseVersion ?? seeded.currentVersion,
        kind,
        rationale: "Totals must now include tax",
        ...(kind === "UPDATE"
          ? {
              proposed: {
                templateId: seeded.templateId,
                base: { name: seeded.caseName, fieldValues: {}, steps: [] },
                name: extra.newName ?? `${seeded.caseName} with tax`,
                fieldValues: {},
                steps: [
                  {
                    step: "Open the cart",
                    expectedResult: "The total includes tax",
                  },
                ],
              },
            }
          : {}),
      },
      select: { id: true },
    });
  }

  const openCase = async (page: Page, projectId: number, caseId: number) => {
    await page.goto(`/en-US/projects/repository/${projectId}/${caseId}`);
    await page.waitForLoadState("load");
  };

  /**
   * Change an issue's text once the database clock has passed the moment the
   * case was linked to it: the link is timed by the app's clock and the
   * change by the database's.
   */
  async function changeIssueText(
    caseId: number,
    issueId: number,
    description: string
  ) {
    await expect
      .poll(async () => {
        const rows = (await db.$queryRaw`
          select now() > "alignedAt" as later
          from "RepositoryCaseIssue"
          where "caseId" = ${caseId} and "issueId" = ${issueId}`) as {
          later: boolean | null;
        }[];
        return rows[0]?.later;
      })
      .toBe(true);
    await db.issue.update({ where: { id: issueId }, data: { description } });
  }

  test("applying a suggested change saves it to the test case", async ({
    page,
    api,
  }) => {
    const seeded = await seedLinkedCase(api, uid());
    const newName = `${seeded.caseName} with tax`;
    const { id } = await seedSuggestion(seeded, { newName });
    const banner = page.getByTestId(`case-suggestion-${id}`);

    await test.step("The case shows the suggestion, its issue and the change", async () => {
      await openCase(page, seeded.projectId, seeded.caseId);
      await expect(banner).toBeVisible();
      await expect(banner).toContainText("AI suggests changing this test case");
      await expect(banner).toContainText(seeded.issueName);
      await expect(page.getByTestId(`case-suggestion-apply-${id}`)).toHaveCount(
        0
      );
      await page.getByTestId(`case-suggestion-toggle-${id}`).click();
      await expect(banner).toContainText("Totals must now include tax");
      const changes = page.getByTestId(`case-suggestion-changes-${id}`);
      await expect(changes).toContainText("with tax");
      await expect(changes).toContainText("Open the cart");
    });

    await test.step("Apply rewrites the case and closes the suggestion", async () => {
      await page.getByTestId(`case-suggestion-apply-${id}`).click();
      await expect(banner).toBeHidden();
      await expect(page.getByText(newName).first()).toBeVisible();
      await expect(page.getByText("The total includes tax")).toBeVisible();

      const saved = await db.repositoryCases.findUniqueOrThrow({
        where: { id: seeded.caseId },
        select: {
          name: true,
          currentVersion: true,
          reviewedById: true,
          steps: { where: { isDeleted: false }, select: { id: true } },
        },
      });
      expect(saved.name).toBe(newName);
      expect(saved.currentVersion).toBe(seeded.currentVersion + 1);
      expect(saved.steps).toHaveLength(1);
      expect(saved.reviewedById).toBe(await api.getCurrentUserId());
      const decided = await db.caseChangeSuggestion.findUniqueOrThrow({
        where: { id },
        select: { status: true },
      });
      expect(decided.status).toBe("APPLIED");
    });
  });

  test("dismissing a suggested change leaves the test case as it is", async ({
    page,
    api,
  }) => {
    const seeded = await seedLinkedCase(api, uid());
    const { id } = await seedSuggestion(seeded);
    const banner = page.getByTestId(`case-suggestion-${id}`);

    await openCase(page, seeded.projectId, seeded.caseId);
    await expect(banner).toBeVisible();
    await page.getByTestId(`case-suggestion-toggle-${id}`).click();
    await page.getByTestId(`case-suggestion-dismiss-${id}`).click();
    await expect(banner).toBeHidden();

    const saved = await db.repositoryCases.findUniqueOrThrow({
      where: { id: seeded.caseId },
      select: { name: true, currentVersion: true },
    });
    expect(saved).toEqual({
      name: seeded.caseName,
      currentVersion: seeded.currentVersion,
    });
    const decided = await db.caseChangeSuggestion.findUniqueOrThrow({
      where: { id },
      select: { status: true },
    });
    expect(decided.status).toBe("DISMISSED");

    await test.step("It stays dismissed after a reload", async () => {
      await page.reload();
      await page.waitForLoadState("load");
      await expect(page.getByText(seeded.caseName).first()).toBeVisible();
      await expect(page.getByTestId("case-suggestions")).toHaveCount(0);
    });
  });

  test("a suggestion to delete a test case deletes it when applied", async ({
    page,
    api,
  }) => {
    const seeded = await seedLinkedCase(api, uid());
    const { id } = await seedSuggestion(seeded, { kind: "RETIRE" });
    const banner = page.getByTestId(`case-suggestion-${id}`);

    await openCase(page, seeded.projectId, seeded.caseId);
    await expect(banner).toContainText("AI suggests deleting this test case");
    await page.getByTestId(`case-suggestion-toggle-${id}`).click();
    await page.getByTestId(`case-suggestion-delete-${id}`).click();
    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toContainText("Delete Test Case");
    await confirm.getByRole("button", { name: "Delete" }).click();
    await expect(page).toHaveURL(
      new RegExp(`/projects/repository/${seeded.projectId}(\\?|$)`)
    );

    await expect
      .poll(async () => {
        const saved = await db.repositoryCases.findUniqueOrThrow({
          where: { id: seeded.caseId },
          select: { isDeleted: true },
        });
        return saved.isDeleted;
      })
      .toBe(true);
  });

  test("a suggestion made for an older version of the case cannot be applied", async ({
    page,
    api,
  }) => {
    const seeded = await seedLinkedCase(api, uid());
    const { id } = await seedSuggestion(seeded, {
      baseCaseVersion: seeded.currentVersion - 1,
    });

    await openCase(page, seeded.projectId, seeded.caseId);
    await page.getByTestId(`case-suggestion-toggle-${id}`).click();
    await expect(page.getByTestId(`case-suggestion-stale-${id}`)).toBeVisible();
    await expect(page.getByTestId(`case-suggestion-apply-${id}`)).toHaveCount(
      0
    );
    await expect(
      page.getByTestId(`case-suggestion-regenerate-${id}`)
    ).toBeVisible();
    await expect(
      page.getByTestId(`case-suggestion-dismiss-${id}`)
    ).toBeVisible();
  });

  test("a link made by hand shows a notice once the issue's text changes, and the notice can be cleared", async ({
    page,
    api,
  }) => {
    const seeded = await seedLinkedCase(api, uid());
    const notice = page.getByTestId(`case-issue-changed-${seeded.issueId}`);

    await test.step("Nothing is flagged while the issue reads as it did when it was linked", async () => {
      await openCase(page, seeded.projectId, seeded.caseId);
      await expect(page.getByText(seeded.caseName).first()).toBeVisible();
      await expect(notice).toHaveCount(0);
    });

    await changeIssueText(
      seeded.caseId,
      seeded.issueId,
      "Totals must include tax"
    );

    await page.reload();
    await page.waitForLoadState("load");
    await expect(notice).toBeVisible();
    await expect(notice).toContainText(seeded.issueName);
    await page.getByTestId(`case-issue-mark-aligned-${seeded.issueId}`).click();
    await expect(notice).toBeHidden();

    await page.reload();
    await page.waitForLoadState("load");
    await expect(page.getByText(seeded.caseName).first()).toBeVisible();
    await expect(notice).toHaveCount(0);
  });

  test("saving the test case keeps its link to a tracker issue, so the notice stays", async ({
    page,
    api,
    request,
    baseURL,
  }) => {
    const label = uid();
    const projectId = await api.createProject(`E2E Suggestions ${label}`);
    const folderId = await api.getRootFolderId(projectId);
    const caseName = `Totals add up ${label}`;
    const caseId = await api.createTestCase(projectId, folderId, caseName);

    // An issue the case form's Issues field owns: one a tracker is behind.
    const integration = await request.post(`${baseURL}/api/integrations`, {
      data: {
        name: `E2E Simple links ${label}`,
        type: "SIMPLE_URL",
        authType: "NONE",
        config: { baseUrl: "https://tracker.example.com/{issueId}" },
      },
    });
    expect(integration.status()).toBe(201);
    const integrationId = (await integration.json()).id as number;
    const assigned = await request.post(
      `${baseURL}/api/model/projectIntegration/create`,
      {
        data: {
          data: {
            project: { connect: { id: projectId } },
            integration: { connect: { id: integrationId } },
            isActive: true,
          },
        },
      }
    );
    expect(assigned.ok()).toBe(true);
    const issueName = `TRK-${label}`;
    const issueId = await api.createSyncedIssue(projectId, integrationId, {
      name: issueName,
      title: `Checkout totals ${label}`,
    });
    await api.linkIssueToTestCase(issueId, caseId);
    await changeIssueText(caseId, issueId, "Totals must include tax");
    const linkAlignedAt = async () =>
      (
        await db.repositoryCaseIssue.findUniqueOrThrow({
          where: { caseId_issueId: { caseId, issueId } },
          select: { alignedAt: true },
        })
      ).alignedAt?.getTime();
    const alignedBefore = await linkAlignedAt();
    expect(alignedBefore).toBeTruthy();
    const notice = page.getByTestId(`case-issue-changed-${issueId}`);
    const newName = `${caseName} with tax`;

    await openCase(page, projectId, caseId);
    await expect(notice).toBeVisible();

    await test.step("Rename the test case and save it", async () => {
      const editButton = page.getByTestId("edit-test-case-button").first();
      await editButton.click();
      const nameField = page.locator("textarea").first();
      await expect(nameField).toBeVisible();
      await nameField.fill(newName);
      await page.locator('button[type="submit"]').first().click();
      await expect(editButton).toBeVisible({ timeout: 15000 });
      await expect(page.getByText(newName).first()).toBeVisible();
    });

    await test.step("The link is the same row, and the notice is still there", async () => {
      await expect
        .poll(async () => {
          const saved = await db.repositoryCases.findUniqueOrThrow({
            where: { id: caseId },
            select: { name: true },
          });
          return saved.name;
        })
        .toBe(newName);
      expect(await linkAlignedAt()).toBe(alignedBefore);
      await page.reload();
      await page.waitForLoadState("load");
      await expect(notice).toBeVisible();
    });
  });

  test("the Suggested Change filter lists only test cases with a suggestion waiting", async ({
    page,
    api,
  }) => {
    const seeded = await seedLinkedCase(api, uid());
    await seedSuggestion(seeded);
    const otherName = `No suggestion ${uid()}`;
    await api.createTestCase(seeded.projectId, seeded.folderId, otherName);

    await page.goto(
      `/en-US/projects/repository/${seeded.projectId}?f=suggestions:is:1`
    );
    await page.waitForLoadState("load");
    await expect(page.getByTestId("filter-chip-suggestions-is")).toBeVisible();
    await expect(page.getByText(seeded.caseName).first()).toBeVisible();
    await expect(page.getByText(otherName)).toHaveCount(0);
  });

  test("the Suggested Change view counts the cases with and without a suggestion, and its rows filter the list", async ({
    page,
    api,
  }) => {
    const seeded = await seedLinkedCase(api, uid());
    await seedSuggestion(seeded);
    const otherName = `No suggestion ${uid()}`;
    await api.createTestCase(seeded.projectId, seeded.folderId, otherName);
    const waitingRow = page
      .locator('[role="button"]')
      .filter({ hasText: /^Waiting\s*\d+$/ });
    const noneRow = page
      .locator('[role="button"]')
      .filter({ hasText: /^None\s*\d+$/ });

    await test.step("Switching to the view lists both groups and filters nothing", async () => {
      await page.goto(`/en-US/projects/repository/${seeded.projectId}`);
      await page.waitForLoadState("load");
      await selectRepositoryView(page, /Suggested Change/);
      await expect(page).toHaveURL(/view=suggestions/);
      await expect(waitingRow).toHaveText(/1$/);
      await expect(noneRow).toHaveText(/1$/);
      await expect(page.getByTestId("filter-chip-suggestions-is")).toHaveCount(
        0
      );
      await expect(page.getByText(seeded.caseName).first()).toBeVisible();
      await expect(page.getByText(otherName).first()).toBeVisible();
    });

    await test.step("The Waiting row filters the list to the case with a suggestion", async () => {
      await waitingRow.click();
      await expect(
        page.getByTestId("filter-chip-suggestions-is")
      ).toBeVisible();
      await expect(page).toHaveURL(/f=suggestions(:|%3A)is(:|%3A)1/);
      await expect(page.getByText(seeded.caseName).first()).toBeVisible();
      await expect(page.getByText(otherName)).toHaveCount(0);
    });
  });

  test("the list marks suggestions, unconfirmed AI drafts and cases behind a changed issue", async ({
    page,
    api,
  }) => {
    const label = uid();
    const changed = await seedLinkedCase(api, label);
    await seedSuggestion(changed);
    const { projectId, folderId, issueId } = changed;
    let aiStateId: number | undefined;

    const addCase = async (name: string) => {
      const caseId = await api.createTestCase(projectId, folderId, name);
      const { currentVersion } = await db.repositoryCases.findUniqueOrThrow({
        where: { id: caseId },
        select: { currentVersion: true },
      });
      return { caseId, currentVersion };
    };
    const row = (name: string) => page.locator("tr").filter({ hasText: name });

    try {
      const retireName = `Remember me ${label}`;
      const retire = await addCase(retireName);
      await api.linkIssueToTestCase(issueId, retire.caseId);
      await db.caseChangeSuggestion.create({
        data: {
          projectId,
          caseId: retire.caseId,
          issueId,
          baseCaseVersion: retire.currentVersion,
          kind: "RETIRE",
        },
      });

      // A state of its own for the unconfirmed draft, switched off so no
      // other spec's rule drafts into it.
      const draftName = `Discount applies ${label}`;
      const draft = await addCase(draftName);
      const look = await db.workflows.findFirstOrThrow({
        where: { scope: "CASES", isDeleted: false },
        select: { iconId: true, colorId: true },
      });
      const aiState = await db.workflows.create({
        data: {
          name: `AI drafts ${label}`,
          scope: "CASES",
          workflowType: "NOT_STARTED",
          isEnabled: false,
          isAiDraft: true,
          iconId: look.iconId,
          colorId: look.colorId,
          projects: { create: [{ projectId }] },
        },
        select: { id: true },
      });
      aiStateId = aiState.id;
      await db.repositoryCases.update({
        where: { id: draft.caseId },
        data: { stateId: aiState.id, aiWrittenVersion: draft.currentVersion },
      });

      const behindName = `Receipt is itemized ${label}`;
      const behind = await addCase(behindName);
      const receiptsIssueId = await api.createIssue(
        projectId,
        `RCP-${label}`,
        `Receipts ${label}`
      );
      await api.linkIssueToTestCase(receiptsIssueId, behind.caseId);
      await changeIssueText(
        behind.caseId,
        receiptsIssueId,
        "Receipts must itemize tax"
      );

      const plainName = `Cart empties ${label}`;
      await addCase(plainName);

      await page.goto(`/en-US/projects/repository/${projectId}`);
      await page.waitForLoadState("load");

      await expect(
        row(changed.caseName).getByTestId("ai-attention-badge")
      ).toHaveAttribute("aria-label", "AI suggests changing this test case");
      await expect(
        row(retireName).getByTestId("ai-attention-badge")
      ).toHaveAttribute("aria-label", "AI suggests deleting this test case");
      await expect(
        row(draftName).getByTestId("ai-attention-badge")
      ).toHaveAttribute(
        "aria-label",
        "AI wrote this test case and nobody has confirmed it yet"
      );
      await expect(
        row(behindName).getByTestId("issue-changed-badge")
      ).toHaveAttribute(
        "aria-label",
        "A linked issue changed and this test case has not been checked against the new text"
      );
      await expect(
        row(behindName).getByTestId("ai-attention-badge")
      ).toHaveCount(0);
      await expect(row(plainName)).toBeVisible();
      await expect(
        row(plainName).getByTestId("ai-attention-badge")
      ).toHaveCount(0);
      await expect(
        row(plainName).getByTestId("issue-changed-badge")
      ).toHaveCount(0);
    } finally {
      if (aiStateId) {
        await db.workflows
          .update({ where: { id: aiStateId }, data: { isDeleted: true } })
          .catch(() => {});
      }
    }
  });

  test("a failed check's notification gives the reason and links to the project's webhooks", async ({
    page,
    api,
  }) => {
    const label = uid();
    const projectId = await api.createProject(`E2E Failed check ${label}`);
    const issueKey = `FAIL-${label}`;
    const reason = "The model did not answer";
    await db.notification.create({
      data: {
        userId: await api.getCurrentUserId(),
        type: "CASES_UPDATED",
        title: "Test cases could not be updated",
        message: `Test cases for ${issueKey} could not be checked against its new text: ${reason}`,
        relatedEntityType: "Issue",
        data: {
          kind: "failed",
          projectId,
          projectName: `E2E Failed check ${label}`,
          issueKey,
          issueTitle: `Checkout totals ${label}`,
          detail: reason,
        },
      },
    });

    await page.goto(`/en-US/projects/repository/${projectId}`);
    await page.waitForLoadState("load");
    await page.getByTestId("notification-bell-button").first().click();
    const item = page
      .locator("[data-notification-item]")
      .filter({ hasText: issueKey });
    await expect(item).toBeVisible();
    await expect(item).toContainText("Test Cases Could Not Be Updated");
    await expect(item).toContainText(
      `The test cases for ${issueKey} could not be checked against its new text.`
    );
    await expect(item).toContainText(`Reason: ${reason}`);
    await expect(item.getByText("View the test cases")).toHaveCount(0);

    await item
      .getByRole("link", { name: "View the project's webhooks" })
      .click();
    await expect(page).toHaveURL(
      new RegExp(`/projects/settings/${projectId}/webhooks`)
    );
  });
});
