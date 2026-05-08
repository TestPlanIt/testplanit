import { expect, test } from "../../fixtures";
import type { Page } from "@playwright/test";
import { RepositoryPage } from "../../page-objects/repository/repository.page";

/**
 * Repository navigation & browser-history coverage.
 *
 * The bug being guarded:
 *   Within-page URL updates on /projects/repository — auto-select-first-
 *   folder, folder click in the tree, folder-badge click in a case row —
 *   were calling window.history.pushState. The repeated pushes added 4–5
 *   duplicate entries per visit and the back button felt broken (multiple
 *   clicks needed to escape the page).
 *
 * Approach:
 *   Each test asserts BOTH the functional behaviour (correct URL params,
 *   correct content visible) AND the history delta. The functional
 *   assertions match today's behaviour and should pass before and after
 *   the fix; the history-delta assertions fail today and pass after the
 *   fix. That way these tests double as a regression suite for the
 *   page's URL/state contract.
 */
test.use({ storageState: "e2e/.auth/admin.json" });
// Each test is fully self-contained (creates its own project). Run in
// parallel within the file so a failure in one doesn't skip the others —
// we want the full picture before applying the fix.
test.describe.configure({ mode: "parallel" });

interface HistoryEntry {
  kind: "push" | "replace";
  url: string;
}

/**
 * Patch window.history.pushState/replaceState so we can count and log
 * every call. Persisted via sessionStorage so the patch survives any
 * hard navigation (window.location.href = ...). Must be installed via
 * page.addInitScript BEFORE the first navigation.
 */
async function installHistoryTracker(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __historyLog: HistoryEntry[] };
    try {
      w.__historyLog = JSON.parse(
        sessionStorage.getItem("__historyLog") || "[]"
      );
    } catch {
      w.__historyLog = [];
    }
    const flush = () => {
      try {
        sessionStorage.setItem("__historyLog", JSON.stringify(w.__historyLog));
      } catch {
        /* ignore */
      }
    };
    const origPush = window.history.pushState.bind(window.history);
    const origReplace = window.history.replaceState.bind(window.history);
    window.history.pushState = function (data, _u, url) {
      w.__historyLog.push({ kind: "push", url: String(url ?? "") });
      flush();
      return origPush(data, _u, url);
    };
    window.history.replaceState = function (data, _u, url) {
      w.__historyLog.push({ kind: "replace", url: String(url ?? "") });
      flush();
      return origReplace(data, _u, url);
    };
  });
}

async function resetHistoryLog(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __historyLog: HistoryEntry[] }).__historyLog = [];
    sessionStorage.setItem("__historyLog", "[]");
  });
}

async function getHistoryLog(page: Page): Promise<HistoryEntry[]> {
  return page.evaluate(
    () => (window as unknown as { __historyLog: HistoryEntry[] }).__historyLog
  );
}

/**
 * Counts only `push` entries — these are the ones that grow history.
 * `replace` calls update the URL in place and don't affect the back
 * stack, so they don't count against the cleanliness assertion.
 */
function countPushes(log: HistoryEntry[]): number {
  return log.filter((e) => e.kind === "push").length;
}

/**
 * Pretty-print the log on assertion failure so the test report shows
 * exactly which call sites contributed extra entries.
 */
function expectPushCount(log: HistoryEntry[], expected: number): void {
  const actual = countPushes(log);
  if (actual !== expected) {
    console.log("[history-log]", JSON.stringify(log, null, 2));
  }
  expect(actual).toBe(expected);
}

test.describe("Repository — navigation & history", () => {
  test("initial navigation: history grows by exactly one entry", async ({
    api,
    page,
    baseURL,
  }) => {
    const projectId = await api.createProject(
      `Hist Init ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    );
    const folderId = await api.createFolder(projectId, "Folder 1");
    await api.createTestCase(projectId, folderId, "Init Case");

    await installHistoryTracker(page);
    await page.goto(`${baseURL}/en-US/projects/overview/${projectId}`);
    await page.waitForLoadState("networkidle");
    await resetHistoryLog(page);
    const lengthBefore: number = await page.evaluate(
      () => window.history.length
    );

    // Real cross-page navigation. We use location.href instead of
    // clicking #test-cases-link in the project menu because the menu
    // link occasionally races overlay dismissal under load — the bug
    // we're testing is independent of how the user got to /repository.
    await page.evaluate((id: number) => {
      window.location.href = `/en-US/projects/repository/${id}`;
    }, projectId);

    await page.waitForURL(/\/projects\/repository\/\d+/);
    await page.waitForURL(/[?&]view=folders/, { timeout: 10000 });
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(300); // settle popstate + retry effects

    // Functional: URL has the auto-populated params we expect.
    const url = new URL(page.url());
    expect(url.searchParams.get("view")).toBe("folders");
    expect(url.searchParams.get("node")).toMatch(/^\d+$/);
    expect(url.searchParams.get("page")).toBe("1");
    expect(url.searchParams.get("pageSize")).toMatch(/^\d+$/);

    // History: exactly one new entry (the cross-page navigation itself).
    // Note we use window.history.length, not push-count, because hard
    // navigations via location.href add a history entry without going
    // through pushState. Before the fix this delta was 5; after fix 1.
    const lengthAfter: number = await page.evaluate(
      () => window.history.length
    );
    if (lengthAfter - lengthBefore !== 1) {
      console.log(
        "[history-log]",
        JSON.stringify(await getHistoryLog(page), null, 2)
      );
    }
    expect(lengthAfter - lengthBefore).toBe(1);
  });

  test("back from repository to overview in one back-button click", async ({
    api,
    page,
    baseURL,
  }) => {
    const projectId = await api.createProject(
      `Hist Back ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    );
    await api.createFolder(projectId, "Folder 1");

    await installHistoryTracker(page);
    await page.goto(`${baseURL}/en-US/projects/overview/${projectId}`);
    await page.waitForLoadState("networkidle");

    await page.evaluate((id: number) => {
      window.location.href = `/en-US/projects/repository/${id}`;
    }, projectId);
    await page.waitForURL(/\/projects\/repository\/\d+/);
    await page.waitForURL(/[?&]view=folders/, { timeout: 10000 });
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(300);

    await page.goBack();
    await page.waitForURL(/\/projects\/overview\/\d+/, { timeout: 5000 });
    await page.waitForLoadState("networkidle");

    expect(page.url()).toMatch(/\/projects\/overview\/\d+(\?|$)/);
  });

  test("clicking a folder in the tree updates URL and content; no new push", async ({
    api,
    page,
  }) => {
    const projectId = await api.createProject(
      `Hist Folder ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    );
    const folderAId = await api.createFolder(projectId, "Folder A");
    const folderBId = await api.createFolder(projectId, "Folder B");
    await api.createTestCase(projectId, folderAId, "Case in A");
    await api.createTestCase(projectId, folderBId, "Case in B");

    await installHistoryTracker(page);
    const repositoryPage = new RepositoryPage(page);
    await repositoryPage.goto(projectId);
    // Wait for auto-select to land on first folder.
    await page.waitForURL(/[?&]view=folders/, { timeout: 10000 });
    await page.waitForTimeout(300);

    await resetHistoryLog(page);

    // Switch to Folder B. selectFolder is the page object's robust
    // helper — it scrolls, retries, and dismisses any popups.
    await repositoryPage.selectFolder(folderBId);
    await page.waitForURL(new RegExp(`[?&]node=${folderBId}(?:&|$)`), {
      timeout: 5000,
    });
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(300);

    // Functional: URL reflects Folder B.
    expect(new URL(page.url()).searchParams.get("node")).toBe(
      String(folderBId)
    );
    // Functional: the case from Folder B is visible in the table.
    await expect(
      repositoryPage.casesTable
        .locator("tbody tr")
        .filter({ hasText: "Case in B" })
    ).toBeVisible({ timeout: 5000 });

    // History: zero new pushes — folder selection is intra-page state,
    // not a navigation.
    expectPushCount(await getHistoryLog(page), 0);
  });

  test("changing view in the dropdown updates URL; no new push", async ({
    api,
    page,
  }) => {
    const projectId = await api.createProject(
      `Hist View ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    );
    const folderId = await api.createFolder(projectId, "F1");
    await api.createTestCase(projectId, folderId, "Case 1");

    await installHistoryTracker(page);
    const repositoryPage = new RepositoryPage(page);
    await repositoryPage.goto(projectId);
    await page.waitForURL(/[?&]view=folders/, { timeout: 10000 });
    await page.waitForTimeout(300);

    await resetHistoryLog(page);

    // Open the view switcher (matches the existing view-switching.spec.ts
    // helper). It's a Radix Select rendered as `[role="combobox"]` with
    // the current view name as text.
    const viewSwitcher = page
      .locator('[role="combobox"]')
      .filter({ hasText: /Folders|Template|State|Creator|Automation|Tag/i })
      .first();
    await expect(viewSwitcher).toBeVisible({ timeout: 5000 });
    await viewSwitcher.click();
    const stateOption = page
      .locator('[role="option"]')
      .filter({ hasText: /^state/i })
      .first();
    await expect(stateOption).toBeVisible({ timeout: 3000 });
    await stateOption.click();

    await page.waitForURL(/[?&]view=states/, { timeout: 5000 });
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(300);

    expect(new URL(page.url()).searchParams.get("view")).toBe("states");

    // History: zero new pushes (handleViewChange already uses replace).
    expectPushCount(await getHistoryLog(page), 0);
  });

  test("pagination next-page updates URL; no new push (already uses replace)", async ({
    api,
    page,
  }) => {
    const projectId = await api.createProject(
      `Hist Pag ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    );
    // Cases need to be in the auto-selected (root) folder, not a child,
    // because auto-select-first-folder lands on the root.
    const rootFolderId = await api.getRootFolderId(projectId);
    // Need >10 cases so the default pageSize=10 produces a second page.
    for (let i = 0; i < 12; i += 1) {
      await api.createTestCase(projectId, rootFolderId, `Case ${i + 1}`);
    }

    await installHistoryTracker(page);
    // Navigate directly with an explicit pageSize so pagination is guaranteed
    // to render (default page size may exceed the 12 cases we created).
    await page.goto(
      `/en-US/projects/repository/${projectId}?node=${rootFolderId}&pageSize=10`
    );
    await page.waitForLoadState("networkidle");
    // Wait for an actual case row to appear — guarantees the case query
    // has resolved and pagination is meaningful. Using the case name
    // text is more robust than tbody-tr selectors which can match
    // skeleton rows or other tables on the page.
    await expect(page.getByText("Case 1").first()).toBeVisible({
      timeout: 15000,
    });
    await page.waitForTimeout(300);

    await resetHistoryLog(page);

    // Click "Next" — matches the existing pagination.spec.ts selector.
    const paginationNav = page.locator('nav[aria-label="pagination"]');
    const nextButton = paginationNav
      .locator('a:has-text("Next"), a[aria-label*="next"]')
      .first();
    await expect(nextButton).toBeVisible({ timeout: 5000 });
    await nextButton.click();

    await page.waitForURL(/[?&]page=2/, { timeout: 5000 });
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(300);

    expect(new URL(page.url()).searchParams.get("page")).toBe("2");

    // History: zero — pagination already uses router.replace, this is a
    // regression guard so a future change doesn't accidentally start
    // pushing.
    expectPushCount(await getHistoryLog(page), 0);
  });
});
