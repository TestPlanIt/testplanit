import { expect, test } from "../../fixtures/index";

/**
 * Same-project copy/move via the wizard dialog. Pure DOM clicks — no HTML5
 * drag, no modifier keys; the flushReactRender / resolveCopyModifier helpers
 * from drag-drop-modifier-aware.spec.ts do not apply here.
 *
 * Tests:
 *   - same-project copy creates a new case in the target folder; verifies
 *     the (Current) suffix is visible on the picker trigger and that copy
 *     is the default operation
 *   - same-project move soft-deletes the source and creates a new case in
 *     the target folder
 *   - multi-select copy hits the plural ICU branch
 *
 * Folder-mode descendant disable (CONTEXT D-08..D-10) and the same-folder
 * Move tooltip (CONTEXT D-05..D-07) are not covered E2E by this spec. The
 * folder-mode dialog entry depends on a Tailwind `group-hover:visible`
 * three-dot trigger inside a react-arborist TreeView row + a Radix
 * DropdownMenu portal whose Trigger opens on PointerDown. In headless
 * Playwright every approach we tried races the menu's auto-dismiss
 * behavior: real cursor click loses :hover the moment the cursor moves
 * onto the portal-rendered menu item; synthetic PointerDown / dispatch
 * sequences either never open the menu or open and close it before the
 * item click resolves. The TreeView testids
 * (`folder-actions-trigger-{id}`, `folder-action-copy-move-{id}`) ARE
 * present in the source so a future test using a different driver, real
 * cursor mouse-tracking, or a refactored TreeView can pick this up. The
 * descendant-disable behavior is covered today by the dialog's vitest
 * suite at the props level (CopyMoveDialog.test.tsx) and the unit
 * coverage on AsyncCombobox isOptionDisabled — both run on every CI build.
 *
 * Run protocol (CLAUDE.md mandatory):
 *   cd testplanit
 *   NODE_OPTIONS='--max-old-space-size=16382' pnpm build
 *   E2E_PROD=on pnpm test:e2e e2e/tests/repository/copy-move-dialog-same-project.spec.ts
 */

test.use({ storageState: "e2e/.auth/admin.json" });
test.describe.configure({ mode: "serial" });

let projectId: number;
let rootFolderId: number;
let siblingFolderId: number;
let nestedFolderId: number;
let sourceCaseAId: number;
let sourceCaseBId: number;
let sourceCaseCId: number;
const trackedNewCaseIds: number[] = [];

test.describe("Copy/Move dialog same-project", () => {
  test.afterAll(async ({ request, baseURL }) => {
    const ops: Array<Promise<unknown>> = [];
    const softDelete = (model: string, id: number) =>
      request
        .patch(`${baseURL}/api/model/${model}/update`, {
          data: { where: { id }, data: { isDeleted: true } },
        })
        .catch(() => {});

    // Sweep ALL non-deleted cases in the project — picks up worker-created
    // duplicates whose ids the spec didn't capture.
    if (projectId) {
      try {
        const all = await request.get(
          `${baseURL}/api/model/repositoryCases/findMany`,
          {
            params: {
              q: JSON.stringify({
                where: { projectId, isDeleted: false },
                select: { id: true },
              }),
            },
          }
        );
        if (all.ok()) {
          const body = await all.json();
          for (const row of body.data as Array<{ id: number }>) {
            ops.push(softDelete("repositoryCases", row.id));
          }
        }
      } catch {
        // Best-effort sweep; tracked-id soft-deletes below are the safety net.
      }
    }

    for (const id of trackedNewCaseIds) {
      ops.push(softDelete("repositoryCases", id));
    }
    for (const id of [sourceCaseAId, sourceCaseBId, sourceCaseCId]) {
      if (id) ops.push(softDelete("repositoryCases", id));
    }
    for (const id of [nestedFolderId, siblingFolderId]) {
      if (id) ops.push(softDelete("repositoryFolders", id));
    }
    if (projectId) {
      ops.push(softDelete("projects", projectId));
    }
    await Promise.all(ops);
  });

  test("setup: create project + folders + 3 cases", async ({ api }) => {
    const ts = Date.now();
    projectId = await api.createProject(`E2E CopyMoveDialog ${ts}`);
    rootFolderId = await api.getRootFolderId(projectId);
    siblingFolderId = await api.createFolder(projectId, `Sibling ${ts}`);
    nestedFolderId = await api.createFolder(
      projectId,
      `Nested ${ts}`,
      siblingFolderId
    );

    sourceCaseAId = await api.createTestCase(
      projectId,
      rootFolderId,
      `Source A ${ts}`
    );
    sourceCaseBId = await api.createTestCase(
      projectId,
      rootFolderId,
      `Source B ${ts}`
    );
    sourceCaseCId = await api.createTestCase(
      projectId,
      rootFolderId,
      `Source C ${ts}`
    );

    expect(projectId).toBeGreaterThan(0);
    expect(rootFolderId).toBeGreaterThan(0);
    expect(siblingFolderId).toBeGreaterThan(0);
    expect(nestedFolderId).toBeGreaterThan(0);
    expect(sourceCaseAId).toBeGreaterThan(0);
    expect(sourceCaseBId).toBeGreaterThan(0);
    expect(sourceCaseCId).toBeGreaterThan(0);

    // Opt out of api fixture's auto-cleanup so resources outlive setup.
    api.untrackProject(projectId);
    api.untrackCase(sourceCaseAId);
    api.untrackCase(sourceCaseBId);
    api.untrackCase(sourceCaseCId);
  });

  test("Same-project copy via dialog: pick sibling folder, copy 1 case", async ({
    page,
    request,
    baseURL,
  }) => {
    await page.goto(`/en-US/projects/repository/${projectId}`);
    await page
      .locator(`[data-testid="case-row-${sourceCaseAId}"]`)
      .first()
      .waitFor({ state: "visible", timeout: 15_000 });

    await page
      .locator(`[data-testid="case-checkbox-${sourceCaseAId}"]`)
      .click();
    await page.getByTestId("copy-move-button").click();

    await expect(page.getByTestId("copy-move-dialog")).toBeVisible();

    // Default destination = current project, so the (Current) suffix renders
    // inside the project picker trigger (AsyncCombobox shows the selected
    // option's renderOption in the trigger button).
    await expect(
      page
        .getByTestId("copy-move-target-project-trigger")
        .getByTestId("copy-move-project-current-suffix")
    ).toBeVisible();

    // Pick the sibling folder as destination. Wait for the option to render
    // — AsyncCombobox lazy-loads options after the trigger opens the popover.
    await page.getByTestId("copy-move-target-folder-trigger").click();
    const siblingOption = page.getByTestId(
      `copy-move-folder-option-${siblingFolderId}`
    );
    await expect(siblingOption).toBeVisible({ timeout: 15_000 });
    await siblingOption.click();

    await page.getByTestId("copy-move-next-button").click();

    // Copy is the default operation.
    await expect(page.getByTestId("copy-move-operation-copy")).toBeChecked();

    // Same-project copy of an existing case collides on
    // (projectId, name, className, source) — the worker's default
    // conflictResolution is "skip", which would skip every case. The
    // dialog surfaces a rename radio when preflight detects a collision;
    // clicking rename instructs the worker to suffix duplicates.
    await page.locator("label[for='cr-rename']").click();

    await page.getByTestId("copy-move-go-button").click();

    // Close button visible = job completed (status === "completed").
    await expect(page.getByTestId("copy-move-close-button")).toBeVisible({
      timeout: 30_000,
    });

    // Step-3 success summary uses the widened repository.dragDrop.copyComplete
    // key with dest:"samename" so no project clause appears in the rendered
    // text. Singular form because count === 1.
    await expect(page.getByTestId("copy-move-dialog")).toContainText(
      /Copied 1 case to .+/
    );

    await page.getByTestId("copy-move-close-button").click();

    // Verify a NEW case exists in the sibling folder via API.
    const res = await request.get(
      `${baseURL}/api/model/repositoryCases/findMany`,
      {
        params: {
          q: JSON.stringify({
            where: {
              projectId,
              folderId: siblingFolderId,
              isDeleted: false,
            },
            select: { id: true, name: true },
          }),
        },
      }
    );
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    const newCases = (body.data as Array<{ id: number; name: string }>).filter(
      (c) => c.id !== sourceCaseAId
    );
    expect(newCases.length).toBeGreaterThanOrEqual(1);

    // Track for cleanup (afterAll's project-wide sweep would catch them too,
    // but tracking is defensive in case the sweep query fails).
    for (const c of newCases) {
      if (!trackedNewCaseIds.includes(c.id)) trackedNewCaseIds.push(c.id);
    }
  });

  test("Same-project move via dialog: pick nested folder, move 1 case", async ({
    page,
    request,
    baseURL,
  }) => {
    await page.goto(`/en-US/projects/repository/${projectId}`);
    await page
      .locator(`[data-testid="case-row-${sourceCaseBId}"]`)
      .first()
      .waitFor({ state: "visible", timeout: 15_000 });

    await page
      .locator(`[data-testid="case-checkbox-${sourceCaseBId}"]`)
      .click();
    await page.getByTestId("copy-move-button").click();

    await expect(page.getByTestId("copy-move-dialog")).toBeVisible();

    // Pick the nested folder as destination — different from source root.
    await page.getByTestId("copy-move-target-folder-trigger").click();
    const nestedOption = page.getByTestId(
      `copy-move-folder-option-${nestedFolderId}`
    );
    await expect(nestedOption).toBeVisible({ timeout: 15_000 });
    await nestedOption.click();

    await page.getByTestId("copy-move-next-button").click();

    // Switch to Move.
    await page.getByTestId("copy-move-operation-move").click();
    await expect(page.getByTestId("copy-move-operation-move")).toBeChecked();

    // Same-project move collides with itself on (projectId, name, ...);
    // pick rename so the worker doesn't skip then soft-delete the original.
    await page.locator("label[for='cr-rename']").click();

    await page.getByTestId("copy-move-go-button").click();

    await expect(page.getByTestId("copy-move-close-button")).toBeVisible({
      timeout: 30_000,
    });

    await expect(page.getByTestId("copy-move-dialog")).toContainText(
      /Moved 1 case to .+/
    );

    await page.getByTestId("copy-move-close-button").click();

    // Verify move semantics: the original source case is now soft-deleted,
    // and a non-deleted case lives in the nested folder. The worker
    // implements move as "create renamed copy in target folder, then
    // soft-delete original" (workers/copyMoveWorker.ts:541-559 + 755-759),
    // so move + rename produces a new case row rather than mutating the
    // source's folderId in place.
    const sourceRes = await request.get(
      `${baseURL}/api/model/repositoryCases/findFirst`,
      {
        params: {
          q: JSON.stringify({
            where: { id: sourceCaseBId },
            select: { id: true, isDeleted: true },
          }),
        },
      }
    );
    expect(sourceRes.ok()).toBeTruthy();
    const sourceBody = await sourceRes.json();
    expect(sourceBody.data.isDeleted).toBe(true);

    const targetRes = await request.get(
      `${baseURL}/api/model/repositoryCases/findMany`,
      {
        params: {
          q: JSON.stringify({
            where: {
              projectId,
              folderId: nestedFolderId,
              isDeleted: false,
            },
            select: { id: true, name: true },
          }),
        },
      }
    );
    expect(targetRes.ok()).toBeTruthy();
    const targetBody = await targetRes.json();
    const movedCases = targetBody.data as Array<{ id: number; name: string }>;
    expect(movedCases.length).toBe(1);
    for (const c of movedCases) {
      if (!trackedNewCaseIds.includes(c.id)) trackedNewCaseIds.push(c.id);
    }
  });

  test("Multi-select copy via dialog: 2 cases to sibling folder uses plural ICU branch", async ({
    page,
    request,
    baseURL,
  }) => {
    await page.goto(`/en-US/projects/repository/${projectId}`);
    await page
      .locator(`[data-testid="case-row-${sourceCaseCId}"]`)
      .first()
      .waitFor({ state: "visible", timeout: 15_000 });

    // Capture the pre-test sibling-folder case count so we can assert the
    // delta (the previous test left at least 1 new case there; this test
    // should add 2 more).
    const before = await request.get(
      `${baseURL}/api/model/repositoryCases/findMany`,
      {
        params: {
          q: JSON.stringify({
            where: {
              projectId,
              folderId: siblingFolderId,
              isDeleted: false,
            },
            select: { id: true },
          }),
        },
      }
    );
    expect(before.ok()).toBeTruthy();
    const beforeIds = new Set(
      ((await before.json()).data as Array<{ id: number }>).map((c) => c.id)
    );

    // Source A still lives in the root folder — test 2 COPIED it, did not
    // move. Source C is untouched.
    await page
      .locator(`[data-testid="case-checkbox-${sourceCaseAId}"]`)
      .click();
    await page
      .locator(`[data-testid="case-checkbox-${sourceCaseCId}"]`)
      .click();
    await page.getByTestId("copy-move-button").click();

    await expect(page.getByTestId("copy-move-dialog")).toBeVisible();

    await page.getByTestId("copy-move-target-folder-trigger").click();
    const multiSiblingOption = page.getByTestId(
      `copy-move-folder-option-${siblingFolderId}`
    );
    await expect(multiSiblingOption).toBeVisible({ timeout: 15_000 });
    await multiSiblingOption.click();
    await page.getByTestId("copy-move-next-button").click();

    // Same-project copy of existing cases — pick rename so neither is skipped.
    await page.locator("label[for='cr-rename']").click();

    await page.getByTestId("copy-move-go-button").click();

    await expect(page.getByTestId("copy-move-close-button")).toBeVisible({
      timeout: 30_000,
    });

    // Plural form ("cases" not "case") — the ICU "other" branch.
    await expect(page.getByTestId("copy-move-dialog")).toContainText(
      /Copied 2 cases to .+/
    );

    await page.getByTestId("copy-move-close-button").click();

    // Verify exactly 2 new cases exist in the sibling folder (delta vs before).
    const after = await request.get(
      `${baseURL}/api/model/repositoryCases/findMany`,
      {
        params: {
          q: JSON.stringify({
            where: {
              projectId,
              folderId: siblingFolderId,
              isDeleted: false,
            },
            select: { id: true },
          }),
        },
      }
    );
    expect(after.ok()).toBeTruthy();
    const afterRows = (await after.json()).data as Array<{ id: number }>;
    const added = afterRows.filter((c) => !beforeIds.has(c.id));
    expect(added.length).toBe(2);
    for (const c of added) {
      if (!trackedNewCaseIds.includes(c.id)) trackedNewCaseIds.push(c.id);
    }
  });
});
