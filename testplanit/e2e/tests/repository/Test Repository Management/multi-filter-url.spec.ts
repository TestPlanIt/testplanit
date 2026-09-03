import type { Locator, Page } from "@playwright/test";
import {
  COMPRESSED_FILTER_PARAM,
  encodeFilterPredicatesForUrl,
  FILTER_URL_PARAM_BUDGET,
} from "~/lib/repository/filterUrlCodec";
import type { FilterPredicate } from "~/lib/schemas/repositoryFilterPredicates";
import { expect, test } from "../../../fixtures";
import { RepositoryPage } from "../../../page-objects/repository/repository.page";
import { waitForStableBox } from "../../../utils/wait-for-stable";

/**
 * Repository Multi-Dimension Filtering — URL persistence and sharing
 *
 * Filters are serialized to repeated `?f=dimension:operator:v1,v2` params so a
 * filtered view survives a reload and can be pasted to a colleague. Above
 * FILTER_URL_PARAM_BUDGET characters the readable form is replaced by a single
 * compressed `?fz=` param; readers accept either, and a set that shrinks back
 * under the budget returns to the readable form.
 *
 * Covered here:
 *  - chips applied in the UI write `f` params
 *  - reload restores both the chips and the filtered table
 *  - a hand-built `?f=` URL applies on a cold load
 *  - an over-budget filter set round-trips through `?fz=`, and drops back to
 *    `?f=` once it fits again
 */

function chip(page: Page, dimension: string, operator: string): Locator {
  return page.getByTestId(`filter-chip-${dimension}-${operator}`);
}

function caseRow(page: Page, caseId: number): Locator {
  return page.getByTestId(`case-row-${caseId}`);
}

function fParams(page: Page): string[] {
  return new URL(page.url()).searchParams.getAll("f");
}

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

async function pickDimension(page: Page, dimensionKey: string): Promise<void> {
  await ensureEditorClosed(page);
  const addButton = page.getByTestId("filter-bar-add");
  await expect(addButton).toBeVisible({ timeout: 15000 });

  // The dimension dropdown can dismiss itself mid-pick (a background refetch
  // re-renders the filter bar and the popover closes), stranding a one-shot
  // open-then-click sequence. Re-open and retry until the chip editor is up.
  // Only click Add while the dropdown is closed - clicking it with the menu
  // open would toggle it shut again.
  const option = page.getByTestId(`filter-dimension-option-${dimensionKey}`);
  const anyEditor = page.getByTestId("filter-chip-editor");
  // Only an editor for THIS dimension counts: a chip committed a moment ago
  // re-opens its own editor once the URL round-trip lands, and treating that
  // as "done" would skip the Add click and leave the wrong editor open.
  const editor = anyEditor.and(
    page.locator(`[data-dimension="${dimensionKey}"]`)
  );
  await expect(async () => {
    if (await editor.isVisible().catch(() => false)) return;
    if (await anyEditor.isVisible().catch(() => false)) {
      await page.keyboard.press("Escape");
      await expect(anyEditor).toBeHidden({ timeout: 3000 });
    }
    if (!(await option.isVisible().catch(() => false))) {
      await addButton.click({ timeout: 2000 });
      await expect(option).toBeVisible({ timeout: 3000 });
    }
    await option.click({ timeout: 2000 });
    await expect(editor).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 30000 });
}

async function toggleValue(page: Page, id: number | string): Promise<void> {
  const option = page.getByTestId(`filter-value-option-${id}`);
  await expect(option).toBeVisible({ timeout: 15000 });
  await waitForStableBox(option);
  await option.click();
}

test.describe("Repository Multi-Dimension Filtering - URL", () => {
  let repositoryPage: RepositoryPage;

  test.beforeEach(async ({ page }) => {
    repositoryPage = new RepositoryPage(page);
  });

  test("Chips serialize to ?f= params, survive a reload, and apply from a pasted URL", async ({
    api,
    page,
  }) => {
    const ts = Date.now();
    let projectId!: number;
    let stateAId!: number;
    let tagId!: number;
    let caseBoth!: number;
    let caseStateOnly!: number;
    let caseOther!: number;

    await test.step("Seed cases across two states with one shared tag", async () => {
      projectId = await api.createProject(`E2E MF Url ${ts}`);
      const folderId = await api.getRootFolderId(projectId);
      const [stateA, stateB] = await api.getStateIds(projectId, 2);
      stateAId = stateA;

      tagId = await api.createTag(`mfurl-${ts}`);

      caseBoth = await api.createTestCaseWithState(
        projectId,
        folderId,
        `MF Url Both ${ts}`,
        stateA
      );
      caseStateOnly = await api.createTestCaseWithState(
        projectId,
        folderId,
        `MF Url StateOnly ${ts}`,
        stateA
      );
      caseOther = await api.createTestCaseWithState(
        projectId,
        folderId,
        `MF Url Other ${ts}`,
        stateB
      );

      await api.addTagToTestCase(caseBoth, tagId);
    });

    await test.step("Apply a State chip and a Tag chip through the FilterBar", async () => {
      await repositoryPage.goto(projectId);
      await expect(caseRow(page, caseBoth)).toBeVisible({ timeout: 20000 });

      await pickDimension(page, "states");
      await toggleValue(page, stateAId);
      await ensureEditorClosed(page);

      await pickDimension(page, "tags");
      await toggleValue(page, tagId);
      await ensureEditorClosed(page);
    });

    await test.step("The address bar carries one f param per chip", async () => {
      await expectFParams(page, [`states:in:${stateAId}`, `tags:any:${tagId}`]);
      // Filter churn uses router.replace, so it must not pollute history.
      await expect(page).not.toHaveURL(/[?&]fz=/);
    });

    await test.step("Reloading restores the chips and the filtered table", async () => {
      await page.reload();
      await repositoryPage.waitForRepositoryLoad();

      await expect(chip(page, "states", "in")).toBeVisible({ timeout: 20000 });
      await expect(chip(page, "tags", "any")).toBeVisible();
      await expectFParams(page, [`states:in:${stateAId}`, `tags:any:${tagId}`]);

      await expect(caseRow(page, caseBoth)).toBeVisible({ timeout: 15000 });
      await expect(caseRow(page, caseStateOnly)).toBeHidden();
      await expect(caseRow(page, caseOther)).toBeHidden();
    });

    await test.step("A hand-built ?f= URL applies on a cold load", async () => {
      await page.goto(
        `/en-US/projects/repository/${projectId}?f=states:in:${stateAId}`
      );
      await repositoryPage.waitForRepositoryLoad();

      await expect(chip(page, "states", "in")).toBeVisible({ timeout: 20000 });
      await expect(chip(page, "tags", "any")).toBeHidden();

      await expect(caseRow(page, caseBoth)).toBeVisible({ timeout: 15000 });
      await expect(caseRow(page, caseStateOnly)).toBeVisible();
      await expect(caseRow(page, caseOther)).toBeHidden();
      await expect(page.getByTestId("pagination-info")).toContainText("of 2", {
        timeout: 15000,
      });
    });
  });

  test("An over-budget filter set round-trips through the compressed ?fz= param", async ({
    api,
    page,
  }) => {
    const ts = Date.now();
    let projectId!: number;
    let tagId!: number;
    let taggedCase!: number;
    let untaggedCase!: number;
    let compressed!: string;
    let readableTagParam!: string;

    await test.step("Seed one tagged and one untagged case", async () => {
      projectId = await api.createProject(`E2E MF Fz ${ts}`);
      const folderId = await api.getRootFolderId(projectId);

      tagId = await api.createTag(`mffz-${ts}`);
      taggedCase = await api.createTestCase(
        projectId,
        folderId,
        `MF Fz Tagged ${ts}`
      );
      untaggedCase = await api.createTestCase(
        projectId,
        folderId,
        `MF Fz Untagged ${ts}`
      );
      await api.addTagToTestCase(taggedCase, tagId);
    });

    await test.step("Build a filter set the readable form cannot carry", async () => {
      // The real tag id ORs in alongside ids that match nothing, and a
      // "none of these issues" chip that every case satisfies — so the set is
      // huge on the wire while still selecting exactly the tagged case.
      // MAX_VALUES_PER_PREDICATE is 200, so both chips sit exactly at the cap
      // and nothing is truncated.
      const padTagIds = Array.from({ length: 199 }, (_, i) => 9000001 + i);
      const padIssueIds = Array.from({ length: 200 }, (_, i) => 8000001 + i);

      const predicates: FilterPredicate[] = [
        { dimension: "tags", operator: "any", values: [tagId, ...padTagIds] },
        { dimension: "issues", operator: "none", values: padIssueIds },
      ];

      const encoding = encodeFilterPredicatesForUrl(predicates);
      expect(encoding.fLength).toBeGreaterThan(FILTER_URL_PARAM_BUDGET);
      expect(encoding.form).toBe(COMPRESSED_FILTER_PARAM);
      expect(encoding.compressed).toBeTruthy();
      expect(encoding.truncation.predicatesDropped).toBe(0);
      expect(encoding.truncation.valuesTruncated).toEqual([]);

      compressed = encoding.compressed!;
      readableTagParam = `tags:any:${[tagId, ...padTagIds].join(",")}`;
    });

    await test.step("The compressed link decodes back into both chips", async () => {
      await page.goto(
        `/en-US/projects/repository/${projectId}` +
          `?${COMPRESSED_FILTER_PARAM}=${compressed}`
      );
      await repositoryPage.waitForRepositoryLoad();

      await expect(chip(page, "tags", "any")).toBeVisible({ timeout: 20000 });
      await expect(chip(page, "issues", "none")).toBeVisible();

      await expect(caseRow(page, taggedCase)).toBeVisible({ timeout: 15000 });
      await expect(caseRow(page, untaggedCase)).toBeHidden();

      // The page re-states the filter family from its own predicates; the
      // compressed form must survive that round trip byte-for-byte.
      await expect(async () => {
        const params = new URL(page.url()).searchParams;
        expect(params.get(COMPRESSED_FILTER_PARAM)).toBe(compressed);
        expect(params.getAll("f")).toEqual([]);
      }).toPass({ timeout: 10000 });
    });

    await test.step("Reloading the compressed link keeps both chips", async () => {
      await page.reload();
      await repositoryPage.waitForRepositoryLoad();

      await expect(chip(page, "tags", "any")).toBeVisible({ timeout: 20000 });
      await expect(chip(page, "issues", "none")).toBeVisible();
      await expect(caseRow(page, taggedCase)).toBeVisible({ timeout: 15000 });
    });

    await test.step("Dropping back under the budget restores the readable f form", async () => {
      await page
        .getByTestId("filter-chip-issues-none-remove")
        .click({ timeout: 15000 });

      await expect(chip(page, "issues", "none")).toBeHidden();
      await expect(async () => {
        const params = new URL(page.url()).searchParams;
        expect(params.get(COMPRESSED_FILTER_PARAM)).toBeNull();
        expect(params.getAll("f")).toEqual([readableTagParam]);
      }).toPass({ timeout: 10000 });

      await expect(caseRow(page, taggedCase)).toBeVisible({ timeout: 15000 });
      await expect(caseRow(page, untaggedCase)).toBeHidden();
    });
  });
});
