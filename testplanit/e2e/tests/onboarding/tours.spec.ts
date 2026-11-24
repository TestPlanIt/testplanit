import type { APIRequestContext, BrowserContext, Page } from "@playwright/test";

import { expect, stubLiveStreams, test } from "../../fixtures";
import { signInSecondaryContext } from "../../utils/secondary-context-login";

/**
 * Every onboarding tour, walked through the real UI. Each step names the
 * element it points at (`data-step-selector` on the tour card); the step only
 * passes when that element is visible on the page the tour has brought the
 * user to. A renamed id or a removed menu entry fails here instead of leaving
 * a tour card pointing at nothing.
 */

/**
 * Whether the tour card and its anchor fit in the window, and the highlight
 * sits on the anchor. All three rely on the patched nextstepjs
 * (patches/nextstepjs@2.3.0.patch).
 */
async function placement(page: Page, anchor: ReturnType<Page["locator"]>) {
  const viewport = page.viewportSize()!;
  const card = await page.getByTestId("tour-card").boundingBox();
  const target = await anchor.boundingBox();
  const highlight = await page
    .locator("[data-name='nextstep-pointer']")
    .boundingBox();
  if (!card || !target || !highlight) {
    return {
      cardOnScreen: false,
      anchorOnScreen: false,
      highlightOnAnchor: false,
    };
  }
  const middle = (box: { y: number; height: number }) => box.y + box.height / 2;
  return {
    cardOnScreen: card.y >= 0 && card.y + card.height <= viewport.height,
    // An anchor taller than the window (a whole panel) only has to cover it.
    anchorOnScreen:
      target.height > viewport.height
        ? target.y <= 0 && target.y + target.height >= viewport.height
        : target.y >= 0 && target.y + target.height <= viewport.height,
    highlightOnAnchor: Math.abs(middle(highlight) - middle(target)) <= 8,
  };
}

const PROJECT_TOUR_PAGES: Record<string, string> = {
  "#project-requirements-link": "requirements",
  "#test-cases-link": "repository",
  "#shared-steps-link": "shared-steps",
  "#test-runs-link": "runs",
  "#exploratory-link": "sessions",
  "#project-tags-link": "tags",
  "#project-issues-link": "issues",
  "#project-triage-link": "triage",
  "#reports-link": "reports",
  "#audit-logs-link": "audit-logs",
  "#settings-integrations-link": "settings",
};

async function walkTour(page: Page, tourName: string) {
  // Steps for optional menu entries are added as permissions load, so start
  // once the page has settled, as a person using the Help menu would.
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(
    () => typeof (window as any).startOnboardingTour === "function"
  );
  await page.evaluate(
    (name) => (window as any).startOnboardingTour(name),
    tourName
  );

  const card = page.getByTestId("tour-card");
  await expect(card).toBeVisible({ timeout: 15000 });
  const total = Number(/\d+ \/ (\d+)/.exec(await card.innerText())?.[1]);
  expect(total).toBeGreaterThan(0);

  const selectors: string[] = [];
  for (let step = 1; step <= total; step++) {
    await expect(card).toContainText(`${step} / ${total}`, { timeout: 20000 });
    const selector = await card.getAttribute("data-step-selector");
    expect(selector, `${tourName} step ${step} has a selector`).toBeTruthy();
    const anchor = page.locator(selector!).first();
    await expect(
      anchor,
      `${tourName} step ${step} points at ${selector}`
    ).toBeVisible({ timeout: 20000 });
    await expect(async () => {
      expect(
        await placement(page, anchor),
        `${tourName} step ${step}: card on screen, highlight on ${selector}`
      ).toEqual({
        cardOnScreen: true,
        anchorOnScreen: true,
        highlightOnAnchor: true,
      });
    }).toPass({ timeout: 10000 });
    const projectPage =
      tourName === "projectTour" ? PROJECT_TOUR_PAGES[selector!] : undefined;
    if (projectPage) {
      await expect(
        page,
        `${tourName} step ${step} is on the ${projectPage} page`
      ).toHaveURL(new RegExp(`/projects/${projectPage}/\\d+`), {
        timeout: 20000,
      });
    }
    selectors.push(selector!);
    const next = page.getByTestId("tour-card-next");
    if (step === total) {
      await next.click();
      continue;
    }
    // A Next clicked while the page is still writing its own URL can be
    // lost; click again only while the card still shows this step.
    await expect(async () => {
      if ((await card.innerText()).includes(`${step} / ${total}`)) {
        await next.click();
      }
      await expect(card).toContainText(`${step + 1} / ${total}`, {
        timeout: 8000,
      });
    }).toPass({ timeout: 40_000 });
  }
  // No "card is gone" check: finishing the welcome tour hands over to the
  // demo project tour, which opens a card of its own.
  return selectors;
}

async function updateProject(
  request: APIRequestContext,
  baseURL: string,
  id: number,
  data: Record<string, unknown>
) {
  const response = await request.patch(`${baseURL}/api/model/projects/update`, {
    data: { where: { id }, data },
  });
  expect(response.ok()).toBe(true);
}

test.describe("Onboarding tours", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({ page }) => {
    await stubLiveStreams(page);
  });

  test("welcome tour", async ({ page, baseURL }) => {
    await page.goto(`${baseURL}/en-US`);
    await page.waitForLoadState("load");
    const selectors = await walkTour(page, "mainTour");
    expect(selectors).toContain("#your-projects a");
  });

  test("project tour, with every optional menu entry turned on", async ({
    page,
    request,
    baseURL,
    api,
  }) => {
    const projectId = await api.createProject(`Tour project ${Date.now()}`);
    try {
      await updateProject(request, baseURL!, projectId, {
        requirementsEnabled: true,
        failureTriageEnabled: true,
      });
      await page.goto(`${baseURL}/en-US/projects/overview/${projectId}`);
      await page.waitForLoadState("load");
      const selectors = await walkTour(page, "projectTour");
      for (const entry of [
        "#project-requirements-link",
        "#project-triage-link",
        "#audit-logs-link",
        "#settings-integrations-link",
      ]) {
        expect(selectors).toContain(entry);
      }
    } finally {
      await api.deleteProject(projectId);
    }
  });

  test("project tour leaves out entries the project has turned off", async ({
    page,
    request,
    baseURL,
    api,
  }) => {
    const projectId = await api.createProject(`Tour plain ${Date.now()}`);
    try {
      await updateProject(request, baseURL!, projectId, {
        requirementsEnabled: false,
        failureTriageEnabled: false,
      });
      await page.goto(`${baseURL}/en-US/projects/overview/${projectId}`);
      await page.waitForLoadState("load");
      const selectors = await walkTour(page, "projectTour");
      expect(selectors).not.toContain("#project-requirements-link");
      expect(selectors).not.toContain("#project-triage-link");
    } finally {
      await api.deleteProject(projectId);
    }
  });

  test("admin tour has one step per admin menu section", async ({
    page,
    baseURL,
  }) => {
    await page.goto(`${baseURL}/en-US/admin/projects`);
    await page.waitForLoadState("load");
    const selectors = await walkTour(page, "adminTour");
    const sections = await page
      .locator("[data-testid^='admin-menu-section-trigger-']")
      .count();
    expect(sections).toBeGreaterThan(0);
    expect(selectors).toHaveLength(sections + 1);
  });

  test("demo project tour", async ({ page, request, baseURL }) => {
    const response = await request.get(
      `${baseURL}/api/model/projects/findFirst?q=${encodeURIComponent(
        JSON.stringify({ where: { isDemo: true, isDeleted: false } })
      )}`
    );
    const demo = (await response.json()).data as { id: number } | null;
    test.skip(!demo, "the E2E seed has no Demo Project");

    await page.goto(`${baseURL}/en-US/projects/overview/${demo!.id}`);
    await page.waitForLoadState("load");
    await walkTour(page, "demoProjectTour");
  });
});

test.describe("Welcome tour start", () => {
  const createdUserIds: string[] = [];
  const openedContexts: BrowserContext[] = [];

  test.afterEach(async ({ request, baseURL }) => {
    while (openedContexts.length) {
      await openedContexts
        .pop()
        ?.close()
        .catch(() => {});
    }
    while (createdUserIds.length) {
      const id = createdUserIds.pop();
      await request
        .patch(`${baseURL}/api/model/user/update`, {
          data: { where: { id }, data: { isDeleted: true } },
        })
        .catch(() => {});
    }
  });

  test("starts on the home page once the first-run preferences are done", async ({
    browser,
    baseURL,
    api,
  }) => {
    const email = `tour-start-${Date.now()}@example.com`;
    const password = "S3cure!password";
    const user = await api.createUser({
      name: "Tour Start",
      email,
      password,
      access: "USER",
      isActive: true,
      emailVerified: true,
    });
    createdUserIds.push(user.data.id);

    const ctx = await signInSecondaryContext(
      browser,
      baseURL!,
      email,
      password
    );
    openedContexts.push(ctx);
    const page = await ctx.newPage();
    await stubLiveStreams(page);
    await page.goto(`${baseURL}/en-US`);
    await page.waitForLoadState("load");

    // The preferences dialog comes first, and the tour waits for it.
    await expect(page.getByTestId("initial-preferences-form")).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByTestId("tour-card")).toHaveCount(0);

    await page.getByRole("button", { name: "Keep defaults" }).click();

    const card = page.getByTestId("tour-card");
    await expect(card).toBeVisible({ timeout: 15000 });
    await expect(card).toHaveAttribute("data-step-selector", "#header-logo");
  });
});
