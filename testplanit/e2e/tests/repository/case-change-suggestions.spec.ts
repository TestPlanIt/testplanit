import type { Page } from "@playwright/test";
import { createRawDbClient } from "~/lib/rawDbClient";
import type { ApiHelper } from "../../fixtures/api.fixture";
import { expect, test } from "../../fixtures/index";

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
 * - A linked issue that changed, with no suggestion waiting, shows a notice
 *   that "Mark as up to date" clears.
 * - The repository's Suggested Change filter lists only cases with a
 *   suggestion waiting.
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

  test("an issue that changed without a suggestion shows a notice that can be cleared", async ({
    page,
    api,
  }) => {
    const seeded = await seedLinkedCase(api, uid());
    // The case was brought in line with the issue an hour ago, and the
    // issue's text changes now.
    await db.repositoryCaseIssue.update({
      where: {
        caseId_issueId: { caseId: seeded.caseId, issueId: seeded.issueId },
      },
      data: { alignedAt: new Date(Date.now() - 60 * 60 * 1000) },
    });
    await db.issue.update({
      where: { id: seeded.issueId },
      data: { description: "Totals must include tax" },
    });
    const notice = page.getByTestId(`case-issue-changed-${seeded.issueId}`);

    await openCase(page, seeded.projectId, seeded.caseId);
    await expect(notice).toBeVisible();
    await expect(notice).toContainText(seeded.issueName);
    await page.getByTestId(`case-issue-mark-aligned-${seeded.issueId}`).click();
    await expect(notice).toBeHidden();

    await page.reload();
    await page.waitForLoadState("load");
    await expect(page.getByText(seeded.caseName).first()).toBeVisible();
    await expect(notice).toHaveCount(0);
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
});
