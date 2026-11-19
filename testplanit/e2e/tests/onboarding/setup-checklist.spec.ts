import type { APIRequestContext } from "@playwright/test";

import { expect, stubLiveStreams, test } from "../../fixtures";
import { signInSecondaryContext } from "../../utils/secondary-context-login";

/**
 * The admin setup checklist on the home page. Which items are done depends on
 * the whole instance (projects, users, integrations), which other specs change
 * as they run, so the expected state is read from the API first and the card
 * is checked against it.
 */

async function count(
  request: APIRequestContext,
  baseURL: string,
  model: string,
  where: Record<string, unknown>
): Promise<number> {
  const response = await request.get(
    `${baseURL}/api/model/${model}/count?q=${encodeURIComponent(
      JSON.stringify({ where })
    )}`
  );
  expect(response.ok()).toBe(true);
  return (await response.json()).data as number;
}

async function setDismissed(
  request: APIRequestContext,
  baseURL: string,
  userId: string,
  value: boolean
) {
  const response = await request.patch(
    `${baseURL}/api/model/userPreferences/update`,
    {
      data: {
        where: { userId },
        data: { hasDismissedSetupChecklist: value },
      },
    }
  );
  expect(response.ok()).toBe(true);
}

/** Clears the items admins ticked by hand (stored for the whole instance). */
async function clearTicks(request: APIRequestContext, baseURL: string) {
  const key = "setup_checklist_marked_done";
  const response = await request.post(`${baseURL}/api/model/appConfig/upsert`, {
    data: { where: { key }, create: { key, value: [] }, update: { value: [] } },
  });
  expect(response.ok()).toBe(true);
}

test.describe("Setup checklist", () => {
  test.describe.configure({ mode: "serial" });
  let adminId: string;

  test.beforeAll(async ({ request, baseURL }) => {
    const session = await (
      await request.get(`${baseURL}/api/auth/session`)
    ).json();
    adminId = session.user.id;
    await setDismissed(request, baseURL!, adminId, false);
    await clearTicks(request, baseURL!);
  });

  test.afterAll(async ({ request, baseURL }) => {
    await setDismissed(request, baseURL!, adminId, false);
    await clearTicks(request, baseURL!);
  });

  test("shows each item as done or not from the instance's data, takes ticks, and hides after confirming", async ({
    page,
    request,
    baseURL,
  }) => {
    const url = baseURL!;

    const expected = {
      createProject:
        (await count(request, url, "projects", {
          isDeleted: false,
          isDemo: false,
        })) > 0,
      inviteTeam:
        (await count(request, url, "user", {
          isDeleted: false,
          isActive: true,
          id: { not: adminId },
        })) > 0,
      connectIssueTracker:
        (await count(request, url, "integration", { isDeleted: false })) > 0,
      connectAiProvider:
        (await count(request, url, "llmIntegration", { isDeleted: false })) > 0,
      setUpSso:
        (await count(request, url, "ssoProvider", {
          enabled: true,
          type: { not: "MAGIC_LINK" },
        })) > 0,
    };

    await stubLiveStreams(page);
    await page.goto(`${url}/en-US`);
    await page.waitForLoadState("load");
    const card = page.getByTestId("setup-checklist");

    if (Object.values(expected).every(Boolean)) {
      // Nothing left to do on this instance: the card stays away.
      await expect(page.getByTestId("dashboard-card")).toBeVisible();
      await expect(card).toHaveCount(0);
      return;
    }

    await expect(card).toBeVisible({ timeout: 15000 });
    for (const [key, done] of Object.entries(expected)) {
      await expect(
        page.getByTestId(`setup-checklist-item-${key}`),
        key
      ).toHaveAttribute("data-done", String(done));
      await expect(page.getByTestId(`setup-checklist-open-${key}`)).toHaveCount(
        done ? 0 : 1
      );
      const checkbox = page.getByTestId(`setup-checklist-checkbox-${key}`);
      if (done) {
        // Done because the data exists: the tick cannot be taken back.
        await expect(checkbox).toBeChecked();
        await expect(checkbox).toBeDisabled();
      } else {
        await expect(checkbox).not.toBeChecked();
      }
    }

    // Tick an item by hand, and take the tick back, unless that would finish
    // the list (the card closes once everything is done).
    const open = Object.entries(expected).filter(([, done]) => !done);
    if (open.length > 1) {
      const [key] = open[0];
      const item = page.getByTestId(`setup-checklist-item-${key}`);
      const checkbox = page.getByTestId(`setup-checklist-checkbox-${key}`);
      await checkbox.click();
      await expect(item).toHaveAttribute("data-done", "true");
      await page.reload();
      await page.waitForLoadState("load");
      await expect(checkbox).toBeChecked({ timeout: 15000 });
      await checkbox.click();
      await expect(item).toHaveAttribute("data-done", "false");
    }

    // Cancelling the confirmation keeps the card.
    await page.getByTestId("setup-checklist-hide").click();
    const dialog = page.getByTestId("setup-checklist-hide-dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(card).toBeVisible();

    await page.getByTestId("setup-checklist-hide").click();
    await page.getByTestId("setup-checklist-hide-confirm").click();
    await expect(card).toHaveCount(0, { timeout: 15000 });

    await page.reload();
    await page.waitForLoadState("load");
    await expect(page.getByTestId("dashboard-card")).toBeVisible();
    await expect(card).toHaveCount(0);
  });

  test("the Help menu brings a hidden checklist back", async ({
    page,
    request,
    baseURL,
  }) => {
    await setDismissed(request, baseURL!, adminId, true);
    await stubLiveStreams(page);
    await page.goto(`${baseURL}/en-US/projects`);
    await page.waitForLoadState("load");

    await page.getByTestId("help-menu-button").first().click();
    await page.getByTestId("help-menu-setup-checklist").click();

    await expect(page).toHaveURL(/\/en-US\/?\?setupChecklist=open$/);
    // Shown even when everything on this instance is already done.
    await expect(page.getByTestId("setup-checklist")).toBeVisible({
      timeout: 15000,
    });
  });

  test("is not shown to a user who is not an administrator", async ({
    browser,
    baseURL,
    api,
    request,
  }) => {
    const email = `checklist-user-${Date.now()}@example.com`;
    const password = "S3cure!password";
    const user = await api.createUser({
      name: "Checklist User",
      email,
      password,
      access: "USER",
      isActive: true,
      emailVerified: true,
    });
    const ctx = await signInSecondaryContext(
      browser,
      baseURL!,
      email,
      password
    );
    try {
      await ctx.addInitScript(() =>
        localStorage.setItem("hasSeenOnboardingTour", "true")
      );
      const page = await ctx.newPage();
      await stubLiveStreams(page);
      await page.goto(`${baseURL}/en-US`);
      await page.waitForLoadState("load");
      await page.getByRole("button", { name: "Keep defaults" }).click();
      await expect(page.getByTestId("dashboard-card")).toBeVisible({
        timeout: 15000,
      });
      await expect(page.getByTestId("setup-checklist")).toHaveCount(0);
    } finally {
      await ctx.close();
      await request.patch(`${baseURL}/api/model/user/update`, {
        data: { where: { id: user.data.id }, data: { isDeleted: true } },
      });
    }
  });
});
