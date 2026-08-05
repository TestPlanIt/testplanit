import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { expect, test } from "../../../fixtures";
import { RepositoryPage } from "../../../page-objects/repository/repository.page";

/**
 * Repository Multi-Dimension Filtering — folder wall and facet counts
 *
 * The Elasticsearch box is not part of the repository view (it exists only in
 * the case-selection dialog, where Unified Search is unreachable), so its
 * intersection with the filter chips is covered by
 * es-search-selection-mode.spec.ts instead.
 *
 * Covered here:
 *  - an active filter bypasses the "select a folder" wall and queries the
 *    whole project
 *  - sidebar option counts are filter-aware, and the Dropdown "None" row never
 *    renders a negative number (it did before the counts engine derived
 *    hasValue/noValue from the same self-excluded base as the option counts)
 *
 * Every test seeds its own project — no cross-test ordering dependencies.
 */

function chip(page: Page, dimension: string, operator: string): Locator {
  return page.getByTestId(`filter-chip-${dimension}-${operator}`);
}

function caseRow(page: Page, caseId: number): Locator {
  return page.getByTestId(`case-row-${caseId}`);
}

async function selectViewAxis(
  page: Page,
  label: string | RegExp
): Promise<void> {
  const trigger = page.getByTestId("view-selector-trigger");
  await expect(trigger).toBeVisible({ timeout: 15000 });
  await trigger.click();

  const option = page.locator('[role="option"]').filter({ hasText: label });
  await expect(option.first()).toBeVisible({ timeout: 10000 });
  await option.first().click();
  await page.waitForLoadState("networkidle");
}

/** A ViewSelector option row (rows are the only [role="button"] in the header). */
function viewRow(page: Page, text: string): Locator {
  return page
    .getByTestId("repository-left-panel-header")
    .locator('[role="button"]')
    .filter({ hasText: text })
    .first();
}

/**
 * The count a ViewSelector row shows, or null while the row (or its count) is
 * not rendered yet. The count is the row's trailing token — rows have no
 * dedicated test id, so keep the labels passed in here digit-free.
 */
async function readRowCount(page: Page, text: string): Promise<number | null> {
  const row = viewRow(page, text);
  if (!(await row.isVisible().catch(() => false))) return null;
  const raw = (await row.innerText().catch(() => "")).trim();
  const last = raw.split(/\s+/).pop() ?? "";
  return /^-?\d+$/.test(last) ? Number(last) : null;
}

async function expectRowCount(
  page: Page,
  text: string,
  expected: number
): Promise<void> {
  await expect
    .poll(() => readRowCount(page, text), { timeout: 25000 })
    .toBe(expected);
}

/** Workflow names for ids already resolved through api.getStateIds. */
async function getStateNames(
  request: APIRequestContext,
  baseURL: string,
  stateIds: number[]
): Promise<Record<number, string>> {
  const response = await request.get(
    `${baseURL}/api/model/workflows/findMany`,
    {
      params: {
        q: JSON.stringify({
          where: { id: { in: stateIds } },
          select: { id: true, name: true },
        }),
      },
    }
  );
  expect(response.ok()).toBeTruthy();
  const result = await response.json();
  const byId: Record<number, string> = {};
  for (const row of result.data as Array<{ id: number; name: string }>) {
    byId[row.id] = row.name;
  }
  return byId;
}

test.describe("Repository Multi-Dimension Filtering - folder wall and counts", () => {
  let repositoryPage: RepositoryPage;

  test.beforeEach(async ({ page }) => {
    repositoryPage = new RepositoryPage(page);
  });

  test("An active filter bypasses the select-a-folder wall and reaches the whole project", async ({
    api,
    page,
  }) => {
    const ts = Date.now();
    let projectId!: number;
    let tagId!: number;
    let rootCase!: number;
    let nestedCase!: number;
    let untaggedCase!: number;

    await test.step("Seed tagged cases in the root folder and in a nested folder", async () => {
      projectId = await api.createProject(`E2E MF Wall ${ts}`);
      const rootFolderId = await api.getRootFolderId(projectId);
      // Nested under the root so the root stays the only top-level folder.
      const nestedFolderId = await api.createFolder(
        projectId,
        `MF Wall Nested Folder ${ts}`,
        rootFolderId
      );

      tagId = await api.createTag(`mfwall-${ts}`);

      rootCase = await api.createTestCase(
        projectId,
        rootFolderId,
        `MF Wall Root ${ts}`
      );
      nestedCase = await api.createTestCase(
        projectId,
        nestedFolderId,
        `MF Wall Nested ${ts}`
      );
      untaggedCase = await api.createTestCase(
        projectId,
        rootFolderId,
        `MF Wall Untagged ${ts}`
      );

      await api.addTagToTestCase(rootCase, tagId);
      await api.addTagToTestCase(nestedCase, tagId);
    });

    await test.step("Load a filtered URL with no folder selected", async () => {
      await page.goto(
        `/en-US/projects/repository/${projectId}?view=folders&f=tags:any:${tagId}`
      );
      await repositoryPage.waitForRepositoryLoad();

      await expect(chip(page, "tags", "any")).toBeVisible({ timeout: 20000 });
    });

    await test.step("The select-a-folder prompt never appears while a filter is active", async () => {
      await expect(
        page.getByText("Select a folder to add or display test cases.")
      ).toBeHidden({ timeout: 15000 });

      await expect(caseRow(page, rootCase)).toBeVisible({ timeout: 20000 });
      await expect(caseRow(page, untaggedCase)).toBeHidden();
    });

    await test.step("Cases from across the project match, not just one folder", async () => {
      // The folders grouping auto-selects the first root folder shortly after
      // mount (a grouping concern the spec deliberately keeps), which re-scopes
      // the table to that folder. Any non-folder grouping is project-wide, so
      // the cross-folder reach of the same chip is asserted there.
      await selectViewAxis(page, /^Template$/i);
      await expect(page).toHaveURL(/view=templates/, { timeout: 15000 });

      await expect(chip(page, "tags", "any")).toBeVisible();
      await expect(caseRow(page, rootCase)).toBeVisible({ timeout: 20000 });
      await expect(caseRow(page, nestedCase)).toBeVisible({ timeout: 20000 });
      await expect(caseRow(page, untaggedCase)).toBeHidden();
      await expect(page.getByTestId("pagination-info")).toContainText("of 2", {
        timeout: 15000,
      });
    });
  });

  test("Sidebar option counts reflect a chip on another dimension", async ({
    api,
    page,
    request,
    baseURL,
  }) => {
    const ts = Date.now();
    let projectId!: number;
    let tagId!: number;
    let stateAName!: string;
    let stateBName!: string;

    await test.step("Seed two states, one of which holds an untagged case", async () => {
      projectId = await api.createProject(`E2E MF Counts ${ts}`);
      const folderId = await api.getRootFolderId(projectId);
      const [stateAId, stateBId] = await api.getStateIds(projectId, 2);

      const names = await getStateNames(
        request,
        baseURL ?? "http://localhost:3000",
        [stateAId, stateBId]
      );
      stateAName = names[stateAId];
      stateBName = names[stateBId];
      expect(stateAName).toBeTruthy();
      expect(stateBName).toBeTruthy();

      tagId = await api.createTag(`mfcounts-${ts}`);

      const taggedInA = await api.createTestCaseWithState(
        projectId,
        folderId,
        `MF Counts A Tagged ${ts}`,
        stateAId
      );
      await api.createTestCaseWithState(
        projectId,
        folderId,
        `MF Counts A Untagged ${ts}`,
        stateAId
      );
      const taggedInB = await api.createTestCaseWithState(
        projectId,
        folderId,
        `MF Counts B Tagged ${ts}`,
        stateBId
      );

      await api.addTagToTestCase(taggedInA, tagId);
      await api.addTagToTestCase(taggedInB, tagId);
    });

    await test.step("Unfiltered, the State axis counts every case", async () => {
      await page.goto(`/en-US/projects/repository/${projectId}?view=states`);
      await repositoryPage.waitForRepositoryLoad();

      await expectRowCount(page, stateAName, 2);
      await expectRowCount(page, stateBName, 1);
    });

    await test.step("With a Tag chip active, the State counts shrink to the filtered set", async () => {
      await page.goto(
        `/en-US/projects/repository/${projectId}?view=states&f=tags:any:${tagId}`
      );
      await repositoryPage.waitForRepositoryLoad();

      await expect(chip(page, "tags", "any")).toBeVisible({ timeout: 20000 });
      await expectRowCount(page, stateAName, 1);
      await expectRowCount(page, stateBName, 1);
    });
  });

  test("The Dropdown None row stays non-negative while that field is filtered", async ({
    api,
    page,
    request,
    baseURL,
  }) => {
    const ts = Date.now();
    // Digit-free option labels: the row's count is read as its trailing token.
    const highLabel = "MF Counts High";
    const lowLabel = "MF Counts Low";
    const fieldName = `MF Counts Priority ${ts}`;

    let projectId!: number;
    let fieldId!: number;
    let highOptionId!: number;
    let lowOptionId!: number;
    let caseHigh!: number;
    let caseLow!: number;
    let caseNoValue!: number;

    await test.step("Seed a Dropdown field on a dedicated template with three cases", async () => {
      projectId = await api.createProject(`E2E MF None Count ${ts}`);
      const folderId = await api.getRootFolderId(projectId);

      fieldId = await api.createCaseField({
        displayName: fieldName,
        typeName: "Dropdown",
      });
      highOptionId = await api.createFieldOption({
        name: highLabel,
        caseFieldId: fieldId,
        order: 1,
      });
      lowOptionId = await api.createFieldOption({
        name: lowLabel,
        caseFieldId: fieldId,
        order: 2,
      });

      // A dedicated template keeps the new field out of every other project's
      // default template.
      const templateId = await api.createTemplate({
        name: `MF Counts Template ${ts}`,
        projectIds: [projectId],
        caseFieldIds: [fieldId],
      });

      caseHigh = await api.createTestCase(
        projectId,
        folderId,
        `MF None High ${ts}`,
        templateId
      );
      caseLow = await api.createTestCase(
        projectId,
        folderId,
        `MF None Low ${ts}`,
        templateId
      );
      caseNoValue = await api.createTestCase(
        projectId,
        folderId,
        `MF None Empty ${ts}`,
        templateId
      );

      // Option ids are stored as JSON numbers — the createTestCaseWithFieldValues
      // helper stringifies, which the option counters would not recognise.
      const setFieldValue = async (caseId: number, value: number) => {
        const response = await request.post(
          `${baseURL ?? "http://localhost:3000"}/api/model/caseFieldValues/create`,
          { data: { data: { testCaseId: caseId, fieldId, value } } }
        );
        expect(
          response.ok(),
          `failed to set field value on case ${caseId}`
        ).toBeTruthy();
      };
      await setFieldValue(caseHigh, highOptionId);
      await setFieldValue(caseLow, lowOptionId);
    });

    await test.step("Switch the View-by axis to the Dropdown field", async () => {
      await repositoryPage.goto(projectId);
      await expect(caseRow(page, caseNoValue)).toBeVisible({ timeout: 20000 });

      await selectViewAxis(page, fieldName);
      await expect(page).toHaveURL(/view=dynamic_/, { timeout: 15000 });

      await expectRowCount(page, "None", 1);
      await expectRowCount(page, highLabel, 1);
      await expectRowCount(page, lowLabel, 1);
    });

    await test.step("Filtering the field itself keeps every count non-negative", async () => {
      const highRow = viewRow(page, highLabel);
      await expect(highRow).toBeVisible({ timeout: 15000 });
      await highRow.click();

      await expect(chip(page, `field_${fieldId}`, "in")).toBeVisible({
        timeout: 20000,
      });
      await expect(async () => {
        const params = new URL(page.url()).searchParams;
        expect(params.getAll("f")).toEqual([
          `field_${fieldId}:in:${highOptionId}`,
        ]);
      }).toPass({ timeout: 15000 });

      await expect(caseRow(page, caseHigh)).toBeVisible({ timeout: 20000 });
      await expect(caseRow(page, caseLow)).toBeHidden();
      await expect(caseRow(page, caseNoValue)).toBeHidden();

      // The dimension self-excludes, so the option counts and the None row all
      // derive from the same base — the None row used to go negative here.
      await expectRowCount(page, "None", 1);
      await expectRowCount(page, lowLabel, 1);
      await expectRowCount(page, highLabel, 1);

      for (const label of ["None", highLabel, lowLabel]) {
        const count = await readRowCount(page, label);
        expect(count, `${label} count`).not.toBeNull();
        expect(count as number).toBeGreaterThanOrEqual(0);
      }
    });
  });
});
