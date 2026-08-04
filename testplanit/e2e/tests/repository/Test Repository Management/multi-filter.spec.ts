import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../../../fixtures";
import { RepositoryPage } from "../../../page-objects/repository/repository.page";
import { waitForStableBox } from "../../../utils/wait-for-stable";

/**
 * Repository Multi-Dimension Filtering — FilterBar chip behaviour
 *
 * The ViewSelector is now a pure "View by" GROUPING control; all filtering
 * state lives in the FilterBar's chips and is serialized to repeated `?f=`
 * query params (`dimension:operator:v1,v2`).
 *
 * Covered here:
 *  - implicit AND across dimensions (OR within a dimension)
 *  - the full chip lifecycle: add → edit values → change operator → remove →
 *    Clear all
 *  - ViewSelector option rows toggle a chip, highlight while active, and axis
 *    switching NEVER clears the active filters (the key behaviour change)
 *  - contradiction resolution: a bare "None" predicate and a value-asserting
 *    predicate on the same dimension are mutually exclusive, while
 *    "has tag A but not tag B" still coexists
 *
 * Every test seeds its own project — no cross-test ordering dependencies.
 */

function chip(page: Page, dimension: string, operator: string): Locator {
  return page.getByTestId(`filter-chip-${dimension}-${operator}`);
}

function chipRemove(page: Page, dimension: string, operator: string): Locator {
  return page.getByTestId(`filter-chip-${dimension}-${operator}-remove`);
}

function caseRow(page: Page, caseId: number): Locator {
  return page.getByTestId(`case-row-${caseId}`);
}

/** The `f` params exactly as the address bar carries them right now. */
function fParams(page: Page): string[] {
  return new URL(page.url()).searchParams.getAll("f");
}

/**
 * The URL is written through `router.replace`, so it can land a tick after the
 * chip renders — poll instead of reading once.
 */
async function expectFParams(page: Page, expected: string[]): Promise<void> {
  await expect(async () => {
    expect(fParams(page).slice().sort()).toEqual(expected.slice().sort());
  }).toPass({ timeout: 10000 });
}

/** Closes whichever chip editor happens to be open, if any. */
async function ensureEditorClosed(page: Page): Promise<void> {
  const editor = page.getByTestId("filter-chip-editor");
  if (await editor.isVisible().catch(() => false)) {
    await page.keyboard.press("Escape");
    await expect(editor).toBeHidden({ timeout: 10000 });
  }
}

/** Opens the Add-filter picker and picks a dimension by its registry key. */
async function pickDimension(page: Page, dimensionKey: string): Promise<void> {
  await ensureEditorClosed(page);
  const addButton = page.getByTestId("filter-bar-add");
  await expect(addButton).toBeVisible({ timeout: 15000 });
  await addButton.click();

  const option = page.getByTestId(`filter-dimension-option-${dimensionKey}`);
  await expect(option).toBeVisible({ timeout: 10000 });
  await waitForStableBox(option);
  await option.click();

  // Dimensions whose seed predicate needs a value (templates/states) open as a
  // draft chip; committable seeds (tags → bare `any`) commit immediately. Both
  // leave the editor open.
  await expect(page.getByTestId("filter-chip-editor")).toBeVisible({
    timeout: 10000,
  });
}

/** Toggles one value in the open chip editor's value list. */
async function toggleValue(page: Page, id: number | string): Promise<void> {
  const option = page.getByTestId(`filter-value-option-${id}`);
  await expect(option).toBeVisible({ timeout: 15000 });
  await waitForStableBox(option);
  await option.click();
}

async function openChipEditor(
  page: Page,
  dimension: string,
  operator: string
): Promise<void> {
  // An operator change leaves the re-keyed chip's editor open, so clicking the
  // trigger blind would toggle it shut instead of opening it.
  await ensureEditorClosed(page);
  // The chip body is the popover trigger; the X is the second button.
  await chip(page, dimension, operator).getByRole("button").first().click();
  await expect(page.getByTestId("filter-chip-editor")).toBeVisible({
    timeout: 10000,
  });
}

/** Switches the "View by" grouping axis. */
async function selectViewAxis(page: Page, label: RegExp): Promise<void> {
  const trigger = page.getByTestId("view-selector-trigger");
  await expect(trigger).toBeVisible({ timeout: 15000 });
  await trigger.click();

  const option = page.locator('[role="option"]').filter({ hasText: label });
  await expect(option.first()).toBeVisible({ timeout: 10000 });
  await option.first().click();
  await page.waitForLoadState("networkidle");
}

/**
 * A ViewSelector option row. Rows are the only `[role="button"]` elements in
 * the left panel header (the Add-folder control is a real <button>, which the
 * attribute selector does not match).
 */
function viewRow(page: Page, text: string): Locator {
  return page
    .getByTestId("repository-left-panel-header")
    .locator('[role="button"]')
    .filter({ hasText: text })
    .first();
}

test.describe("Repository Multi-Dimension Filtering", () => {
  let repositoryPage: RepositoryPage;

  test.beforeEach(async ({ page }) => {
    repositoryPage = new RepositoryPage(page);
  });

  test("Chips on two dimensions AND together; removing one widens the set", async ({
    api,
    page,
  }) => {
    const ts = Date.now();
    let projectId!: number;
    let stateAId!: number;
    let tagId!: number;
    let caseBoth!: number;
    let caseStateOnly!: number;
    let caseTagOnly!: number;

    await test.step("Seed cases across two states with one shared tag", async () => {
      projectId = await api.createProject(`E2E MF And ${ts}`);
      const folderId = await api.getRootFolderId(projectId);
      const [stateA, stateB] = await api.getStateIds(projectId, 2);
      stateAId = stateA;

      tagId = await api.createTag(`mfand-${ts}`);

      caseBoth = await api.createTestCaseWithState(
        projectId,
        folderId,
        `MF And Both ${ts}`,
        stateA
      );
      caseStateOnly = await api.createTestCaseWithState(
        projectId,
        folderId,
        `MF And StateOnly ${ts}`,
        stateA
      );
      caseTagOnly = await api.createTestCaseWithState(
        projectId,
        folderId,
        `MF And TagOnly ${ts}`,
        stateB
      );

      await api.addTagToTestCase(caseBoth, tagId);
      await api.addTagToTestCase(caseTagOnly, tagId);
    });

    await test.step("Open the repository and confirm all three cases load", async () => {
      await repositoryPage.goto(projectId);
      await expect(caseRow(page, caseBoth)).toBeVisible({ timeout: 20000 });
      await expect(caseRow(page, caseStateOnly)).toBeVisible();
      await expect(caseRow(page, caseTagOnly)).toBeVisible();
    });

    await test.step("Add a State chip", async () => {
      await pickDimension(page, "states");
      await toggleValue(page, stateAId);
      await ensureEditorClosed(page);
      await expect(chip(page, "states", "in")).toBeVisible();
    });

    await test.step("Add a Tag chip on top", async () => {
      await pickDimension(page, "tags");
      await toggleValue(page, tagId);
      await ensureEditorClosed(page);
      await expect(chip(page, "tags", "any")).toBeVisible();
    });

    await test.step("Only the intersection remains and the results count matches", async () => {
      await expectFParams(page, [`states:in:${stateAId}`, `tags:any:${tagId}`]);

      await expect(caseRow(page, caseBoth)).toBeVisible({ timeout: 15000 });
      await expect(caseRow(page, caseStateOnly)).toBeHidden();
      await expect(caseRow(page, caseTagOnly)).toBeHidden();
      await expect(page.getByTestId("pagination-info")).toContainText("of 1", {
        timeout: 15000,
      });
    });

    await test.step("Removing the Tag chip widens the set back to the State filter", async () => {
      await chipRemove(page, "tags", "any").click();
      await expect(chip(page, "tags", "any")).toBeHidden();
      await expectFParams(page, [`states:in:${stateAId}`]);

      await expect(caseRow(page, caseBoth)).toBeVisible({ timeout: 15000 });
      await expect(caseRow(page, caseStateOnly)).toBeVisible();
      await expect(caseRow(page, caseTagOnly)).toBeHidden();
      await expect(page.getByTestId("pagination-info")).toContainText("of 2", {
        timeout: 15000,
      });
    });
  });

  test("Chip lifecycle: add, edit values, change operator, remove, Clear all", async ({
    api,
    page,
  }) => {
    const ts = Date.now();
    let projectId!: number;
    let stateAId!: number;
    let stateBId!: number;
    let tagAId!: number;
    let tagBId!: number;
    let caseA!: number;
    let caseAB!: number;
    let caseUntagged!: number;

    await test.step("Seed two states and two tags across three cases", async () => {
      projectId = await api.createProject(`E2E MF Lifecycle ${ts}`);
      const folderId = await api.getRootFolderId(projectId);
      const [stateA, stateB] = await api.getStateIds(projectId, 2);
      stateAId = stateA;
      stateBId = stateB;

      tagAId = await api.createTag(`mflifea-${ts}`);
      tagBId = await api.createTag(`mflifeb-${ts}`);

      caseA = await api.createTestCaseWithState(
        projectId,
        folderId,
        `MF Life A ${ts}`,
        stateA
      );
      caseAB = await api.createTestCaseWithState(
        projectId,
        folderId,
        `MF Life AB ${ts}`,
        stateB
      );
      caseUntagged = await api.createTestCaseWithState(
        projectId,
        folderId,
        `MF Life None ${ts}`,
        stateA
      );

      await api.addTagToTestCase(caseA, tagAId);
      await api.addTagToTestCase(caseAB, tagAId);
      await api.addTagToTestCase(caseAB, tagBId);
    });

    await test.step("Open the repository", async () => {
      await repositoryPage.goto(projectId);
      await expect(caseRow(page, caseA)).toBeVisible({ timeout: 20000 });
    });

    await test.step("Add a State chip from the Add-filter picker", async () => {
      await pickDimension(page, "states");
      await toggleValue(page, stateAId);
      await ensureEditorClosed(page);

      await expect(chip(page, "states", "in")).toBeVisible();
      await expectFParams(page, [`states:in:${stateAId}`]);
      await expect(caseRow(page, caseAB)).toBeHidden();
    });

    await test.step("Edit the chip's values — the second state ORs in", async () => {
      await openChipEditor(page, "states", "in");
      await toggleValue(page, stateBId);
      await ensureEditorClosed(page);

      await expectFParams(page, [`states:in:${stateAId},${stateBId}`]);
      await expect(caseRow(page, caseAB)).toBeVisible({ timeout: 15000 });
    });

    await test.step("Add a Tag chip and give it a value", async () => {
      await pickDimension(page, "tags");
      await toggleValue(page, tagAId);
      await ensureEditorClosed(page);

      await expect(chip(page, "tags", "any")).toBeVisible();
      await expectFParams(page, [
        `states:in:${stateAId},${stateBId}`,
        `tags:any:${tagAId}`,
      ]);
      await expect(caseRow(page, caseUntagged)).toBeHidden();
    });

    await test.step("Change the Tag chip's operator from Any of to All of", async () => {
      await openChipEditor(page, "tags", "any");

      await page.getByTestId("filter-operator-select").click();
      const allOf = page.locator('[role="option"]').filter({
        hasText: /^All of$/,
      });
      await expect(allOf.first()).toBeVisible({ timeout: 10000 });
      await allOf.first().click();

      // The chip re-keys on its operator, so its test id changes with it.
      await expect(chip(page, "tags", "all")).toBeVisible({ timeout: 10000 });
      await expect(chip(page, "tags", "any")).toBeHidden();
      await expectFParams(page, [
        `states:in:${stateAId},${stateBId}`,
        `tags:all:${tagAId}`,
      ]);
    });

    await test.step("A second value under All of narrows to the case carrying both tags", async () => {
      await openChipEditor(page, "tags", "all");
      await toggleValue(page, tagBId);
      await ensureEditorClosed(page);

      await expectFParams(page, [
        `states:in:${stateAId},${stateBId}`,
        `tags:all:${tagAId},${tagBId}`,
      ]);
      await expect(caseRow(page, caseAB)).toBeVisible({ timeout: 15000 });
      await expect(caseRow(page, caseA)).toBeHidden();
      await expect(caseRow(page, caseUntagged)).toBeHidden();
    });

    await test.step("Remove the State chip with its X — Clear all disappears below two chips", async () => {
      await expect(page.getByTestId("filter-bar-clear")).toBeVisible();

      await chipRemove(page, "states", "in").click();

      await expect(chip(page, "states", "in")).toBeHidden();
      await expectFParams(page, [`tags:all:${tagAId},${tagBId}`]);
      await expect(page.getByTestId("filter-bar-clear")).toBeHidden();
    });

    await test.step("Re-add a chip and Clear all wipes every filter", async () => {
      // Facet lists only carry values that still match, so with `tags:all`
      // active the only state left to pick is the one the surviving case sits
      // in (the State dimension self-excludes, not the Tag one).
      await pickDimension(page, "states");
      await toggleValue(page, stateBId);
      await ensureEditorClosed(page);
      await expect(chip(page, "states", "in")).toBeVisible();

      const clearAll = page.getByTestId("filter-bar-clear");
      await expect(clearAll).toBeVisible();
      await clearAll.click();

      await expect(chip(page, "states", "in")).toBeHidden();
      await expect(chip(page, "tags", "all")).toBeHidden();
      await expectFParams(page, []);

      await expect(caseRow(page, caseA)).toBeVisible({ timeout: 15000 });
      await expect(caseRow(page, caseAB)).toBeVisible();
      await expect(caseRow(page, caseUntagged)).toBeVisible();
    });
  });

  test("ViewSelector rows toggle chips, highlight, and survive an axis switch", async ({
    api,
    page,
  }) => {
    const ts = Date.now();
    const tagName = `mfview-${ts}`;
    let projectId!: number;
    let tagId!: number;
    let taggedCase!: number;
    let untaggedCase!: number;

    await test.step("Seed one tagged and one untagged case", async () => {
      projectId = await api.createProject(`E2E MF ViewAxis ${ts}`);
      const folderId = await api.getRootFolderId(projectId);

      tagId = await api.createTag(tagName);
      taggedCase = await api.createTestCase(
        projectId,
        folderId,
        `MF View Tagged ${ts}`
      );
      untaggedCase = await api.createTestCase(
        projectId,
        folderId,
        `MF View Untagged ${ts}`
      );
      await api.addTagToTestCase(taggedCase, tagId);
    });

    await test.step("Open the repository and switch the View-by axis to Tag", async () => {
      await repositoryPage.goto(projectId);
      await expect(caseRow(page, taggedCase)).toBeVisible({ timeout: 20000 });

      await selectViewAxis(page, /^Tag$/i);
      await expect(page).toHaveURL(/view=tags/, { timeout: 15000 });
    });

    await test.step("Clicking the tag row creates the matching chip and filters the table", async () => {
      const row = viewRow(page, tagName);
      await expect(row).toBeVisible({ timeout: 15000 });
      await row.click();

      await expect(chip(page, "tags", "any")).toBeVisible({ timeout: 15000 });
      await expectFParams(page, [`tags:any:${tagId}`]);

      await expect(caseRow(page, taggedCase)).toBeVisible({ timeout: 15000 });
      await expect(caseRow(page, untaggedCase)).toBeHidden();
    });

    await test.step("The row highlights while its value is filtered", async () => {
      await expect(viewRow(page, tagName)).toHaveClass(/bg-primary/, {
        timeout: 10000,
      });
    });

    await test.step("Switching the View-by axis does NOT clear the filter", async () => {
      await selectViewAxis(page, /^State$/i);
      await expect(page).toHaveURL(/view=states/, { timeout: 15000 });

      await expect(chip(page, "tags", "any")).toBeVisible();
      await expectFParams(page, [`tags:any:${tagId}`]);
      await expect(caseRow(page, taggedCase)).toBeVisible({ timeout: 15000 });
      await expect(caseRow(page, untaggedCase)).toBeHidden();

      // States carries no chip, so its "All ..." row reads as unfiltered.
      await expect(viewRow(page, "All States")).toHaveClass(/bg-primary/, {
        timeout: 10000,
      });
    });

    await test.step("Returning to the Tag axis still shows the row highlighted", async () => {
      await selectViewAxis(page, /^Tag$/i);
      await expect(viewRow(page, tagName)).toHaveClass(/bg-primary/, {
        timeout: 15000,
      });
      await expect(chip(page, "tags", "any")).toBeVisible();
    });
  });

  test("Contradictory predicates resolve; has-A-but-not-B still coexists", async ({
    api,
    page,
  }) => {
    const ts = Date.now();
    const tagAName = `mfconfa-${ts}`;
    let projectId!: number;
    let tagAId!: number;
    let tagBId!: number;
    let caseA!: number;
    let caseAB!: number;
    let caseNone!: number;

    await test.step("Seed cases with tag A, tags A+B, and no tags", async () => {
      projectId = await api.createProject(`E2E MF Conflict ${ts}`);
      const folderId = await api.getRootFolderId(projectId);

      tagAId = await api.createTag(tagAName);
      tagBId = await api.createTag(`mfconfb-${ts}`);

      caseA = await api.createTestCase(projectId, folderId, `MF Conf A ${ts}`);
      caseAB = await api.createTestCase(
        projectId,
        folderId,
        `MF Conf AB ${ts}`
      );
      caseNone = await api.createTestCase(
        projectId,
        folderId,
        `MF Conf None ${ts}`
      );

      await api.addTagToTestCase(caseA, tagAId);
      await api.addTagToTestCase(caseAB, tagAId);
      await api.addTagToTestCase(caseAB, tagBId);
    });

    await test.step("Open the Tag axis with a tag-value chip already applied", async () => {
      await page.goto(
        `/en-US/projects/repository/${projectId}?view=tags&f=tags:any:${tagAId}`
      );
      await repositoryPage.waitForRepositoryLoad();

      await expect(chip(page, "tags", "any")).toBeVisible({ timeout: 20000 });
      await expect(caseRow(page, caseA)).toBeVisible({ timeout: 15000 });
      await expect(caseRow(page, caseNone)).toBeHidden();
    });

    await test.step("Selecting No Tags clears the value chip — they are mutually exclusive", async () => {
      const noTagsRow = viewRow(page, "No Tags");
      await expect(noTagsRow).toBeVisible({ timeout: 15000 });
      await noTagsRow.click();

      await expect(chip(page, "tags", "none")).toBeVisible({ timeout: 15000 });
      await expect(chip(page, "tags", "any")).toBeHidden();
      await expectFParams(page, ["tags:none"]);

      await expect(caseRow(page, caseNone)).toBeVisible({ timeout: 15000 });
      await expect(caseRow(page, caseA)).toBeHidden();
      await expect(caseRow(page, caseAB)).toBeHidden();
    });

    await test.step("Selecting a tag value again clears the bare None chip", async () => {
      const tagRow = viewRow(page, tagAName);
      await expect(tagRow).toBeVisible({ timeout: 15000 });
      await tagRow.click();

      await expect(chip(page, "tags", "any")).toBeVisible({ timeout: 15000 });
      await expect(chip(page, "tags", "none")).toBeHidden();
      await expectFParams(page, [`tags:any:${tagAId}`]);

      await expect(caseRow(page, caseA)).toBeVisible({ timeout: 15000 });
      await expect(caseRow(page, caseAB)).toBeVisible();
      await expect(caseRow(page, caseNone)).toBeHidden();
    });

    await test.step("A valued none is not a contradiction: has tag A but not tag B", async () => {
      await page.goto(
        `/en-US/projects/repository/${projectId}?view=tags` +
          `&f=tags:any:${tagAId}&f=tags:none:${tagBId}`
      );
      await repositoryPage.waitForRepositoryLoad();

      await expect(chip(page, "tags", "any")).toBeVisible({ timeout: 20000 });
      await expect(chip(page, "tags", "none")).toBeVisible();

      await expect(caseRow(page, caseA)).toBeVisible({ timeout: 15000 });
      await expect(caseRow(page, caseAB)).toBeHidden();
      await expect(caseRow(page, caseNone)).toBeHidden();
      await expect(page.getByTestId("pagination-info")).toContainText("of 1", {
        timeout: 15000,
      });
    });
  });
});
