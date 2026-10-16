import type { APIRequestContext, Page } from "@playwright/test";

import { expect, test } from "../../fixtures";
import { signInSecondaryContext } from "../../utils/secondary-context-login";

/**
 * Per-type notification preferences (#654).
 *
 * A user switches one notification type off from their profile; the
 * notification worker then drops that type for them while every other
 * type still arrives, and "Reset to defaults" turns it back on.
 *
 * The trigger is a share link with notify-on-view: each POST to
 * `/api/share/{key}` queues a SHARE_LINK_ACCESSED notification for the
 * link's creator through the same worker path every other type uses, and
 * it needs no browser session, so the test can fire it between UI steps.
 */

// Signup seeds UserPreferences with the first-run setup flag off, so a fresh
// user lands behind InitialPreferencesDialog and its overlay swallows clicks.
async function completeOnboarding(
  request: APIRequestContext,
  baseURL: string,
  userId: string
): Promise<void> {
  await request
    .patch(`${baseURL}/api/model/userPreferences/update`, {
      data: {
        where: { userId },
        data: { hasCompletedInitialPreferencesSetup: true },
      },
    })
    .catch(() => {});
}

async function countNotifications(
  request: APIRequestContext,
  baseURL: string,
  userId: string,
  type: string
): Promise<number> {
  const q = encodeURIComponent(
    JSON.stringify({
      where: { userId, type, isDeleted: false },
      select: { id: true },
    })
  );
  const response = await request.get(
    `${baseURL}/api/model/notification/findMany?q=${q}`
  );
  if (!response.ok()) return -1;
  const json = await response.json();
  return Array.isArray(json.data) ? json.data.length : -1;
}

async function mutedTypes(
  request: APIRequestContext,
  baseURL: string,
  userId: string
): Promise<string[]> {
  const q = encodeURIComponent(
    JSON.stringify({
      where: { userId },
      select: { mutedNotificationTypes: true },
    })
  );
  const response = await request.get(
    `${baseURL}/api/model/userPreferences/findFirst?q=${q}`
  );
  if (!response.ok()) return ["<error>"];
  const json = await response.json();
  return json.data?.mutedNotificationTypes ?? ["<missing>"];
}

async function openShareLink(
  request: APIRequestContext,
  baseURL: string,
  shareKey: string
): Promise<void> {
  const response = await request.post(`${baseURL}/api/share/${shareKey}`, {
    data: {},
  });
  expect(response.ok(), await response.text()).toBeTruthy();
}

/** The per-type section sits in the Notification Preferences card on the Notifications & Alerts page. */
async function openTypePreferences(page: Page): Promise<void> {
  await expect(page.getByTestId("notification-preferences-card")).toBeVisible({
    timeout: 15000,
  });
  await expect(page.getByTestId("notification-type-preferences")).toBeVisible({
    timeout: 15000,
  });
}

test.describe("Per-type notification preferences", () => {
  test("muting a type stops it, other types still arrive, and reset turns it back on", async ({
    api,
    browser,
    baseURL,
    request,
  }) => {
    const url = baseURL!;
    const ts = Date.now();
    const password = "Password123!";

    const user = await api.createUser({
      name: `Mute User ${ts}`,
      email: `mute-user-${ts}@testplanit.com`,
      password,
    });
    const userId = user.data.id;
    await completeOnboarding(request, url, userId);

    const projectId = await api.createProject(`Mute Types ${ts}`);
    await api.giveUserProjectAccess({ userId, projectId });
    const folderId = await api.getRootFolderId(projectId);
    const caseId = await api.createTestCase(projectId, folderId, `Case ${ts}`);

    // An admin can mint a link owned by another user; the user is the
    // recipient of every view notification.
    const shareKey = `mute-${ts}-${"a".repeat(24)}`;
    const created = await request.post(`${url}/api/model/shareLink/create`, {
      data: {
        data: {
          shareKey,
          entityType: "TEST_CASE",
          entityId: String(caseId),
          mode: "PUBLIC",
          notifyOnView: true,
          title: `Mute ${ts}`,
          project: { connect: { id: projectId } },
          createdBy: { connect: { id: userId } },
        },
      },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    api.trackShareLink((await created.json()).data.id);

    const count = () =>
      countNotifications(request, url, userId, "SHARE_LINK_ACCESSED");

    await test.step("a view before muting is delivered", async () => {
      await openShareLink(request, url, shareKey);
      await expect.poll(count, { timeout: 30000 }).toBe(1);
    });

    const context = await signInSecondaryContext(
      browser,
      url,
      user.data.email,
      password
    );
    try {
      const page = await context.newPage();
      await page.goto(`${url}/en-US/users/profile/${userId}/alerts`);
      await openTypePreferences(page);

      const shareSwitch = page.getByTestId(
        "notification-type-switch-SHARE_LINK_ACCESSED"
      );

      await test.step("every optional type is on and live; locked types are fixed; admin types are hidden", async () => {
        await expect(shareSwitch).toHaveAttribute("aria-checked", "true");
        await expect(shareSwitch).toBeEnabled();
        await expect(
          page.getByTestId("notification-type-switch-SYSTEM_ANNOUNCEMENT")
        ).toBeDisabled();
        await expect(
          page.getByTestId("notification-type-switch-INTEGRATION_AUTH_EXPIRED")
        ).toBeDisabled();
        await expect(
          page.getByTestId("notification-type-switch-USER_REGISTERED")
        ).toHaveCount(0);
        await expect(
          page.getByTestId("notification-types-reset")
        ).toBeDisabled();
      });

      await test.step("switching the type off persists it at once", async () => {
        await shareSwitch.click();
        await expect(shareSwitch).toHaveAttribute("aria-checked", "false");
        await expect(
          page.getByTestId("notification-types-reset")
        ).toBeEnabled();
        await expect
          .poll(() => mutedTypes(request, url, userId), { timeout: 15000 })
          .toEqual(["SHARE_LINK_ACCESSED"]);

        await page.reload();
        await openTypePreferences(page);
        await expect(shareSwitch).toHaveAttribute("aria-checked", "false");
        await expect(
          page.getByTestId("notification-type-switch-WORK_ASSIGNED")
        ).toHaveAttribute("aria-checked", "true");
      });

      await test.step("a view while muted creates no notification", async () => {
        await openShareLink(request, url, shareKey);
        // The worker drops the job within milliseconds; leave it a wide
        // margin so the job is certainly judged against the muted set
        // before the next step clears it.
        await page.waitForTimeout(3000);
        expect(await count()).toBe(1);
      });

      await test.step("reset to defaults turns the type back on", async () => {
        await page.getByTestId("notification-types-reset").click();
        await expect(shareSwitch).toHaveAttribute("aria-checked", "true");
        await expect
          .poll(() => mutedTypes(request, url, userId), { timeout: 15000 })
          .toEqual([]);
      });

      await test.step("a view after the reset is delivered again", async () => {
        await openShareLink(request, url, shareKey);
        await expect.poll(count, { timeout: 30000 }).toBe(2);
        // Nothing arrives late for the muted view.
        await page.waitForTimeout(2000);
        expect(await count()).toBe(2);
      });
    } finally {
      await context.close();
    }
  });
});
