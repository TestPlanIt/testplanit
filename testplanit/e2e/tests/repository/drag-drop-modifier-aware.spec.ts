import {
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";

import { expect, test } from "../../fixtures/index";
import { RepositoryPage } from "../../page-objects/repository/repository.page";
import { nativeDragDrop, startNativeDrag } from "./nativeDragDrop";

/**
 * Drag-drop modifier-aware UX — exercises the three drag interaction modes
 * for repository test cases:
 *   - no modifier: cursor-anchored Move/Copy/Cancel popover
 *   - copy modifier (Option on macOS, Control on Windows/Linux): direct copy
 *     via the async useCopyMoveJob pipeline (writes DUPLICATED_FROM link)
 *   - move modifier (Shift): direct move via the existing fast ZenStack path
 *
 * The repository tree uses react-dnd + HTML5Backend, which only reacts to
 * native HTML5 drag DOM events (dragstart/dragenter/dragover/drop/dragend) —
 * Playwright's page.mouse.* sequence never reaches the backend's monitor, so
 * the drop callback never fired and the popover never opened. The drags here
 * are synthesized as genuine HTML5 drag events via the nativeDragDrop /
 * startNativeDrag helpers, threading one DataTransfer through the sequence and
 * setting altKey/ctrlKey/shiftKey directly on the dragover/drop events so
 * useDragModifier derives the same copy/move intent it would from a held key.
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

async function dragWithModifier(
  page: Page,
  source: Locator,
  target: Locator,
  modifier: "Alt" | "Shift" | "Control" | null
): Promise<void> {
  await nativeDragDrop(page, source, target, modifier);
}

/**
 * Wait for the target folder node to render in the tree, reloading the page if
 * the first folder-tree query returned a stale snapshot that omitted the
 * just-created folder. The folder is created in the setup test's separate
 * browser context, so a read-after-write miss can leave the node absent until
 * the query refetches.
 */
async function ensureTargetFolderVisible(
  page: Page,
  repo: RepositoryPage,
  target: Locator,
  rootFolderId: number
): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await expect(target).toBeVisible({
        timeout: attempt === 0 ? 20_000 : 10_000,
      });
      return;
    } catch {
      if (attempt === 3)
        throw new Error("Target folder never rendered in tree");
      await page.reload();
      await repo.waitForRepositoryLoad();
      // Re-select the root folder after the reload so the tree settles into the
      // same expanded state the rest of the test expects before retrying the
      // visibility check.
      await repo.selectFolder(rootFolderId);
    }
  }
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
    await test.step("Create project, target folder, and two source cases", async () => {
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
    });

    await test.step("Verify all resources were created", async () => {
      expect(projectId).toBeGreaterThan(0);
      expect(rootFolderId).toBeGreaterThan(0);
      expect(targetFolderId).toBeGreaterThan(0);
      expect(sourceCaseId).toBeGreaterThan(0);
      expect(secondCaseId).toBeGreaterThan(0);
    });

    await test.step("Opt out of api fixture auto-cleanup so resources outlive setup", async () => {
      api.untrackProject(projectId);
      api.untrackCase(sourceCaseId);
      api.untrackCase(secondCaseId);
      // The drop target must outlive this test too, or teardown soft-deletes
      // it out from under the drag tests below.
      api.untrackFolder(targetFolderId);
    });
  });

  test("no-modifier drop opens cursor-anchored popover; Esc dismisses without DB write", async ({
    page,
    request,
    baseURL,
  }) => {
    const repo = new RepositoryPage(page);
    const sourceRow = page
      .locator(`[data-testid="case-row-${sourceCaseId}"]`)
      .first();
    const target = page
      .locator(`[data-testid="folder-node-${targetFolderId}"]`)
      .first();
    const popover = page.getByTestId("drop-action-popover");

    await test.step("Open repository and select the root folder", async () => {
      await repo.goto(projectId);
      await repo.selectFolder(rootFolderId);

      await expect(sourceRow).toBeVisible({ timeout: 15_000 });

      // The target folder is created by the setup test in a separate browser
      // context. Occasionally the folder-tree findMany on first load returns a
      // stale snapshot missing that just-committed row, so the target node
      // never renders. A reload re-issues the query and picks it up. Retry the
      // reload a couple of times before giving up.
      await ensureTargetFolderVisible(page, repo, target, rootFolderId);
    });

    await test.step("Drag the case onto the target folder with no modifier", async () => {
      await dragWithModifier(page, sourceRow, target, null);

      await expect(popover).toBeVisible({ timeout: 5_000 });

      // Cancel is the popover focus default.
      await expect(page.getByTestId("drop-action-cancel")).toBeFocused();
    });

    await test.step("Press Escape to dismiss the popover", async () => {
      await page.keyboard.press("Escape");
      await expect(popover).not.toBeVisible({ timeout: 5_000 });
    });

    await test.step("Verify no DB write and no copy spinner occurred", async () => {
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
  });

  test("no-modifier drop → Move button moves the case via the fast path", async ({
    page,
    request,
    baseURL,
  }) => {
    const repo = new RepositoryPage(page);
    const sourceRow = page
      .locator(`[data-testid="case-row-${sourceCaseId}"]`)
      .first();
    const target = page
      .locator(`[data-testid="folder-node-${targetFolderId}"]`)
      .first();

    await test.step("Open repository and select the root folder", async () => {
      await repo.goto(projectId);
      await repo.selectFolder(rootFolderId);

      await expect(sourceRow).toBeVisible({ timeout: 10_000 });
    });

    await test.step("Drag with no modifier and click the Move button", async () => {
      await dragWithModifier(page, sourceRow, target, null);
      await page.getByTestId("drop-action-move").click();

      await expect(page.getByTestId("drop-action-popover")).not.toBeVisible({
        timeout: 5_000,
      });
    });

    await test.step("Verify the case moved to the target folder with no copy spinner", async () => {
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
    });

    // Restore source case to root for subsequent tests.
    await moveCaseToFolder(request, baseURL!, sourceCaseId, rootFolderId);
  });

  test("no-modifier drop → Copy button copies via async job", async ({
    page,
    request,
    baseURL,
  }) => {
    const repo = new RepositoryPage(page);
    const sourceRow = page
      .locator(`[data-testid="case-row-${sourceCaseId}"]`)
      .first();
    const target = page
      .locator(`[data-testid="folder-node-${targetFolderId}"]`)
      .first();
    let before: Array<{ id: number; name: string }> | undefined;
    let beforeIds: Set<number> | undefined;

    await test.step("Open repository and capture target-folder baseline", async () => {
      await repo.goto(projectId);
      await repo.selectFolder(rootFolderId);

      before = await casesInFolder(
        request,
        baseURL!,
        projectId,
        targetFolderId
      );
      beforeIds = new Set(before.map((c) => c.id));

      await expect(sourceRow).toBeVisible({ timeout: 10_000 });
    });

    await test.step("Drag with no modifier and click the Copy button", async () => {
      await dragWithModifier(page, sourceRow, target, null);
      await page.getByTestId("drop-action-copy").click();

      await expect(page.getByTestId("drop-action-popover")).not.toBeVisible({
        timeout: 5_000,
      });
    });

    await test.step("Wait for the async copy job to land a new case in the target folder", async () => {
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
            const created = cases.find((c) => !beforeIds!.has(c.id));
            if (created) newCaseId = created.id;
            return cases.length;
          },
          { timeout: 30_000 }
        )
        .toBe(before!.length + 1);

      if (newCaseId !== undefined) createdCaseIds.push(newCaseId);
    });

    await test.step("Verify the source case is still in the root folder", async () => {
      // Source still in root.
      const rootCases = await casesInFolder(
        request,
        baseURL!,
        projectId,
        rootFolderId
      );
      expect(rootCases.find((c) => c.id === sourceCaseId)).toBeDefined();
    });
  });

  test("copy modifier shows copy badge mid-drag and copies directly without popover", async ({
    page,
    request,
    baseURL,
  }) => {
    const repo = new RepositoryPage(page);
    const sourceRow = page
      .locator(`[data-testid="case-row-${sourceCaseId}"]`)
      .first();
    const target = page
      .locator(`[data-testid="folder-node-${targetFolderId}"]`)
      .first();
    let before: Array<{ id: number; name: string }> | undefined;
    let beforeIds: Set<number> | undefined;

    await test.step("Open repository and select the root folder", async () => {
      await repo.goto(projectId);
      await repo.selectFolder(rootFolderId);

      await expect(sourceRow).toBeVisible({ timeout: 10_000 });
    });

    await test.step("Synthesize drag with copy modifier and confirm copy badge then drop", async () => {
      before = await casesInFolder(
        request,
        baseURL!,
        projectId,
        targetFolderId
      );
      beforeIds = new Set(before.map((c) => c.id));

      const copyModifier = await resolveCopyModifier(page);

      // Start a native HTML5 drag hovering over the target, then apply the copy
      // modifier on subsequent dragover events so useDragModifier flips
      // copyHeld → the copy badge renders mid-drag.
      const drag = await startNativeDrag(page, sourceRow, target);
      await drag.setModifier(copyModifier);

      await expect(page.getByTestId("drag-preview-copy-badge")).toBeVisible({
        timeout: 5_000,
      });

      // Drop with the modifier still applied so the drop branches to direct
      // copy (no popover).
      await drag.drop(copyModifier);
      await expect(page.getByTestId("drop-action-popover")).not.toBeVisible({
        timeout: 2_000,
      });
    });

    await test.step("Wait for the async copy job to land a new case in the target folder", async () => {
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
            const created = cases.find((c) => !beforeIds!.has(c.id));
            if (created) newCaseId = created.id;
            return cases.length;
          },
          { timeout: 30_000 }
        )
        .toBe(before!.length + 1);

      if (newCaseId !== undefined) createdCaseIds.push(newCaseId);
    });
  });

  test("move modifier shows move badge mid-drag and moves directly via fast path", async ({
    page,
    request,
    baseURL,
  }) => {
    const repo = new RepositoryPage(page);
    const sourceRow = page
      .locator(`[data-testid="case-row-${sourceCaseId}"]`)
      .first();
    const target = page
      .locator(`[data-testid="folder-node-${targetFolderId}"]`)
      .first();

    await test.step("Open repository and select the root folder", async () => {
      await repo.goto(projectId);
      await repo.selectFolder(rootFolderId);

      await expect(sourceRow).toBeVisible({ timeout: 10_000 });
    });

    await test.step("Synthesize drag with Shift modifier and confirm move badge then drop", async () => {
      // Start a native HTML5 drag hovering over the target, then apply Shift on
      // subsequent dragover events so useDragModifier flips moveHeld → the move
      // badge renders mid-drag.
      const drag = await startNativeDrag(page, sourceRow, target);
      await drag.setModifier("Shift");

      await expect(page.getByTestId("drag-preview-move-badge")).toBeVisible({
        timeout: 5_000,
      });

      // Drop with Shift still applied so the drop branches to direct move (no
      // popover).
      await drag.drop("Shift");
      await expect(page.getByTestId("drop-action-popover")).not.toBeVisible({
        timeout: 2_000,
      });
    });

    await test.step("Verify the case moved via the fast path with no copy spinner", async () => {
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
    });

    // Restore source case to root for subsequent tests.
    await moveCaseToFolder(request, baseURL!, sourceCaseId, rootFolderId);
  });

  test("toggling modifiers mid-drag swaps badges live", async ({ page }) => {
    const repo = new RepositoryPage(page);
    const sourceRow = page
      .locator(`[data-testid="case-row-${sourceCaseId}"]`)
      .first();
    const target = page
      .locator(`[data-testid="folder-node-${targetFolderId}"]`)
      .first();
    let copyModifier: "Alt" | "Control" | undefined;
    let drag: Awaited<ReturnType<typeof startNativeDrag>> | undefined;

    await test.step("Open repository and select the root folder", async () => {
      await repo.goto(projectId);
      await repo.selectFolder(rootFolderId);

      await expect(sourceRow).toBeVisible({ timeout: 10_000 });

      copyModifier = await resolveCopyModifier(page);
    });

    await test.step("Start the drag and apply the copy modifier to show the copy badge", async () => {
      // Begin a native HTML5 drag held over the target, then apply the copy
      // modifier on subsequent dragover events.
      drag = await startNativeDrag(page, sourceRow, target);
      await drag.setModifier(copyModifier!);
      await expect(page.getByTestId("drag-preview-copy-badge")).toBeVisible({
        timeout: 5_000,
      });
    });

    await test.step("Apply Shift to swap to the move badge", async () => {
      await drag!.setModifier("Shift");
      await expect(page.getByTestId("drag-preview-move-badge")).toBeVisible({
        timeout: 5_000,
      });
    });

    await test.step("Release modifiers and confirm both badges disappear", async () => {
      // No modifier on the next dragover → both badges should clear.
      await drag!.setModifier(null);
      await expect(page.getByTestId("drag-preview-copy-badge")).not.toBeVisible(
        {
          timeout: 5_000,
        }
      );
      await expect(page.getByTestId("drag-preview-move-badge")).not.toBeVisible(
        {
          timeout: 5_000,
        }
      );
    });

    await test.step("End the drag without a drop", async () => {
      // Abandon the drag (dragend without a drop) so no drop branch fires — the
      // badge-swap UI smoke is the deterministic claim here; drop-branch routing
      // for the no-modifier case is covered by the earlier popover-open /
      // Esc-dismiss test.
      await drag!.abandon();
    });
  });

  test("multi-select copy creates N cases in one job", async ({
    page,
    request,
    baseURL,
  }) => {
    const repo = new RepositoryPage(page);
    const checkbox1 = page
      .locator(`[data-testid="case-checkbox-${sourceCaseId}"]`)
      .first();
    const checkbox2 = page
      .locator(`[data-testid="case-checkbox-${secondCaseId}"]`)
      .first();
    const sourceRow = page
      .locator(`[data-testid="case-row-${sourceCaseId}"]`)
      .first();
    const target = page
      .locator(`[data-testid="folder-node-${targetFolderId}"]`)
      .first();
    let before: Array<{ id: number; name: string }> | undefined;
    let beforeIds: Set<number> | undefined;

    await test.step("Open repository and select both source cases", async () => {
      await repo.goto(projectId);
      await repo.selectFolder(rootFolderId);

      await expect(checkbox1).toBeVisible({ timeout: 10_000 });
      await checkbox1.click();
      await checkbox2.click();
    });

    await test.step("Capture target-folder baseline", async () => {
      before = await casesInFolder(
        request,
        baseURL!,
        projectId,
        targetFolderId
      );
      beforeIds = new Set(before.map((c) => c.id));
    });

    await test.step("Drag the selection onto the target folder with the copy modifier", async () => {
      const copyModifier = await resolveCopyModifier(page);

      // Hold the drag over the target and apply the copy modifier, then wait for
      // the copy badge before dropping. The badge confirms useDragModifier has
      // committed copyHeld=true, so the drop callback's captured closure
      // branches to direct copy (no popover) instead of racing the state update.
      const drag = await startNativeDrag(page, sourceRow, target);
      await drag.setModifier(copyModifier);
      await expect(page.getByTestId("drag-preview-copy-badge")).toBeVisible({
        timeout: 5_000,
      });
      await drag.drop(copyModifier);

      // Copy modifier held → no popover.
      await expect(page.getByTestId("drop-action-popover")).not.toBeVisible({
        timeout: 2_000,
      });
    });

    await test.step("Wait for the copy job to create both cases in the target folder", async () => {
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
              if (!beforeIds!.has(c.id)) createdCaseIds.push(c.id);
            }
            return cases.length;
          },
          { timeout: 30_000 }
        )
        .toBe(before!.length + 2);
    });

    await test.step("Verify both original cases are still in the root folder", async () => {
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
});
