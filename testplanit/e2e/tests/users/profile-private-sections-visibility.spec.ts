import type { APIRequestContext } from "@playwright/test";

import { expect, test } from "../../fixtures";
import { signInSecondaryContext } from "../../utils/secondary-context-login";

// Signup seeds UserPreferences with the first-run setup flag off, so a fresh
// user lands behind InitialPreferencesDialog and its overlay swallows clicks.
// Mark the setup done so the test drives the profile page, not the modal.
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

/**
 * Profile page — private-section authorization.
 *
 * `canViewAssignments = canViewPrivateInfo || isProjectAdmin` widened the
 * private accordion to PROJECTADMIN viewers, but every OTHER private item
 * stays individually gated on `canViewPrivateInfo` (own profile or ADMIN).
 * These tests pin the boundary: a PROJECTADMIN viewing someone else's profile
 * gets Assignments and ONLY Assignments; a plain USER gets no private
 * accordion at all.
 */
test.describe("Profile private-section visibility", () => {
  test("PROJECTADMIN sees Assignments but not Account on another user's profile", async ({
    api,
    browser,
    baseURL,
    request,
  }) => {
    const ts = Date.now();
    const password = "Password123!";

    const target = await api.createUser({
      name: `Profile Target ${ts}`,
      email: `profile-target-${ts}@testplanit.com`,
      password,
    });

    const viewer = await api.createUser({
      name: `PA Viewer ${ts}`,
      email: `pa-viewer-${ts}@testplanit.com`,
      password,
    });
    // Signup only mints USER; escalate via the admin session PATCH.
    await api.setUserAccess(viewer.data.id, "PROJECTADMIN");
    await completeOnboarding(request, baseURL!, viewer.data.id);

    const context = await signInSecondaryContext(
      browser,
      baseURL!,
      viewer.data.email,
      password
    );
    try {
      const page = await context.newPage();
      await page.goto(`${baseURL}/en-US/users/profile/${target.data.id}`);

      await expect(page.getByTestId("profile-section-assignments")).toBeVisible(
        { timeout: 15000 }
      );
      await expect(page.getByTestId("profile-section-account")).toHaveCount(0);
      await expect(page.getByTestId("profile-section-directory")).toHaveCount(
        0
      );
    } finally {
      await context.close();
    }
  });

  test("a plain USER gets no private accordion on another user's profile", async ({
    api,
    browser,
    baseURL,
    request,
  }) => {
    const ts = Date.now();
    const password = "Password123!";

    const target = await api.createUser({
      name: `Profile Target2 ${ts}`,
      email: `profile-target2-${ts}@testplanit.com`,
      password,
    });
    const viewer = await api.createUser({
      name: `User Viewer ${ts}`,
      email: `user-viewer-${ts}@testplanit.com`,
      password,
    });
    await completeOnboarding(request, baseURL!, viewer.data.id);

    const context = await signInSecondaryContext(
      browser,
      baseURL!,
      viewer.data.email,
      password
    );
    try {
      const page = await context.newPage();
      await page.goto(`${baseURL}/en-US/users/profile/${target.data.id}`);

      // The public card renders (name is visible), but no private sections.
      await expect(page.getByText(`Profile Target2 ${ts}`).first()).toBeVisible(
        { timeout: 15000 }
      );
      await expect(page.getByTestId("profile-section-assignments")).toHaveCount(
        0
      );
      await expect(page.getByTestId("profile-section-account")).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test("own profile shows both Account and Assignments", async ({
    api,
    browser,
    baseURL,
    request,
  }) => {
    const ts = Date.now();
    const password = "Password123!";

    const self = await api.createUser({
      name: `Self Viewer ${ts}`,
      email: `self-viewer-${ts}@testplanit.com`,
      password,
    });
    await completeOnboarding(request, baseURL!, self.data.id);

    const context = await signInSecondaryContext(
      browser,
      baseURL!,
      self.data.email,
      password
    );
    try {
      const page = await context.newPage();
      await page.goto(`${baseURL}/en-US/users/profile/${self.data.id}`);

      await expect(page.getByTestId("profile-section-account")).toBeVisible({
        timeout: 15000,
      });
      await expect(
        page.getByTestId("profile-section-assignments")
      ).toBeVisible();
    } finally {
      await context.close();
    }
  });
});
