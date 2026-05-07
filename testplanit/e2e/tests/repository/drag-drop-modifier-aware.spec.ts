import {
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";

import { expect, test } from "../../fixtures/index";
import { RepositoryPage } from "../../page-objects/repository/repository.page";

/**
 * Drag-drop modifier-aware UX — exercises the three drag interaction modes
 * for repository test cases:
 *   - no modifier: cursor-anchored Move/Copy/Cancel popover
 *   - copy modifier (Option on macOS, Control on Windows/Linux): direct copy
 *     via the async useCopyMoveJob pipeline (writes DUPLICATED_FROM link)
 *   - move modifier (Shift): direct move via the existing fast ZenStack path
 *
 * Playwright high-level drag helpers do not accept a `modifiers` option, so
 * the spec synthesizes held modifiers via page.keyboard.down(<key>) +
 * page.mouse.down/move/up + page.keyboard.up(<key>) (precedent:
 * keyboard-shortcuts.spec.ts:36-38, the folder-reorder spec lines 55-66).
 */

test.use({ storageState: "e2e/.auth/admin.json" });
test.describe.configure({ mode: "serial" });

// Branch on the BROWSER user agent so the test's modifier choice matches the
// platform-detection branch the production hook uses. process.platform is
// the test runner's host OS, not the browser's reported platform — and
// Playwright's Desktop Chrome device reports a Windows UA on every host.
async function resolveCopyModifier(page: Page): Promise<"Alt" | "Control"> {
  const isMacBrowser = await page.evaluate(() =>
    /Mac|iPhone|iPod|iPad/i.test(navigator.userAgent)
  );
  return isMacBrowser ? "Alt" : "Control";
}

/**
 * Wait two animation frames to allow React to commit any pending render
 * triggered by react-dnd's isDragging state flip. This lets useEffect-mounted
 * dragover listeners (e.g. useDragModifier's window listener) attach before
 * the spec resumes synthesizing mouse moves.
 */
async function flushReactRender(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  );
}

async function dragWithModifier(
  page: Page,
  source: Locator,
  target: Locator,
  modifier: "Alt" | "Shift" | "Control" | null
): Promise<void> {
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  if (!sourceBox || !targetBox) {
    throw new Error("dragWithModifier: source or target has no boundingBox");
  }

  const targetCenterX = targetBox.x + targetBox.width / 2;
  const targetCenterY = targetBox.y + targetBox.height / 2;

  // Start the drag without the modifier so dragstart fires cleanly, then
  // press the modifier and continue moving so dragover events with the
  // modifier flag propagate to the useDragModifier window listener.
  await source.hover();
  await page.mouse.down();
  await page.mouse.move(targetCenterX, targetCenterY, { steps: 8 });
  await flushReactRender(page);

  if (modifier) await page.keyboard.down(modifier);
  await page.mouse.move(targetCenterX + 2, targetCenterY + 2, { steps: 20 });
  await page.mouse.up();
  if (modifier) await page.keyboard.up(modifier);
}

async function casesInFolder(
  request: APIRequestContext,
  baseURL: string,
  projectId: number,
  folderId: number
): Promise<Array<{ id: number; name: string }>> {
  const response = await request.get(
    `${baseURL}/api/model/repositoryCases/findMany`,
    {
      params: {
        q: JSON.stringify({
          where: { projectId, folderId, isDeleted: false },
          select: { id: true, name: true },
        }),
      },
    }
  );
  if (!response.ok()) {
    throw new Error(`casesInFolder failed: ${response.status()}`);
  }
  const body = await response.json();
  return body.data as Array<{ id: number; name: string }>;
}

async function moveCaseToFolder(
  request: APIRequestContext,
  baseURL: string,
  caseId: number,
  folderId: number
): Promise<void> {
  const response = await request.patch(
    `${baseURL}/api/model/repositoryCases/update`,
    {
      data: {
        where: { id: caseId },
        data: { folder: { connect: { id: folderId } } },
      },
    }
  );
  if (!response.ok()) {
    throw new Error(
      `moveCaseToFolder failed: ${response.status()} ${await response.text()}`
    );
  }
}

let projectId: number;
let rootFolderId: number;
let targetFolderId: number;
let sourceCaseId: number;
let secondCaseId: number;
const sourceCaseName = `Drag DnD source case ${Date.now()}`;
const secondCaseName = `Drag DnD second case ${Date.now()}`;
const createdCaseIds: number[] = [];

test.describe("Drag-drop modifier-aware UX", () => {
  test.afterAll(async ({ request, baseURL }) => {
    const ops: Array<Promise<unknown>> = [];

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
            ops.push(
              request
                .patch(`${baseURL}/api/model/repositoryCases/update`, {
                  data: {
                    where: { id: row.id },
                    data: { isDeleted: true },
                  },
                })
                .catch(() => {})
            );
          }
        }
      } catch {
        // Best-effort cleanup; project soft-delete below is the safety net.
      }
    }

    for (const id of createdCaseIds) {
      ops.push(
        request
          .patch(`${baseURL}/api/model/repositoryCases/update`, {
            data: { where: { id }, data: { isDeleted: true } },
          })
          .catch(() => {})
      );
    }

    if (projectId) {
      ops.push(
        request
          .patch(`${baseURL}/api/model/projects/update`, {
            data: { where: { id: projectId }, data: { isDeleted: true } },
          })
          .catch(() => {})
      );
    }

    await Promise.all(ops);
  });

  test("setup: create project, target folder, and two source cases", async ({
    api,
  }) => {
    projectId = await api.createProject(`Drag DnD Modifier ${Date.now()}`);
    rootFolderId = await api.getRootFolderId(projectId);
    targetFolderId = await api.createFolder(
      projectId,
      `Target Folder ${Date.now()}`
    );

    sourceCaseId = await api.createTestCase(
      projectId,
      rootFolderId,
      sourceCaseName
    );
    secondCaseId = await api.createTestCase(
      projectId,
      rootFolderId,
      secondCaseName
    );

    expect(projectId).toBeGreaterThan(0);
    expect(rootFolderId).toBeGreaterThan(0);
    expect(targetFolderId).toBeGreaterThan(0);
    expect(sourceCaseId).toBeGreaterThan(0);
    expect(secondCaseId).toBeGreaterThan(0);

    // Opt out of api fixture's auto-cleanup so resources outlive setup.
    api.untrackProject(projectId);
    api.untrackCase(sourceCaseId);
    api.untrackCase(secondCaseId);
  });

  test("no-modifier drop opens cursor-anchored popover; Esc dismisses without DB write", async ({
    page,
    request,
    baseURL,
  }) => {
    const repo = new RepositoryPage(page);
    await repo.goto(projectId);
    await repo.selectFolder(rootFolderId);

    const sourceRow = page
      .locator(`[data-testid="case-row-${sourceCaseId}"]`)
      .first();
    const target = page
      .locator(`[data-testid="folder-node-${targetFolderId}"]`)
      .first();

    await expect(sourceRow).toBeVisible({ timeout: 10_000 });
    await expect(target).toBeVisible({ timeout: 10_000 });

    await dragWithModifier(page, sourceRow, target, null);

    const popover = page.getByTestId("drop-action-popover");
    await expect(popover).toBeVisible({ timeout: 5_000 });

    // Cancel is the popover focus default.
    await expect(page.getByTestId("drop-action-cancel")).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(popover).not.toBeVisible({ timeout: 5_000 });

    // No DB write: source case still in root folder; target folder unchanged.
    const targetCases = await casesInFolder(
      request,
      baseURL!,
      projectId,
      targetFolderId
    );
    expect(targetCases.find((c) => c.id === sourceCaseId)).toBeUndefined();

    // No copy spinner ever rendered in the target row.
    await expect(
      page.getByTestId(`folder-row-copy-progress-${targetFolderId}`)
    ).not.toBeVisible({ timeout: 1_000 });
  });

  test("no-modifier drop → Move button moves the case via the fast path", async ({
    page,
    request,
    baseURL,
  }) => {
    const repo = new RepositoryPage(page);
    await repo.goto(projectId);
    await repo.selectFolder(rootFolderId);

    const sourceRow = page
      .locator(`[data-testid="case-row-${sourceCaseId}"]`)
      .first();
    const target = page
      .locator(`[data-testid="folder-node-${targetFolderId}"]`)
      .first();
    await expect(sourceRow).toBeVisible({ timeout: 10_000 });

    await dragWithModifier(page, sourceRow, target, null);
    await page.getByTestId("drop-action-move").click();

    await expect(page.getByTestId("drop-action-popover")).not.toBeVisible({
      timeout: 5_000,
    });

    await expect
      .poll(
        async () => {
          const cases = await casesInFolder(
            request,
            baseURL!,
            projectId,
            targetFolderId
          );
          return cases.some((c) => c.id === sourceCaseId);
        },
        { timeout: 15_000 }
      )
      .toBe(true);

    // Move is the fast ZenStack path; no async copy spinner.
    await expect(
      page.getByTestId(`folder-row-copy-progress-${targetFolderId}`)
    ).not.toBeVisible({ timeout: 1_000 });

    // Restore source case to root for subsequent tests.
    await moveCaseToFolder(request, baseURL!, sourceCaseId, rootFolderId);
  });

  test("no-modifier drop → Copy button copies via async job", async ({
    page,
    request,
    baseURL,
  }) => {
    const repo = new RepositoryPage(page);
    await repo.goto(projectId);
    await repo.selectFolder(rootFolderId);

    const before = await casesInFolder(
      request,
      baseURL!,
      projectId,
      targetFolderId
    );
    const beforeIds = new Set(before.map((c) => c.id));

    const sourceRow = page
      .locator(`[data-testid="case-row-${sourceCaseId}"]`)
      .first();
    const target = page
      .locator(`[data-testid="folder-node-${targetFolderId}"]`)
      .first();
    await expect(sourceRow).toBeVisible({ timeout: 10_000 });

    await dragWithModifier(page, sourceRow, target, null);
    await page.getByTestId("drop-action-copy").click();

    await expect(page.getByTestId("drop-action-popover")).not.toBeVisible({
      timeout: 5_000,
    });

    // Wait for the async copy job to land a new case in the target folder.
    let newCaseId: number | undefined;
    await expect
      .poll(
        async () => {
          const cases = await casesInFolder(
            request,
            baseURL!,
            projectId,
            targetFolderId
          );
          const created = cases.find((c) => !beforeIds.has(c.id));
          if (created) newCaseId = created.id;
          return cases.length;
        },
        { timeout: 30_000 }
      )
      .toBe(before.length + 1);

    if (newCaseId !== undefined) createdCaseIds.push(newCaseId);

    // Source still in root.
    const rootCases = await casesInFolder(
      request,
      baseURL!,
      projectId,
      rootFolderId
    );
    expect(rootCases.find((c) => c.id === sourceCaseId)).toBeDefined();
  });

  test("copy modifier shows copy badge mid-drag and copies directly without popover", async ({
    page,
    request,
    baseURL,
  }) => {
    const repo = new RepositoryPage(page);
    await repo.goto(projectId);
    await repo.selectFolder(rootFolderId);

    const sourceRow = page
      .locator(`[data-testid="case-row-${sourceCaseId}"]`)
      .first();
    const target = page
      .locator(`[data-testid="folder-node-${targetFolderId}"]`)
      .first();
    await expect(sourceRow).toBeVisible({ timeout: 10_000 });

    const targetBox = await target.boundingBox();
    if (!targetBox) throw new Error("missing target boundingBox");

    const before = await casesInFolder(
      request,
      baseURL!,
      projectId,
      targetFolderId
    );
    const beforeIds = new Set(before.map((c) => c.id));

    const targetCenterX = targetBox.x + targetBox.width / 2;
    const targetCenterY = targetBox.y + targetBox.height / 2;
    const copyModifier = await resolveCopyModifier(page);

    // Start the drag without the modifier first so dragstart fires cleanly,
    // then press the modifier and continue moving so the modifier-bearing
    // dragover events propagate to the useDragModifier listener.
    await sourceRow.hover();
    await page.mouse.down();
    await page.mouse.move(targetCenterX, targetCenterY, { steps: 8 });
    await flushReactRender(page);

    await page.keyboard.down(copyModifier);
    await page.mouse.move(targetCenterX + 2, targetCenterY + 2, { steps: 20 });

    await expect(page.getByTestId("drag-preview-copy-badge")).toBeVisible({
      timeout: 5_000,
    });

    // Modifier held through drop so the drop branches to direct copy.
    await page.mouse.up();
    await page.keyboard.up(copyModifier);

    // Copy modifier held → no popover.
    await expect(page.getByTestId("drop-action-popover")).not.toBeVisible({
      timeout: 2_000,
    });

    let newCaseId: number | undefined;
    await expect
      .poll(
        async () => {
          const cases = await casesInFolder(
            request,
            baseURL!,
            projectId,
            targetFolderId
          );
          const created = cases.find((c) => !beforeIds.has(c.id));
          if (created) newCaseId = created.id;
          return cases.length;
        },
        { timeout: 30_000 }
      )
      .toBe(before.length + 1);

    if (newCaseId !== undefined) createdCaseIds.push(newCaseId);
  });

  test("move modifier shows move badge mid-drag and moves directly via fast path", async ({
    page,
    request,
    baseURL,
  }) => {
    const repo = new RepositoryPage(page);
    await repo.goto(projectId);
    await repo.selectFolder(rootFolderId);

    const sourceRow = page
      .locator(`[data-testid="case-row-${sourceCaseId}"]`)
      .first();
    const target = page
      .locator(`[data-testid="folder-node-${targetFolderId}"]`)
      .first();
    await expect(sourceRow).toBeVisible({ timeout: 10_000 });

    const targetBox = await target.boundingBox();
    if (!targetBox) throw new Error("missing target boundingBox");

    const targetCenterX = targetBox.x + targetBox.width / 2;
    const targetCenterY = targetBox.y + targetBox.height / 2;

    // Start the drag without the modifier so dragstart fires cleanly, then
    // press Shift mid-drag so the modifier-bearing dragovers propagate.
    await sourceRow.hover();
    await page.mouse.down();
    await page.mouse.move(targetCenterX, targetCenterY, { steps: 8 });
    await flushReactRender(page);

    await page.keyboard.down("Shift");
    await page.mouse.move(targetCenterX + 2, targetCenterY + 2, { steps: 20 });

    await expect(page.getByTestId("drag-preview-move-badge")).toBeVisible({
      timeout: 5_000,
    });

    // Modifier held through drop so the drop branches to direct move.
    await page.mouse.up();
    await page.keyboard.up("Shift");

    // Move modifier held → no popover.
    await expect(page.getByTestId("drop-action-popover")).not.toBeVisible({
      timeout: 2_000,
    });

    // Move uses the fast path — source ends up in target folder.
    await expect
      .poll(
        async () => {
          const cases = await casesInFolder(
            request,
            baseURL!,
            projectId,
            targetFolderId
          );
          return cases.some((c) => c.id === sourceCaseId);
        },
        { timeout: 15_000 }
      )
      .toBe(true);

    // Move is the fast path; no copy spinner.
    await expect(
      page.getByTestId(`folder-row-copy-progress-${targetFolderId}`)
    ).not.toBeVisible({ timeout: 1_000 });

    // Restore source case to root for subsequent tests.
    await moveCaseToFolder(request, baseURL!, sourceCaseId, rootFolderId);
  });

  test("toggling modifiers mid-drag swaps badges live", async ({ page }) => {
    const repo = new RepositoryPage(page);
    await repo.goto(projectId);
    await repo.selectFolder(rootFolderId);

    const sourceRow = page
      .locator(`[data-testid="case-row-${sourceCaseId}"]`)
      .first();
    const target = page
      .locator(`[data-testid="folder-node-${targetFolderId}"]`)
      .first();
    await expect(sourceRow).toBeVisible({ timeout: 10_000 });

    const targetBox = await target.boundingBox();
    if (!targetBox) throw new Error("missing target boundingBox");

    const copyModifier = await resolveCopyModifier(page);

    await sourceRow.hover();
    await page.mouse.down();
    // First short move triggers dragstart so react-dnd's isDragging flips true.
    await page.mouse.move(targetBox.x + 10, targetBox.y + 10, { steps: 8 });
    // Flush so the UnifiedDragPreview-mounted dragover listener attaches.
    await flushReactRender(page);

    await page.keyboard.down(copyModifier);
    // Nudge the mouse so fresh dragovers propagate with the new modifier state.
    await page.mouse.move(targetBox.x + 20, targetBox.y + 20, { steps: 12 });
    await expect(page.getByTestId("drag-preview-copy-badge")).toBeVisible({
      timeout: 5_000,
    });
    await page.keyboard.up(copyModifier);

    await page.keyboard.down("Shift");
    await page.mouse.move(targetBox.x + 30, targetBox.y + 30, { steps: 12 });
    await expect(page.getByTestId("drag-preview-move-badge")).toBeVisible({
      timeout: 5_000,
    });
    await page.keyboard.up("Shift");

    // Both badges should be gone when neither modifier is held.
    await page.mouse.move(targetBox.x + 40, targetBox.y + 40, { steps: 12 });
    await expect(page.getByTestId("drag-preview-copy-badge")).not.toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByTestId("drag-preview-move-badge")).not.toBeVisible({
      timeout: 5_000,
    });

    // End the drag away from any drop target so canDrop returns false and no
    // drop branch fires — the badge-swap UI smoke is the deterministic claim
    // here; drop-branch routing for the no-modifier case is covered by the
    // earlier popover-open / Esc-dismiss test.
    await page.mouse.move(10, 10, { steps: 5 });
    await page.mouse.up();
  });

  test("multi-select copy creates N cases in one job", async ({
    page,
    request,
    baseURL,
  }) => {
    const repo = new RepositoryPage(page);
    await repo.goto(projectId);
    await repo.selectFolder(rootFolderId);

    const checkbox1 = page
      .locator(`[data-testid="case-checkbox-${sourceCaseId}"]`)
      .first();
    const checkbox2 = page
      .locator(`[data-testid="case-checkbox-${secondCaseId}"]`)
      .first();

    await expect(checkbox1).toBeVisible({ timeout: 10_000 });
    await checkbox1.click();
    await checkbox2.click();

    const before = await casesInFolder(
      request,
      baseURL!,
      projectId,
      targetFolderId
    );
    const beforeIds = new Set(before.map((c) => c.id));

    const sourceRow = page
      .locator(`[data-testid="case-row-${sourceCaseId}"]`)
      .first();
    const target = page
      .locator(`[data-testid="folder-node-${targetFolderId}"]`)
      .first();

    const copyModifier = await resolveCopyModifier(page);
    await dragWithModifier(page, sourceRow, target, copyModifier);

    // Copy modifier held → no popover.
    await expect(page.getByTestId("drop-action-popover")).not.toBeVisible({
      timeout: 2_000,
    });

    await expect
      .poll(
        async () => {
          const cases = await casesInFolder(
            request,
            baseURL!,
            projectId,
            targetFolderId
          );
          for (const c of cases) {
            if (!beforeIds.has(c.id)) createdCaseIds.push(c.id);
          }
          return cases.length;
        },
        { timeout: 30_000 }
      )
      .toBe(before.length + 2);

    // Originals still in root.
    const rootCases = await casesInFolder(
      request,
      baseURL!,
      projectId,
      rootFolderId
    );
    expect(rootCases.find((c) => c.id === sourceCaseId)).toBeDefined();
    expect(rootCases.find((c) => c.id === secondCaseId)).toBeDefined();
  });
});
